import {uid} from './constants.js';
import {normalizeTabName} from './tab-identity.js?v=toolbar-goals-1';

export const activeView = (view,id) => !!view?.enabled && Array.isArray(view.targets) && view.targets.includes(id);
export function viewTargets(previous,available) {
  if (!Array.isArray(previous)) return [...available];
  if (!previous.length) return [];
  const open=new Set(available);
  const remaining=previous.filter(id=>open.has(id));
  return remaining.length?remaining:[...available];
}
const maxAge=75_000;
const heartbeat=15_000;
export function wireViewTabs({sync,cloud,currentView,pages,togglePopup,closePopups,publish,readState,fail}) {
  const root=document.getElementById('viewSyncMenu'), control=document.getElementById('viewSync');
  const list=root.querySelector('[data-view-tabs]');
  const toolbar=document.getElementById('toolbar'), opener=document.getElementById('viewSyncTrigger');

  function positionMenu() {
    if (root.style.display!=='block') return;
    const margin=8;
    const edge=toolbar.getBoundingClientRect().top-margin;
    const trigger=opener.getBoundingClientRect();
    root.style.top='auto';
    root.style.bottom=(window.innerHeight-edge)+'px';
    root.style.maxHeight=Math.max(0,edge-margin)+'px';
    root.style.left=Math.max(margin,Math.min(window.innerWidth-root.offsetWidth-margin,
      trigger.left+(trigger.width-root.offsetWidth)/2))+'px';
  }
  const path=new URL('.',location.href).pathname;
  const prefix='whiteboard.view-tab:'+path+':';
  const namePrefix='whiteboard.tab-name:'+path+':';
  const localKey=prefix+sync.id;
  let members=[], scope, unsubscribe, generation=0;
  let channel, lastPresence, lastSent=0, expiryTimer, watching=false, present=true;
  let finishNameEdit;
  const departed=new Map();
  try {channel=new BroadcastChannel(prefix);} catch {}
  const watches=new Map();
  let releaseLease;
  const leaseName=value=>prefix+'lease:'+value;
  function claimPresence() {
    if (!navigator.locks) {announce();return;}
    navigator.locks.request(leaseName(instance),()=>new Promise(resolve=>{
      if (!present) {resolve();return;}
      releaseLease=resolve;
      announce();
    })).catch(()=>announce());
  }
  function forget(id,value,board) {
    if (board!==scope || !value || departed.get(id)===value) return;
    departed.set(id,value);
    if (board && cloud.online && cloud.fs) {
      const ref=cloud.ref('viewTabs',id);
      cloud.fs.runTransaction(cloud.db,async tx=>{
        const snapshot=await tx.get(ref);
        if (snapshot.data()?.instance===value) tx.delete(ref);
      }).catch(()=>{});
    }
    render();
  }
  function watchLocalPeers() {
    for (const peer of localMembers()) {
      if (!present || !navigator.locks || !peer.lease || peer.id===sync.id ||
          (peer.board??null)!==scope || watches.has(peer.instance) || departed.get(peer.id)===peer.instance) continue;
      const controller=new AbortController();
      watches.set(peer.instance,controller);
      navigator.locks.request(leaseName(peer.instance),{signal:controller.signal},()=>{
        if (!present) return;
        forget(peer.id,peer.instance,peer.board??null);
        try {
          const key=prefix+peer.id;
          if (JSON.parse(localStorage.getItem(key))?.instance===peer.instance) localStorage.removeItem(key);
        } catch {}
      }).catch(()=>{}).finally(()=>watches.delete(peer.instance));
    }
  }
  function localName(id) {
    try {return normalizeTabName(localStorage.getItem(namePrefix+id));} catch {return '';}
  }
  async function rename(row,name) {
    if (cloud.options) await cloud.enqueue({kind:'tab-rename',tabId:row.id,name});
    else {
      localStorage.setItem(namePrefix+row.id,name);
      channel?.postMessage('change');
    }
  }
  function editName(row,display,button,checkbox,description) {
    const name=display.textContent;
    const input=document.createElement('input');
    input.type='text';input.maxLength=40;input.value=name;input.className='view-tab-name-input';
    input.setAttribute('aria-label','탭 이름 변경');
    input.enterKeyHint='done';
    const finish=(cancel=false,focus=false)=>{
      finishNameEdit=null;
      input.onblur=null;
      input.replaceWith(display);
      if (focus) button.focus({preventScroll:true});
      const next=normalizeTabName(input.value);
      if (!cancel && next && next!==name) {
        rename(row,next).then(()=>{
          display.textContent=next;
          display.title=next;
          button.setAttribute('aria-label',next+' 이름 변경');
          checkbox.setAttribute('aria-label',next+' · '+description);
          positionMenu();
        }).catch(fail);
      }
    };
    finishNameEdit=finish;
    input.onblur=()=>finish();
    input.onkeydown=event=>{
      if (event.isComposing || event.keyCode===229) {
        event.stopPropagation();
        return;
      }
      if (event.key==='Enter' || event.key==='Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key==='Escape',true);
      }
    };
    display.replaceWith(input);
    input.focus();input.select();
  }
  function localMembers() {
    const rows=[];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const item=JSON.parse(localStorage.getItem(key));
        if (item?.id && Date.now()-item.time<maxAge) rows.push(item);
      }
    } catch {}
    return rows;
  }
  function available() {
    const rows=(scope?members:localMembers().filter(row=>!row.board)).filter(row=>
      Date.now()-row.time<maxAge && (!departed.has(row.id)||departed.get(row.id)!==row.instance));
    if (!rows.some(row=>row.id===sync.id)) rows.push(presence());
    return rows.sort((a,b)=>a.opened-b.opened||a.id.localeCompare(b.id));
  }
  let instance=uid();
  const registeredLabel=id=>cloud.devices?.find(device=>device.id===id)?.label;
  function presence() {
    const view=currentView();
    return {id:sync.id,owner:cloud.deviceId||'local',label:registeredLabel(cloud.deviceId)||cloud.options?.label||'이 브라우저',
      tabName:localName(sync.id),instance,opened:sync.opened,time:Date.now(),
      page:Math.max(1,pages().findIndex(page=>page.id===view.pageId)+1),full:view.scoreFull===true};
  }
  function render() {
    control.setAttribute('aria-pressed',String(!!readState()?.enabled));
    clearTimeout(expiryTimer);
    if (root.style.display!=='block') return;
    const rows=available(), targets=viewTargets(readState()?.targets,rows.map(row=>row.id));
    const expires=rows.filter(row=>row.id!==sync.id).map(row=>row.time+maxAge);
    if (expires.length) expiryTimer=setTimeout(render,Math.max(0,Math.min(...expires)-Date.now())+5);
    if (finishNameEdit) {
      const editing=list.querySelector('.view-tab-name-input')?.closest('.view-tab-row');
      if (editing && !rows.some(row=>row.id===editing.querySelector('[data-view-tab]').dataset.viewTab)) finishNameEdit(true);
      else if (list.querySelectorAll('[data-view-tab]').length===rows.length &&
        rows.every(row=>document.getElementById('view-tab-target-'+row.id))) {positionMenu();return;}
      else finishNameEdit();
    }
    const groups=new Map(), focused=document.activeElement;
    const names=scope ? cloud.projected().tabNames : null;
    const fragment=document.createDocumentFragment();
    let restoreFocus;
    for (const row of rows) {
      let group=groups.get(row.owner);
      if (!group) {
        group=document.createElement('fieldset');
        group.className='view-device';
        const title=document.createElement('legend');
        title.textContent=registeredLabel(row.owner)||row.label;
        group.append(title);
        groups.set(row.owner,group);
        fragment.append(group);
      }
      const n=group.childElementCount;
      const line=document.createElement('div');line.className='view-tab-row';
      const input=document.createElement('input');
      input.type='checkbox';input.checked=targets.includes(row.id);input.dataset.viewTab=row.id;
      input.id='view-tab-target-'+row.id;
      input.onchange=()=>{const checked=input.checked;update(values=>checked?[...values,row.id]:values.filter(id=>id!==row.id));};
      const sharedName=names && Object.hasOwn(names,row.id) ? names[row.id] : '';
      const name=sharedName || localName(row.id) || normalizeTabName(row.tabName) || '탭 '+n;
      const details=document.createElement('span');details.className='view-tab-details';
      const description=(row.id===sync.id?'이 탭 · ':'')+(row.full?'점수판 전체 화면':row.page+'쪽');
      const display=document.createElement('label');display.htmlFor=input.id;
      display.className='view-tab-name';display.textContent=name;display.title=name;
      const info=document.createElement('span');info.className='view-tab-info';info.textContent=description;
      const edit=document.createElement('button');
      edit.type='button';edit.className='view-tab-rename';edit.dataset.renameTab=row.id;
      edit.textContent='✎';edit.title='탭 이름 변경';edit.setAttribute('aria-label',name+' 이름 변경');
      edit.onclick=()=>editName(row,display,edit,input,description);
      input.setAttribute('aria-label',name+' · '+description);
      details.append(display,info);
      line.append(input,details,edit);
      group.append(line);
      if (focused?.dataset.viewTab===row.id) restoreFocus=input;
      if (focused?.dataset.renameTab===row.id) restoreFocus=edit;
    }
    list.replaceChildren(fragment);
    restoreFocus?.focus({preventScroll:true});
    positionMenu();
  }
  function announce() {
    if (!present) return;
    const desired=cloud.options?.boardId||null;
    if (scope!==desired) {
      unsubscribe?.();unsubscribe=null;members=[];scope=desired;lastPresence=null;watching=false;departed.clear();
    }
    try {
      localStorage.setItem(localKey,JSON.stringify({...presence(),board:scope,lease:!!releaseLease}));
      channel?.postMessage('change');
    } catch {}
    watchLocalPeers();
    if (scope && cloud.online && cloud.fs) {
      const target=cloud.ref('viewTabs',sync.id), owner=cloud.deviceId;
      const data={...presence(),owner};
      const signature=JSON.stringify([data.page,data.full,data.label,data.tabName,owner]);
      if (signature!==lastPresence || Date.now()-lastSent>=heartbeat) {
        lastPresence=signature;lastSent=Date.now();
        cloud.fs.setDoc(target,data).catch(error=>{lastPresence=null;if(root.style.display==='block')fail(error);});
      }
      const watched=scope;
      if (!unsubscribe) unsubscribe=cloud.fs.onSnapshot(cloud.collection('viewTabs'),snapshot=>{
        if (scope!==watched) return;
        members=snapshot.docs.map(doc=>doc.data());
        watching=!snapshot.metadata?.fromCache;
        for (const [id,instance] of departed) {
          if (!members.some(row=>row.id===id && row.instance===instance)) departed.delete(id);
        }
        render();
      },error=>{unsubscribe=null;if(root.style.display==='block')fail(error);});
    }
    render();
  }
  let scheduled;
  function refresh() {
    clearTimeout(scheduled);
    scheduled=setTimeout(announce,220);
  }
  if (channel) channel.onmessage=event=>{
    const message=event.data;
    if (message?.closed) forget(message.closed,message.instance,message.scope);
    watchLocalPeers();
    render();
  };
  window.addEventListener('storage',event=>{
    if (event.key?.startsWith(prefix)) {
      if (!event.newValue && event.oldValue) {
        try {const row=JSON.parse(event.oldValue);forget(row.id,row.instance,row.board??null);} catch {}
      }
      watchLocalPeers();
    }
    if (event.key?.startsWith(prefix) || event.key?.startsWith(namePrefix)) render();
  });
  async function liveIds() {
    announce();
    if (scope && !watching && cloud.online) {
      const snapshot=await cloud.fs.getDocsFromServer(cloud.collection('viewTabs'));
      members=snapshot.docs.map(doc=>doc.data());watching=true;
    }
    return available().map(tab=>tab.id);
  }
  let changes=Promise.resolve();
  const update=makeTargets=>{
    const call=++generation;
    changes=changes.then(async()=>{
      const ids=await liveIds();
      await publish(undefined,values=>makeTargets(viewTargets(values,ids),ids));
    }).catch(error=>{if (call===generation) fail(error);}).finally(render);
  };
  root.addEventListener('pointerdown',event=>{
    if (!event.target.closest('.view-tab-name-input')) finishNameEdit?.();
  });
  const hint=document.getElementById('viewSyncHint');
  let hintTimer;
  function hideHint() {
    clearTimeout(hintTimer);
    hint.hidden=true;
  }
  function showHint() {
    hideHint();
    const rect=control.getBoundingClientRect();
    hint.hidden=false;
    hint.style.left=Math.max(4,Math.min(innerWidth-hint.offsetWidth-4,rect.left+(rect.width-hint.offsetWidth)/2))+'px';
    hint.style.top=Math.max(4,rect.top-hint.offsetHeight-6)+'px';
    hintTimer=setTimeout(hideHint,3500);
  }
  toolbar.addEventListener('scroll',hideHint);
  window.addEventListener('resize',hideHint);
  function show(){hideHint();togglePopup('viewSyncMenu',opener);announce();}
  opener.addEventListener('click',show);
  control.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();show();}});
  control.onclick=()=>{
    changes=changes.then(async()=>{
      const ids=await liveIds();
      const state=readState();
      const targets=viewTargets(state?.targets,ids);
      if (!targets.length) {
        showHint();
        if (!state?.enabled) return;
      } else hideHint();
      await publish(!state?.enabled,state?.enabled?undefined:old=>viewTargets(old,ids));
    }).catch(fail).finally(render);
  };
  root.querySelector('[data-view-all]').onclick=()=>update((_,ids)=>ids);
  root.querySelector('[data-view-none]').onclick=()=>update(()=>[]);
  window.addEventListener('pagehide',()=>{
    present=false;
    clearTimeout(scheduled);
    clearTimeout(expiryTimer);
    unsubscribe?.();unsubscribe=null;watching=false;
    if (scope) forget(sync.id,instance,scope);
    releaseLease?.();releaseLease=null;
    for (const controller of watches.values()) controller.abort();
    try {
      if (JSON.parse(localStorage.getItem(localKey))?.instance===instance) localStorage.removeItem(localKey);
      channel?.postMessage({closed:sync.id,scope,instance});
    } catch {}
    closePopups();
  });
  window.addEventListener('pageshow',()=>{if (!present) {present=true;instance=uid();departed.clear();lastPresence=null;claimPresence();}});
  document.addEventListener('visibilitychange',()=>{if (document.visibilityState==='visible') announce();});
  setInterval(announce,heartbeat);
  claimPresence();
  return {render,refresh,position:positionMenu,finishRename:()=>finishNameEdit?.()};
}
