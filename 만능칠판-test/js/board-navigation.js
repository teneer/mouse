export function wireToolbarDrag(toolbar, onDrag) {
  let start, dragged = false;
  toolbar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    dragged = false;
    start = toolbar.scrollWidth > toolbar.clientWidth
      ? {id:event.pointerId,x:event.clientX,left:toolbar.scrollLeft} : null;
  });
  window.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    const delta=event.clientX-start.x;
    if (!dragged && Math.abs(delta)<7) return;
    if (!dragged) {
      dragged=true;
      if(!toolbar.hasPointerCapture(event.pointerId))toolbar.setPointerCapture(event.pointerId);
      onDrag();
    }
    toolbar.scrollLeft=start.left-delta;
  });
  for (const type of ['pointerup','pointercancel']) window.addEventListener(type,event=>{
    if (event.pointerId===start?.id) start=null;
  });
  toolbar.addEventListener('click',event=>{
    if (!dragged || !event.detail) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dragged=false;
  },true);
  toolbar.addEventListener('wheel',event=>{
    if (toolbar.scrollWidth<=toolbar.clientWidth || !event.deltaY || event.deltaX) return;
    event.preventDefault();
    toolbar.scrollLeft+=event.deltaY;
  },{passive:false});
}

export function wirePageReorder(list, move) {
  let press, suppressClick=false;
  list.addEventListener('pointerdown',event=>{
    const tile=event.target.closest('[data-page]');
    if (!tile || event.button!==0 || !event.isPrimary) {suppressClick=false;return;}
    suppressClick=false;
    press={tile,id:event.pointerId,x:event.clientX,y:event.clientY,active:false,touch:event.pointerType==='touch'};
    if (press.touch) press.timer=setTimeout(activate,450);
  });
  function activate() {
    if (!press) return;
    press.active=true;
    list.setPointerCapture(press.id);
    press.tile.classList.add('reordering');
  }
  function dropTarget(event) {
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.page-tile-wrap');
    const tile=target?.querySelector('[data-page]');
    if (!tile || !list.contains(tile)) return null;
    const rect=tile.getBoundingClientRect();
    return {tile,after:event.clientX>=rect.left+rect.width/2};
  }
  function clearDrop() {
    list.querySelector('.page-drop-before,.page-drop-after')?.classList.remove('page-drop-before','page-drop-after');
  }
  list.addEventListener('lostpointercapture',event=>{
    if (press?.id!==event.pointerId) return;
    press.tile.classList.remove('reordering');
    press=null;clearDrop();
  });
  list.addEventListener('pointermove',event=>{
    if (press?.id!==event.pointerId) return;
    if (!press.active && Math.hypot(event.clientX-press.x,event.clientY-press.y)>8) {
      if (press.touch) {clearTimeout(press.timer);press=null;return;}
      activate();
    }
    if (!press?.active) return;
    clearDrop();
    const target=dropTarget(event);
    if (target && target.tile!==press.tile) {
      target.tile.parentElement.classList.add(target.after?'page-drop-after':'page-drop-before');
    }
    const rect=list.getBoundingClientRect();
    if (event.clientY<rect.top+20) list.scrollTop-=14;
    else if (event.clientY>rect.bottom-20) list.scrollTop+=14;
  });
  for(const type of ['pointerup','pointercancel']) window.addEventListener(type,event=>{
    if (press?.id!==event.pointerId) return;
    const {tile,timer,active}=press;
    press=null;
    clearTimeout(timer);
    tile.classList.remove('reordering');
    if (!active) return;
    suppressClick=true;
    clearDrop();
    const target=type==='pointerup' && dropTarget(event);
    if (target && target.tile!==tile) move(tile.dataset.page,target.tile.dataset.page,target.after);
  });
  list.addEventListener('click',event=>{
    if (!suppressClick || !event.detail) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);
}

export function movePageId(ids, source, target) {
  const from=ids.indexOf(source), to=ids.indexOf(target);
  if (from<0 || to<0 || from===to) return ids;
  const ordered=ids.slice();
  ordered.splice(from,1);
  ordered.splice(to,0,source);
  return ordered;
}

export function movePageSelection(ids,selected,target,after) {
  if (!ids.includes(target) || selected.has(target)) return ids;
  const moving=ids.filter(id=>selected.has(id));
  if (!moving.length) return ids;
  const rest=ids.filter(id=>!selected.has(id));
  rest.splice(rest.indexOf(target)+Number(after),0,...moving);
  return rest.every((id,index)=>id===ids[index])?ids:rest;
}

export function reorderPages(pages, ids) {
  const byId=new Map(pages.map(page=>[page.id,page]));
  const ordered=[];
  for(const id of ids) if(byId.has(id)) {
    ordered.push(byId.get(id));
    byId.delete(id);
  }
  return [...ordered,...byId.values()];
}
