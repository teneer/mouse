export function createGoalCelebrationQueue(celebrate) {
  const queue = [];
  let lastSoundEvent;

  function recordFor(records, pending) {
    const record = records.get(pending.id);
    return record && record.reached === pending.reached && record.status !== 'withdrawn' &&
      (record.status === 'pending' || record.automatic) ? record : null;
  }

  return {
    enqueue(records, previous) {
      const byEvent = new Map();
      for (const record of records) {
        if (record.silent || record.status === 'withdrawn' || record.reached === previous.get(record.id)) continue;
        if (!byEvent.has(record.reached)) byEvent.set(record.reached,[]);
        byEvent.get(record.reached).push(record);
      }
      for (const batch of byEvent.values()) {
        batch.sort((a,b) => a.score-b.score);
        const groups = new Map();
        for (const {id,reached,type,goalId,score} of batch) {
          const key = type === 'team' ? JSON.stringify([goalId,score]) : id;
          if (!groups.has(key)) groups.set(key,[]);
          groups.get(key).push({id,reached});
        }
        queue.push(...groups.values());
      }
    },
    take(records) {
      while (queue.length) {
        const group = queue.shift().map(pending => recordFor(records,pending)).filter(Boolean);
        if (!group.length) continue;
        if (group[0].reached !== lastSoundEvent) {
          lastSoundEvent = group[0].reached;
          celebrate(group[0].type);
        }
        return group;
      }
      return [];
    },
    hasPending(records) {
      return queue.some(group => group.some(pending => recordFor(records,pending)));
    },
    clear() {queue.length = 0;},
    reset() {queue.length = 0;lastSoundEvent = undefined;}
  };
}

export function mountGoalCelebration(popup) {
  popup.classList.add('goal-celebration-card');
  popup.innerHTML=`
    <button type="button" class="goal-toast-close" aria-label="축하 팝업 닫기">×</button>
    <div class="goal-toast-content" role="status" aria-atomic="true">
      <h2 class="goal-toast-title"></h2>
      <div class="goal-toast-achievement"></div>
      <div class="goal-toast-teams" hidden></div>
      <p class="goal-toast-message"></p>
    </div>
    <div class="goal-toast-actions">
      <label class="goal-toast-complete" hidden><input type="checkbox"><span></span></label>
      <button type="button" class="goal-toast-skip" hidden>남은 알림 건너뛰기</button>
    </div>`;
  const title=popup.querySelector('.goal-toast-title');
  const achievement=popup.querySelector('.goal-toast-achievement');
  const teams=popup.querySelector('.goal-toast-teams');
  const message=popup.querySelector('.goal-toast-message');
  const completion=popup.querySelector('.goal-toast-complete');
  const checkbox=completion.querySelector('input');
  const completionLabel=completion.querySelector('span');
  const skip=popup.querySelector('.goal-toast-skip');
  let active;
  function setSkip(action) {
    skip.hidden=!action;
    skip.onclick=action || null;
  }
  popup.querySelector('.goal-toast-close').onclick=()=>active?.close();
  checkbox.onchange=async()=>{
    const detail=active;
    if (!checkbox.checked || !detail?.complete) return;
    checkbox.disabled=true;
    try {
      if (!await detail.complete() && active===detail) checkbox.checked=false;
    } finally {
      if (active===detail) checkbox.disabled=false;
    }
  };

  function show(detail) {
    active=detail;
    if (!detail) {
      popup.hidden=true;
      return;
    }
    popup.dataset.type=detail.type;
    if (detail.accent) popup.style.setProperty('--team-toast-accent',detail.accent);
    else popup.style.removeProperty('--team-toast-accent');
    title.textContent=detail.title;
    achievement.textContent=detail.achievement;
    teams.textContent=detail.names;
    teams.hidden=!detail.names;
    message.textContent=detail.message;
    checkbox.checked=false;
    checkbox.disabled=false;
    completionLabel.textContent=detail.completeLabel;
    completion.hidden=!detail.complete;
    popup.hidden=false;
  }

  return {show,setSkip};
}
