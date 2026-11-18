import { getAll, getRecord, putRecord } from './db.js';
import { applyScoreBatch } from './score-engine.js?v=golden-eggs';
import { stillAvatar } from './avatar.js';
import { escapeHtml as esc } from './text.js';

// One submission is one reason and one signed amount for the whole selection.
export function mountScoreComposer(host, { classId, bus, onApplied = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'score-composer';
  dialog.setAttribute('aria-label', '점수 대상과 사유 선택');
  host.append(dialog);
  let recipients = [], selected = new Set(), sign = 1, source = 'scoreboard', busy = false, opening = false;
  let favorites = [], recent = [], points = '1', reason = '';
  const settingsKey = () => 'score-reasons:' + classId + ':' + (sign < 0 ? 'negative' : 'positive');

  async function open(options) {
    if (busy || opening || dialog.open) return;
    opening = true;
    try {
    recipients = options.students.slice();
    selected = new Set(options.selectAll === false ? [] : recipients.map(s => s.id));
    sign = options.sign < 0 ? -1 : 1;
    source = options.source || 'scoreboard';
    reason = options.reason || '';
    points = String(options.points || 1);
    const [settings, history] = await Promise.all([getRecord('settings', settingsKey()), getAll('scoreEvents')]);
    favorites = Array.isArray(settings?.values) ? settings.values.filter(r => typeof r === 'string').slice(0, 10) : [];
    recent = [...new Set(history.filter(e => e.classId === classId && Math.sign(e.delta) === sign && e.reason)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(e => e.reason))].slice(0, 10);
    render();
    if (!dialog.open) dialog.showModal();
    } finally { opening = false; }
  }

  function render() {
    dialog.classList.toggle('is-penalty', sign < 0);
    dialog.innerHTML = '<form class="score-compose-form"><aside class="score-compose-sidebar">' +
      '<button type="button" data-compose="close" class="compose-back">‹ 이전 화면</button>' +
      '<h2>' + (sign < 0 ? '머쓱 카드 주기' : '으쓱 카드 주기') + '</h2>' +
      '<p>선택한 학생에게 같은 점수를 줍니다.</p><div class="compose-recipients">' + recipients.map(s =>
        '<label><input type="checkbox" name="student" value="' + esc(s.id) + '"' + (selected.has(s.id) ? ' checked' : '') + '>' +
        stillAvatar(s.avatarId) + '<span>' + esc(s.number) + ' ' + esc(s.name) + '</span></label>').join('') +
      '</div><strong class="compose-count">' + selected.size + '명 선택</strong></aside>' +
      '<section class="score-compose-main"><button type="button" data-compose="close" class="compose-close" aria-label="점수 입력 닫기">×</button>' +
      '<h3>어떤 일이 있었나요?</h3><div class="reason-presets">' +
      [...new Set([...favorites, ...recent])].map(r => '<button type="button" data-compose="reason" data-reason="' + esc(r) + '">' +
        '<span class="reason-mark">' + (favorites.includes(r) ? '★' : '↶') + '</span>' + esc(r) + '</button>').join('') +
      (!favorites.length && !recent.length ? '<p class="reason-empty">아래에 점수 내용을 입력해 주세요.<br>즐겨찾기에 넣거나 사용한 사유는 이곳에서 바로 고를 수 있습니다.</p>' : '') +
      '</div><div class="compose-fields"><label>점수 내용<input name="reason" maxlength="120" placeholder="예: 발표에 적극적으로 참여했어요" value="' + esc(reason) + '" required></label>' +
      '<button type="button" class="reason-favorite" data-compose="favorite">★ 사유 즐겨찾기</button>' +
      '<label>학생 한 명당 점수<div class="compose-amount"><span>' + (sign < 0 ? '−' : '+') + '</span>' +
      '<input name="points" aria-label="학생 한 명당 점수" type="number" min="1" max="100" step="1" value="' + points + '" required><span>점</span></div></label>' +
      '<p class="compose-error" role="alert"></p><button class="compose-apply" type="submit">' + (sign < 0 ? '감점 적용' : '점수 지급') +
      '</button></div></section></form>';
  }

  dialog.addEventListener('input', e => {
    if (e.target.name === 'points') points = e.target.value;
    if (e.target.name === 'reason') reason = e.target.value;
    if (e.target.name === 'student') {
      e.target.checked ? selected.add(e.target.value) : selected.delete(e.target.value);
      dialog.querySelector('.compose-count').textContent = selected.size + '명 선택';
    }
  });
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('click', async e => {
    const target = e.target.closest('[data-compose]');
    if (!target || busy) return;
    if (target.dataset.compose === 'close') dialog.close();
    if (target.dataset.compose === 'reason') {
      reason = target.dataset.reason;
      dialog.querySelector('[name="reason"]').value = reason;
    }
    if (target.dataset.compose === 'favorite' && reason.trim()) {
      try {
        const value = reason.trim();
        favorites = favorites.includes(value) ? favorites.filter(r => r !== value) : [value, ...favorites].slice(0, 10);
        await putRecord('settings', { key: settingsKey(), values: favorites });
        render();
      } catch (error) { dialog.querySelector('.compose-error').textContent = error.message; }
    }
  });
  dialog.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const amount = Number(points);
    const errorNode = dialog.querySelector('.compose-error');
    if (!selected.size) { errorNode.textContent = '대상 학생을 선택해 주세요.'; return; }
    if (!Number.isInteger(amount) || amount < 1 || amount > 100 || !reason.trim()) {
      errorNode.textContent = '사유와 1~100점 사이의 정수를 입력해 주세요.'; return;
    }
    busy = true;
    dialog.querySelector('.compose-apply').disabled = true;
    let result;
    try {
      result = await applyScoreBatch({ classId, studentIds: [...selected], delta: sign * amount, reason: reason.trim(), source });
    } catch (error) {
      errorNode.textContent = error.message;
      busy = false;
      dialog.querySelector('.compose-apply').disabled = false;
      return;
    }
    dialog.close();
    busy = false;
    bus.publish('score.changed', {
      batchId: result.events[0].batchId, delta: sign * amount, reason: reason.trim(), source, growth: result.trail,
      students: result.students.map(s => ({ id: s.id, name: s.name, avatarId: s.avatarId }))
    });
    onApplied(result);
  });
  return { open };
}
