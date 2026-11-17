import {uid} from './constants.js';
export const activeView=(view,id)=>!!view?.enabled&&Array.isArray(view.targets)&&view.targets.includes(id);
const heartbeat=15000;
export function wireViewTabs({sync,cloud,currentView,pages,togglePopup,closePopups,fail}){
  const root=document.getElementById('viewSyncMenu'),list=root.querySelector('[data-view-tabs]');
  const toolbar=document.getElementById('toolbar'),opener=document.getElementById('viewSyncTrigger');
  const sendButton=document.getElementById('sendViewNow');
  const prefix='whiteboard.view-tab:'+new URL('.',location.href).pathname+':';
  const localKey=prefix+sync.id,instance=uid();let members=[],scope=null,unsubscribe=null,present=true,selected=new Set(),channel;
  try{channel=new BroadcastChannel(prefix);}catch{}
  function presence(){const v=currentView();return{id:sync.id,owner:cloud.deviceId||'local',label:cloud.options?.label||'이 브라우저',instance,opened:sync.opened,time:Date.now(),page:Math.max(1,pages().findIndex(p=>p.id===v.pageId)+1)};}
  function available(){
    const rows=scope?members:(()=>{const a=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(prefix)){const v=JSON.parse(localStorage.getItem(k));if(v?.id&&Date.now()-v.time<heartbeat*5)a.push(v);}}}catch{}return a;})();
    if(!rows.some(r=>r.id===sync.id))rows.push(presence());return rows.sort((a,b)=>a.opened-b.opened||a.id.localeCompare(b.id));
  }
  function position(){if(root.style.display!=='block')return;const edge=toolbar.getBoundingClientRect().top-8,r=opener.getBoundingClientRect();root.style.top='auto';root.style.bottom=(innerHeight-edge)+'px';root.style.maxHeight=Math.max(0,edge-8)+'px';root.style.left=Math.max(8,Math.min(innerWidth-root.offsetWidth-8,r.left+(r.width-root.offsetWidth)/2))+'px';}
  function render(){if(root.style.display!=='block')return;const focus=document.activeElement?.dataset.viewTab;list.replaceChildren(...available().map(row=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(row.id);input.dataset.viewTab=row.id;input.onchange=()=>{if(input.checked)selected.add(row.id);else selected.delete(row.id);sendButton.disabled=!selected.size;};label.append(input,document.createTextNode((row.label||'기기')+' · '+row.page+'쪽'+(row.id===sync.id?' (이 탭)':'')));if(focus===row.id)input.focus({preventScroll:true});return label;}));sendButton.disabled=!selected.size;position();}
  function announce(){if(!present)return;const next=cloud.options?.boardId||null;if(scope!==next){unsubscribe?.();unsubscribe=null;members=[];scope=next;}
    if(!scope){try{localStorage.setItem(localKey,JSON.stringify(presence()));channel?.postMessage('presence');}catch{}}
    else if(cloud.online&&cloud.fs){cloud.fs.setDoc(cloud.ref('viewTabs',sync.id),{...presence(),owner:cloud.deviceId}).catch(fail);if(!unsubscribe)unsubscribe=cloud.fs.onSnapshot(cloud.collection('viewTabs'),snap=>{members=snap.docs.map(d=>d.data());render();},fail);}
    render();}
  function show(){selected.clear();sendButton.disabled=true;togglePopup('viewSyncMenu',opener);announce();render();}
  opener.onclick=e=>{e.preventDefault();show();};opener.oncontextmenu=e=>{e.preventDefault();show();};
  sendButton.onclick=async()=>{const targets=[...selected];if(!targets.length)return;sendButton.disabled=true;try{const state={...currentView(),epoch:uid(),sourceTab:sync.id,enabled:true,targets,sentAt:Date.now()};if(cloud.options)await cloud.sendView(state);else sync.sendView(state);root.style.display='none';opener.setAttribute('aria-expanded','false');const toast=document.getElementById('toast');toast.textContent=targets.length+'개 탭에 현재 상태를 전송했습니다.';toast.hidden=false;}catch(e){fail(e);}finally{selected.clear();render();}};
  if(channel)channel.onmessage=()=>render();window.addEventListener('storage',e=>{if(e.key?.startsWith(prefix))render();});window.addEventListener('resize',position);
  window.addEventListener('pagehide',()=>{present=false;unsubscribe?.();unsubscribe=null;try{if(JSON.parse(localStorage.getItem(localKey))?.instance===instance)localStorage.removeItem(localKey);channel?.postMessage('closed');}catch{}closePopups();});
  window.addEventListener('pageshow',()=>{present=true;announce();});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')announce();});setInterval(announce,heartbeat);announce();return{render,refresh:announce};
}
