import {loadCanvas} from './previews.js';

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
      const top=canvas.getObjects().slice().reverse().find(obj=>obj.visible && obj.containsPoint(point,undefined,true,true));
      if (!top?.wbAnswerCover) return;
      // The interior stays writable when the answer is visible; tap its outline to cover it again.
      if (!top.opacity || top.fill==='transparent') {
        const local=top.toLocalPoint(new fabric.Point(point.x,point.y),'left','top');
        const margin=8/canvas.getZoom();
        if (Math.min(local.x,local.y,top.getScaledWidth()-local.x,top.getScaledHeight()-local.y)>margin) return;
      }
      cover=top;
    }
    stop(e);surface.setPointerCapture(e.pointerId);
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,point,cover};
  },true);
  document.addEventListener('pointermove',e=>{
    if (gesture?.id!==e.pointerId) return;
    stop(e);
    if (!armed) return;
    overlay.hidden=false;
    Object.assign(overlay.style,{left:Math.min(e.clientX,gesture.x)+'px',top:Math.min(e.clientY,gesture.y)+'px',
      width:Math.abs(e.clientX-gesture.x)+'px',height:Math.abs(e.clientY-gesture.y)+'px'});
  },true);
  document.addEventListener('pointerup',e=>{
    if (gesture?.id!==e.pointerId) return;
    stop(e);
    const {cover,point,x,y}=gesture;
    reset();
    if (!allowed()) return;
    if (cover) {
      if (Math.hypot(x-e.clientX,y-e.clientY)>8) return;
      cover.set('fill',cover.fill==='transparent'?'#375467':'transparent');
    } else {
      if (Math.abs(e.clientX-x)<5 || Math.abs(e.clientY-y)<5) return;
      const end=canvas.getPointer(e);
      canvas.add(new fabric.Rect({id:uid(),wbAnswerCover:true,left:Math.min(point.x,end.x),top:Math.min(point.y,end.y),
        width:Math.abs(end.x-point.x),height:Math.abs(end.y-point.y),fill:'#375467',stroke:'#86b0c7',strokeWidth:2}));
    }
    canvas.requestRenderAll();changed();
  },true);
  document.addEventListener('pointercancel',e=>{if (gesture?.id===e.pointerId) reset();},true);
  return ()=>{armed=true;surface.classList.add('drawing-cover');notify('가릴 영역을 드래그하세요.');};
}

export function wireLessonPreview({board,settle,send}) {
  const dialog=document.getElementById('lesson-preview'),surface=dialog.querySelector('canvas');
  let preview,pageId,ratio,start,version=0;
  const sendButton=dialog.querySelector('[data-send]');
  const draw=()=>preview.requestRenderAll();
  const zoom=factor=>{
    const value=Math.min(10*ratio,Math.max(.1*ratio,preview.getZoom()*factor));
    preview.zoomToPoint(new fabric.Point(preview.width/2,preview.height/2),value);draw();
  };
  dialog.querySelector('[data-minus]').onclick=()=>zoom(1/1.2);
  dialog.querySelector('[data-plus]').onclick=()=>zoom(1.2);
  dialog.querySelector('[data-close-preview]').onclick=()=>dialog.close();
  surface.onpointerdown=e=>{surface.setPointerCapture(e.pointerId);start=[e.clientX,e.clientY];};
  surface.onpointermove=e=>{
    if (!start || !preview) return;
    const scale=preview.width/surface.getBoundingClientRect().width;
    preview.relativePan(new fabric.Point((e.clientX-start[0])*scale,(e.clientY-start[1])*scale));
    start=[e.clientX,e.clientY];draw();
  };
  surface.onpointerup=surface.onpointercancel=()=>{start=null;};
  sendButton.onclick=()=>{
    const view=preview.viewportTransform.map(n=>n/ratio);
    dialog.close();send(pageId,view);
  };
  dialog.onclose=()=>{version++;start=null;preview?.dispose();preview=null;};
  return async (page,view)=>{
    const current=++version;
    pageId=page.id;sendButton.disabled=true;
    dialog.showModal();
    const width=Math.max(1,Math.min(840,innerWidth-50,(innerHeight*.65)*board.width/board.height));
    ratio=width/board.width;
    preview=new fabric.StaticCanvas(surface,{width,height:board.height*ratio,enableRetinaScaling:false});
    const canvas=preview;
    try {
      await loadCanvas(canvas,page.content.canvas);
      if (current!==version) return;
      const frame=page.content.frame;
      const origin=view||[1,0,0,1,board.width/2-frame.cx,board.height/2-frame.cy];
      canvas.setViewportTransform(origin.map(n=>n*ratio));await settle(canvas);
      if (current===version) {draw();sendButton.disabled=false;}
    } catch(error) {if(current===version){dialog.close();throw error;}}
  };
}
