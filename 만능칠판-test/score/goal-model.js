const clone = value => structuredClone(value);
export const freshGoals = () => ({goals:[],records:[],revision:null});
export const readGoals = value => value ? clone(value) : freshGoals();

function targets(state, goal) {
  return goal.type === 'class' ? [{id:null,score:state.count}] : state.teams;
}
const recordId = (goal, teamId) => JSON.stringify([goal.id,teamId]);

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
      const entry = record || {
        id,goalId:goal.id,teamId:team.id,type:goal.type,score:goal.score,message:goal.message,
        teamName:team.name || null,reward:goal.reward,automatic:goal.automatic
      };
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
    return true;
  }
  const selection = new Map(operation.records.map(record=>[record.id,record.reached]));
  let updated = false;
  for (const record of system.records) {
    if (selection.get(record.id)!==record.reached) continue;
    if (operation.complete && record.status==='pending') {
      record.status='done';updated=true;
    } else if (!operation.complete && record.status==='done') {
      const team = record.teamId===null ? state.count : state.teams.find(team=>team.id===record.teamId)?.score;
      record.status = team>=record.score ? 'pending' : 'withdrawn';
      updated=true;
    }
  }
  return updated;
}
