// Callers pass the space left by the buttons and their gaps.
export function fitScoreFont(preferred, available, textWidth) {
  if (textWidth<=available || textWidth<=0) return preferred;
  return Math.max(1,Math.floor(preferred*Math.max(0,available)/textWidth));
}

export function scoreRemainder(total, rate) {
  return ((total % rate) + rate) % rate;
}

// Combine input that arrives during the animation without delaying its score changes.
export function mergeConversions(previous, next) {
  if (!previous || previous.rate!==next.rate) return next;
  return {...next, oldTotal:previous.oldTotal, amount:previous.amount+next.amount,
    classDiff:previous.classDiff+next.classDiff};
}
