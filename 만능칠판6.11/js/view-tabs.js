import {uid} from './constants.js';
export function screenTransferFor(view,id,lastEpoch) {
  return view?.kind==='screen-transfer' && view.sourceTab!==id &&
    view.epoch!==lastEpoch && view.targets.includes(id);
}
export function screenTransferTargets(selected, rows, sourceTab) {
  return rows.filter(row=>row.id!==sourceTab && selected.has(row.id)).map(row=>row.id);
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
  let sending=false, nameEditor;
  function savedName(id) {try{return localStorage.getItem(namePrefix+id)||''}catch{return ''}}
  function displayName(row, defaultName) {
    return (cloud.options?cloud.projected().tabNames?.[row.id]:null)||savedName(row.id)||row.tabName||defaultName;
  }
  async function renameTab(row,name){
    name=name.replace(/[\r\n]+/g,' ').trim().slice(0,40);
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
  function position(){if(root.style.display!=='block')return;const edge=toolbar.getBoundingClientRect().top-8,r=opener.getBoundingClientRect();root.style.top='auto';root.style.bottom=(innerHeight-edge)+'px';root.style.setProperty('--view-menu-height',Math.max(0,edge-30)+'px');root.style.left=Math.max(8,Math.min(innerWidth-root.offsetWidth-8,r.left+(r.width-root.offsetWidth)/2))+'px';}
  function render(){
    if(root.style.display!=='block')return;
    if(nameEditor && document.activeElement===nameEditor){position();return;}
    const focus=document.activeElement?.dataset.viewTab;
    const rows=available();
    const names=defaultTabNames(rows);
    selected=new Set(screenTransferTargets(selected,rows,sync.id));
    const groups=new Map();
    for(const row of rows){
      const name=displayName(row,names.get(row.id));
      const line=document.createElement('div');
      line.className='view-tab-row';
      const input=document.createElement('input');
      input.type='checkbox';input.checked=selected.has(row.id);input.dataset.viewTab=row.id;
      input.disabled=row.id===sync.id;
      input.onchange=()=>{if(input.checked)selected.add(row.id);else selected.delete(row.id);sendButton.disabled=sending||!selected.size;};
      const owner=row.owner||'local';
      const deviceName=row.label||'이 기기';
      if(!groups.has(owner)){
        const group=document.createElement('section');
        group.className='view-device-group';
        const heading=document.createElement('h3');
        heading.textContent=deviceName;
        group.append(heading);
        groups.set(owner,group);
      }
      input.setAttribute('aria-label',deviceName+' · '+name);
      const details=document.createElement('div');
      details.className='view-tab-details';
      const nameText=document.createElement('span');
      nameText.className='view-tab-name';
      nameText.textContent=name;
      nameText.title=name;
      details.append(nameText);
      const currentTab=document.createElement('span');
      currentTab.className='view-tab-current';
      if(row.id===sync.id)currentTab.textContent='(이 탭)';

      const edit=document.createElement('button');
      edit.type='button';edit.className='view-tab-rename';edit.textContent='✎';
      edit.title='탭 이름 변경';edit.setAttribute('aria-label',name+' 이름 변경');
      edit.onclick=()=>{
        if(details.querySelector('.view-tab-name-input'))return;
        const editor=document.createElement('div');
        editor.className='view-tab-editor';
        const ruler=document.createElement('span');
        ruler.setAttribute('aria-hidden','true');
        const field=document.createElement('textarea');
        field.rows=1;field.maxLength=40;field.value=name;
        field.setAttribute('aria-label','탭 이름 변경');field.className='view-tab-name-input';
        field.enterKeyHint='done';
        const resize=()=>{ruler.textContent=field.value+' ';};
        field.oninput=resize;
        resize();
        editor.append(ruler,field);
        nameEditor=field;
        nameText.replaceWith(editor);
        field.focus();
        field.select();
        field.onkeydown=event=>{
          if(event.isComposing || event.keyCode===229)return;
          if(event.key==='Enter'){event.preventDefault();field.blur();}
          else if(event.key==='Escape'){
            event.preventDefault();
            event.stopPropagation();
            field.onblur=null;
            nameEditor=undefined;
            editor.replaceWith(nameText);
            edit.focus();
          }
        };
        field.onblur=()=>{
          if(nameEditor===field)nameEditor=undefined;
          editor.replaceWith(nameText);
          if(field.value.trim()!==name)renameTab(row,field.value).catch(fail);
        };
      };
      if(row.id===sync.id){
        const placeholder=document.createElement('span');
        placeholder.className='view-tab-selection-space';
        line.append(placeholder);
      } else line.append(input);
      line.append(details,currentTab,edit);
      groups.get(owner).append(line);
    }
    list.replaceChildren(...groups.values());
    if(focus)Array.from(list.querySelectorAll('[data-view-tab]')).find(input=>input.dataset.viewTab===focus)?.focus({preventScroll:true});
    sendButton.disabled=sending||!selected.size;position();
  }
  function announce(){if(!present)return;const next=cloud.options?.boardId||null;if(scope!==next){unsubscribe?.();unsubscribe=null;members=[];selected.clear();scope=next;}
    if(!scope){try{localStorage.setItem(localKey,JSON.stringify(presence()));channel?.postMessage('presence');}catch{}}
    else if(cloud.online&&cloud.fs){cloud.fs.setDoc(cloud.ref('viewTabs',sync.id),{...presence(),owner:cloud.deviceId}).catch(fail);if(!unsubscribe)unsubscribe=cloud.fs.onSnapshot(cloud.collection('viewTabs'),snap=>{members=snap.docs.map(d=>d.data());render();},fail);}
    render();}
  function show(){togglePopup('viewSyncMenu',opener);announce();}
  opener.onclick=e=>{e.preventDefault();show();};opener.oncontextmenu=e=>{e.preventDefault();show();};
  root.querySelector('[data-view-all]').onclick=()=>{
    selected=new Set(available().filter(row=>row.id!==sync.id).map(row=>row.id));
    render();
  };
  root.querySelector('[data-view-none]').onclick=()=>{
    selected.clear();
    render();
  };
  sendButton.onclick=async()=>{
    if(sending)return;
    const targets=screenTransferTargets(selected,available(),sync.id);
    if(!targets.length){render();return;}
    sending=true;
    sendButton.disabled=true;
    try {
      const state={...currentView(),epoch:uid(),sourceTab:sync.id,kind:'screen-transfer',targets,sentAt:Date.now()};
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
