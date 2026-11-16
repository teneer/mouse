import {applyOperation,boardPages,newBoard} from './js/cloud-model.js?v=conflict-fields-1';
import {reorderPages} from './js/board-navigation.js';
import {uid, clone} from './js/constants.js';
import {resolvePageWrite} from './js/conflicts.js';
const SCOPE = new URL('.', location.href).pathname;
const DB_NAME = `WhiteboardPagesDB:${SCOPE}`;
export const SIGNAL_KEY = `whiteboard-pages-signal:${SCOPE}`;
const VIEW_SIGNAL_KEY = SIGNAL_KEY + ':view';
export const CHANNEL_NAME = `whiteboard-pages:${SCOPE}`;
export const SESSION_KEY = `whiteboard-pages-session:${SCOPE}`;
export class BoardStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = event => {
        r.result.createObjectStore('assets', {keyPath:'id'});
        r.result.createObjectStore('cloudOperations', {keyPath:'id'}).createIndex('boardId', 'boardId');
        if (event.oldVersion) return;
        r.result.createObjectStore('pages', {keyPath: 'id'});
        r.result.createObjectStore('screens', {keyPath: 'id'});
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error('DB가 잠겼습니다. 이전 버전의 탭을 닫고 다시 열어주세요.'));
    });
    this.db.onversionchange = () => this.db.close();
  }
  request(store, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      let value;
      const req = operation(tx.objectStore(store));
      req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(tx.error || req.error || Error('저장에 실패했습니다.'));
    });
  }
  async listPages() { return (await this.request('pages', 'readonly', s => s.getAll())).filter(p => !p.deleted).sort((a,b) => a.order - b.order || a.id.localeCompare(b.id)); }
  getPage(id) { return this.request('pages','readonly',s => s.get(id)); }
  async ensurePage(content) {
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction('pages','readwrite'), s = tx.objectStore('pages');
      const r = s.getAll(); let page;
      r.onsuccess = () => {
        page = r.result.find(p => !p.deleted);
        if (!page) { const now = Date.now(); page = {id:uid(), name:'페이지 1',content:clone(content),version:1,order:now,createdAt:now,updatedAt:now}; s.put(page); }
      };
      tx.oncomplete = () => resolve(page);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  commitPage(local, baseVersion) {
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction('pages','readwrite'), s = tx.objectStore('pages');
      const r = s.get(local.id); let result;
      r.onsuccess = () => { result = resolvePageWrite(r.result, {...clone(local),order:r.result?.order ?? local.order,title:r.result?r.result.title:local.title}, baseVersion, uid(), Date.now()); if (!result.unchanged) s.put(result.page); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('자동저장에 실패했습니다.'));
    });
  }
  deletePage(id, version) {
    return new Promise((resolve,reject) => {
      const tx=this.db.transaction('pages','readwrite'), s=tx.objectStore('pages');
      let failure; const r=s.get(id);
      r.onsuccess=()=>{
        const p=r.result;
        if (!p || p.deleted || p.version!==version) { failure=Error('다른 탭에서 변경된 페이지입니다. 새로 확인한 뒤 삭제해주세요.'); tx.abort(); return; }
        s.put({...p,deleted:true,content:null,version:p.version+1,updatedAt:Date.now()});
      };
      tx.oncomplete=()=>resolve(); tx.onabort=tx.onerror=()=>reject(failure || tx.error);
    });
  }
  renamePage(id,title) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('pages','readwrite'), pages=tx.objectStore('pages');
      const request=pages.get(id);
      request.onsuccess=()=>{
        const page=request.result;
        if(page && !page.deleted)pages.put({...page,title});
      };
      tx.oncomplete=()=>resolve(!!request.result && !request.result.deleted);
      tx.onabort=tx.onerror=()=>reject(tx.error);
    });
  }
  reorderPages(ids) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('pages','readwrite'), pages=tx.objectStore('pages');
      const request=pages.getAll();
      request.onsuccess=()=>{
        const active=request.result.filter(page=>!page.deleted).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
        reorderPages(active,ids).forEach((page,index)=>{if(page.order!==index)pages.put({...page,order:index});});
      };
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(tx.error);
    });
  }
  getAsset(id) {return this.request('assets','readonly',s=>s.get(id));}
  putAsset(asset) {return this.request('assets','readwrite',s=>s.put(asset));}
  deleteAsset(id) {return this.request('assets','readwrite',s=>s.delete(id));}
  putCloudOperation(operation, initialConnection) {
    return new Promise((resolve,reject)=>{
      const tx = this.db.transaction(['meta','cloudOperations'],'readwrite');
      const meta = tx.objectStore('meta'), operations = tx.objectStore('cloudOperations');
      const connection = meta.get('cloudConnection');
      connection.onsuccess=()=>{
        if (initialConnection && !connection.result) meta.put(initialConnection,'cloudConnection');
        else if (connection.result?.boardId !== operation.boardId) {tx.abort();return;}
        const rows = operations.index('boardId').getAll(operation.boardId);
        rows.onsuccess=()=>{
          for (const row of rows.result) operation.time = Math.max(operation.time,row.time+1);
          operations.put(operation);
        };
      };
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(tx.error || Error('기기 연결 상태가 바뀌어 작업을 저장하지 못했습니다.'));
    });
  }
  async listCloudOperations(boardId) {
    const rows = await this.request('cloudOperations','readonly',s=>s.index('boardId').getAll(boardId));
    return rows.sort((a,b)=>a.time-b.time);
  }
  cacheCloudState(boardId,state,confirmed) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['meta','cloudOperations'],'readwrite');
      const meta = tx.objectStore('meta');
      const cached = meta.get('cloud-state:'+boardId);
      cached.onsuccess=()=>{
        if ((cached.result?.revision ?? 0) <= state.revision) meta.put(state,'cloud-state:'+boardId);
      };
      for(const id of confirmed)tx.objectStore('cloudOperations').delete(id);
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(tx.error);
    });
  }
  saveLocalHandoff(boardId, previous) {
    return new Promise((resolve,reject)=>{
      const tx = this.db.transaction(['pages','meta','cloudOperations'],'readwrite');
      const meta = tx.objectStore('meta'), connection = meta.get('cloudConnection');
      connection.onsuccess=()=>{
        if (connection.result?.boardId !== boardId) {tx.abort();return;}
        const cached = meta.get('cloud-state:'+boardId);
        const operations = tx.objectStore('cloudOperations');
        const pending = operations.index('boardId').getAll(boardId);
        pending.onsuccess=()=>{
          const projected = cached.result || newBoard();
          let revision = projected.revision;
          for (const operation of pending.result.sort((a,b)=>a.time-b.time)) {
            applyOperation(projected,operation,++revision);
            operations.delete(operation.id);
          }
          const pages = boardPages(projected);
          if (!pages.length) {tx.abort();return;}
          const local = tx.objectStore('pages');
          local.clear();
          pages.forEach(page=>local.put(page));
          if (projected.score) meta.put(projected.score.state,'localScoreHandoff');
          meta.put(null,'cloudConnection');
          meta.put(null,'cloudRequest');
          meta.put(previous,'cloudPrevious');
        };
      };
      tx.oncomplete=resolve;
      tx.onabort=tx.onerror=()=>reject(tx.error || Error('현재 칠판을 로컬에 저장하지 못했습니다.'));
    });
  }
  listScreens() { return this.request('screens','readonly',s=>s.getAll()).then(a=>a.sort((x,y)=>y.savedAt-x.savedAt)); }
  putScreen(screen) { return this.request('screens','readwrite',s=>s.put(screen)); }
  deleteScreen(id) { return this.request('screens','readwrite',s=>s.delete(id)); }
  getMeta(key) { return this.request('meta','readonly',s=>s.get(key)); }
  setMeta(key,value) { return this.request('meta','readwrite',s=>s.put(value,key)); }
  async appendBackup(pages, screens, assets = []) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['pages','screens','assets'],'readwrite');
      pages.forEach(p=>tx.objectStore('pages').put(p));
      screens.forEach(s=>tx.objectStore('screens').put(s));
      assets.forEach(asset=>tx.objectStore('assets').put(asset));
      tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);
    });
  }
}
// Read the existing v3 DB without upgrading, deleting, or modifying any legacy record.
export async function readLegacy() {
  const db = await new Promise((resolve,reject)=>{
    const r=indexedDB.open('WhiteboardAppDB'); let absent=false;
    r.onupgradeneeded=()=>{ absent=true; r.transaction.abort(); };
    r.onerror=()=>absent ? resolve(null) : reject(r.error);
    r.onsuccess=()=>resolve(r.result);
    r.onblocked=()=>reject(Error('구버전 탭을 닫은 뒤 다시 시도해주세요.'));
  });
  if (!db) return {auto:null,screens:[]};
  try {
    const get = (name,all,key)=>new Promise((resolve,reject)=>{
      if (!db.objectStoreNames.contains(name)) {resolve(all?[]:null);return;}
      const tx=db.transaction(name,'readonly'),s=tx.objectStore(name),r=all?s.getAll():s.get(key);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    return {auto:await get('canvasState',false,'latestCanvas'),screens:await get('savedScreens',true)};
  } finally {db.close();}
}
export class TabSync {
  constructor({id,opened},onChange,onView) {
    this.id=id;
    this.opened=opened;
    let lastView;
    const receive=message=>{
      if(!message || message.sender===this.id)return;
      if(message.view){
        if(lastView!==message.nonce){lastView=message.nonce;onView?.(message.view);}
      }else onChange();
    };
    try { this.channel=new BroadcastChannel(CHANNEL_NAME); this.channel.onmessage=e=>receive(e.data); } catch {}
    this.storageHandler=e=>{
      if(e.key===SIGNAL_KEY || e.key===VIEW_SIGNAL_KEY){try{receive(JSON.parse(e.newValue));}catch{}}
    };
    window.addEventListener('storage',this.storageHandler);
    this.timer=setInterval(()=>{if(document.visibilityState==='visible') onChange();},5000);
    this.readView=()=>{try{return JSON.parse(localStorage.getItem(VIEW_SIGNAL_KEY))?.view;}catch{return null;}};
  }
  broadcast(view) {
    const message={sender:this.id,nonce:uid(),view};
    this.channel?.postMessage(message);
    try {localStorage.setItem(view?VIEW_SIGNAL_KEY:SIGNAL_KEY,JSON.stringify(message));} catch {}
  }
  notify() {this.broadcast();}
  sendView(view) {this.broadcast(view);}
  close() {clearInterval(this.timer);this.channel?.close();window.removeEventListener('storage',this.storageHandler);}
}
