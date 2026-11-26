import {MIN_ZOOM,MAX_ZOOM} from './constants.js';

export function boardTouchTransform({zoom,worldX,worldY,distance},centerX,centerY,currentDistance) {
  const scale=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom*currentDistance/distance));
  return [scale,0,0,scale,centerX-worldX*scale,centerY-worldY*scale];
}

export function wireBoardTouch(canvas,{canStart,canHold,cancelSingle,onPinch,onContext,onEnd}) {
  const surface=canvas.upperCanvasEl;
  const fingers=new Map();
  let press,held=false,pinching=false,baseline;
  function clearPress() {
    clearTimeout(press?.timer);
    press=null;
  }
  function measure() {
    const [a,b]=fingers.values();
    const rect=surface.getBoundingClientRect();
    return {
      x:((a.clientX+b.clientX)/2-rect.left)*canvas.width/rect.width,
      y:((a.clientY+b.clientY)/2-rect.top)*canvas.height/rect.height,
      distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))
    };
  }
  function rebase() {
    const {x,y,distance}=measure();
    const [zoom,,,,left,top]=canvas.viewportTransform;
    baseline={zoom,worldX:(x-left)/zoom,worldY:(y-top)/zoom,distance};
  }
  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  document.addEventListener('pointerdown',event=>{
    if (event.pointerType!=='touch' || event.target!==surface) return;
    if (!fingers.size && !canStart()) return;
    fingers.set(event.pointerId,event);
    if (fingers.size===1) {
      held=false;
      if (canHold()) {
        press={x:event.clientX,y:event.clientY,timer:setTimeout(()=>{
          if (!press || fingers.size!==1 || !canHold()) return;
          clearPress();
          held=true;
          cancelSingle(event);
          onContext(event);
        },600)};
      }
      return;
    }
    stop(event);
    clearPress();
    if (pinching || held) return;
    const first=fingers.values().next().value;
    pinching=true;
    cancelSingle(first);
    onPinch(true);
    rebase();
  },{capture:true,passive:false});
  document.addEventListener('pointermove',event=>{
    if (!fingers.has(event.pointerId)) return;
    fingers.set(event.pointerId,event);
    if (press && Math.hypot(event.clientX-press.x,event.clientY-press.y)>9) clearPress();
    if (!pinching && !held) return;
    stop(event);
    if (!pinching || fingers.size<2) return;
    const {x,y,distance}=measure();
    canvas.setViewportTransform(boardTouchTransform(baseline,x,y,distance));
    canvas.requestRenderAll();
  },{capture:true,passive:false});
  function end(event) {
    if (!fingers.delete(event.pointerId)) return;
    clearPress();
    if (held || pinching) stop(event);
    if (pinching && fingers.size>=2) rebase();
    if (fingers.size!==0) return;
    if (pinching) onPinch(false);
    if (held || pinching) onEnd();
    held=false;pinching=false;
  }
  for (const type of ['pointerup','pointercancel']) document.addEventListener(type,end,{capture:true,passive:false});
}
