import { fitScoreFont } from './score-display.js';
import { measureTeamLayout } from './team-layout.js?v=3';

(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const ratioKey = 'whiteboard.test.score-card-ratio.v1';
  const modeKey = 'whiteboard.test.score-layout-mode.v1';
  const columnsKey = 'whiteboard.test.score-fixed-columns.v1';
  const root = document.body;
  const viewport = document.getElementById('team-viewport');
  const scoreboard = document.getElementById('scoreboard');
  const classScore = document.getElementById('number');
  const classControls = classScore.parentElement;
  const classButtons = [...classControls.querySelectorAll('button')];
  const measure = document.createElement('canvas').getContext('2d');
  const modeSelect = document.getElementById('score-layout-mode');
  const columnsRow = document.getElementById('score-fixed-columns-row');
  const columnsInput = document.getElementById('score-fixed-columns');
  const hint = document.getElementById('score-layout-hint');
  const frame = window.frameElement;
  const scaleOutput = document.getElementById('scoreSizeValue');
  const sideRow = document.getElementById('score-panel-side-row');
  const sideSelect = document.getElementById('score-panel-side');

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
    if (width > 0 && height > 0) {
      const ratio = ratioSelect.value === '16:9' ? 16 / 9 : 4 / 3;
      const gap = Math.min(10, Math.floor(width / 18));
      const { columns, cardWidth } = measureTeamLayout({
        width, height, count: scoreboard.childElementCount, ratio, gap, previousColumns,
        fixedColumns: modeSelect.value === 'fixed' ? fixedColumns : null,
        maxAutoColumns: Number(frame?.dataset.panelPercent) <= 10 ? 1 : 6,
        scale: scale / 100,
      });
      previousColumns = columns;
      const widthPx = Math.floor(cardWidth * 16) / 16;
      scoreboard.style.setProperty('--team-columns', String(columns));
      scoreboard.style.setProperty('--team-card-width', `${widthPx}px`);
      scoreboard.style.setProperty('--team-gap', `${gap}px`);
    }

    const style = getComputedStyle(classControls);
    const preferred = 76 * scale / 100;
    const font = getComputedStyle(classScore);
    const space = classControls.clientWidth-classButtons.reduce((width,button)=>width+button.offsetWidth,0)-2*(parseFloat(style.columnGap)||0);
    if (measure && classControls.clientWidth > 0) {
      measure.font = `${font.fontWeight} ${preferred}px ${font.fontFamily}`;
      const size=fitScoreFont(preferred,space,measure.measureText(classScore.textContent).width+2);
      classScore.style.setProperty('--class-score-size',size+'px');
    }
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

  function setScale(next, publish = false) {
    scale = Math.max(60, Math.min(150, next));
    scaleOutput.textContent = `${scale}%`;
    root.style.setProperty('--score-scale', String(scale / 100));
    writeSetting(scaleKey, scale);
    if (frame) {
      frame.dataset.scoreScale = String(scale);
      if (publish) {
        delete frame.dataset.syncedScoreScale;
        frame.dispatchEvent(new Event('score-display-scale'));
      }
    }
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

  document.getElementById('scoreSizeDown').addEventListener('click', () => setScale(scale - 10, true));
  document.getElementById('scoreSizeUp').addEventListener('click', () => setScale(scale + 10, true));
  document.getElementById('scoreSizeReset').addEventListener('click', () => setScale(100, true));
  if (frame) {
    const applySide = () => {
      const side = frame.dataset.scoreSide;
      sideRow.hidden = side !== 'left' && side !== 'right';
      if (!sideRow.hidden) sideSelect.value = side;
    };
    applySide();
    sideSelect.addEventListener('change', () => {
      frame.dispatchEvent(new CustomEvent('score-panel-side', { detail: sideSelect.value }));
      applySide();
    });
    new MutationObserver(() => {
      applySide();
      const incoming = Number(frame.dataset.syncedScoreScale);
      if (incoming>=60 && incoming<=150 && incoming!==scale) setScale(incoming);
      scheduleLayout();
    }).observe(frame, {
      attributeFilter: ['data-panel-percent', 'data-toolbar-height', 'data-synced-score-scale', 'data-score-side'],
    });
  }
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(viewport);
  resizeObserver.observe(classControls);
  new MutationObserver(scheduleLayout).observe(classScore,{childList:true});
  document.fonts?.ready.then(scheduleLayout);
  let teamCount = scoreboard.childElementCount;
  new MutationObserver(() => {
    if (teamCount === scoreboard.childElementCount) return;
    teamCount = scoreboard.childElementCount;
    previousColumns = undefined;
    scheduleLayout();
  }).observe(scoreboard, { childList: true });
  applyLayoutSetting();
  const initialScale = Number(frame?.dataset.syncedScoreScale);
  setScale(initialScale>=60 && initialScale<=150 ? initialScale : scale);
})();
