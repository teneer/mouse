import { AVATAR_COUNT, avatarNumber, stillAvatar } from '../core/avatar.js';
import { groupPositions, importStudents, loadRoster, moveGroup, moveStudent, saveGroup, saveStudent, studentSeats } from '../core/roster.js';
import { applyScoreBatch } from '../core/score-engine.js?v=growth-path';
import { escapeHtml } from '../core/text.js';

const DIRECTION_KEY = 'class-revolution.room-reversed';
const VIEW_KEY = 'class-revolution.student-view';
const VIEWS = [['list', '학생카드'], ['seats', '자리배치'], ['manage', '학생관리']];

function readPreference(key) {
  try { return localStorage.getItem(key); } catch (error) { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch (error) {}
}

function slots(layout, columns, minimum, reversed, extra) {
  const used = Math.max(0, ...layout.keys()) + 1;
  const length = Math.max(minimum, Math.ceil((used + extra) / columns) * columns);
  const indices = Array.from({ length }, function (_, index) { return index; });
  return reversed ? indices.reverse() : indices;
}

function attributes(info) {
  return Object.entries(info).map(function ([name, value]) {
    return ' data-' + name + '="' + escapeHtml(value) + '"';
  }).join('');
}

export function mountScoreboard(root, { classId, bus }) {
  const savedView = readPreference(VIEW_KEY);
  let view = VIEWS.some(function ([key]) { return key === savedView; }) ? savedView : 'list';
  let reversed = readPreference(DIRECTION_KEY) === 'true';
  let editing = false;
  let source = null;
  let dragTarget = null;
  let students = [];
  let groups = [];
  let reason = '';
  let points = '1';
  let notice = '';
  let busy = false;
  let revision = 0;
  const selected = new Set();

  root.innerHTML = '<div class="student-surface"></div><dialog class="student-dialog"></dialog>';
  const surface = root.querySelector('.student-surface');
  const dialog = root.querySelector('.student-dialog');

  async function refresh() {
    const current = ++revision;
    const roster = await loadRoster(classId);
    if (current !== revision) return;
    students = roster.students;
    groups = roster.groups;
    const ids = new Set(students.map(function (student) { return student.id; }));
    selected.forEach(function (id) { if (!ids.has(id)) selected.delete(id); });
    render();
  }

  function render() {
    const controls = '<nav class="student-view-switch" aria-label="학생 화면">' + VIEWS.map(function ([key, label]) {
      return '<button type="button" data-action="view" data-view="' + key + '" aria-pressed="' +
        (view === key) + '">' + label + '</button>';
    }).join('') + '</nav>';
    const content = view === 'manage' ? renderManagement() :
      view === 'seats' ? renderSeating() : '<div class="student-cards">' +
        students.map(function (student) { return studentCard(student, false); }).join('') +
        '<button class="student-add-card" type="button" data-action="add-student"><b>＋</b>학생 추가</button></div>';
    surface.innerHTML = controls + content +
      '<p class="student-notice" role="status">' + escapeHtml(notice) + '</p>' +
      (view !== 'manage' && !editing ? renderScoreBar() : '');
  }

  function studentCard(student, management) {
    return '<button type="button" class="student-tile" data-id="' + escapeHtml(student.id) +
      '" data-action="' + (management ? 'edit-student' : 'select-student') + '"' +
      (management ? '' : ' aria-pressed="' + selected.has(student.id) + '"') + '>' + stillAvatar(student.avatarId) +
      (management ? '' : '<strong class="tile-score">' + Number(student.score || 0) + '</strong>') +
      '<span class="tile-name"><small>' + escapeHtml(student.number) + '</small> ' +
      escapeHtml(student.name) + '</span></button>';
  }

  function renderManagement() {
    const teamButtons = groups.map(function (group) {
      return '<button type="button" class="roster-group" data-action="edit-group" data-id="' +
        escapeHtml(group.id) + '">' + escapeHtml(group.name) + '</button>';
    }).join('');
    return '<section class="roster-stage" aria-label="학생관리"><div class="roster-tools">' +
      '<button type="button" class="roster-control" data-action="paste-roster">명단 붙여넣기</button>' +
      '<button type="button" class="roster-control" data-action="add-group">모둠 추가</button></div>' +
      '<div class="roster-groups" aria-label="모둠 이름 편집">' + teamButtons + '</div>' +
      '<div class="student-cards">' + students.map(function (student) { return studentCard(student, true); }).join('') +
      '<button class="student-add-card" type="button" data-action="add-student"><b>＋</b>학생 추가</button></div></section>';
  }

  function renderSeating() {
    const arrangement = groupPositions(groups);
    const groupIds = new Set(groups.map(function (group) { return group.id; }));
    const ungrouped = students.filter(function (student) { return !groupIds.has(student.groupId); });
    return '<div class="classroom-stage"><div class="classroom-edge">' + (reversed ? '교실 뒤' : '교실 앞') + '</div>' +
      '<div class="classroom-scroll"><div class="classroom-grid">' +
      slots(arrangement, 3, 6, reversed, editing ? 1 : 0).map(function (position) {
        const group = arrangement.get(position);
        return group ? renderGroup(group, students.filter(function (student) { return student.groupId === group.id; }), position) :
          renderEmptyGroup(position);
      }).join('') + '</div>' +
      (ungrouped.length || editing ? '<div class="ungrouped-seats">' + renderGroup({ id: '', name: '미배정' }, ungrouped, null) + '</div>' : '') +
      '</div><div class="classroom-edge">' + (reversed ? '교실 앞' : '교실 뒤') + '</div></div>' +
      '<div class="classroom-controls"><button type="button" class="seat-edit-toggle" data-action="edit-seats" aria-pressed="' +
      editing + '">' + (editing ? '자리배치 완료' : '자리배치 수정') + '</button>' +
      '<button type="button" class="roster-control" data-action="flip" aria-pressed="' + reversed +
      '">↻ 180도 방향 전환</button>' +
      (editing ? '<button type="button" class="roster-control" data-action="add-group">모둠 추가</button>' : '') + '</div>';
  }

  function renderGroup(group, members, position) {
    const arrangement = studentSeats(members);
    const total = members.reduce(function (sum, student) { return sum + Number(student.score || 0); }, 0);
    const moving = source?.kind === 'group' && source.id === group.id;
    const handle = editing && position != null
      ? '<button type="button" class="group-handle" draggable="true" aria-pressed="' + moving +
        '" aria-label="' + escapeHtml(group.name) + ' 위치 이동"' +
        attributes({ action: 'group-position', position, id: group.id }) + '>✥ ' + escapeHtml(group.name) + '</button>'
      : '<strong>' + escapeHtml(group.name) + '</strong>';
    return '<section class="classroom-group"' +
      (position == null ? '' : attributes({ 'room-position': position, 'room-group': group.id })) + ' aria-label="' +
      escapeHtml(group.name) + '"><div class="seat-grid">' +
      slots(arrangement, 2, 4, reversed, editing ? 1 : 0).map(function (seat) {
        return renderSeat(group, seat, arrangement.get(seat));
      }).join('') + '</div><div class="classroom-group-footer">' + handle +
      '<span aria-label="모둠 합계 ' + total + '점">' + total + ' <i aria-hidden="true">♣</i></span></div></section>';
  }

  function renderEmptyGroup(position) {
    if (!editing) return '<div class="empty-room-position" aria-hidden="true"></div>';
    return '<button type="button" class="empty-room-position" data-action="group-position" data-room-position="' +
      position + '" data-room-group="" data-position="' + position + '" data-id="" aria-label="빈 모둠 위치 ' +
      (position + 1) + '">빈 모둠 위치</button>';
  }

  function renderSeat(group, seat, student) {
    if (!student && !editing) return '<div class="seat-tile seat-empty" aria-hidden="true"></div>';
    const id = student?.id || '';
    const pressed = editing ? source?.kind === 'seat' && id !== '' && source.id === id : selected.has(id);
    return '<button type="button" class="seat-tile' + (student ? '' : ' seat-empty') +
      '" aria-pressed="' + Boolean(pressed) + '"' +
      attributes({ action: editing ? 'seat-position' : 'select-student', id, group: group.id, seat }) +
      (editing && student ? ' draggable="true"' : '') + '>' +
      (student ? '<small>' + escapeHtml(student.number) + '</small><span>' + escapeHtml(student.name) +
        '</span><strong>' + Number(student.score || 0) + '</strong>' :
        '<span aria-label="' + escapeHtml(group.name) + ' 빈자리 ' + (seat + 1) + '">빈자리</span>') + '</button>';
  }

  function renderScoreBar() {
    const disabled = selected.size && !busy ? '' : ' disabled';
    return '<form class="student-scorebar"><div class="student-selection">' +
      '<button type="button" data-action="all">' + (selected.size ? selected.size + '명 선택취소' : '전체선택') + '</button>' +
      '<button type="button" data-action="invert">선택반전</button></div><div class="student-scoring">' +
      '<label>점수 사유<input name="reason" maxlength="120" value="' + escapeHtml(reason) +
      '" placeholder="예: 발표 참여"></label><label>점수<input name="points" type="number" min="1" max="100" step="1" required value="' +
      escapeHtml(points) + '"></label>' +
      '<button type="submit" class="score-award" name="sign" value="1"' + disabled + '>★ 으쓱</button>' +
      '<button type="submit" class="score-penalty" name="sign" value="-1"' + disabled + '>☁ 머쓱</button></div></form>';
  }

  function showDialog(kind, id) {
    const student = students.find(function (item) { return item.id === id; });
    const group = groups.find(function (item) { return item.id === id; });
    let title;
    let fields;
    if (kind === 'paste-roster') {
      title = '학생 명단 붙여넣기';
      fields = '<label>번호, 이름, 모둠<textarea name="roster" required placeholder="1, 김민수, 1모둠&#10;2, 이서연, 2모둠"></textarea></label>';
    } else if (kind === 'add-group' || kind === 'edit-group') {
      title = group ? '모둠 이름 수정' : '모둠 추가';
      fields = '<label>모둠 이름<input name="name" maxlength="40" required value="' +
        escapeHtml(group?.name) + '"></label>';
    } else {
      title = student ? '학생 정보 수정' : '학생 추가';
      const current = avatarNumber(student?.avatarId ?? (students.length % AVATAR_COUNT + 1));
      fields = '<div class="roster-fields"><label>번호<input name="number" type="number" min="1" step="1" required value="' +
        (Number(student?.number) || Math.max(0, ...students.map(function (item) { return Number(item.number) || 0; })) + 1) +
        '"></label><label>이름<input name="name" maxlength="40" required value="' + escapeHtml(student?.name) +
        '"></label><label>모둠<select name="groupId"><option value="">미배정</option>' + groups.map(function (option) {
          return '<option value="' + escapeHtml(option.id) + '"' + (student?.groupId === option.id ? ' selected' : '') +
            '>' + escapeHtml(option.name) + '</option>';
        }).join('') + '</select></label></div><fieldset class="roster-avatars"><legend>아바타</legend><div>' +
        Array.from({ length: AVATAR_COUNT }, function (_, index) {
          const value = index + 1;
          return '<label title="아바타 ' + value + '"><input type="radio" name="avatarId" value="' + value +
            '" aria-label="아바타 ' + value + '"' + (value === current ? ' checked' : '') + '>' + stillAvatar(value) + '</label>';
        }).join('') + '</div></fieldset>';
    }
    dialog.setAttribute('aria-labelledby', 'student-dialog-title');
    dialog.innerHTML = '<form class="student-form" data-kind="' + kind + '" data-id="' + escapeHtml(id) +
      '"><div class="student-dialog-title"><h2 id="student-dialog-title">' + title +
      '</h2><button type="button" data-action="close-dialog" aria-label="닫기">×</button></div>' + fields +
      '<p class="student-form-error" role="alert"></p><button class="student-form-save" type="submit">저장</button></form>';
    dialog.showModal();
  }

  function positionAt(element, kind) {
    if (kind === 'group') {
      const block = element.closest('[data-room-position]');
      return block ? { kind, position: Number(block.dataset.roomPosition), id: block.dataset.roomGroup } : null;
    }
    const seat = element.closest('[data-action="seat-position"]');
    return seat ? {
      kind, id: seat.dataset.id, groupId: seat.dataset.group, seat: Number(seat.dataset.seat)
    } : null;
  }

  async function finishMove(target) {
    const from = source;
    if (!from || !target || busy) return;
    clearDragTarget();
    if (target.kind !== from.kind) return;
    busy = true;
    try {
      if (from.kind === 'seat') {
        await moveStudent(classId, from.id, { ...target, studentId: target.id }, from);
      } else {
        await moveGroup(classId, from.id, target.position, { position: from.position, targetId: target.id });
      }
      notice = from.kind === 'seat' ? '학생 자리를 저장했습니다.' : '모둠 위치를 저장했습니다.';
      bus.publish('students.changed', { classId });
    } catch (error) {
      notice = error.message;
    } finally {
      source = null;
      busy = false;
      await refresh();
    }
  }

  function clearDragTarget() {
    dragTarget?.classList.remove('is-drop-target');
    dragTarget = null;
  }

  root.addEventListener('dragstart', function (event) {
    const button = event.target.closest('[draggable="true"]');
    if (!editing || !button) return;
    const kind = button.dataset.action === 'group-position' ? 'group' : 'seat';
    source = positionAt(button, kind);
    event.dataTransfer.setData('text/plain', source.id);
    event.dataTransfer.effectAllowed = 'move';
  });

  root.addEventListener('dragover', function (event) {
    if (!source || !positionAt(event.target, source.kind)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest(source.kind === 'group' ? '[data-room-position]' : '[data-action="seat-position"]');
    if (target !== dragTarget) {
      clearDragTarget();
      dragTarget = target;
      dragTarget.classList.add('is-drop-target');
    }
  });

  root.addEventListener('drop', function (event) {
    if (!source) return;
    const target = positionAt(event.target, source.kind);
    if (!target) return;
    event.preventDefault();
    void finishMove(target);
  });

  root.addEventListener('dragend', function () {
    clearDragTarget();
    if (!busy) { source = null; render(); }
  });

  root.addEventListener('input', function (event) {
    if (!event.target.closest('.student-scorebar')) return;
    if (event.target.name === 'reason') reason = event.target.value;
    if (event.target.name === 'points') points = event.target.value;
  });

  root.addEventListener('click', function (event) {
    const button = event.target.closest('[data-action]');
    if (!button || busy) return;
    const { action, id } = button.dataset;
    if (action === 'close-dialog') { dialog.close(); return; }
    if (['add-student', 'edit-student', 'add-group', 'edit-group', 'paste-roster'].includes(action)) {
      showDialog(action, id || '');
      return;
    }
    notice = '';
    if (action === 'view') {
      view = button.dataset.view;
      savePreference(VIEW_KEY, view);
      editing = false;
      source = null;
    } else if (action === 'edit-seats') {
      editing = !editing;
      source = null;
      if (editing) notice = '학생이나 모둠을 끌어서 옮기거나, 옮길 대상과 위치를 차례로 선택하세요.';
    } else if (action === 'flip') {
      reversed = !reversed;
      savePreference(DIRECTION_KEY, String(reversed));
    } else if (action === 'select-student') {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else if (action === 'all') {
      if (selected.size) selected.clear();
      else students.forEach(function (student) { selected.add(student.id); });
    } else if (action === 'invert') {
      students.forEach(function (student) {
        if (selected.has(student.id)) selected.delete(student.id);
        else selected.add(student.id);
      });
    } else if (action === 'seat-position' || action === 'group-position') {
      const kind = action === 'group-position' ? 'group' : 'seat';
      const target = positionAt(button, kind);
      if (source?.kind === kind && source.id !== id) { void finishMove(target); return; }
      source = id && source?.id !== id ? target : null;
      if (source) notice = kind === 'seat' ? '옮길 자리를 선택하세요.' : '옮길 모둠 위치를 선택하세요.';
    }
    render();
    Array.from(surface.querySelectorAll('[data-action="' + action + '"]')).find(function (candidate) {
      return candidate.dataset.id === button.dataset.id && candidate.dataset.view === button.dataset.view &&
        candidate.dataset.seat === button.dataset.seat && candidate.dataset.group === button.dataset.group;
    })?.focus();
  });

  root.addEventListener('submit', async function (event) {
    const form = event.target;
    event.preventDefault();
    if (busy) return;
    busy = true;
    const values = new FormData(form);
    if (form.matches('.student-form')) {
      const { kind, id } = form.dataset;
      try {
        if (kind === 'paste-roster') await importStudents(classId, values.get('roster'));
        else if (kind.endsWith('group')) await saveGroup(classId, { id, name: values.get('name') });
        else await saveStudent(classId, { id, ...Object.fromEntries(values) });
        dialog.close();
        notice = '저장했습니다.';
        bus.publish('students.changed', { classId });
      } catch (error) {
        form.querySelector('.student-form-error').textContent = error.message;
      } finally {
        busy = false;
        await refresh();
      }
      return;
    }

    try {
      const amount = Number(values.get('points'));
      const sign = Number(event.submitter?.value || 1);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('1~100점 사이의 정수를 입력해 주세요.');
      const result = await applyScoreBatch({
        classId, studentIds: [...selected], delta: sign * amount, reason: reason.trim(), source: 'scoreboard'
      });
      selected.clear();
      notice = '';
      bus.publish('score.changed', {
        batchId: result.events[0].batchId, delta: sign * amount, reason: reason.trim(), source: 'scoreboard', growth: result.trail,
        students: result.students.map(function (student) {
          return { id: student.id, name: student.name, avatarId: student.avatarId };
        })
      });
    } catch (error) {
      notice = error.message;
    } finally {
      busy = false;
      await refresh();
    }
  });

  return { refresh };
}
