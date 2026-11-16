import {fieldConflictOptions,scoreDeltaBasis,scorePatch} from '../js/score-conflicts.js';
import {freshGoals,readGoals,changeGoals,reconcileGoals,completeReachedAutomaticGoals} from './goal-model.js?v=conflict-fields-1';
import {wireGoals} from './goals-ui.js?v=conflict-fields-1';
import {wireScoreAudio} from './score-audio.js';
import {conversionFrame,conversionStarFlight,mergeTeamEffects,scoreRemainder} from './score-display.js?v=star-flight-1';

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
const playSound = wireScoreAudio();

let count = 0;
let displayedClassScore = 0;
let teams = [];
let goalSystem = freshGoals(), localBaseline;
const step = 1, minScore = -10000, maxScore = 10000;
const defaultLinkPoints = 3;
const undoWindow = 2000;
let conversionPlayer=null;
let classFeedback=new AbortController();
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
let sharedMode = false, sharedScore = null, sharedSend, sharedNotice, managementBase;
let scoreGroup, migrationSnapshot, deviceNames=new Map(), conflictViewKey;
const sharedBanner = document.getElementById('shared-score-banner');
const sharedMessage = document.getElementById('shared-score-message');
const conflictsButton = document.getElementById('score-conflicts');
const conflictsDialog = document.getElementById('score-conflict-dialog');
const bodyControls = document.querySelector('.container');
const goalUI = wireGoals({
  submit:submitGoal,teamList:()=>teams,classScore:()=>count,celebrate:()=>playSound(sounds.success),confirmSave:()=>playSound(sounds.confirm),
  teamAccent(id) {
    const index=teams.findIndex(team=>team.id===id), card=scoreboard.children[index];
    return card ? getComputedStyle(card).getPropertyValue('--card-accent').trim() : null;
  }
});
const ownScoreEvents = new Set();
function submitGoal(operation) {
  if (sharedMode) return sendScore(operation);
  syncFromStorage();
  const previous=goalSystem;
  goalSystem=readGoals(previous);
  if (changeGoals({count,teams,goalSystem}, {...operation,key:crypto.randomUUID(),authoredAt:Date.now()}) && saveToStorage()) {
    renderCurrentState();
    return true;
  }
  goalSystem=previous;
  renderCurrentState();
  return false;
}
function speakEffect(effect) {
  if (effect?.kind==='team') playSound(effect.amount>0?sounds.teamIncrease:sounds.teamDecrease);
  if (effect?.classDiff) playSound(effect.classDiff>0?sounds.mainIncrease:sounds.mainDecrease);
}

function applySharedScore(model,live) {
  const previous = sharedScore;
  sharedScore = model;
  bodyControls.inert = !model;
  const conflicts=model?fieldConflictOptions(model):[];
  sharedBanner.hidden = !!model && !conflicts.length && !model.notice;
  sharedMessage.textContent = model?.notice?.text || (model ? '' : '공유 점수판을 불러오는 중입니다. 기존 칠판은 교실 PC에서 공유 점수를 시작해 주세요.');
  conflictsButton.hidden = !conflicts.length;
  if (conflicts.length) conflictsButton.textContent = '점수 충돌 확인 ('+conflicts.length+')';
  if (conflictsDialog.open) drawConflicts(conflicts);
  if (!model) {
    applyStateFields({});
    renderCurrentState();
    return;
  }
  if (live && previous) {
    const seen = new Set((previous.sounds || []).map(item=>item.key));
    for (const item of model.sounds || []) if (!seen.has(item.key) && !ownScoreEvents.has(item.key)) speakEffect(item.effect);
  }
  if (teams.length !== model.state.teams.length || teams.some((team,index)=>team.id !== model.state.teams[index].id)) selectedTeams.clear();
  const {goalSystem: nextGoals, ...nextScores} = model.state;
  const {goalSystem: currentGoals, ...currentScores} = snapshot(undefined);
  const announce = live || ownScoreEvents.has(model.version);
  if (JSON.stringify(currentScores) === JSON.stringify(nextScores)) {
    // The local click already queued its score effect. Apply the synced goal records without interrupting it.
    if (JSON.stringify(currentGoals) !== JSON.stringify(nextGoals)) {
      goalSystem = readGoals(nextGoals);
      completeReachedAutomaticGoals({count,teams,goalSystem});
      renderGoalFeedback(announce);
    }
    renderBatchControls();
    return;
  }
  const effect = previous && previous.version !== model.version && model.effect?.oldCount === count
    && (model.effect.kind !== 'team' || model.effect.oldTotal === totalTeamScore()) ? model.effect : null;
  applyStateFields(structuredClone(model.state));
  renderCurrentState(effect,announce);

}

window.whiteboardScore = {
  localSnapshot: () => initialized
    ? structuredClone(sharedMode ? readStoredState() || migrationSnapshot : snapshot(undefined)) : null,
  receive({shared, model, send, notice, live, deviceNames:registered}) {
    sharedSend = send;
    sharedNotice = notice;
    deviceNames=new Map((registered||[]).map(({id,label})=>[id,label]));
    if (shared) {
      if (!sharedMode) {
        migrationSnapshot = structuredClone(snapshot(undefined));
        goalUI.reset();ownScoreEvents.clear();
        selectedTeams.clear();
        lastScoreChange = null;
        scoreGroup = null;
      }
      sharedMode = true;
      applySharedScore(model,live);
    } else if (sharedMode) {
      goalUI.reset();ownScoreEvents.clear();
      sharedMode = false;
      sharedScore = null;
      if (conflictsDialog.open) conflictsDialog.close();
      bodyControls.inert = false;
      sharedBanner.hidden = true;
      lastScoreChange = null;
      selectedTeams.clear();
      loadFromStorage();
      renderCurrentState();
    }
  },
  saveLocal(model) {
    const state = {...structuredClone(model),version:tabId + ':' + (++serial),effect:null};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if (!sharedMode) syncFromStorage(state);
  }
};

function sendScore(operation) {
  if (!sharedScore || !sharedSend) return;
  const key = crypto.randomUUID();
  ownScoreEvents.add(key);
  if (ownScoreEvents.size>128) ownScoreEvents.delete(ownScoreEvents.values().next().value);
  return sharedSend({...operation,key,authoredAt:Date.now()});
}
function sharedDelta(amount, targets = null) {
  const signature = JSON.stringify([amount,targets]), now = performance.now();
  if (scoreGroup?.signature !== signature || now-scoreGroup.time > undoWindow) {
    scoreGroup = {id:crypto.randomUUID(),signature};
  }
  scoreGroup.time = now;
  sendScore({kind:'score-delta',amount,targets,group:scoreGroup.id,fieldBasis:scoreDeltaBasis(sharedScore)});
}
function drawConflicts(conflicts) {
  if (!conflicts.length) {
    if (conflictsDialog.open) conflictsDialog.close();
    return;
  }
  const key=JSON.stringify([conflicts,[...deviceNames]]);
  if (key===conflictViewKey) return;
  conflictViewKey=key;
  const container=document.getElementById('score-conflict-fields');
  container.replaceChildren(...conflicts.map(conflict=>{
    const group=document.createElement('fieldset');
    group.className='score-conflict-field';
    const title=document.createElement('legend');
    title.textContent=conflict.label;
    group.append(title);
    const choices=[{value:conflict.server,label:'서버 값'},...conflict.candidates.map(({value,devices})=>({
      value,label:devices.map(device=>deviceNames.get(device.id)||device.label||'다른 기기').join(' · ')
    }))];
    for (const {value,label} of choices) {
      const control=document.createElement('button');
      control.type='button';control.className='dialog-action';
      control.textContent=label+' · '+value+'점';
      control.onclick=async()=>{
        control.disabled=true;
        await sendScore({kind:'score-field-choice',field:conflict.field,stamp:conflict.stamp,value});
        control.disabled=false;
      };
      group.append(control);
    }
    return group;
  }));
}
conflictsButton.onclick=()=>{
  const conflicts=sharedScore?fieldConflictOptions(sharedScore):[];
  if (!conflicts.length) return;
  drawConflicts(conflicts);
  if (!conflictsDialog.open) conflictsDialog.showModal();
};

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
    if (!state.goalSystem) {
      try {
        localStorage.setItem(STORAGE_KEY,JSON.stringify({...snapshot(state.version),effect:null}));
      } catch (error) {console.error('목표 설정 초기화 실패:',error);}
    }
    return;
  }
  // 과거 버전의 네 개 저장 키를 처음 열 때 가져옵니다.
  try {
    count = parseInt(localStorage.getItem('mainScore'), 10) || 0;
    teams = JSON.parse(localStorage.getItem('teams')) || [];
    teams = normalizeTeams(teams);
  } catch (error) {
    console.error('기존 저장 데이터 읽기 실패:', error);
    count = 0; teams = [];
  }
  goalSystem = freshGoals();
  try {
    localStorage.removeItem('classGoals');
    localStorage.removeItem('teamGoals');
  } catch {}
}
function normalizeTeams(value) {
  return (Array.isArray(value)?value:[]).map((team,index)=>({...team,id:team.id||'legacy-team:'+index}));
}
function applyStateFields(state) {
  count = Number.isFinite(state.count) ? state.count : 0;
  teams = normalizeTeams(state.teams);
  goalSystem = readGoals(state.goalSystem);
  completeReachedAutomaticGoals({count,teams,goalSystem});
  localBaseline = {count,teams:structuredClone(teams)};
  linkEnabled = state.scoreLink?.enabled !== false;
  linkPoints = validLinkPoints(state.scoreLink?.points) ? state.scoreLink.points : defaultLinkPoints;
}
function snapshot(version) {
  return {
    version, count, teams, goalSystem,
    scoreLink: { enabled: linkEnabled, points: linkPoints }
  };
}
function renderGoalFeedback(announce) {
  goalUI.update(goalSystem,announce);
  goalUI.giftGroup(document.getElementById('class-goal-gifts'));
  for (const gift of document.querySelectorAll('[data-team-gifts]')) goalUI.giftGroup(gift,gift.dataset.teamGifts);
}
function saveToStorage(effect = null, base = sharedScore?.state) {
  if (sharedMode) {
    if (!sharedScore) return;
    if (effect) sharedDelta(effect.inputAmount ?? effect.classDiff,effect.targets);
    else {
      scoreGroup = null;
      const patch=scorePatch(base,snapshot(undefined));
      if (patch.numbers.length || patch.renamed.length || patch.added.length || patch.removed.length || patch.link) {
        sendScore({kind:'score-patch',patch});
      }
    }
    return;
  }
  const version = tabId + ':' + (++serial);
  reconcileGoals({count,teams,goalSystem},localBaseline||{count,teams},{key:version,authoredAt:Date.now()});
  localBaseline={count,teams:structuredClone(teams)};
  renderGoalFeedback(true);
  const state = {...snapshot(version),effect};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastAppliedVersion = version;
    return true;
  } catch (error) {
    console.error('상태 저장 실패:', error);
    // 저장에 실패했다면 다른 탭에 성공한 것처럼 알리지 않습니다.
    return;
  }
}
function syncFromStorage(state = readStoredState()) {
  if (sharedMode || !state || !state.version || state.version === lastAppliedVersion) return;
  const remoteTeams = Array.isArray(state.teams) ? state.teams : [];
  if (teams.length !== remoteTeams.length || teams.some((team, index) => team.name !== remoteTeams[index].name)) {
    selectedTeams.clear();
  }
  lastScoreChange = null;
  applyStateFields(state);
  lastAppliedVersion = state.version;
  renderCurrentState(state.effect, true);
  speakEffect(state.effect);
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

function renderCurrentState(effect,announce=false) {
  if(!effect){resetConversion();renderClassNumber(count);}
  renderLinkSettings();
  goalUI.update(goalSystem,announce);
  goalUI.giftGroup(document.getElementById('class-goal-gifts'));
  renderTeams();
  if(effect)presentScoreEffect(effect);
  else updateScoreProgress();
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
  displayedClassScore=score;
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
  lastScoreChange = { key, time: now, count, scores: teams.map(team => team.score) };
}
function undoScore() {
  if (sharedMode) {
    scoreGroup = null;
    sendScore({kind:'score-undo',base:sharedScore?.version});
    return;
  }
  syncFromStorage();
  if (!lastScoreChange) return;
  const previous = lastScoreChange;
  lastScoreChange = null;
  count = previous.count;
  teams.forEach((team, index) => { team.score = previous.scores[index]; });
  numberElement.className = '';
  renderCurrentState();
  saveToStorage();
}
function changeClassScore(amount) {
  syncFromStorage();
  const next = count + amount;
  if (next < minScore || next > maxScore || sharedMode && !sharedScore) return;
  recordScoreChange(`class:${amount}`);
  const old = count;
  count = next;
  const effect={kind:'class',oldCount:old,classDiff:amount};
  presentScoreEffect(effect,true);
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
  for (let i = 0; i < n; i++) teams.push({ id:crypto.randomUUID(), name: `모둠 ${teams.length + 1}`, score: 0 });
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
    const gifts=document.createElement('div');
    gifts.className='team-goal-gifts';gifts.dataset.teamGifts=team.id;
    goalUI.giftGroup(gifts,team.id);card.appendChild(gifts);
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
    remove.onclick=async()=>{
      const name=team.name;
      const version=sharedMode ? sharedScore?.version : lastAppliedVersion;
      if(!await confirmTeamDelete(name))return;
      syncFromStorage();
      if((sharedMode ? sharedScore?.version : lastAppliedVersion)!==version || teams[idx]?.name!==name) {
        if (sharedMode) sharedNotice?.('점수가 변경되었습니다. 모둠 삭제를 다시 선택해 주세요.');
        return;
      }
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
function confirmTeamDelete(name) {
  const dialog=document.getElementById('team-delete-dialog');
  if(dialog.open)return Promise.resolve(false);
  document.getElementById('team-delete-message').textContent=`“${name}” 모둠을 삭제할까요?`;
  dialog.returnValue='cancel';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});
    dialog.showModal();
  });
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
  const canUndo = sharedMode ? !!sharedScore?.undo : !!lastScoreChange;
  batchForm.hidden = teams.length === 0 && !canUndo;
  selectAllButton.textContent = selectedTeams.size ? '전체해제' : '전체선택';
  selectAllButton.disabled = !teams.length;
  const targetCount = selectedTeams.size;
  selectedTeamCount.textContent = targetCount ? `${targetCount}모둠 선택` : '';
  applyBatchButton.setAttribute('aria-label', targetCount ? `${targetCount}모둠에 반영` : '반영');
  updateBatchButton();
  undoButton.disabled = !canUndo;
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
  const effect = {kind:'team',idx:indices[0],amount:amount*indices.length,classDiff,oldCount,oldTotal,newTotal,rate:linkEnabled?linkPoints:0};
  saveToStorage({...effect,inputAmount:amount,targets:indices.map(index=>teams[index].id)});
  playSound(amount > 0 ? sounds.teamIncrease : sounds.teamDecrease);
  presentScoreEffect(effect,true);
}

function resetConversion() {
  queuedConversions.length=0;
  conversionPlayer?.abort();
  conversionPlayer=null;
  progress.removeAttribute('data-converting');
  classFeedback.abort();
  classFeedback=new AbortController();
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
  const duration=options.duration+(options.delay||0);
  if(!element.animate){await waitForEffect(duration,signal);return;}
  let animation;
  try{animation=element.animate(keyframes,options);}
  catch(error){
    console.warn('점수 효과를 간소화합니다:',error);
    await waitForEffect(duration,signal);
    return;
  }
  const abort=()=>animation.cancel();
  signal.addEventListener('abort',abort,{once:true});
  try{await animation.finished;}
  finally{signal.removeEventListener('abort',abort);animation.cancel();}
}

function renderProgress(value,rate) {
  progress.style.setProperty('--filled',String(value/rate));
  progress.setAttribute('aria-valuenow',value);
  progress.setAttribute('aria-valuetext',`${value}점 / ${rate}점`);
  conversionProgress.textContent=`${value} / ${rate}`;
}

async function moveProgress(from,to,rate,reduced,signal) {
  renderProgress(from,rate);
  if(!reduced && from!==to)await animateEffect(progress.firstElementChild,
    [{transform:`scaleX(${from/rate})`},{transform:`scaleX(${to/rate})`}],{duration:340,easing:'ease-in-out'},signal);
  renderProgress(to,rate);
}

async function sendStars(rate,direction,reduced,signal) {
  const bar=progress.getBoundingClientRect();
  if(!bar.width){await waitForEffect(200,signal);return;}
  const score=numberElement.getBoundingClientRect();
  // Continuous bars do not draw individual divisions.
  const segments=rate<=20?rate:1;
  await Promise.all(Array.from({length:segments},async (_,index)=>{
    const {from,frames}=conversionStarFlight(bar,score,index,segments,direction<0);
    const node=document.createElement('span');
    node.className='score-conversion-star';
    node.textContent='★';
    node.setAttribute('aria-hidden','true');
    node.style.left=from.x+'px';node.style.top=from.y+'px';
    document.body.append(node);
    try{
      if(reduced){await waitForEffect(360,signal);return;}
      await animateEffect(node,frames,
        {duration:680,delay:Math.min(55,220/Math.max(1,segments-1))*index,easing:'ease-in-out',fill:'both'},signal);
    }finally{node.remove();}
  }));
}

function showClassDelta(delta,audible,reduced) {
  renderClassNumber(displayedClassScore+delta);
  if(audible)playSound(delta>0?sounds.mainIncrease:sounds.mainDecrease);
  const label=document.createElement('span');
  label.className=delta>0?'class-score-delta gain':'class-score-delta loss';
  label.textContent=(delta>0?'+':'−')+Math.abs(delta);
  label.setAttribute('aria-hidden','true');
  const {left,top,width}=numberElement.getBoundingClientRect();
  label.style.left=(left+width/2)+'px';
  label.style.top=Math.max(0,top-12)+'px';
  document.body.append(label);
  const {signal}=classFeedback;
  const color=getComputedStyle(label).color;
  const baseColor=getComputedStyle(numberElement).color;
  void Promise.all([
    reduced ? waitForEffect(600,signal) : animateEffect(label,[
      {opacity:1,transform:'translate(0, 0)'},
      {opacity:1,transform:'translate(0, 0)',offset:.55},
      {opacity:0,transform:'translate(0, -20px)'}
    ],{duration:750,fill:'both'},signal),
    reduced ? Promise.resolve() : animateEffect(numberElement,[
      {transform:'scale(1)',color},{transform:'scale(1.2)',color},{transform:'scale(1)',color:baseColor}
    ],{duration:200},signal)
  ]).catch(error=>{
    if(!signal.aborted)console.warn('점수 증감 효과 재생 실패:',error);
  }).finally(()=>label.remove());
}

function collectPendingConversions(group) {
  for(let next=queuedConversions[0];next;next=queuedConversions[0]){
    const merged=mergeTeamEffects(group.effect,next.effect);
    if(!merged)break;
    queuedConversions.shift();
    group={effect:merged,audible:group.audible||next.audible};
  }
  return group;
}

function presentScoreEffect(effect,audible=false) {
  if(!['class','team'].includes(effect?.kind) || !Number.isSafeInteger(effect.oldCount)){
    resetConversion();renderClassNumber(count);updateScoreProgress();return;
  }
  if(effect.kind==='class'){
    showClassDelta(effect.classDiff,audible,window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    return;
  }
  queuedConversions.push({effect,audible});
  if(conversionPlayer)return;
  const player=new AbortController();
  conversionPlayer=player;
  const {signal}=player;
  void (async()=>{
    try{
      while(queuedConversions.length){
        let group=queuedConversions.shift();
        const rate=group.effect.rate;
        if(!rate)continue;
        // A brief collection window lets rapid button presses share one visual update.
        await waitForEffect(120,signal);
        group=collectPendingConversions(group);
        let frame=conversionFrame(group.effect.oldTotal,group.effect.newTotal,rate);
        const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        await moveProgress(frame.from,frame.to,rate,reduced,signal);
        if(!frame.delta)continue;
        progress.setAttribute('data-converting','');
        await waitForEffect(300,signal);
        await sendStars(rate,frame.delta,reduced,signal);
        // Include same-direction input received during the star animation.
        group=collectPendingConversions(group);
        frame=conversionFrame(group.effect.oldTotal,group.effect.newTotal,rate);
        progress.removeAttribute('data-converting');
        showClassDelta(frame.delta,group.audible,reduced);
        if(frame.delta<0)await moveProgress(rate,frame.rest,rate,reduced,signal);
        else if(frame.rest)await moveProgress(0,frame.rest,rate,reduced,signal);
        else renderProgress(0,rate);
        await waitForEffect(320,signal);
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
  managementBase = sharedMode ? structuredClone(sharedScore.state) : undefined;
  document.getElementById('manage-main-score').value = count;
  const list = document.getElementById('team-management-list'); list.innerHTML = '';
  teams.forEach(team => {
    const item = document.createElement('div'); item.className = 'team-manage-item';
    item.innerHTML = '<input type="text" class="manage-input manage-name" maxlength="20"> <input type="number" class="manage-input manage-score"> <button type="button" class="delete-team-btn" aria-label="모둠 삭제">삭제</button>';
    if (team.id) item.dataset.teamId = team.id;
    item.querySelector('.manage-name').value = team.name;
    item.querySelector('.manage-score').value = team.score;
    list.appendChild(item);
  });
  managementModal.style.display = 'flex';
  scoreModalState(true);
  document.getElementById('manage-main-score').focus();
}
function closeAndSaveManagement() {
  syncFromStorage();
  const newMain = parseInt(document.getElementById('manage-main-score').value, 10);
  const nextCount = Number.isNaN(newMain) ? managementBase?.count??count : Math.max(minScore, Math.min(newMain, maxScore));
  const newTeams = [];
  document.querySelectorAll('#team-management-list .team-manage-item').forEach(item => {
    let score = parseInt(item.querySelector('.manage-score').value, 10) || 0;
    newTeams.push({
      id:item.dataset.teamId || crypto.randomUUID(),
      name: item.querySelector('.manage-name').value.trim() || `모둠 ${newTeams.length + 1}`,
      score: Math.max(minScore, Math.min(score, maxScore))
    });
  });
  if (sharedMode && nextCount === count && JSON.stringify(newTeams) === JSON.stringify(teams)) {
    closeManagementModal();
    return;
  }
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
  renderTeams(); saveToStorage(null,managementBase);
  closeManagementModal(); playSound(sounds.confirm);
}
function scoreModalState(open) {
  document.body.classList.toggle('score-modal-open',open);
  window.frameElement?.dispatchEvent(new CustomEvent('score-management-modal',{detail:open}));
}
function closeManagementModal() {
  managementModal.style.display = 'none';
  scoreModalState(false);
}
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
document.getElementById('open-goal-modal-btn').onclick = ()=>{setSettingsOpen(false);syncFromStorage();goalUI.openSettings();};
function setSettingsOpen(open) {
  settingsPanel.classList.toggle('open', open);
  settingsPanel.inert = !open;
  settingsToggleBtn.setAttribute('aria-expanded', String(open));
}
settingsToggleBtn.onclick = () => setSettingsOpen(settingsPanel.inert);
document.getElementById('close-score-settings').onclick=()=>{setSettingsOpen(false);settingsToggleBtn.focus();};
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
  if (document.getElementById('team-delete-dialog').open || getComputedStyle(teamSetupModal).display !== 'none' ||
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
  localBaseline={count,teams:structuredClone(teams)};
  renderCurrentState();
  initialized = true;
  syncFromStorage();
  if (window.parent !== window) window.frameElement?.dispatchEvent(new Event('score-sync-ready'));
});

document.getElementById('create-teams-btn').onclick=showTeamSetupModal;
document.getElementById('cancel-team-setup').onclick=hideTeamSetupModal;
document.getElementById('confirm-team-setup').onclick=createTeams;

document.getElementById('close-team-setup').onclick=hideTeamSetupModal;
document.getElementById('close-management-dialog').onclick=closeManagementModal;

const maximizeScore = document.getElementById('score-maximize');
maximizeScore.hidden = !window.frameElement;
maximizeScore.onclick = ()=>window.frameElement?.dispatchEvent(new Event('score-toggle-full'));
function setMaximizeState(full) {
  const label=full?'분할 화면으로 돌아가기':'전체 화면';
  maximizeScore.setAttribute('aria-pressed',String(full));
  maximizeScore.setAttribute('aria-label',label);
  maximizeScore.title=label;
}
window.frameElement?.addEventListener('score-full-changed',event=>setMaximizeState(event.detail));
setMaximizeState(window.frameElement?.dataset.scoreFull==='true');

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel',event=>event.preventDefault());
}
