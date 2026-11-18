import {uid} from './constants.js';
export const activeView=(view,id)=>!!view?.enabled&&Array.isArray(view.targets)&&view.targets.includes(id);
export function screenTransferTargets(selected, rows) {
  return rows.filter(row=>selected.has(row.id)).map(row=>row.id);
}

const compareTabOrder=(a,b)=>a.opened-b.opened || a.id.localeCompare(b.id);

export function defaultTabNames(rows) {
  const counts=new Map();
  const names=new Map();
  for (const row of [...rows].sort(compareTabOrder)) {
    const owner=row.owner||'local';
    const number=(counts.get(owner)||0)+1;
    counts.set(owner,number);
    names.set(row.id,'탭'+number);
  }
  return names;
}

const heartbeat=15000;
export function wireViewTabs({sync,cloud,currentView,pages,togglePopup,closePopups,fail}){
  const root=document.getElementById('viewSyncMenu'),list=root.querySelector('[data-view-tabs]');
  const toolbar=document.getElementById('toolbar'),opener=document.getElementById('viewSyncTrigger');
  const sendButton=document.getElementById('sendViewNow');
  const prefix='whiteboard.view-tab:'+new URL('.',location.href).pathname+':';
  const localKey=prefix+sync.id,namePrefix='whiteboard.tab-name:'+new URL('.',location.href).pathname+':';
  const instance=uid();let members=[],scope=null,unsubscribe=null,present=true,selected=new Set(),channel;
  let sending=false;
  function savedName(id) {try{return localStorage.getItem(namePrefix+id)||''}catch{return ''}}
  function displayName(row, defaultName) {
    return (cloud.options?cloud.projected().tabNames?.[row.id]:null)||savedName(row.id)||row.tabName||defaultName;
  }
  async function renameTab(row,name){
    name=name.trim().slice(0,40);
    if(!name)return;
    if(cloud.options)await cloud.enqueue({kind:'tab-rename',tabId:row.id,name});
    else {localStorage.setItem(namePrefix+row.id,name);channel?.postMessage('renamed');}
    render();
  }
  try{channel=new BroadcastChannel(prefix);}catch{}
  function presence(){const v=currentView();return{id:sync.id,owner:cloud.deviceId||'local',label:cloud.options?.label||'이 기기',tabName:savedName(sync.id),instance,opened:sync.opened,time:Date.now(),page:Math.max(1,pages().findIndex(p=>p.id===v.pageId)+1)};}
  function available(){
    const rows=scope?members.filter(row=>Date.now()-row.time<heartbeat*5):(()=>{const a=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith(prefix)){const v=JSON.parse(localStorage.getItem(k));if(v?.id&&Date.now()-v.time<heartbeat*5)a.push(v);}}}catch{}return a;})();
    if(!rows.some(r=>r.id===sync.id))rows.push(presence());return rows.sort(compareTabOrder);
  }
  function position(){if(root.style.display!=='block')return;const edge=toolbar.getBoundingClientRect().top-8,r=opener.getBoundingClientRect();root.style.top='auto';root.style.bottom=(innerHeight-edge)+'px';root.style.maxHeight=Math.max(0,edge-8)+'px';root.style.left=Math.max(8,Math.min(innerWidth-root.offsetWidth-8,r.left+(r.width-root.offsetWidth)/2))+'px';}
  function render(){
    if(root.style.display!=='block')return;
    const focus=document.activeElement?.dataset.viewTab;
    const rows=available();
    const names=defaultTabNames(rows);
    selected=new Set(screenTransferTargets(selected,rows));
    list.replaceChildren(...rows.map(row=>{
      const name=displayName(row,names.get(row.id));
      const line=document.createElement('div');
      line.className='view-tab-row';
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.checked=selected.has(row.id);input.dataset.viewTab=row.id;
      input.onchange=()=>{if(input.checked)selected.add(row.id);else selected.delete(row.id);sendButton.disabled=sending||!selected.size;};
      label.append(input,document.createTextNode((row.label||'이 기기')+' · '+name+(row.id===sync.id?' (이 탭)':'')));
      const edit=document.createElement('button');
      edit.type='button';edit.className='view-tab-rename';edit.textContent='✎';
      edit.title='탭 이름 변경';edit.setAttribute('aria-label',name+' 이름 변경');
      edit.onclick=()=>{
        const field=document.createElement('input');
        field.type='text';field.maxLength=40;field.value=name;
        field.setAttribute('aria-label','새 탭 이름');field.className='view-tab-name-input';
        line.replaceChild(field,edit);field.focus();field.select();
        let cancelled=false;
        field.onkeydown=event=>{
          if(event.key==='Enter')field.blur();
          else if(event.key==='Escape'){cancelled=true;render();}
        };
        field.onblur=()=>{if(cancelled)return;renameTab(row,field.value).catch(fail);};
      };
      line.append(label,edit);
      if(focus===row.id)input.focus({preventScroll:true});
      return line;
    }));
    sendButton.disabled=sending||!selected.size;position();
  }
  function announce(){if(!present)return;const next=cloud.options?.boardId||null;if(scope!==next){unsubscribe?.();unsubscribe=null;members=[];selected.clear();scope=next;}
    if(!scope){try{localStorage.setItem(localKey,JSON.stringify(presence()));channel?.postMessage('presence');}catch{}}
    else if(cloud.online&&cloud.fs){cloud.fs.setDoc(cloud.ref('viewTabs',sync.id),{...presence(),owner:cloud.deviceId}).catch(fail);if(!unsubscribe)unsubscribe=cloud.fs.onSnapshot(cloud.collection('viewTabs'),snap=>{members=snap.docs.map(d=>d.data());render();},fail);}
    render();}
  function show(){togglePopup('viewSyncMenu',opener);announce();}
  opener.onclick=e=>{e.preventDefault();show();};opener.oncontextmenu=e=>{e.preventDefault();show();};
  root.querySelector('[data-view-all]').onclick=()=>{
    selected=new Set(available().map(row=>row.id));
    render();
  };
  root.querySelector('[data-view-none]').onclick=()=>{
    selected.clear();
    render();
  };
  sendButton.onclick=async()=>{
    if(sending)return;
    const targets=screenTransferTargets(selected,available());
    if(!targets.length){render();return;}
    sending=true;
    sendButton.disabled=true;
    try {
      const state={...currentView(),epoch:uid(),sourceTab:sync.id,enabled:true,targets,sentAt:Date.now()};
      if(cloud.options)await cloud.sendView(state);
      else sync.sendView(state);
      root.style.display='none';
      opener.setAttribute('aria-expanded','false');
      const toast=document.getElementById('toast');
      toast.textContent=targets.length+'개 탭에 현재 상태를 전송했습니다.';
      toast.hidden=false;
    } catch(error) {
      fail(error);
    } finally {
      sending=false;
      render();
    }
  };
  if(channel)channel.onmessage=()=>render();window.addEventListener('storage',e=>{if(e.key?.startsWith(prefix))render();});window.addEventListener('resize',position);
  window.addEventListener('pagehide',()=>{present=false;unsubscribe?.();unsubscribe=null;try{if(JSON.parse(localStorage.getItem(localKey))?.instance===instance)localStorage.removeItem(localKey);channel?.postMessage('closed');}catch{}closePopups();});
  window.addEventListener('pageshow',()=>{present=true;announce();});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')announce();});setInterval(announce,heartbeat);announce();return{render,refresh:announce};
}
