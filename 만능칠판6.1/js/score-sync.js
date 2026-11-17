export function wireScoreSync(frame, cloud, store, notify, tabId) {
  const drafts = new Map();
  let write = Promise.resolve(), refreshQueued = false;
  let ready = false;
  let previous, wasOnline=false, catchingUp=true;
  const localSoundKey='whiteboard.score-sound-policy:'+new URL('.',location.href).pathname;
  const tabPrefix='whiteboard.view-tab:'+new URL('.',location.href).pathname+':';
  const localTabs=()=>{
    const rows=[];
    try{for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(!key?.startsWith(tabPrefix))continue;
      const row=JSON.parse(localStorage.getItem(key)||'null');
      if(row?.id && Date.now()-row.time<75000)rows.push(row);
    }}catch{}
    return rows;
  };
  function soundContext() {
    const state=cloud.options?cloud.projected():null;
    const raw=cloud.options?state?.soundPolicy:(()=>{
      try{return JSON.parse(localStorage.getItem(localSoundKey)||'null')}catch{return null}
    })();
    const soundPolicy=['all','device','selected'].includes(raw?.mode)
      ?{mode:raw.mode,selected:Array.isArray(raw.selected)?raw.selected:[]}
      :{mode:'all',selected:[]};
    const tabs=(cloud.options?cloud.tabs:localTabs()).filter(row=>row?.id && Date.now()-row.time<75000)
      .map(row=>({...row,tabName:state?.tabNames?.[row.id]||row.tabName||'',
        deviceLabel:cloud.devices.find(device=>device.id===row.owner)?.label||row.label||'이 브라우저'}));
    if(!tabs.some(row=>row.id===tabId))tabs.push({id:tabId,owner:cloud.deviceId||'local',
      tabName:state?.tabNames?.[tabId]||'',deviceLabel:cloud.options?.label||'이 브라우저',opened:Date.now(),time:Date.now()});
    return {soundPolicy,tabs,deviceId:cloud.deviceId||'local',tabId};
  }
  async function changeSoundPolicy({mode,selected=[]}) {
    if(!['all','device','selected'].includes(mode))return;
    const normalized=[...new Set(selected.filter(id=>typeof id==='string'))].slice(0,100);
    if(cloud.options)await cloud.enqueue({kind:'sound-policy',mode,selected:normalized});
    else localStorage.setItem(localSoundKey,JSON.stringify({mode,selected:normalized}));
    previous=null;refresh();
  }
  window.addEventListener('storage',event=>{if(event.key===localSoundKey)refresh();});
  let scoreChannel;
  try {scoreChannel = new BroadcastChannel('whiteboard.test.score-preview.v1');} catch {}
  if (scoreChannel) scoreChannel.onmessage = ({data}) => {
    if (ready && cloud.online && !cloud.hydrating && cloud.options && !cloud.detaching && data?.boardId === cloud.options.boardId) {
      api()?.preview?.(data);
    }
  };

  function api() {return frame?.contentWindow?.whiteboardScore;}
  function snapshot() {
    const state = api()?.localSnapshot();
    if (!state) throw Error('점수판을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    return state;
  }
  function refresh() {
    if (!ready || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(async ()=>{
      try {
        if (!api()?.localSnapshot()) return;
        if (!cloud.options) await restoreLocal();
        const shared = !!cloud.options;
        const model = shared ? cloud.projectedScore(drafts.values()) : null;
        const deviceNames=(cloud.devices||[]).map(({id,label})=>({id,label}));
        const stable=cloud.online && !cloud.hydrating && cloud.state.revision>=cloud.head;
        if(!stable || !wasOnline)catchingUp=true;
        const live=stable && !catchingUp;
        if(stable)catchingUp=false;
        wasOnline=stable;
        const offline=!cloud.online;
        const offlineUndoPossible=offline && cloud.canCancelLastPendingScore();
        const sound=soundContext();
        const key=JSON.stringify([shared,model,deviceNames,offline,offlineUndoPossible,live,sound]);
        if(key===previous)return;
        api().receive({shared,model,send,notice:notify,live,deviceNames,
          offline,offlineUndoPossible,cancelOfflineUndo,...sound,changeSoundPolicy});
        previous = key;
      } catch (error) {notify(error.message);}
      finally {refreshQueued = false;}
    });
  }
  async function cancelOfflineUndo() {
    if(cloud.online || !cloud.options)return false;
    await write;
    const cancelled=await cloud.cancelLastPendingScore();
    previous=null;
    refresh();
    return cancelled;
  }

  function send(data,preview) {
    if (!cloud.options || cloud.detaching) return false;
    const connection = cloud.options;
    if (data.kind==='score-goals' && data.base!==(cloud.projectedScore(drafts.values())?.state.goalSystem?.revision??null)) return false;
    const operation = structuredClone({...data,device:cloud.deviceId||'local',deviceLabel:cloud.options.label||'연결 기기'});
    drafts.set(operation.key,operation);
    refresh();
    write = write.then(async ()=>{
      try {await cloud.enqueue(operation);}
      catch (error) {previous = null;notify(error.message);return false;}
      finally {drafts.delete(operation.key);refresh();}
      // Peers only use this for display. The durable operation still has a single sender.
      if (preview && cloud.options === connection && !cloud.detaching) {
        try {scoreChannel?.postMessage({...preview,key:operation.key,boardId:connection.boardId});} catch {}
      }
      return true;
    });
    return write;
  }
  frame?.addEventListener('score-sync-ready',()=>{
    previous = null;
    restoreLocal().then(refresh).catch(error=>notify(error.message));
  });

  async function restoreLocal() {
    const handoff = await store.getMeta('localScoreHandoff');
    if (handoff && api()?.localSnapshot()) {
      api().saveLocal(handoff);
      await store.setMeta('localScoreHandoff',null);
    }
  }

  return {
    refresh,
    snapshot,
    idle:()=>write,
    async ready() {try {await restoreLocal();} finally {ready=true;refresh();}},
    restoreLocal
  };
}
