import {uid} from './constants.js';

const validId = /^[0-9a-f-]{36}$/i;

function claimLock(name) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise(resolve=>{
    locks.request(name,{ifAvailable:true},lock=>{
      if (!lock) {resolve(false);return;}
      // A reloading page releases its lease before the new document claims it.
      return new Promise(release=>{
        globalThis.addEventListener('pagehide',release,{once:true});
        resolve(true);
      });
    }).catch(()=>resolve(true));
  });
}

export async function acquireTabIdentity(key, {
  storage,
  navigation = globalThis.performance?.getEntriesByType('navigation')[0]?.type,
  acquire = claimLock
} = {}) {
  if (storage===undefined) {
    try {storage=globalThis.sessionStorage;} catch {}
  }
  let saved;
  if (navigation==='reload' || navigation==='back_forward') {
    try {saved=JSON.parse(storage?.getItem(key));} catch {}
  }
  let identity;
  if (validId.test(saved?.id) && Number.isFinite(saved.opened) &&
      await acquire(key+':'+saved.id)) {
    identity=saved;
  } else {
    identity={id:uid(),opened:Date.now()};
    await acquire(key+':'+identity.id);
  }
  try {storage?.setItem(key,JSON.stringify(identity));} catch {}
  return identity;
}
