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
  let anchor,best=0;
  for (const object of canvas.getObjects().slice().reverse()) {
    if (!object.id || object.wbAnswerCover || !object.visible) continue;
    const box=object.getBoundingRect(true,true);
    const width=Math.min(bounds.left+bounds.width,box.left+box.width)-Math.max(bounds.left,box.left);
    const height=Math.min(bounds.top+bounds.height,box.top+box.height)-Math.max(bounds.top,box.top);
    const area=Math.max(0,width)*Math.max(0,height);
    if (area>best) {best=area;anchor=object;}
  }
  return anchor;
}

export function wireAnswerCover(canvas,{allowed,changed,uid,mode,notify,isOpen,setOpen}) {
  const surface=canvas.upperCanvasEl;
  let armed=false,gesture=null;
  const overlay=document.createElement('div');
  overlay.className='cover-rectangle';overlay.hidden=true;document.body.append(overlay);
  function reset() {gesture=null;overlay.hidden=true;}
  function setArmed(value) {
    reset();
    armed=value;
    surface.classList.toggle('drawing-cover',value);
    document.getElementById('answerCoverTool').setAttribute('aria-pressed',String(value));
    if (value) notify('가릴 영역을 연속으로 드래그하세요. Esc로 종료합니다.');
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setArmed(false);});
  document.addEventListener('pointerdown',e=>{
    if (e.target!==surface) return;
    if (!allowed() || e.button!==0 || !e.isPrimary) return;
    const point=canvas.getPointer(e);
    let cover=null;
    if (!armed) {
      if (!['select','pen','marker'].includes(mode())) return;
      cover=answerCoverAt(canvas,e);
      if (!cover) return;
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
    if (!allowed()) return;
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
    if (gesture?.id!==e.pointerId) return;
    if (gesture.moved) {
      gesture.cover.set({left:gesture.left,top:gesture.top});
      gesture.cover.setCoords();canvas.requestRenderAll();
    }
    reset();
  },true);
  return {activate:()=>setArmed(true),toggle:()=>setArmed(!armed),deactivate:()=>{if (armed) setArmed(false);}};
}

export function keepCoversAboveAnchors(canvas) {
  const objects=canvas.getObjects();
  for (const cover of objects) {
    if (!cover.wbCoverAnchor) continue;
    const stack=canvas.getObjects();
    const index=stack.findIndex(obj=>obj.id===cover.wbCoverAnchor);
    if (index>stack.indexOf(cover)) canvas.moveTo(cover,index);
  }
}

export function wireCoverAnchors(canvas) {
  let movers=[];
  function follow() {
    for (const entry of movers) {
      const [, , , , x,y]=entry.anchor.calcTransformMatrix();
      for (const {cover,left,top} of entry.covers) {
        cover.set({left:left+x-entry.x,top:top+y-entry.y});
        cover.setCoords();
      }
    }
  }
  canvas.on('before:transform',({transform})=>{
    const selected=transform.target.type==='activeSelection'?transform.target.getObjects():[transform.target];
    const chosen=new Set(selected);
    movers=selected.filter(anchor=>anchor.id && !anchor.wbAnswerCover).map(anchor=>{
      const [, , , , x,y]=anchor.calcTransformMatrix();
      const covers=canvas.getObjects().filter(cover=>cover.wbCoverAnchor===anchor.id && !chosen.has(cover))
        .map(cover=>({cover,left:cover.left,top:cover.top}));
      return {anchor,x,y,covers};
    });
  });
  canvas.on('object:moving',follow);
  canvas.on('object:modified',({action})=>{
    if (action==='drag') follow();
    movers=[];
  });
}
