import {MIN_ZOOM,MAX_ZOOM,uid} from './constants.js';
export class CanvasTools {
  constructor({canvas,canEdit,onChange,onViewport,onMode,onText}) {
    Object.assign(this,{canvas,canEdit,onChange,onViewport,onMode,onText});
    this.mode='select';this.pen={color:'#000000',width:5};this.marker={color:'#ffff00',width:30};
    this.text={color:'#000000',size:48};this.gesture=false;this.pan=null;this.erased=false;this.selectTarget=null;this.selectStart=null;this.selectMoved=false;
    const c=canvas;
    c.on('mouse:down:before',opt=>{
      if(!canEdit())return;
      if(opt.e.button===1 || this.mode==='move') {c.selection=false;c.skipTargetFind=true;}
    });
    c.on('mouse:down',opt=>this.down(opt));
    c.on('mouse:move',opt=>this.move(opt));
    c.on('mouse:up',()=>this.up());
    c.on('mouse:wheel',opt=>{
      opt.e.preventDefault();opt.e.stopPropagation();if(!canEdit() || this.gesture)return;
      this.zoom(c.getZoom()*Math.exp(-opt.e.deltaY*0.0015));
    });
    c.on('path:created',({path})=>{
      path.id=uid();if(this.mode==='marker')path.set({stroke:this.marker.color,opacity:0.32,isHighlighter:true});
      path.setCoords();c.requestRenderAll();onChange();
    });
    c.on('object:modified',()=>onChange());
    this.setMode('select');
  }
  pointer(e) {const p=e.touches?.[0] || e.changedTouches?.[0] || e;return {x:p.clientX,y:p.clientY};}
  setMode(mode) {
    this.mode=mode;const c=this.canvas;
    c.discardActiveObject();c.isDrawingMode=mode==='pen'||mode==='marker';c.selection=mode==='select';c.skipTargetFind=mode==='move';
    c.getObjects().forEach(o=>o.set({selectable:mode==='select',evented:true}));
    const cursors={
      pen:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2728%27 height=%2728%27 viewBox=%270 0 28 28%27%3E%3Cpath d=%27M3 23L18 8l5 5L8 28 3 23z%27 fill=%27%23444444%27/%3E%3Cpath d=%27M18 8l2-2 5 5-2 2z%27 fill=%27%23222222%27/%3E%3Cpath d=%27M3 23l-1 4 4-1z%27 fill=%27%23ffffff%27/%3E%3C/svg%3E") 3 23, crosshair',
      marker:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2732%27 height=%2732%27 viewBox=%270 0 32 32%27%3E%3Cpath d=%27M3 26L20 9l5 5L8 31 3 26z%27 fill=%27%23ffd92f%27 stroke=%27%23666666%27/%3E%3Cpath d=%27M20 9l3-3 5 5-3 3z%27 fill=%27%23ffef85%27 stroke=%27%23666666%27/%3E%3Cpath d=%27M3 26l-1 5 6-1z%27 fill=%27%23ffffff%27/%3E%3C/svg%3E") 3 26, crosshair',
      eraser:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2734%27 height=%2728%27 viewBox=%270 0 34 28%27%3E%3Cpath d=%27M5 18L17 6l12 12-6 6H11z%27 fill=%27%23f2a7bd%27 stroke=%27%23555555%27 stroke-width=%271.5%27/%3E%3Cpath d=%27M17 6l5 5-12 12H5z%27 fill=%27%23ffd3df%27/%3E%3Cpath d=%27M17 6l12 12-6 6-12-12z%27 fill=%27%23e888a6%27/%3E%3C/svg%3E") 17 14, crosshair'
    };
    c.defaultCursor=mode==='move'?'grab':mode==='text'?'text':mode==='pen'?cursors.pen:mode==='marker'?cursors.marker:mode==='eraser'?cursors.eraser:'default';
    c.hoverCursor=c.defaultCursor;
    c.perPixelTargetFind=mode==='eraser';c.targetFindTolerance=mode==='eraser'?6:0;
    if(c.isDrawingMode) {
      const settings=mode==='pen'?this.pen:this.marker;
      c.freeDrawingBrush=new fabric.PencilBrush(c);c.freeDrawingBrush.width=settings.width;
      c.freeDrawingBrush.color=mode==='marker'?new fabric.Color(settings.color).setAlpha(0.32).toRgba():settings.color;
    }
    c.requestRenderAll();this.onMode(mode);
  }
  updateBrush() {
    const mode=this.mode;if(mode==='pen'||mode==='marker') {
      const s=mode==='pen'?this.pen:this.marker;
      this.canvas.freeDrawingBrush.width=s.width;
      this.canvas.freeDrawingBrush.color=mode==='marker'?new fabric.Color(s.color).setAlpha(0.32).toRgba():s.color;
    }
  }
  down({e,target}) {
    if(!this.canEdit())return;
    this.gesture=true;const c=this.canvas;
    this.selectTarget=null;this.selectStart=null;this.selectMoved=false;
    if(this.mode==='select' && e.button===0 && target){this.selectTarget=target;this.selectStart=this.pointer(e);}
    if(this.mode==='move' || e.button===1) {this.pan=this.pointer(e);c.setCursor('grabbing');return;}
    if(e.button && e.button!==0)return;
    if(this.mode==='text') {this.onText(c.getPointer(e));return;}
    if(this.mode==='eraser') {
      this.erased=false;
      this.eraseAt(e);
    }
  }
  move({e}) {
    if(!this.gesture || !this.canEdit())return;
    const c=this.canvas;
    if(this.selectStart){const p=this.pointer(e);this.selectMoved=Math.hypot(p.x-this.selectStart.x,p.y-this.selectStart.y)>4;}
    if(this.pan) {
      const p=this.pointer(e),v=c.viewportTransform.slice();v[4]+=p.x-this.pan.x;v[5]+=p.y-this.pan.y;
      c.setViewportTransform(v);this.pan=p;this.onViewport();return;
    }
    if(this.mode==='eraser') this.eraseAt(e);
  }
  eraseAt(e) {
    const c=this.canvas;
    const zoom=Math.max(c.getZoom(),0.0001),size={w:30/zoom,h:22/zoom};
    const world=c.getPointer(e,true);
    const eraserRect={left:world.x-size.w/2,top:world.y-size.h/2,width:size.w,height:size.h};
    const targets=c.getObjects().slice().filter(o=>!o.excludeFromExport && o.visible!==false);
    const hit=targets.filter(o=>{
      const r=o.getBoundingRect(true,true);
      return r.left < eraserRect.left+eraserRect.width && r.left+r.width > eraserRect.left && r.top < eraserRect.top+eraserRect.height && r.top+r.height > eraserRect.top;
    });
    if(hit.length){hit.forEach(o=>c.remove(o));this.erased=true;c.requestRenderAll();}
  }
  up() {
    if(this.selectTarget && !this.selectMoved && this.mode==='select') {
      const c=this.canvas,before=c.getObjects().indexOf(this.selectTarget);
      c.bringToFront(this.selectTarget);this.selectTarget.setCoords();
      const after=c.getObjects().indexOf(this.selectTarget);
      if(after!==before)this.onChange();
    }
    this.selectTarget=null;this.selectStart=null;this.selectMoved=false;
    if(this.erased){this.erased=false;this.onChange();}
    if(this.pan){this.pan=null;this.canvas.setViewportTransform(this.canvas.viewportTransform.slice());this.canvas.selection=this.mode==='select';this.canvas.skipTargetFind=this.mode==='move';this.canvas.setCursor(this.mode==='move'?'grab':'default');this.onViewport();}
    this.gesture=false;
  }
  zoom(value) {
    const c=this.canvas,z=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,value));
    c.zoomToPoint(new fabric.Point(c.width/2,c.height/2),z);c.requestRenderAll();this.onViewport();
  }
  home(frame) {
    const c=this.canvas;c.setViewportTransform([1,0,0,1,c.width/2-frame.cx,c.height/2-frame.cy]);c.requestRenderAll();this.onViewport();
  }
}
