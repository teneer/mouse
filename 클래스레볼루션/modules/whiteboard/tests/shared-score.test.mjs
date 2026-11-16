import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,newBoard} from '../js/cloud-model.js';
import {CloudBoard} from '../js/cloud.js';

const snapshot = {count:30,teams:[{id:'a',name:'1모둠',score:2},{id:'b',name:'2모둠',score:0}]};
function send(board, operation) {applyOperation(board,operation,board.revision+1);}
function seed() {
  const board = newBoard();
  send(board,{kind:'seed',pages:[],score:snapshot});
  return board;
}

test('replayed offline changes add together, including the server-ordered team conversion',()=>{
  const board = seed();
  send(board,{kind:'score-delta',key:'pc',group:'pc',amount:1});
  send(board,{kind:'score-delta',key:'tablet',group:'tablet',amount:2});
  assert.equal(board.score.state.count,33);
  send(board,{kind:'score-delta',key:'linked-one',group:'linked-one',amount:1,targets:['a']});
  send(board,{kind:'score-delta',key:'linked-two',group:'linked-two',amount:2,targets:['a','b']});
  assert.equal(board.score.state.count,35);
  assert.deepEqual(board.score.state.teams.map(team=>team.score),[5,2]);
  send(board,{kind:'score-undo',key:'undo',base:'linked-two'});
  assert.equal(board.score.state.count,34);
  assert.deepEqual(board.score.state.teams.map(team=>team.score),[3,0]);
});

test('stale overwrite produces a shared conflict and a stale choice cannot resolve it',()=>{
  const board=seed();
  send(board,{kind:'score-delta',key:'plus',group:'plus',amount:2});
  send(board,{kind:'score-edit',key:'reset',base:'first-score',snapshot:{...snapshot,count:0}});
  assert.equal(board.score.state.count,32);
  assert.equal(board.score.conflicts[0].candidate.count,0);
  send(board,{kind:'score-delta',key:'later',group:'later',amount:1});
  send(board,{kind:'score-resolve',key:'stale',base:'plus',conflict:'reset',useCandidate:true});
  assert.equal(board.score.state.count,33);
  assert.equal(board.score.conflicts.length,1);
  send(board,{kind:'score-resolve',key:'fresh',base:'later',conflict:'reset',useCandidate:true});
  assert.equal(board.score.state.count,0);
  assert.equal(board.score.conflicts.length,0);
});

test('migration accepts a start value once and removed team IDs never target a replacement',()=>{
  const board=newBoard();
  send(board,{kind:'score-seed',key:'pc',snapshot});
  send(board,{kind:'score-seed',key:'other-device',snapshot:{count:5}});
  send(board,{kind:'score-edit',key:'edit',base:'pc',snapshot:{...snapshot,teams:[{id:'c',name:'1모둠',score:0}]}});
  send(board,{kind:'score-delta',key:'old-team',group:'old-team',amount:1,targets:['a']});
  assert.equal(board.score.state.count,30);
  assert.equal(board.score.state.teams[0].score,0);
  assert.equal(board.score.notice.key,'old-team');
});

test('offline rendering projects durable and unsaved scores without double-counting',()=>{
  const cloud = new CloudBoard({}, {});
  cloud.state = seed();
  const operation = {kind:'score-delta',key:'op',group:'op',amount:1};
  cloud.pending.set('local',operation);
  assert.equal(cloud.projectedScore([operation]).state.count,31);
  assert.equal(cloud.state.score.state.count,30);
});

test('an offline increment can flag an overwrite even when that overwrite arrived first',()=>{
  const board=seed();
  send(board,{kind:'score-edit',key:'reset',base:'first-score',snapshot:{...snapshot,count:0}});
  send(board,{kind:'score-delta',key:'offline',group:'offline',epoch:'first-score',amount:2});
  send(board,{kind:'score-delta',key:'online',group:'online',epoch:'reset',amount:1});
  assert.equal(board.score.state.count,3);
  assert.equal(board.score.conflicts[0].candidate.count,33);
  send(board,{kind:'score-resolve',key:'keep',base:'online',conflict:'reset',useCandidate:false});
  assert.equal(board.score.state.count,3);
  assert.equal(board.score.conflicts.length,0);
});
