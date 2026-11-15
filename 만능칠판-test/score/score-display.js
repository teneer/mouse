// Callers pass the space left by the buttons and their gaps.
export function fitScoreFont(preferred, available, textWidth) {
  if (textWidth<=available || textWidth<=0) return preferred;
  return Math.max(1,Math.floor(preferred*Math.max(0,available)/textWidth));
}

export function scoreRemainder(total, rate) {
  return ((total % rate) + rate) % rate;
}

// Consecutive changes can share a visual conversion when their totals join
// and their direction and conversion rate match.
export function mergeTeamEffects(first,next) {
  if(!next || first.rate!==next.rate || first.newTotal!==next.oldTotal ||
    Math.sign(first.newTotal-first.oldTotal)!==Math.sign(next.newTotal-next.oldTotal))return null;
  return {...first,newTotal:next.newTotal};
}

export function conversionFrame(oldTotal,newTotal,rate) {
  const from=scoreRemainder(oldTotal,rate);
  const rest=scoreRemainder(newTotal,rate);
  const delta=Math.floor(newTotal/rate)-Math.floor(oldTotal/rate);
  return {from,to:delta>0?rate:delta<0?0:rest,delta,rest};
}
