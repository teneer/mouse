import {conversionSteps,scoreRemainder} from './score-display.js';

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
const defaultLinkPoints = 3;
const undoWindow = 2000;
let conversionPlayer=null;
const queuedConversions=[];
let linkEnabled = true;
let linkPoints = defaultLinkPoints;
let lastScoreChange = null;
const selectedTeams = new Set();

const numberElement = document.getElementById('number');
const scoreboard = document.getElementById('scoreboard');
const selectedTeamCount = document.getElementById('selected-team-count');
const createTeamsBtnWrap = document.getElementById('create-teams-btn-wrap');
const teamSetupModal = document.getElementById('team-setup-modal');
const managementModal = document.getElementById('management-modal');
const settingsPanel = document.getElementById('settings-panel');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const goalManagementView = document.getElementById('goal-management-view');
const goalAlert = document.getElementById('goal-alert');
const progress = document.getElementById('score-progress');
const conversionRule = document.getElementById('conversion-rule');
const conversionProgress = document.getElementById('conversion-progress');
const linkMode = document.getElementById('score-link-mode');
const linkRule = document.getElementById('score-link-rule');
const linkInput = document.getElementById('score-link-points');
const batchForm = document.getElementById('batch-score');
const batchDelta = document.getElementById('batch-delta');
const selectAllButton = document.getElementById('select-all-teams');
const undoButton = document.getElementById('undo-score');
const applyBatchButton = document.getElementById('apply-batch');

const STORAGE_KEY = 'classThermometerStateV2';
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
  linkEnabled = state.scoreLink?.enabled !== false;
  linkPoints = validLinkPoints(state.scoreLink?.points) ? state.scoreLink.points : defaultLinkPoints;
  restoreActiveGoal(state.activeGoal);
}
function restoreActiveGoal(ref) {
  activeGoalRef = ref || null;
  const goals = activeGoalRef &&
    (activeGoalRef.type === 'class' ? classGoals : teamGoals);
  currentActiveGoal = goals ? goals[activeGoalRef.index] || null : null;
  if (!currentActiveGoal || currentActiveGoal.completed) {
    currentActiveGoal = null;
    activeGoalRef = null;
  }
}
function snapshot(version) {
  return {
    version, count, teams, classGoals, teamGoals, activeGoal: activeGoalRef,
    scoreLink: { enabled: linkEnabled, points: linkPoints }
  };
}
function saveToStorage(effect = null) {
  const version = tabId + ':' + (++serial);
  const state = {...snapshot(version),effect};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastAppliedVersion = version;
  } catch (error) {
    console.error('상태 저장 실패:', error);
    // 저장에 실패했다면 다른 탭에 성공한 것처럼 알리지 않습니다.
    return;
  }
}
function syncFromStorage(state = readStoredState()) {
  if (!state || !state.version || state.version === lastAppliedVersion) return;
  const remoteTeams = Array.isArray(state.teams) ? state.teams : [];
  if (teams.length !== remoteTeams.length || teams.some((team, index) => team.name !== remoteTeams[index].name)) {
    selectedTeams.clear();
  }
  lastScoreChange = null;
  applyStateFields(state);
  lastAppliedVersion = state.version;
  renderCurrentState(state.effect);
}
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue || !initialized) return;
  try {
    const next=JSON.parse(event.newValue);
    const previous=event.oldValue ? JSON.parse(event.oldValue) : null;
    // Use each event's own snapshot so a burst does not collapse into its final score.
    if(previous?.version===lastAppliedVersion || !previous?.version && !lastAppliedVersion)syncFromStorage(next);
    else if(readStoredState()?.version===next.version)syncFromStorage(next);
  } catch(error) {console.error('점수 동기화 실패:',error);}
});

function renderCurrentState(effect) {
  if(!effect){resetConversion();renderClassNumber(count);}
  renderLinkSettings();
  renderTeams();
  renderActiveGoal();
  if(effect)queueScoreEffect(effect);
  else updateScoreProgress();
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
function renderClassNumber(score) {
  const text = String(score);
  numberElement.textContent = text;
  numberElement.toggleAttribute('data-long-score', text.length >= 5);
}
function recordScoreChange(key = null) {
  const now = performance.now();
  if (key && lastScoreChange?.key === key && now - lastScoreChange.time <= undoWindow) {
    lastScoreChange.time = now;
    return;
  }
  lastScoreChange = { key, time: now, count, scores: teams.map(team => team.score), activeGoalRef };
}
function undoScore() {
  syncFromStorage();
  if (!lastScoreChange) return;
  const previous = lastScoreChange;
  lastScoreChange = null;
  count = previous.count;
  teams.forEach((team, index) => { team.score = previous.scores[index]; });
  restoreActiveGoal(previous.activeGoalRef);
  numberElement.className = '';
  renderCurrentState();
  saveToStorage();
}
function changeClassScore(amount) {
  syncFromStorage();
  const next = count + amount;
  if (next < minScore || next > maxScore) return;
  recordScoreChange(`class:${amount}`);
  const old = count;
  count = next;
  checkForGoalAchievement('class',old,count);
  const effect={kind:'class',oldCount:old,classDiff:amount};
  queueScoreEffect(effect,true);
  renderBatchControls();
  saveToStorage(effect);
}
function increment() { changeClassScore(step); }
function decrement() { changeClassScore(-step); }
function syncAllTeamsScore(amount) { // 이전 호출과의 호환을 위해 유지합니다.
  syncFromStorage();
  changeTeamScores(teams.map((_, index) => index), amount);
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
  lastScoreChange = null;
  for (let i = 0; i < n; i++) teams.push({ name: `모둠 ${teams.length + 1}`, score: 0 });
  hideTeamSetupModal();
  renderTeams();
  saveToStorage();
  playSound(sounds.confirm);
}
function renderTeams() {
  const hasTeams = teams.length > 0;
  createTeamsBtnWrap.style.display = hasTeams ? 'none' : 'flex';
  document.getElementById('team-viewport').hidden = !hasTeams;
  scoreboard.innerHTML = '';
  teams.forEach((team, idx) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'team-select-btn';
    selectButton.onclick = () => {
      if (selectedTeams.has(idx)) selectedTeams.delete(idx);
      else selectedTeams.add(idx);
      renderBatchControls();
    };
    card.appendChild(selectButton);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'team-name';
    nameSpan.textContent = team.name;
    nameSpan.title = team.name;
    selectButton.appendChild(nameSpan);
    const controls = document.createElement('span'); controls.className = 'team-controls';
    const numberSpan = document.createElement('span');
    numberSpan.id = `team-number-${idx}`;
    numberSpan.className = 'team-number';
    renderTeamNumber(numberSpan, team.score);
    controls.appendChild(numberSpan); selectButton.appendChild(controls);
    const changeEl = document.createElement('div');
    changeEl.id = `team-change-${idx}`; changeEl.className = 'team-change';
    card.appendChild(changeEl);
    const steps = document.createElement('div');
    steps.className = 'team-steps';
    for (const delta of [-step, step]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = delta < 0 ? 'team-minus-btn' : 'team-plus-btn';
      button.textContent = delta < 0 ? '−' : '+';
      button.setAttribute('aria-label', `${team.name} 1점 ${delta < 0 ? '차감' : '추가'}`);
      button.onclick = () => changeTeamScore(idx, delta);
      steps.appendChild(button);
    }
    card.appendChild(steps);
    const remove=document.createElement('button');
    remove.type='button';remove.className='team-remove';remove.textContent='×';
    remove.setAttribute('aria-label',team.name+' 삭제');
    remove.onclick=()=>{
      const name=team.name;
      const version=lastAppliedVersion;
      if(!confirm(`“${name}” 모둠을 삭제할까요?`))return;
      syncFromStorage();
      if(lastAppliedVersion!==version || teams[idx]?.name!==name)return;
      teams.splice(idx,1);
      selectedTeams.clear();lastScoreChange=null;
      renderCurrentState();saveToStorage();
    };
    card.appendChild(remove);
    scoreboard.appendChild(card);
  });
  renderBatchControls();
  if(!conversionPlayer)updateScoreProgress();
}
function renderTeamNumber(element, score) {
  const text = String(score);
  element.textContent = text;
  element.toggleAttribute('data-long-score', text.length >= 4);
}

function renderBatchControls() {
  Array.from(scoreboard.children).forEach((card, index) => {
    const selected = selectedTeams.has(index);
    card.classList.toggle('team-selected', selected);
    card.querySelector('.team-select-btn').setAttribute('aria-pressed', String(selected));
  });
  batchForm.hidden = teams.length === 0 && !lastScoreChange;
  selectAllButton.textContent = selectedTeams.size ? '전체해제' : '전체선택';
  selectAllButton.disabled = !teams.length;
  const targetCount = selectedTeams.size;
  selectedTeamCount.textContent = targetCount ? `${targetCount}모둠 선택` : '';
  applyBatchButton.setAttribute('aria-label', targetCount ? `${targetCount}모둠에 반영` : '반영');
  updateBatchButton();
  undoButton.disabled = !lastScoreChange;
}

function updateBatchButton() {
  const delta = batchDelta.valueAsNumber;
  document.getElementById('batch-reset').hidden = !Number.isFinite(delta) || delta===0;
  applyBatchButton.disabled = !selectedTeams.size || !Number.isSafeInteger(delta) || delta === 0;
}

function totalTeamScore() {
  return teams.reduce((sum, team) => sum + team.score, 0);
}
function changeTeamScore(index, amount) {
  changeTeamScores([index], amount, `team:${index}:${amount}`);
}
// 하나의 일괄 입력은 모둠과 학급 점수 범위를 함께 확인한 뒤 한 번에 저장합니다.
function changeTeamScores(indices, amount, undoKey = null) {
  syncFromStorage();
  if (!Number.isSafeInteger(amount) || !amount || !indices.length) return;
  const nextScores = indices.map(index => teams[index]?.score + amount);
  if (nextScores.some(score => !Number.isFinite(score) || score < minScore || score > maxScore)) return;
  const oldTotal = totalTeamScore();
  const newTotal = oldTotal + amount * indices.length;
  const oldCount = count;
  const classDiff = linkEnabled
    ? Math.floor(newTotal / linkPoints) - Math.floor(oldTotal / linkPoints) : 0;
  if (count + classDiff > maxScore || count + classDiff < minScore) return;

  recordScoreChange(undoKey);
  indices.forEach((index, position) => {
    const next = nextScores[position];
    teams[index].score = next;
    const numberEl = document.getElementById(`team-number-${index}`);
    if (numberEl) {
      renderTeamNumber(numberEl, next);
      numberEl.className = 'team-number ' + (amount > 0 ? 'team-increase' : 'team-decrease');
      setTimeout(() => { numberEl.className = 'team-number'; }, 200);
    }
    displayFloatingNumber(document.getElementById(`team-change-${index}`), amount, '20px', '10px');
  });
  count += classDiff;
  renderBatchControls();
  if (classDiff) checkForGoalAchievement('class', oldCount, count);
  checkForGoalAchievement('team', oldTotal, newTotal);
  const effect = {kind:'team',idx:indices[0],amount:amount*indices.length,classDiff,oldCount,oldTotal,newTotal,rate:linkEnabled?linkPoints:0};
  saveToStorage(effect);
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  queueScoreEffect(effect,true);
}

function resetConversion() {
  queuedConversions.length=0;
  conversionPlayer?.abort();
  conversionPlayer=null;
  progress.removeAttribute('data-converting');
  document.getElementById('class-conversion-delta')?.remove();
}

function waitForEffect(ms,signal) {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}

async function animateEffect(element,keyframes,options,signal) {
  signal.throwIfAborted();
  if(!element.animate){await waitForEffect(options.duration,signal);return;}
  const animation=element.animate(keyframes,options);
  const abort=()=>animation.cancel();
  signal.addEventListener('abort',abort,{once:true});
  try{await animation.finished;}
  finally{signal.removeEventListener('abort',abort);animation.cancel();}
}

function renderProgress(value,rate) {
  progress.style.setProperty('--filled',`${100*value/rate}%`);
  progress.setAttribute('aria-valuenow',value);
  progress.setAttribute('aria-valuetext',`${value}점 / ${rate}점`);
  conversionProgress.textContent=`${value} / ${rate}`;
}

async function moveProgress(from,to,rate,reduced,signal) {
  renderProgress(from,rate);
  if(!reduced && from!==to)await animateEffect(progress.firstElementChild,
    [{width:`${100*from/rate}%`},{width:`${100*to/rate}%`}],{duration:220,easing:'ease-out'},signal);
  renderProgress(to,rate);
}

async function sendStars(rate,direction,reduced,signal) {
  const bar=progress.getBoundingClientRect(), score=numberElement.getBoundingClientRect();
  if(reduced || !bar.width || !score.width){await waitForEffect(200,signal);return;}
  // The continuous bar (rates above 20) has no visual segments.
  const segments=rate<=20?rate:1;
  const target={x:score.left+score.width/2,y:score.top+score.height/2};
  const stars=Array.from({length:segments},async (_,index)=>{
    const start={x:bar.left+bar.width*(index+.5)/segments,y:bar.top+bar.height/2};
    const [from,to]=direction>0?[start,target]:[target,start];
    const node=document.createElement('span');
    node.className='score-conversion-star';
    node.textContent='★';
    node.setAttribute('aria-hidden','true');
    node.style.left=from.x+'px';node.style.top=from.y+'px';
    document.body.append(node);
    try{
      await animateEffect(node,[
        {transform:'translate(-50%, -50%) scale(.7)',opacity:0},
        {transform:'translate(-50%, -85%) scale(1.12)',opacity:1,offset:.22},
        {transform:`translate(calc(-50% + ${to.x-from.x}px), calc(-50% + ${to.y-from.y}px)) scale(.35)`,opacity:.8}
      ],{duration:420,delay:Math.min(70,260/Math.max(1,segments-1))*index,easing:'ease-in-out',fill:'both'},signal);
    }finally{node.remove();}
  });
  await Promise.all(stars);
}

async function showClassDelta(value,delta,audible,reduced,signal) {
  renderClassNumber(value);
  if(audible)playSound(delta>0?sounds.mainIncrease:sounds.mainDecrease);
  const label=document.createElement('span');
  label.id='class-conversion-delta';label.textContent=delta>0?'+1':'−1';
  label.setAttribute('aria-hidden','true');
  const {left,top,width}=numberElement.getBoundingClientRect();
  const labelX=Math.min(window.innerWidth-18,left+width+10);
  label.style.left=labelX+'px';
  label.style.top=top+'px';
  document.body.append(label);
  try{
    await Promise.all([
      reduced ? waitForEffect(340,signal) : animateEffect(label,[
        {opacity:1,transform:'translate(-50%, 0)'},
        {opacity:1,transform:'translate(-50%, -5px)',offset:.65},
        {opacity:0,transform:'translate(-50%, -10px)'}
      ],{duration:340,fill:'both'},signal),
      reduced ? Promise.resolve() : animateEffect(numberElement,[
        {transform:'scale(1)'},{transform:'scale(1.16)'},{transform:'scale(1)'}
      ],{duration:280},signal)
    ]);
  }finally{label.remove();}
}

function queueScoreEffect(effect,audible=false) {
  if(!['class','team'].includes(effect?.kind) || !Number.isSafeInteger(effect.oldCount)){
    resetConversion();renderClassNumber(count);updateScoreProgress();return;
  }
  queuedConversions.push({effect,audible});
  if(conversionPlayer)return;
  const player=new AbortController();
  conversionPlayer=player;
  const {signal}=player;
  void (async()=>{
    try{
      while(queuedConversions.length){
        const {effect:next,audible}=queuedConversions.shift();
        const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        let visibleCount=next.oldCount;
        if(next.kind==='class'){
          await showClassDelta(visibleCount+next.classDiff,next.classDiff,audible,reduced,signal);
          continue;
        }
        if(!next.rate)continue;
        for(const step of conversionSteps(next.oldTotal,next.newTotal,next.rate)){
          await moveProgress(step.from,step.to,next.rate,reduced,signal);
          if(!step.delta)continue;
          progress.setAttribute('data-converting','');
          await waitForEffect(300,signal);
          await sendStars(next.rate,step.delta,reduced,signal);
          progress.removeAttribute('data-converting');
          renderProgress(step.rest,next.rate);
          visibleCount+=step.delta;
          await showClassDelta(visibleCount,step.delta,audible,reduced,signal);
        }
      }
    }catch(error){
      if(!signal.aborted){
        queuedConversions.length=0;
        console.error('점수 환산 연출 실패:',error);
      }
    }finally{
      if(conversionPlayer===player){
        conversionPlayer=null;
        progress.removeAttribute('data-converting');
        renderClassNumber(count);updateScoreProgress();
      }
    }
  })();
}

function openManagementModal() {
  setSettingsOpen(false);
  syncFromStorage();
  document.getElementById('manage-main-score').value = count;
  const list = document.getElementById('team-management-list'); list.innerHTML = '';
  teams.forEach(team => {
    const item = document.createElement('div'); item.className = 'team-manage-item';
    item.innerHTML = '<input type="text" class="manage-input manage-name" maxlength="20"> <input type="number" class="manage-input manage-score"> <button type="button" class="delete-team-btn" aria-label="모둠 삭제">삭제</button>';
    item.querySelector('.manage-name').value = team.name;
    item.querySelector('.manage-score').value = team.score;
    list.appendChild(item);
  });
  managementModal.style.display = 'flex';
}
function closeAndSaveManagement() {
  syncFromStorage();
  const oldCount = count;
  const oldTotal = totalTeamScore();
  const newMain = parseInt(document.getElementById('manage-main-score').value, 10);
  const nextCount = Number.isNaN(newMain) ? count : Math.max(minScore, Math.min(newMain, maxScore));
  const newTeams = [];
  document.querySelectorAll('#team-management-list .team-manage-item').forEach(item => {
    let score = parseInt(item.querySelector('.manage-score').value, 10) || 0;
    newTeams.push({
      name: item.querySelector('.manage-name').value.trim() || `모둠 ${newTeams.length + 1}`,
      score: Math.max(minScore, Math.min(score, maxScore))
    });
  });
  const sameTeams = newTeams.length === teams.length && newTeams.every((team, index) => team.name === teams[index].name);
  if (!sameTeams) {
    lastScoreChange = null;
    selectedTeams.clear();
  } else if (nextCount !== count || newTeams.some((team, index) => team.score !== teams[index].score)) {
    recordScoreChange();
  }
  resetConversion();
  count = nextCount;
  teams = newTeams;
  renderClassNumber(count);
  checkForGoalAchievement('class',oldCount,count);
  checkForGoalAchievement('team', oldTotal, totalTeamScore());
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
  item.innerHTML = '<input type="text" class="manage-input manage-name" maxlength="20"> <input type="number" class="manage-input manage-score" value="0"> <button type="button" class="delete-team-btn" aria-label="모둠 삭제">삭제</button>';
  item.querySelector('.manage-name').value = `모둠 ${list.children.length + 1}`;
  list.appendChild(item); item.querySelector('.manage-name').focus();
});

function openGoalManagementView() {
  setSettingsOpen(false);
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
  lastScoreChange = null;
  renderBatchControls();
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
goalManagementView.querySelectorAll('.add-row-btn').forEach(btn => {
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
    if (lastScoreChange) lastScoreChange.activeGoalRef = null;
    hideGoalPanel();
  }
});
document.getElementById('goal-close-btn').addEventListener('click', () => {
  if (lastScoreChange) lastScoreChange.activeGoalRef = null;
  hideGoalPanel();
});
function showGoalAlert(message) {
  document.getElementById('goal-alert-message').textContent = message;
  goalAlert.classList.add('show'); playSound(sounds.success);
  setTimeout(() => goalAlert.classList.remove('show'), 4000);
}
function validLinkPoints(value) { return Number.isSafeInteger(value) && value >= 1; }
function renderLinkSettings() {
  linkMode.checked = linkEnabled;
  linkInput.value = linkPoints;
  linkRule.hidden = !linkEnabled;
}
function updateScoreProgress() {
  const remainder = scoreRemainder(totalTeamScore(),linkPoints);
  progress.hidden = !linkEnabled;
  progress.style.setProperty('--division', `${100 / linkPoints}%`);
  progress.toggleAttribute('data-continuous', linkPoints === 1 || linkPoints > 20);
  progress.setAttribute('aria-valuemax', linkPoints);
  if(linkEnabled)renderProgress(remainder,linkPoints);
  else conversionProgress.textContent='';
  conversionRule.textContent = linkEnabled ? `모둠 ${linkPoints}점 = 학급 1점` : '점수 연동 안 함';
}
function setScoreLink(enabled, points) {
  syncFromStorage();
  if (!validLinkPoints(points)) {
    renderLinkSettings();
    return;
  }
  if (enabled === linkEnabled && points === linkPoints) return;
  resetConversion();
  linkEnabled = enabled;
  linkPoints = points;
  renderClassNumber(count);
  if (lastScoreChange) lastScoreChange.key = null;
  renderLinkSettings();
  updateScoreProgress();
  saveToStorage();
}
linkMode.onchange = () => setScoreLink(linkMode.checked, linkPoints);
linkInput.onchange = () => setScoreLink(linkEnabled, linkInput.valueAsNumber);
selectAllButton.onclick = () => {
  syncFromStorage();
  if (selectedTeams.size) selectedTeams.clear();
  else teams.forEach((_, index) => selectedTeams.add(index));
  renderBatchControls();
};
const scoreBackground = '.container, #display-area, #top-row, #class-area, .main-scoreboard, #bottom-row, #team-viewport, #scoreboard, #batch-score';
document.querySelector('.container').addEventListener('click', event => {
  if (!selectedTeams.size || !event.target.matches(scoreBackground)) return;
  selectedTeams.clear();
  renderBatchControls();
});
undoButton.onclick = undoScore;
batchDelta.oninput = updateBatchButton;
document.getElementById('batch-reset').onclick=()=>{
  batchDelta.value='0';updateBatchButton();batchDelta.focus();
};
for (const [id, delta] of [['batch-up', 1], ['batch-down', -1]]) {
  document.getElementById(id).onclick = () => {
    batchDelta.value = (batchDelta.valueAsNumber || 0) + delta;
    updateBatchButton();
  };
}
batchForm.onsubmit = event => {
  event.preventDefault();
  syncFromStorage();
  const indices=[...selectedTeams].sort((a,b)=>a-b);
  const amount=batchDelta.valueAsNumber;
  changeTeamScores(indices,amount,`batch:${indices.join(',')}:${amount}`);
};

document.getElementById('main-increase-btn').onclick = increment;
document.getElementById('main-decrease-btn').onclick = decrement;
document.getElementById('reset-main-btn').onclick = () => {
  document.getElementById('manage-main-score').value = 0;
};
document.getElementById('reset-teams-btn').onclick = () => {
  managementModal.querySelectorAll('.manage-score').forEach(input => { input.value = 0; });
};
document.getElementById('open-management-modal-btn').onclick = openManagementModal;
document.getElementById('save-management-btn').onclick = closeAndSaveManagement;
document.getElementById('close-management-btn').onclick = closeManagementModal;
document.getElementById('open-goal-modal-btn').onclick = openGoalManagementView;
document.getElementById('close-goal-view-btn').onclick = closeAndSaveGoalManagementView;
function setSettingsOpen(open) {
  settingsPanel.classList.toggle('open', open);
  settingsPanel.inert = !open;
  settingsToggleBtn.setAttribute('aria-expanded', String(open));
}
settingsToggleBtn.onclick = () => setSettingsOpen(settingsPanel.inert);
document.addEventListener('pointerdown', event => {
  if (!settingsPanel.inert && !settingsPanel.contains(event.target) && !settingsToggleBtn.contains(event.target)) {
    setSettingsOpen(false);
  }
});
// 활성 탭 단축키: 1~9, 0은 모둠 1~10; Shift+숫자는 -1; 위/아래는 학급 ±1.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !settingsPanel.inert) {
    setSettingsOpen(false);
    settingsToggleBtn.focus();
    return;
  }
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
window.addEventListener('load', () => {
  loadFromStorage();
  renderCurrentState();
  initialized = true;
  syncFromStorage();
});

document.getElementById('create-teams-btn').onclick=showTeamSetupModal;
document.getElementById('cancel-team-setup').onclick=hideTeamSetupModal;
document.getElementById('confirm-team-setup').onclick=createTeams;

document.getElementById('close-team-setup').onclick=hideTeamSetupModal;
document.getElementById('close-management-dialog').onclick=closeManagementModal;
const hideGoalManagement=()=>{goalManagementView.style.display='none';};
document.getElementById('cancel-goal-view').onclick=hideGoalManagement;
document.getElementById('cancel-goal-edit').onclick=hideGoalManagement;
