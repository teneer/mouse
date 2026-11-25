export function createGoalCelebrationQueue(celebrate) {
  const queue = [];

  function recordFor(records, pending) {
    const record = records.get(pending.id);
    return record && record.reached === pending.reached && record.status !== 'withdrawn' &&
      (record.status === 'pending' || record.automatic) ? record : null;
  }

  return {
    enqueue(records, previous, prioritize=false) {
      const added=[];
      const byEvent = new Map();
      for (const record of records) {
        if (record.silent || record.status === 'withdrawn' || record.reached === previous.get(record.id)) continue;
        if (!byEvent.has(record.reached)) byEvent.set(record.reached,[]);
        byEvent.get(record.reached).push(record);
      }
      for (const batch of byEvent.values()) {
        added.push(batch.map(({id,reached})=>({id,reached})));
      }
      if (prioritize) queue.unshift(...added);
      else queue.push(...added);
      return added.length>0;
    },
    take(records) {
      while (queue.length) {
        const pending=queue.shift();
        const group=pending.map(row=>recordFor(records,row)).filter(Boolean);
        if (!group.length) continue;
        celebrate(group.some(row=>row.type==='class')?'class':'team',group[0].reached);
        return group;
      }
      return [];
    },
    hasPending(records) {
      return queue.some(group => group.some(pending => recordFor(records,pending)));
    },
    clear() {queue.length = 0;},
    reset() {queue.length = 0;}
  };
}

export function celebrationSections(records,teamList,teamAccent) {
  const groups=new Map();
  const sorted=[...records].sort((a,b)=>Number(a.type==='team')-Number(b.type==='team') || a.score-b.score);
  for (const row of sorted) {
    const score=row.milestone??row.score;
    const key=JSON.stringify([row.type,row.goalId,score,row.message]);
    if (!groups.has(key)) groups.set(key,{type:row.type,score,message:row.message,names:[],accent:null});
    const section=groups.get(key);
    if (row.type==='team') {
      section.names.push(teamList.find(team=>team.id===row.teamId)?.name || row.teamName || '모둠');
      section.accent=section.names.length===1 ? teamAccent(row.teamId) : null;
    }
  }
  return [...groups.values()];
}

export function mountGoalCelebration(popup) {
  popup.classList.add('goal-celebration-card');
  popup.innerHTML=`
    <button type="button" class="goal-toast-close" aria-label="축하 팝업 닫기">×</button>
    <div class="goal-toast-content" role="status" aria-atomic="true">
      <section class="goal-toast-section"><h2 class="goal-toast-title"></h2>
      <div class="goal-toast-achievement"></div>
      <div class="goal-toast-teams" hidden></div>
      <p class="goal-toast-message"></p></section>
    </div>
    <div class="goal-toast-actions">
      <label class="goal-toast-complete" hidden><input type="checkbox"><span></span></label>
      <button type="button" class="goal-toast-skip" hidden>남은 알림 건너뛰기</button>
    </div>`;
  const content=popup.querySelector('.goal-toast-content');
  const template=content.firstElementChild;
  const resize=new ResizeObserver(()=>{
    content.toggleAttribute('data-scrollable',content.scrollHeight>content.clientHeight);
  });
  resize.observe(content);
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
    popup.dataset.type=detail.sections[0].type;
    content.replaceChildren(...detail.sections.map(section=>{
      const item=template.cloneNode(true);
      item.dataset.type=section.type;
      if (section.accent) item.style.setProperty('--toast-accent',section.accent);
      item.querySelector('.goal-toast-title').textContent=section.type==='team'?'모둠 목표 달성':'학급 목표 달성';
      item.querySelector('.goal-toast-achievement').textContent=section.score+'점';
      const teams=item.querySelector('.goal-toast-teams');
      teams.hidden=!section.names.length;
      teams.textContent=section.names.join(' · ');
      item.querySelector('.goal-toast-message').textContent=section.message;
      return item;
    }));
    content.scrollTop=0;
    checkbox.checked=false;
    checkbox.disabled=false;
    completionLabel.textContent=detail.completeLabel;
    completion.hidden=!detail.complete;
    popup.hidden=false;
  }

  return {show,setSkip};
}
