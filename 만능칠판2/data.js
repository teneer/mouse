import {uid, clone} from './js/constants.js';
import {resolvePageWrite} from './js/conflicts.js';
const SCOPE = new URL('.', location.href).pathname;
const DB_NAME = `WhiteboardPagesDB:${SCOPE}`;
export const SIGNAL_KEY = `whiteboard-pages-signal:${SCOPE}`;
export const CHANNEL_NAME = `whiteboard-pages:${SCOPE}`;
export const SESSION_KEY = `whiteboard-pages-session:${SCOPE}`;
export class BoardStore {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
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
      r.onsuccess = () => { result = resolvePageWrite(r.result, clone(local), baseVersion, uid(), Date.now()); if (!result.unchanged) s.put(result.page); };
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
  listScreens() { return this.request('screens','readonly',s=>s.getAll()).then(a=>a.sort((x,y)=>y.savedAt-x.savedAt)); }
  putScreen(screen) { return this.request('screens','readwrite',s=>s.put(screen)); }
  deleteScreen(id) { return this.request('screens','readwrite',s=>s.delete(id)); }
  getMeta(key) { return this.request('meta','readonly',s=>s.get(key)); }
  setMeta(key,value) { return this.request('meta','readwrite',s=>s.put(value,key)); }
  async appendBackup(pages, screens) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['pages','screens'],'readwrite');
      pages.forEach(p=>tx.objectStore('pages').put(p));
      screens.forEach(s=>tx.objectStore('screens').put(s));
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
  constructor(onChange) {
    this.onChange=onChange; this.id=uid();
    try { this.channel=new BroadcastChannel(CHANNEL_NAME); this.channel.onmessage=e=>{if(e.data?.sender!==this.id) onChange();}; } catch {}
    this.storageHandler=e=>{if(e.key===SIGNAL_KEY) onChange();};
    window.addEventListener('storage',this.storageHandler);
    this.timer=setInterval(()=>{if(document.visibilityState==='visible') onChange();},5000);
  }
  notify() {
    this.channel?.postMessage({sender:this.id,time:Date.now()});
    try {localStorage.setItem(SIGNAL_KEY,JSON.stringify({sender:this.id,nonce:uid()}));} catch {}
  }
  close() {clearInterval(this.timer);this.channel?.close();window.removeEventListener('storage',this.storageHandler);}
}
