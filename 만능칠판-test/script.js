import {mountGoalCelebration} from './score/goal-celebration.js?v=celebration-2';
import {acquireTabIdentity} from './js/tab-identity.js';
import {activeView,wireViewTabs} from './js/view-tabs.js?v=view-sync-click-1';
import {setBoardIcon} from './js/board-icons.js?v=emoji-1';
import {fixedObjectLabel,installTextBoxBorder,normalizeTextBoxStyle} from './js/text-box.js';
import {VERSION,DEFAULT_BG,uid,clone,emptyContent,SERIAL_PROPS,MAX_BACKUP_BYTES} from './js/constants.js?v=whiteboard-7';
import {BoardStore,TabSync,SESSION_KEY,readLegacy} from './data.js?v=goal-queue-1';
import {PageHistory} from './history.js';
import {SystemClipboard} from './clipboard.js?v=whiteboard-7';
import {CanvasTools} from './js/canvas-tools.js?v=ink-session-1';
import {QUICK_DEFAULTS,SIZE_DEFAULTS,TEXT_TYPES,targets,applyAppearance,orderedToEdge,parseQuickColors,SIZE_LABELS,SIZE_LIMITS,defaultFavoriteSize,normalizeFavoriteSize,scaleFavoriteSize} from './js/board-options.js';
import {loadCanvas,makeThumbnail} from './js/previews.js';
import {assetReferences, prepareFiles, BoardFiles, readDataURL} from './js/files.js';
import {CloudBoard} from './js/cloud.js?v=toolbar-goals-1';
import {wireScoreSync} from './js/score-sync.js?v=score-tab-preview-1';
import {boardPages, pagePatch, pageTitle, validViewState} from './js/cloud-model.js?v=toolbar-goals-1';
import {wireCloudUI} from './js/cloud-ui.js?v=toolbar-status-1';
import {validateContent} from './js/validation.js?v=whiteboard-7';
import {makeStatusController,shouldClosePopups} from './js/feedback.js?v=view-tabs-1';
import {BACKGROUND_COLORS,BACKGROUND_PATTERNS,normalizePattern,setCanvasPattern} from './js/board-background.js';
import {wireToolbarDrag,wirePageReorder,movePageId} from './js/board-navigation.js?v=toolbar-scroll-1';
const $=id=>document.getElementById(id);
let c,store,tools,sync,clipboard,current=null,pages=[],busy=true,dirty=false,saving=null,generation=0,historyBusy=false;
let autosaveTimer,toastTimer,importAbort,syncing=false,session={views:{}},modalFocus=null,confirmResolver=null,importLayoutResolver=null,passwordResolver=null;
const history=new PageHistory(),knownVersions=new Map();
const MAX_PAGES=10;
function readPreference(key) {try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function writePreference(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
const isColor=value=>typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value);
const priorColor=parseQuickColors(JSON.stringify(readPreference('wb42.quickColors'))).find(color=>!QUICK_DEFAULTS.includes(color));
const shared={color:'#000000',level:3,favoriteColor:readPreference('wb42.favoriteColor')??priorColor,
  favoriteSize:normalizeFavoriteSize(readPreference('wb42.favoriteSize'))};
let favoriteDraft, favoriteColorDraft, favoriteSizeEnabled, textPropsTarget, contextTextTarget;
let textBoxDefaults=normalizeTextBoxStyle(readPreference('wb50.textBoxDefaults'));
let favoriteBackground=readPreference('wb42.favoriteBackground'), localView, pageListGeneration=0, renamePageId=null;
let groupSession=null,suppressSelection=false;
let cloud, boardFiles, cloudUI, cloudBase, reloadLocalAfterDisconnect, cloudRefresh=false, cloudRefreshTimer, viewTimer, applyingView=false;
let cancelledText=false, cloudHistory=null, seenView=null;
const cloudActive=()=>!!cloud?.options && cloud.boardReady;
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
let tabViews, scoreFull=false;
function modalOpen() {return document.body.classList.contains('score-modal-open') || Array.from(document.querySelectorAll('.modal')).some(m=>m.style.display==='flex');}
function isTextEditing() {
  return !!c?.getActiveObject()?.isEditing;
}
function isFormEditing() {
  const e=document.activeElement;return !!(e && e.matches('input,textarea,select,[contenteditable="true"]'));
}
const canEditBoard = ()=>!cloud?.options || !!cloudBase && !cloud.detaching;
function allowed() {return !!current&&canEditBoard()&&!busy&&!modalOpen()&&!tools?.gesture;}
function rememberView(publish=false) {
  if(!current || !c)return;
  session.activeId=current.id;session.views[current.id]=c.viewportTransform.slice();
  try {sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));} catch {}
  $('zoomLabel').textContent=`${Math.round(c.getZoom()*100)}%`;
  if (publish) tabViews?.refresh();
  if(publish && sync && !applyingView && $('viewSync').checked) {
    clearTimeout(viewTimer);
    viewTimer=setTimeout(()=>{
      if($('viewSync').checked && !applyingView)publishView().catch(fail);
    },350);
  }
}
function currentView(){
  const [zoom,,,,left,top]=c.viewportTransform;
  const view={pageId:current.id,zoom,x:(c.width/2-left)/zoom,y:(c.height/2-top)/zoom};
  const frame=$('scoreFrame');
  if(frame){
    view.scoreOpen=scoreOpen;
    view.scoreFull=scoreFull;
    view.scoreShare=scoreShare;
    const scale=Number(frame.dataset.scoreScale || readPreference('whiteboard.test.score-scale.v1'));
    if(scale>=60 && scale<=150)view.scoreScale=scale;
  }
  return view;
}
const viewState=()=>cloud?.options?cloud.latestView:sync.readView() || localView;
async function publishView(toggle,changeTargets){
  const shared=viewState();
  if(toggle===undefined && !changeTargets && !activeView(shared,sync.id))return;
  const epoch=toggle===undefined && !changeTargets?shared.epoch:uid();
  const state={epoch,sourceTab:sync.id,...currentView()};
  if(cloud?.options){
    await cloud.sendSharedView(state,toggle,changeTargets);
  }else{
    const old=shared?.targets;
    const targets=changeTargets?[...new Set(changeTargets(old))]:(old||[]);
    const enabled=targets.length>0&&(toggle??(!!changeTargets||shared?.enabled===true));
    localView={...(changeTargets && !targets.includes(sync.id) && shared?.pageId ? shared:state),epoch,enabled,targets};
    sync.sendView(localView);
  }
  tabViews?.render();
}
function normalizedObjects(objects) {
  const ids=new Set();
  objects.forEach(o=>{if(typeof o.id!=='string' || ids.has(o.id))o.id=uid();ids.add(o.id);o.selectable=true;o.evented=true;o.visible=true;delete o.customLayer;if(o.objects)normalizedObjects(o.objects);});
}
function capture() {
  c.getObjects().forEach(object=>{if(!object.id)object.id=uid();});
  const json=c.toJSON(SERIAL_PROPS);normalizedObjects(json.objects);
  json.wbBackgroundPattern=normalizePattern(c.wbBackgroundPattern);
  return {canvas:json,frame:{...current.content.frame,width:c.width,height:c.height}};
}
function changed({recordHistory=true}={}) {
  if(!current || cancelledText || isTextEditing())return;
  current.content=capture();dirty=true;generation++;
  if(recordHistory && !cloudActive())history.push(current.id,current.content);
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
      if(cloudActive() && cloudBase){
        if(cloud.projected().pages[local.id]?.deleted){dirty=false;requestCloudRefresh();break;}
        const normalized=(await prepareCloudPage(local)).content;
        const patch=pagePatch(cloudBase,normalized);
        if(patch)await cloud.enqueue({kind:'edit',pageId:local.id,patch});
        cloudBase=normalized;
        if(pagePatch(local.content,normalized))requestCloudRefresh();
        if(g===generation)dirty=false;
        continue;
      }
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
    pages=cloudActive()?boardPages(cloud.projected()):await store.listPages();renderPages();cloudUI?.boardChanged().catch(fail);succeeded=true;if(!dirty)status('자동저장 완료');
  })().catch(error=>{status('저장 실패 · JSON 백업을 해주세요.','error');throw error;}).finally(()=>{saving=null;if(succeeded&&dirty){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>flush().catch(fail),100);}else if(succeeded && !cloudActive())queueMicrotask(()=>applyLocalView().catch(fail));});
  return saving;
}
function finishText() {const o=c?.getActiveObject();if(o?.isEditing)o.exitEditing();if(groupSession && !o?.isEditing)closeGroupSession();}
async function checkFiles(content) {
  await Promise.all([...assetReferences(content.canvas.objects).keys()].map(id=>boardFiles.checkAvailability(id)));
  updateFileInteraction();
}
function containsUnavailableFile(object) {
  return !!(object.wbAsset && boardFiles?.unavailable.has(object.wbAsset.id) ||
    object.getObjects?.().some(containsUnavailableFile));
}
function updateFileInteraction() {
  c.getObjects().forEach(object=>{
    const missing=containsUnavailableFile(object);
    if(object.type==='group' && object.getObjects().some(child=>child.wbAsset || child.type==='group'))object.objectCaching=false;
    object.wbAssetMissing=!!missing;
    const locked=missing || object.wbPinned;
    object.set({selectable:tools.mode==='select' && !locked,evented:!locked});
    if(locked && c.getActiveObjects().includes(object))c.discardActiveObject();
  });
}
function restoreInteraction() {
  if(!c || !tools)return;
  c.isDrawingMode=tools.mode==='pen'||tools.mode==='marker';c.selection=tools.mode==='select';c.skipTargetFind=tools.mode==='move';
  updateFileInteraction();c.requestRenderAll();
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
  current=clone(page);cloudBase=cloudActive()?clone(page.content):null;dirty=false;
  try {await loadCanvas(c,current.content.canvas);await checkFiles(current.content);}catch(error){
    current=previous;cloudBase=cloudActive()?previous?.content:null;if(previous)await loadCanvas(c,previous.content.canvas);throw error;
  }
  tools.setMode('select');
  const view=keepView?session.views[current.id]:null;
  if(Array.isArray(view)&&view.length===6&&view.every(Number.isFinite)&&view[0]>=0.1&&view[0]<=10) {
    c.setViewportTransform(view.slice());rememberView();
  } else {
    const wasApplying=applyingView;applyingView=true;
    try{tools.home(current.content.frame);}finally{applyingView=wasApplying;}
  }
  if(reset || !history.pages.has(page.id) || knownVersions.get(page.id)!==page.version)history.reset(page.id,current.content);
  knownVersions.set(page.id,page.version);renderPages();updateHistory();status('자동저장 완료');
}
async function activatePage(id) {
  await flush();const p=cloudActive()?cloud.projected().pages[id]:await store.getPage(id);
  if(!p || p.deleted)throw Error('삭제된 페이지입니다.');
  await setPage(p);rememberView(true);
}
function stepPage(direction) {
  const index=pages.findIndex(page=>page.id===current?.id);
  const target=index<0?null:pages[index+direction];
  if(target)run(()=>activatePage(target.id));
}
async function createPage(content,title) {
  await flush();
  if(pages.length>=MAX_PAGES){notify(`페이지는 최대 ${MAX_PAGES}개까지 사용할 수 있습니다.`);return;}
  const now=Date.now(),number=pages.length+1;
  const page={id:uid(),name:`페이지 ${number}`,title,content,version:0,order:now,createdAt:now};
  if(cloudActive()){
    await cloud.enqueue({kind:'add',pages:[await prepareCloudPage(page)]});pages=boardPages(cloud.projected());
    await setPage(pages.find(item=>item.id===page.id),true,false);rememberView(true);return;
  }
  const result=await store.commitPage(page,0);
  sync.notify();pages=await store.listPages();await setPage(result.page,true,false);rememberView(true);
}
function displayPageTitle(page,index) {
  return pageTitle(page?.title) || `페이지 ${index+1}`;
}
function renderPages() {
  pages=pages.slice(0,MAX_PAGES);
  const activeIndex=pages.findIndex(page=>page.id===current?.id);
  $('previousPageBtn').disabled=activeIndex<=0;
  $('nextPageBtn').disabled=activeIndex<0 || activeIndex>=pages.length-1;
  const index=Math.max(0,activeIndex);
  $('pageListLabel').textContent=`${index+1}쪽`;
  const title=displayPageTitle(pages[index],index);
  $('pageListBtn').title=title;
  $('pageListBtn').setAttribute('aria-label',`페이지 목록 · ${index+1}쪽 · ${title}`);
}
async function movePage(source,target) {
  const ids=pages.map(page=>page.id);
  const order=movePageId(ids,source,target);
  if(order===ids)return;
  await flush();
  if(cloudActive()) {await cloud.enqueue({kind:'reorder',order});pages=boardPages(cloud.projected());}
  else {await store.reorderPages(order);pages=await store.listPages();sync.notify();}
  current.order=pages.find(page=>page.id===current.id)?.order??current.order;
  renderPages();
  if(openedPopup==='pageList')renderPageTiles();
}
function openPageRename(page,index) {
  renamePageId=page.id;
  $('pageNameInput').value=displayPageTitle(page,index);
  openModal('pageRenameModal');
  $('pageNameInput').focus();
  $('pageNameInput').select();
}
async function savePageTitle(event) {
  event.preventDefault();
  const id=renamePageId, title=pageTitle($('pageNameInput').value);
  if(!id || $('pageRenameModal').style.display!=='flex')return;
  const submit=event.submitter || event.currentTarget.querySelector('[type=submit]');
  if(submit.disabled)return;
  submit.disabled=true;
  try{
    await flush();
    if(cloudActive()){
      const page=cloud.projected().pages[id];
      if(!page || page.deleted)throw Error('이미 삭제된 페이지입니다.');
      await cloud.enqueue({kind:'rename',pageId:id,title});
      pages=boardPages(cloud.projected());
    }else{
      if(!await store.renamePage(id,title))throw Error('이미 삭제된 페이지입니다.');
      pages=await store.listPages();sync.notify();
    }
    renderPages();
    if(renamePageId===id && $('pageRenameModal').style.display==='flex'){
      closeModal('pageRenameModal');
      $('pageListBtn').focus();
    }
  }finally{submit.disabled=false;}
}
async function deletePageTile(id,title){
  if(!allowed() || pages.length<=1)return;
  if(!await askConfirm(`“${title}” 페이지를 삭제할까요?`,{title:'페이지 삭제',confirmText:'삭제'}))return;
  await run(async()=>{
    await flush();
    const shared=cloudActive();
    const active=shared?boardPages(cloud.projected()):await store.listPages();
    const page=active.find(item=>item.id===id);
    if(!page || active.length<=1)return;
    if(shared)await cloud.enqueue({kind:'delete',pageId:id});
    else {await store.deletePage(id,page.version);sync.notify();}
    history.remove(id);delete session.views[id];
    pages=shared?boardPages(cloud.projected()):await store.listPages();
    if(current.id===id && pages.length){await setPage(pages[0]);rememberView(true);}
    else renderPages();
  });
}
function renderPageTiles() {
  const generation=++pageListGeneration;
  const grid=$('pageTiles');
  closePageActions();grid.replaceChildren();
  for(const [index,page] of pages.entries()){
    const wrap=document.createElement('div');wrap.className='page-tile-wrap';
    const tile=document.createElement('button');
    tile.type='button';tile.className='page-tile';tile.dataset.page=page.id;
    tile.setAttribute('aria-current',String(page.id===current?.id));
    const preview=document.createElement('div');preview.className='page-tile-preview';
    const title=displayPageTitle(page,index);
    const label=document.createElement('span');label.className='page-tile-name';label.textContent=title;
    tile.title=title;
    tile.setAttribute('aria-label',`${index+1}쪽 · ${title}`);
    tile.append(preview,label);
    tile.onclick=()=>run(()=>activatePage(page.id));
    tile.onkeydown=event=>{
      if(!event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key))return;
      const target=pages[index+(event.key==='ArrowLeft'?-1:1)];
      if(target){event.preventDefault();movePage(page.id,target.id).catch(fail);}
    };
    const menu=document.createElement('div');menu.className='page-tile-menu';
    const trigger=document.createElement('button');trigger.type='button';trigger.textContent='…';
    trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-label',title+' 옵션');
    const actions=document.createElement('div');actions.className='page-tile-actions';actions.popover='manual';
    function addAction(label,handler,disabled=false){
      const button=document.createElement('button');button.type='button';button.className='action-btn';
      button.textContent=label;button.onclick=handler;button.disabled=disabled;actions.append(button);
    }
    addAction('이름 편집',()=>openPageRename(page,index));
    addAction('페이지 복제',()=>run(async()=>{
      await flush();
      const source=cloudActive()?cloud.projected().pages[page.id]:await store.getPage(page.id);
      if(!source || source.deleted)throw Error('이미 삭제된 페이지입니다.');
      const content=clone(source.content);reidentify(content.canvas);
      await createPage(content,source.title);
    }),pages.length>=MAX_PAGES);
    addAction('페이지 삭제',()=>deletePageTile(page.id,title).catch(fail),pages.length<=1);
    trigger.onclick=()=>{
      const wasOpen=pageActions?.actions===actions;
      closePageActions();
      if(wasOpen)return;
      actions.showPopover();
      trigger.setAttribute('aria-expanded','true');
      const rect=trigger.getBoundingClientRect();
      actions.style.left=Math.max(8,Math.min(innerWidth-actions.offsetWidth-8,rect.right-actions.offsetWidth))+'px';
      actions.style.top=(rect.bottom+actions.offsetHeight+8<=innerHeight ? rect.bottom : Math.max(8,rect.top-actions.offsetHeight))+'px';
      pageActions={trigger,actions};
    };
    menu.append(trigger,actions);wrap.append(tile,menu);grid.append(wrap);
  }
  if(pages.length<MAX_PAGES){
    const add=document.createElement('button');
    add.type='button';add.className='page-tile page-tile-add';add.textContent='+';
    add.setAttribute('aria-label','페이지 추가');
    add.onclick=()=>run(()=>createPage(emptyContent(c.width,c.height)));
    grid.append(add);
  }
  const snapshot=pages.slice();
  void (async()=>{
    for(const [index,page] of snapshot.entries()){
      if(generation!==pageListGeneration || openedPopup!=='pageList')return;
      const content=page.id===current?.id?current.content:page.content;
      const view=session.views[page.id];
      try{
        const src=await makeThumbnail(content,view,c.width,c.height,120,canvas=>boardFiles.settlePreview(canvas));
        if(generation!==pageListGeneration || openedPopup!=='pageList')return;
        const img=document.createElement('img');img.src=src;img.alt='';
        grid.children[index]?.querySelector('.page-tile-preview')?.replaceWith(img);
      }catch(error){console.warn('페이지 미리보기를 만들 수 없습니다.',error);}
    }
  })();
}
function updateHistory() {
  // Undo/Redo availability reflects history state only. A save/import operation must not
  // permanently make the controls appear disabled. historyBusy prevents double execution.
  const sharedHistory=cloudActive() && current ? cloudHistory?.[current.id] : null;
  $('undoBtn').disabled=!current||historyBusy||(cloudActive()?!sharedHistory?.undo.length:!history.canUndo(current.id));
  $('redoBtn').disabled=!current||historyBusy||(cloudActive()?!sharedHistory?.redo.length:!history.canRedo(current.id));
  const object=c?.getActiveObject();
  $('deleteSelectionBtn').disabled=busy||!current;
}
async function stepHistory(direction) {
  if(!current || historyBusy || busy || modalOpen() || tools?.gesture || isTextEditing()) return;
  if(cloudActive()){
    await run(async()=>{await flush();await cloud.enqueue({kind:direction<0?'undo':'redo',pageId:current.id});});
    return;
  }
  const before=history.pages.get(current.id)?.index;
  const content=history.step(current.id,direction);
  if(!content){updateHistory();return;}
  historyBusy=true; updateHistory();
  try {
    await loadCanvas(c,content.canvas);await checkFiles(content);
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
  const object=new fabric.IText(text,{left:center.x,top:center.y,fontFamily:'Arial',fontSize:tools.text.size,fill:tools.text.color,backgroundColor:textBoxDefaults.background,wbTextBorder:textBoxDefaults.border,stroke:null,strokeWidth:0,id:uid()});
  if(!point)object.setPositionByOrigin(center,'center','center');
  c.add(object);c.setActiveObject(object);object.setCoords();c.requestRenderAll();if(!editing)changed();
  if(editing){object.enterEditing();object.selectAll();}
}
function chooseImportColumns(count) {

  return new Promise(resolve=>{
    importLayoutResolver=resolve;
    const modal=$('importLayoutModal');
    $('importAsBackground').checked=false;
    $('importLayoutCount').textContent=`${count}개 항목의 배치 방법을 선택하세요.`;
    const buttons=Array.from(modal.querySelectorAll('[data-columns]'));
    const finish=value=>{importLayoutResolver=null;$('importLayoutModal').style.display='none';if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;resolve(value);};
    buttons.forEach(b=>b.onclick=()=>finish({columns:Number(b.dataset.columns),pinned:$('importAsBackground').checked}));
    openModal('importLayoutModal');
    buttons.forEach(b=>{b.hidden=count===1 && Number(b.dataset.columns)!==1;b.classList.toggle('selected',Number(b.dataset.columns)===Math.min(4,count));});
  });
}
async function importFiles(files,point) {
  await flush();
  const beforeContent=clone(current.content),beforeIndex=history.pages.get(current.id)?.index ?? 0;
  importAbort=new AbortController();
  const progress=$('importProgress');
  progress.hidden=false;
  $('importProgressText').textContent='파일 확인 중…';
  const controller=importAbort;
  const saved=[];
  try {
    const {placements,assets}=await prepareFiles(files,{
      signal:controller.signal,
      requestPassword:askPassword,
      onProgress:message=>{$('importProgressText').textContent=message;}
    });
    if(!placements.length)return;
    progress.hidden=true;
    const layout=await chooseImportColumns(placements.length);
    if(!layout)return;
    const {columns,pinned}=layout;
    progress.hidden=false;
    $('importProgressText').textContent='기기에 파일을 저장하는 중…';
    for(const asset of assets){
      controller.signal.throwIfAborted();
      await store.putAsset(asset);saved.push(asset.id);boardFiles.invalidate(asset.id);
    }
    controller.signal.throwIfAborted();
    const center=point||fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform));
    const gap=24,maxWidth=Math.min(800,c.width/c.getZoom()*.75),cellWidth=Math.max(40,(maxWidth-gap*(Math.max(1,columns)-1))/Math.max(1,columns));
    let y=center.y,rowHeight=0;
    tools.setMode('select');
    const added=placements.map((args,index)=>{
      const col=columns?index%columns:0;
      if(columns && index && !col){y+=rowHeight+gap;rowHeight=0;}
      const image=new fabric.WbFile(args);
      image.id=uid();
      image.scale(Math.min(1,cellWidth/image.width));
      image.set({left:columns?center.x-maxWidth/2+col*(cellWidth+gap)+(cellWidth-image.getScaledWidth())/2:center.x-image.getScaledWidth()/2,top:y,wbPinned:pinned});
      image.setCoords();
      rowHeight=Math.max(rowHeight,image.getScaledHeight());
      return image;
    });
    added.forEach(image=>c.add(image));
    orderPinnedObjects();
    c.requestRenderAll();changed();await flush();
    notify(columns?`${added.length}개 항목을 ${columns}열로 배치했습니다.`:`${added.length}개 항목을 한곳에 배치했습니다.`);
  } catch(error) {
    for(const id of saved){await store.deleteAsset(id).catch(console.warn);boardFiles.invalidate(id);}
    const entry=history.pages.get(current.id);if(entry){entry.index=beforeIndex;entry.items.splice(beforeIndex+1);}
    current.content=beforeContent;dirty=false;generation++;
    await loadCanvas(c,beforeContent.canvas);tools.setMode('select');c.requestRenderAll();updateHistory();
    if(error.name==='QuotaExceededError')throw Error('브라우저 저장 공간이 부족합니다. 기존 칠판은 보존했습니다.');
    throw error;
  } finally {progress.hidden=true;}
}

function allToolSizes() {
  return Object.fromEntries(Object.entries(SIZE_DEFAULTS).map(([key,values])=>[key,[...values,shared.favoriteSize?.[key]??values[2]]]));
}
function syncSharedUI(){
  const sizes=allToolSizes();
  for(const key of ['pen','marker','text']){
    tools[key][key==='text'?'size':'width']=sizes[key][shared.level-1];
    tools[key].color=shared.color;
  }
  tools.updateBrush();
  const colorButton=$('currentColorButton'),sizeButton=$('currentSizeButton');
  colorButton.firstElementChild.style.backgroundColor=shared.color;
  sizeButton.firstElementChild.textContent=shared.level===6?'★':String(shared.level);
  for (const [button,label] of [[colorButton,`현재 색상 ${shared.color}`],[sizeButton,shared.level===6?'현재 크기 즐겨찾기':`현재 크기 ${shared.level}단계`]]) {
    button.title=label;button.setAttribute('aria-label',label);
  }
  const colors=[...QUICK_DEFAULTS,...(isColor(shared.favoriteColor)?[shared.favoriteColor]:[])];
  const levels=shared.favoriteSize?[1,2,3,4,5,6]:[1,2,3,4,5];
  for(const id of ['quickColors','contextColors'])renderAppearanceChoices(id,'color',colors);
  for(const id of ['quickSizes','contextSizes'])renderAppearanceChoices(id,'level',levels);
}
function renderAppearanceChoices(id, property, choices){
  const root=$(id);
  const inContext=root.closest('#objectContextMenu')!==null;
  const isColor=property==='color';
  root.replaceChildren();
  for (const [index,value] of choices.entries()) {
    const button=document.createElement('button');
    const selected=value===shared[property];
    const favorite=index===5;
    const label=isColor?`${favorite?'즐겨찾기 색상':'색상'} ${value}`:favorite?'즐겨찾기 크기':`크기 ${value}단계`;
    button.type='button';
    button.title=label;
    button.setAttribute('aria-label',label);
    if (inContext) button.setAttribute('role','menuitemradio');
    button.setAttribute(inContext?'aria-checked':'aria-pressed',String(selected));
    button.classList.toggle('selected',selected);
    button.classList.toggle('favorite',favorite);
    if (isColor) button.style.backgroundColor=value;
    else button.textContent=value===6?'★':String(value);
    button.onclick=()=>{
      closePopups();
      setShared({[property]:value});
      if (!inContext) $(isColor?'currentColorButton':'currentSizeButton').focus();
    };
    root.append(button);
  }
}
function setShared({color,level}={}){
  if(!current||busy)return;
  if(color && !isColor(color))return;
  if(color)shared.color=color.toLowerCase();
  if(Number.isInteger(level) && level>=1 && level<=(shared.favoriteSize?6:5))shared.level=level;
  const active=c.getActiveObject(),n=applyAppearance(active,{color:color?shared.color:null,level:level?shared.level:null,sizes:allToolSizes()});
  if(n){if(active?.type==='group')active.dirty=true;active?.setCoords?.();c.requestRenderAll();changed();}
  syncSharedUI();
}
function renderFavoriteDraft() {
  const preview=(id,values,selected,isColor,hasFavorite)=>{
    $(id).replaceChildren(...values.map((value,index)=>{
      const item=document.createElement('span');
      item.classList.toggle('selected',value===selected);
      item.classList.toggle('favorite',hasFavorite && index===values.length-1);
      if(isColor){item.style.backgroundColor=value;item.setAttribute('aria-label',value);}
      else item.textContent=value===6?'★':String(value);
      return item;
    }));
  };
  preview('previewColors',[...QUICK_DEFAULTS,...(favoriteColorDraft?[favoriteColorDraft]:[])],shared.color,true,!!favoriteColorDraft);
  preview('previewSizes',favoriteSizeEnabled?[1,2,3,4,5,6]:[1,2,3,4,5],shared.level,false,favoriteSizeEnabled);
  $('favoriteColorValue').textContent=favoriteColorDraft?.toUpperCase()??'미등록';
  $('removeFavoriteColor').textContent=favoriteColorDraft?'삭제':'추가';
  $('removeFavoriteSize').textContent=favoriteSizeEnabled?'삭제':'추가';
  for(const key of Object.keys(SIZE_LABELS))$(`favorite-${key}`).value=favoriteDraft[key];
}
function openAppearanceSettings() {
  if(!allowed())return;
  favoriteColorDraft=isColor(shared.favoriteColor)?shared.favoriteColor:null;
  $('favoriteColor').value=favoriteColorDraft??'#ff8800';
  favoriteSizeEnabled=!!shared.favoriteSize;
  favoriteDraft={...(shared.favoriteSize||defaultFavoriteSize())};
  renderFavoriteDraft();
  openModal('sharedSettingsModal');
}
function wireAppearanceSettings() {
  const defaults=$('sizeDefaults'),sizes=$('favoriteSizes');
  const presets=document.createElement('p');presets.textContent='색상 '+QUICK_DEFAULTS.join(' · ');defaults.append(presets);
  for(const [key,label] of Object.entries(SIZE_LABELS)){
    const row=document.createElement('p');row.textContent=`${label} (px) · ${SIZE_DEFAULTS[key].join(' / ')}`;defaults.append(row);
    const field=document.createElement('label');field.textContent=label+' (px)';
    const input=document.createElement('input');input.type='number';input.min='1';input.max=SIZE_LIMITS[key];input.step='1';input.id=`favorite-${key}`;
    input.onchange=()=>{
      const next=normalizeFavoriteSize({...favoriteDraft,[key]:input.valueAsNumber});
      if(next){favoriteDraft=next;favoriteSizeEnabled=true;}
      renderFavoriteDraft();
    };
    field.append(input);sizes.append(field);
  }
  $('colorSettingsBtn').onclick=openAppearanceSettings;
  $('favoriteColor').oninput=()=>{favoriteColorDraft=$('favoriteColor').value;renderFavoriteDraft();};
  $('removeFavoriteColor').onclick=()=>{
    favoriteColorDraft=favoriteColorDraft?null:$('favoriteColor').value;
    renderFavoriteDraft();
  };
  $('removeFavoriteSize').onclick=()=>{favoriteSizeEnabled=!favoriteSizeEnabled;renderFavoriteDraft();};
  for(const [id,increase] of [['smallerFavorite',false],['largerFavorite',true]])$(id).onclick=()=>{
    favoriteSizeEnabled=true;
    favoriteDraft=scaleFavoriteSize(favoriteDraft,increase);renderFavoriteDraft();
  };
  $('saveFavorites').onclick=()=>{
    shared.favoriteColor=favoriteColorDraft??'';
    shared.favoriteSize=favoriteSizeEnabled?{...favoriteDraft}:null;
    writePreference('wb42.favoriteColor',shared.favoriteColor);
    writePreference('wb42.favoriteSize',shared.favoriteSize);
    if(shared.level===6 && !shared.favoriteSize)shared.level=3;
    syncSharedUI();
    closeModal('sharedSettingsModal');
  };
}
function orderPinnedObjects() {
  const objects=c.getObjects();
  [...objects.filter(object=>object.wbPinned),...objects.filter(object=>!object.wbPinned)]
    .forEach((object,index)=>c.moveTo(object,index));
}
function pinSelection() {
  const objects=c.getActiveObjects().slice();
  if(!objects.length)return;
  c.discardActiveObject();
  objects.forEach(object=>{object.wbPinned=true;});
  orderPinnedObjects();updateFileInteraction();c.requestRenderAll();changed();
}
function openBackgroundSettings() {
  if(!allowed())return;
  const pattern=normalizePattern(c.wbBackgroundPattern);
  $('backgroundPattern').value=pattern.kind;$('backgroundSpacing').value=String(pattern.spacing);
  $('backgroundSpacingRow').hidden=pattern.kind==='plain';
  $('backgroundSpacingValue').textContent=pattern.spacing+'px';
  $('pageBgInput').value=isColor(favoriteBackground)?favoriteBackground:isColor(c.backgroundColor)?c.backgroundColor:DEFAULT_BG;
  renderBackgroundColors();
  openModal('backgroundModal');
}
function renderBackgroundColors() {
  const colors=[...BACKGROUND_COLORS,...(isColor(favoriteBackground)?[['즐겨찾기',favoriteBackground]]:[])];
  $('backgroundColors').replaceChildren(...colors.map(([name,color])=>{
    const button=document.createElement('button');button.type='button';button.className='action-btn';
    const swatch=document.createElement('span');swatch.className='background-swatch';swatch.style.backgroundColor=color;button.append(swatch,name);
    button.setAttribute('aria-pressed',String(c.backgroundColor===color));
    button.onclick=()=>{c.backgroundColor=color;c.requestRenderAll();changed();renderBackgroundColors();};
    return button;
  }));
}
function openBackgroundManager() {
  if(!allowed())return;
  const list=$('backgroundObjects');
  list.replaceChildren();
  const pinned=c.getObjects().filter(object=>object.wbPinned);
  for(const object of pinned){
    const label=document.createElement('label'),box=document.createElement('input');
    box.type='checkbox';box.value=object.id;
    label.className='fixed-object-row';
    const preview=document.createElement('img');preview.alt='';
    const {kind,detail}=fixedObjectLabel(object);
    const name=document.createElement('span');
    const title=document.createElement('strong');title.textContent=kind;name.append(title);
    if(detail){const subtitle=document.createElement('small');subtitle.textContent=detail;subtitle.title=detail;name.append(subtitle);}
    label.append(box,preview,name);list.append(label);
    const bounds=object.getBoundingRect(true,true);
    const zoom=Math.min(46/Math.max(1,bounds.width),32/Math.max(1,bounds.height));
    const view=[zoom,0,0,zoom,28-zoom*(bounds.left+bounds.width/2),21-zoom*(bounds.top+bounds.height/2)];
    const content={canvas:{objects:[object.toObject(SERIAL_PROPS)],background:c.backgroundColor},frame:{width:56,height:42}};
    makeThumbnail(content,view,56,42,56,canvas=>boardFiles.settlePreview(canvas))
      .then(src=>{if(preview.isConnected)preview.src=src;})
      .catch(error=>console.warn('고정개체 미리보기를 만들 수 없습니다.',error));
  }
  if(!pinned.length)list.textContent='배경에 고정된 개체가 없습니다.';
  $('unlockBackgroundObjects').disabled=true;
  list.onchange=()=>{$('unlockBackgroundObjects').disabled=!list.querySelector(':checked');};
  openModal('backgroundManageModal');
}
function wireBackgroundSettings() {
  for(const [value,label] of BACKGROUND_PATTERNS)$('backgroundPattern').add(new Option(label,value));
  $('backgroundBtn').onclick=openBackgroundSettings;
  $('backgroundManageBtn').onclick=openBackgroundManager;
  $('contextBackground').onclick=openBackgroundSettings;
  $('contextBackgroundManage').onclick=openBackgroundManager;
  $('contextPin').onclick=()=>{closeContext();pinSelection();};
  $('contextCopy').onclick=()=>{closeContext();void clipboard.copy();};
  $('contextLoad').onclick=()=>{closeContext();$('loadGeneralBtn').click();};
  $('saveBackgroundColor').onclick=()=>{
    favoriteBackground=$('pageBgInput').value;writePreference('wb42.favoriteBackground',favoriteBackground);
    c.backgroundColor=favoriteBackground;c.requestRenderAll();changed();renderBackgroundColors();
  };
  const previewPattern=()=>{
    const kind=$('backgroundPattern').value,spacing=$('backgroundSpacing').valueAsNumber;
    $('backgroundSpacingRow').hidden=kind==='plain';$('backgroundSpacingValue').textContent=spacing+'px';
    setCanvasPattern(c,{kind,spacing});c.requestRenderAll();
  };
  $('backgroundPattern').onchange=()=>{previewPattern();changed();};
  $('backgroundSpacing').oninput=previewPattern;
  $('backgroundSpacing').onchange=()=>{previewPattern();changed();};
  $('unlockBackgroundObjects').onclick=()=>{
    const ids=new Set([...$('backgroundObjects').querySelectorAll(':checked')].map(box=>box.value));
    for(const object of c.getObjects())if(ids.has(object.id))delete object.wbPinned;
    orderPinnedObjects();updateFileInteraction();c.requestRenderAll();changed();closeModal('backgroundManageModal');
  };
}
function openTextProps(target=null){
  if(!allowed())return;
  textPropsTarget=target;
  const style=target?normalizeTextBoxStyle({background:target.backgroundColor,border:target.wbTextBorder}):textBoxDefaults;
  $('textPropsTitle').textContent=target?'텍스트박스 속성':'텍스트 박스 기본속성';
  $('textBgEnabled').checked=!!style.background;
  $('textBgColor').value=style.background||'#ffffff';
  $('textBorderEnabled').checked=!!style.border;
  $('textBorderColor').value=style.border?.color??'#000000';
  $('textBorderWidth').value=style.border?.width??2;
  updateTextPropInputs();
  openModal('textPropsModal');
}
function updateTextPropInputs(){
  $('textBgColor').disabled=!$('textBgEnabled').checked;
  $('textBorderColor').disabled=$('textBorderWidth').disabled=!$('textBorderEnabled').checked;
}
function saveTextProps(event){
  event.preventDefault();
  const style=normalizeTextBoxStyle({
    background:$('textBgEnabled').checked?$('textBgColor').value:'',
    border:$('textBorderEnabled').checked?{color:$('textBorderColor').value,width:$('textBorderWidth').valueAsNumber||2}:null
  });
  const target=textPropsTarget;
  if(target){
    const contains=objects=>objects.some(object=>object===target||object.getObjects && contains(object.getObjects()));
    if(!contains(c.getObjects())){closeModal('textPropsModal');notify('해당 개체를 찾을 수 없습니다.');return;}
    target.set({backgroundColor:style.background,wbTextBorder:style.border});
    for(let parent=target.group;parent;parent=parent.group)parent.dirty=true;
    target.setCoords();c.requestRenderAll();changed();
  }else{
    textBoxDefaults=style;
    writePreference('wb50.textBoxDefaults',style);
  }
  closeModal('textPropsModal');
}
function layerToEdge(front){if(!allowed()||isTextEditing())return;const selection=c.getActiveObjects();if(!selection.length)return;const all=c.getObjects(),pinned=all.filter(o=>o.wbPinned),next=[...pinned,...orderedToEdge(all.filter(o=>!o.wbPinned),selection,front)];if(next.every((o,i)=>o===all[i]))return;next.forEach((o,i)=>c.moveTo(o,i));c.requestRenderAll();changed();}
function closeContext(){const menu=$('objectContextMenu');if(menu)menu.hidden=true;}
function openContext(x,y,target=null,hit=target){
  if(!allowed()||isTextEditing()||(target && tools.mode!=='select'))return;
  closePopups();
  if(target && !c.getActiveObjects().includes(target)){c.setActiveObject(target);c.requestRenderAll();}
  const active=target?c.getActiveObject():null,menu=$('objectContextMenu');
  menu.setAttribute('aria-label',active?'개체 메뉴':'배경 메뉴');
  menu.querySelectorAll('.context-palette').forEach(palette=>{palette.hidden=!active;});
  for(const id of ['contextBackground','contextBackgroundManage','contextLoad'])$(id).hidden=!!active;
  for(const id of ['contextCopy','contextPin'])$(id).hidden=!active;
  $('contextGroup').hidden=active?.type!=='activeSelection';
  $('contextUngroup').hidden=active?.type!=='group';
  $('contextFront').hidden=$('contextBack').hidden=!active;
  contextTextTarget=TEXT_TYPES.has(hit?.type)?hit:null;
  $('contextTextProps').hidden=!contextTextTarget;
  menu.hidden=false;
  menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,x))+'px';
  menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,y))+'px';
  [...menu.querySelectorAll('button')].find(button=>!button.closest('[hidden]'))?.focus();
}
function beginGroupSession(group,child){if(!group ||group.type!=='group')return;const id=group.id,index=c.getObjects().indexOf(group),all=group.getObjects().slice();
 suppressSelection=true;try{const selection=group.toActiveSelection();groupSession={id,index,all};c.discardActiveObject();c.setActiveObject(child||all[0]);c.requestRenderAll();}finally{suppressSelection=false;}}
function closeGroupSession(){if(!groupSession||!c)return;const state=groupSession;groupSession=null;const live=state.all.filter(o=>c.getObjects().includes(o));if(live.length<2)return;
 suppressSelection=true;try{c.discardActiveObject();const selection=new fabric.ActiveSelection(live,{canvas:c});c.setActiveObject(selection);const group=selection.toGroup();group.id=state.id;c.moveTo(group,Math.min(state.index,c.getObjects().length-1));group.setCoords();c.requestRenderAll();changed();}finally{suppressSelection=false;}}
async function makeCurrentViewportThumbnail(width=320) {
  const ratio=width/Math.max(1,c.getWidth());
  return c.toDataURL({format:'png',multiplier:ratio});
}
let openedPopup=null, pageActions=null;
function closePageActions(){
  if(!pageActions)return;
  pageActions.trigger.setAttribute('aria-expanded','false');
  pageActions.actions.hidePopover();
  pageActions=null;
}
function closePopups() {
  tabViews?.finishRename();
  closePageActions();closeContext();
  document.querySelectorAll('.tip-up-settings').forEach(p=>p.style.display='none');
  document.querySelectorAll('[data-popup],#viewSyncTrigger').forEach(b=>b.setAttribute('aria-expanded','false'));
  openedPopup=null;
}
function positionToolbarPopup() {
  if(!openedPopup || openedPopup==='viewSyncMenu')return;
  const popup=$(openedPopup);
  const trigger=document.querySelector('[data-popup="'+openedPopup+'"][aria-expanded="true"]');
  if(!trigger)return;
  const margin=8;
  const edge=$('toolbar').getBoundingClientRect().top-margin;
  const rect=trigger.getBoundingClientRect();
  popup.style.maxHeight=Math.max(0,edge-margin)+'px';
  popup.style.left=Math.max(margin,Math.min(innerWidth-popup.offsetWidth-margin,rect.left+(rect.width-popup.offsetWidth)/2))+'px';
  popup.style.top='auto';
  popup.style.bottom=(innerHeight-edge)+'px';
}
function updateToolbarLayout() {
  const height=$('toolbar').getBoundingClientRect().height;
  const frame=$('scoreFrame'), clearance=String(Math.ceil(height));
  if(frame.dataset.toolbarHeight!==clearance)frame.dataset.toolbarHeight=clearance;
  updateFeedbackPosition();
  if(height>0){
    positionToolbarPopup();
    tabViews?.position();
  }else if(openedPopup){
    closePopups();
  }
}
function togglePopup(id,button) {
  if(busy)return;
  const was=openedPopup===id;closePopups();if(was)return;
  const p=$(id);p.style.display='block';openedPopup=id;button.setAttribute('aria-expanded','true');
  if(id==='pageList')renderPageTiles();
  positionToolbarPopup();
}
function openModal(id) {closePopups();finishText();modalFocus=document.activeElement;$(id).style.display='flex';$(id).querySelector('input,button')?.focus();}
function closeModal(id) {
  $(id).style.display='none';
  if(id==='confirmModal' && confirmResolver){const resolve=confirmResolver;confirmResolver=null;resolve(false);}
  if(id==='importLayoutModal' && importLayoutResolver){const resolve=importLayoutResolver;importLayoutResolver=null;resolve(null);}
  if(id==='passwordModal' && passwordResolver){const resolve=passwordResolver;passwordResolver=null;resolve(null);}
  if(modalFocus&&typeof modalFocus.focus==='function')modalFocus.focus();modalFocus=null;
  if(cloudActive())requestCloudRefresh();else applyLocalView().catch(fail);
}
function askConfirm(message,{title='확인',confirmText='확인',cancelText='취소'}={}) {
  return new Promise(resolve=>{
    if(confirmResolver)confirmResolver(false);
    confirmResolver=resolve;
    $('confirmModalTitle').textContent=title;
    $('confirmModalMessage').textContent=message;
    $('confirmModalOkBtn').textContent=confirmText;
    $('confirmModalOkBtn').classList.toggle('dialog-danger',confirmText.startsWith('삭제') || confirmText.includes('지우기'));
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
  const all=cloudActive()?boardPages(cloud.projected()):await store.listPages();
  if(current && dirty){const index=all.findIndex(p=>p.id===current.id),local={...clone(current),content:capture()};if(index>=0)all[index]=local;else all.push(local);}
  const screens=await store.listScreens();
  const files=new Map();
  for(const page of [...all,...screens])assetReferences(page.content.canvas.objects,files);
  const assets=[];
  for(const id of files.keys()){
    const asset=await store.getAsset(id);
    if(asset)assets.push({id,data:await readDataURL(asset.blob)});
  }
  downloadJSON({format:'whiteboard-pages',schema:2,appVersion:VERSION,exportedAt:new Date().toISOString(),pages:all,screens,assets},`만능칠판-백업-${new Date().toISOString().slice(0,10)}.json`);
  if(saveError)notify('자동저장 실패 상태의 현재 작업도 백업 파일에 포함했습니다.');
}
function reidentify(json) {json.objects?.forEach(o=>{o.id=uid();reidentify(o);});}
async function importBackup(file) {
  if(file.size>MAX_BACKUP_BYTES)throw Error('백업 파일은 100MB 이하여야 합니다.');
  const input=JSON.parse(await file.text());
  if(input.format!=='whiteboard-pages'||input.schema!==2||!Array.isArray(input.pages)||!Array.isArray(input.screens))throw Error('만능칠판 2.0 백업 파일이 아닙니다.');
  if(input.pages.length+input.screens.length>1000)throw Error('백업 항목은 1,000개까지 한 번에 가져올 수 있습니다.');
  const now=Date.now();
  const imported=input.pages.map((p,i)=>{const content=validateContent(p.content);reidentify(content.canvas);return {id:uid(),name:`페이지 ${Math.min(MAX_PAGES,i+1)}`,title:pageTitle(p.title)||undefined,content,version:1,order:now+i,createdAt:now,updatedAt:now};});
  const screens=[];
  for(const s of input.screens) {
    const content=validateContent(s.content);
    screens.push({id:uid(),name:String(s.name||'가져온 화면').slice(0,100),savedAt:now,content,thumbnail:await makeThumbnail(content)});
  }
  await flush();
  const assets=[];
  for(const asset of input.assets||[]){
    if(!/^[a-z0-9_-]{1,128}$/i.test(asset.id)||!/^data:[^,]*;base64,/i.test(asset.data))throw Error('백업에 포함된 파일 형식이 올바르지 않습니다.');
    if(!await store.getAsset(asset.id))assets.push({id:asset.id,blob:await (await fetch(asset.data)).blob()});
  }
  await store.appendBackup(cloudActive()?[]:imported,screens,assets);
  assets.forEach(asset=>boardFiles.invalidate(asset.id));
  if(imported.length && cloudActive())await cloud.enqueue({kind:'add',pages:await Promise.all(imported.map(prepareCloudPage))});
  sync.notify();pages=cloudActive()?boardPages(cloud.projected()):await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  if(imported.length)await setPage(pages.find(page=>page.id===imported[0].id),true,false);else renderPages();
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
  await flush();await store.appendBackup(cloudActive()?[]:imported,screens);
  if(imported.length && cloudActive())await cloud.enqueue({kind:'add',pages:await Promise.all(imported.map(prepareCloudPage))});
  await store.setMeta('legacyImported',true);sync.notify();pages=cloudActive()?boardPages(cloud.projected()):await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  if(imported.length)await setPage(pages.find(page=>page.id===imported[0].id),true,false);else renderPages();
  notify(`이전 자동저장 ${imported.length}개와 저장 화면 ${screens.length}개를 가져왔습니다. 원본 데이터는 유지했습니다.`);
}
function hasLegacyImage(object){return object.type==='image' || object.objects?.some(hasLegacyImage);}
async function prepareCloudPage(page) {
  if(!page.content.canvas.objects.some(hasLegacyImage))return page;
  const clean=clone(page);
  async function replaceImages(objects){
    for(let index=0;index<objects.length;index++){
      const object=objects[index];
      if(object.type==='image'){
        if(!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(object.src))throw Error('외부 이미지 주소는 동기화할 수 없습니다. 이미지 파일을 다시 넣어주세요.');
        const id=object.id;
        const blob=await (await fetch(object.src)).blob();
        const info={id,name:'기존 이미지',type:'image',size:blob.size};
        const {src,crossOrigin,filters,resizeFilter,cropX,cropY,...properties}=object;
        objects[index]={...properties,type:'wb-file',wbAsset:info};
        await store.putAsset({id,blob});boardFiles.invalidate(id);
      }else if(object.objects)await replaceImages(object.objects);
    }
  }
  normalizedObjects(clean.content.canvas.objects);
  await replaceImages(clean.content.canvas.objects);
  return clean;
}

function requestCloudRefresh(delay=25) {
  clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer=setTimeout(()=>refreshCloud().catch(fail),typeof delay==='number'?delay:25);
}
async function refreshCloud() {
  if(!cloudActive() || !current)return;
  $('viewSync').checked=activeView(cloud.latestView,sync.id);
  if(cloudRefresh){requestCloudRefresh();return;}
  const board=cloud.projected();
  const remote=board.pages[current.id];
  const editing=isTextEditing();
  if(editing && remote?.deleted){
    cancelledText=true;groupSession=null;
    try{finishText();}finally{cancelledText=false;}
    notify('다른 기기에서 페이지를 삭제하여 편집을 취소했습니다.');
  }
  if(busy || saving || tools.gesture || historyBusy || (dirty && !remote?.deleted) || (editing && !cloudBase) || (modalOpen() && cloudBase && !remote?.deleted)){
    requestCloudRefresh(150);return;
  }
  cloudRefresh=true;
  try {
    pages=boardPages(board);
    cloudHistory=board.history;
    if(!remote || remote.deleted || !cloudBase){
      cloudBase=null;dirty=false;
      await run(()=>setPage(remote && !remote.deleted?remote:pages[0],true));
    }else if(remote.version!==current.version || pagePatch(cloudBase,remote.content) || pagePatch(current.content,cloudBase)){
      if(isTextEditing()){
        const edit=c.getActiveObject();
        const protectedId=groupSession?.id || edit.id;
        const protectedObjects=new Set(groupSession?.all || [edit]);
        const old=cloudBase.canvas.objects.find(object=>object.id===protectedId);
        const merged=clone(remote.content);
        merged.canvas.objects=merged.canvas.objects.filter(object=>object.id!==protectedId);
        if(old)merged.canvas.objects.splice(Math.min(cloudBase.canvas.objects.findIndex(object=>object.id===protectedId),merged.canvas.objects.length),0,old);
        const patch=pagePatch(cloudBase,merged);
        const incoming=patch?.objects.filter(([,object])=>object).map(([,object])=>object)||[];
        const objects=await new Promise(resolve=>fabric.util.enlivenObjects(incoming,resolve));
        if(!isTextEditing() || c.getActiveObject()!==edit || busy || saving || dirty || tools.gesture){requestCloudRefresh();return;}
        for(const [id] of patch?.objects||[]){
          const existing=c.getObjects().find(object=>object.id===id && !protectedObjects.has(object));
          if(existing)c.remove(existing);
        }
        objects.forEach((object,index)=>{if(object){object.id=incoming[index].id;c.add(object);}});
        merged.canvas.objects.forEach((item,index)=>{
          const object=c.getObjects().find(candidate=>candidate.id===item.id && !protectedObjects.has(candidate));
          if(object)c.moveTo(object,index);
        });
        c.backgroundColor=merged.canvas.background;setCanvasPattern(c,merged.canvas.wbBackgroundPattern);c.requestRenderAll();
        current={...current,content:merged,version:remote.version};cloudBase=clone(merged);
        await checkFiles(merged);
      }else{
        const mode=tools.mode;
        const selected=c.getActiveObjects().map(object=>object.id);
        await run(async()=>{
          await setPage(remote,true);
          tools.setMode(mode);
          const objects=c.getObjects().filter(object=>selected.includes(object.id) && !object.wbAssetMissing && !object.wbPinned);
          if(mode==='select' && objects.length)c.setActiveObject(objects.length===1?objects[0]:new fabric.ActiveSelection(objects,{canvas:c}));
          c.requestRenderAll();
        });
      }
    }
    renderPages();updateHistory();
    const view=cloud.latestView;
    if(activeView(view,sync.id) && view!==seenView && (view.sourceTab ? view.sourceTab===sync.id : view.device===cloud.deviceId))seenView=view;
    if(activeView(view,sync.id) && view!==seenView && pages.some(page=>page.id===view.pageId) && !isTextEditing() && !modalOpen()){
      seenView=view;applyingView=true;
      try{
        if(current.id!==view.pageId)await run(()=>activatePage(view.pageId));
        if(current.id===view.pageId){
          applyViewport(view);
        }
      }finally{applyingView=false;}
    }
    cloudUI?.boardChanged().catch(fail);
  }finally{cloudRefresh=false;}
}

function applyViewport(view){
  receiveScoreView(view);
  c.setViewportTransform([view.zoom,0,0,view.zoom,c.width/2-view.x*view.zoom,c.height/2-view.y*view.zoom]);
  c.requestRenderAll();rememberView();
}
function restoreLocalView(){
  const state=sync.readView();
  localView=validViewState(state)?state:null;
  $('viewSync').checked=activeView(localView,sync.id);
  applyLocalView().catch(fail);
}
async function applyLocalView(){
  const view=localView;
  if(!current || cloudActive() || !activeView(view,sync.id) || seenView===view || applyingView || dirty || saving || busy || modalOpen() || tools.gesture || isTextEditing())return;
  if(!pages.some(page=>page.id===view.pageId))return;
  seenView=view;applyingView=true;
  try{
    if(current.id!==view.pageId)await run(()=>activatePage(view.pageId));
    if(current.id!==view.pageId)return;
    applyViewport(view);
  }finally{applyingView=false;if(view!==localView)queueMicrotask(()=>applyLocalView().catch(fail));}
}
async function refreshRemote() {
  if (cloud?.options && !cloud.detaching && !cloud.pulling && !cloud.pushing && !busy && !dirty && !saving && !tools?.gesture && !isTextEditing()) {
    const options = cloud.options;
    const connected = await store.getMeta('cloudConnection');
    if (cloud.options === options && !connected && !cloud.detaching) {
      cloud.clearConnection();
      await reloadLocalAfterDisconnect();
    }
  }
  if(cloud?.options || syncing || busy || dirty || saving || tools?.gesture || isTextEditing() || modalOpen() || !current)return;
  syncing=true;
  try {
    const all=await store.listPages();
    if(busy || dirty || saving || tools.gesture || isTextEditing() || modalOpen())return;
    pages=all;const remote=all.find(p=>p.id===current.id);
    if(!remote || remote.version!==current.version) {
      await run(async()=>{
        const next=remote || all[0] || await store.ensurePage(emptyContent(c.width,c.height));
        if(!all.length)pages=await store.listPages();
        const mode=tools.mode;
        await setPage(next,true);tools.setMode(mode);status('다른 탭의 변경을 반영했습니다.');
      },'다른 탭의 변경을 반영하는 중입니다.');
    } else {current.order=remote.order;renderPages();}
  } catch(e){console.error('탭 동기화 오류',e);status('동기화 확인 실패','error');}
  finally{syncing=false;}
  await applyLocalView();
}
function wireUI() {
  document.querySelectorAll('[data-popup]').forEach(b=>b.onclick=()=>{
    const mode=b.dataset.toolMode;
    if(mode && allowed()){finishText();tools.setMode(mode);}
    togglePopup(b.dataset.popup,b);
  });
  document.addEventListener('pointerdown',e=>{if(shouldClosePopups(e.target))closePopups();});
  $('toolbar').addEventListener('scroll',()=>{if(openedPopup)closePopups();});
  const toolbarLayout=new ResizeObserver(updateToolbarLayout);
  toolbarLayout.observe($('toolbar'));
  updateToolbarLayout();
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  $('confirmModalOkBtn').onclick=()=>resolveConfirm(true);$('confirmModalCancelBtn').onclick=()=>resolveConfirm(false);
  $('passwordModalOkBtn').onclick=()=>resolvePassword($('pdfPasswordInput').value);
  $('passwordModalCancelBtn').onclick=()=>resolvePassword(null);
  $('pdfPasswordInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('passwordModalOkBtn').click();}});
  const modeMap={penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser'};
  Object.entries(modeMap).forEach(([id,mode])=>$(id).onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode===mode?'select':mode);});
  $('selectMoveToggleBtn').onclick=()=>{if(!allowed())return;finishText();tools.setMode(tools.mode==='select'?'move':'select');};
  wireAppearanceSettings();wireBackgroundSettings();
  wirePageReorder($('pageTiles'),(source,target)=>movePage(source,target).catch(fail));
  $('pageTiles').addEventListener('scroll',closePageActions);
  $('pageRenameForm').onsubmit=event=>savePageTitle(event).catch(fail);
  $('textBgEnabled').onchange=$('textBorderEnabled').onchange=updateTextPropInputs;
  $('textPropsForm').onsubmit=saveTextProps;
  $('moreTextPropsBtn').onclick=()=>openTextProps();
  $('contextGroup').onclick=()=>{closeContext();groupObjects();};$('contextUngroup').onclick=()=>{closeContext();groupObjects(true);};
  $('contextFront').onclick=()=>{closeContext();layerToEdge(true);};$('contextBack').onclick=()=>{closeContext();layerToEdge(false);};
  $('contextTextProps').onclick=()=>{if(contextTextTarget)openTextProps(contextTextTarget);};
  // A stationary 600ms touch press opens the object menu; movement cancels it.
  let pressTimer=null,pressStart=null,suppressNextClick=false;
  const surface=c.upperCanvasEl;
  surface.addEventListener('contextmenu',e=>{
    e.preventDefault();
    if(!allowed())return;
    if(isTextEditing())finishText();
    const skip=c.skipTargetFind;
    c.skipTargetFind=false;
    let target;
        let hit;
    try{
      target=c.findTarget(e);
      hit=target?.type==='activeSelection'?c.findTarget(e,true):target;
    }finally{c.skipTargetFind=skip;}
    if(tools.mode==='select' || !target)openContext(e.clientX,e.clientY,target,hit);
  });
  surface.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||tools.mode!=='select')return;const target=c.findTarget(e);if(!target)return;pressStart={x:e.clientX,y:e.clientY};pressTimer=setTimeout(()=>{pressTimer=null;suppressNextClick=true;tools.up();openContext(e.clientX,e.clientY,target);},600);});
  surface.addEventListener('pointermove',e=>{if(pressStart&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>9){clearTimeout(pressTimer);pressTimer=null;pressStart=null;}});
  for(const type of ['pointerup','pointercancel'])surface.addEventListener(type,()=>{clearTimeout(pressTimer);pressTimer=null;pressStart=null;if(cloudActive())requestCloudRefresh();else applyLocalView().catch(fail);});
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
  surface.addEventListener('pointerdown',e=>{if(isTextEditing() && e.button!==2 && !c.findTarget(e)?.isEditing)finishText();},true);
  $('undoBtn').onclick=()=>stepHistory(-1).catch(fail);$('redoBtn').onclick=()=>stepHistory(1).catch(fail);
  $('previousPageBtn').onclick=()=>stepPage(-1);
  $('nextPageBtn').onclick=()=>stepPage(1);
  const clearPage=async()=>{if(!allowed())return;if(await askConfirm('현재 페이지에서 편집 가능한 개체를 모두 지울까요? 언두로 되돌릴 수 있습니다.',{title:'현재 페이지 전체 지우기',confirmText:'전체 지우기'})){finishText();c.discardActiveObject();const list=c.getObjects().filter(object=>!object.wbAssetMissing && !object.wbPinned);if(list.length){list.forEach(o=>c.remove(o));c.requestRenderAll();changed();}}};
  let deleteTimer=null,deleteLong=false;
  const cancelDeletePress=()=>{clearTimeout(deleteTimer);deleteTimer=null;};
  wireToolbarDrag($('toolbar'),()=>{cancelDeletePress();closePopups();});
  $('deleteSelectionBtn').addEventListener('pointerdown',e=>{if(e.button!==0)return;deleteLong=false;deleteTimer=setTimeout(()=>{deleteLong=true;clearPage().catch(fail);},600);});
  for(const type of ['pointerup','pointercancel','pointerleave'])$('deleteSelectionBtn').addEventListener(type,cancelDeletePress);
  $('deleteSelectionBtn').onclick=e=>{if(deleteLong){e.preventDefault();deleteLong=false;return;}deleteSelected();};
  $('zoomInBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()*1.25);};$('zoomOutBtn').onclick=()=>{if(allowed())tools.zoom(c.getZoom()/1.25);};$('homeBtn').onclick=()=>{if(allowed())tools.home(current.content.frame);};
  $('toolbarHideBtn').onclick=()=>{const hidden=!$('toolbar').hidden;$('toolbar').hidden=hidden;setBoardIcon($('toolbarHideBtn'),hidden?'up':'down');$('toolbarHideBtn').setAttribute('aria-label',hidden?'툴바 펼치기':'툴바 접기');$('toolbarHideBtn').setAttribute('aria-expanded',String(!hidden));closePopups();updateToolbarLayout();};
  $('saveBtn').onclick=()=>{if(!allowed())return;$('saveScreenNameInput').value=displayPageTitle(pages.find(page=>page.id===current.id),pages.findIndex(page=>page.id===current.id));openModal('saveConfirmModal');$('saveScreenNameInput').focus();$('saveScreenNameInput').select();};
  $('confirmSaveBtn').onclick=()=>run(async()=>{
    const name=$('saveScreenNameInput').value.trim() || '제목 없음';await flush();const content=capture(),view={viewportTransform:c.viewportTransform.slice(),width:c.width,height:c.height},thumbnail=await makeCurrentViewportThumbnail();
    await store.putScreen({id:uid(),name,savedAt:Date.now(),content,view,thumbnail});sync.notify();closeModal('saveConfirmModal');notify('현재 페이지를 저장 화면으로 보관했습니다.');
  },'저장 화면을 만드는 중입니다.');
  $('saveScreenNameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('confirmSaveBtn').click();}});
  $('loadGeneralBtn').onclick=()=>run(async()=>{await renderSavedScreens();openModal('loadSavedScreenModal');});
  $('copyBtn').onclick=()=>clipboard.copy();$('pasteBtn').onclick=()=>clipboard.paste();
  $('importFileBtn').onclick=()=>{closePopups();$('fileInput').click();};
  $('fileInput').onchange=e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)run(()=>importFiles(files),'파일을 가져오는 중입니다.');};
  $('exportBackupBtn').onclick=()=>run(exportBackup,'백업 파일을 만드는 중입니다.');
  $('importBackupBtn').onclick=()=>{closePopups();$('backupInput').click();};
  $('backupInput').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)run(()=>importBackup(file),'백업을 가져오는 중입니다.');};
  $('importLegacyBtn').onclick=()=>run(importLegacy,'이전 데이터를 읽는 중입니다.');
  $('helpBtn').onclick=()=>openModal('helpModal');
  $('cancelImportBtn').onclick=()=>importAbort?.abort();
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
    if (modalOpen() && !e.target.closest?.('.modal')) return;
    if(e.key==='Escape') {if(modalOpen())return;if(importAbort)importAbort.abort();closeContext();closePopups();if(!busy)finishText();return;}
    if(modalOpen()) {
      if(e.key==='Tab') {
        const m=Array.from(document.querySelectorAll('.modal')).find(m=>m.style.display==='flex');
        const a=Array.from(m.querySelectorAll('button:not(:disabled),input,select,textarea,a[href],summary,[tabindex="0"]')).filter(n=>n.offsetParent!==null),first=a[0],last=a[a.length-1];
        if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
      }return;
    }
    const cmd=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(isTextEditing() || isFormEditing())return;
    if(cmd && key==='z'){e.preventDefault();stepHistory(e.shiftKey?1:-1).catch(fail);return;}
    else if(cmd && key==='y'){e.preventDefault();stepHistory(1).catch(fail);return;}
    if(e.key==='F10'&&e.shiftKey&&c.getActiveObject()){e.preventDefault();const o=c.getActiveObject(),rect=o.getBoundingRect(true,true);openContext(rect.left+16,rect.top+16);return;}
    if(busy)return;
    else if(cmd && key==='g'){e.preventDefault();groupObjects(e.shiftKey);}
    else if(cmd && key==='a'){e.preventDefault();if(allowed()){tools.setMode('select');c.setActiveObject(new fabric.ActiveSelection(c.getObjects().filter(object=>!object.wbAssetMissing && !object.wbPinned),{canvas:c}));c.requestRenderAll();}}
    else if(cmd && key==='s'){e.preventDefault();$('saveBtn').click();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected();}
    else if(e.code==='Space'&&!e.target.closest?.('button')&&!e.repeat&&!tools.gesture){e.preventDefault();spaceMode=tools.mode;tools.setMode('move');}
    else if(key==='home'){e.preventDefault();if(allowed())tools.home(current.content.frame);}
  });
  const releaseSpace=()=>{if(spaceMode){tools.up();tools.setMode(spaceMode);spaceMode=null;}};
  document.addEventListener('keyup',e=>{if(e.code==='Space')releaseSpace();});window.addEventListener('blur',()=>{releaseSpace();tools.up();});
  window.addEventListener('resize',()=>{closePageActions();updateToolbarLayout();resizeBoardViewport();});
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){finishText();flush().catch(fail);}else refreshRemote();});
  window.addEventListener('focus',refreshRemote);
  window.addEventListener('blur',()=>finishText());
}

/* 통합 패널: 기존 Fabric 캔버스의 객체 좌표/줌을 바꾸지 않고 뷰포트만 재계산 */
const PANEL_STORAGE_KEY='whiteboard.test.scorepanel.v1';
const MIN_BOARD_SHARE=20,MAX_BOARD_SHARE=90;
let scoreOpen=false,scoreShare=70,scoreDragging=false;
let receiveScoreView=()=>{};
const boardViewportWidth=()=>Math.max(1,Math.round($('canvas-container').getBoundingClientRect().width||innerWidth));
const boardViewportHeight=()=>Math.max(1,Math.round($('canvas-container').getBoundingClientRect().height||innerHeight));
function resizeBoardViewport(){
  // 점수판은 원래 칠판 위에 나타나는 고정 패널이다.
  // 캔버스 전체 크기와 viewportTransform은 점수판 ON/OFF와 무관하다.
  if(!c)return;
  const width=boardViewportWidth(),height=boardViewportHeight();
  if(c.width===width&&c.height===height)return;
  const vt=c.viewportTransform.slice();
  c.setDimensions({width,height});
  c.setViewportTransform(vt);
  c.calcOffset();c.requestRenderAll();
}
function setupIntegratedScorePanel(){
  if(!$('scorePanelToggle'))return;
  const toggle=$('scorePanelToggle'),splitter=$('scoreSplitter'),panel=$('scorePanel'),frame=$('scoreFrame');
  const clamp=n=>Math.max(MIN_BOARD_SHARE,Math.min(MAX_BOARD_SHARE,n));
  let scoreSide='right';
  try{
    const saved=JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY)||'{}');
    scoreOpen=saved.open===true;
    scoreShare=Number.isFinite(saved.share)?clamp(saved.share):70;
    if(saved.side==='left')scoreSide='left';
  }catch{}
  const save=()=>{try{localStorage.setItem(PANEL_STORAGE_KEY,JSON.stringify({open:scoreOpen,share:scoreShare,side:scoreSide}));}catch{}};
  const update=()=>{
    document.body.dataset.scoreSide=scoreSide;
    frame.dataset.scoreSide=scoreSide;
    document.body.classList.toggle('score-open',scoreOpen);
    document.body.classList.toggle('score-full',scoreFull && scoreOpen);
    frame.dataset.scoreFull=String(scoreFull && scoreOpen);
    frame.dispatchEvent(new CustomEvent('score-full-changed',{detail:scoreFull && scoreOpen}));
    document.documentElement.style.setProperty('--board-share',scoreShare+'%');
    frame.dataset.panelPercent=String(scoreFull?100:100-scoreShare);
    panel.inert=!scoreOpen;panel.setAttribute('aria-hidden',String(!scoreOpen));
    toggle.setAttribute('aria-expanded',String(scoreOpen));
    $('scorePanelLabel').textContent=scoreOpen?'점수판 닫기':'점수판 열기';
    splitter.tabIndex=scoreOpen?0:-1;
    splitter.setAttribute('aria-valuenow',String(Math.round(scoreShare)));
    // 패널 토글/드래그는 캔버스의 좌표계를 변경하지 않는다.
  };
  receiveScoreView=view=>{
    if(!scoreDragging){
      const open=typeof view.scoreOpen==='boolean'?view.scoreOpen:scoreOpen;
      const share=Number.isFinite(view.scoreShare)?clamp(view.scoreShare):scoreShare;
      const full=typeof view.scoreFull==='boolean'?view.scoreFull:scoreFull;
      if(open!==scoreOpen || share!==scoreShare || full!==scoreFull){scoreOpen=open;scoreShare=share;scoreFull=full && open;update();updateToolbarLayout();save();}
    }
    if(Number.isFinite(view.scoreScale))frame.dataset.syncedScoreScale=String(view.scoreScale);
  };
  frame.addEventListener('score-panel-side',event=>{
    const side=event.detail;
    if(scoreDragging || (side!=='left' && side!=='right') || side===scoreSide)return;
    scoreSide=side;
    update();
    save();
  });
  frame.addEventListener('score-display-scale',()=>rememberView(true));
  toggle.addEventListener('click',()=>{scoreOpen=!scoreOpen;if(!scoreOpen)scoreFull=false;update();save();rememberView(true);});
  frame.addEventListener('score-toggle-full',()=>{
    scoreFull=!scoreFull;scoreOpen=true;update();updateToolbarLayout();save();rememberView(true);
  });
  frame.addEventListener('score-management-modal',event=>{
    if(event.detail){closePopups();closeContext();finishText();}
    document.body.classList.toggle('score-modal-open',event.detail);
    for (const element of [$('canvas-container'),$('toolbarScaleWrap'),splitter]) element.inert=event.detail;
    if (!event.detail) {
      if(cloudActive())requestCloudRefresh();else applyLocalView().catch(fail);
    }
  });
  const celebration=$('appCelebration');
  const celebrationPopup=mountGoalCelebration(celebration);
  frame.addEventListener('score-celebration',event=>celebrationPopup.show(event.detail));
  frame.addEventListener('score-celebration-skip',event=>celebrationPopup.setSkip(event.detail));
  frame.addEventListener('score-frame-pointer',()=>{closePopups();closeContext();});
  let dragOffset=0;
  const changeShare=clientX=>{
    const width=document.documentElement.clientWidth||innerWidth;
    const boundary=clientX+dragOffset;
    const boardWidth=scoreSide==='left'?width-boundary:boundary;
    scoreShare=clamp(boardWidth/width*100);update();
  };
  splitter.addEventListener('pointerdown',e=>{
    if(!scoreOpen||e.button!==0)return;
    const rect=splitter.getBoundingClientRect();
    dragOffset=(scoreSide==='left'?rect.left:rect.right)-e.clientX;
    scoreDragging=true;document.body.classList.add('score-resizing');splitter.classList.add('dragging');
    splitter.setPointerCapture(e.pointerId);e.preventDefault();
  });
  splitter.addEventListener('pointermove',e=>{if(scoreDragging)changeShare(e.clientX);});
  const stop=()=>{if(!scoreDragging)return;scoreDragging=false;document.body.classList.remove('score-resizing');splitter.classList.remove('dragging');save();rememberView(true);};
  splitter.addEventListener('pointerup',stop);splitter.addEventListener('pointercancel',stop);splitter.addEventListener('lostpointercapture',stop);
  splitter.addEventListener('keydown',e=>{
    if(!scoreOpen)return;
    const step=e.shiftKey?10:2;
    const rightStep=scoreSide==='left'?-step:step;
    if(e.key==='ArrowLeft')scoreShare=clamp(scoreShare-rightStep);
    else if(e.key==='ArrowRight')scoreShare=clamp(scoreShare+rightStep);
    else if(e.key==='Home')scoreShare=MIN_BOARD_SHARE;
    else if(e.key==='End')scoreShare=MAX_BOARD_SHARE;
    else return;
    e.preventDefault();e.stopPropagation();update();save();rememberView(true);
  });
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(resizeBoardViewport).observe($('canvas-container'));
  }
  update();
}

async function boot() {
  if(!window.fabric)throw Error('캔버스 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 차단 여부를 확인하고 새로고침해주세요.');
  installTextBoxBorder(fabric);
  for(const element of document.querySelectorAll('[data-board-icon]'))setBoardIcon(element,element.dataset.boardIcon);
  c=new fabric.Canvas('whiteboardCanvas',{width:boardViewportWidth(),height:boardViewportHeight(),preserveObjectStacking:true,selection:true,fireMiddleClick:true,stopContextMenu:true,enablePointerEvents:true});
  fabric.Object.prototype.cornerStyle='circle';fabric.Object.prototype.cornerSize=10;fabric.Object.prototype.transparentCorners=false;fabric.Object.prototype.setControlsVisibility({mtr:false});
  tools=new CanvasTools({canvas:c,canEdit:()=>!!current&&canEditBoard()&&!busy&&!modalOpen(),onChange:changed,onViewport:()=>rememberView(true),onText:p=>addText('텍스트',p,true),onMode:mode=>{
    const map={selectMoveToggleBtn:'select',penModeBtn:'pen',markerModeBtn:'marker',freeTextModeBtn:'text',eraserModeBtn:'eraser'};
    for(const [id,m] of Object.entries(map))$(id).classList.toggle('active-select',mode===m);
    $('selectMoveLabel').textContent=mode==='move'?'이동':'선택';setBoardIcon($('selectMoveToggleBtn'),mode==='move'?'hand':'select');$('selectMoveToggleBtn').classList.toggle('active-move',mode==='move');
    updateHistory();if(boardFiles)updateFileInteraction();
  }});
  store=new BoardStore();await store.open();
  boardFiles=new BoardFiles(store);boardFiles.installFabric();
  await store.ensurePage(emptyContent(c.width,c.height));pages=await store.listPages();pages.slice(0,MAX_PAGES).forEach((p,i)=>p.name=`페이지 ${i+1}`);
  const tabIdentity=await acquireTabIdentity(SESSION_KEY+':identity');
  sync=new TabSync(tabIdentity,refreshRemote,view=>{
    if(!validViewState(view))return;
    localView=view;
    if(!cloudActive()){
      $('viewSync').checked=activeView(view,sync.id);
      tabViews?.render();
      applyLocalView().catch(fail);
    }
  });
  await setPage(pages.find(p=>p.id===session.activeId)||pages[0],true);
  clipboard=new SystemClipboard({canvas:c,allowed,run,onChange:changed,onFiles:files=>importFiles(files),onText:text=>addText(text),notify,isTextEditing});
  c.on('selection:created',updateHistory);c.on('selection:updated',updateHistory);c.on('selection:cleared',updateHistory);
  c.on('text:editing:exited',()=>{if(cancelledText)return;if(groupSession)closeGroupSession();else changed();flush().then(()=>{if(cloudActive())requestCloudRefresh();else return applyLocalView();}).catch(fail);});

  wireUI();setupIntegratedScorePanel();
  let scoreSync;
  const useLocal = async()=>{
    await scoreSync.restoreLocal().catch(fail);
    clearTimeout(viewTimer);seenView=null;cloudHistory=null;
    pages=await store.listPages();
    await setPage(pages.find(page=>page.id===session.activeId)||pages[0],true);
    restoreLocalView();
  };
  reloadLocalAfterDisconnect = useLocal;
  cloud=new CloudBoard(store,{
    board:()=>{requestCloudRefresh();scoreSync?.refresh();tabViews?.refresh();},
    view:()=>{requestCloudRefresh();tabViews?.render();},error:fail,
    status:()=>{cloudUI?.status();scoreSync?.refresh();tabViews?.refresh();},approved:()=>cloudUI?.approved(),waiting:code=>cloudUI?.waiting(code)
  });
  scoreSync=wireScoreSync($('scoreFrame'),cloud,store,notify);
  cloudUI=wireCloudUI({cloud,files:boardFiles,openModal,notify,flush,scoreSync,
    finishEdits:async()=>{
      c.getActiveObject()?.exitEditing?.();
      closeGroupSession();
      await flush();
    },
    pages:()=>pages,current:()=>current,
    prepareSeed:async()=>{
      const list=await store.listPages();
      for(const page of list)normalizedObjects(page.content.canvas.objects);
      return Promise.all(list.map(prepareCloudPage));
    },
    useLocal:async()=>{sync.notify();await useLocal();},
    renderFiles:()=>{updateFileInteraction();c.requestRenderAll();},
    goTo:id=>{closeModal('fileManagerModal');return run(()=>activatePage(id));}
  });
  busy=false;syncSharedUI();updateHistory();updateFeedbackPosition();
  tabViews=wireViewTabs({sync,cloud,currentView,pages:()=>pages,togglePopup,closePopups,publish:publishView,readState:viewState,fail});
  restoreLocalView();
  const reconnect=cloud.resume();
  reconnect.catch(fail).finally(()=>scoreSync.ready().catch(fail));
  if (navigator.onLine === false) cloud.setOffline();
  window.addEventListener('offline',()=>cloud.setOffline());
}
boot().catch(error=>{console.error(error);const hint=location.protocol==='file:'?' 파일을 직접 열지 말고 HTTPS 배포 주소 또는 localhost에서 실행해주세요.':'';const fatal=$('fatalError');if(fatal){fatal.textContent=`앱을 시작하지 못했습니다. ${error.message}${hint}`;fatal.hidden=false;}status('시작 실패','error');});
