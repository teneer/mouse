export function mountGoalCelebration(popup) {
  popup.classList.add('goal-celebration-card');
  popup.innerHTML=`
    <button type="button" class="goal-toast-close" aria-label="축하 팝업 닫기">×</button>
    <div class="goal-toast-content" role="status" aria-atomic="true">
      <h2 class="goal-toast-title"></h2>
      <div class="goal-toast-achievement"></div>
      <p class="goal-toast-message"></p>
    </div>
    <label class="goal-toast-complete" hidden><input type="checkbox">완료 처리</label>`;
  const title=popup.querySelector('.goal-toast-title');
  const achievement=popup.querySelector('.goal-toast-achievement');
  const message=popup.querySelector('.goal-toast-message');
  const completion=popup.querySelector('.goal-toast-complete');
  const checkbox=completion.querySelector('input');
  let active;
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

  return detail=>{
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
    message.textContent=detail.message;
    checkbox.checked=false;
    checkbox.disabled=false;
    completion.hidden=!detail.complete;
    popup.hidden=false;
  };
}
