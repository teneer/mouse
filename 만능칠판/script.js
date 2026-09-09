import {VERSION,uid,clone,emptyContent,SERIAL_PROPS,MAX_BACKUP_BYTES} from './js/constants.js';
import {BoardStore,TabSync,SESSION_KEY,readLegacy} from './data.js';
import {PageHistory} from './history.js';
import {SystemClipboard} from './clipboard.js';
import {CanvasTools} from './js/canvas-tools.js';
import {loadCanvas,makeThumbnail} from './js/previews.js';
import {decodeFiles} from './js/files.js';
import {validateContent} from './js/validation.js';
const $=id=>document.getElementById(id);
let c,store,tools,sync,clipboard,current=null,pages=[],busy=true,dirty=false,saving=null,generation=0;
let autosaveTimer,toastTimer,importAbort,syncing=false,session={views:{}},modalFocus=null;
const history=new PageHistory(),knownVersions=new Map();
try {session=JSON.parse(sessionStorage.getItem(SESSION_KEY)) || session;} catch {}
if(!session.views || typeof session.views!=='object')session.views={};
function notify(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function status(message,state='ok') {$('saveStatus').textContent=message;$('saveStatus').dataset.state=state;}
function fail(error) {console.error(error);notify(error?.message || String(error));}
function modalOpen() {return Array.from(document.querySelectorAll('.modal')).some(m=>m.style.display==='flex');}
function isTextEditing() {
  const e=document.activeElement;return !!(e && (e.matches('input,textarea,select') || e.isContentEditable)) || !!c?.getActiveObject()?.isEditing;
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
function changed() {
  if(!current)return;
  current.content=capture();dirty=true;generation++;history.push(current.id,current.content);
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
function finishText() {const o=c?.getActiveObject();if(o?.isEditing)o.exitEditing();}
function restoreInteraction() {
  if(!c || !tools)return;
  c.isDrawingMode=tools.mode==='pen'||tools.mode==='marker';c.selection=tools.mode==='select';c.skipTargetFind=tools.mode==='move';
  c.getObjects().forEach(o=>o.set({selectable:tools.mode==='select',evented:true}));c.requestRenderAll();
}
async function run(fn,label='처리 중입니다.') {
  if(busy || tools?.gesture){notify('현재 작업을 마친 뒤 다시 시도해주세요.');return;}
  finishText();busy=true;closePopups();$('busyText').textContent=label;$('busyOverlay').hidden=false;
  c.isDrawingMode=false;c.selection=false;c.skipTargetFind=true;
  try {await fn();}catch(e){if(e?.name==='AbortError')notify('가져오기를 취소했습니다.');else fail(e);}
  finally {busy=false;importAbort=null;$('cancelImportBtn').hidden=true;$('busyOverlay').hidden=true;restoreInteraction();updateHistory();}
}
async function setPage(page,reset=false,keepView=true) {
  rememberView();const previous=current?clone(current):null;
  current=clone(page);dirty=false;
  try {await loadCanvas(c,current.content.canvas);}catch(error){
    current=previous;if(previous)await loadCanvas(c,previous.content.canvas);throw error;
  }
  tools.setMode('select');
  const view=keepView?session.views[current.id]:null;
  if(Array.isArray(view)&&view.length===6&&view.every(Number.isFinite)&&view[0]>=0.1&&view[0]<=10) {
    c.setViewportTransform(view.slice());rememberView();
  } else tools.home(current.content.frame);
  if(reset || !history.pages.has(page.id) || knownVersions.get(page.id)!==page.version)history.reset(page.id,current.content);
  knownVersions.set(page.id,page.version);if(/^#[0-9a-f]{6}$/i.test(c.backgroundColor))$('bgCustom').value=c.backgroundColor;renderPages();updateHistory();status('자동저장 완료');
}
async function activatePage(id) {
  await flush();const p=await store.getPage(id);if(!p || p.deleted)throw Error('삭제된 페이지입니다.');await setPage(p);
}
async function createPage(content,name) {
  await flush();const now=Date.now();
  const result=await store.commitPage({id:uid(),name:name.slice(0,100),content,version:0,order:now,createdAt:now},0);
  sync.notify();pages=await store.listPages();await setPage(result.page,true,false);
}
function renderPages() {
  const box=$('pageTabs');box.replaceChildren();
  pages.forEach((p,index)=>{
    const b=document.createElement('button');b.className='mode-btn';b.textContent=p.name;b.title=`${index+1}. ${p.name}`;
    b.setAttribute('aria-current',String(p.id===current?.id));
    if(p.id===current?.id)b.classList.add('active-select');
    b.onclick=()=>{if(p.id!==current?.id)run(()=>activatePage(p.id),'페이지를 불러오는 중입니다.');};box.append(b);
  });
  $('pageCount').textContent=`${pages.length}페이지`;
  $('deletePageBtn').disabled=pages.length<=1;
}
function updateHistory() {
  $('undoBtn').disabled=busy||!current||!history.canUndo(current.id);
  $('redoBtn').disabled=busy||!current||!history.canRedo(current.id);
  const object=c?.getActiveObject(),multiple=object?.type==='activeSelection';
  $('groupBtn').disabled=busy||!multiple;$('ungroupBtn').disabled=busy||object?.type!=='group';
  $('deleteSelectionBtn').disabled=busy||!object;
}
async function stepHistory(direction) {
  const before=history.pages.get(current.id)?.index;
  const content=history.step(current.id,direction);if(!content)return;
  try {await loadCanvas(c,content.canvas);} catch(e){history.pages.get(current.id).index=before;await loadCanvas(c,current.content.canvas);throw e;}
  current.content=content;tools.setMode('select');dirty=true;generation++;await flush();updateHistory();
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
  const object=new fabric.IText(text,{left:center.x,top:center.y,fontFamily:'Arial',fontSize:tools.text.size,fill:tools.text.color,id:uid()});
  if(!point)object.setPositionByOrigin(center,'center','center');
  c.add(object);c.setActiveObject(object);object.setCoords();c.requestRenderAll();changed();
  if(editing){object.enterEditing();object.selectAll();}
}
async function importFiles(files,point) {
  importAbort=new AbortController();$('cancelImportBtn').hidden=false;
  const decoded=await decodeFiles(files,{signal:importAbort.signal,onProgress:t=>$('busyText').textContent=t});
  if(!decoded.length)return;
  tools.setMode('select');
  const center=point || fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform));
  let y=center.y;const width=Math.min(800,c.width/c.getZoom()*0.75),added=[];
  decoded.forEach(({image})=>{
    image.scale(Math.min(1,width/image.width));image.set({left:center.x-image.getScaledWidth()/2,top:y,id:uid()});
    c.add(image);image.setCoords();added.push(image);y+=image.getScaledHeight()+24;
  });
  c.setActiveObject(added.length===1?added[0]:new fabric.ActiveSelection(added,{canvas:c}));c.requestRenderAll();changed();
  notify(`${added.length}개 이미지를 배치했습니다.${added.length>1?' 아래쪽으로 이동하면 나머지 내용을 볼 수 있습니다.':''}`);
}
function setColor(tool,color) {
  if(busy || !current)return;
  if(tool==='bg'){c.setBackgroundColor(color,()=>c.requestRenderAll());changed();}
  else if(tool==='text') {
    tools.text.color=color;const o=c.getActiveObject();
    if(o && ['i-text','text','textbox'].includes(o.type)){o.set('fill',color);c.requestRenderAll();changed();}
  } else {tools[tool].color=color;tools.updateBrush();}
  const input=$(tool==='bg'?'bgCustom':tool==='text'?'textCustom':`${tool}Custom`);if(input)input.value=color;
  document.querySelectorAll(`.color-btn[data-tool="${tool}"]`).forEach(b=>b.classList.toggle('selected',b.dataset.color===color));
}
let openedPopup=null;
function closePopups() {document.querySelectorAll('.tip-up-settings').forEach(p=>p.style.display='none');document.querySelectorAll('[data-popup]').forEach(b=>b.setAttribute('aria-expanded','false'));openedPopup=null;}
function togglePopup(id,button) {
  if(busy)return;
  const was=openedPopup===id;closePopups();if(was)return;
  const p=$(id);p.style.display='block';openedPopup=id;button.setAttribute('aria-expanded','true');
  const rect=button.getBoundingClientRect();p.style.left=Math.max(8,Math.min(window.innerWidth-p.offsetWidth-8,rect.left+rect.width/2-p.offsetWidth/2))+'px';
  p.style.top=Math.max(8,rect.top-p.offsetHeight-8)+'px';
}
function openModal(id) {closePopups();finishText();modalFocus=document.activeElement;$(id).style.display='flex';$(id).querySelector('input,button')?.focus();}
function closeModal(id) {$(id).style.display='none';modalFocus?.focus();}
async function renderSavedScreens() {
  const screens=await store.listScreens();const box=$('savedScreenList');box.replaceChildren();$('noSavedScreens').hidden=!!screens.length;
  for(const screen of screens) {
    const li=document.createElement('li');li.className='saved-screen-list-item';
    const img=document.createElement('img');img.className='saved-preview';img.alt=`${screen.name}: 홈 100% 화면 미리보기`;img.loading='lazy';
    if(screen.thumbnail)img.src=screen.thumbnail;
    else {try{img.src=await makeThumbnail(screen.content);}catch{img.alt='미리보기를 생성하지 못했습니다.';}}
    const info=document.createElement('div');info.className='screen-info-container';
    const name=document.createElement('span');name.className='screen-name-display';name.textContent=screen.name;
    const time=document.createElement('span');time.className='screen-timestamp-display';time.textContent=new Date(screen.savedAt).toLocaleString('ko-KR');
    info.append(name,time);
    const actions=document.createElement('div');actions.className='screen-item-actions';
    const load=document.createElement('button');load.className='action-btn';load.textContent='새 페이지로 열기';load.onclick=()=>run(async()=>{await createPage(clone(screen.content),screen.name);closeModal('loadSavedScreenModal');});
    const del=document.createElement('button');del.className='action-btn delete-saved-item-btn';del.textContent='삭제';del.onclick=()=>{
      if(confirm(`저장 화면 “${screen.name}”을 삭제할까요? 되돌릴 수 없습니다.`))run(async()=>{await store.deleteScreen(screen.id);sync.notify();await renderSavedScreens();});
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
  const imported=input.pages.map((p,i)=>{const content=validateContent(p.content);reidentify(content.canvas);return {id:uid(),name:String(p.name || '가져온 페이지').slice(0,100),content,version:1,order:now+i,createdAt:now,updatedAt:now};});
  const screens=[];
  for(const s of input.screens) {
    const content=validateContent(s.content);
    screens.push({id:uid(),name:String(s.name||'가져온 화면').slice(0,100),savedAt:now,content,thumbnail:await makeThumbnail(content)});
  }
  await flush();await store.appendBackup(imported,screens);sync.notify();pages=await store.listPages();
  if(imported.length)await setPage(imported[0],true,false);else renderPages();
  notify(`페이지 ${imported.length}개와 저장 화면 ${screens.length}개를 추가했습니다. 기존 데이터는 유지했습니다.`);
}
async function importLegacy() {
  if(await store.getMeta('legacyImported') && !confirm('이전 데이터를 이미 가져온 적이 있습니다. 다시 가져오면 중복될 수 있습니다. 계속할까요?'))return;
  const legacy=await readLegacy();if(!legacy.auto && !legacy.screens.length){notify('이 주소에서 구버전 저장 데이터를 찾지 못했습니다.');return;}
  const clean=json=>{
    const content={canvas:typeof json==='string'?JSON.parse(json):clone(json),frame:{width:c.width,height:c.height,cx:2400,cy:1600}};
    normalizedObjects(content.canvas.objects || []);return validateContent(content);
  };
  const now=Date.now(),imported=[],screens=[];
  if(legacy.auto)imported.push({id:uid(),name:'이전 자동저장',content:clean(legacy.auto),version:1,order:now,createdAt:now,updatedAt:now});
  for(const s of legacy.screens) {
    const content=clean(s.canvasData || s);screens.push({id:uid(),name:String(s.displayName||'이전 저장 화면').slice(0,100),savedAt:now,content,thumbnail:await makeThumbnail(content)});
  }
  await flush();await store.appendBackup(imported,screens);await store.setMeta('legacyImported',true);sync.notify();pages=await store.listPages();
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
  document.querySelectorAll('[data-popup]').forEach(b=>b.onclick=()=>togglePopup(b.dataset.popup,b));
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.tip-up-settings,[data-popup]'))closePopups();});
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);}));
  const modeMap={penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser'};
  Object.entries(modeMap).forEach(([id,mode])=>$(id).onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode===mode?'select':mode);});
  $('selectMoveToggleBtn').onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode==='select'?'move':'select');};
  document.querySelectorAll('.color-btn').forEach(b=>b.onclick=()=>setColor(b.dataset.tool,b.dataset.color));
  for(const tool of ['bg','pen','marker','text'])$(tool==='bg'?'bgCustom':`${tool}Custom`).addEventListener('input',e=>setColor(tool,e.target.value));
  $('penSizeSelect').onchange=e=>{tools.pen.width=Number(e.target.value);tools.updateBrush();};
  $('markerSizeSelect').onchange=e=>{tools.marker.width=Number(e.target.value);tools.updateBrush();};
  $('freeTextSizeSelect').onchange=e=>{
    tools.text.size=Number(e.target.value);const o=c.getActiveObject();
    if(o && ['text','i-text','textbox'].includes(o.type)){o.set('fontSize',tools.text.size);o.setCoords();c.requestRenderAll();changed();}
  };
  $('eraserTypeSelect').onchange=e=>{tools.eraser=e.target.value;};
  $('deleteSelectionBtn').onclick=deleteSelected;$('groupBtn').onclick=()=>groupObjects();$('ungroupBtn').onclick=()=>groupObjects(true);
  $('undoBtn').onclick=()=>run(()=>stepHistory(-1));$('redoBtn').onclick=()=>run(()=>stepHistory(1));
  $('clearAllBtn').onclick=()=>{if(allowed()&&confirm('현재 페이지의 모든 객체를 지울까요? 언두로 되돌릴 수 있습니다.')){finishText();c.discardActiveObject();c.getObjects().slice().forEach(o=>c.remove(o));c.requestRenderAll();changed();}};
  $('zoomInBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()*1.25);};$('zoomOutBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()/1.25);};$('homeBtn').onclick=()=>{if(allowed())tools.home(current.content.frame);};
  $('toolbarHideBtn').onclick=()=>{const hidden=!$('toolbar').hidden;$('toolbar').hidden=hidden;$('toolbarHideBtn').textContent=hidden?'▲':'▼';$('toolbarHideBtn').setAttribute('aria-expanded',String(!hidden));closePopups();};
  $('addPageBtn').onclick=()=>run(()=>createPage(emptyContent(c.width,c.height),`페이지 ${pages.length+1}`));
  $('duplicatePageBtn').onclick=()=>run(()=>{const content=capture();reidentify(content.canvas);return createPage(content,`${current.name} 복사`);});
  $('renamePageBtn').onclick=()=>{if(!allowed())return;const name=prompt('페이지 이름을 입력해주세요.',current.name);if(name?.trim())run(async()=>{await flush();current.name=name.trim().slice(0,100);dirty=true;generation++;await flush();});};
  $('deletePageBtn').onclick=()=>{if(!allowed()||pages.length<=1)return;if(confirm(`“${current.name}” 페이지를 삭제할까요? 페이지 삭제는 되돌릴 수 없습니다.`))run(async()=>{
    await flush();const id=current.id;await store.deletePage(id,current.version);history.remove(id);delete session.views[id];sync.notify();pages=await store.listPages();
    if(!pages.length){await store.ensurePage(emptyContent(c.width,c.height));pages=await store.listPages();}
    await setPage(pages[0]);
  });};
  $('saveBtn').onclick=()=>{if(!allowed())return;$('saveScreenNameInput').value=current.name;openModal('saveConfirmModal');$('saveScreenNameInput').focus();$('saveScreenNameInput').select();};
  $('confirmSaveBtn').onclick=()=>run(async()=>{
    const name=$('saveScreenNameInput').value.trim() || '제목 없음';await flush();const content=capture(),thumbnail=await makeThumbnail(content);
    await store.putScreen({id:uid(),name,savedAt:Date.now(),content,thumbnail});sync.notify();closeModal('saveConfirmModal');notify('현재 페이지를 저장 화면으로 보관했습니다.');
  },'홈 100% 미리보기를 만드는 중입니다.');
  $('saveScreenNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('confirmSaveBtn').click();}});
  $('loadGeneralBtn').onclick=()=>run(async()=>{await renderSavedScreens();openModal('loadSavedScreenModal');});
  $('copyBtn').onclick=()=>clipboard.copy();$('pasteBtn').onclick=()=>clipboard.paste();
  $('importFileBtn').onclick=()=>{closePopups();$('fileInput').click();};
  $('fileInput').onchange=e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)run(()=>importFiles(files),'파일을 가져오는 중입니다.');};
  $('cancelImportBtn').onclick=()=>{importAbort?.abort();$('busyText').textContent='가져오기를 취소하는 중입니다.';};
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
    const point=c.getPointer(e);run(()=>importFiles(files,point),'파일을 가져오는 중입니다.');
  });
  let spaceMode=null;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') {closePopups();document.querySelectorAll('.modal').forEach(m=>{if(m.style.display==='flex')closeModal(m.id);});if(!busy)finishText();return;}
    if(modalOpen()) {
      if(e.key==='Tab') {
        const m=Array.from(document.querySelectorAll('.modal')).find(m=>m.style.display==='flex');
        const a=Array.from(m.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')).filter(n=>n.offsetParent!==null),first=a[0],last=a[a.length-1];
        if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
      }return;
    }
    if(busy || isTextEditing())return;
    const cmd=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(cmd && key==='z'){e.preventDefault();run(()=>stepHistory(e.shiftKey?1:-1));}
    else if(cmd && key==='y'){e.preventDefault();run(()=>stepHistory(1));}
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
    closePopups();const center=fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform)),z=c.getZoom();
    c.setDimensions({width:window.innerWidth,height:window.innerHeight});c.setViewportTransform([z,0,0,z,c.width/2-center.x*z,c.height/2-center.y*z]);rememberView();
  });
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){finishText();flush().catch(fail);}else refreshRemote();});
  window.addEventListener('focus',refreshRemote);
}
async function boot() {
  if(!window.fabric)throw Error('캔버스 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 차단 여부를 확인하고 새로고침해주세요.');
  c=new fabric.Canvas('whiteboardCanvas',{width:window.innerWidth,height:window.innerHeight,preserveObjectStacking:true,selection:true,fireMiddleClick:true,stopContextMenu:true});
  fabric.Object.prototype.cornerStyle='circle';fabric.Object.prototype.cornerSize=10;fabric.Object.prototype.transparentCorners=false;fabric.Object.prototype.setControlsVisibility({mtr:false});
  tools=new CanvasTools({canvas:c,canEdit:()=>!!current&&!busy&&!modalOpen(),onChange:changed,onViewport:rememberView,onText:p=>addText('텍스트',p,true),onMode:mode=>{
    for(const [id,m] of Object.entries({penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser'}))$(id).classList.toggle('active-select',mode===m);
    $('selectMoveLabel').textContent=mode==='move'?'이동':'선택';$('selectMoveToggleBtn').classList.toggle('active-select',mode==='select');$('selectMoveToggleBtn').classList.toggle('active-move',mode==='move');
    updateHistory();
  }});
  store=new BoardStore();await store.open();await store.ensurePage(emptyContent(c.width,c.height));pages=await store.listPages();
  sync=new TabSync(refreshRemote);
  await setPage(pages.find(p=>p.id===session.activeId)||pages[0],true);
  clipboard=new SystemClipboard({canvas:c,allowed,run,onChange:changed,onFiles:files=>importFiles(files),onText:text=>addText(text),notify,isTextEditing});
  c.on('selection:created',updateHistory);c.on('selection:updated',updateHistory);c.on('selection:cleared',updateHistory);
  c.on('text:changed',changed);c.on('text:editing:exited',()=>{changed();flush().catch(fail);});
  wireUI();busy=false;updateHistory();
}
boot().catch(error=>{console.error(error);$('fatalError').textContent=`앱을 시작하지 못했습니다. ${error.message} 파일을 직접 열지 말고 HTTPS 배포 주소 또는 localhost에서 실행해주세요.`;$('fatalError').hidden=false;status('시작 실패','error');});
