// Shared, replaceable feedback and outside-click rules.
export function makeStatusController(element, schedule = setTimeout, cancel = clearTimeout) {
  let fadeTimer = null;
  let hideTimer = null;
  return (message, state = 'ok') => {
    cancel(fadeTimer);
    cancel(hideTimer);
    element.hidden = false;
    element.textContent = message;
    element.dataset.state = state;
    element.classList.remove('fade-out');
    const duration = state === 'error' ? 6500 : 3500;
    fadeTimer = schedule(() => element.classList.add('fade-out'), duration - 450);
    hideTimer = schedule(() => { element.hidden = true; }, duration);
  };
}
export function shouldClosePopups(target) {
  return !target?.closest?.('.tip-up-settings,[data-popup],#objectContextMenu');
}
