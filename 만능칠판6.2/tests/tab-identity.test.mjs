import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireTabIdentity} from '../js/tab-identity.js';
import {activeView} from '../js/view-tabs.js';

const key='whiteboard:tab-identity';
const store=(value=null)=>({
  getItem(){return value;},
  setItem(_,next){value=next;}
});

test('refreshing keeps the tab ID, open order, and existing sync selection',async()=>{
  const storage=store();
  const first=await acquireTabIdentity(key,{storage,navigation:'navigate'});
  const after=await acquireTabIdentity(key,{storage,navigation:'reload'});
  assert.deepEqual(after,first);
  assert.equal(activeView({enabled:true,targets:[first.id]},after.id),true);
});

test('a new tab receiving a copy of session storage gets its own ID',async()=>{
  const original=store();
  const first=await acquireTabIdentity(key,{storage:original,navigation:'navigate'});
  const copy=store(original.getItem());
  const second=await acquireTabIdentity(key,{storage:copy,navigation:'navigate'});
  assert.notEqual(second.id,first.id);
  assert.deepEqual(JSON.parse(original.getItem()),first);
});

test('a reload cannot claim the ID of another live tab',async()=>{
  const storage=store();
  const first=await acquireTabIdentity(key,{storage,navigation:'navigate'});
  const after=await acquireTabIdentity(key,{storage,navigation:'reload',acquire:async name=>!name.endsWith(first.id)});
  assert.notEqual(after.id,first.id);
});

test('default selects all live tabs and explicit selections survive churn',async()=>{
  const {viewTargets}=await import('../js/view-tabs.js');
  const available=['pc','tablet'];
  assert.deepEqual(viewTargets(undefined,available),available);
  assert.deepEqual(viewTargets([],available),[]);
  assert.deepEqual(viewTargets(['old','tablet'],available),['tablet']);
  assert.deepEqual(viewTargets(['old'],available),available);
});
