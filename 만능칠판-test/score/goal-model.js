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

function targets(state, goal) {
  return goal.type === 'class' ? [{id:null,score:state.count}] : state.teams;
}
const recordId = (goal, teamId, milestone) => JSON.stringify(
  milestone === undefined ? [goal.id,teamId] : [goal.id,teamId,milestone]
);

export function parseGoalInterval(value) {
  const interval = parseGoalScore(value);
  return interval > 0 ? interval : null;
}

function intervalOf(goal) {
  return Number.isSafeInteger(goal.interval) && goal.interval > 0 ? goal.interval : null;
}

function firstMilestoneAfter(goal, count, interval) {
  if (count < goal.score) return goal.score;
  return goal.score + (Math.floor((count-goal.score)/interval)+1)*interval;
}

export function nextClassGoal(system, count) {
  const completed = new Set(system.records
    .filter(record => record.teamId === null && record.status === 'done')
    .map(record => record.id));
  let next = null;
  for (const goal of system.goals) {
    if (goal.type !== 'class') continue;
    const interval = intervalOf(goal);
    let score = goal.score;
    if (interval) {
      score = firstMilestoneAfter(goal,count,interval);
      while (score <= MAX_GOAL_SCORE && completed.has(recordId(goal,null,score))) score += interval;
    } else if (score <= count || completed.has(recordId(goal,null))) continue;
    if (score <= MAX_GOAL_SCORE && (next === null || score < next.score)) next = {...goal,score};
  }
  return next;
}

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
    if (!goal.automatic || intervalOf(goal)) continue;
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
  const liveTeams = new Map(state.teams.map(team=>[team.id,team.score]));
  liveTeams.set(null,state.count);
  for (const record of records.values()) {
    if (record.status === 'pending' && (!liveTeams.has(record.teamId) || liveTeams.get(record.teamId)<record.score)) {
      record.status = 'withdrawn';
    }
  }
  for (const goal of system.goals) {
    const interval = intervalOf(goal);
    for (const team of targets(state,goal)) {
      const previous = includeExisting ? -Infinity : previousScores.get(team.id) ?? -Infinity;
      if (!interval) {
        const record = records.get(recordId(goal,team.id));
        const threshold = record?.score ?? goal.score;
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
    entry.achievedScore = team.score;
    entry.automatic = goal.automatic;
    entry.status = entry.automatic ? 'done' : 'pending';
    entry.reached = event.key;
    entry.time = event.authoredAt;
    entry.silent = includeExisting;
    if (!record) {system.records.push(entry);records.set(id,entry);}
  }
}

export function changeGoals(state, operation) {
  const system = state.goalSystem ??= freshGoals();
  if (operation.kind === 'score-goals') {
    if (operation.base !== system.revision) return false;
    const oldIds = new Set(system.goals.map(goal=>goal.id));
    system.goals = clone(operation.goals);
    dropRemovedGoalRecords(system);
    system.revision = operation.key;
    if (operation.includeExisting) {
      const selected = system.goals;
      system.goals = selected.filter(goal=>!oldIds.has(goal.id));
      reconcileGoals(state,state,operation,true);
      system.goals = selected;
    }
    completeReachedAutomaticGoals(state,operation);
    return true;
  }
  completeReachedAutomaticGoals(state);
  const selection = new Map(operation.records.map(record=>[record.id,record.reached]));
  let updated = false;
  for (const record of system.records) {
    if (selection.get(record.id)!==record.reached) continue;
    const goal=system.goals.find(item=>item.id===record.goalId);
    const team=goal && targets(state,goal).find(item=>item.id===record.teamId);
    const threshold = record.milestone ?? goal?.score;
    if (operation.complete && record.status!=='done' && team && team.score>=threshold) {
      if (record.status==='withdrawn') Object.assign(record,{score:threshold,achievedScore:team.score,silent:true});
      record.status='done';updated=true;
    } else if (!operation.complete && record.status==='done') {
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
    if (!team || intervalOf(goal) || team.score<goal.score || target.id!==recordId(goal,team.id)) continue;
    system.records.push({...newRecord(goal,team),status:'done',silent:true,reached:operation.key,time:operation.authoredAt??null});
    updated=true;
  }
  return updated;
}
