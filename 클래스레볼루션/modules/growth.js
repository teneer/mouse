import { getAll, getRecord } from '../core/db.js';

// Centers of the nine stars and the gold egg in bg-class-clouds-way.png.
const POSITIONS = [
  [79.6, 26.0], [61.1, 19.4], [42.6, 26.0], [24.0, 19.4], [7.4, 41.3],
  [19.0, 70.4], [37.5, 77.1], [56.0, 70.4], [74.6, 77.1], [91.9, 75.2]
];

function avatarPath(id) {
  const number = String(Number(id) || 1).padStart(3, '0');
  return 'assets/avatars/220/avatar_' + number + '_220.png';
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

export function mountGrowth(root, options) {
  const classId = options.classId;
  const bus = options.bus;
  let state = { classScore: 0, pending: [], totalContributions: 0 };
  let students = [];
  let celebrationBatch = null;
  let celebrationTimer = null;

  async function refresh() {
    const results = await Promise.all([getRecord('growthStates', classId), getAll('students')]);
    state = results[0] || { classScore: 0, pending: [], totalContributions: 0 };
    students = results[1].filter(function (student) { return student.classId === classId; });
    render();
  }

  function render() {
    const pending = celebrationBatch || (Array.isArray(state.pending) ? state.pending : []);
    const studentMap = new Map(students.map(function (student) { return [student.id, student]; }));
    const slots = POSITIONS.map(function (position, index) {
      const contribution = pending[index];
      const student = contribution ? studentMap.get(contribution.studentId) : null;
      const avatarId = contribution ? (contribution.avatarId || (student && student.avatarId)) : null;
      const name = contribution ? (contribution.studentName || (student && student.name) || '기여 학생') : '';
      let content = '<span class="slot-fallback">' + (index + 1) + '</span>';
      if (avatarId) content = '<img src="' + avatarPath(avatarId) + '" alt="' + escapeHtml(name) + '"><span class="slot-fallback" hidden>' + escapeHtml(name.slice(0, 1)) + '</span>';
      return '<div class="growth-slot ' + (contribution ? 'is-filled' : 'is-empty') + (index === 9 ? ' is-goal' : '') +
        '" style="left:' + position[0] + '%;top:' + position[1] + '%" title="' + escapeHtml(contribution ? name : '기여 ' + (index + 1)) + '">' +
        content + '</div>';
    }).join('');

    root.innerHTML = '<div class="module-heading"><div><h1>학급 성장 여정</h1><p>개인의 점수가 모여 우리 반의 성장이 됩니다.</p></div></div>' +
      '<div class="growth-header"><div class="growth-score"><strong>' + Number(state.classScore || 0) +
      '</strong><span>학급 점수</span></div><div class="growth-rule">개인 점수 10점 기여 → 학급 점수 1점</div></div>' +
      '<section class="growth-scene" aria-label="별길 성장 경로">' + slots + '</section>' +
      '<div class="growth-footer"><span>현재 별길 ' + (Array.isArray(state.pending) ? state.pending.length : 0) +
      ' / 10 · 누적 기여 ' + Number(state.totalContributions || 0) + '</span>' +
      '<img src="assets/visuals/sp_board_sky_village.png" alt="" onerror="this.hidden=true"></div>' +
      '<p style="margin:10px 0;color:#7b8998;font-size:11px">별길의 10번째 기여가 도착하면 학급 점수로 전환되고 다음 여정이 시작됩니다.</p>';

    root.querySelectorAll('.growth-slot img').forEach(function (image) {
      image.addEventListener('error', function () {
        image.hidden = true;
        if (image.nextElementSibling) image.nextElementSibling.hidden = false;
      }, { once: true });
    });
  }

  function handleEvent(event) {
    if (event.type !== 'growth.converted') return;
    celebrationBatch = Array.isArray(event.payload.contributions) ? event.payload.contributions : null;
    render();
    clearTimeout(celebrationTimer);
    celebrationTimer = window.setTimeout(function () {
      celebrationBatch = null;
      refresh();
    }, 2300);
  }

  bus.subscribe(handleEvent);
  refresh();
  return { refresh: refresh, handleEvent: handleEvent };
}
