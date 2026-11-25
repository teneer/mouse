export function coverName(cover) {
  return cover.wbCoverName || String((cover.canvas?.getObjects().filter(item=>item.wbAnswerCover).indexOf(cover)??-1)+1 || 1);
}

export function installAnswerCoverDrawing(Rect) {
  const render=Rect.prototype._render;
  const shouldCache=Rect.prototype.shouldCache;
  Rect.prototype.shouldCache=function(){
    return this.wbAnswerCover ? (this.ownCaching=false) : shouldCache.call(this);
  };
  Rect.prototype._render=function(ctx){
    if (!this.wbAnswerCover) {render.call(this,ctx);return;}
    const original=this.fill;
    const open=this.wbCoverOpen ?? original==='transparent';
    this.fill=open?'transparent':'#375467';
    try {render.call(this,ctx);} finally {this.fill=original;}
    if (open) return;
    const size=Math.min(18,this.height*.65,this.width*.55);
    ctx.save();
    ctx.font='600 '+size+'px sans-serif';
    ctx.fillStyle='#fff';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(coverName(this),0,0,this.width*.85);
    ctx.restore();
  };
}

export function answerCoverAt(canvas,event) {
  const point=canvas.getPointer(event);
  const top=canvas.getObjects().slice().reverse().find(obj=>obj.visible && obj.containsPoint(point,undefined,true,true));
  return top?.wbAnswerCover ? top : null;
}

function findCoverAnchor(canvas,bounds) {
  const scratch=document.createElement('canvas');
  const ctx=scratch.getContext('2d',{willReadFrequently:true});
  for (const object of canvas.getObjects().slice().reverse()) {
    if (!object.id || object.wbAnswerCover || object.wbPinned || !object.visible || object.opacity===0) continue;
    const box=object.shadow?bounds:object.getBoundingRect(true,true);
    const left=Math.max(bounds.left,box.left),top=Math.max(bounds.top,box.top);
    const width=Math.min(bounds.left+bounds.width,box.left+box.width)-left;
    const height=Math.min(bounds.top+bounds.height,box.top+box.height)-top;
    if (width<=0 || height<=0) continue;

    // Render one object at a time so transparent areas do not hide the layers below.
    const scale=Math.min(2,2048/Math.max(width,height));
    scratch.width=Math.max(1,Math.ceil(width*scale));
    scratch.height=Math.max(1,Math.ceil(height*scale));
    ctx.setTransform(scale,0,0,scale,-left*scale,-top*scale);
    ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();
    const selectionBackground=object.selectionBackgroundColor;
    try {
      object.selectionBackgroundColor='';
      object.render(ctx);
    } finally {object.selectionBackgroundColor=selectionBackground;}
    try {
      const {data}=ctx.getImageData(0,0,scratch.width,scratch.height);
      for (let alpha=3;alpha<data.length;alpha+=4) {
        if (data[alpha]>0) return object;
      }
    } catch (error) {
      if (error.name!=='SecurityError') throw error;
    }
  }
  return null;
}

export function wireAnswerCover(canvas,{allowed,changed,uid,mode,notify,isOpen,setOpen,onGestureEnd}) {
  const surface=canvas.upperCanvasEl;
  let armed=false,gesture=null;
  const overlay=document.createElement('div');
  overlay.className='cover-rectangle';overlay.hidden=true;document.body.append(overlay);
  function reset() {gesture=null;overlay.hidden=true;}
  function cancelGesture() {
    if (!gesture) return;
    const {cover,left,top,moved}=gesture;
    if (moved) {
      cover.set({left,top});
      cover.setCoords();canvas.requestRenderAll();
    }
    reset();onGestureEnd();
  }
  function setArmed(value) {
    cancelGesture();
    armed=value;
    surface.classList.toggle('drawing-cover',value);
    document.getElementById('answerCoverTool').setAttribute('aria-pressed',String(value));
    if (value) notify('가릴 영역을 연속으로 드래그하세요. Esc로 종료합니다.');
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setArmed(false);});
  document.addEventListener('pointerdown',e=>{
    if (e.target!==surface) return;
    if (!allowed() || e.button!==0 || !e.isPrimary || gesture) return;
    if (!armed && mode()==='select' && canvas.getActiveObject()?._findTargetCorner(canvas.getPointer(e,true),e.pointerType==='touch')) return;
    const point=canvas.getPointer(e);
    let cover=null;
    if (!armed) {
      if (!['select','pen','marker'].includes(mode())) return;
      cover=answerCoverAt(canvas,e);
      if (!cover || e.shiftKey && mode()==='select') return;
    }
    stop(e);surface.setPointerCapture(e.pointerId);
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,point,cover,left:cover?.left,top:cover?.top};
  },true);
  document.addEventListener('pointermove',e=>{
    if (gesture?.id!==e.pointerId) return;
    stop(e);
    const {cover,point,x,y}=gesture;
    if (cover) {
      if (!gesture.moved && Math.hypot(e.clientX-x,e.clientY-y)<5) return;
      if (!gesture.moved) {
        canvas.discardActiveObject();
        canvas.setActiveObject(cover);
        gesture.moved=true;
      }
      const next=canvas.getPointer(e);
      cover.set({left:gesture.left+next.x-point.x,top:gesture.top+next.y-point.y});
      cover.setCoords();canvas.requestRenderAll();
      return;
    }
    overlay.hidden=false;
    Object.assign(overlay.style,{left:Math.min(e.clientX,gesture.x)+'px',top:Math.min(e.clientY,gesture.y)+'px',
      width:Math.abs(e.clientX-gesture.x)+'px',height:Math.abs(e.clientY-gesture.y)+'px'});
  },true);
  document.addEventListener('pointerup',e=>{
    if (gesture?.id!==e.pointerId) return;
    stop(e);
    const {cover,point,x,y,moved}=gesture;
    reset();
    queueMicrotask(onGestureEnd);
    if (!allowed()) return;
    if (cover && !canvas.getObjects().includes(cover)) return;
    if (cover) {
      if (!moved) {setOpen([cover],!isOpen(cover));return;}
      cover.set('wbCoverAnchor',findCoverAnchor(canvas,cover.getBoundingRect(true,true))?.id);
    } else {
      if (Math.abs(e.clientX-x)<5 || Math.abs(e.clientY-y)<5) return;
      const end=canvas.getPointer(e);
      const names=new Set(canvas.getObjects().filter(obj=>obj.wbAnswerCover).map(coverName));
      let number=canvas.getObjects().filter(obj=>obj.wbAnswerCover).length+1;
      while(names.has(String(number))) number++;
      const left=Math.min(point.x,end.x), top=Math.min(point.y,end.y);
      const width=Math.abs(end.x-point.x), height=Math.abs(end.y-point.y);
      const anchor=findCoverAnchor(canvas,{left,top,width,height});
      canvas.add(new fabric.Rect({id:uid(),wbAnswerCover:true,wbCoverName:String(number),wbCoverAnchor:anchor?.id,
        left,top,width,height,fill:'#375467',stroke:'#86b0c7',strokeWidth:1}));
    }
    canvas.requestRenderAll();changed();
  },true);
  document.addEventListener('pointercancel',e=>{
    if (gesture?.id===e.pointerId) cancelGesture();
  },true);
  return {get dragging(){return !!gesture;},activate:()=>setArmed(true),toggle:()=>setArmed(!armed),deactivate:()=>{if (armed) setArmed(false);}};
}

export function keepCoversAboveAnchors(canvas) {
  const objects=canvas.getObjects();
  for (const cover of objects) {
    if (!cover.wbCoverAnchor) continue;
    const stack=canvas.getObjects();
    const index=stack.findIndex(obj=>obj.id===cover.wbCoverAnchor && !obj.wbPinned);
    if (index<0) continue;
    if (index>stack.indexOf(cover)) canvas.moveTo(cover,index);
  }
}

export function wireCoverAnchors(canvas) {
  const util=fabric.util;
  let movers=[], passive=[], normalizing=false;
  function follow() {
    for (const {anchor,inverse,covers} of movers) {
      const delta=util.multiplyTransformMatrices(anchor.calcTransformMatrix(),inverse);
      for (const {cover,matrix} of covers) {
        util.applyTransformToObject(cover,util.multiplyTransformMatrices(delta,matrix));
        cover.setCoords();
      }
    }
  }
  canvas.on('before:transform',({transform})=>{
    const selected=transform.target.type==='activeSelection'?transform.target.getObjects():[transform.target];
    const chosen=new Set(selected);
    movers=selected.filter(anchor=>anchor.id && !anchor.wbAnswerCover && !anchor.wbPinned).map(anchor=>({
      anchor,inverse:util.invertTransform(anchor.calcTransformMatrix()),
      covers:canvas.getObjects().filter(cover=>cover.wbCoverAnchor===anchor.id && !chosen.has(cover))
        .map(cover=>({cover,matrix:cover.calcTransformMatrix()}))
    }));
  });
  for (const event of ['object:moving','object:scaling','object:rotating','object:skewing']) canvas.on(event,follow);
  canvas.on('object:modified',()=>{follow();movers=[];});
  canvas.on('mouse:up',()=>{movers=[];});

  function setSelection(objects) {
    normalizing=true;
    try {
      canvas.discardActiveObject();
      if (objects.length) canvas.setActiveObject(objects.length===1?objects[0]:new fabric.ActiveSelection(objects,{canvas}));
    } finally {normalizing=false;}
    canvas.requestRenderAll();
  }
  function reconcileSelection(event) {
    if (normalizing) return;
    const active=canvas.getActiveObject();
    const deselected=new Set((event.deselected||[]).map(object=>object.id));
    queueMicrotask(()=>{
      if (active!==canvas.getActiveObject()) return;
      const selected=canvas.getActiveObjects(),ids=new Set(selected.map(object=>object.id));
      const attached=selected.filter(cover=>cover.wbAnswerCover && ids.has(cover.wbCoverAnchor));
      const promoted=event.e?.shiftKey ? passive.filter(cover=>deselected.has(cover.wbCoverAnchor)) : [];
      passive=[...new Set([...passive.filter(cover=>ids.has(cover.wbCoverAnchor)),...attached])];
      if (!attached.length && !promoted.length) return;
      setSelection([...new Set([...selected.filter(object=>!attached.includes(object)),...promoted])]);
    });
  }
  for (const event of ['selection:created','selection:updated','selection:cleared']) canvas.on(event,reconcileSelection);
  canvas.upperCanvasEl.addEventListener('pointerdown',event=>{
    const active=canvas.getActiveObject();
    if (!event.shiftKey || !active || active.type==='activeSelection' || event.button!==0) return;
    const target=passive.filter(cover=>cover.wbCoverAnchor===active.id && canvas.getObjects().includes(cover));
    if (!target.length || !active.containsPoint(canvas.getPointer(event),undefined,true,true)) return;
    event.preventDefault();event.stopImmediatePropagation();
    passive=[];
    setSelection(target);
  },true);
  canvas.on('after:render',({ctx})=>{
    const ids=new Set(canvas.getActiveObjects().map(object=>object.id));
    ctx.save();
    ctx.strokeStyle='#3380a5';ctx.lineWidth=1;
    for (const cover of passive) {
      if (!ids.has(cover.wbCoverAnchor) || !canvas.getObjects().includes(cover)) continue;
      const corners=cover.getCoords(true,true).map(point=>util.transformPoint(point,canvas.viewportTransform));
      ctx.beginPath();
      corners.forEach(({x,y},index)=>index?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.closePath();ctx.stroke();
    }
    ctx.restore();
  });
}
