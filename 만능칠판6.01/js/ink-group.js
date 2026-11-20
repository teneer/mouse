export const INK_PAUSE_MS = 650;

const edges = ({left, top, width, height}) => ({
  left, top, right:left+width, bottom:top+height
});

export function canJoinInk(group, stroke) {
  if (!group || stroke.startedAt-group.endedAt > INK_PAUSE_MS ||
      stroke.mode!==group.mode || stroke.color!==group.color ||
      stroke.strokeWidth!==group.strokeWidth) return false;

  const a=group.bounds, b=edges(stroke.bounds);
  const height=Math.max(a.bottom-a.top,b.bottom-b.top,3*stroke.strokeWidth);
  const gap=Math.max(b.left-a.right,a.left-b.right,0);
  const verticalGap=Math.max(b.top-a.bottom,a.top-b.bottom,0);
  const combinedHeight=Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top);
  const maxGap=.25*height;

  // A nearby lower stroke can be a 받침. A new line generally extends the
  // combined height too far or starts outside the previous word's columns.
  return gap<=maxGap && verticalGap<=.18*height && combinedHeight<=1.44*height &&
    (gap===0 || verticalGap===0);
}

export function extendInk(group, stroke, id) {
  const b=edges(stroke.bounds);
  return {
    id, mode:stroke.mode, color:stroke.color, strokeWidth:stroke.strokeWidth, endedAt:stroke.endedAt,
    bounds:group ? {
      left:Math.min(group.bounds.left,b.left),top:Math.min(group.bounds.top,b.top),
      right:Math.max(group.bounds.right,b.right),bottom:Math.max(group.bounds.bottom,b.bottom)
    } : b
  };
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
