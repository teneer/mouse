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

export function createPursuitMonitor() {
  let classCaught=false, teamsCaught=new Set();
  return ({count,teams,goalSystem},day=schoolDay())=>{
    const classRule=goalSystem?.classPursuit,teamRule=goalSystem?.teamPursuit;
    const nextClass=!!classRule?.enabled && count<=pursuitScore(classRule,day);
    const teamLimit=pursuitScore(teamRule,day);
    const nextTeams=teamRule?.enabled?teams.filter(team=>team.score<=teamLimit):[];
    const caughtTeams=nextTeams.filter(team=>!teamsCaught.has(team.id));
    const warnings=[];
    if(nextClass && !classCaught)warnings.push({target:'학급',message:classRule.message});
    if(caughtTeams.length)warnings.push({target:caughtTeams.map(team=>team.name).join(' · '),message:teamRule.message});
    classCaught=nextClass;
    teamsCaught=new Set(nextTeams.map(team=>team.id));
    return warnings;
  };
}
