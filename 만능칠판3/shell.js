const key='whiteboard3.layout.v1',workspace=document.querySelector('#workspace'),toggle=document.querySelector('#panelToggle'),splitter=document.querySelector('#splitter'),score=document.querySelector('#scorePanel');
const clamp=n=>Math.min(80,Math.max(20,n));let open=false,share=70,dragging=false;
try{const saved=JSON.parse(localStorage.getItem(key)||'{}');open=saved.open===true;share=Number.isFinite(saved.share)?clamp(saved.share):70;}catch{}
function persist(){try{localStorage.setItem(key,JSON.stringify({open,share}));}catch(error){console.warn('레이아웃 저장 실패',error);}}
function paint(){workspace.classList.toggle('closed',!open);workspace.style.setProperty('--board-share',share+'%');score.inert=!open;score.setAttribute('aria-hidden',String(!open));toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'학급 점수판 닫기':'학급 점수판 열기';splitter.setAttribute('aria-valuenow',String(Math.round(share)));splitter.tabIndex=open?0:-1;}
toggle.addEventListener('click',()=>{open=!open;paint();persist();});
function at(clientX){const rect=workspace.getBoundingClientRect();const max=rect.width-10;if(max<=0)return;share=clamp((clientX-rect.left)/max*100);paint();}
splitter.addEventListener('pointerdown',e=>{if(!open||e.button!==0)return;dragging=true;workspace.classList.add('resizing');splitter.classList.add('dragging');splitter.setPointerCapture(e.pointerId);at(e.clientX);e.preventDefault();});
splitter.addEventListener('pointermove',e=>{if(dragging)at(e.clientX);});
function stop(){if(!dragging)return;dragging=false;workspace.classList.remove('resizing');splitter.classList.remove('dragging');persist();}
splitter.addEventListener('pointerup',stop);splitter.addEventListener('pointercancel',stop);splitter.addEventListener('lostpointercapture',stop);
splitter.addEventListener('keydown',e=>{if(!open)return;const delta=e.shiftKey?10:2;if(e.key==='ArrowLeft')share=clamp(share-delta);else if(e.key==='ArrowRight')share=clamp(share+delta);else if(e.key==='Home')share=20;else if(e.key==='End')share=80;else return;e.preventDefault();paint();persist();});
paint();