export function wireScoreSync(frame, cloud, store, notify) {
  const drafts = new Map();
  let write = Promise.resolve(), refreshQueued = false;
  let ready = false;
  let previous, wasOnline=false, catchingUp=true;
  let scoreChannel;
  try {scoreChannel = new BroadcastChannel('whiteboard.601.score-preview.v1');} catch {}
  if (scoreChannel) scoreChannel.onmessage = ({data}) => {
    if (ready && cloud.options && !cloud.detaching && data?.boardId === cloud.options.boardId) {
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
        const key = JSON.stringify([shared,model,deviceNames]);
        if (!cloud.online || !wasOnline) catchingUp=true;
        wasOnline=cloud.online;
        const live=cloud.online&&!catchingUp;
        if (cloud.online && cloud.state.revision>=cloud.head) catchingUp=false;
        if (key === previous) return;
        api().receive({shared,model,send,notice:notify,live,deviceNames});
        previous = key;
      } catch (error) {notify(error.message);}
      finally {refreshQueued = false;}
    });
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
