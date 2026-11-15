// Callers pass the space left by the buttons and their gaps.
export function fitScoreFont(preferred, available, textWidth) {
  if (textWidth<=available || textWidth<=0) return preferred;
  return Math.max(1,Math.floor(preferred*Math.max(0,available)/textWidth));
}

export function scoreRemainder(total, rate) {
  return ((total % rate) + rate) % rate;
}

// Yield one class point for each crossed boundary, including negative totals.
export function* conversionSteps(oldTotal,newTotal,rate) {
  const direction=Math.sign(newTotal-oldTotal);
  let total=oldTotal;
  const nextBoundary=()=>Math.floor(total/rate)*rate+(direction>0?rate:-1);
  const crosses=boundary=>direction>0?boundary<=newTotal:boundary>=newTotal;
  if(!direction)return;
  for(let boundary=nextBoundary();crosses(boundary);boundary=nextBoundary()){
    yield {from:scoreRemainder(total,rate),to:direction>0?rate:0,delta:direction,rest:scoreRemainder(boundary,rate)};
    total=boundary;
  }
  if(total!==newTotal)yield {from:scoreRemainder(total,rate),to:scoreRemainder(newTotal,rate),delta:0};
}
