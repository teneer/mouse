import test from 'node:test';
import assert from 'node:assert/strict';
import {schoolDay,pursuitScore} from '../score/class-activities.js';
import {changeGoals,freshGoals} from '../score/goal-model.js';

test('daily pursuit crosses Korean midnight once and catches up after reopening',()=>{
  const day=schoolDay(Date.parse('2026-11-25T23:59:59+09:00'));
  const tomorrow=schoolDay(Date.parse('2026-11-26T00:00:00+09:00'));
  const rule={day,score:10,step:2,mode:'daily'};
  assert.equal(pursuitScore(rule,day),10);
  assert.equal(pursuitScore(rule,tomorrow),12);
  assert.equal(pursuitScore(rule,tomorrow),12);
  assert.equal(pursuitScore(rule,day+5),20);
  assert.equal(pursuitScore({...rule,mode:'manual'},day+5),10);
});

test('weekly pursuit advances only on the chosen weekday after editing',()=>{
  const day=schoolDay(Date.parse('2026-11-25T09:00:00+09:00')); // Wednesday
  const rule={day,score:4,step:3,mode:'weekly',weekday:1};
  assert.equal(pursuitScore(rule,day+4),4);
  assert.equal(pursuitScore(rule,day+5),7);
  assert.equal(pursuitScore(rule,day+19),13);
  assert.equal(pursuitScore({...rule,weekday:3},day+6),4);
});

test('team and class rules have separate revisions and stale edits are rejected',()=>{
  const state={goalSystem:freshGoals()};
  const value={day:1,score:4,enabled:true,mode:'manual',weekday:1,step:2,message:'오늘 청소'};
  const edit={kind:'score-activity',slot:'classPursuit',base:null,key:'a',value};
  assert.equal(changeGoals(state,edit),true);
  assert.equal(changeGoals(state,{...edit,key:'stale'}),false);
  assert.equal(changeGoals(state,{...edit,slot:'teamPursuit',key:'b'}),true);
  assert.equal(state.goalSystem.classPursuit.message,'오늘 청소');
});
