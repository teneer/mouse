import {MIN_ZOOM,MAX_ZOOM,uid} from './constants.js';
export class CanvasTools {
  constructor({canvas,canEdit,onChange,onViewport,onMode,onText}) {
    Object.assign(this,{canvas,canEdit,onChange,onViewport,onMode,onText});
    this.mode='select';this.pen={color:'#000000',width:5};this.marker={color:'#000000',width:30};
    this.text={color:'#000000',size:48};this.gesture=false;this.pan=null;this.erased=false;this.laserTrail=[];this.laserTimer=null;
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
    this.mode=mode;const c=this.canvas;this.clearLaser();
    c.discardActiveObject();c.isDrawingMode=mode==='pen'||mode==='marker';c.selection=mode==='select';c.skipTargetFind=mode==='move';
    c.getObjects().forEach(o=>o.set({selectable:mode==='select',evented:true}));
    const cursors={
      pen:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2728%27 height=%2728%27 viewBox=%270 0 28 28%27%3E%3Cpath d=%27M3 23L18 8l5 5L8 28 3 23z%27 fill=%27%23444444%27/%3E%3Cpath d=%27M18 8l2-2 5 5-2 2z%27 fill=%27%23222222%27/%3E%3Cpath d=%27M3 23l-1 4 4-1z%27 fill=%27%23ffffff%27/%3E%3C/svg%3E") 2 27, crosshair',
      marker:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2732%27 height=%2732%27 viewBox=%270 0 32 32%27%3E%3Cpath d=%27M3 26L20 9l5 5L8 31 3 26z%27 fill=%27%23ffd92f%27 stroke=%27%23666666%27/%3E%3Cpath d=%27M20 9l3-3 5 5-3 3z%27 fill=%27%23ffef85%27 stroke=%27%23666666%27/%3E%3Cpath d=%27M3 26l-1 5 6-1z%27 fill=%27%23ffffff%27/%3E%3C/svg%3E") 2 31, crosshair',
      eraser:'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2734%27 height=%2728%27 viewBox=%270 0 34 28%27%3E%3Cpath d=%27M5 18L17 6l12 12-6 6H11z%27 fill=%27%23f2a7bd%27 stroke=%27%23555555%27 stroke-width=%271.5%27/%3E%3Cpath d=%27M17 6l5 5-12 12H5z%27 fill=%27%23ffd3df%27/%3E%3Cpath d=%27M17 6l12 12-6 6-12-12z%27 fill=%27%23e888a6%27/%3E%3C/svg%3E") 17 14, crosshair'
    };
    const cursor=mode==='move'?'grab':mode==='text'?'text':mode==='pen'?cursors.pen:mode==='marker'?cursors.marker:mode==='eraser'?cursors.eraser:mode==='laser'?'crosshair':'default';
    c.defaultCursor=cursor;c.hoverCursor=cursor;c.freeDrawingCursor=cursor;
    if(c.upperCanvasEl)c.upperCanvasEl.style.cursor=cursor;
    if(c.lowerCanvasEl)c.lowerCanvasEl.style.cursor=cursor;
    c.perPixelTargetFind=mode==='eraser';c.targetFindTolerance=mode==='eraser'?12:0;
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
  clearLaser() {clearTimeout(this.laserTimer);this.laserTrail=[];if(this.canvas.contextTop)this.canvas.clearContext?.(this.canvas.contextTop);}
  laserAt(e) {
    const c=this.canvas,p=c.getPointer(e),now=Date.now();this.laserTrail.push({x:p.x,y:p.y,t:now});
    const draw=()=>{
      const ctx=c.contextTop;if(!ctx)return;c.clearContext(ctx);
      this.laserTrail=this.laserTrail.filter(q=>Date.now()-q.t<900);if(!this.laserTrail.length)return;
      ctx.save();ctx.transform(...c.viewportTransform);ctx.beginPath();this.laserTrail.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));
      ctx.strokeStyle='#ff3030';ctx.lineWidth=4/Math.max(c.getZoom(),0.1);ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
      const last=this.laserTrail.at(-1);ctx.beginPath();ctx.arc(last.x,last.y,6/Math.max(c.getZoom(),0.1),0,Math.PI*2);ctx.fillStyle='#ff3030';ctx.fill();ctx.restore();
      clearTimeout(this.laserTimer);this.laserTimer=setTimeout(draw,55);
    };draw();
  }
  down({e}) {
    if(!this.canEdit()||e.button===2)return;
    this.gesture=true;const c=this.canvas;
    if(this.mode==='move'||e.button===1){this.pan=this.pointer(e);c.setCursor('grabbing');return;}
    if(e.button&&e.button!==0){this.gesture=false;return;}
    if(this.mode==='text'){this.gesture=false;this.onText(c.getPointer(e));return;}
    if(this.mode==='eraser'){this.erased=false;this.eraseAt(e);}
    if(this.mode==='laser')this.laserAt(e);
  }
  move({e}) {
    if(!this.gesture||!this.canEdit())return;const c=this.canvas;
    if(this.pan){const p=this.pointer(e),v=c.viewportTransform.slice();v[4]+=p.x-this.pan.x;v[5]+=p.y-this.pan.y;c.setViewportTransform(v);this.pan=p;this.onViewport();return;}
    if(this.mode==='eraser')this.eraseAt(e);
    if(this.mode==='laser')this.laserAt(e);
  }
  eraseAt(e) {
    const c=this.canvas,half=12/Math.max(c.getZoom(),0.0001),p=c.getPointer(e);
    const rect={left:p.x-half,top:p.y-half,width:half*2,height:half*2};
    const hits=c.getObjects().slice().filter(o=>{
      if(o.excludeFromExport||o.visible===false)return false;
      const bounds=o.getBoundingRect(true,true);
      return bounds.left<rect.left+rect.width&&bounds.left+bounds.width>rect.left&&bounds.top<rect.top+rect.height&&bounds.top+bounds.height>rect.top;
    });
    if(hits.length){hits.forEach(o=>c.remove(o));this.erased=true;c.requestRenderAll();}
  }
  up() {
    if(this.erased){this.erased=false;this.onChange();}
    if(this.pan){this.pan=null;this.canvas.setViewportTransform(this.canvas.viewportTransform.slice());this.canvas.selection=this.mode==='select';this.canvas.skipTargetFind=this.mode==='move';this.canvas.setCursor(this.mode==='move'?'grab':'default');this.onViewport();}
    this.gesture=false;
  }
  zoom(value) {
    const c=this.canvas,z=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,value));
    const el=c.upperCanvasEl||c.lowerCanvasEl,rect=el?.getBoundingClientRect?.();
    const cw=typeof c.getWidth==='function'?c.getWidth():c.width,ch=typeof c.getHeight==='function'?c.getHeight():c.height;
    const sx=rect&&rect.width>0 ? rect.width/(cw||rect.width) : 1;
    const sy=rect&&rect.height>0 ? rect.height/(ch||rect.height) : 1;
    const center=new fabric.Point(rect ? (rect.width/2)/sx : cw/2, rect ? (rect.height/2)/sy : ch/2);
    c.zoomToPoint(center,z);c.requestRenderAll();this.onViewport();
  }
  home(frame) {
    const c=this.canvas;c.setViewportTransform([1,0,0,1,c.width/2-frame.cx,c.height/2-frame.cy]);c.requestRenderAll();this.onViewport();
  }
}
