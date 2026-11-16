import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScoreOperation} from '../js/shared-score.js';

function scenario() {
  const board={}, send=(kind, key, fields)=>applyScoreOperation(board,{kind,key,authoredAt:1,...fields});
  send('score-seed','seed',{snapshot:{count:9,teams:[{id:'a',name:'햇살',score:2},{id:'b',name:'별빛',score:0}],classGoals:[{score:10}]}});
  return {score:()=>board.score.state.goalSystem,send};
}
const goals=[
  {id:'class',type:'class',score:10,message:'학급 달성',automatic:true,reward:false},
  {id:'team',type:'team',score:3,message:'모둠 달성',automatic:false,reward:true}
];
test('simultaneous class and team goals create independent records and legacy goals are discarded',()=>{
  const {score,send}=scenario();
  assert.deepEqual(score().goals,[]);
  send('score-goals','new',{base:null,goals});
  send('score-delta','one',{group:'g',amount:1,targets:['a']});
  assert.deepEqual(score().records.map(({teamId,status})=>[teamId,status]),[[null,'done'],['a','pending']]);
  send('score-delta','two',{group:'h',amount:3,targets:['b']});
  assert.deepEqual(score().records.map(record=>record.teamId),[null,'a','b']);
});
test('withdrawal and regrant reuse the record and reject a stale completion',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals});
  send('score-delta','one',{group:'g',amount:1,targets:['a']});
  const id=score().records.find(row=>row.teamId==='a').id;
  const record=()=>score().records.find(row=>row.id===id);
  send('score-delta','down',{group:'h',amount:-1,targets:['a']});
  assert.equal(record().status,'withdrawn');
  send('score-delta','up',{group:'h2',amount:1,targets:['a']});
  send('score-records','stale',{complete:true,records:[{id,reached:'one'}]});
  assert.equal(record().status,'pending');
  send('score-records','done',{complete:true,records:[{id,reached:'up'}]});
  send('score-delta','down2',{group:'h',amount:-1,targets:['a']});
  send('score-delta','up2',{group:'h2',amount:1,targets:['a']});
  assert.equal(record().status,'done');
  assert.equal(record().reached,'up');
  assert.equal(score().records.length,2);
});
test('creating an already reached goal can add a silent record',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals:[{...goals[0],score:9}],includeExisting:true});
  assert.equal(score().records[0].silent,true);
  assert.equal(score().records[0].status,'done');
});

test('an automatically completed goal can be cancelled and completes again only after another crossing',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals:[goals[0]]});
  send('score-delta','one',{group:'g',amount:1});
  const [record]=score().records;
  assert.equal(record.status,'done');
  send('score-records','cancel',{complete:false,records:[{id:record.id,reached:record.reached}]});
  assert.equal(record.status,'pending');
  assert.equal(record.reached,'one');
  send('score-delta','down',{group:'down',amount:-1});
  assert.equal(record.status,'withdrawn');
  send('score-delta','up',{group:'up',amount:1});
  assert.equal(record.status,'done');
  assert.equal(record.reached,'up');
});

test('records retain the actual score at the time of crossing, distinct from the threshold',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals});
  send('score-delta','one',{group:'g',amount:4,targets:['a']});
  const found=score().records.find(row=>row.teamId==='a');
  assert.equal(found.score,3);
  assert.equal(found.achievedScore,6);
  send('score-delta','more',{group:'later',amount:1,targets:['a']});
  assert.equal(score().records.find(row=>row.teamId==='a').achievedScore,6);
});

test('goal scores accept signed integer text and keep the existing score limits',async()=>{
  const {parseGoalScore}=await import('../score/goal-model.js');
  assert.equal(parseGoalScore('  -10 '),-10);
  assert.equal(parseGoalScore('３０'),30);
  assert.equal(parseGoalScore('0'),0);
  for (const invalid of ['','한글','5점','1.5','1e3','10001','-10001']) {
    assert.equal(parseGoalScore(invalid),null);
  }
});

test('automatic goals already reached at setup complete silently and remain completed after a decrease',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals:[{...goals[0],score:8}],includeExisting:false});
  assert.deepEqual(score().records.map(({status,silent})=>({status,silent})),[{status:'done',silent:true}]);
  send('score-delta','down',{group:'down',amount:-5});
  assert.equal(score().records[0].status,'done');
});

test('a reached manual goal with no historical record can be completed and cancelled',async()=>{
  const {goalStatus}=await import('../score/goal-model.js');
  const {score,send}=scenario();
  const goal={...goals[0],score:8,automatic:false};
  send('score-goals','new',{base:null,goals:[goal],includeExisting:false});
  assert.equal(goalStatus(goal,9,null),'reached');
  const target={id:JSON.stringify([goal.id,null]),reached:null,goalId:goal.id,teamId:null};
  send('score-records','done',{complete:true,records:[target]});
  const [record]=score().records;
  assert.equal(goalStatus(goal,3,record),'done');
  send('score-records','cancel',{complete:false,records:[{id:record.id,reached:record.reached}]});
  assert.equal(goalStatus(goal,9,record),'reached');
});

test('deleting a goal removes outstanding gifts while preserving unrelated records',()=>{
  const {score,send}=scenario();
  send('score-goals','new',{base:null,goals});
  send('score-delta','one',{group:'points',amount:1,targets:['a']});
  assert.equal(score().records.length,2);
  send('score-goals','remove',{base:'new',goals:[goals[0]]});
  assert.deepEqual(score().records.map(record=>record.goalId),[goals[0].id]);
});
