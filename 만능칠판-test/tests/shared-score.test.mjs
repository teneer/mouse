import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,newBoard} from '../js/cloud-model.js';
import {fieldConflictOptions,scoreDeltaBasis,scorePatch} from '../js/score-conflicts.js';
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

const fieldEdit=(board,key,device,before,after,authoredAt=1)=>send(board,{
  kind:'score-patch',key,device,authoredAt,patch:scorePatch(before,after)
});

test('three different values appear in one field; the latest value per device supersedes older values',()=>{
  const board=seed();
  const before=structuredClone(board.score.state);
  send(board,{kind:'score-delta',key:'server',group:'g',amount:3,fieldBasis:{}});
  fieldEdit(board,'pc1','pc',before,{...before,count:0});
  fieldEdit(board,'phone','phone',before,{...before,count:20});
  fieldEdit(board,'pc2','pc',before,{...before,count:10},3);
  fieldEdit(board,'pc-old','pc',before,{...before,count:5},2);
  fieldEdit(board,'tablet','tablet',before,{...before,count:20});
  const conflicts=fieldConflictOptions(board.score);
  assert.equal(conflicts.length,1);
  assert.equal(conflicts[0].server,33);
  assert.deepEqual(conflicts[0].candidates.map(({value,devices})=>[value,devices.map(device=>device.id)]),[
    [20,['phone','tablet']],[10,['pc']]
  ]);
});

test('a mixed batch applies independent fields; a stale comparison cannot overwrite a newer value',()=>{
  const board=seed(), before=structuredClone(board.score.state);
  send(board,{kind:'score-delta',key:'class-plus',group:'class',amount:3,fieldBasis:{}});
  const candidate={...before,count:0,teams:before.teams.map(team=>team.id==='a'?{...team,score:7}:team)};
  fieldEdit(board,'batch','pc',before,candidate);
  const [old]=fieldConflictOptions(board.score);
  assert.equal(board.score.state.teams[0].score,7);
  send(board,{kind:'score-delta',key:'class-new',group:'new',amount:1,fieldBasis:{}});
  send(board,{kind:'score-field-choice',key:'stale',field:old.field,stamp:old.stamp,value:0});
  assert.equal(board.score.state.count,34);
  const [fresh]=fieldConflictOptions(board.score);
  send(board,{kind:'score-field-choice',key:'confirmed',field:fresh.field,stamp:fresh.stamp,value:0});
  assert.equal(board.score.state.count,0);
  assert.equal(board.score.state.teams[0].score,7);
  assert.deepEqual(fieldConflictOptions(board.score),[]);
});

test('a late delta after a reset is compared with the no-reset value for the same field',()=>{
  const board=seed(), before=structuredClone(board.score.state);
  fieldEdit(board,'reset','pc',before,{...before,count:0});
  send(board,{kind:'score-delta',key:'offline',group:'phone',amount:2,fieldBasis:{},device:'phone'});
  send(board,{kind:'score-delta',key:'later',group:'pc',amount:1,fieldBasis:scoreDeltaBasis(board.score),device:'pc'});
  const [conflict]=fieldConflictOptions(board.score);
  assert.equal(conflict.server,3);
  assert.equal(conflict.candidates[0].value,33);
});

test('removed targets are skipped while other targets in a queued increment are handled',()=>{
  const board=seed(), before=structuredClone(board.score.state);
  fieldEdit(board,'remove','pc',before,{...before,teams:before.teams.filter(team=>team.id==='b')});
  send(board,{kind:'score-delta',key:'late',group:'team',amount:2,targets:['a','b'],fieldBasis:{}});
  assert.equal(board.score.state.teams[0].score,2);
  assert.match(board.score.notice.text,/삭제된 모둠/);
});

test('an unresolved legacy comparison is imported into existing per-field comparisons',()=>{
  const board=seed(), before=structuredClone(board.score.state);
  fieldEdit(board,'setup','pc',before,{...before,count:32});
  send(board,{kind:'score-edit',key:'old-tab',base:'first-score',snapshot:{...before,count:4}});
  const cloud=new CloudBoard({},{});
  cloud.state=board;
  const [conflict]=fieldConflictOptions(cloud.projectedScore());
  assert.equal(conflict.server,32);
  assert.equal(conflict.candidates[0].value,4);
});
