export const activeView = (view,id) => !!view?.enabled && Array.isArray(view.targets) && view.targets.includes(id);
const maxAge=95_000;
const heartbeat=25_000;
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
  const prefix='whiteboard.view-tab:'+new URL('.',location.href).pathname+':';
  const localKey=prefix+sync.id;
  let members=[], scope, unsubscribe, timer, long=false, startPoint, generation=0;
  let channel, lastPresence, lastSent=0;
  try {channel=new BroadcastChannel(prefix);} catch {}
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
    const rows=(scope?members:localMembers()).filter(row=>Date.now()-row.time<maxAge);
    if (!rows.some(row=>row.id===sync.id)) rows.push(presence());
    return rows.sort((a,b)=>a.opened-b.opened||a.id.localeCompare(b.id));
  }
  const opened=Date.now();
  function presence() {
    const view=currentView();
    return {id:sync.id,owner:cloud.deviceId||'local',label:cloud.options?.label||'이 브라우저',
      opened,time:Date.now(),page:Math.max(1,pages().findIndex(page=>page.id===view.pageId)+1),full:view.scoreFull===true};
  }
  function render() {
    control.checked=activeView(readState(),sync.id);
    if (root.style.display!=='block') return;
    const rows=available(), targets=readState()?.targets||[];
    const counts=new Map(), focused=document.activeElement?.dataset.viewTab;
    list.replaceChildren();
    for (const row of rows) {
      const n=(counts.get(row.owner)||0)+1;
      counts.set(row.owner,n);
      const label=document.createElement('label'), input=document.createElement('input');
      input.type='checkbox';input.checked=targets.includes(row.id);input.dataset.viewTab=row.id;
      input.onchange=()=>update(values=>input.checked?[...values,row.id]:values.filter(id=>id!==row.id));
      label.append(input,document.createTextNode(row.label+' · 탭 '+n+(row.id===sync.id?' (이 탭)':'')+' · '+(row.full?'점수판 전체 화면':row.page+'쪽')));
      list.append(label);
      if (focused===row.id) input.focus({preventScroll:true});
    }
    positionMenu();
  }
  function announce() {
    const desired=cloud.options?.boardId||null;
    if (scope!==desired) {
      unsubscribe?.();unsubscribe=null;members=[];scope=desired;lastPresence=null;
      try {localStorage.removeItem(localKey);channel?.postMessage('change');} catch {}
    }
    if (!scope) {
      try {
        localStorage.setItem(localKey,JSON.stringify(presence()));channel?.postMessage('change');
      } catch {}
    } else if (cloud.online && cloud.fs) {
      const target=cloud.ref('viewTabs',sync.id), owner=cloud.deviceId;
      const data={...presence(),owner};
      const signature=JSON.stringify([data.page,data.full,data.label,owner]);
      if (signature!==lastPresence || Date.now()-lastSent>=heartbeat) {
        lastPresence=signature;lastSent=Date.now();
        cloud.fs.setDoc(target,data).catch(error=>{lastPresence=null;if(root.style.display==='block')fail(error);});
      }
      const watched=scope;
      if (!unsubscribe) unsubscribe=cloud.fs.onSnapshot(cloud.collection('viewTabs'),snapshot=>{
        if (scope!==watched) return;
        members=snapshot.docs.map(doc=>doc.data());render();
      },error=>{if(root.style.display==='block')fail(error);});
    }
    render();
  }
  let scheduled;
  function refresh() {
    clearTimeout(scheduled);
    scheduled=setTimeout(announce,220);
  }
  if (channel) channel.onmessage=render;
  let changes=Promise.resolve();
  const update=makeTargets=>{
    const call=++generation;
    changes=changes.then(()=>publish(undefined,makeTargets)).catch(error=>{if (call===generation) fail(error);}).finally(render);
  };
  window.addEventListener('resize',positionMenu);
  if (typeof ResizeObserver!=='undefined') new ResizeObserver(positionMenu).observe(toolbar);
  function show(){togglePopup('viewSyncMenu',opener);announce();}
  opener.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    long=false;startPoint=[event.clientX,event.clientY];
    timer=setTimeout(()=>{long=true;show();},550);
  });
  opener.addEventListener('pointermove',event=>{
    if (startPoint && Math.hypot(event.clientX-startPoint[0],event.clientY-startPoint[1])>9) clearTimeout(timer);
  });
  for(const type of ['pointerup','pointercancel','pointerleave']) opener.addEventListener(type,()=>clearTimeout(timer));
  opener.addEventListener('click',event=>{
    if(long){event.preventDefault();event.stopImmediatePropagation();long=false;return;}
    if(event.altKey){event.preventDefault();show();}
  },true);
  opener.addEventListener('contextmenu',event=>{event.preventDefault();clearTimeout(timer);if(!long){long=true;show();}});
  control.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();show();}});
  control.onchange=()=>{
    const enabled=control.checked;
    publish(enabled,enabled ? old=>old.length?[...old,sync.id]:available().map(tab=>tab.id) : undefined)
      .catch(fail).finally(render);
  };
  root.querySelector('[data-view-all]').onclick=()=>update(()=>available().map(tab=>tab.id));
  root.querySelector('[data-view-none]').onclick=()=>update(()=>[]);
  window.addEventListener('pagehide',()=>{
    clearTimeout(timer);
    if(scope && cloud.online) cloud.fs.deleteDoc(cloud.ref('viewTabs',sync.id)).catch(()=>{});
    try {localStorage.removeItem(localKey);channel?.postMessage('change');} catch {}
    closePopups();
  });
  window.addEventListener('pageshow',refresh);
  setInterval(announce,heartbeat);
  announce();
  return {render,refresh};
}
