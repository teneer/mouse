import test from 'node:test';
import assert from 'node:assert/strict';
import {canJoinInk,INK_PAUSE_MS} from '../js/ink-group.js';
import {validateContent} from '../js/validation.js';
import {pagePatch} from '../js/cloud-model.js';

const id='01234567-89ab-cdef-0123-456789abcdef';
test('continuing to write keeps the same group until a pause or a tool change',()=>{
  const group={mode:'pen',color:'#000',strokeWidth:3,endedAt:60};
  const stroke={...group,startedAt:60+INK_PAUSE_MS};
  assert.equal(canJoinInk(group,stroke),true);
  assert.equal(canJoinInk(group,{...stroke,startedAt:stroke.startedAt+1}),false);
  assert.equal(canJoinInk(group,{...stroke,mode:'marker'}),false);
  assert.equal(canJoinInk(group,{...stroke,color:'#f00'}),false);
});
test('ink group IDs survive backup validation and cloud patches',()=>{
  const frame={width:1280,height:720,cx:0,cy:0};
  const empty={canvas:{objects:[],background:'#fff'},frame};
  const path={id:'stroke',type:'path',path:[['M',0,0],['L',10,10]],wbInkGroup:id};
  const content=validateContent({...empty,canvas:{...empty.canvas,objects:[path]}});
  assert.equal(content.canvas.objects[0].wbInkGroup,id);
  assert.equal(pagePatch(empty,content).objects[0][1].wbInkGroup,id);
});
