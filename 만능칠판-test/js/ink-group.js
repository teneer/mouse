export const INK_PAUSE_MS = 650;

export function canJoinInk(group, stroke) {
  return !!group && stroke.startedAt-group.endedAt<=INK_PAUSE_MS &&
    stroke.mode===group.mode && stroke.color===group.color &&
    stroke.strokeWidth===group.strokeWidth;
}

export function inkSelectionMembers(objects,target) {
  if (target?.type!=='path' || !target.wbInkGroup || !target.selectable) return [];
  return objects.filter(object=>object.type==='path' && object.selectable && object.evented &&
    !object.wbPinned && object.wbInkGroup===target.wbInkGroup);
}

export function isInkSelection(objects) {
  const id=objects[0]?.wbInkGroup;
  return objects.length>1 && !!id && objects.every(object=>object.type==='path' && object.wbInkGroup===id);
}
