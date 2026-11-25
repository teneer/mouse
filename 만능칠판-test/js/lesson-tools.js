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
    render.call(this,ctx);
    if (!this.wbAnswerCover) return;
    const label=coverName(this);
    ctx.save();
    ctx.font='600 14px sans-serif';
    const left=-this.width/2, bottom=-this.height/2;
    const width=ctx.measureText(label).width+12;
    ctx.fillStyle='#375467';
    ctx.fillRect(left,bottom-21,width,20);
    ctx.fillStyle='#fff';
    ctx.textBaseline='middle';
    ctx.fillText(label,left+6,bottom-11);
    ctx.restore();
  };
}

export function answerCoverAt(canvas,event) {
  const point=canvas.getPointer(event);
  const top=canvas.getObjects().slice().reverse().find(obj=>obj.visible && obj.containsPoint(point,undefined,true,true));
  return top?.wbAnswerCover ? top : null;
}

export function wireAnswerCover(canvas,{allowed,changed,uid,mode,notify}) {
  const surface=canvas.upperCanvasEl;
  let armed=false,gesture=null;
  const overlay=document.createElement('div');
  overlay.className='cover-rectangle';overlay.hidden=true;document.body.append(overlay);
  function reset() {
    gesture=null;armed=false;overlay.hidden=true;
    surface.classList.remove('drawing-cover');
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  document.addEventListener('keydown',e=>{if(e.key==='Escape')reset();});
  document.addEventListener('pointerdown',e=>{
    if (e.target!==surface) {if (armed) reset();return;}
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
      if (!moved) cover.set({fill:cover.fill==='transparent'?'#375467':'transparent',strokeWidth:1});
    } else {
      if (Math.abs(e.clientX-x)<5 || Math.abs(e.clientY-y)<5) return;
      const end=canvas.getPointer(e);
      const names=new Set(canvas.getObjects().filter(obj=>obj.wbAnswerCover).map(coverName));
      let number=canvas.getObjects().filter(obj=>obj.wbAnswerCover).length+1;
      while(names.has(String(number))) number++;
      canvas.add(new fabric.Rect({id:uid(),wbAnswerCover:true,wbCoverName:String(number),left:Math.min(point.x,end.x),top:Math.min(point.y,end.y),
        width:Math.abs(end.x-point.x),height:Math.abs(end.y-point.y),fill:'#375467',stroke:'#86b0c7',strokeWidth:1}));
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
  return ()=>{armed=true;surface.classList.add('drawing-cover');notify('가릴 영역을 드래그하세요.');};
}
