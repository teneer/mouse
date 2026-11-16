const clone = value => structuredClone(value);
export const freshGoals = () => ({goals:[],records:[],revision:null});
export const readGoals = value => value ? clone(value) : freshGoals();

export function parseGoalScore(value) {
  const number = value.trim().normalize('NFKC').replace(/^−/,'-');
  if (!/^[+-]?\d+$/.test(number)) return null;
  const score = Number(number);
  return score>=-10000 && score<=10000 ? score : null;
}

function targets(state, goal) {
  return goal.type === 'class' ? [{id:null,score:state.count}] : state.teams;
}
const recordId = (goal, teamId) => JSON.stringify([goal.id,teamId]);

export function goalStatus(goal, score, record) {
  if (record?.status==='done') return 'done';
  return score>=goal.score?'reached':'unreached';
}

function newRecord(goal, team) {
  return {
    id:recordId(goal,team.id),goalId:goal.id,teamId:team.id,type:goal.type,score:goal.score,message:goal.message,
    teamName:team.name||null,achievedScore:team.score,automatic:goal.automatic
  };
}

// Repair automatic goals saved after their threshold was reached in older versions.
export function completeReachedAutomaticGoals(state, event) {
  const system=state.goalSystem;
  if (!system) return;
  const seen=new Set(system.records.map(record=>record.id));
  for (const goal of system.goals) {
    if (!goal.automatic) continue;
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
    for (const team of targets(state,goal)) {
      const id = recordId(goal,team.id);
      const record = records.get(id);
      const threshold = record?.score ?? goal.score;
      if (team.score < threshold || record && record.status !== 'withdrawn') continue;
      if (!includeExisting && (previousScores.get(team.id) ?? -Infinity) >= threshold) continue;
      const entry = record || newRecord(goal,team);
      entry.achievedScore = team.score;
      entry.automatic = goal.automatic;
      entry.status = entry.automatic ? 'done' : 'pending';
      entry.reached = event.key;
      entry.time = event.authoredAt;
      entry.silent = includeExisting;
      if (!record) {system.records.push(entry);records.set(id,entry);}
    }
  }
}

export function changeGoals(state, operation) {
  const system = state.goalSystem ??= freshGoals();
  if (operation.kind === 'score-goals') {
    if (operation.base !== system.revision) return false;
    const oldIds = new Set(system.goals.map(goal=>goal.id));
    system.goals = clone(operation.goals);
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
    if (operation.complete && record.status!=='done' && team && team.score>=goal.score) {
      if (record.status==='withdrawn') Object.assign(record,{score:goal.score,achievedScore:team.score,silent:true});
      record.status='done';updated=true;
    } else if (!operation.complete && record.status==='done') {
      const score = record.teamId===null ? state.count : state.teams.find(team=>team.id===record.teamId)?.score;
      if (goal) record.score=goal.score;
      record.status = score>=record.score ? 'pending' : 'withdrawn';
      updated=true;
    }
  }
  if (operation.complete) for (const target of operation.records) {
    if (target.reached!==null || system.records.some(record=>record.id===target.id)) continue;
    const goal=system.goals.find(item=>item.id===target.goalId);
    const team=goal && targets(state,goal).find(item=>item.id===target.teamId);
    if (!team || team.score<goal.score || target.id!==recordId(goal,team.id)) continue;
    system.records.push({...newRecord(goal,team),status:'done',silent:true,reached:operation.key,time:operation.authoredAt??null});
    updated=true;
  }
  return updated;
}
