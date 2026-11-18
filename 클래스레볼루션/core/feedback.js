import { animatedAvatar, stillAvatar } from './avatar.js';
import { escapeHtml } from './text.js';

const SOUND_FILES = {
  positive: 'assets/audio/Plus.MP3',
  negative: 'assets/audio/Minus.MP3',
  growth: 'assets/audio/Egg up.MP3',
  rewind: 'assets/audio/Egg down.MP3',
  checklist: 'assets/audio/Confirm.MP3',
  success: 'assets/audio/Success%20orinal.MP3'
};

const OTHER_FEEDBACK = {
  'growth.converted': { kind: 'growth', icon: '★' },
  'growth.rewound': { kind: 'rewind', icon: '★' },
  'checklist.rewarded': { kind: 'checklist', icon: '✓' },
  'goal.achieved': { kind: 'success', icon: '🏆' }
};

function scoreContent(payload, detailed) {
  const students = Array.isArray(payload.students) && payload.students.length
    ? payload.students : [{ name: payload.studentName || '학생', avatarId: payload.avatarId }];
  const delta = Number(payload.delta);
  const penalty = delta < 0;
  const kind = penalty ? 'negative' : 'positive';
  const amount = (students.length > 1 ? '각 ' : '') + (penalty ? '−' : '+') + Math.abs(delta) + '점';
  const label = penalty ? '감점' : '점수';
  const reason = String(payload.reason || '').trim();
  const icon = '<span class="score-feedback-badge ' + kind + '" aria-hidden="true">' + (penalty ? '☁' : '★') + '</span>';

  if (!detailed) {
    return '<div class="score-feedback-body"><div class="score-feedback-line">' + icon + '<strong>' +
      escapeHtml((reason || label) + ' · ' + amount) +
      '</strong></div><p>' + escapeHtml(students.map(function (student) { return student.name; }).join(', ')) + '</p></div>';
  }

  return (penalty ? '<span class="score-rain" aria-hidden="true"></span>' : '') +
    '<div class="score-feedback-heading">' +
    (penalty ? '' : '<span class="score-wings" aria-hidden="true"></span>') + icon +
    '<strong>' + label + ' <span>' + amount + '</span></strong></div>' +
    '<div class="score-feedback-students">' + students.map(function (student, index) {
      return '<div class="score-feedback-student" style="--entrance:' + Math.min(index, 17) * 55 + 'ms">' +
        (penalty ? stillAvatar(student.avatarId) : animatedAvatar(student.avatarId)) +
        '<span>' + escapeHtml(student.name) + '</span></div>';
    }).join('') + '</div><div class="score-feedback-message">' +
    '<span>' + escapeHtml(reason || (penalty ? '고쳐주세요' : '참 잘했어요')) + '</span>' +
    '<i class="score-mascot" aria-hidden="true"></i></div>';
}

function messageContent(event) {
  const { type, payload } = event;
  const { kind, icon } = OTHER_FEEDBACK[type];
  let title;
  let detail;
  if (type === 'growth.converted' || type === 'growth.rewound') {
    const delta = payload.delta || 1;
    title = '학급 점수 ' + (delta > 0 ? '+' : '−') + Math.abs(delta);
    detail = '황금알 ' + payload.classScoreAfter + '개';
  } else if (type === 'checklist.rewarded') {
    title = (payload.studentName || '학생') + ' 활동 보상';
    detail = '체크리스트 완료 · +' + payload.points + '점';
  } else {
    title = '학급 목표 달성!';
    detail = payload.reward || '모두 함께 이뤄낸 성과입니다.';
  }
  return '<span class="feedback-symbol" aria-hidden="true">' + icon + '</span>' +
    '<span class="feedback-copy"><strong>' + escapeHtml(title) +
    '</strong><span>' + escapeHtml(detail) + '</span></span>';
}

export function mountGlobalFeedback(bus) {
  const host = document.getElementById('global-feedback');
  const queue = [];
  let card = null;
  let active = null;
  let timer;
  let soundEnabled = true;

  function sound(kind) {
    if (!soundEnabled) return;
    const path = SOUND_FILES[kind];
    if (!path) return;
    const audio = new Audio(path);
    audio.volume = 0.55;
    audio.play().catch(function () {});
  }

  function render() {
    if (!active) return;
    const mode = document.body.dataset.classroomMode || 'whiteboard';
    const detailed = mode === 'scoreboard' || mode === 'seats' || mode === 'growth';
    if (active.type === 'score.changed') {
      const kind = Number(active.payload.delta) < 0 ? 'negative' : 'positive';
      card.className = 'score-feedback ' + (detailed ? 'score-feedback-detail' : 'score-feedback-bottom') + ' ' + kind;
      card.innerHTML = scoreContent(active.payload, detailed);
    } else {
      card.className = 'feedback-card';
      card.innerHTML = messageContent(active);
    }
    card.innerHTML += '<button class="score-feedback-close" type="button" aria-label="점수 알림 닫기">×</button>';
  }

  function next() {
    card?.remove();
    active = queue.shift() || null;
    while (active?.growthSummary && document.body.dataset.classroomMode === 'growth') active = queue.shift() || null;
    if (!active) {
      card = null;
      document.dispatchEvent(new Event('classroom-score-feedback-changed'));
      return;
    }
    card = document.createElement('div');
    render();
    host.appendChild(card);
    document.dispatchEvent(new Event('classroom-score-feedback-changed'));
    const isScore = active.type === 'score.changed';
    const duration = isScore ? (active.payload.students?.length > 10 ? 5400 : 4100) : 2600;
    sound(isScore ? (Number(active.payload.delta) < 0 ? 'negative' : 'positive') : OTHER_FEEDBACK[active.type].kind);
    timer = window.setTimeout(next, duration);
  }

  host.addEventListener('click', function (event) {
    if (!event.target.closest('.score-feedback-close')) return;
    clearTimeout(timer);
    next();
  });

  document.addEventListener('classroom-mode-changed', render);
  bus.subscribe(function (event) {
    if (event.type !== 'score.changed' && !Object.hasOwn(OTHER_FEEDBACK, event.type)) return;
    queue.push(event);
    const trail = event.type === 'score.changed' ? event.payload.growth : null;
    if (trail) {
      const delta = trail.after.classScore - trail.before.classScore;
      if (delta) queue.push({
        type: delta > 0 ? 'growth.converted' : 'growth.rewound',
        payload: { delta, classScoreAfter: trail.after.classScore }, growthSummary: true
      });
    }
    if (!active) next();
  });

  return {
    setSoundEnabled: function (enabled) { soundEnabled = Boolean(enabled); },
    test: function () { bus.publish('score.changed', { studentName: '학생', delta: 1, reason: '피드백 테스트' }); }
  };
}
