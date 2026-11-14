(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const ratioKey = 'whiteboard.test.score-card-ratio.v1';
  const root = document.body;
  const container = document.querySelector('.container');
  const frame = window.frameElement;
  const classCardMultiplier = 1.25;
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
    const slotWidth = (available - gap * (columns - 1)) / columns;
    const scaledWidth = Math.min(slotWidth, 220) * scale / 100;
    const teamCardWidth = Math.floor(4 * Math.min(slotWidth, scaledWidth, available / classCardMultiplier)) / 4;
    root.style.setProperty('--class-width', `${teamCardWidth * classCardMultiplier}px`);
    root.style.setProperty('--team-columns', String(columns));
    root.style.setProperty('--team-row-width', `${(teamCardWidth * columns + gap * (columns - 1)).toFixed(3)}px`);
    root.style.setProperty('--team-gap', `${gap}px`);
    root.style.setProperty('--toolbar-clearance', `${Number(frame?.dataset.toolbarHeight ?? 0)}px`);
  }

  function setScale(next) {
    scale = Math.max(60, Math.min(150, next));
    scaleOutput.textContent = `${scale}%`;
    writeSetting(scaleKey, scale);
    updateLayout();
  }

  const ratioSelect = document.getElementById('score-card-ratio');
  const ratio = [
    readSetting(ratioKey),
    readSetting('whiteboard.test.team-card-ratio.v1'),
    readSetting('whiteboard.test.class-card-ratio.v1'),
  ].find(value => value === '16:9' || value === '4:3') ?? '4:3';
  ratioSelect.value = ratio;
  function applyRatio() {
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
})();
