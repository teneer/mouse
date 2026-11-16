import { getAll, putRecord } from '../core/db.js';
import { applyIndividualScore } from '../core/score-engine.js';

function uid() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}
function localDate(date) {
  const value = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return value.toISOString().slice(0, 10);
}
function avatarPath(id) {
  const number = String(Number(id) || 1).padStart(3, '0');
  return 'assets/avatars/220/avatar_' + number + '_220.png';
}

export function mountChecklist(root, options) {
  const classId = options.classId;
  const bus = options.bus;
  let date = localDate(new Date());
  let students = [];
  let definitions = [];
  let entries = [];
  let showForm = false;

  async function refresh() {
    const results = await Promise.all([getAll('students'), getAll('checklistDefinitions'), getAll('checklistEntries')]);
    students = results[0].filter(function (student) { return student.classId === classId && student.status !== 'deleted'; })
      .sort(function (a, b) { return Number(a.number) - Number(b.number); });
    definitions = results[1].filter(function (item) { return item.classId === classId; })
      .sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
    entries = results[2].filter(function (entry) { return entry.classId === classId && entry.date === date; });
    render();
  }

  function getEntry(studentId, definitionId) {
    return entries.find(function (entry) { return entry.studentId === studentId && entry.definitionId === definitionId; });
  }

  function renderCell(student, definition) {
    const entry = getEntry(student.id, definition.id);
    const value = entry ? entry.value : null;
    if (definition.inputType === 'check') {
      const done = value === true;
      return '<button type="button" class="cell-button' + (done ? ' is-done' : '') +
        '" data-cell="check" data-student="' + student.id + '" data-definition="' + definition.id + '">' + (done ? '✓' : '·') + '</button>';
    }
    if (definition.inputType === 'symbol') {
      return '<button type="button" class="cell-button" data-cell="symbol" data-student="' + student.id +
        '" data-definition="' + definition.id + '">' + escapeHtml(value || '·') + '</button>';
    }
    if (definition.inputType === 'rating') {
      let options = '<option value="">-</option>';
      for (let number = 1; number <= 5; number += 1) {
        options += '<option value="' + number + '"' + (Number(value) === number ? ' selected' : '') + '>' + number + '</option>';
      }
      return '<select data-cell="rating" data-student="' + student.id + '" data-definition="' + definition.id + '">' + options + '</select>';
    }
    return '<input type="number" min="0" max="100" value="' + (value == null ? '' : Number(value)) +
      '" aria-label="점수 입력" data-cell="score" data-student="' + student.id + '" data-definition="' + definition.id + '">';
  }

  function render() {
    if (!students.length) {
      root.innerHTML = '<div class="module-heading"><div><h1>체크리스트</h1><p>학생별 활동과 수행 내용을 날짜별로 기록합니다.</p></div></div>' +
        '<section class="panel empty-state"><div class="empty-icon">☷</div><h2>먼저 학생 명단을 등록해주세요</h2>' +
        '<p>점수판에서 학생 명단을 등록하면 체크리스트의 행이 자동으로 구성됩니다.</p>' +
        '<button class="primary-button" type="button" data-action="go-scoreboard">점수판에서 학생 등록</button></section>';
      return;
    }

    const dateLabel = date.replace(/-/g, '. ');
    let form = '';
    if (showForm) {
      form = '<form class="checklist-form" id="checklist-form"><label>항목 이름<input name="title" required placeholder="예: 발표 참여"></label>' +
        '<label>입력 방식<select name="type"><option value="check">체크</option><option value="symbol">기호(○/△/×)</option><option value="rating">1~5점</option><option value="score">점수 입력</option></select></label>' +
        '<label>완료 보상 점수<input name="reward" type="number" min="0" max="100" value="0"></label>' +
        '<button class="primary-button" type="submit">항목 추가</button><button class="secondary-button" type="button" data-action="close-form">취소</button></form>';
    }

    const headers = definitions.map(function (definition) {
      return '<th><span>' + escapeHtml(definition.title) + '</span><small style="display:block;color:#8b98a8;font-size:9px;font-weight:500">' +
        (definition.inputType === 'check' ? '체크' : definition.inputType === 'symbol' ? '기호' : definition.inputType === 'rating' ? '1~5' : '점수') +
        '</small></th>';
    }).join('');
    const rows = students.map(function (student) {
      const avatar = '<img src="' + avatarPath(student.avatarId) + '" alt="" onerror="this.hidden=true">';
      return '<tr><td><span class="checklist-student">' + avatar + '<span>' + escapeHtml(student.number) + '. ' + escapeHtml(student.name) + '</span></span></td>' +
        definitions.map(function (definition) { return '<td>' + renderCell(student, definition) + '</td>'; }).join('') + '</tr>';
    }).join('');

    root.innerHTML = '<div class="module-heading"><div><h1>체크리스트</h1><p>날짜별 활동 기록 · 학생별 수행 현황</p></div>' +
      '<div class="module-actions"><button class="primary-button" data-action="show-form" type="button">+ 항목 추가</button></div></div>' +
      '<div class="checklist-toolbar"><div class="date-controls"><button class="secondary-button" data-action="date-prev" type="button">←</button><strong>' + dateLabel +
      '</strong><button class="secondary-button" data-action="date-next" type="button">→</button></div><span style="color:#7b8998;font-size:11px">' +
      students.length + '명 · ' + definitions.length + '개 항목</span></div>' + form +
      '<div class="checklist-table-wrap"><table class="checklist-table"><thead><tr><th>학생</th>' + headers + '</tr></thead><tbody>' +
      (definitions.length ? rows : '<tr><td colspan="2" style="padding:32px;color:#8492a3">아직 체크리스트 항목이 없습니다. 항목 추가를 눌러 시작하세요.</td></tr>') +
      '</tbody></table></div>';
  }

  async function saveEntry(studentId, definitionId, value) {
    const definition = definitions.find(function (item) { return item.id === definitionId; });
    const student = students.find(function (item) { return item.id === studentId; });
    if (!definition || !student) return;
    const previous = getEntry(studentId, definitionId);
    const entry = {
      id: classId + '|' + date + '|' + definitionId + '|' + studentId,
      classId: classId, date: date, studentId: studentId, definitionId: definitionId,
      value: value, updatedAt: new Date().toISOString()
    };
    await putRecord('checklistEntries', entry);
    entries = entries.filter(function (item) { return item.id !== entry.id; });
    entries.push(entry);
    bus.publish('checklist.updated', { date: date, studentId: studentId, definitionId: definitionId });

    const newlyChecked = definition.inputType === 'check' && value === true && !(previous && previous.value === true);
    const reward = Number(definition.rewardPoints || 0);
    if (newlyChecked && reward > 0) {
      const result = await applyIndividualScore({
        classId: classId, studentId: studentId, delta: reward,
        reason: '체크리스트: ' + definition.title, source: 'checklist'
      });
      bus.publish('score.changed', {
        studentId: studentId, studentName: student.name, delta: reward,
        reason: '체크리스트: ' + definition.title, source: 'checklist'
      });
      result.conversions.forEach(function (conversion) {
        bus.publish('growth.converted', {
          classScoreAfter: conversion.classScoreAfter,
          contributions: conversion.contributions,
          conversionId: conversion.id
        });
      });
      bus.publish('checklist.rewarded', { studentName: student.name, points: reward, title: definition.title });
    }
    render();
  }

  root.addEventListener('click', async function (event) {
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'show-form') { showForm = true; render(); }
      else if (action.dataset.action === 'close-form') { showForm = false; render(); }
      else if (action.dataset.action === 'date-prev' || action.dataset.action === 'date-next') {
        const next = new Date(date + 'T12:00:00');
        next.setDate(next.getDate() + (action.dataset.action === 'date-prev' ? -1 : 1));
        date = localDate(next);
        await refresh();
      } else if (action.dataset.action === 'go-scoreboard') {
        document.querySelector('[data-mode="scoreboard"]').click();
      }
      return;
    }
    const cell = event.target.closest('[data-cell]');
    if (!cell) return;
    const type = cell.dataset.cell;
    const studentId = cell.dataset.student;
    const definitionId = cell.dataset.definition;
    if (type === 'check') {
      await saveEntry(studentId, definitionId, cell.classList.contains('is-done') ? false : true);
    } else if (type === 'symbol') {
      const cycle = ['', '○', '△', '×'];
      const current = cell.textContent === '·' ? '' : cell.textContent;
      const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
      await saveEntry(studentId, definitionId, next);
    }
  });

  root.addEventListener('change', async function (event) {
    const cell = event.target.closest('[data-cell]');
    if (!cell) return;
    if (cell.dataset.cell === 'rating') await saveEntry(cell.dataset.student, cell.dataset.definition, Number(cell.value) || null);
    if (cell.dataset.cell === 'score') await saveEntry(cell.dataset.student, cell.dataset.definition, Number(cell.value) || 0);
  });

  root.addEventListener('submit', async function (event) {
    if (event.target.id !== 'checklist-form') return;
    event.preventDefault();
    const form = new FormData(event.target);
    const title = String(form.get('title') || '').trim();
    if (!title) return;
    const definition = {
      id: uid(), classId: classId, title: title, inputType: String(form.get('type') || 'check'),
      rewardPoints: Number(form.get('reward') || 0), order: definitions.length + 1,
      createdAt: new Date().toISOString()
    };
    await putRecord('checklistDefinitions', definition);
    showForm = false;
    bus.publish('checklist.updated', { definitionId: definition.id });
    await refresh();
  });

  refresh();
  return { refresh: refresh };
}