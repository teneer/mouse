(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const classRatioKey = 'whiteboard.test.class-card-ratio.v1';
  const teamRatioKey = 'whiteboard.test.team-card-ratio.v1';
  const root = document.body;
  const container = document.querySelector('.container');
  const frame = window.frameElement;
  const scaleOutput = document.getElementById('scoreSizeValue');

  function readSetting(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  const savedScale = Number(readSetting(scaleKey));
  let scale = savedScale >= 60 && savedScale <= 150 ? savedScale : 100;

  function updateLayout() {
    const { paddingLeft, paddingRight } = getComputedStyle(container);
    const available = container.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
    if (available <= 0) return;
    const panelPercent = Number(frame?.dataset.panelPercent ?? 30);
    const gap = Math.min(8, Math.floor(available / 12));
    const preferredColumns = panelPercent <= 10 ? 1
      : panelPercent < 20 ? 2
      : panelPercent <= 30 ? 3
      : Math.min(12, Math.max(3, Math.floor((available + gap) / 114)));
    const columns = panelPercent === 30 ? 3
      : Math.min(preferredColumns, Math.max(1, Math.floor((available + gap) / 66)));
    const classWidth = Math.min(available, Math.min(available * 0.92, 400) * scale / 100);
    const teamSlot = (available - gap * (columns - 1)) / columns;
    const teamWidth = Math.floor(4 * Math.min(teamSlot, classWidth * 0.69,
      Math.min(teamSlot * 0.9, 200) * scale / 100)) / 4;
    root.style.setProperty('--class-width', `${classWidth}px`);
    root.style.setProperty('--team-width', `${teamWidth}px`);
    root.style.setProperty('--team-row-width', `${(teamWidth * columns + gap * (columns - 1)).toFixed(3)}px`);
    root.style.setProperty('--team-gap', `${gap}px`);
    root.style.setProperty('--toolbar-clearance', `${Number(frame?.dataset.toolbarHeight ?? 0)}px`);
  }

  function setScale(next) {
    scale = Math.max(60, Math.min(150, next));
    scaleOutput.textContent = `${scale}%`;
    writeSetting(scaleKey, scale);
    updateLayout();
  }

  function setupRatio(id, key, cssVariable, defaultRatio) {
    const select = document.getElementById(id);
    const saved = readSetting(key);
    select.value = saved === '16:9' || saved === '4:3' ? saved : defaultRatio;
    const apply = () => root.style.setProperty(cssVariable, select.value.replace(':', ' / '));
    select.addEventListener('change', () => {
      apply();
      writeSetting(key, select.value);
    });
    apply();
  }

  document.getElementById('scoreSizeDown').addEventListener('click', () => setScale(scale - 10));
  document.getElementById('scoreSizeUp').addEventListener('click', () => setScale(scale + 10));
  document.getElementById('scoreSizeReset').addEventListener('click', () => setScale(100));
  setupRatio('classCardRatio', classRatioKey, '--class-ratio', '16:9');
  setupRatio('teamCardRatio', teamRatioKey, '--team-ratio', '4:3');
  if (frame) {
    new MutationObserver(updateLayout).observe(frame, {
      attributeFilter: ['data-panel-percent', 'data-toolbar-height'],
    });
  }
  new ResizeObserver(updateLayout).observe(container);
  setScale(scale);
})();
