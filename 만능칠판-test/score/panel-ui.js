import { measureTeamLayout } from './team-layout.js?v=2';

(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const ratioKey = 'whiteboard.test.score-card-ratio.v1';
  const modeKey = 'whiteboard.test.score-layout-mode.v1';
  const columnsKey = 'whiteboard.test.score-fixed-columns.v1';
  const root = document.body;
  const viewport = document.getElementById('team-viewport');
  const scoreboard = document.getElementById('scoreboard');
  const classScore = document.getElementById('number');
  const modeSelect = document.getElementById('score-layout-mode');
  const columnsRow = document.getElementById('score-fixed-columns-row');
  const columnsInput = document.getElementById('score-fixed-columns');
  const hint = document.getElementById('score-layout-hint');
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

  let previousColumns;
  let layoutFrame = null;
  function updateLayout() {
    layoutFrame = null;
    root.style.setProperty('--toolbar-clearance', `${Number(frame?.dataset.toolbarHeight ?? 0)}px`);
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = ratioSelect.value === '16:9' ? 16 / 9 : 4 / 3;
    const gap = Math.min(10, Math.floor(width / 18));
    const { columns, cardWidth } = measureTeamLayout({
      width, height, count: scoreboard.childElementCount, ratio, gap, previousColumns,
      fixedColumns: modeSelect.value === 'fixed' ? fixedColumns : null,
    });
    previousColumns = columns;
    // Round down to subpixels so the fitted grid does not acquire a scrollbar at the boundary.
    const widthPx = Math.floor(cardWidth * 16) / 16;
    scoreboard.style.setProperty('--team-columns', String(columns));
    scoreboard.style.setProperty('--team-card-width', `${widthPx}px`);
    scoreboard.style.setProperty('--team-gap', `${gap}px`);
    const classFontSize = parseFloat(getComputedStyle(classScore).fontSize);
    root.style.setProperty('--team-score-max', `${Math.min(40, classFontSize * 0.67)}px`);
  }

  function scheduleLayout() {
    if (layoutFrame === null) layoutFrame = requestAnimationFrame(updateLayout);
  }

  function applyLayoutSetting() {
    const fixed = modeSelect.value === 'fixed';
    columnsRow.hidden = !fixed;
    hint.hidden = fixed;
    previousColumns = undefined;
    scheduleLayout();
  }

  modeSelect.value = readSetting(modeKey) === 'fixed' ? 'fixed' : 'auto';
  const isColumnCount = value => Number.isInteger(value) && value >= 1 && value <= 6;
  const savedColumns = Number(readSetting(columnsKey));
  let fixedColumns = isColumnCount(savedColumns) ? savedColumns : 3;
  columnsInput.value = String(fixedColumns);
  modeSelect.addEventListener('change', () => {
    writeSetting(modeKey, modeSelect.value);
    applyLayoutSetting();
  });
  columnsInput.addEventListener('input', () => {
    const next = columnsInput.valueAsNumber;
    if (!isColumnCount(next) || next === fixedColumns) return;
    fixedColumns = next;
    writeSetting(columnsKey, fixedColumns);
    applyLayoutSetting();
  });
  const restoreColumnsInput = () => {
    columnsInput.value = String(fixedColumns);
  };
  columnsInput.addEventListener('blur', restoreColumnsInput);
  columnsInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') restoreColumnsInput();
  });

  function setScale(next) {
    scale = Math.max(60, Math.min(150, next));
    scaleOutput.textContent = `${scale}%`;
    root.style.setProperty('--score-scale', String(scale / 100));
    writeSetting(scaleKey, scale);
    scheduleLayout();
  }

  const ratioSelect = document.getElementById('score-card-ratio');
  const ratio = [
    readSetting(ratioKey),
    readSetting('whiteboard.test.team-card-ratio.v1'),
    readSetting('whiteboard.test.class-card-ratio.v1'),
  ].find(value => value === '16:9' || value === '4:3') ?? '4:3';
  ratioSelect.value = ratio;
  function applyRatio() {
    previousColumns = undefined;
    root.style.setProperty('--score-card-ratio', ratioSelect.value.replace(':', ' / '));
    scheduleLayout();
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
    new MutationObserver(scheduleLayout).observe(frame, {
      attributeFilter: ['data-panel-percent', 'data-toolbar-height'],
    });
  }
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(viewport);
  resizeObserver.observe(classScore);
  let teamCount = scoreboard.childElementCount;
  new MutationObserver(() => {
    if (teamCount === scoreboard.childElementCount) return;
    teamCount = scoreboard.childElementCount;
    previousColumns = undefined;
    scheduleLayout();
  }).observe(scoreboard, { childList: true });
  applyLayoutSetting();
  setScale(scale);
})();
