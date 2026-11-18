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
    press={tile,id:event.pointerId,x:event.clientX,y:event.clientY,active:false};
    press.timer=setTimeout(()=>{
      if (!press) return;
      press.active=true;
      list.setPointerCapture(press.id);
      press.tile.classList.add('reordering');
    },450);
  });
  list.addEventListener('pointermove',event=>{
    if (press?.id===event.pointerId && !press.active && Math.hypot(event.clientX-press.x,event.clientY-press.y)>8){
      clearTimeout(press.timer);
      press=null;
    }
  });
  for(const type of ['pointerup','pointercancel']) window.addEventListener(type,event=>{
    if (press?.id!==event.pointerId) return;
    const {tile,timer,active}=press;
    press=null;
    clearTimeout(timer);
    tile.classList.remove('reordering');
    if (!active) return;
    suppressClick=true;
    const target=type==='pointerup' && document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-page]');
    if (target && target!==tile && list.contains(target)) move(tile.dataset.page,target.dataset.page);
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

export function reorderPages(pages, ids) {
  const byId=new Map(pages.map(page=>[page.id,page]));
  const ordered=[];
  for(const id of ids) if(byId.has(id)) {
    ordered.push(byId.get(id));
    byId.delete(id);
  }
  return [...ordered,...byId.values()];
}
