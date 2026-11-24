import test from 'node:test';
import assert from 'node:assert/strict';
import {celebrationSections,createGoalCelebrationQueue} from '../score/goal-celebration.js';

const record = (id,reached,goalId,score,teamId=null) => ({
  id,reached,goalId,score,teamId,type:teamId===null?'class':'team',status:'pending'
});
const index = records => new Map(records.map(row=>[row.id,row]));
const ids = group => group.map(row=>row.id);

test('one input groups matching team rounds into sections and queues separate inputs',()=>{
  let sounds=0;
  const queue=createGoalCelebrationQueue(()=>sounds++);
  const entries=[
    record('a20','batch','repeat',20,'a'),record('a10','batch','repeat',10,'a'),
    record('other','batch','other-goal',10,'a'),record('b10','batch','repeat',10,'b'),
    record('class','next','class-goal',30),
  ];
  const current=index(entries);
  queue.enqueue(entries,new Map());
  const batch=queue.take(current);
  assert.deepEqual(ids(batch),['a20','a10','other','b10']);
  const sections=celebrationSections(batch,[],()=>null);
  assert.deepEqual(sections.map(section=>[section.score,section.names.length]),[[10,2],[10,1],[20,1]]);
  assert.equal(queue.hasPending(current),true);
  assert.equal(sounds,1);
  assert.deepEqual(ids(queue.take(current)),['class']);
  assert.equal(sounds,2);
  assert.equal(queue.hasPending(current),false);
});

test('skipping clears pending popups without affecting the recorded achievements',()=>{
  let sounds=0;
  const queue=createGoalCelebrationQueue(()=>sounds++);
  const entries=[record('one','batch','goal',10),record('two','batch','goal',20)];
  const current=index(entries);
  queue.enqueue(entries,new Map());
  queue.take(current);
  queue.clear();
  assert.deepEqual(queue.take(current),[]);
  assert.equal(queue.hasPending(current),false);
  assert.equal(current.get('two').status,'pending');
  assert.equal(sounds,1);
});

test('withdrawn or deleted goals are skipped when checking and advancing the queue',()=>{
  const queue=createGoalCelebrationQueue(()=>assert.fail('no celebration expected'));
  const entries=[record('one','batch','goal',10),record('two','batch','goal',20)];
  queue.enqueue(entries,new Map());
  const current=index([{...entries[1],status:'withdrawn'}]);
  assert.equal(queue.hasPending(current),false);
  assert.deepEqual(queue.take(current),[]);
});

test('a mixed achievement plays one class sound and lists the class first',()=>{
  const sounds=[],queue=createGoalCelebrationQueue(type=>sounds.push(type));
  const entries=[record('a','batch','team',10,'a'),record('b','batch','class',100)];
  queue.enqueue(entries,new Map());
  const sections=celebrationSections(queue.take(index(entries)),[{id:'a',name:'Blue'}],()=>null);
  assert.deepEqual(sections.map(s=>s.type),['class','team']);
  assert.deepEqual(sections[1].names,['Blue']);
  assert.deepEqual(sounds,['class']);
});
