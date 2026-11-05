import {VERSION,uid,clone,emptyContent,SERIAL_PROPS,MAX_BACKUP_BYTES} from './js/constants.js';
import {BoardStore,TabSync,SESSION_KEY,readLegacy} from './data.js';
import {PageHistory} from './history.js';
import {SystemClipboard} from './clipboard.js';
import {CanvasTools} from './js/canvas-tools.js';
import {QUICK_DEFAULTS,SIZE_DEFAULTS,TEXT_TYPES,targets,applyAppearance,orderedToEdge,parseQuickColors} from './js/board-options.js';
import {loadCanvas,makeThumbnail} from './js/previews.js';
import {decodeFiles} from './js/files.js';
import {validateContent} from './js/validation.js';
import {makeStatusController,shouldClosePopups} from './js/feedback.js';
const $=id=>document.getElementById(id);
let c,store,tools,sync,clipboard,current=null,pages=[],busy=true,dirty=false,saving=null,generation=0,historyBusy=false;
let autosaveTimer,toastTimer,importAbort,syncing=false,session={views:{}},modalFocus=null,confirmResolver=null,importLayoutResolver=null,passwordResolver=null;
const history=new PageHistory(),knownVersions=new Map();
const MAX_PAGES=10;
const shared={color:'#000000',level:3,sizes:structuredClone(SIZE_DEFAULTS),quick:QUICK_DEFAULTS.slice()};
let contextTarget=null,groupSession=null,suppressSelection=false;
try {session=JSON.parse(sessionStorage.getItem(SESSION_KEY)) || session;} catch {}
if(!session.views || typeof session.views!=='object')session.views={};
function notify(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
const status=makeStatusController($('saveStatus'));
// Keep transient feedback above the bottom toolbar without covering its controls.
function updateFeedbackPosition(){
  const bar=$('toolbarScaleWrap'),rect=bar?.getBoundingClientRect();
  const reserved=rect && rect.height>0 ? Math.max(0,innerHeight-rect.top)+10 : 12;
  $('feedbackStack').style.bottom=`calc(${reserved}px + env(safe-area-inset-bottom, 0px))`;
}
function fail(error) {console.error(error);notify(error?.message || String(error));}
function modalOpen() {return Array.from(document.querySelectorAll('.modal')).some(m=>m.style.display==='flex');}
function isTextEditing() {
  return !!c?.getActiveObject()?.isEditing;
}
function isFormEditing() {
  const e=document.activeElement;return !!(e && e.matches('input,textarea,select,[contenteditable="true"]'));
}
function allowed() {return !!current&&!busy&&!modalOpen()&&!tools?.gesture;}
function rememberView() {
  if(!current || !c)return;
  session.activeId=current.id;session.views[current.id]=c.viewportTransform.slice();
  try {sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));} catch {}
  $('zoomLabel').textContent=`${Math.round(c.getZoom()*100)}%`;
}
function normalizedObjects(objects) {
  objects.forEach(o=>{o.selectable=true;o.evented=true;o.visible=true;delete o.customLayer;if(o.objects)normalizedObjects(o.objects);});
}
function capture() {
  const json=c.toJSON(SERIAL_PROPS);normalizedObjects(json.objects);
  return {canvas:json,frame:{...current.content.frame,width:c.width,height:c.height}};
}
function changed({recordHistory=true}={}) {
  if(!current)return;
  current.content=capture();dirty=true;generation++;
  if(recordHistory)history.push(current.id,current.content);
  status('저장 대기 중입니다.');updateHistory();
  clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>flush().catch(fail),350);
}
async function flush() {
  clearTimeout(autosaveTimer);
  if(saving)return saving;
  if(!dirty || !current)return;
  let succeeded=false;
  saving=(async()=>{
    while(dirty) {
      const local=clone(current),g=generation;
      status('자동저장 중입니다.');
      const result=await store.commitPage(local,local.version);
      const oldId=current.id;
      if(result.conflict) {
        current.id=result.page.id;current.name=result.page.name;current.order=result.page.order;
        current.createdAt=result.page.createdAt;
        if(history.pages.has(oldId)){history.pages.set(current.id,history.pages.get(oldId));history.pages.delete(oldId);}
        session.views[current.id]=c.viewportTransform.slice();
        notify('다른 탭의 변경과 충돌하여 내 작업을 별도의 충돌 복구 페이지에 보존했습니다.');
      }
      current.version=result.page.version;current.updatedAt=result.page.updatedAt;
      knownVersions.set(current.id,current.version);
      if(g===generation)dirty=false;
      sync?.notify();rememberView();
    }
    pages=await store.listPages();renderPages();succeeded=true;if(!dirty)status('자동저장 완료');
  })().catch(error=>{status('저장 실패 · JSON 백업을 해주세요.','error');throw error;}).finally(()=>{saving=null;if(succeeded&&dirty){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>flush().catch(fail),100);}});
  return saving;
}
function finishText() {const o=c?.getActiveObject();if(o?.isEditing)o.exitEditing();if(groupSession && !o?.isEditing)closeGroupSession();}
function restoreInteraction() {
  if(!c || !tools)return;
  c.isDrawingMode=tools.mode==='pen'||tools.mode==='marker';c.selection=tools.mode==='select';c.skipTargetFind=tools.mode==='move';
  c.getObjects().forEach(o=>o.set({selectable:tools.mode==='select',evented:true}));c.requestRenderAll();
}
async function run(fn,label='처리 중입니다.') {
  if(busy || tools?.gesture){notify('현재 작업을 마친 뒤 다시 시도해주세요.');return;}
  finishText();busy=true;closePopups();
  c.isDrawingMode=false;c.selection=false;c.skipTargetFind=true;
  try {await fn();}catch(e){if(e?.name==='AbortError')notify('가져오기를 취소했습니다.');else fail(e);}
  finally {busy=false;importAbort=null;restoreInteraction();updateHistory();}
}
async function setPage(page,reset=false,keepView=true) {
  rememberView();const previous=current?clone(current):null;
  current=clone(page);const pageNumber=Math.min(MAX_PAGES,Math.max(1,pages.findIndex(p=>p.id===page.id)+1));current.name=`페이지 ${pageNumber}`;dirty=false;
  try {await loadCanvas(c,current.content.canvas);}catch(error){
    current=previous;if(previous)await loadCanvas(c,previous.content.canvas);throw error;
  }
  tools.setMode('select');
  const view=keepView?session.views[current.id]:null;
  if(Array.isArray(view)&&view.length===6&&view.every(Number.isFinite)&&view[0]>=0.1&&view[0]<=10) {
    c.setViewportTransform(view.slice());rememberView();
  } else tools.home(current.content.frame);
  if(reset || !history.pages.has(page.id) || knownVersions.get(page.id)!==page.version)history.reset(page.id,current.content);
  knownVersions.set(page.id,page.version);renderPages();updateHistory();updateSelectionActions();status('자동저장 완료');
}
async function activatePage(id) {
  await flush();const p=await store.getPage(id);if(!p || p.deleted)throw Error('삭제된 페이지입니다.');await setPage(p);
}
async function createPage(content) {
  await flush();
  if(pages.length>=MAX_PAGES){notify(`페이지는 최대 ${MAX_PAGES}개까지 사용할 수 있습니다.`);return;}
  const now=Date.now(),number=pages.length+1;
  const result=await store.commitPage({id:uid(),name:`페이지 ${number}`,content,version:0,order:now,createdAt:now},0);
  sync.notify();pages=await store.listPages();await setPage(result.page,true,false);
}
function renderPages() {
  pages=pages.slice(0,MAX_PAGES);
  const index=Math.max(0,pages.findIndex(p=>p.id===current?.id));
  $('currentPageInput').value=String(index+1);
  $('prevPageBtn').disabled=index<=0 || pages.length<=1;
  $('nextPageBtn').disabled=index<0 || index>=pages.length-1 || pages.length<=1;
  $('addPageBtn').disabled=pages.length>=MAX_PAGES;
  $('duplicatePageBtn').disabled=pages.length>=MAX_PAGES;
  $('deletePageBtn').disabled=pages.length<=1;
}
function pageIndex() { return Math.max(0,pages.findIndex(p=>p.id===current?.id)); }
async function goToPageNumber(value) {
  if(busy||!current)return;
  const parsed=Number.parseInt(String(value).trim(),10);
  if(!Number.isFinite(parsed)) {renderPages();return;}
  const target=Math.min(MAX_PAGES,Math.max(1,parsed));
  const max=Math.min(MAX_PAGES,pages.length);
  if(target>max){renderPages();return;}
  const p=pages[target-1]; if(p && p.id!==current.id) await activatePage(p.id); else renderPages();
}
function updateHistory() {
  // Undo/Redo availability reflects history state only. A save/import operation must not
  // permanently make the controls appear disabled. historyBusy prevents double execution.
  $('undoBtn').disabled=!current||historyBusy||!history.canUndo(current.id);
  $('redoBtn').disabled=!current||historyBusy||!history.canRedo(current.id);
  const object=c?.getActiveObject();
  $('deleteSelectionBtn').disabled=busy||!current;
  updateSelectionActions();
}
function updateSelectionActions() { if(!c)return; $('moreTextPropsBtn').disabled=!targets(c.getActiveObject()).some(o=>TEXT_TYPES.has(o.type)); }
async function stepHistory(direction) {
  if(!current || historyBusy || busy || modalOpen() || tools?.gesture || isTextEditing()) return;
  const before=history.pages.get(current.id)?.index;
  const content=history.step(current.id,direction);
  if(!content){updateHistory();return;}
  historyBusy=true; updateHistory();
  try {
    await loadCanvas(c,content.canvas);
    current.content=content;
    tools.setMode('select');
    dirty=true; generation++;
    // Save the resulting state, but do not create another history entry.
    await flush();
  } catch(e) {
    const h=history.pages.get(current.id);
    if(h) h.index=before;
    await loadCanvas(c,current.content.canvas);
    throw e;
  } finally {
    historyBusy=false;
    updateHistory();
  }
}
function deleteSelected() {
  if(!allowed() || isTextEditing())return;
  const objects=c.getActiveObjects();if(!objects.length)return;
  c.discardActiveObject();objects.forEach(o=>c.remove(o));c.requestRenderAll();changed();
}
function groupObjects(ungroup=false) {
  if(!allowed() || isTextEditing())return;
  const o=c.getActiveObject();
  if(ungroup && o?.type==='group')o.toActiveSelection();
  else if(!ungroup && o?.type==='activeSelection'){const group=o.toGroup();group.id=uid();}
  else return;
  c.getObjects().forEach(o=>o.setCoords());c.requestRenderAll();changed();updateHistory();
}
function addText(text,point,editing=false) {
  if(text.length>100000)throw Error('텍스트는 한 번에 10만 글자 이하여야 합니다.');
  tools.setMode('select');
  const center=point || fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform));
  const object=new fabric.IText(text,{left:center.x,top:center.y,fontFamily:'Arial',fontSize:tools.text.size,fill:tools.text.color,backgroundColor:'',stroke:null,strokeWidth:0,id:uid()});
  if(!point)object.setPositionByOrigin(center,'center','center');
  c.add(object);c.setActiveObject(object);object.setCoords();c.requestRenderAll();changed({recordHistory:!editing});
  if(editing){object.enterEditing();object.selectAll();}
}
function chooseImportColumns(count) {
  if(count<=1)return Promise.resolve(1);
  return new Promise(resolve=>{
    importLayoutResolver=resolve;
    const modal=$('importLayoutModal');
    $('importLayoutCount').textContent=`${count}개 항목을 몇 열로 배치할까요?`;
    const buttons=Array.from(modal.querySelectorAll('[data-columns]'));
    const finish=value=>{importLayoutResolver=null;$('importLayoutModal').style.display='none';if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;resolve(value);};
    buttons.forEach(b=>b.onclick=()=>finish(Number(b.dataset.columns)));
    openModal('importLayoutModal');
    buttons.forEach(b=>b.classList.toggle('selected',Number(b.dataset.columns)===Math.min(4,count)));
  });
}
async function importFiles(files,point) {
  await flush();
  const beforeContent=clone(current.content),beforeIndex=history.pages.get(current.id)?.index ?? 0;
  importAbort=new AbortController();
  const decoded=await decodeFiles(files,{signal:importAbort.signal,requestPassword:askPassword});
  if(!decoded.length)return;
  const columns=await chooseImportColumns(decoded.length);
  if(!columns)return;
  tools.setMode('select');
  const center=point || fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform));
  const gap=24, maxWidth=Math.min(800,c.width/c.getZoom()*0.75), cellWidth=Math.max(40,(maxWidth-gap*(columns-1))/columns);
  const added=[];
  for(let i=0;i<decoded.length;i++) {
    const image=decoded[i].image;
    image.scale(Math.min(1,cellWidth/image.width));
    const col=i%columns;
    const rowStartX=center.x-maxWidth/2;
    image.set({left:rowStartX+col*(cellWidth+gap)+(cellWidth-image.getScaledWidth())/2,top:center.y,id:uid()});
    image.setCoords();c.add(image);added.push(image);
  }
  // Recompute row positions so each row uses its own height and remains left-aligned.
  let y=center.y;
  for(let row=0;row<Math.ceil(added.length/columns);row++) {
    const items=added.slice(row*columns,(row+1)*columns);
    const rowH=Math.max(...items.map(o=>o.getScaledHeight()));
    items.forEach((o,col)=>{o.set({top:y});o.setCoords();});
    y+=rowH+gap;
  }
  try {
    c.setActiveObject(added.length===1?added[0]:new fabric.ActiveSelection(added,{canvas:c}));c.requestRenderAll();changed();
    await flush();
    notify(`${added.length}개 이미지를 ${columns}열로 배치했습니다.`);
  } catch(error) {
    const h=history.pages.get(current.id);if(h)h.index=beforeIndex;
    current.content=beforeContent;dirty=false;generation++;
    await loadCanvas(c,beforeContent.canvas);tools.setMode('select');c.requestRenderAll();updateHistory();
    throw error;
  }
}

function syncSharedUI(){
  for(const key of ['pen','marker','text']){tools[key][key==='text'?'size':'width']=shared.sizes[key][shared.level-1];tools[key].color=shared.color;}
  tools.updateBrush();$('sharedColorInput').value=shared.color;$('sharedLevelSelect').value=String(shared.level);
  const colors=$('quickColors');colors.replaceChildren();
  shared.quick.forEach(color=>{const button=document.createElement('button');button.type='button';button.style.backgroundColor=color;button.title=color;button.setAttribute('aria-label',`빠른 색상 ${color}`);button.classList.toggle('selected',color===shared.color);button.onclick=()=>setShared({color});colors.append(button);});
  const sizes=$('quickSizes');sizes.replaceChildren();
  for(let level=1;level<=5;level++){const button=document.createElement('button');button.type='button';button.textContent=String(level);button.title=`크기 ${level}단계`;button.classList.toggle('selected',level===shared.level);button.onclick=()=>setShared({level});sizes.append(button);}
  renderQuickSlots();
}
function renderQuickSlots(){
  const box=$('quickColorSlots');box.replaceChildren();
  for(const color of shared.quick){const b=document.createElement('button');b.type='button';b.textContent=`${color} 해제`;b.title='빠른 색상에서 해제';b.onclick=()=>{shared.quick=shared.quick.filter(x=>x!==color);saveQuick();syncSharedUI();};box.append(b);}
  const add=document.createElement('button');add.type='button';add.textContent=`현재 색상 ${shared.color} 등록`;add.disabled=shared.quick.length>=5||shared.quick.includes(shared.color);
  add.onclick=()=>{shared.quick.push(shared.color);saveQuick();syncSharedUI();};box.append(add);
  const note=document.createElement('small');note.textContent='빠른 슬롯을 해제해도 현재 색상은 유지됩니다.';box.append(note);
}
function saveQuick(){try{localStorage.setItem('wb42.quickColors',JSON.stringify(shared.quick));}catch{}}
function setShared({color,level}={}){
  if(!current||busy)return;
  if(color && !/^#[0-9a-f]{6}$/i.test(color))return;
  if(color)shared.color=color.toLowerCase();
  if(level && Number.isInteger(Number(level)) && +level>=1 && +level<=5)shared.level=+level;
  const active=c.getActiveObject(),n=applyAppearance(active,{color:color?shared.color:null,level:level?shared.level:null,sizes:shared.sizes});
  if(n){if(active?.type==='group')active.dirty=true;active?.setCoords?.();c.requestRenderAll();changed();}
  syncSharedUI();
}
function sizeMappingUI(){const box=$('sizeMapping');box.replaceChildren();for(const [key,label] of [['pen','펜 굵기(px)'],['marker','형광펜 굵기(px)'],['text','텍스트 크기(px)']]){
  const row=document.createElement('div');row.textContent=label+'  ';
  for(let i=0;i<5;i++){const lab=document.createElement('label');lab.textContent=String(i+1);const input=document.createElement('input');input.type='number';input.min='1';input.max=key==='text'?'300':'120';input.value=String(shared.sizes[key][i]);input.setAttribute('aria-label',`${label} ${i+1}단계`);
    input.onchange=()=>{const n=Number(input.value);if(!Number.isFinite(n)||n<1||n>Number(input.max)){input.value=String(shared.sizes[key][i]);return;}shared.sizes[key][i]=n;if(i===shared.level-1){const selection=c.getActiveObject(),items=targets(selection).filter(o=>key==='text'?TEXT_TYPES.has(o.type):key==='marker'?o.type==='path'&&o.isHighlighter:o.type==='path'&&!o.isHighlighter);for(const o of items){o.set(key==='text'?'fontSize':'strokeWidth',n);o.setCoords();}if(items.length){selection?.setCoords?.();c.requestRenderAll();changed();}}syncSharedUI();};lab.append(input);row.append(lab);
  }box.append(row);
}}
function selectedText(){return targets(c.getActiveObject()).filter(o=>TEXT_TYPES.has(o.type));}
function openTextProps(){if(!selectedText().length){notify('먼저 텍스트박스를 선택해주세요.');return;}const o=selectedText()[0];$('textBgEnabled').checked=!!o.backgroundColor;$('textBgColor').value=/^#[0-9a-f]{6}$/i.test(o.backgroundColor||'')?o.backgroundColor:'#ffffff';$('textBorderEnabled').checked=!!(o.stroke&&o.strokeWidth);$('textBorderColor').value=/^#[0-9a-f]{6}$/i.test(o.stroke||'')?o.stroke:'#000000';$('textBorderWidth').value=String(o.strokeWidth||2);openModal('textPropsModal');}
function updateTextProps(){const list=selectedText();if(!list.length)return;for(const o of list){o.set({backgroundColor:$('textBgEnabled').checked?$('textBgColor').value:'',stroke:$('textBorderEnabled').checked?$('textBorderColor').value:null,strokeWidth:$('textBorderEnabled').checked?Math.max(1,Math.min(30,Number($('textBorderWidth').value)||2)):0});o.setCoords();}c.getActiveObject()?.setCoords?.();c.requestRenderAll();changed();}
function layerToEdge(front){if(!allowed()||isTextEditing())return;const selection=c.getActiveObjects();if(!selection.length)return;const all=c.getObjects(),next=orderedToEdge(all,selection,front);if(next.every((o,i)=>o===all[i]))return;next.forEach((o,i)=>c.moveTo(o,i));c.requestRenderAll();changed();}
function closeContext(){const menu=$('objectContextMenu');if(menu)menu.hidden=true;contextTarget=null;}
function openContext(x,y,target=null){if(!allowed()||tools.mode!=='select')return;closePopups();if(target && !c.getActiveObjects().includes(target)){c.setActiveObject(target);c.requestRenderAll();}
 const active=c.getActiveObject();if(!active)return;contextTarget=active;const menu=$('objectContextMenu');$('contextGroup').hidden=active.type!=='activeSelection';$('contextUngroup').hidden=active.type!=='group';$('contextTextProps').hidden=!selectedText().length;
 menu.hidden=false;menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,x))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,y))+'px';menu.querySelector('button:not([hidden])')?.focus();
}
function beginGroupSession(group,child){if(!group ||group.type!=='group')return;const id=group.id,index=c.getObjects().indexOf(group),all=group.getObjects().slice();
 suppressSelection=true;try{const selection=group.toActiveSelection();groupSession={id,index,all};c.discardActiveObject();c.setActiveObject(child||all[0]);c.requestRenderAll();}finally{suppressSelection=false;}}
function closeGroupSession(){if(!groupSession||!c)return;const state=groupSession;groupSession=null;const live=state.all.filter(o=>c.getObjects().includes(o));if(live.length<2)return;
 suppressSelection=true;try{c.discardActiveObject();const selection=new fabric.ActiveSelection(live,{canvas:c});c.setActiveObject(selection);const group=selection.toGroup();group.id=state.id;c.moveTo(group,Math.min(state.index,c.getObjects().length-1));group.setCoords();c.requestRenderAll();changed();}finally{suppressSelection=false;}}
async function makeCurrentViewportThumbnail(width=320) {
  const ratio=width/Math.max(1,c.getWidth());
  return c.toDataURL({format:'png',multiplier:ratio});
}
let openedPopup=null;
function closePopups() {closeContext();document.querySelectorAll('.tip-up-settings').forEach(p=>p.style.display='none');document.querySelectorAll('[data-popup]').forEach(b=>b.setAttribute('aria-expanded','false'));openedPopup=null;}
function togglePopup(id,button) {
  if(busy)return;
  const was=openedPopup===id;closePopups();if(was)return;
  const p=$(id);p.style.display='block';openedPopup=id;button.setAttribute('aria-expanded','true');
  const rect=button.getBoundingClientRect();p.style.left=Math.max(8,Math.min(window.innerWidth-p.offsetWidth-8,rect.left+rect.width/2-p.offsetWidth/2))+'px';
  p.style.top=Math.max(8,rect.top-p.offsetHeight-8)+'px';
}
function openModal(id) {closePopups();finishText();modalFocus=document.activeElement;$(id).style.display='flex';$(id).querySelector('input,button')?.focus();}
function closeModal(id) {
  $(id).style.display='none';
  if(id==='confirmModal' && confirmResolver){const resolve=confirmResolver;confirmResolver=null;resolve(false);}
  if(id==='importLayoutModal' && importLayoutResolver){const resolve=importLayoutResolver;importLayoutResolver=null;resolve(null);}
  if(id==='passwordModal' && passwordResolver){const resolve=passwordResolver;passwordResolver=null;resolve(null);}
  if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;
}
function askConfirm(message,{title='확인',confirmText='확인',cancelText='취소'}={}) {
  return new Promise(resolve=>{
    if(confirmResolver)confirmResolver(false);
    confirmResolver=resolve;
    $('confirmModalTitle').textContent=title;
    $('confirmModalMessage').textContent=message;
    $('confirmModalOkBtn').textContent=confirmText;
    $('confirmModalCancelBtn').textContent=cancelText;
    openModal('confirmModal');
  });
}
function resolveConfirm(value) {
  const resolve=confirmResolver;confirmResolver=null;
  $('confirmModal').style.display='none';
  if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;
  resolve?.(value);
}
function askPassword(message) {
  return new Promise(resolve=>{
    if(passwordResolver)passwordResolver(null);passwordResolver=resolve;
    $('passwordModalMessage').textContent=message;
    $('pdfPasswordInput').value='';
    openModal('passwordModal');
  });
}
function resolvePassword(value) {
  const resolve=passwordResolver;passwordResolver=null;
  $('passwordModal').style.display='none';
  if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;
  resolve?.(value);
}
async function renderSavedScreens() {
  const screens=await store.listScreens();const box=$('savedScreenList');box.replaceChildren();$('noSavedScreens').hidden=!!screens.length;
  for(const screen of screens) {
    const li=document.createElement('li');li.className='saved-screen-list-item';
    const img=document.createElement('img');img.className='saved-preview';img.alt=`${screen.name}: 저장 당시 위치와 배율 미리보기`;img.loading='lazy';
    if(screen.thumbnail)img.src=screen.thumbnail;
    else {try{const v=screen.view||{};img.src=await makeThumbnail(screen.content,v.viewportTransform,v.width,v.height);}catch{img.alt='미리보기를 생성하지 못했습니다.';}}
    const info=document.createElement('div');info.className='screen-info-container';
    const name=document.createElement('span');name.className='screen-name-display';name.textContent=screen.name;
    const time=document.createElement('span');time.className='screen-timestamp-display';time.textContent=new Date(screen.savedAt).toLocaleString('ko-KR');
    info.append(name,time);
    const actions=document.createElement('div');actions.className='screen-item-actions';
    const load=document.createElement('button');load.className='action-btn';load.textContent='새 페이지로 열기';load.onclick=()=>run(async()=>{await createPage(clone(screen.content));closeModal('loadSavedScreenModal');});
    const del=document.createElement('button');del.className='action-btn delete-saved-item-btn';del.textContent='삭제';del.onclick=()=>{
      askConfirm(`저장 화면 “${screen.name}”을 삭제할까요? 되돌릴 수 없습니다.`,{title:'저장 화면 삭제',confirmText:'삭제'}).then(ok=>{if(ok)run(async()=>{await store.deleteScreen(screen.id);sync.notify();await renderSavedScreens();});});
    };
    actions.append(load,del);li.append(img,info,actions);box.append(li);
  }
}
function downloadJSON(data,name) {
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportBackup() {
  let saveError=false;try{await flush();}catch{saveError=true;}
  const all=await store.listPages();
  if(current && dirty){const index=all.findIndex(p=>p.id===current.id),local={...clone(current),content:capture()};if(index>=0)all[index]=local;else all.push(local);}
  downloadJSON({format:'whiteboard-pages',schema:2,appVersion:VERSION,exportedAt:new Date().toISOString(),pages:all,screens:await store.listScreens()},`만능칠판-백업-${new Date().toISOString().slice(0,10)}.json`);
  if(saveError)notify('자동저장 실패 상태의 현재 작업도 백업 파일에 포함했습니다.');
}
function reidentify(json) {json.objects?.forEach(o=>{o.id=uid();reidentify(o);});}
async function importBackup(file) {
  if(file.size>MAX_BACKUP_BYTES)throw Error('백업 파일은 100MB 이하여야 합니다.');
  const input=JSON.parse(await file.text());
  if(input.format!=='whiteboard-pages'||input.schema!==2||!Array.isArray(input.pages)||!Array.isArray(input.screens))throw Error('만능칠판 2.0 백업 파일이 아닙니다.');
  if(input.pages.length+input.screens.length>1000)throw Error('백업 항목은 1,000개까지 한 번에 가져올 수 있습니다.');
  const now=Date.now();
  const imported=input.pages.map((p,i)=>{const content=validateContent(p.content);reidentify(content.canvas);return {id:uid(),name:`페이지 ${Math.min(MAX_PAGES,i+1)}`,content,version:1,order:now+i,createdAt:now,updatedAt:now};});
  const screens=[];
  for(const s of input.screens) {
    const content=validateContent(s.content);
    screens.push({id:uid(),name:String(s.name||'가져온 화면').slice(0,100),savedAt:now,content,thumbnail:await makeThumbnail(content)});
  }
  await flush();await store.appendBackup(imported,screens);sync.notify();pages=await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  if(imported.length)await setPage(imported[0],true,false);else renderPages();
  notify(`페이지 ${imported.length}개와 저장 화면 ${screens.length}개를 추가했습니다. 기존 데이터는 유지했습니다.`);
}
async function importLegacy() {
  if(await store.getMeta('legacyImported') && !(await askConfirm('이전 데이터를 이미 가져온 적이 있습니다. 다시 가져오면 중복될 수 있습니다. 계속할까요?',{title:'이전 데이터 가져오기',confirmText:'계속'})))return;
  const legacy=await readLegacy();if(!legacy.auto && !legacy.screens.length){notify('이 주소에서 구버전 저장 데이터를 찾지 못했습니다.');return;}
  const clean=json=>{
    const content={canvas:typeof json==='string'?JSON.parse(json):clone(json),frame:{width:c.width,height:c.height,cx:2400,cy:1600}};
    normalizedObjects(content.canvas.objects || []);return validateContent(content);
  };
  const now=Date.now(),imported=[],screens=[];
  if(legacy.auto)imported.push({id:uid(),name:'페이지 1',content:clean(legacy.auto),version:1,order:now,createdAt:now,updatedAt:now});
  for(const s of legacy.screens) {
    const content=clean(s.canvasData || s);screens.push({id:uid(),name:String(s.displayName||'이전 저장 화면').slice(0,100),savedAt:now,content,thumbnail:await makeThumbnail(content)});
  }
  await flush();await store.appendBackup(imported,screens);await store.setMeta('legacyImported',true);sync.notify();pages=await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  if(imported.length)await setPage(imported[0],true,false);else renderPages();
  notify(`이전 자동저장 ${imported.length}개와 저장 화면 ${screens.length}개를 가져왔습니다. 원본 데이터는 유지했습니다.`);
}
async function refreshRemote() {
  if(syncing || busy || dirty || saving || tools?.gesture || isTextEditing() || modalOpen() || !current)return;
  syncing=true;
  try {
    const all=await store.listPages();
    if(busy || dirty || saving || tools.gesture || isTextEditing() || modalOpen())return;
    pages=all;const remote=all.find(p=>p.id===current.id);
    if(!remote || remote.version!==current.version) {
      await run(async()=>{
        const next=remote || all[0] || await store.ensurePage(emptyContent(c.width,c.height));
        if(!all.length)pages=await store.listPages();
        await setPage(next,true);status('다른 탭의 변경을 반영했습니다.');
      },'다른 탭의 변경을 반영하는 중입니다.');
    } else renderPages();
  } catch(e){console.error('탭 동기화 오류',e);status('동기화 확인 실패','error');}
  finally{syncing=false;}
}
function wireUI() {
  document.querySelectorAll('[data-popup]').forEach(b=>b.onclick=()=>{
    const mode=b.dataset.toolMode;
    if(mode && allowed()){finishText();tools.setMode(mode);}
    togglePopup(b.dataset.popup,b);
  });
  document.addEventListener('pointerdown',e=>{if(shouldClosePopups(e.target))closePopups();});
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  $('confirmModalOkBtn').onclick=()=>resolveConfirm(true);$('confirmModalCancelBtn').onclick=()=>resolveConfirm(false);
  $('passwordModalOkBtn').onclick=()=>resolvePassword($('pdfPasswordInput').value);
  $('passwordModalCancelBtn').onclick=()=>resolvePassword(null);
  $('pdfPasswordInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('passwordModalOkBtn').click();}});
  document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);}));
  const modeMap={penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser'};
  Object.entries(modeMap).forEach(([id,mode])=>$(id).onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode===mode?'select':mode);});
  $('selectMoveToggleBtn').onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode==='select'?'move':'select');};
  $('deleteSelectionBtn').onclick=deleteSelected;
  $('laserModeBtn').onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode==='laser'?'select':'laser');};
  $('sharedColorInput').oninput=e=>setShared({color:e.target.value});$('sharedLevelSelect').onchange=e=>setShared({level:e.target.value});
  $('pageBgInput').oninput=e=>{if(!allowed())return;c.setBackgroundColor(e.target.value,()=>c.requestRenderAll());changed();};
  for(const id of ['textBgEnabled','textBgColor','textBorderEnabled','textBorderColor','textBorderWidth'])$(id).onchange=updateTextProps;
  $('moreTextPropsBtn').onclick=openTextProps;
  $('contextGroup').onclick=()=>{closeContext();groupObjects();};$('contextUngroup').onclick=()=>{closeContext();groupObjects(true);};
  $('contextFront').onclick=()=>{closeContext();layerToEdge(true);};$('contextBack').onclick=()=>{closeContext();layerToEdge(false);};
  $('contextTextProps').onclick=()=>{closeContext();openTextProps();};
  // A stationary 600ms touch press opens the object menu; movement cancels it.
  let pressTimer=null,pressStart=null,suppressNextClick=false;
  const surface=c.upperCanvasEl;
  surface.addEventListener('contextmenu',e=>{if(tools.mode!=='select')return;e.preventDefault();const target=c.findTarget(e);openContext(e.clientX,e.clientY,target);});
  surface.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||tools.mode!=='select')return;const target=c.findTarget(e);if(!target)return;pressStart={x:e.clientX,y:e.clientY};pressTimer=setTimeout(()=>{pressTimer=null;suppressNextClick=true;tools.up();openContext(e.clientX,e.clientY,target);},600);});
  surface.addEventListener('pointermove',e=>{if(pressStart&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>9){clearTimeout(pressTimer);pressTimer=null;pressStart=null;}});
  for(const type of ['pointerup','pointercancel'])surface.addEventListener(type,()=>{clearTimeout(pressTimer);pressTimer=null;pressStart=null;});
  surface.addEventListener('click',e=>{if(suppressNextClick){e.stopImmediatePropagation();suppressNextClick=false;}},true);
  // Outside-click dismissal is handled above; menu buttons must stay visible through click.
  let blankClick=null;
  c.on('mouse:down:before',opt=>{
    if(tools.mode!=='select'||!opt.e||opt.e.button!==0)return;
    const active=c.getActiveObject(),target=c.findTarget(opt.e);
    if(!active||target || active.type!=='activeSelection')return;
    const p=c.getPointer(opt.e),b=active.getBoundingRect(true,true);
    if(p.x>=b.left&&p.x<=b.left+b.width&&p.y>=b.top&&p.y<=b.top+b.height){
      blankClick={active,at:Date.now()};
    }else blankClick=null;
  });
  c.on('mouse:up',()=>{
    if(!blankClick)return;const {active,at}=blankClick;blankClick=null;
    if(Date.now()-at<450&&!c.getActiveObject()&&active.getObjects?.().every(o=>c.getObjects().includes(o))){c.setActiveObject(active);c.requestRenderAll();}
  });
  c.on('mouse:dblclick',opt=>{
    if(tools.mode!=='select'||!current||busy||modalOpen())return;
    const o=opt.target;
    if(o?.type==='group'){const child=opt.subTargets?.find(x=>TEXT_TYPES.has(x.type))||opt.subTargets?.[0]||o.getObjects()[0];beginGroupSession(o,child);if(child && TEXT_TYPES.has(child.type)){child.enterEditing();child.selectAll();}}
    else if(o&&TEXT_TYPES.has(o.type)){c.setActiveObject(o);o.enterEditing();o.selectAll();}
    else if(!o&&c.getActiveObject()) {c.discardActiveObject();c.requestRenderAll();}
  });
  c.on('selection:cleared',()=>{if(!suppressSelection&&groupSession&&!isTextEditing())closeGroupSession();});
  surface.addEventListener('pointerdown',e=>{if(isTextEditing() && !c.findTarget(e)?.isEditing)finishText();},true);
  $('undoBtn').onclick=()=>stepHistory(-1).catch(fail);$('redoBtn').onclick=()=>stepHistory(1).catch(fail);
  const clearPage=async()=>{if(!allowed())return;if(await askConfirm('현재 페이지의 모든 객체를 지울까요? 언두로 되돌릴 수 있습니다.',{title:'현재 페이지 전체 지우기',confirmText:'전체 지우기'})){finishText();c.discardActiveObject();const list=c.getObjects().slice();if(list.length){list.forEach(o=>c.remove(o));c.requestRenderAll();changed();}}};
  let deleteTimer=null,deleteLong=false;
  $('deleteSelectionBtn').addEventListener('pointerdown',e=>{if(e.button!==0)return;deleteLong=false;deleteTimer=setTimeout(()=>{deleteLong=true;clearPage().catch(fail);},600);});
  for(const type of ['pointerup','pointercancel','pointerleave'])$('deleteSelectionBtn').addEventListener(type,()=>{clearTimeout(deleteTimer);deleteTimer=null;});
  $('deleteSelectionBtn').onclick=e=>{if(deleteLong){e.preventDefault();deleteLong=false;return;}deleteSelected();};
  $('zoomInBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()*1.25);};$('zoomOutBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()/1.25);};$('homeBtn').onclick=()=>{if(allowed())tools.home(current.content.frame);};
  $('toolbarHideBtn').onclick=()=>{const hidden=!$('toolbar').hidden;$('toolbar').hidden=hidden;$('toolbarHideBtn').textContent=hidden?'▲':'▼';$('toolbarHideBtn').setAttribute('aria-expanded',String(!hidden));closePopups();updateFeedbackPosition();};
  $('prevPageBtn').onclick=()=>{const i=pageIndex();if(i>0)run(()=>activatePage(pages[i-1].id),'이전 페이지를 불러오는 중입니다.');};
  $('nextPageBtn').onclick=()=>{const i=pageIndex();if(i>=0&&i<pages.length-1)run(()=>activatePage(pages[i+1].id),'다음 페이지를 불러오는 중입니다.');};
  $('currentPageInput').addEventListener('change',e=>run(()=>goToPageNumber(e.target.value),'페이지를 불러오는 중입니다.'));
  $('currentPageInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur();}});
  $('addPageBtn').onclick=()=>run(()=>createPage(emptyContent(c.width,c.height)));
  $('duplicatePageBtn').onclick=()=>run(()=>{const content=capture();reidentify(content.canvas);return createPage(content);});
  $('deletePageBtn').onclick=async()=>{if(!allowed()||pages.length<=1)return;if(await askConfirm('현재 페이지를 삭제할까요? 페이지 삭제는 되돌릴 수 없습니다.',{title:'페이지 삭제',confirmText:'삭제'}))run(async()=>{
    await flush();const id=current.id;await store.deletePage(id,current.version);history.remove(id);delete session.views[id];sync.notify();pages=await store.listPages();
    if(!pages.length){await store.ensurePage(emptyContent(c.width,c.height));pages=await store.listPages();}
    await setPage(pages[0]);
  });};
  $('saveBtn').onclick=()=>{if(!allowed())return;$('saveScreenNameInput').value=current.name;openModal('saveConfirmModal');$('saveScreenNameInput').focus();$('saveScreenNameInput').select();};
  $('confirmSaveBtn').onclick=()=>run(async()=>{
    const name=$('saveScreenNameInput').value.trim() || '제목 없음';await flush();const content=capture(),view={viewportTransform:c.viewportTransform.slice(),width:c.width,height:c.height},thumbnail=await makeCurrentViewportThumbnail();
    await store.putScreen({id:uid(),name,savedAt:Date.now(),content,view,thumbnail});sync.notify();closeModal('saveConfirmModal');notify('현재 페이지를 저장 화면으로 보관했습니다.');
  },'저장 화면을 만드는 중입니다.');
  $('saveScreenNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('confirmSaveBtn').click();}});
  $('loadGeneralBtn').onclick=()=>run(async()=>{await renderSavedScreens();openModal('loadSavedScreenModal');});
  $('copyBtn').onclick=()=>clipboard.copy();$('pasteBtn').onclick=()=>clipboard.paste();
  $('importFileBtn').onclick=()=>{closePopups();$('fileInput').click();};
  $('colorSettingsBtn').onclick=()=>{if(busy)return;$('pageBgInput').value=/^#[0-9a-f]{6}$/i.test(c.backgroundColor||'')?c.backgroundColor:'#D6B588';sizeMappingUI();syncSharedUI();openModal('sharedSettingsModal');};
  $('fileInput').onchange=e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)run(()=>importFiles(files),'파일을 가져오는 중입니다.');};
  $('exportBackupBtn').onclick=()=>run(exportBackup,'백업 파일을 만드는 중입니다.');
  $('importBackupBtn').onclick=()=>{closePopups();$('backupInput').click();};
  $('backupInput').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)run(()=>importBackup(file),'백업을 가져오는 중입니다.');};
  $('importLegacyBtn').onclick=()=>run(importLegacy,'이전 데이터를 읽는 중입니다.');
  $('helpBtn').onclick=()=>openModal('helpModal');
  let dragDepth=0;
  document.addEventListener('dragenter',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();dragDepth++;if(!busy&&!modalOpen())$('dropOverlay').hidden=false;}});
  document.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';}});
  document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').hidden=true;});
  document.addEventListener('drop',e=>{
    e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;const files=Array.from(e.dataTransfer?.files||[]);
    if(!files.length || !allowed())return;
    run(()=>importFiles(files),'파일을 가져오는 중입니다.');
  });
  let spaceMode=null;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') {closeContext();closePopups();document.querySelectorAll('.modal').forEach(m=>{if(m.style.display==='flex')closeModal(m.id);});if(!busy)finishText();return;}
    if(modalOpen()) {
      if(e.key==='Tab') {
        const m=Array.from(document.querySelectorAll('.modal')).find(m=>m.style.display==='flex');
        const a=Array.from(m.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')).filter(n=>n.offsetParent!==null),first=a[0],last=a[a.length-1];
        if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
      }return;
    }
    const cmd=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(cmd && key==='z'){e.preventDefault();stepHistory(e.shiftKey?1:-1).catch(fail);return;}
    else if(cmd && key==='y'){e.preventDefault();stepHistory(1).catch(fail);return;}
    if(isFormEditing())return;
    if(e.key==='F10'&&e.shiftKey&&c.getActiveObject()){e.preventDefault();const o=c.getActiveObject(),rect=o.getBoundingRect(true,true);openContext(rect.left+16,rect.top+16);return;}
    if(busy)return;
    else if(cmd && key==='g'){e.preventDefault();groupObjects(e.shiftKey);}
    else if(cmd && key==='a'){e.preventDefault();if(allowed()){tools.setMode('select');c.setActiveObject(new fabric.ActiveSelection(c.getObjects(),{canvas:c}));c.requestRenderAll();}}
    else if(cmd && key==='s'){e.preventDefault();$('saveBtn').click();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}
    else if(e.code==='Space'&&!e.repeat&&!tools.gesture){e.preventDefault();spaceMode=tools.mode;tools.setMode('move');}
    else if(key==='home'){e.preventDefault();if(allowed())tools.home(current.content.frame);}
  });
  const releaseSpace=()=>{if(spaceMode){tools.up();tools.setMode(spaceMode);spaceMode=null;}};
  document.addEventListener('keyup',e=>{if(e.code==='Space')releaseSpace();});window.addEventListener('blur',()=>{releaseSpace();tools.up();});
  window.addEventListener('resize',()=>{
    updateFeedbackPosition();closePopups();const center=fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform)),z=c.getZoom();
    c.setDimensions({width:window.innerWidth,height:window.innerHeight});c.setViewportTransform([z,0,0,z,c.width/2-center.x*z,c.height/2-center.y*z]);rememberView();
  });
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){finishText();flush().catch(fail);}else refreshRemote();});
  window.addEventListener('focus',refreshRemote);
  window.addEventListener('blur',()=>finishText());
}
async function boot() {
  if(!window.fabric)throw Error('캔버스 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 차단 여부를 확인하고 새로고침해주세요.');
  c=new fabric.Canvas('whiteboardCanvas',{width:window.innerWidth,height:window.innerHeight,preserveObjectStacking:true,selection:true,fireMiddleClick:true,stopContextMenu:true,enablePointerEvents:true});
  fabric.Object.prototype.cornerStyle='circle';fabric.Object.prototype.cornerSize=10;fabric.Object.prototype.transparentCorners=false;fabric.Object.prototype.setControlsVisibility({mtr:false});
  tools=new CanvasTools({canvas:c,canEdit:()=>!!current&&!busy&&!modalOpen(),onChange:changed,onViewport:rememberView,onText:p=>addText('텍스트',p,true),onMode:mode=>{
    const map={selectMoveToggleBtn:'select',penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser',laserModeBtn:'laser'};
    for(const [id,m] of Object.entries(map))$(id).classList.toggle('active-select',mode===m);
    $('selectMoveLabel').textContent=mode==='move'?'이동':'선택';$('selectMoveToggleBtn').classList.toggle('active-move',mode==='move');
    updateHistory();
  }});
  store=new BoardStore();await store.open();await store.ensurePage(emptyContent(c.width,c.height));pages=await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  sync=new TabSync(refreshRemote);
  await setPage(pages.find(p=>p.id===session.activeId)||pages[0],true);
  clipboard=new SystemClipboard({canvas:c,allowed,run,onChange:changed,onFiles:files=>importFiles(files),onText:text=>addText(text),notify,isTextEditing});
  c.on('selection:created',updateHistory);c.on('selection:updated',updateHistory);c.on('selection:cleared',updateHistory);
  c.on('object:modified',updateSelectionActions);c.on('after:render',()=>{if(!busy)updateSelectionActions();});
  c.on('text:editing:exited',()=>{if(groupSession)closeGroupSession();else changed();flush().catch(fail);});
  try{shared.quick=parseQuickColors(localStorage.getItem('wb42.quickColors'));}catch{}
  wireUI();busy=false;syncSharedUI();updateHistory();updateFeedbackPosition();
}
boot().catch(error=>{console.error(error);const hint=location.protocol==='file:'?' 파일을 직접 열지 말고 HTTPS 배포 주소 또는 localhost에서 실행해주세요.':'';const fatal=$('fatalError');if(fatal){fatal.textContent=`앱을 시작하지 못했습니다. ${error.message}${hint}`;fatal.hidden=false;}status('시작 실패','error');});
