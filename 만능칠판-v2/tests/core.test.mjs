import test from 'node:test';
import assert from 'node:assert/strict';
import {PageHistory} from '../history.js';
import {resolvePageWrite} from '../js/conflicts.js';
import {validateContent} from '../js/validation.js';
import {emptyContent} from '../js/constants.js';
const content=n=>({...emptyContent(),canvas:{objects:[],background:`#00000${n}`}});
const page={id:'a',name:'A',version:2,order:1,createdAt:1,content:content(1)};
test('history: undo/redo is page-specific',()=>{
 const h=new PageHistory();h.reset('a',content(1));h.push('a',content(2));h.reset('b',content(3));
 assert.deepEqual(h.step('a',-1),content(1));assert.equal(h.canUndo('b'),false);assert.deepEqual(h.step('a',1),content(2));
});
test('history: an edit after undo clears redo',()=>{
 const h=new PageHistory();h.reset('a',content(1));h.push('a',content(2));h.step('a',-1);h.push('a',content(3));assert.equal(h.canRedo('a'),false);
});
test('history: duplicate snapshots ignored',()=>{
 const h=new PageHistory();h.reset('a',content(1));h.push('a',content(1));assert.equal(h.pages.get('a').items.length,1);
});
test('history: item and memory bounds',()=>{
 const h=new PageHistory(3);h.reset('a',content(1));for(let n=2;n<=6;n++)h.push('a',content(n));assert.equal(h.pages.get('a').items.length,3);
 const m=new PageHistory(40,10);m.reset('a',content(1));m.push('a',content(2));assert.equal(m.pages.get('a').items.length,1);
});
test('save: matching revision increments version',()=>{
 const r=resolvePageWrite(page,{...page,content:content(2)},2,'new',100);
 assert.equal(r.conflict,false);assert.equal(r.page.version,3);assert.equal(r.page.id,'a');
});
test('save: concurrent same-page edit creates recovery page',()=>{
 const r=resolvePageWrite({...page,version:3},{...page,content:content(2)},2,'recovery',100);
 assert.equal(r.conflict,true);assert.equal(r.page.id,'recovery');assert.equal(r.page.version,1);assert.match(r.page.name,/충돌 복구/);assert.deepEqual(r.page.content,content(2));assert.equal(page.version,2);
});
test('save: identical concurrent content does not create duplicate',()=>{
 const r=resolvePageWrite({...page,version:3},page,2,'recovery',100);assert.equal(r.unchanged,true);assert.equal(r.page.version,3);
});
test('save: remote deletion preserves an unsaved local edit in a recovery page',()=>{
 const r=resolvePageWrite({...page,deleted:true,content:null,version:3},page,2,'recovery',100);assert.equal(r.conflict,true);assert.equal(r.page.deleted,false);
});
test('save: new page starts with version 1',()=>{
 const r=resolvePageWrite(undefined,{...page,version:0},0,'unused',100);assert.equal(r.page.version,1);assert.equal(r.conflict,false);
});
test('validation: keeps supported nested groups but removes obsolete metadata',()=>{
 const c=emptyContent();c.canvas.objects=[{type:'group',customLayer:'old',visible:false,objects:[{type:'rect',left:1,top:2}]}];
 const result=validateContent(c);assert.equal(result.canvas.objects[0].customLayer,undefined);assert.equal(result.canvas.objects[0].visible,true);assert.equal(c.canvas.objects[0].visible,false);
});
test('validation: rejects remote image URL and arbitrary Fabric class',()=>{
 const c=emptyContent();c.canvas.objects=[{type:'image',src:'https://example.com/image.png'}];assert.throws(()=>validateContent(c));
 c.canvas.objects=[{type:'script'}];assert.throws(()=>validateContent(c));
});
test('validation: rejects non-finite frame and malformed path',()=>{
 const c=emptyContent();c.frame.width=Infinity;assert.throws(()=>validateContent(c));
 const d=emptyContent();d.canvas.objects=[{type:'path',path:[['M',NaN,0]]}];assert.throws(()=>validateContent(d));
});
test('validation: strips method overrides and prototype keys',()=>{
 const c=emptyContent();c.canvas.objects=[JSON.parse('{"type":"rect","toObject":"evil","__proto__":{"bad":true}}')];
 const o=validateContent(c).canvas.objects[0];assert.equal(Object.hasOwn(o,'toObject'),false);assert.equal(Object.hasOwn(o,'__proto__'),false);
});
test('validation: embedded PNG remains accepted',()=>{
 const c=emptyContent();c.canvas.objects=[{type:'image',src:'data:image/png;base64,aGVsbG8='}];assert.equal(validateContent(c).canvas.objects[0].type,'image');
});
