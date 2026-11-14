// 학급온도계: 동일 출처의 탭 간 양방향 동기화
// 점수는 즉시 확정하고, 애니메이션은 확정된 점수를 설명하는 시각 효과로만 사용합니다.
const sounds = {
  mainIncrease: new Audio('Sound/Egg up.MP3'),
  mainDecrease: new Audio('Sound/Egg down.MP3'),
  teamIncrease: new Audio('Sound/Plus.MP3'),
  teamDecrease: new Audio('Sound/Minus.MP3'),
  confirm: new Audio('Sound/Confirm.MP3'),
  success: new Audio('Sound/Success small.MP3')
};
function playSound(sound) {
  if (!sound) return;
  const audio = sound.cloneNode();
  audio.play().catch(error => console.warn('음원 재생 실패:', audio.src, error));
}

let count = 0;
let teams = [];
let classGoals = [];
let teamGoals = [];
const step = 1, minScore = -10000, maxScore = 10000;
let currentActiveGoal = null;
let activeGoalRef = null;

const numberElement = document.getElementById('number');
const changeElement = document.getElementById('change');
const scoreboard = document.getElementById('scoreboard');
const scoreboardTitle = document.getElementById('scoreboard-title');
const createTeamsBtnWrap = document.getElementById('create-teams-btn-wrap');
const teamSetupModal = document.getElementById('team-setup-modal');
const managementModal = document.getElementById('management-modal');
const settingsPanel = document.getElementById('settings-panel');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const goalManagementView = document.getElementById('goal-management-view');
const goalAlert = document.getElementById('goal-alert');
const starContainer = document.getElementById('star-progress-container');

const STORAGE_KEY = 'classThermometerStateV2';
const CHANNEL_NAME = 'class-thermometer-v2';
const syncChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(CHANNEL_NAME) : null;
const tabId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random();
let serial = 0;
let lastAppliedVersion = null;
let initialized = false;

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('저장 데이터 읽기 실패:', error);
    return null;
  }
}
function loadFromStorage() {
  const state = readStoredState();
  if (state) {
    applyStateFields(state);
    lastAppliedVersion = state.version || null;
    return;
  }
  // 과거 버전의 네 개 저장 키를 처음 열 때 가져옵니다.
  try {
    count = parseInt(localStorage.getItem('mainScore'), 10) || 0;
    teams = JSON.parse(localStorage.getItem('teams')) || [];
    classGoals = JSON.parse(localStorage.getItem('classGoals')) || [];
    teamGoals = JSON.parse(localStorage.getItem('teamGoals')) || [];
  } catch (error) {
    console.error('기존 저장 데이터 읽기 실패:', error);
    count = 0; teams = []; classGoals = []; teamGoals = [];
  }
  activeGoalRef = null;
}
function applyStateFields(state) {
  count = Number.isFinite(state.count) ? state.count : 0;
  teams = Array.isArray(state.teams) ? state.teams : [];
  classGoals = Array.isArray(state.classGoals) ? state.classGoals : [];
  teamGoals = Array.isArray(state.teamGoals) ? state.teamGoals : [];
  activeGoalRef = state.activeGoal || null;
  const goals = activeGoalRef &&
    (activeGoalRef.type === 'class' ? classGoals : teamGoals);
  currentActiveGoal = goals ? goals[activeGoalRef.index] || null : null;
  if (!currentActiveGoal || currentActiveGoal.completed) {
    currentActiveGoal = null;
    activeGoalRef = null;
  }
}
function snapshot(version) {
  return { version, count, teams, classGoals, teamGoals, activeGoal: activeGoalRef };
}
function saveToStorage(effect = null) {
  const version = tabId + ':' + (++serial);
  const state = snapshot(version);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastAppliedVersion = version;
  } catch (error) {
    console.error('상태 저장 실패:', error);
    // 저장에 실패했다면 다른 탭에 성공한 것처럼 알리지 않습니다.
    return;
  }
  if (syncChannel) syncChannel.postMessage({ type: 'STATE_CHANGED', version, effect });
}
function syncFromStorage(effect = null, expectedVersion = null) {
  const state = readStoredState();
  if (!state || !state.version || state.version === lastAppliedVersion) return;
  applyStateFields(state);
  lastAppliedVersion = state.version;
  renderCurrentState();
  // 늦게 도착한 메시지는 현재 저장 상태에 해당하는 경우에만 연출합니다.
  if (effect && expectedVersion === state.version) playScoreEffect(effect);
}
if (syncChannel) {
  syncChannel.onmessage = event => {
    if (event.data?.type !== 'STATE_CHANGED') return;
    if (!initialized) return;
    syncFromStorage(event.data.effect, event.data.version);
  };
}
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !initialized) return;
  // BroadcastChannel에 포함된 연출 정보가 먼저 도착할 기회를 줍니다.
  // 채널이 없으면 storage 이벤트만으로 동기화합니다.
  if (syncChannel) setTimeout(() => syncFromStorage(), 80);
  else syncFromStorage();
});

function renderCurrentState() {
  numberElement.textContent = count;
  renderTeams();
  renderActiveGoal();
  if (getComputedStyle(goalManagementView).display !== 'none') renderGoalLists();
  // 관리 모달에 입력 중인 값은 원격 수신으로 덮어쓰지 않습니다.
}
function displayFloatingNumber(element, amount, topStart, topEnd) {
  if (!element) return;
  element.textContent = (typeof amount === 'number' && amount > 0 ? '+' : '') + amount;
  element.style.color = typeof amount !== 'number' ? 'var(--text-color)'
    : amount > 0 ? 'var(--secondary-color)' : 'var(--accent-color)';
  element.style.top = topStart;
  element.style.opacity = 1;
  setTimeout(() => { element.style.opacity = 0; element.style.top = topEnd; }, 600);
}
function updateNumber(className = '', oldScore, newScore) {
  numberElement.textContent = newScore;
  if (className) {
    numberElement.className = className;
    setTimeout(() => { numberElement.className = ''; }, 200);
  }
  checkForGoalAchievement('class', oldScore, newScore);
}
function increment() {
  syncFromStorage();
  if (count + step > maxScore) return;
  const old = count;
  count += step;
  updateNumber('increase', old, count);
  displayFloatingNumber(changeElement, step, '0px', '-20px');
  playSound(sounds.mainIncrease);
  saveToStorage();
}
function decrement() {
  syncFromStorage();
  if (count - step < minScore) return;
  const old = count;
  count -= step;
  updateNumber('decrease', old, count);
  displayFloatingNumber(changeElement, -step, '0px', '-20px');
  playSound(sounds.mainDecrease);
  saveToStorage();
}
function syncAllTeamsScore(amount) { // 기존 함수와의 호환용. 일반 학급 점수 버튼에서는 사용하지 않습니다.
  syncFromStorage();
  if (!teams.length) return;
  if (teams.some(t => t.score + amount > maxScore || t.score + amount < minScore)) return;
  teams.forEach(t => { t.score += amount; });
  renderTeams();
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  saveToStorage();
}
function resetScore() {
  syncFromStorage();
  const old = count;
  count = 0;
  updateNumber('', old, count);
  displayFloatingNumber(changeElement, '리셋', '0px', '-20px');
  playSound(sounds.confirm);
  saveToStorage();
}
function updateMainScoreFromTeams(oldTotalTeamScore) { return; } // 과거 코드와의 호환용

function showTeamSetupModal() {
  teamSetupModal.style.display = 'flex';
  document.getElementById('team-count').focus();
}
function hideTeamSetupModal() { teamSetupModal.style.display = 'none'; }
function createTeams() {
  syncFromStorage();
  let n = parseInt(document.getElementById('team-count').value, 10) || 4;
  n = Math.max(1, Math.min(n, 24 - teams.length));
  if (teams.length >= 24) return;
  for (let i = 0; i < n; i++) teams.push({ name: `모둠 ${teams.length + 1}`, score: 0 });
  hideTeamSetupModal();
  renderTeams();
  saveToStorage();
  playSound(sounds.confirm);
}
function renderTeams() {
  const hasTeams = teams.length > 0;
  scoreboardTitle.style.display = hasTeams ? '' : 'none';
  createTeamsBtnWrap.style.display = hasTeams ? 'none' : 'flex';
  const ruleElement = document.getElementById('conversion-rule');
  if (ruleElement) {
    ruleElement.textContent = `모둠 ${teams.length}점 = 학급 1점`;
    ruleElement.style.display = teams.length > 1 ? 'inline-block' : 'none';
  }
  scoreboard.innerHTML = '';
  teams.forEach((team, idx) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.onclick = () => changeTeamScore(idx, step);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'team-remove-btn';
    removeBtn.title = '모둠 삭제 (관리 메뉴 이용)';
    removeBtn.textContent = '×';
    removeBtn.onclick = e => { e.stopPropagation(); openManagementModal(); };
    card.appendChild(removeBtn);
    const nameSpan = document.createElement('div');
    nameSpan.className = 'team-name'; nameSpan.textContent = team.name;
    card.appendChild(nameSpan);
    const controlsDiv = document.createElement('div'); controlsDiv.className = 'team-controls';
    const numberSpan = document.createElement('span');
    numberSpan.id = `team-number-${idx}`;
    numberSpan.className = 'team-number'; numberSpan.textContent = team.score;
    controlsDiv.appendChild(numberSpan); card.appendChild(controlsDiv);
    const changeEl = document.createElement('div');
    changeEl.id = `team-change-${idx}`; changeEl.className = 'team-change';
    card.appendChild(changeEl);
    const minusBtn = document.createElement('button');
    minusBtn.className = 'team-minus-btn';
    minusBtn.title = '점수 감소'; minusBtn.textContent = '−';
    minusBtn.onclick = e => { e.stopPropagation(); changeTeamScore(idx, -step); };
    card.appendChild(minusBtn);
    scoreboard.appendChild(card);
  });
  renderStars();
  updateStarProgress();
  setTimeout(updateScoreboardAlignment, 10);
}

// 모둠·학급 점수는 클릭하는 순간 함께 확정합니다. 애니메이션은 상태를 수정하지 않습니다.
window.changeTeamScore = function (idx, amount) {
  syncFromStorage();
  const team = teams[idx];
  if (!team || !Number.isFinite(amount)) return;
  const next = team.score + amount;
  if (next > maxScore || next < minScore) return;
  const oldTotal = teams.reduce((sum, t) => sum + t.score, 0);
  const newTotal = oldTotal + amount;
  const oldCount = count;
  const rate = teams.length;
  const classDiff = rate > 1
    ? Math.floor(newTotal / rate) - Math.floor(oldTotal / rate) : 0;
  if (count + classDiff > maxScore || count + classDiff < minScore) return;

  team.score = next;
  count += classDiff;
  const numberEl = document.getElementById(`team-number-${idx}`);
  if (numberEl) {
    numberEl.textContent = next;
    numberEl.className = 'team-number ' + (amount > 0 ? 'team-increase' : 'team-decrease');
    setTimeout(() => { numberEl.className = 'team-number'; }, 200);
  }
  displayFloatingNumber(document.getElementById(`team-change-${idx}`), amount, '20px', '10px');
  updateStarProgress();
  if (classDiff) {
    updateNumber(classDiff > 0 ? 'increase' : 'decrease', oldCount, count);
    displayFloatingNumber(changeElement, classDiff, '0px', '-20px');
  }
  checkForGoalAchievement('team', oldTotal, newTotal);
  const effect = { kind: 'team', idx, amount, classDiff, rate };
  saveToStorage(effect);
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  if (classDiff) playSound(classDiff > 0 ? sounds.mainIncrease : sounds.mainDecrease);
  playScoreEffect(effect);
};
function resetAllTeams() {
  syncFromStorage();
  if (!teams.length) return;
  const oldTotal = teams.reduce((sum, t) => sum + t.score, 0);
  teams.forEach(team => { team.score = 0; });
  checkForGoalAchievement('team', oldTotal, 0);
  renderTeams();
  setTimeout(() => {
    teams.forEach((team, idx) => displayFloatingNumber(
      document.getElementById(`team-change-${idx}`), '리셋', '20px', '10px'));
  }, 10);
  saveToStorage();
  playSound(sounds.confirm);
}

// 모든 효과는 JS에서 만들어서 기존 CSS 파일을 수정할 필요가 없습니다.
function installEffectStyle() {
  const style = document.createElement('style');
  style.textContent = `
    .score-sync-fly {
      position: fixed; z-index: 2147483647; pointer-events: none;
      padding: 3px 9px; border-radius: 8px;
      background: var(--secondary-color, #2563eb); color: #fff;
      font-weight: 700; font-size: 19px; white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}
function centerOf(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
function flyLabel(label, from, to, delay = 0) {
  if (!from || !to) return;
  const node = document.createElement('div');
  node.className = 'score-sync-fly'; node.textContent = label;
  node.style.left = `${from.x}px`; node.style.top = `${from.y}px`;
  node.style.transform = 'translate(-50%, -50%)';
  document.body.appendChild(node);
  if (typeof node.animate !== 'function') { node.remove(); return; }
  const animation = node.animate([
    { transform: 'translate(-50%, -50%) scale(.75)', opacity: 0, offset: 0 },
    { transform: `translate(calc(-50% + ${Math.round((to.x - from.x) * .5)}px), calc(-50% + ${Math.round((to.y - from.y) * .5)}px)) scale(1.15)`, opacity: 1, offset: .45 },
    { transform: `translate(calc(-50% + ${Math.round(to.x - from.x)}px), calc(-50% + ${Math.round(to.y - from.y)}px)) scale(.85)`, opacity: 0, offset: 1 }
  ], { duration: 500, delay, easing: 'ease-in-out' });
  animation.onfinish = () => node.remove();
  animation.oncancel = () => node.remove();
}
function playScoreEffect(effect) {
  if (!effect || effect.kind !== 'team') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const teamNode = document.getElementById(`team-number-${effect.idx}`);
  const starNode = starContainer.children[0] || starContainer;
  const from = centerOf(teamNode);
  const star = centerOf(starNode);
  const main = centerOf(numberElement);
  if (effect.rate > 1 && star) {
    flyLabel(effect.amount > 0 ? '+1' : '−1', from, star);
    if (effect.classDiff) {
      flyLabel(effect.classDiff > 0 ? '★ +1' : '★ −1', star, main, 220);
      if (numberElement.animate) numberElement.animate([
        { transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }
      ], { duration: 380, delay: 520 });
    }
  }
}

function openManagementModal() {
  syncFromStorage();
  document.getElementById('manage-main-score').value = count;
  const list = document.getElementById('team-management-list'); list.innerHTML = '';
  teams.forEach(team => {
    const item = document.createElement('div'); item.className = 'team-manage-item';
    item.innerHTML = '<input type="text" class="manage-input manage-name" maxlength="20"> <input type="number" class="manage-input manage-score"> <button class="delete-team-btn">×</button>';
    item.querySelector('.manage-name').value = team.name;
    item.querySelector('.manage-score').value = team.score;
    list.appendChild(item);
  });
  managementModal.style.display = 'flex';
}
function closeAndSaveManagement() {
  syncFromStorage();
  const oldCount = count;
  let newMain = parseInt(document.getElementById('manage-main-score').value, 10);
  if (!isNaN(newMain)) count = Math.max(minScore, Math.min(newMain, maxScore));
  const newTeams = [];
  document.querySelectorAll('#team-management-list .team-manage-item').forEach(item => {
    let score = parseInt(item.querySelector('.manage-score').value, 10) || 0;
    newTeams.push({
      name: item.querySelector('.manage-name').value.trim() || `모둠 ${newTeams.length + 1}`,
      score: Math.max(minScore, Math.min(score, maxScore))
    });
  });
  teams = newTeams;
  updateNumber('', oldCount, count);
  renderTeams(); saveToStorage();
  managementModal.style.display = 'none'; playSound(sounds.confirm);
}
function closeManagementModal() { managementModal.style.display = 'none'; }
document.getElementById('team-management-list').addEventListener('click', e => {
  if (e.target.classList.contains('delete-team-btn')) e.target.closest('.team-manage-item').remove();
});
document.getElementById('add-team-btn').addEventListener('click', () => {
  const list = document.getElementById('team-management-list');
  const item = document.createElement('div'); item.className = 'team-manage-item';
  item.innerHTML = '<input type="text" class="manage-input manage-name" maxlength="20"> <input type="number" class="manage-input manage-score" value="0"> <button class="delete-team-btn">×</button>';
  item.querySelector('.manage-name').value = `모둠 ${list.children.length + 1}`;
  list.appendChild(item); item.querySelector('.manage-name').focus();
});

function openGoalManagementView() {
  syncFromStorage(); renderGoalLists(); goalManagementView.style.display = 'flex';
}
function closeAndSaveGoalManagementView() {
  syncFromStorage();
  const readGoals = type => {
    const result = [];
    document.querySelectorAll(`#${type}-goals-list .goal-row`).forEach(row => {
      const score = parseInt(row.querySelector('.goal-score').value, 10);
      const message = row.querySelector('.goal-message').value.trim();
      if (!isNaN(score) && message) {
        result.push({ score, message, completed: row.dataset.completed === 'true' });
      }
    });
    return result;
  };
  classGoals = readGoals('class'); teamGoals = readGoals('team');
  activeGoalRef = null; currentActiveGoal = null;
  renderActiveGoal();
  saveToStorage(); goalManagementView.style.display = 'none'; playSound(sounds.confirm);
}
function renderGoalLists() {
  const classList = document.getElementById('class-goals-list');
  const teamList = document.getElementById('team-goals-list');
  classList.innerHTML = ''; teamList.innerHTML = '';
  classGoals.forEach(g => addGoalRowToDOM('class', g.score, g.message, g.completed));
  teamGoals.forEach(g => addGoalRowToDOM('team', g.score, g.message, g.completed));
}
function addGoalRowToDOM(type, score = '', message = '', completed = false) {
  const row = document.createElement('div'); row.className = 'goal-row';
  row.dataset.completed = completed ? 'true' : 'false';
  row.innerHTML = '<input type="number" class="goal-score" placeholder="점수"> <input type="text" class="goal-message" placeholder="문구"> <button class="delete-row-btn">×</button>';
  row.querySelector('.goal-score').value = score;
  row.querySelector('.goal-message').value = message;
  document.getElementById(`${type}-goals-list`).appendChild(row);
}
document.querySelectorAll('.add-row-btn').forEach(btn => {
  btn.onclick = () => addGoalRowToDOM(btn.dataset.type);
});
goalManagementView.addEventListener('click', e => {
  if (e.target.classList.contains('delete-row-btn')) e.target.closest('.goal-row').remove();
});
function checkForGoalAchievement(type, oldScore, newScore) {
  const goals = type === 'class' ? classGoals : teamGoals;
  goals.forEach((goal, index) => {
    if (!goal.completed && oldScore < goal.score && newScore >= goal.score) {
      showGoalPanel(goal, type, index);
    }
    if (currentActiveGoal === goal && newScore < goal.score) hideGoalPanel(false);
  });
}
function renderActiveGoal() {
  if (currentActiveGoal) {
    document.getElementById('goal-panel-message').textContent = currentActiveGoal.message;
    document.getElementById('goal-complete-checkbox').checked = false;
    document.body.classList.add('goal-active');
  } else document.body.classList.remove('goal-active');
}
function showGoalPanel(goal, type, index) {
  currentActiveGoal = goal;
  activeGoalRef = { type, index };
  renderActiveGoal();
  playSound(sounds.success);
  // 점수 변경 함수의 saveToStorage()가 목표판 상태를 함께 전송합니다.
}
function hideGoalPanel(persist = true) {
  currentActiveGoal = null; activeGoalRef = null;
  renderActiveGoal();
  if (persist) saveToStorage();
}
document.getElementById('goal-complete-checkbox').addEventListener('change', e => {
  if (e.target.checked && currentActiveGoal) {
    currentActiveGoal.completed = true;
    hideGoalPanel();
  }
});
document.getElementById('goal-close-btn').addEventListener('click', () => hideGoalPanel());
function showGoalAlert(message) {
  document.getElementById('goal-alert-message').textContent = message;
  goalAlert.classList.add('show'); playSound(sounds.success);
  setTimeout(() => goalAlert.classList.remove('show'), 4000);
}
function updateScoreboardAlignment() {
  const cards = scoreboard.children;
  if (cards.length < 2) { scoreboard.style.justifyContent = 'center'; return; }
  const firstTop = cards[0].offsetTop;
  const wrapped = [...cards].some(card => card.offsetTop > firstTop);
  scoreboard.style.justifyContent = wrapped ? 'flex-start' : 'center';
}
function renderStars() {
  starContainer.innerHTML = '';
  if (teams.length > 1) {
    for (let i = 0; i < teams.length; i++) {
      const star = document.createElement('span');
      star.className = 'star'; star.textContent = '★'; starContainer.appendChild(star);
    }
  }
}
function updateStarProgress() {
  if (teams.length <= 1) return;
  const total = teams.reduce((sum, team) => sum + team.score, 0);
  const rate = teams.length;
  const filled = ((total % rate) + rate) % rate;
  [...starContainer.children].forEach((star, idx) => {
    star.classList.toggle('filled', idx < filled);
  });
}

document.getElementById('main-increase-btn').onclick = increment;
document.getElementById('main-decrease-btn').onclick = decrement;
document.getElementById('reset-main-btn').onclick = resetScore;
document.getElementById('reset-teams-btn').onclick = resetAllTeams;
document.getElementById('open-management-modal-btn').onclick = openManagementModal;
document.getElementById('save-management-btn').onclick = closeAndSaveManagement;
document.getElementById('close-management-btn').onclick = closeManagementModal;
document.getElementById('open-goal-modal-btn').onclick = openGoalManagementView;
document.getElementById('close-goal-view-btn').onclick = closeAndSaveGoalManagementView;
let settingsOpen = false;
settingsToggleBtn.onclick = () => {
  settingsOpen = !settingsOpen;
  settingsPanel.classList.toggle('open', settingsOpen);
};
// 활성 탭 단축키: 1~9, 0은 모둠 1~10; Shift+숫자는 -1; 위/아래는 학급 ±1.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.repeat) return;

  // 입력란과 관리 화면에서는 점수가 의도치 않게 바뀌지 않도록 합니다.
  const target = e.target;
  if (target instanceof Element &&
      (target.closest('input, textarea, select, [contenteditable]') || target.isContentEditable)) return;
  if (getComputedStyle(teamSetupModal).display !== 'none' ||
      getComputedStyle(managementModal).display !== 'none' ||
      getComputedStyle(goalManagementView).display !== 'none' ||
      settingsPanel.classList.contains('open') ||
      document.body.classList.contains('goal-active')) return;

  if (!e.shiftKey && (e.code === 'ArrowUp' || e.key === '+')) {
    e.preventDefault();
    increment();
    return;
  }
  if (!e.shiftKey && (e.code === 'ArrowDown' || e.key === '-')) {
    e.preventDefault();
    decrement();
    return;
  }
  // '+'는 대개 Shift+Equal로 입력되므로 기존 '+' 단축키도 유지합니다.
  if (e.key === '+') {
    e.preventDefault();
    increment();
    return;
  }

  // Shift+Digit1은 e.key가 '!'가 될 수 있으므로 물리적 키인 e.code를 사용합니다.
  const match = /^Digit([0-9])$/.exec(e.code);
  if (!match) return;
  const digit = Number(match[1]);
  const teamIndex = digit === 0 ? 9 : digit - 1;
  if (teamIndex >= teams.length) return;

  e.preventDefault();
  changeTeamScore(teamIndex, e.shiftKey ? -step : step);
});
window.addEventListener('resize', updateScoreboardAlignment);
window.addEventListener('load', () => {
  installEffectStyle();
  loadFromStorage();
  renderCurrentState();
  initialized = true;
  syncFromStorage();
});
