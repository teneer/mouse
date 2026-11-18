import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireTabIdentity} from '../js/tab-identity.js';
import {activeView,defaultTabNames,screenTransferTargets} from '../js/view-tabs.js';

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

test('one-shot screen transfer includes only selected tabs still in the list',()=>{
  const available=[{id:'pc'},{id:'tablet'}];
  assert.deepEqual(screenTransferTargets(new Set(),available),[]);
  assert.deepEqual(screenTransferTargets(new Set(['pc','tablet']),available),['pc','tablet']);
  assert.deepEqual(screenTransferTargets(new Set(['old','tablet']),available),['tablet']);
  assert.deepEqual(screenTransferTargets(new Set(['old']),available),[]);
});

test('default tab names follow opening order independently for each device',()=>{
  const rows=[{id:'b',owner:'pc',opened:12,page:9},{id:'c',owner:'phone',opened:11,page:13},
    {id:'a',owner:'pc',opened:10,page:1}];
  assert.deepEqual([...defaultTabNames(rows)],[['a','탭1'],['c','탭1'],['b','탭2']]);
});
