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
function avatarPath(id) {
  const number = String(Number(id) || 1).padStart(3, '0');
  return 'assets/avatars/220/avatar_' + number + '_220.png';
}

export function mountScoreboard(root, options) {
  const classId = options.classId;
  const bus = options.bus;
  const selected = new Set();
  let students = [];
  let groups = [];

  async function refresh() {
    const results = await Promise.all([getAll('students'), getAll('groups')]);
    students = results[0].filter(function (student) { return student.classId === classId && student.status !== 'deleted'; })
      .sort(function (a, b) { return Number(a.number) - Number(b.number); });
    groups = results[1].filter(function (group) { return group.classId === classId; })
      .sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
    Array.from(selected).forEach(function (id) {
      if (!students.some(function (student) { return student.id === id; })) selected.delete(id);
    });
    render();
  }

  function studentCard(student) {
    const isSelected = selected.has(student.id);
    const fallback = (student.name || '?').slice(0, 1);
    return '<button type="button" class="student-card' + (isSelected ? ' is-selected' : '') +
      '" data-student-id="' + escapeHtml(student.id) + '" aria-pressed="' + String(isSelected) + '">' +
      '<span class="student-number">' + escapeHtml(student.number) + '</span>' +
      '<span class="student-avatar"><img data-avatar src="' + avatarPath(student.avatarId) + '" alt=""><span class="avatar-fallback" hidden>' +
      escapeHtml(fallback) + '</span></span>' +
      '<span class="student-name">' + escapeHtml(student.name) + '</span>' +
      '<span class="student-points">' + Number(student.score || 0) + '점</span></button>';
  }

  function groupPanel(group, members) {
    const total = members.reduce(function (sum, student) { return sum + Number(student.score || 0); }, 0);
    return '<section class="panel group-panel"><div class="group-heading"><strong>' + escapeHtml(group.name) +
      '</strong><span>' + total + '점</span></div><div class="group-students">' +
      members.map(studentCard).join('') + '</div></section>';
  }

  function renderEmpty() {
    root.innerHTML = '<div class="module-heading"><div><h1>학생·모둠 점수판</h1><p>학생 명부를 등록하면 개인 점수와 모둠별 합계를 관리할 수 있습니다.</p></div></div>' +
      '<section class="panel empty-state"><div class="empty-icon">✦</div><h2>학생 명단을 준비해주세요</h2>' +
      '<p>엑셀이나 스프레드시트에서 번호, 이름, 모둠을 복사해 붙여넣을 수 있습니다. 한 줄에 한 명씩 입력하세요.</p>' +
      '<div class="roster-import"><textarea id="roster-input" placeholder="번호, 이름, 모둠&#10;1, 학생 1, 1모둠&#10;2, 학생 2, 1모둠&#10;3, 학생 3, 2모둠"></textarea>' +
      '<div class="roster-import-actions"><button class="secondary-button" data-action="demo-roster" type="button">샘플 8명으로 체험</button>' +
      '<button class="primary-button" data-action="import-roster" type="button">명단 등록</button></div></div></section>';
  }

  function render() {
    if (!students.length) { renderEmpty(); return; }
    const ungrouped = students.filter(function (student) { return !student.groupId || !groups.some(function (group) { return group.id === student.groupId; }); });
    let panels = groups.map(function (group) {
      const members = students.filter(function (student) { return student.groupId === group.id; });
      return members.length ? groupPanel(group, members) : '';
    }).join('');
    if (ungrouped.length) panels += groupPanel({ name: '미배정' }, ungrouped);

    root.innerHTML = '<div class="module-heading"><div><h1>학생·모둠 점수판</h1><p>학생을 선택하고 하단 조작부에서 점수를 부여합니다. 모둠 점수는 구성원의 개인 점수 합계입니다.</p></div>' +
      '<div class="module-actions"><button class="secondary-button" data-action="show-import" type="button">명단 추가</button></div></div>' +
      '<div class="score-summary"><div class="summary-chip"><span>학생 수</span><strong>' + students.length + '명</strong></div>' +
      '<div class="summary-chip"><span>모둠 수</span><strong>' + groups.length + '개</strong></div>' +
      '<div class="summary-chip"><span>개인 점수 합계</span><strong>' + students.reduce(function (sum, s) { return sum + Number(s.score || 0); }, 0) + '점</strong></div></div>' +
      '<div class="group-grid">' + panels + '</div>' +
      '<details class="roster-import panel" id="roster-add-panel"><summary>학생 명단 붙여넣기 / 추가</summary>' +
      '<div style="padding:12px"><textarea id="roster-input" placeholder="번호, 이름, 모둠" style="width:100%;min-height:76px;padding:10px;border:1px solid #d8e0e9;border-radius:8px"></textarea>' +
      '<div class="roster-import-actions"><button class="primary-button" data-action="import-roster" type="button">명단 추가</button></div></div></details>' +
      (selected.size ? '<div class="selection-bar"><strong>' + selected.size + '명 선택</strong><input id="score-reason" type="text" value="수업 참여" aria-label="점수 사유" placeholder="점수 사유">' +
        '<button class="danger-button" data-action="score" data-delta="-1" type="button">−1</button>' +
        '<button class="secondary-button" data-action="score" data-delta="1" type="button">+1</button>' +
        '<button class="primary-button" data-action="score" data-delta="3" type="button">+3</button>' +
        '<button class="secondary-button" data-action="clear-selection" type="button">해제</button></div>' : '');
    root.querySelectorAll('img[data-avatar]').forEach(function (image) {
      image.addEventListener('error', function () {
        image.hidden = true;
        if (image.nextElementSibling) image.nextElementSibling.hidden = false;
      }, { once: true });
    });
  }

  async function importRoster(text) {
    const lines = String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return;
    const existingGroups = await getAll('groups');
    const groupMap = new Map(existingGroups.filter(function (group) { return group.classId === classId; }).map(function (group) { return [group.name, group]; }));
    let nextNumber = students.reduce(function (max, student) { return Math.max(max, Number(student.number) || 0); }, 0) + 1;
    let avatarNumber = students.length;
    for (const line of lines) {
      const parts = line.split(/[,\t]/).map(function (part) { return part.trim(); });
      let number, name, groupName;
      if (parts.length > 1 && /^\d+$/.test(parts[0])) {
        number = Number(parts[0]); name = parts[1]; groupName = parts[2] || '';
      } else {
        number = nextNumber; name = parts[0]; groupName = parts[1] || '';
      }
      if (!name) continue;
      nextNumber = Math.max(nextNumber, number + 1);
      let groupId = null;
      if (groupName) {
        let group = groupMap.get(groupName);
        if (!group) {
          group = { id: uid(), classId: classId, name: groupName, order: groupMap.size + 1, createdAt: new Date().toISOString() };
          await putRecord('groups', group);
          groupMap.set(groupName, group);
        }
        groupId = group.id;
      }
      avatarNumber += 1;
      await putRecord('students', {
        id: uid(), classId: classId, number: number, name: name, groupId: groupId,
        avatarId: ((avatarNumber - 1) % 70) + 1, score: 0, status: 'active',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    }
    selected.clear();
    bus.publish('students.changed', { classId: classId });
    await refresh();
  }

  async function addDemoRoster() {
    if (students.length && !confirm('현재 명단 뒤에 샘플 학생 8명을 추가할까요?')) return;
    const demo = [
      '1,학생 01,1모둠', '2,학생 02,1모둠', '3,학생 03,2모둠', '4,학생 04,2모둠',
      '5,학생 05,3모둠', '6,학생 06,3모둠', '7,학생 07,4모둠', '8,학생 08,4모둠'
    ];
    await importRoster(demo.join('\n'));
  }

  async function applySelected(delta) {
    const reasonInput = root.querySelector('#score-reason');
    const reason = reasonInput ? reasonInput.value.trim() : '수업 참여';
    const ids = Array.from(selected);
    for (const studentId of ids) {
      const student = students.find(function (item) { return item.id === studentId; });
      if (!student) continue;
      const result = await applyIndividualScore({
        classId: classId, studentId: studentId, delta: delta, reason: reason, source: 'scoreboard'
      });
      bus.publish('score.changed', {
        studentId: studentId, studentName: student.name, groupId: student.groupId,
        delta: delta, reason: reason, source: 'scoreboard'
      });
      result.conversions.forEach(function (conversion) {
        bus.publish('growth.converted', {
          classScoreAfter: conversion.classScoreAfter,
          contributions: conversion.contributions,
          conversionId: conversion.id
        });
      });
    }
    selected.clear();
    await refresh();
  }

  root.addEventListener('click', async function (event) {
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'import-roster') {
        const input = root.querySelector('#roster-input');
        await importRoster(input ? input.value : '');
      } else if (action === 'demo-roster') {
        await addDemoRoster();
      } else if (action === 'show-import') {
        const panel = root.querySelector('#roster-add-panel');
        if (panel) panel.open = true;
        const input = root.querySelector('#roster-input');
        if (input) input.focus();
      } else if (action === 'clear-selection') {
        selected.clear(); render();
      } else if (action === 'score') {
        await applySelected(Number(actionButton.dataset.delta));
      }
      return;
    }
    const card = event.target.closest('[data-student-id]');
    if (card) {
      const id = card.dataset.studentId;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
    }
  });

  refresh();
  return { refresh: refresh };
}