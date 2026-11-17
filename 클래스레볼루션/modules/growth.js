import { animatedAvatar, stillAvatar } from '../core/avatar.js';
import { getRecord, putRecord, requestResult, transact } from '../core/db.js';
import { PATH_LENGTH, sumDeductions } from '../core/growth-path.js';
import { escapeHtml } from '../core/text.js';
import { mountScoreComposer } from '../core/score-composer.js';
import { loadRoster } from '../core/roster.js';

const POSITIONS = [
  [79.6, 26.0], [61.1, 19.4], [42.6, 26.0], [24.0, 19.4], [7.4, 41.3],
  [19.0, 70.4], [37.5, 77.1], [56.0, 70.4], [74.6, 77.1], [91.9, 75.2]
];
const ENTRY_POSITION = [94, 25];
const EMPTY_STATE = { classScore: 0, pending: [], totalContributions: 0, totalDeductions: 0 };

async function readBoard(classId) {
  return transact(['growthStates', 'classes', 'scoreEvents'], 'readonly', async function (transaction) {
    const [saved, classroom] = await Promise.all([
      requestResult(transaction.objectStore('growthStates').get(classId)),
      requestResult(transaction.objectStore('classes').get(classId))
    ]);
    const state = { ...EMPTY_STATE, ...saved };
    if (!Number.isFinite(saved?.totalDeductions)) {
      state.totalDeductions = sumDeductions(await requestResult(
        transaction.objectStore('scoreEvents').index('classId').getAll(classId)
      ));
    }
    state.pending = Array.isArray(state.pending) ? state.pending.slice(0, PATH_LENGTH - 1) : [];
    return { state, className: classroom?.name || '우리 반', goals: Array.isArray(classroom?.goals) ? classroom.goals.filter(g => g && Number.isFinite(Number(g.points))) : [] };
  });
}

function actor(contribution, index, effect) {
  if (!contribution) return '';
  const [x, y] = POSITIONS[index];
  const [previousX, previousY] = POSITIONS[index - 1] || ENTRY_POSITION;
  const direction = effect.step === 'retreat' && effect.index === index ? ' is-leaving' :
    effect.step === 'arrive' && effect.index === index ? ' is-arriving' :
    effect.step === 'open' ? ' is-restored' : '';
  const name = contribution.studentName || '';
  const portrait = name
    ? (effect.step === 'arrive' && !effect.penalty ? animatedAvatar(contribution.avatarId) : stillAvatar(contribution.avatarId))
    : '<span class="growth-archived-star" aria-label="이전 별">★</span>';
  const opening = effect.step === 'open';
  const [fromX, fromY] = opening ? POSITIONS[PATH_LENGTH - 1] : [previousX, previousY];
  return '<div class="growth-actor' + direction + '" style="left:' + x + '%;top:' + y +
    '%;--shift-x:' + (fromX - x) + 'cqw;--shift-y:' + (fromY - y) * .44 +
    'cqw;--pace:' + (effect.pace || 1) + '">' + portrait + (name ? '<span class="growth-actor-name">' + escapeHtml(name) + '</span>' : '') + '</div>';
}

export function mountGrowth(root, { classId, bus }) {
  root.innerHTML = '<div class="growth-scene-host"></div><dialog class="student-dialog growth-settings"></dialog>';
  const scene = root.querySelector('.growth-scene-host');
  const settings = root.querySelector('.growth-settings');
  const composer = mountScoreComposer(root, { classId, bus });
  let goals = [];
  let className = '우리 반';
  let requested = 0;
  let generation = 0;
  let newestRevision = 0;
  let playing = false;
  const queue = [];
  const visible = () => document.body.dataset.classroomMode === 'growth';
  const popupOpen = () => Boolean(document.querySelector('#global-feedback .score-feedback-detail'));
  const smallMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(frame, effect = {}) {
    const marker = frame.pending.length;
    const eggs = Number(frame.classScore) || 0;
    const reward = effect.step === 'earn'
      ? '<div class="growth-egg-celebration"><span class="score-wings" aria-hidden="true"></span><span class="growth-egg-art" aria-hidden="true"></span>' +
        '<strong>황금알 ' + (effect.eggs || 1) + '개를 얻었어요!</strong></div>' : '';
    const nextGoal = goals.filter(g => Number(g.points) > eggs).sort((a,b) => a.points - b.points)[0];
    scene.innerHTML = '<section class="growth-world" aria-label="학급점수판"><div class="growth-sky">' +
      '<button type="button" data-growth="settings" class="growth-class-label" aria-label="학급 이름과 목표 설정">' + escapeHtml(className) + ' ✎</button><div class="growth-board">' +
      '<div class="growth-path-art" aria-label="별길 ' + marker + ' / ' + PATH_LENGTH + '">' +
      '<span class="growth-egg-count" aria-label="황금알 ' + eggs + '개">' + eggs + '</span>' +
      frame.pending.map(function (contribution, index) { return actor(contribution, index, effect); }).join('') +
      '</div><div class="growth-counts"><span><i aria-hidden="true">★</i> 상점 ' + (Number(frame.totalContributions) || 0) +
      '</span><span><i aria-hidden="true">☁</i> 감점 ' + (Number(frame.totalDeductions) || 0) + '</span></div></div>' +
      '<div class="growth-score-actions"><button data-growth="award">으쓱 주기</button><button data-growth="penalty">머쓱 주기</button></div>' + reward +
      '</div><aside class="growth-tree-strip" aria-label="황금알 누적"><button class="growth-tree-title" data-growth="settings"><strong>' + (nextGoal ? '황금알 ' + Number(nextGoal.points) + '개' : '우리 반 목표') + '</strong>' + escapeHtml(nextGoal?.reward || '목표와 보상 정하기') + '</button>' +
      '<div class="growth-tree-egg"><span class="growth-egg-art" aria-hidden="true"></span><strong>' + eggs +
      '</strong><small>황금알</small></div></aside></section>';
  }

  async function refresh() {
    const request = ++requested;
    const result = await readBoard(classId);
    if (request !== requested) return;
    const current = result.state;
    className = result.className;
    goals = result.goals;
    if (!playing && !queue.length) {
      newestRevision = Math.max(newestRevision, Number(current.pathRevision) || 0);
      render(current);
    }
  }

  function sound(earned) {
    const file = earned ? 'Egg up.MP3' : 'Egg down.MP3';
    const audio = new Audio('assets/audio/' + file);
    audio.volume = .55;
    audio.play().catch(function () {});
  }

  function wait(duration) {
    return new Promise(function (resolve) { window.setTimeout(resolve, duration); });
  }

  function waitForPopup() {
    return new Promise(function (resolve) {
      function retry() {
        document.removeEventListener('classroom-score-feedback-changed', retry);
        document.removeEventListener('classroom-mode-changed', retry);
        resolve();
      }
      document.addEventListener('classroom-score-feedback-changed', retry);
      document.addEventListener('classroom-mode-changed', retry);
    });
  }

  async function pump() {
    if (playing || !visible() || popupOpen() || !queue.length) return;
    playing = true;
    const session = generation;
    try {
      while (queue.length && session === generation && !popupOpen()) {
        const trail = queue.shift();
        const frame = { ...trail.before, pending: trail.before.pending.slice() };
        const reduced = smallMotion();
        const pace = Math.min(1, Math.max(.45, 20 / trail.steps.length));
        const change = trail.after.classScore - trail.before.classScore;
        if (trail.condensed || reduced) {
          if (change) sound(change > 0);
          if (change > 0 && !reduced) {
            render(trail.after, { step: 'earn', eggs: change });
            await wait(900);
          }
        }
        for (const step of reduced ? [] : trail.steps) {
          while (session === generation && popupOpen()) await waitForPopup();
          if (session !== generation) return;
          if (step.kind === 'arrive') {
            frame.pending.push(step.contribution);
            frame.totalContributions += 1;
            render(frame, { step: 'arrive', index: frame.pending.length - 1, pace });
            await wait(165 * pace);
          } else if (step.kind === 'earn') {
            frame.classScore = step.classScore;
            sound(true);
            render(frame, { step: 'earn' });
            await wait(900 * pace);
            frame.pending = [];
          } else if (step.kind === 'open') {
            frame.classScore = step.classScore;
            frame.pending = step.contributions.slice();
            sound(false);
            render(frame, { step: 'open', penalty: true, pace });
            await wait(570 * pace);
          } else if (step.kind === 'retreat') {
            frame.totalDeductions += 1;
            render(frame, { step: 'retreat', index: frame.pending.length - 1, penalty: true, pace });
            await wait(215 * pace);
            frame.pending.pop();
          }
        }
        if (session === generation) render(trail.after, { penalty: trail.after.totalDeductions > trail.before.totalDeductions });
      }
    } finally {
      if (session === generation) {
        playing = false;
        if (!queue.length) await refresh();
      }
    }
  }

  function report(error) { console.error(error); }
  function clearPlayback() {
    generation += 1;
    queue.length = 0;
    playing = false;
  }

  function handleEvent(event) {
    if (event.type === 'data.restored') {
      clearPlayback();
      newestRevision = 0;
      return;
    }
    const trail = event.payload?.growth;
    if (!trail || !visible()) {
      void refresh().catch(report);
      return;
    }
    if (trail.revision <= newestRevision) return;
    newestRevision = trail.revision;
    queue.push(trail);
    void pump().catch(report);
  }

  document.addEventListener('classroom-score-feedback-changed', function () { void pump().catch(report); });
  document.addEventListener('classroom-mode-changed', function () {
    if (visible()) {
      void pump().catch(report);
    } else if (playing || queue.length) {
      clearPlayback();
      void refresh().catch(report);
    }
  });

  root.addEventListener('click', async function (event) {
    const action = event.target.closest('[data-growth]')?.dataset.growth;
    if (!action) return;
    if (action === 'close') { settings.close(); return; }
    if (action === 'award' || action === 'penalty') {
      const roster = await loadRoster(classId);
      await composer.open({students:roster.students,selectAll:false,sign:action==='penalty'?-1:1,source:'growth'});
      return;
    }
    if (action === 'settings') {
      settings.innerHTML = '<form class="student-form growth-settings-form"><div class="student-dialog-title"><h2>우리 반 목표와 보상</h2><button type="button" data-growth="close" aria-label="닫기">×</button></div>' +
        '<label>학급 이름<input name="name" maxlength="60" required value="' + escapeHtml(className) + '"></label><div class="growth-goals"><div><strong>목표 황금알</strong><strong>보상</strong></div>' +
        Array.from({length:10},(_,i)=>'<div><input aria-label="목표 '+(i+1)+' 황금알" name="goal-'+i+'" type="number" min="1" step="1" value="'+(Number(goals[i]?.points)||'')+'"><input aria-label="목표 '+(i+1)+' 보상" name="reward-'+i+'" maxlength="80" value="'+escapeHtml(goals[i]?.reward||'')+'"></div>').join('') +
        '</div><p class="student-form-error" role="alert"></p><button class="student-form-save" type="submit">저장</button></form>';
      settings.showModal();
    }
  });
  root.addEventListener('submit', async function(event) {
    if (!event.target.matches('.growth-settings-form')) return;
    event.preventDefault();
    const values=new FormData(event.target), button=event.target.querySelector('[type="submit"]');
    button.disabled=true;
    try {
      const name=String(values.get('name')||'').trim();
      if(!name) throw new Error('학급 이름을 입력해 주세요.');
      const updated=[];
      for(let i=0;i<10;i++) {
        const raw=values.get('goal-'+i), reward=String(values.get('reward-'+i)||'').trim();
        if(!raw&&!reward)continue;
        const points=Number(raw);
        if(!Number.isSafeInteger(points)||points<1||!reward)throw new Error('목표와 보상을 함께 입력해 주세요.');
        if(updated.some(g=>g.points===points))throw new Error('같은 목표 황금알 수가 있습니다.');
        updated.push({points,reward});
      }
      const record=await getRecord('classes',classId);
      await putRecord('classes',{...record,id:classId,name,goals:updated.sort((a,b)=>a.points-b.points)});
      settings.close();bus.publish('class.changed',{classId});await refresh();
    } catch(error){event.target.querySelector('.student-form-error').textContent=error.message;}
    finally{button.disabled=false;}
  });
  return { refresh, handleEvent };
}
