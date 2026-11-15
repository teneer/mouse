export function wireScoreSync(frame, cloud, store, notify) {
  const drafts = new Map();
  let write = Promise.resolve(), refreshQueued = false;
  let ready = false;
  let previous, wasOnline=false, catchingUp=true;

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
        const key = JSON.stringify([shared,model]);
        if (!cloud.online || !wasOnline) catchingUp=true;
        wasOnline=cloud.online;
        const live=cloud.online&&!catchingUp;
        if (cloud.online && cloud.state.revision>=cloud.head) catchingUp=false;
        if (key === previous) return;
        api().receive({shared,model,send,notice:notify,live});
        previous = key;
      } catch (error) {notify(error.message);}
      finally {refreshQueued = false;}
    });
  }
  function send(data) {
    if (!cloud.options || cloud.detaching) return;
    const operation = structuredClone(data);
    drafts.set(operation.key,operation);
    refresh();
    write = write.then(async ()=>{
      try {await cloud.enqueue(operation);}
      catch (error) {previous = null;notify(error.message);}
      finally {drafts.delete(operation.key);refresh();}
    });
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
