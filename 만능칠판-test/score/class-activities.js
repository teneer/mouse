const dayMs=86400000;
export const schoolDay=(time=Date.now())=>Math.floor((time+9*3600000)/dayMs);
export function pursuitScore(rule,day=schoolDay()) {
  if (!rule) return 0;
  const elapsed=Math.max(0,day-rule.day);
  let periods=0;
  if (rule.mode==='daily') periods=elapsed;
  if (rule.mode==='weekly') {
    const first=(rule.weekday-(rule.day+4)%7+7)%7 || 7;
    periods=elapsed<first?0:1+Math.floor((elapsed-first)/7);
  }
  return Math.min(10000,rule.score+periods*rule.step);
}
