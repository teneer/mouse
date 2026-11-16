const SOUND_FILES = {
  positive: 'assets/audio/Plus.MP3',
  negative: 'assets/audio/Minus.MP3',
  growth: 'assets/audio/Egg up.MP3',
  checklist: 'assets/audio/Confirm.MP3',
  success: 'assets/audio/Success%20orinal.MP3'
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}

export function mountGlobalFeedback(bus) {
  const host = document.getElementById('global-feedback');
  const queue = [];
  let active = false;
  let soundEnabled = true;

  function sound(kind) {
    if (!soundEnabled) return;
    const path = SOUND_FILES[kind];
    if (!path) return;
    try {
      const audio = new Audio(path);
      audio.volume = 0.55;
      audio.play().catch(function () {});
    } catch (error) {}
  }

  function enqueue(item) {
    queue.push(item);
    if (!active) showNext();
  }

  function showNext() {
    if (!queue.length) { active = false; return; }
    active = true;
    const item = queue.shift();
    const card = document.createElement('div');
    let title = '점수가 변경되었습니다';
    let detail = '';
    let symbol = '✦';
    let className = '';

    if (item.type === 'score.changed') {
      const delta = Number(item.payload.delta || 0);
      title = (item.payload.studentName || '학생') + (delta > 0 ? ' 점수 획득' : ' 점수 변경');
      detail = (delta > 0 ? '+' : '') + delta + '점' + (item.payload.reason ? ' · ' + item.payload.reason : '');
      symbol = delta > 0 ? '＋' : '−';
      sound(delta > 0 ? 'positive' : 'negative');
    } else if (item.type === 'growth.converted') {
      title = '학급 성장 점수 +1';
      detail = '별길 10칸 완성! 학급 점수가 ' + item.payload.classScoreAfter + '점이 되었습니다.';
      symbol = '★';
      className = ' is-growth';
      sound('growth');
    } else if (item.type === 'checklist.rewarded') {
      title = (item.payload.studentName || '학생') + ' 활동 보상';
      detail = '체크리스트 완료 · +' + item.payload.points + '점';
      symbol = '✓';
      className = ' is-reward';
      sound('checklist');
    } else if (item.type === 'goal.achieved') {
      title = '학급 목표 달성!';
      detail = item.payload.reward || '모두 함께 이뤄낸 성과입니다.';
      symbol = '🏆';
      className = ' is-reward';
      sound('success');
    }

    card.className = 'feedback-card' + className;
    card.innerHTML = '<span class="feedback-symbol">' + symbol + '</span><span class="feedback-copy"><strong>' +
      escapeHtml(title) + '</strong><span>' + escapeHtml(detail) + '</span></span>';
    host.appendChild(card);
    const duration = item.type === 'growth.converted' || item.type === 'goal.achieved' ? 2600 : 1700;
    window.setTimeout(function () {
      card.classList.add('is-leaving');
      window.setTimeout(function () {
        card.remove();
        showNext();
      }, 230);
    }, duration);
  }

  bus.subscribe(function (event) {
    if (event.type === 'score.changed' || event.type === 'growth.converted' ||
        event.type === 'checklist.rewarded' || event.type === 'goal.achieved') enqueue(event);
  });

  return {
    setSoundEnabled: function (enabled) { soundEnabled = Boolean(enabled); },
    test: function () { enqueue({ type: 'score.changed', payload: { studentName: '학생', delta: 1, reason: '피드백 테스트' } }); }
  };
}