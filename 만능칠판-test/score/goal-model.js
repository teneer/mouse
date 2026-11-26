const MAX_GOAL_SCORE = 10000;
const clone = value => structuredClone(value);
export const freshGoals = () => ({goals:[],records:[],revision:null});
export function dropRemovedGoalRecords(system) {
  const ids=new Set(system.goals.map(goal=>goal.id));
  system.records=system.records.filter(record=>ids.has(record.goalId));
}

export function readGoals(value) {
  const system=value?clone(value):freshGoals();
  dropRemovedGoalRecords(system);
  return system;
}

export function parseGoalScore(value) {
  const number = value.trim().normalize('NFKC').replace(/^−/,'-');
  if (!/^[+-]?\d+$/.test(number)) return null;
  const score = Number(number);
  return score>=-MAX_GOAL_SCORE && score<=MAX_GOAL_SCORE ? score : null;
}

export function goalAppliesToTeam(goal,teamId) {
  return goal.type==='team' && (!Array.isArray(goal.teamIds) || goal.teamIds.includes(teamId));
}

function targets(state, goal) {
  if (goal.archived) return [];
  return goal.type === 'class' ? [{id:null,score:state.count}] : state.teams.filter(team=>goalAppliesToTeam(goal,team.id));
}
const recordId = (goal, teamId, milestone) => JSON.stringify(
  milestone === undefined ? [goal.id,teamId] : [goal.id,teamId,milestone]
);

export function parseGoalInterval(value) {
  const interval = parseGoalScore(value);
  return interval > 0 ? interval : null;
}

export function makeGoalRounds(goals,source,settings,records,makeId) {
  const {start,interval,count}=settings;
  const group=source.repeat?.id??makeId();
  const members=source.repeat?goals.filter(goal=>goal.repeat?.id===group):[source];
  const indexed=new Map(members.map(goal=>[goal.repeat?.index??0,goal]));
  const completed=new Set(records.filter(record=>record.status==='done').map(record=>record.goalId));
  const retained=new Set();
  const generated=Array.from({length:count},(_,index)=>{
    const score=start+interval*index;
    const previous=indexed.get(index);
    const reuse=previous && !previous.interval && (!completed.has(previous.id) || previous.score===score);
    if (reuse)retained.add(previous.id);
    const {message,automatic,teamIds}=settings;
    return {id:reuse?previous.id:makeId(),type:source.type,score,message,automatic,futureAutomatic:true,
      ...(source.type==='team' && Array.isArray(teamIds)?{teamIds:[...teamIds]}:{}),
      repeat:{id:group,index,start,interval,count}};
  });
  const removed=members.filter(goal=>!retained.has(goal.id));
  const archived=removed.filter(goal=>completed.has(goal.id)).map(({repeat,...goal})=>({...goal,archived:true,futureAutomatic:true}));
  const memberIds=new Set(members.map(goal=>goal.id));
  return {goals:[...goals.filter(goal=>!memberIds.has(goal.id)),...generated,...archived],
    selected:generated.find(goal=>goal.repeat.index===source.repeat?.index)??generated[0],
    removed:removed.length-archived.length,archived:archived.length};
}

function intervalOf(goal) {
  return Number.isSafeInteger(goal.interval) && goal.interval > 0 ? goal.interval : null;
}

function firstMilestoneAfter(goal, count, interval) {
  if (count < goal.score) return goal.score;
  return goal.score + (Math.floor((count-goal.score)/interval)+1)*interval;
}

function nextGoal(system, count, type, teamId) {
  const completed = new Set(system.records
    .filter(record => record.teamId === teamId && record.status === 'done')
    .map(record => record.id));
  let next = null;
  for (const goal of system.goals) {
    if (goal.archived || goal.type !== type || type==='team' && !goalAppliesToTeam(goal,teamId)) continue;
    const interval = intervalOf(goal);
    let score = goal.score;
    if (interval) {
      score = firstMilestoneAfter(goal,count,interval);
      while (score <= MAX_GOAL_SCORE && completed.has(recordId(goal,teamId,score))) score += interval;
    } else if (score <= count || completed.has(recordId(goal,teamId))) continue;
    if (score > MAX_GOAL_SCORE) continue;
    if (next === null || score < next.score) next = {...goal,score,additional:0};
    else if (score === next.score) next.additional++;
  }
  return next;
}
export const nextClassGoal = (system, count) => nextGoal(system,count,'class',null);
export const nextTeamGoal = (system, team) => nextGoal(system,team.score,'team',team.id);

export function goalStatus(goal, score, record) {
  if (record?.status==='done') return 'done';
  return score>=goal.score?'reached':'unreached';
}

function newRecord(goal, team, milestone) {
  return {
    id:recordId(goal,team.id,milestone),goalId:goal.id,teamId:team.id,type:goal.type,score:milestone??goal.score,message:goal.message,
    ...(milestone === undefined ? {} : {milestone}),
    teamName:team.name||null,achievedScore:team.score,automatic:goal.automatic
  };
}

// Repair automatic goals saved after their threshold was reached in older versions.
export function completeReachedAutomaticGoals(state, event) {
  const system=state.goalSystem;
  if (!system) return;
  const seen=new Set(system.records.map(record=>record.id));
  for (const goal of system.goals) {
    if (!goal.automatic || goal.futureAutomatic || goal.archived || intervalOf(goal)) continue;
    for (const team of targets(state,goal)) {
      const id=recordId(goal,team.id);
      if (team.score<goal.score || seen.has(id)) continue;
      system.records.push({...newRecord(goal,team),status:'done',silent:true,
        reached:event?.key||'automatic:'+id,time:event?.authoredAt??null});
      seen.add(id);
    }
  }
}

export function reconcileGoals(state, before, event, includeExisting = false) {
  const system = state.goalSystem;
  if (!system) return;
  const previousScores = new Map(before.teams.map(team=>[team.id,team.score]));
  previousScores.set(null,before.count);
  const records = new Map(system.records.map(record=>[record.id,record]));
  const goals = new Map(system.goals.map(goal=>[goal.id,goal]));
  const liveTeams = new Map(state.teams.map(team=>[team.id,team.score]));
  liveTeams.set(null,state.count);
  for (const record of records.values()) {
    const goal=goals.get(record.goalId);
    if (record.status === 'pending' && (!goal || goal.archived ||
      record.teamId!==null && !goalAppliesToTeam(goal,record.teamId) ||
      !liveTeams.has(record.teamId) || liveTeams.get(record.teamId)<record.score)) {
      record.status = 'withdrawn';
    }
  }
  for (const goal of system.goals) {
    const interval = intervalOf(goal);
    for (const team of targets(state,goal)) {
      const previous = includeExisting ? -Infinity : previousScores.get(team.id) ?? -Infinity;
      if (!interval) {
        const record = records.get(recordId(goal,team.id));
        const threshold = goal.futureAutomatic ? goal.score : record?.score ?? goal.score;
        if (team.score >= threshold && previous < threshold) grant(goal,team);
        continue;
      }
      const last = Math.min(team.score,MAX_GOAL_SCORE);
      for (let milestone = firstMilestoneAfter(goal,previous,interval); milestone <= last; milestone += interval) {
        grant(goal,team,milestone);
      }
    }
  }

  function grant(goal, team, milestone) {
    const id = recordId(goal,team.id,milestone);
    const record = records.get(id);
    if (record && record.status !== 'withdrawn') return;
    const entry = record || newRecord(goal,team,milestone);
    if (goal.futureAutomatic) {
      entry.score=milestone??goal.score;
      entry.message=goal.message;
    }
    entry.achievedScore = team.score;
    entry.automatic = goal.automatic;
    entry.status = entry.automatic ? 'done' : 'pending';
    entry.reached = event.key;
    entry.time = event.authoredAt;
    entry.silent = includeExisting;
    if (!record) {system.records.push(entry);records.set(id,entry);}
  }
}

function updateConfiguredRecords(state,operation) {
  const system=state.goalSystem;
  const goals=new Map(system.goals.map(goal=>[goal.id,goal]));
  const teams=new Map(state.teams.map(team=>[team.id,team]));
  teams.set(null,{id:null,score:state.count});
  const existing=new Map(system.records.map(record=>[record.id,record]));
  for (const record of existing.values()) {
    const goal=goals.get(record.goalId);
    if (!goal?.futureAutomatic || record.status==='done') continue;
    const team=teams.get(record.teamId), threshold=record.milestone??goal.score;
    if (goal.archived || !team || record.teamId!==null && !goalAppliesToTeam(goal,record.teamId) || team.score<threshold) {
      record.status='withdrawn';
    } else if (record.status==='pending') {
      record.score=threshold;
      record.message=goal.message;
    }
  }
  // A goal already at its threshold enters the queue silently. Only a score crossing auto-completes it.
  for (const goal of system.goals) {
    if (!goal.futureAutomatic || intervalOf(goal)) continue;
    for (const team of targets(state,goal)) {
      if (team.score<goal.score) continue;
      const id=recordId(goal,team.id), record=existing.get(id);
      if (record && record.status!=='withdrawn') continue;
      const entry={...newRecord(goal,team),automatic:false,status:'pending',silent:true,
        reached:operation.key,time:operation.authoredAt??null};
      if (record) Object.assign(record,entry);
      else system.records.push(entry);
    }
  }
}

export function changeGoals(state, operation) {
  const system = state.goalSystem ??= freshGoals();
  if (operation.kind==='score-activity') {
    const {slot,value,base}=operation;
    if (!['classPursuit','teamPursuit'].includes(slot) || (system[slot]?.revision??null)!==base) return false;
    if (!value) return false;
    if (typeof value.enabled!=='boolean' || !Number.isSafeInteger(value.score) || Math.abs(value.score)>10000 ||
        !Number.isSafeInteger(value.day) || !Number.isSafeInteger(value.step) || value.step<1 || value.step>10000 ||
        !Number.isInteger(value.weekday) || value.weekday<0 || value.weekday>6 ||
        !['daily','weekly','manual'].includes(value.mode) || typeof value.message!=='string' || value.message.length>180) return false;
    system[slot]={...clone(value),revision:operation.key};
    return true;
  }
  if (operation.kind === 'score-goals') {
    if (operation.base !== system.revision) return false;
    const oldIds = new Set(system.goals.map(goal=>goal.id));
    system.goals = clone(operation.goals);
    dropRemovedGoalRecords(system);
    system.revision = operation.key;
    if (operation.includeExisting) {
      const selected = system.goals;
      system.goals = selected.filter(goal=>!oldIds.has(goal.id) && !goal.futureAutomatic);
      reconcileGoals(state,state,operation,true);
      system.goals = selected;
    }
    updateConfiguredRecords(state,operation);
    completeReachedAutomaticGoals(state,operation);
    return true;
  }
  completeReachedAutomaticGoals(state);
  const selection = new Map(operation.records.map(record=>[record.id,record.reached]));
  let updated = false;
  for (const record of system.records) {
    if (selection.get(record.id)!==record.reached) continue;
    const goal=system.goals.find(item=>item.id===record.goalId);
    if (goal?.archived || goal?.futureAutomatic && goal.automatic) continue;
    const team=goal && targets(state,goal).find(item=>item.id===record.teamId);
    const threshold = record.milestone ?? goal?.score;
    if (operation.complete && record.status!=='done' && team && team.score>=threshold) {
      if (record.status==='withdrawn') Object.assign(record,{score:threshold,achievedScore:team.score,silent:true});
      record.status='done';updated=true;
    } else if (!operation.complete && record.status==='done' && (!goal?.futureAutomatic || team && team.score>=threshold)) {
      const score = record.teamId===null ? state.count : state.teams.find(team=>team.id===record.teamId)?.score;
      if (goal) record.score=threshold;
      record.status = score>=record.score ? 'pending' : 'withdrawn';
      updated=true;
    }
  }
  if (operation.complete) for (const target of operation.records) {
    if (target.reached!==null || system.records.some(record=>record.id===target.id)) continue;
    const goal=system.goals.find(item=>item.id===target.goalId);
    const team=goal && targets(state,goal).find(item=>item.id===target.teamId);
    if (!team || goal.futureAutomatic && goal.automatic || intervalOf(goal) || team.score<goal.score || target.id!==recordId(goal,team.id)) continue;
    system.records.push({...newRecord(goal,team),status:'done',silent:true,reached:operation.key,time:operation.authoredAt??null});
    updated=true;
  }
  return updated;
}
