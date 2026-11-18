import { openDatabase, getRecord, putRecord, exportAll, importAll, requestResult, transact } from './core/db.js';
import { createEventBus } from './core/events.js';
import { mountGlobalFeedback } from './core/feedback.js?v=golden-eggs';
import { mountScoreboard } from './modules/scoreboard.js?v=golden-eggs';
import { mountGrowth } from './modules/growth.js?v=golden-eggs';
import { mountChecklist } from './modules/checklist.js?v=golden-eggs';

const CLASS_ID = 'class-default';
const MODE_KEY = 'class-revolution.active-mode.v1';

function setStatus(message, isError) {
  const node = document.getElementById('storage-status');
  node.textContent = message;
  node.parentElement.classList.toggle('has-error', Boolean(isError));
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function switchMode(mode) {
  const allowed = ['scoreboard', 'seats', 'growth', 'checklist'];
  if (!allowed.includes(mode)) mode = 'scoreboard';
  const panelMode = mode === 'seats' ? 'scoreboard' : mode;
  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
    button.setAttribute('aria-current', button.dataset.mode === mode ? 'page' : 'false');
  });
  document.querySelectorAll('.mode-panel').forEach(function (panel) {
    panel.classList.toggle('is-active', panel.id === 'mode-' + panelMode);
  });
  document.getElementById('display-options').hidden = panelMode !== 'scoreboard';
  if (document.body.dataset.classroomMode !== mode) {
    document.body.dataset.classroomMode = mode;
    document.dispatchEvent(new Event('classroom-mode-changed'));
  }
  try { localStorage.setItem(MODE_KEY, mode); } catch (error) {}
}

async function start() {
  const db = await openDatabase();
  const existingClass = await getRecord('classes', CLASS_ID);
  if (!existingClass) {
    await putRecord('classes', {
      id: CLASS_ID,
      name: '우리 반',
      createdAt: new Date().toISOString()
    });
  }
  const existingGrowth = await getRecord('growthStates', CLASS_ID);
  if (!existingGrowth) {
    await putRecord('growthStates', {
      classId: CLASS_ID,
      classScore: 0,
      pending: [],
      totalContributions: 0,
      updatedAt: new Date().toISOString()
    });
  }

  const bus = createEventBus();
  const feedback = mountGlobalFeedback(bus);

  const scoreboard = mountScoreboard(document.getElementById('scoreboard-root'), {
    classId: CLASS_ID,
    bus: bus
  });
  const growth = mountGrowth(document.getElementById('growth-root'), {
    classId: CLASS_ID,
    bus: bus
  });
  const checklist = mountChecklist(document.getElementById('checklist-root'), {
    classId: CLASS_ID,
    bus: bus
  });

  const settings = document.getElementById('app-settings');
  const nameInput = settings.querySelector('[name="className"]');
  const nameLabel = document.getElementById('class-name');
  const settingsError = document.getElementById('settings-error');
  async function refreshClassName() {
    const classroom = await getRecord('classes', CLASS_ID);
    nameLabel.textContent = classroom?.name || '우리 반';
  }
  for (const id of ['header-settings', 'rail-settings']) {
    document.getElementById(id).addEventListener('click', function () {
      nameInput.value = nameLabel.textContent;
      settingsError.textContent = '';
      settings.showModal();
    });
  }
  document.getElementById('settings-close').addEventListener('click', () => settings.close());
  settings.querySelector('form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      settingsError.textContent = '학반 이름을 입력해 주세요.';
      return;
    }
    const submit = event.submitter;
    if (submit?.disabled) return;
    if (submit) submit.disabled = true;
    try {
      await transact(['classes'], 'readwrite', async function (transaction) {
        const classes = transaction.objectStore('classes');
        const classroom = await requestResult(classes.get(CLASS_ID));
        classes.put({ ...classroom, id: CLASS_ID, name });
      });
      settings.close();
      bus.publish('class.changed', { classId: CLASS_ID });
    } catch (error) {
      settingsError.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  const sound = document.getElementById('sound-toggle');
  const soundKey = 'class-revolution.sound';
  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem(soundKey) !== 'off'; } catch (error) {}
  function updateSound() {
    feedback.setSoundEnabled(soundEnabled);
    sound.setAttribute('aria-pressed', String(soundEnabled));
    sound.title = soundEnabled ? '소리 끄기' : '소리 켜기';
    sound.setAttribute('aria-label', sound.title);
  }
  updateSound();
  sound.addEventListener('click', function () {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem(soundKey, soundEnabled ? 'on' : 'off'); } catch (error) {}
    updateSound();
  });
  const curtain = document.getElementById('screen-curtain');
  const curtainToggle = document.getElementById('curtain-toggle');
  const coveredControls = document.querySelectorAll('.app-header, .mode-nav, .workspace, #sound-toggle, #rail-settings, #global-feedback');
  function setCurtain(covered) {
    curtain.hidden = !covered;
    curtainToggle.setAttribute('aria-pressed', String(covered));
    curtainToggle.title = covered ? '화면 보이기' : '화면 가리기';
    curtainToggle.setAttribute('aria-label', curtainToggle.title);
    coveredControls.forEach(element => { element.inert = covered; });
    curtainToggle.focus();
  }
  curtainToggle.addEventListener('click', () => setCurtain(curtain.hidden));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !curtain.hidden) setCurtain(false);
  });

  function refreshAll() {
    return Promise.all([scoreboard.refresh(), growth.refresh(), checklist.refresh()]);
  }

  bus.subscribe(function (event) {
    if (event.type === 'data.restored') {
      void refreshClassName();
      growth.handleEvent(event);
      refreshAll().catch(function (error) { console.error(error); });
    }
    if (event.type === 'score.changed' || event.type === 'eggs.changed') {
      scoreboard.refresh();
      growth.handleEvent(event);
    }
    if (event.type === 'students.changed' || event.type === 'groups.changed') {
      scoreboard.refresh();
      growth.refresh();
      checklist.refresh();
    }
    if (event.type === 'class.changed') {
      void refreshClassName();
      growth.refresh();
    }
    if (event.type === 'checklist.updated') checklist.refresh();
  });

  function openMode(mode) {
    if (mode === 'scoreboard' || mode === 'seats') scoreboard.setView(mode === 'seats' ? 'seats' : 'list');
    switchMode(mode);
  }
  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.addEventListener('click', function () { openMode(button.dataset.mode); });
  });
  document.getElementById('home-button').addEventListener('click', () => openMode('scoreboard'));

  document.getElementById('backup-button').addEventListener('click', async function () {
    const data = await exportAll();
    data.exportedAt = new Date().toISOString();
    downloadJson(data, 'class-revolution-backup.json');
    setStatus('백업 파일 생성 완료', false);
  });

  const restoreInput = document.getElementById('restore-file');
  document.getElementById('restore-button').addEventListener('click', function () {
    restoreInput.click();
  });
  restoreInput.addEventListener('change', async function () {
    const file = restoreInput.files && restoreInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await importAll(data);
      bus.publish('data.restored', { fileName: file.name });
      setStatus('백업 데이터 복원 완료', false);
    } catch (error) {
      console.error(error);
      setStatus('복원 실패: 백업 파일을 확인하세요', true);
      alert('백업 파일을 복원하지 못했습니다. 파일 형식과 내용을 확인해주세요.');
    } finally {
      restoreInput.value = '';
    }
  });

  let savedMode = 'scoreboard';
  try { savedMode = localStorage.getItem(MODE_KEY) || 'scoreboard'; } catch (error) {}
  openMode(savedMode);
  await Promise.all([refreshAll(), refreshClassName()]);
  setStatus('로컬 데이터베이스 연결됨', false);
  window.classRevolution = { db: db, bus: bus, switchMode: openMode };
}

start().catch(function (error) {
  console.error(error);
  setStatus('초기화 실패', true);
  document.getElementById('scoreboard-root').innerHTML =
    '<div class="panel empty-state"><h2>앱을 시작하지 못했습니다.</h2><p>브라우저에서 IndexedDB를 사용할 수 있는지 확인하고 HTTPS 또는 localhost로 다시 열어주세요.</p><pre>' +
    String(error && error.message || error) + '</pre></div>';
});
