import { fitScoreFont } from './score-display.js';
import { measureTeamLayout } from './team-layout.js?v=goal-cells-1';

(() => {
  const scaleKey = 'whiteboard.test.score-scale.v1';
  const ratioKey = 'whiteboard.test.score-card-ratio.v1';
  const modeKey = 'whiteboard.test.score-layout-mode.v1';
  const columnsKey = 'whiteboard.test.score-fixed-columns.v1';
  const regionShareKey = 'whiteboard.test.score-region-share.v1';
  const batchHeightKey = 'whiteboard.test.score-batch-height.v1';
  const root = document.body;
  const displayArea = document.getElementById('display-area');
  const splitter = document.getElementById('score-region-splitter');
  const batchSplitter = document.getElementById('score-batch-splitter');
  const batch = document.getElementById('batch-score');
  const bottomRow = document.getElementById('bottom-row');
  const viewport = document.getElementById('team-viewport');
  const scoreboard = document.getElementById('scoreboard');
  const classScore = document.getElementById('number');
  const classControls = classScore.parentElement;
  const classContent = classControls.parentElement;
  const classBanners = [...classContent.querySelectorAll('.class-goal-slot, .score-progress-group')];
  const classButtons = [...classControls.querySelectorAll('button')];
  const measure = document.createElement('canvas').getContext('2d');
  const modeButton = document.getElementById('score-layout-mode');
  const columnsRow = document.getElementById('score-fixed-columns-row');
  const columnsInput = document.getElementById('score-fixed-columns');
  const hint = document.getElementById('score-layout-hint');
  const frame = window.frameElement;
  const scaleOutput = document.getElementById('scoreSizeValue');
  const sideRow = document.getElementById('score-panel-side-row');
  const sideButton = document.getElementById('score-panel-side');
  const sideShortcut = document.getElementById('score-move-side');

  function readSetting(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

const savedRegionShare = Number(readSetting(regionShareKey));
  let regionShare = savedRegionShare > 0 && savedRegionShare < 1 ? savedRegionShare : null;
  let batchHeight = Number(readSetting(batchHeightKey)) || null;
  let regionBounds, batchBounds;
  const clamp = (value,min,max)=>Math.min(max,Math.max(min,value));

  function minimumTeamHeight(ratio) {
    const bottomStyle=getComputedStyle(bottomRow);
    const blockHeight=parseFloat(bottomStyle.paddingTop)+parseFloat(bottomStyle.paddingBottom);
    const visible=[...bottomRow.children].filter(child=>child!==sideShortcut && getComputedStyle(child).display!=='none');
    const labelsHeight=visible.reduce((height,child)=>height+(child===viewport?0:child.offsetHeight),blockHeight)
      +Math.max(0,visible.length-1)*parseFloat(bottomStyle.rowGap);
    const {cardWidth}=viewport.hidden ? {cardWidth:0} : measureTeamLayout({
      width:viewport.clientWidth,height:0,count:scoreboard.childElementCount,ratio,gap:Math.min(10,Math.floor(viewport.clientWidth/18)),
      fixedColumns:mode==='fixed'?fixedColumns:null,scale:scale/100,minimumWidth:132
    });
    return Math.ceil(labelsHeight+cardWidth/ratio+viewport.offsetHeight-viewport.clientHeight);
  }
  function setSplitterSize(handle,{min,max,height,total}) {
    for(const [name,value] of [['min',min],['max',max],['now',height]]) {
      handle.setAttribute('aria-value'+name,String(Math.round(value/total*100)));
    }
  }
  function setPixelSize(element,property,height) {
    const pixels=height+'px';
    if(element.style.getPropertyValue(property)!==pixels)element.style.setProperty(property,pixels);
  }
  function updateRegionLayout(ratio) {
    const container=displayArea.parentElement;
    const panelHeight=container.clientHeight-parseFloat(getComputedStyle(container).paddingBottom)
      -splitter.offsetHeight-batchSplitter.offsetHeight;
    if(panelHeight<=0)return;
    const teamMin=minimumTeamHeight(ratio);
    const min=parseFloat(getComputedStyle(displayArea).getPropertyValue('--class-region-min'));
    const batchStyle=getComputedStyle(batch);
    const batchDefault=batch.hidden?0:parseFloat(batchStyle.getPropertyValue('--batch-default'));
    // The class share uses the default footer height so moving the lower handle only takes space from the team area.
    const reference=Math.max(panelHeight-batchDefault,min+teamMin);
    const desiredClass=regionShare===null?clamp(reference*.3,166,215):reference*regionShare;
    let available=panelHeight;
    if(!batch.hidden) {
      const minBatch=parseFloat(batchStyle.getPropertyValue('--batch-min'));
      const maxBatch=Math.max(minBatch,Math.min(180,Math.floor(panelHeight-teamMin-Math.max(min,desiredClass))));
      const height=Math.round(clamp(batchHeight??batchDefault,minBatch,maxBatch));
      batchBounds={min:minBatch,max:maxBatch,height,total:Math.max(panelHeight,height)};
      setSplitterSize(batchSplitter,batchBounds);
      setPixelSize(batch,'--batch-height',height);
      available-=height;
    }
    const total=Math.max(available,min+teamMin);
    const max=total-teamMin;
    displayArea.toggleAttribute('data-regions-overflow',total>available);
    setPixelSize(bottomRow,'--team-area-min',teamMin);
    const height=Math.round(clamp(desiredClass,min,max));
    regionBounds={total,min,max,height,reference};
    setPixelSize(displayArea,'--class-area-height',height);
    setSplitterSize(splitter,regionBounds);
  }

  function wireHeightSplitter(handle,direction,getBounds,setHeight,save) {
    let drag;
    function adjust(height) {
      const {min,max}=getBounds();
      setHeight(clamp(height,min,max));
      scheduleLayout();
    }
    handle.addEventListener('pointerdown',event=>{
      const bounds=getBounds();
      if(drag || event.button!==0 || !bounds || bounds.min===bounds.max)return;
      drag={id:event.pointerId,y:event.clientY,height:bounds.height};
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove',event=>{
      if(drag?.id===event.pointerId)adjust(drag.height+direction*(event.clientY-drag.y));
    });
    function finishDrag(event) {
      if(drag?.id!==event.pointerId)return;
      drag=null;
      handle.classList.remove('dragging');
      save();
    }
    for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,finishDrag);
    handle.addEventListener('keydown',event=>{
      const bounds=getBounds();
      if(!bounds)return;
      const {height,min,max}=bounds;
      const step=(event.shiftKey?32:12)*direction;
      const targets={ArrowUp:height-step,ArrowDown:height+step,Home:min,End:max};
      if(!Object.hasOwn(targets,event.key))return;
      event.preventDefault();
      event.stopPropagation();
      if(min===max)return;
      adjust(targets[event.key]);
      save();
    });
  }
  wireHeightSplitter(splitter,1,()=>regionBounds,height=>{regionShare=height/regionBounds.reference;},
    ()=>{if(regionShare!==null)writeSetting(regionShareKey,regionShare);});
  wireHeightSplitter(batchSplitter,-1,()=>batchBounds,height=>{batchHeight=height;},
    ()=>{if(batchHeight!==null)writeSetting(batchHeightKey,batchHeight);});
  document.getElementById('score-reset-regions').onclick=()=>{
    regionShare=batchHeight=null;
    try {
      localStorage.removeItem(regionShareKey);
      localStorage.removeItem(batchHeightKey);
    } catch {}
    scheduleLayout();
  };

  const savedScale = Number(readSetting(scaleKey));
  let scale = savedScale >= 60 && savedScale <= 150 ? savedScale : 100;

  let previousColumns;
  let layoutFrame = null;
  function updateLayout() {
    layoutFrame = null;
    root.style.setProperty('--toolbar-clearance', `${Number(frame?.dataset.toolbarHeight ?? 0)}px`);
    const ratio = cardRatio === '16:9' ? 16 / 9 : 4 / 3;
    updateRegionLayout(ratio);
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (width > 0 && height > 0) {
      const gap = Math.min(10, Math.floor(width / 18));
      const { columns, cardWidth } = measureTeamLayout({
        width, height, count: scoreboard.childElementCount, ratio, gap, previousColumns,
        fixedColumns: mode === 'fixed' ? fixedColumns : null,
        maxAutoColumns: Number(frame?.dataset.panelPercent) <= 10 ? 1 : 6,
        scale: scale / 100,
        minimumWidth: 132,
      });
      previousColumns = columns;
      const widthPx = Math.floor(cardWidth * 16) / 16;
      scoreboard.style.setProperty('--team-columns', String(columns));
      scoreboard.style.setProperty('--team-card-width', `${widthPx}px`);
      scoreboard.style.setProperty('--team-gap', `${gap}px`);
    }

    const style = getComputedStyle(classControls);
    const contentStyle = getComputedStyle(classContent);
    const occupied = classBanners.reduce((height,banner)=>height+(banner.offsetHeight?banner.offsetHeight+parseFloat(contentStyle.rowGap):0),0);
    const availableHeight = classContent.clientHeight-occupied-parseFloat(contentStyle.paddingTop)-parseFloat(contentStyle.paddingBottom);
    const preferred = Math.max(1,Math.min(76*scale/100,availableHeight));
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
    const fixed = mode === 'fixed';
    modeButton.textContent = fixed ? '열 지정' : '자동 배치';
    columnsRow.hidden = !fixed;
    hint.hidden = fixed;
    previousColumns = undefined;
    scheduleLayout();
  }

  let mode = readSetting(modeKey) === 'fixed' ? 'fixed' : 'auto';
  const isColumnCount = value => Number.isInteger(value) && value >= 1 && value <= 6;
  const savedColumns = Number(readSetting(columnsKey));
  let fixedColumns = isColumnCount(savedColumns) ? savedColumns : 3;
  columnsInput.value = String(fixedColumns);
  modeButton.addEventListener('click', () => {
    mode = mode === 'fixed' ? 'auto' : 'fixed';
    writeSetting(modeKey, mode);
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

  const ratioButton = document.getElementById('score-card-ratio');
  let cardRatio = [
    readSetting(ratioKey),
    readSetting('whiteboard.test.team-card-ratio.v1'),
    readSetting('whiteboard.test.class-card-ratio.v1'),
  ].find(value => value === '16:9' || value === '4:3') ?? '4:3';
  function applyRatio() {
    ratioButton.textContent = cardRatio;
    previousColumns = undefined;
    root.style.setProperty('--score-card-ratio', cardRatio.replace(':', ' / '));
    scheduleLayout();
  }
  ratioButton.addEventListener('click', () => {
    cardRatio = cardRatio === '4:3' ? '16:9' : '4:3';
    applyRatio();
    writeSetting(ratioKey, cardRatio);
  });
  applyRatio();

  document.getElementById('scoreSizeDown').addEventListener('click', () => setScale(scale - 10, true));
  document.getElementById('scoreSizeUp').addEventListener('click', () => setScale(scale + 10, true));
  document.getElementById('scoreSizeReset').addEventListener('click', () => setScale(100, true));
  if (frame) {
    const applySide = () => {
      const side = frame.dataset.scoreSide;
      root.dataset.scoreSide=side??'';
      sideRow.hidden = side !== 'left' && side !== 'right';
      sideShortcut.hidden = sideRow.hidden || frame.dataset.scoreFull === 'true';
      if (!sideRow.hidden) sideButton.textContent = side === 'left' ? '왼쪽' : '오른쪽';
      const label=side==='left'?'점수판을 오른쪽으로 이동':'점수판을 왼쪽으로 이동';
      sideShortcut.textContent=side==='left'?'>':'<';
      sideShortcut.title=label;
      sideShortcut.setAttribute('aria-label',label);
    };
    applySide();
    function toggleSide() {
      const side = frame.dataset.scoreSide === 'left' ? 'right' : 'left';
      frame.dispatchEvent(new CustomEvent('score-panel-side', { detail: side }));
      applySide();
    }
    sideButton.addEventListener('click',toggleSide);
    sideShortcut.addEventListener('click',toggleSide);
    new MutationObserver(() => {
      applySide();
      const incoming = Number(frame.dataset.syncedScoreScale);
      if (incoming>=60 && incoming<=150 && incoming!==scale) setScale(incoming);
      scheduleLayout();
    }).observe(frame, {
      attributeFilter: ['data-panel-percent', 'data-toolbar-height', 'data-synced-score-scale', 'data-score-side', 'data-score-full'],
    });
  }
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(displayArea);
  resizeObserver.observe(batch);
  resizeObserver.observe(classContent);
  for(const banner of classBanners)resizeObserver.observe(banner);
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
