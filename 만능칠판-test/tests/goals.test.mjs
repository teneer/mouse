import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScoreOperation} from '../js/shared-score.js';
import {nextClassGoal} from '../score/goal-model.js';

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

test('next class goal picks the closest upcoming class score and skips completed goals',()=>{
  const system={
    goals:[
      {id:'high',type:'class',score:60},
      {id:'team',type:'team',score:21},
      {id:'next',type:'class',score:30},
      {id:'done',type:'class',score:25}
    ],
    records:[{id:'["done",null]',goalId:'done',teamId:null,status:'done'}]
  };
  assert.equal(nextClassGoal(system,20)?.score,30);
  assert.equal(nextClassGoal(system,30)?.score,60);
  assert.equal(nextClassGoal(system,60),null);
  assert.equal(nextClassGoal({goals:[],records:[]},0),null);
});

test('recurring class goals keep independent rounds at overlapping scores',()=>{
  const {score,send}=scenario();
  send('score-goals','goals',{base:null,goals:[
    {id:'movie',type:'class',score:50,interval:50,message:'영화데이'},
    {id:'free',type:'class',score:100,interval:100,message:'자유시간'},
    {id:'once',type:'class',score:125,message:'스티커'},
  ]});
  assert.equal(nextClassGoal(score(),9)?.message,'영화데이');
  send('score-delta','jump',{group:'jump',amount:91});
  const records=()=>score().records.map(({goalId,score,status})=>[goalId,score,status]);
  assert.deepEqual(records(),[['movie',50,'pending'],['movie',100,'pending'],['free',100,'pending']]);
  assert.equal(nextClassGoal(score(),100)?.score,125);
  const movie=score().records[1];
  send('score-records','complete',{records:[{id:movie.id,reached:movie.reached}],complete:true});
  assert.deepEqual(records(),[['movie',50,'pending'],['movie',100,'done'],['free',100,'pending']]);
  send('score-delta','drop',{group:'drop',amount:-60});
  assert.deepEqual(records(),[['movie',50,'withdrawn'],['movie',100,'done'],['free',100,'withdrawn']]);
  send('score-delta','again',{group:'again',amount:60});
  assert.deepEqual(records(),[['movie',50,'pending'],['movie',100,'done'],['free',100,'pending']]);
  send('score-records','cancel',{records:[{id:movie.id,reached:movie.reached}],complete:false});
  assert.deepEqual(records(),[['movie',50,'pending'],['movie',100,'pending'],['free',100,'pending']]);
});

test('each group earns its own repeated milestones and automatic completion',()=>{
  const {score,send}=scenario();
  send('score-goals','goals',{base:null,goals:[
    {id:'team',type:'team',score:5,interval:5,message:'모둠 보상',automatic:true}
  ]});
  send('score-delta','team-a',{group:'team-a',amount:10,targets:['a']});
  send('score-delta','team-b',{group:'team-b',amount:5,targets:['b']});
  assert.deepEqual(score().records.map(({teamId,score,status})=>[teamId,score,status]),[
    ['a',5,'done'],['a',10,'done'],['b',5,'done']
  ]);
});

test('recurring goals optionally add previously reached milestones as silent records',()=>{
  const {score,send}=scenario();
  send('score-goals','goals',{base:null,includeExisting:true,goals:[
    {id:'class',type:'class',score:3,interval:3,message:'반복'}
  ]});
  assert.deepEqual(score().records.map(({score,silent})=>[score,silent]),[[3,true],[6,true],[9,true]]);
  assert.equal(nextClassGoal(score(),9)?.score,12);
});

test('next class goal counts every matching goal and uses the first message',()=>{
  const system={goals:[
    {id:'far',type:'class',score:150,message:'나중 목표'},
    {id:'repeat',type:'class',score:50,interval:50,message:'영화데이'},
    {id:'once',type:'class',score:100,message:'자유시간'},
    {id:'second',type:'class',score:100,message:'독서 시간'},
    {id:'team',type:'team',score:100,message:'모둠 보상'}
  ],records:[]};
  const next=nextClassGoal(system,75);
  assert.equal(next.score,100);
  assert.equal(next.message,'영화데이');
  assert.equal(next.additional,2);
});
