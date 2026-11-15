import {reorderPages} from './board-navigation.js';
import {normalizePattern} from './board-background.js';

// Firestore orders completed operations. The same reducer runs on each device
// and when replaying locally saved operations that are awaiting upload.
const copy = value => structuredClone(value);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
export const newBoard = () => ({ pages: {}, history: {}, revision: 0 });

export function pagePatch(before, after) {
  const oldObjects = before.canvas.objects;
  const newObjects = after.canvas.objects;
  const old = new Map(oldObjects.map(object => [object.id, object]));
  const next = new Map(newObjects.map(object => [object.id, object]));
  const objects = [];
  for (const [id, object] of next) if (!same(old.get(id), object)) objects.push([id, object]);
  for (const id of old.keys()) if (!next.has(id)) objects.push([id, null]);
  const oldOrder = [...old.keys()].filter(id => next.has(id));
  const newOrder = [...next.keys()].filter(id => old.has(id));
  // Carry order when objects are inserted or when existing objects move.
  const order = newObjects.some(object => !old.has(object.id)) || !same(oldOrder, newOrder)
    ? [...next.keys()] : null;
  const background = before.canvas.background === after.canvas.background ? null : after.canvas.background;
  const pattern = normalizePattern(after.canvas.wbBackgroundPattern);
  const patternChanged = !same(normalizePattern(before.canvas.wbBackgroundPattern), pattern);
  return objects.length || order || background !== null || patternChanged ? {objects, order, background, pattern:patternChanged ? pattern : null} : null;
}

function patchContent(content, patch) {
  const objects = new Map(content.canvas.objects.map(object => [object.id, object]));
  for (const [id, object] of patch.objects) {
    if (object) objects.set(id, object);
    else objects.delete(id);
  }
  if (patch.order) {
    const ranked = new Set(patch.order);
    const ordered = patch.order.filter(id => objects.has(id)).map(id => objects.get(id));
    let position = 0;
    // Keep objects added by a concurrent device in their current slots.
    content.canvas.objects = [...objects.values()].map(object => ranked.has(object.id) ? ordered[position++] : object);
  } else {
    content.canvas.objects = [...objects.values()];
  }
  if (content.canvas.objects.some(object=>object.wbPinned)) {
    const current=content.canvas.objects;
    content.canvas.objects=[...current.filter(object=>object.wbPinned),...current.filter(object=>!object.wbPinned)];
  }
  if (patch.background !== null) content.canvas.background = patch.background;
  if (patch.pattern) content.canvas.wbBackgroundPattern = normalizePattern(patch.pattern);
}

export function boardPages(board) {
  return Object.values(board.pages).filter(page => !page.deleted)
    .sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function applyOperation(board, operation, revision) {
  const {kind, pageId} = operation;
  board.revision = revision;
  if (kind === 'seed' || kind === 'add') {
    for (const page of operation.pages) {
      if (!Object.hasOwn(board.pages, page.id)) board.pages[page.id] = {...copy(page), version:revision};
    }
    return;
  }
  if(kind==='reorder'){
    reorderPages(boardPages(board),operation.order).forEach((page,index)=>{page.order=index;});
    return;
  }
  const page = board.pages[pageId];
  if (!page || page.deleted) return;
  if (kind === 'rename') {
    const title=pageTitle(operation.title);
    if(title!==null)page.title=title;
    return;
  }
  if (kind === 'delete') {
    if (boardPages(board).length <= 1) return;
    page.deleted = true;
    page.content = null;
    page.version = revision;
    delete board.history[pageId];
    return;
  }
  const history = board.history[pageId] ??= {undo:[], redo:[]};
  if (kind === 'undo' || kind === 'redo') {
    const from = history[kind];
    if (!from.length) return;
    const entry = from.pop();
    patchContent(page.content, kind === 'undo' ? entry.inverse : entry.forward);
    history[kind === 'undo' ? 'redo' : 'undo'].push(entry);
  } else if (kind === 'edit') {
    const before = copy(page.content);
    patchContent(page.content, operation.patch);
    const forward = pagePatch(before, page.content);
    if (!forward) return;
    history.undo.push({forward, inverse:pagePatch(page.content, before)});
    if (history.undo.length > 40) history.undo.shift();
    history.redo.length = 0;
  } else return;
  page.version = revision;
}

export function pageTitle(value) {
  return typeof value==='string' ? value.trim().slice(0,80) : null;
}

export function validView(view) {
  return typeof view?.pageId === 'string' && Number.isFinite(view.zoom) &&
    view.zoom >= .1 && view.zoom <= 10 && Number.isFinite(view.x) && Number.isFinite(view.y) &&
    (view.scoreShare===undefined || Number.isFinite(view.scoreShare) && view.scoreShare>=20 && view.scoreShare<=90) &&
    (view.scoreScale===undefined || Number.isFinite(view.scoreScale) && view.scoreScale>=60 && view.scoreScale<=150);
}

export function validViewState(value) {
  return typeof value?.enabled==='boolean' && typeof value.epoch==='string' &&
    (!value.enabled || validView(value)) && (value.scoreOpen===undefined || typeof value.scoreOpen==='boolean');
}
