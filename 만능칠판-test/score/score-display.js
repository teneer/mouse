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

export function conversionStarFlight(bar,score,index,segments,decrease) {
  const scoreCenter={
    x:score.width?score.left+score.width/2:bar.left+bar.width/2,
    y:score.height?score.top+score.height/2:bar.top-24
  };
  if (decrease) {
    const spread=Math.min(64,bar.width*.3);
    const x=spread*(segments===1 ? 0.35 : 2*index/(segments-1)-1);
    const y=-Math.min(88,Math.max(22,scoreCenter.y-8));
    return {from:scoreCenter,points:[
      {at:0,x:0,y:0,scale:1,opacity:1},
      {at:.22,x:0,y:-5,scale:1.15,opacity:1},
      {at:1,x,y,scale:.5,opacity:0}
    ]};
  }
  const from={x:bar.left+bar.width*(index+.5)/segments,y:bar.top+bar.height/2-6};
  const x=scoreCenter.x-from.x,y=scoreCenter.y-from.y;
  return {from,points:[
    {at:0,x:0,y:0,scale:1,opacity:1},
    {at:.32,x:x*.13,y:y*.13-4,scale:1.18,opacity:1},
    {at:.65,x:x*.55,y:y*.55-12,scale:1,opacity:1},
    {at:1,x,y,scale:.62,opacity:1}
  ]};
}

export function conversionStarPosition(points,progress) {
  const time=Math.min(1,Math.max(0,progress));
  const index=points.findIndex((point,i)=>i>0 && point.at>=time);
  const from=points[index-1],to=points[index];
  const fraction=(time-from.at)/(to.at-from.at);
  const mix=key=>from[key]+(to[key]-from[key])*fraction;
  return {x:mix('x'),y:mix('y'),scale:mix('scale'),opacity:mix('opacity')};
}
