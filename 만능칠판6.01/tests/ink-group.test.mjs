import test from 'node:test';
import assert from 'node:assert/strict';
import {canJoinInk,extendInk,INK_PAUSE_MS} from '../js/ink-group.js';
import {validateContent} from '../js/validation.js';
import {pagePatch} from '../js/cloud-model.js';

const id='01234567-89ab-cdef-0123-456789abcdef';
function stroke(left,top,width,height,startedAt=100){
  return {bounds:{left,top,width,height},mode:'pen',color:'#000',strokeWidth:3,startedAt,endedAt:startedAt+60};
}

test('close letters and a lower final stroke extend the same ink group',()=>{
  const first=extendInk(null,stroke(0,0,25,30,0),id);
  const lower=stroke(5,28,15,10);
  assert.equal(canJoinInk(first,lower),true);
  const letter=extendInk(first,lower,id);
  assert.equal(canJoinInk(letter,stroke(29,0,20,30,200)),true);
});

test('a word gap, new writing line or pause starts a new group',()=>{
  const first=extendInk(null,stroke(0,0,47,30,0),id);
  assert.equal(canJoinInk(first,stroke(58,0,20,30)),false);
  assert.equal(canJoinInk(first,stroke(0,31,20,28)),false);
  assert.equal(canJoinInk(first,stroke(48,0,20,30,61+INK_PAUSE_MS)),false);
  assert.equal(canJoinInk(first,{...stroke(48,0,20,30),mode:'marker'}),false);
});

test('ink group IDs survive backup validation and cloud patches',()=>{
  const frame={width:1280,height:720,cx:0,cy:0};
  const empty={canvas:{objects:[],background:'#fff'},frame};
  const path={id:'stroke',type:'path',path:[['M',0,0],['L',10,10]],wbInkGroup:id};
  const content=validateContent({...empty,canvas:{...empty.canvas,objects:[path]}});
  assert.equal(content.canvas.objects[0].wbInkGroup,id);
  assert.equal(pagePatch(empty,content).objects[0][1].wbInkGroup,id);
});
