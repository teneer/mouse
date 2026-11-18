import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPlaySound} from '../score/score-audio.js';
import {newBoard,applyOperation} from '../js/cloud-model.js';

const tabs=[
  {id:'pc-a',owner:'pc',opened:10},
  {id:'pc-b',owner:'pc',opened:20},
  {id:'tablet-a',owner:'tablet',opened:5}
];
test('the default lets every tab play audio',()=>{
  assert.equal(shouldPlaySound({mode:'all',tabs,tabId:'pc-a',deviceId:'pc'}),true);
  assert.equal(shouldPlaySound({mode:'all',tabs,tabId:'pc-b',deviceId:'pc'}),true);
});
test('per-device mode elects only one tab per device',()=>{
  assert.equal(shouldPlaySound({mode:'device',tabs,tabId:'pc-a',deviceId:'pc'}),true);
  assert.equal(shouldPlaySound({mode:'device',tabs,tabId:'pc-b',deviceId:'pc'}),false);
  assert.equal(shouldPlaySound({mode:'device',tabs,tabId:'tablet-a',deviceId:'tablet'}),true);
});
test('selected tabs never play audio outside the selection',()=>{
  assert.equal(shouldPlaySound({mode:'selected',selected:['pc-b'],tabs,tabId:'pc-a',deviceId:'pc'}),false);
  assert.equal(shouldPlaySound({mode:'selected',selected:['pc-b'],tabs,tabId:'pc-b',deviceId:'pc'}),true);
});
test('sound policy and tab names replay in server-confirmed order',()=>{
  const board=newBoard();
  applyOperation(board,{kind:'sound-policy',mode:'selected',selected:['pc-b','pc-b']},1);
  assert.deepEqual(board.soundPolicy,{mode:'selected',selected:['pc-b']});
  applyOperation(board,{kind:'tab-rename',tabId:'pc-b',name:'모니터1 전자칠판 송출'},2);
  assert.equal(board.tabNames['pc-b'],'모니터1 전자칠판 송출');
  applyOperation(board,{kind:'sound-policy',mode:'device',selected:[]},3);
  assert.equal(board.soundPolicy.mode,'device');
});
