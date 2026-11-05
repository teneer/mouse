import {MIN_ZOOM,MAX_ZOOM,uid} from './constants.js';
export class CanvasTools {
  constructor({canvas,canEdit,onChange,onViewport,onMode,onText}) {
    Object.assign(this,{canvas,canEdit,onChange,onViewport,onMode,onText});
    this.mode='select';this.pen={color:'#000000',width:5};this.marker={color:'#ffff00',width:30};
    this.text={color:'#000000',size:48};this.eraser='object';this.gesture=false;this.pan=null;this.area=null;this.erased=false;
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
      const p=c.getPointer(opt.e,true);this.zoom(c.getZoom()*Math.exp(-opt.e.deltaY*0.0015),p);
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
    c.defaultCursor=mode==='move'?'grab':mode==='text'?'text':mode.startsWith('eraser')?'crosshair':'default';
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
  down({e}) {
    if(!this.canEdit())return;
    this.gesture=true;const c=this.canvas;
    if(this.mode==='move' || e.button===1) {this.pan=this.pointer(e);c.setCursor('grabbing');return;}
    if(e.button && e.button!==0)return;
    if(this.mode==='text') {this.onText(c.getPointer(e));return;}
    if(this.mode==='eraser') {
      this.erased=false;
      if(this.eraser==='area') {
        this.areaStart=c.getPointer(e);this.area=new fabric.Rect({left:this.areaStart.x,top:this.areaStart.y,width:0,height:0,
          fill:'rgba(37,99,235,0.10)',stroke:'#2563eb',strokeWidth:1/c.getZoom(),strokeDashArray:[5,5],selectable:false,evented:false,excludeFromExport:true});
        c.add(this.area);
      } else this.eraseAt(e);
    }
  }
  move({e}) {
    if(!this.gesture || !this.canEdit())return;
    const c=this.canvas;
    if(this.pan) {
      const p=this.pointer(e),v=c.viewportTransform.slice();v[4]+=p.x-this.pan.x;v[5]+=p.y-this.pan.y;
      c.setViewportTransform(v);this.pan=p;this.onViewport();return;
    }
    if(this.mode==='eraser') {
      if(this.area) {
        const p=c.getPointer(e),a=this.areaStart;
        this.area.set({left:Math.min(p.x,a.x),top:Math.min(p.y,a.y),width:Math.abs(p.x-a.x),height:Math.abs(p.y-a.y)});this.area.setCoords();c.requestRenderAll();
      } else this.eraseAt(e);
    }
  }
  eraseAt(e) {
    const target=this.canvas.findTarget(e,true);
    if(target && !target.excludeFromExport) {this.canvas.remove(target);this.erased=true;this.canvas.requestRenderAll();}
  }
  up() {
    if(this.area) {
      const c=this.canvas,a=this.area.getBoundingRect(true,true);c.remove(this.area);this.area=null;
      if(a.width>2/c.getZoom() && a.height>2/c.getZoom())c.getObjects().slice().forEach(o=>{
        const b=o.getBoundingRect(true,true);
        if(b.left<=a.left+a.width && b.left+b.width>=a.left && b.top<=a.top+a.height && b.top+b.height>=a.top){c.remove(o);this.erased=true;}
      });
      c.requestRenderAll();
    }
    if(this.erased){this.erased=false;this.onChange();}
    if(this.pan){this.pan=null;this.canvas.setViewportTransform(this.canvas.viewportTransform.slice());this.canvas.selection=this.mode==='select';this.canvas.skipTargetFind=this.mode==='move';this.canvas.setCursor(this.mode==='move'?'grab':'default');this.onViewport();}
    this.gesture=false;
  }
  zoom(value,point) {
    const c=this.canvas,z=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,value));
    c.zoomToPoint(new fabric.Point(point?.x??c.width/2,point?.y??c.height/2),z);c.requestRenderAll();this.onViewport();
  }
  home(frame) {
    const c=this.canvas;c.setViewportTransform([1,0,0,1,c.width/2-frame.cx,c.height/2-frame.cy]);c.requestRenderAll();this.onViewport();
  }
}
