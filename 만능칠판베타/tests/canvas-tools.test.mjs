import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasTools} from '../js/canvas-tools.js';
class Rect {
 constructor(options){Object.assign(this,options);}
 set(options){Object.assign(this,options);return this;}
 setCoords(){}
 getBoundingRect(){return {left:this.left,top:this.top,width:this.width,height:this.height};}
}
globalThis.fabric={
 Point:class{constructor(x,y){this.x=x;this.y=y;}},Rect,
 PencilBrush:class{constructor(c){this.canvas=c;}},
 Color:class{constructor(color){this.color=color;}setAlpha(a){this.alpha=a;return this;}toRgba(){return `${this.color}:${this.alpha}`;}}
};
function fixture() {
 let changes=0,views=0,textPoint=null,editable=true;
 const c={width:1280,height:720,viewportTransform:[1,0,0,1,0,0],objects:[],events:{},
 on(name,fn){this.events[name]=fn;},getObjects(){return this.objects;},discardActiveObject(){},
 requestRenderAll(){},setCursor(s){this.cursor=s;},getZoom(){return this.viewportTransform[0];},
 zoomToPoint(p,z){this.zoomPoint=p;this.viewportTransform[0]=this.viewportTransform[3]=z;},
 setViewportTransform(v){this.viewportTransform=v;},getPointer(e){return {x:e.clientX,y:e.clientY};},
 add(o){this.objects.push(o);},remove(o){this.objects=this.objects.filter(x=>x!==o);},findTarget(){return this.hit;}
 };
 const t=new CanvasTools({canvas:c,canEdit:()=>editable,onChange:()=>changes++,onViewport:()=>views++,onMode:()=>{},onText:p=>textPoint=p});
 return {c,t,changes:()=>changes,views:()=>views,text:()=>textPoint,block:()=>editable=false};
}
test('zoom clamps to 10% and 1000%',()=>{
 const {c,t}=fixture();t.zoom(100);assert.equal(c.getZoom(),10);t.zoom(0.001);assert.equal(c.getZoom(),0.1);
});
test('home restores 100% at the fixed document center',()=>{
 const {c,t}=fixture();t.home({cx:2400,cy:1600});assert.deepEqual(c.viewportTransform,[1,0,0,1,-1760,-1240]);
});
test('move mode disables selection and enables panning',()=>{
 const {c,t}=fixture();t.setMode('move');t.down({e:{clientX:5,clientY:6,button:0}});t.move({e:{clientX:15,clientY:26}});t.up();
 assert.equal(c.selection,false);assert.deepEqual(c.viewportTransform,[1,0,0,1,10,20]);assert.equal(t.gesture,false);
});
test('pen and marker use separate settings and transparent marker',()=>{
 const {c,t}=fixture();t.pen.width=5;t.marker.width=30;t.setMode('pen');assert.equal(c.freeDrawingBrush.width,5);
 t.setMode('marker');assert.equal(c.freeDrawingBrush.width,30);assert.match(c.freeDrawingBrush.color,/:0.32$/);
});
test('object erase is one history edit per gesture',()=>{
 const f=fixture(),obj=new Rect({left:0,top:0,width:10,height:10});f.c.objects=[obj];f.t.setMode('eraser');f.c.hit=obj;
 f.t.down({e:{clientX:0,clientY:0,button:0}});f.t.up();assert.equal(f.c.objects.length,0);assert.equal(f.changes(),1);
});
test('eraser is object-only and repeated hits in one gesture save once',()=>{
 const f=fixture(),a=new Rect({left:10,top:10,width:10,height:10}),b=new Rect({left:100,top:100,width:10,height:10});
 f.c.objects=[a,b];f.t.setMode('eraser');f.c.hit=a;
 f.t.down({e:{clientX:10,clientY:10,button:0}});f.t.move({e:{clientX:11,clientY:11}});f.t.up();
 assert.deepEqual(f.c.objects,[b]);assert.equal(f.changes(),1);assert.equal('eraser' in f.t,false);
});
test('locked editor ignores pointer input',()=>{
 const f=fixture();f.t.setMode('move');f.block();f.t.down({e:{clientX:0,clientY:0,button:0}});assert.equal(f.t.gesture,false);
});
test('text mode passes world pointer position to the editor',()=>{
 const f=fixture();f.t.setMode('text');f.t.down({e:{clientX:12,clientY:34,button:0}});assert.deepEqual(f.text(),{x:12,y:34});
});
