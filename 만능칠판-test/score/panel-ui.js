(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const ratioKey = 'whiteboard.test.score-card-ratio.v1';
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
    const minimumCardWidth = 150;
    let columns = 3;
    if (panelPercent <= 10) columns = 1;
    else if (panelPercent < 30) columns = 2;
    else if (panelPercent > 30) {
      columns = Math.max(3, Math.min(12, Math.floor((available + gap) / (minimumCardWidth + gap))));
    }
    root.style.setProperty('--team-columns', String(columns));
    root.style.setProperty('--team-gap', `${gap}px`);
    root.style.setProperty('--toolbar-clearance', `${Number(frame?.dataset.toolbarHeight ?? 0)}px`);
  }

  function setScale(next) {
    scale = Math.max(60, Math.min(150, next));
    scaleOutput.textContent = `${scale}%`;
    root.style.setProperty('--score-scale', String(scale / 100));
    writeSetting(scaleKey, scale);
  }

  const ratioSelect = document.getElementById('score-card-ratio');
  const ratio = [
    readSetting(ratioKey),
    readSetting('whiteboard.test.team-card-ratio.v1'),
    readSetting('whiteboard.test.class-card-ratio.v1'),
  ].find(value => value === '16:9' || value === '4:3') ?? '4:3';
  ratioSelect.value = ratio;
  function applyRatio() {
    root.dataset.cardRatio = ratioSelect.value;
    root.style.setProperty('--score-card-ratio', ratioSelect.value.replace(':', ' / '));
  }
  ratioSelect.addEventListener('change', () => {
    applyRatio();
    writeSetting(ratioKey, ratioSelect.value);
  });
  applyRatio();

  document.getElementById('scoreSizeDown').addEventListener('click', () => setScale(scale - 10));
  document.getElementById('scoreSizeUp').addEventListener('click', () => setScale(scale + 10));
  document.getElementById('scoreSizeReset').addEventListener('click', () => setScale(100));
  if (frame) {
    new MutationObserver(updateLayout).observe(frame, {
      attributeFilter: ['data-panel-percent', 'data-toolbar-height'],
    });
  }
  new ResizeObserver(updateLayout).observe(container);
  setScale(scale);
  updateLayout();
})();
