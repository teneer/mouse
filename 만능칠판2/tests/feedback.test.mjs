import test from 'node:test';
import assert from 'node:assert/strict';
import {makeStatusController,shouldClosePopups} from '../js/feedback.js';
function fakeClock() {
  let now=0, next=1;const queue=new Map();
  return {
    schedule(fn,delay){const id=next++;queue.set(id,{fn,at:now+delay});return id;},
    cancel(id){queue.delete(id);},
    advance(ms){const end=now+ms;while(true){const item=[...queue].sort((a,b)=>a[1].at-b[1].at).find(([,v])=>v.at<=end);if(!item)break;now=item[1].at;queue.delete(item[0]);item[1].fn();}now=end;}
  };
}
function fakeElement(){const classes=new Set();return {hidden:false,textContent:'불러오는 중입니다.',dataset:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}};}
test('all normal statuses, including cross-tab feedback, fade and hide',()=>{
  const clock=fakeClock(),element=fakeElement(),status=makeStatusController(element,clock.schedule,clock.cancel);
  for(const message of ['자동저장 완료','다른 탭의 변경을 반영했습니다.','저장 대기 중입니다.','자동저장 중입니다.']){
    status(message);assert.equal(element.hidden,false);clock.advance(3050);assert.equal(element.classList.contains('fade-out'),true);clock.advance(450);assert.equal(element.hidden,true);
  }
});
test('new status resets both prior timers',()=>{
  const clock=fakeClock(),element=fakeElement(),status=makeStatusController(element,clock.schedule,clock.cancel);
  status('자동저장 완료');clock.advance(3000);status('다른 탭의 변경을 반영했습니다.');clock.advance(500);assert.equal(element.hidden,false);assert.equal(element.classList.contains('fade-out'),false);clock.advance(3000);assert.equal(element.hidden,true);
});
test('error statuses also disappear after a longer dwell',()=>{
  const clock=fakeClock(),element=fakeElement(),status=makeStatusController(element,clock.schedule,clock.cancel);
  status('동기화 확인 실패','error');clock.advance(6050);assert.equal(element.hidden,false);clock.advance(450);assert.equal(element.hidden,true);
});
test('context menu pointerdown is internal; canvas pointerdown dismisses it',()=>{
  for(const selector of ['#objectContextMenu','.tip-up-settings','[data-popup]'])assert.equal(shouldClosePopups({closest:q=>q.includes(selector)?{}:null}),false);
  assert.equal(shouldClosePopups({closest:()=>null}),true);
});
