import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,newBoard} from '../js/cloud-model.js';
import {fieldConflictOptions,scorePatch} from '../js/score-conflicts.js';
import {CloudBoard} from '../js/cloud.js';

const snapshot={count:10,teams:[{id:'a',name:'1모둠',score:0},{id:'b',name:'2모둠',score:0}],scoreLink:{enabled:true,points:5}};
const send=(board,operation)=>applyOperation(board,operation,board.revision+1);
function seed(){
  const board=newBoard();
  send(board,{kind:'seed',pages:[],score:snapshot});
  return board;
}
function delta(board,key,amount,targets=null,group=key,extra={}){
  send(board,{kind:'score-delta',key,group,amount,targets,...extra});
}
function edit(board,key,before,after){
  send(board,{kind:'score-patch',key,patch:scorePatch(before,after)});
}
test('mixed devices use server order and global repeated undo',()=>{
  const board=seed();
  delta(board,'pc',3);delta(board,'tablet',2);
  assert.equal(board.score.state.count,15);
  send(board,{kind:'score-undo',key:'undo1'});
  assert.equal(board.score.state.count,13);
  send(board,{kind:'score-undo',key:'undo2'});
  assert.equal(board.score.state.count,10);
  assert.equal(board.score.undoStack.length,0);
});
test('fast consecutive changes in one group undo as one action',()=>{
  const board=seed();
  delta(board,'first',1,null,'same');delta(board,'second',2,null,'same');
  assert.equal(board.score.undoStack.length,1);
  assert.equal(board.score.undoStack[0].amount,3);
  send(board,{kind:'score-undo',key:'undo'});
  assert.equal(board.score.state.count,10);
});
test('direct editing follows server commit order without manual conflict prompts',()=>{
  const board=seed(),before=structuredClone(board.score.state);
  delta(board,'tablet',3);
  edit(board,'pc',before,{...before,count:20});
  assert.equal(board.score.state.count,20);
  assert.deepEqual(fieldConflictOptions(board.score),[]);
  delta(board,'next',2);
  assert.equal(board.score.state.count,22);
  send(board,{kind:'score-undo',key:'undo'});
  assert.equal(board.score.state.count,20);
});
test('team score conversions undo at current linked rate',()=>{
  const board=seed();
  delta(board,'linked',5,['a']);
  assert.deepEqual([board.score.state.count,board.score.state.teams[0].score],[11,5]);
  send(board,{kind:'score-undo',key:'undo'});
  assert.deepEqual([board.score.state.count,board.score.state.teams[0].score],[10,0]);
});
test('an edit invalidates impacted score undo history but not unrelated team history',()=>{
  const board=seed();
  delta(board,'team-a',1,['a']);
  delta(board,'team-b',2,['b']);
  const before=structuredClone(board.score.state);
  edit(board,'edit-a',before,{...before,teams:before.teams.map(t=>t.id==='a'?{...t,score:10}:t)});
  assert.equal(board.score.undoStack.length,1);
  assert.deepEqual(board.score.undoStack[0].targets,['b']);
  send(board,{kind:'score-undo',key:'undo'});
  assert.equal(board.score.state.teams.find(t=>t.id==='b').score,0);
  assert.equal(board.score.state.teams.find(t=>t.id==='a').score,10);
});
test('class direct edit is a shared undo boundary',()=>{
  const board=seed();delta(board,'class-plus',3);delta(board,'team-plus',1,['a']);
  const before=structuredClone(board.score.state);
  edit(board,'direct',before,{...before,count:40});
  assert.equal(board.score.undoStack.length,0);
});
test('offline replay events are retained in data but marked silent',()=>{
  const board=seed();
  delta(board,'old',3,null,'old',{replay:true});
  assert.equal(board.score.state.count,13);
  assert.equal(board.score.effect.replay,true);
  assert.equal(board.score.sounds[0].replay,true);
});
test('offline locally queued changes and server changes accumulate without double count',()=>{
  const cloud=new CloudBoard({},{});
  cloud.state=seed();
  const operation={kind:'score-delta',key:'offline',group:'offline',amount:3};
  cloud.pending.set('pending',operation);
  assert.equal(cloud.projectedScore([operation]).state.count,13);
  delta(cloud.state,'server',2);
  assert.equal(cloud.projectedScore().state.count,15);
});
test('offline undo cancels only unsent local operations',async()=>{
  const deleted=[];
  const cloud=new CloudBoard({deleteCloudOperation:async id=>{deleted.push(id);}},{board:()=>{}});
  cloud.state=seed();
  cloud.options={boardId:'board'};
  cloud.online=false;
  cloud.pending.set('pending',{id:'pending',kind:'score-delta',key:'local',group:'local',amount:3});
  assert.equal(cloud.canCancelLastPendingScore(),true);
  assert.equal(await cloud.cancelLastPendingScore(),true);
  assert.deepEqual(deleted,['pending']);
  assert.equal(cloud.projectedScore().state.count,10);
  assert.equal(cloud.canCancelLastPendingScore(),false);
});
test('inflight or server-confirmed undo cannot be canceled while offline',()=>{
  const cloud=new CloudBoard({},{});
  cloud.state=seed();
  cloud.options={boardId:'board'};
  cloud.pending.set('pending',{id:'pending',kind:'score-delta',key:'local',group:'local',amount:1});
  cloud.inFlight.add('pending');
  assert.equal(cloud.canCancelLastPendingScore(),false);
  cloud.inFlight.delete('pending');
  cloud.online=true;
  assert.equal(cloud.canCancelLastPendingScore(),false);
});
test('deleted team targets do not silently mutate another team',()=>{
  const board=seed(),before=structuredClone(board.score.state);
  edit(board,'remove',before,{...before,teams:[before.teams[1]]});
  delta(board,'late',2,['a','b']);
  assert.equal(board.score.state.teams[0].score,2);
  assert.match(board.score.notice.text,/삭제된 모둠/);
});
