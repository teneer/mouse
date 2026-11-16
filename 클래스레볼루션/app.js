import { openDatabase, getRecord, putRecord, exportAll, importAll } from './core/db.js';
import { createEventBus } from './core/events.js';
import { mountGlobalFeedback } from './core/feedback.js';
import { mountScoreboard } from './modules/scoreboard.js';
import { mountGrowth } from './modules/growth.js';
import { mountChecklist } from './modules/checklist.js';

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
  const allowed = ['whiteboard', 'scoreboard', 'growth', 'checklist'];
  if (!allowed.includes(mode)) mode = 'whiteboard';
  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
    button.setAttribute('aria-current', button.dataset.mode === mode ? 'page' : 'false');
  });
  document.querySelectorAll('.mode-panel').forEach(function (panel) {
    panel.classList.toggle('is-active', panel.id === 'mode-' + mode);
  });
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
  mountGlobalFeedback(bus);

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

  function refreshAll() {
    return Promise.all([scoreboard.refresh(), growth.refresh(), checklist.refresh()]);
  }

  bus.subscribe(function (event) {
    if (event.type === 'data.restored') refreshAll().catch(function (error) { console.error(error); });
    if (event.type === 'score.changed') {
      scoreboard.refresh();
      growth.refresh();
    }
    if (event.type === 'growth.converted') {
      growth.handleEvent(event);
      growth.refresh();
    }
    if (event.type === 'students.changed' || event.type === 'groups.changed') {
      scoreboard.refresh();
      growth.refresh();
      checklist.refresh();
    }
    if (event.type === 'checklist.updated') checklist.refresh();
  });

  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.addEventListener('click', function () { switchMode(button.dataset.mode); });
  });

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
  switchMode(savedMode);
  await refreshAll();
  setStatus('로컬 데이터베이스 연결됨', false);
  window.classRevolution = { db: db, bus: bus, switchMode: switchMode };
}

start().catch(function (error) {
  console.error(error);
  setStatus('초기화 실패', true);
  document.getElementById('scoreboard-root').innerHTML =
    '<div class="panel empty-state"><h2>앱을 시작하지 못했습니다.</h2><p>브라우저에서 IndexedDB를 사용할 수 있는지 확인하고 HTTPS 또는 localhost로 다시 열어주세요.</p><pre>' +
    String(error && error.message || error) + '</pre></div>';
});
