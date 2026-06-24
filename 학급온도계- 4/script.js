// 오디오 객체 초기화
const sounds = {
  mainIncrease: new Audio('Sound/Egg up.mp3'), mainDecrease: new Audio('Sound/Egg down.mp3'),
  teamIncrease: new Audio('Sound/Plus.mp3'), teamDecrease: new Audio('Sound/Minus.mp3'),
  confirm: new Audio('Sound/confirm.mp3'),
  goal: new Audio('Sound/goal.mp3')
};
function playSound(sound) { sound.cloneNode().play(); }

// 전역 변수 설정
let count = 0; let teams = []; let classGoals = []; let teamGoals = [];
const step = 1; const minScore = -10000; const maxScore = 10000;

// DOM 요소
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

// --- [수정] 데이터 저장/불러오기 함수 통합 ---
function loadFromStorage() {
  count = parseInt(localStorage.getItem('mainScore')) || 0;
  teams = JSON.parse(localStorage.getItem('teams')) || [];
  classGoals = JSON.parse(localStorage.getItem('classGoals')) || [];
  teamGoals = JSON.parse(localStorage.getItem('teamGoals')) || [];
}

function saveToStorage() {
  localStorage.setItem('mainScore', count);
  localStorage.setItem('teams', JSON.stringify(teams));
  localStorage.setItem('classGoals', JSON.stringify(classGoals));
  localStorage.setItem('teamGoals', JSON.stringify(teamGoals));
}

// --- 핵심 기능 ---

function displayFloatingNumber(element, amount, topStart, topEnd) {
  if (!element) return;
  element.textContent = (typeof amount === "number" && amount > 0 ? "+" : "") + amount;
  element.style.color = amount > 0 ? 'var(--secondary-color)' : 'var(--accent-color)';
  if (typeof amount !== 'number') element.style.color = 'var(--text-color)';
  element.style.top = topStart;
  element.style.opacity = 1;
  setTimeout(() => {
    element.style.opacity = 0;
    element.style.top = topEnd;
  }, 600);
}

function updateNumber(className = '', oldScore, newScore) {
  numberElement.textContent = newScore;
  if (className) {
    numberElement.className = className;
    setTimeout(() => numberElement.className = "", 200);
  }
  checkForGoalAchievement('class', oldScore, newScore);
}

function increment() {
  if (count + step > maxScore) return;
  const oldScore = count;
  count += step;
  updateNumber('increase', oldScore, count);
  displayFloatingNumber(changeElement, step, "0px", "-20px");
  playSound(sounds.mainIncrease);
  syncAllTeamsScore(step);
  saveToStorage();
}

function decrement() {
  if (count - step < minScore) return;
  const oldScore = count;
  count -= step;
  updateNumber('decrease', oldScore, count);
  displayFloatingNumber(changeElement, -step, "0px", "-20px");
  playSound(sounds.mainDecrease);
  syncAllTeamsScore(-step);
  saveToStorage();
}

function syncAllTeamsScore(amount) {
  if (teams.length === 0) return;
  teams.forEach((team, idx) => {
    const newScore = team.score + amount;
    if (newScore <= maxScore && newScore >= minScore) {
      team.score = newScore;
      const numberEl = document.getElementById(`team-number-${idx}`);
      if (numberEl) numberEl.textContent = team.score;
      displayFloatingNumber(document.getElementById(`team-change-${idx}`), amount, "20px", "10px");
    }
  });
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  updateStarProgress();
}

function resetScore() {
  const oldScore = count;
  count = 0; 
  updateNumber('', oldScore, count);
  displayFloatingNumber(changeElement, '리셋', "0px", "-20px"); 
  playSound(sounds.confirm);
  saveToStorage();
}

function updateMainScoreFromTeams(oldTotalTeamScore) {
  if (teams.length <= 1) return;
  const conversionRate = teams.length;
  const newTotalTeamScore = teams.reduce((sum, team) => sum + team.score, 0);

  const oldSteps = Math.floor(oldTotalTeamScore / conversionRate);
  const newSteps = Math.floor(newTotalTeamScore / conversionRate);
  const diff = newSteps - oldSteps;

  if (diff !== 0) {
    const oldScore = count;
    count += diff;
    updateNumber(diff > 0 ? 'increase' : 'decrease', oldScore, count);
    displayFloatingNumber(changeElement, diff, "0px", "-20px"); // diff 변수를 직접 전달하여 숫자 타입으로 넘겨줍니다.
    playSound(diff > 0 ? sounds.mainIncrease : sounds.mainDecrease);
  }
  
  // ▼▼▼ [수정] 학급 점수가 오른 직후 별 상태를 즉시 업데이트 ▼▼▼
  updateStarProgress();
}

// --- 모둠 관리 ---

function showTeamSetupModal() { teamSetupModal.style.display = 'flex'; document.getElementById('team-count').focus(); }
function hideTeamSetupModal() { teamSetupModal.style.display = 'none'; }
function createTeams() {
  let n = parseInt(document.getElementById('team-count').value, 10) || 4;
  n = Math.max(1, Math.min(n, 24));
  for (let i = 1; i <= n; i++) teams.push({ name: `모둠 ${teams.length + 1}`, score: 0 });
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
    if (teams.length > 1) { ruleElement.textContent = `모둠 ${teams.length}점 = 학급 1점`; ruleElement.style.display = 'inline-block'; } 
    else { ruleElement.style.display = 'none'; }
  }
  scoreboard.innerHTML = '';
  teams.forEach((team, idx) => {
    const card = document.createElement('div'); card.className = 'team-card'; card.onclick = () => changeTeamScore(idx, step);
    const removeBtn = document.createElement('button'); removeBtn.className = 'team-remove-btn'; removeBtn.title = '모둠 삭제 (관리 메뉴 이용)'; removeBtn.innerHTML = '×'; removeBtn.onclick = (e) => { e.stopPropagation(); openManagementModal(); }; card.appendChild(removeBtn);
    const nameSpan = document.createElement('div'); nameSpan.className = 'team-name'; nameSpan.textContent = team.name; card.appendChild(nameSpan);
    const controlsDiv = document.createElement('div'); controlsDiv.className = 'team-controls';
    const numberSpan = document.createElement('span'); numberSpan.id = `team-number-${idx}`; numberSpan.className = 'team-number'; numberSpan.textContent = team.score; controlsDiv.appendChild(numberSpan); card.appendChild(controlsDiv);
    const changeEl = document.createElement('div'); changeEl.id = `team-change-${idx}`; changeEl.className = 'team-change'; card.appendChild(changeEl);
    const minusBtn = document.createElement('button'); minusBtn.className = 'team-minus-btn'; minusBtn.title = '점수 감소'; minusBtn.innerHTML = '−'; minusBtn.onclick = (e) => { e.stopPropagation(); changeTeamScore(idx, -step); }; card.appendChild(minusBtn);
    scoreboard.appendChild(card);
  });
  renderStars();
  updateStarProgress();
  setTimeout(updateScoreboardAlignment, 10);
}
window.changeTeamScore = function(idx, amount) {
  const oldTotalTeamScore = teams.reduce((sum, t) => sum + t.score, 0);
  const team = teams[idx]; const newScore = team.score + amount;
  if (newScore > maxScore || newScore < minScore) return;
  team.score = newScore;
  
  const numberEl = document.getElementById(`team-number-${idx}`);
  if(numberEl) {
      numberEl.textContent = team.score; numberEl.className = 'team-number ' + (amount > 0 ? 'team-increase' : 'team-decrease');
      setTimeout(() => numberEl.className = 'team-number', 200);
  }
  displayFloatingNumber(document.getElementById(`team-change-${idx}`), amount, "20px", "10px");
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  
  updateMainScoreFromTeams(oldTotalTeamScore);
  updateStarProgress();
  checkForGoalAchievement('team', oldTotalTeamScore, teams.reduce((sum, t) => sum + t.score, 0));
  saveToStorage();
};
function resetAllTeams() {
  if (teams.length === 0) return;
  teams.forEach(team => team.score = 0); 
  renderTeams();
  setTimeout(() => { teams.forEach((team, idx) => { const changeEl = document.getElementById(`team-change-${idx}`); if (changeEl) displayFloatingNumber(changeEl, "리셋", "20px", "10px"); }); }, 10);
  saveToStorage(); 
  playSound(sounds.confirm);
}

// --- 점수판 관리 모달 ---
function openManagementModal() {
  document.getElementById('manage-main-score').value = count;
  const listContainer = document.getElementById('team-management-list'); listContainer.innerHTML = '';
  teams.forEach((team, idx) => { const item = document.createElement('div'); item.className = 'team-manage-item'; item.innerHTML = `<input type="text" class="manage-input manage-name" value="${team.name}" maxlength="20"> <input type="number" class="manage-input manage-score" value="${team.score}"> <button class="delete-team-btn">×</button>`; listContainer.appendChild(item); });
  managementModal.style.display = 'flex';
}
function closeAndSaveManagement() {
  let newMainScore = parseInt(document.getElementById('manage-main-score').value, 10); if (!isNaN(newMainScore)) count = Math.max(minScore, Math.min(newMainScore, maxScore));
  const newTeams = [];
  document.querySelectorAll('#team-management-list .team-manage-item').forEach(item => { let newScore = parseInt(item.querySelector('.manage-score').value, 10) || 0; newTeams.push({ name: item.querySelector('.manage-name').value.trim() || `모둠 ${newTeams.length + 1}`, score: Math.max(minScore, Math.min(newScore, maxScore)) }); });
  teams = newTeams; 
  updateNumber('', count, count);
  renderTeams();
  saveToStorage(); 
  managementModal.style.display = 'none'; 
  playSound(sounds.confirm);
}
function closeManagementModal() { managementModal.style.display = 'none'; }
document.getElementById('team-management-list').addEventListener('click', (e) => { if (e.target.classList.contains('delete-team-btn')) e.target.closest('.team-manage-item').remove(); });
document.getElementById('add-team-btn').addEventListener('click', () => {
  const listContainer = document.getElementById('team-management-list'); const newTeamNumber = listContainer.children.length + 1; const newItem = document.createElement('div'); newItem.className = 'team-manage-item';
  newItem.innerHTML = `<input type="text" class="manage-input manage-name" value="모둠 ${newTeamNumber}" maxlength="20"> <input type="number" class="manage-input manage-score" value="0"> <button class="delete-team-btn">×</button>`;
  listContainer.appendChild(newItem); newItem.querySelector('.manage-name').focus();
});


// --- 목표 관리 ---
function openGoalManagementView() { renderGoalLists(); goalManagementView.style.display = 'flex'; }
function closeAndSaveGoalManagementView() {
  classGoals = [];
  document.querySelectorAll('#class-goals-list .goal-row').forEach(row => { const score = parseInt(row.querySelector('.goal-score').value, 10); const message = row.querySelector('.goal-message').value.trim(); if (!isNaN(score) && message) classGoals.push({ score, message, achieved: false }); });
  teamGoals = [];
  document.querySelectorAll('#team-goals-list .goal-row').forEach(row => { const score = parseInt(row.querySelector('.goal-score').value, 10); const message = row.querySelector('.goal-message').value.trim(); if (!isNaN(score) && message) teamGoals.push({ score, message, achieved: false }); });
  saveToStorage(); 
  goalManagementView.style.display = 'none'; 
  playSound(sounds.confirm);
}
function renderGoalLists() {
  const classList = document.getElementById('class-goals-list'); const teamList = document.getElementById('team-goals-list');
  classList.innerHTML = ''; teamList.innerHTML = '';
  classGoals.forEach(goal => addGoalRowToDOM('class', goal.score, goal.message));
  teamGoals.forEach(goal => addGoalRowToDOM('team', goal.score, goal.message));
}
function addGoalRowToDOM(type, score = '', message = '') {
  const list = document.getElementById(`${type}-goals-list`); const row = document.createElement('div'); row.className = 'goal-row';
  row.innerHTML = `<input type="number" class="goal-score" placeholder="점수" value="${score}"> <input type="text" class="goal-message" placeholder="문구" value="${message}"> <button class="delete-row-btn">×</button>`;
  list.appendChild(row);
}
document.querySelectorAll('.add-row-btn').forEach(btn => { btn.onclick = () => addGoalRowToDOM(btn.dataset.type); });
document.getElementById('goal-management-view').addEventListener('click', e => { if (e.target.classList.contains('delete-row-btn')) { e.target.closest('.goal-row').remove(); } });
function checkForGoalAchievement(type, oldScore, newScore) {
  const goals = type === 'class' ? classGoals : teamGoals;
  goals.forEach(goal => { if (!goal.achieved && oldScore < goal.score && newScore >= goal.score) { showGoalAlert(goal.message); goal.achieved = true; } });
  if(goals.length > 0) saveToStorage();
}
function showGoalAlert(message) {
  document.getElementById('goal-alert-message').textContent = message; goalAlert.classList.add('show'); playSound(sounds.goal);
  setTimeout(() => goalAlert.classList.remove('show'), 4000);
}
function updateScoreboardAlignment() {
  const scoreboard = document.getElementById('scoreboard'); const cards = scoreboard.children; if (cards.length < 2) { scoreboard.style.justifyContent = 'center'; return; }
  const firstCardTop = cards[0].offsetTop; let hasWrapped = false;
  for (let i = 1; i < cards.length; i++) { if (cards[i].offsetTop > firstCardTop) { hasWrapped = true; break; } }
  scoreboard.style.justifyContent = hasWrapped ? 'flex-start' : 'center';
}

// --- 별 프로그레스 ---
function renderStars() {
  starContainer.innerHTML = '';
  if (teams.length > 1) {
    for (let i = 0; i < teams.length; i++) {
      const star = document.createElement('span'); star.className = 'star'; star.textContent = '★'; starContainer.appendChild(star);
    }
  }
}
function updateStarProgress() {
  if (teams.length <= 1) return;
  const totalTeamScore = teams.reduce((sum, team) => sum + team.score, 0);
  const conversionRate = teams.length;
  const filledStars = ((totalTeamScore % conversionRate) + conversionRate) % conversionRate;
  const starElements = starContainer.children;
  for (let i = 0; i < starElements.length; i++) {
    starElements[i].classList.toggle('filled', i < filledStars);
  }
}

// --- 이벤트 리스너 및 초기화 ---
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
settingsToggleBtn.onclick = () => { settingsOpen = !settingsOpen; settingsPanel.classList.toggle('open', settingsOpen); };
document.addEventListener('keydown', (e) => { if (document.querySelector('input:focus')) return; if (e.key === "+" || e.key === "ArrowUp") increment(); if (e.key === "-" || e.key === "ArrowDown") decrement(); });
window.addEventListener('resize', updateScoreboardAlignment);

window.onload = () => {
  loadFromStorage();
  updateNumber('', count, count);
  renderTeams();
};