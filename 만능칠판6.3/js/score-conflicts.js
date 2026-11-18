const numberAllowed = value => Number.isSafeInteger(value) && value>=-10000 && value<=10000;
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const teamField = id => 'team:'+id;
const teamByField = (state,field) => typeof field==='string' && field.startsWith('team:') ? state.teams.find(team=>teamField(team.id)===field) : undefined;
const read = (state,field) => field==='class'?state.count:teamByField(state,field)?.score;
function write(state,field,value) {
  if (field==='class') state.count=value;
  else teamByField(state,field).score=value;
}

function fields(state) {
  return ['class',...state.teams.map(team=>teamField(team.id))];
}

function putCandidate(score,field,entry) {
  const slots=score.fieldConflicts;
  const entries=slots[field]??=[];
  const index=entries.findIndex(candidate=>candidate.device===entry.device);
  if (index>=0 && entries[index].at>entry.at) return;
  if (index>=0) entries.splice(index,1);
  if (entry.value!==read(score.state,field)) entries.push(entry);
  if (!entries.length) delete slots[field];
}

function cleanField(score,field) {
  const candidates=score.fieldConflicts[field];
  if (!candidates) return;
  const current=read(score.state,field);
  const differing=candidates.filter(item=>item.value!==current);
  if (current===undefined || !differing.length) delete score.fieldConflicts[field];
  else score.fieldConflicts[field]=differing;
}

export function startFieldConflicts(score) {
  score.fieldConflicts??={};
  score.fieldOverwrites??={};
  // Existing unresolved snapshots are shown as alternatives for differing fields.
  // Old snapshots lack field-level edit intent, so apply none of them automatically.
  for (const {id,candidate,device,label,at} of score.conflicts||[]) {
    if (!candidate?.teams) continue;
    for (const field of fields(score.state)) {
      const value=read(candidate,field);
      if (numberAllowed(value)) putCandidate(score,field,{device:device||'legacy:'+id,label:label||'이전 입력',at:at||0,value});
    }
  }
  score.conflicts=[];
  score.overwrite=null;
}

export function scorePatch(before,after) {
  const existing=new Map(before.teams.map(team=>[team.id,team]));
  const incoming=new Map(after.teams.map(team=>[team.id,team]));
  const numbers=[], renamed=[];
  if (before.count!==after.count) numbers.push({field:'class',basedOn:before.count,value:after.count});
  for (const team of after.teams) {
    const old=existing.get(team.id);
    if (!old) continue;
    if (old.name!==team.name) renamed.push({id:team.id,name:team.name});
    if (old.score!==team.score) numbers.push({field:teamField(team.id),basedOn:old.score,value:team.score});
  }
  return {
    numbers,renamed,added:after.teams.filter(team=>!existing.has(team.id)),
    removed:before.teams.filter(team=>!incoming.has(team.id)).map(team=>team.id),
    link:same(before.scoreLink,after.scoreLink)?null:after.scoreLink
  };
}

export function applyFieldPatch(score,operation) {
  // Server-confirmed order determines the outcome of direct edits.
  startFieldConflicts(score);
  const {numbers=[],renamed=[],added=[],removed=[],link}=operation.patch||{};
  score.notice=null;
  const removedIds=new Set(removed);
  score.state.teams=score.state.teams.filter(team=>!removedIds.has(team.id));
  for(const id of removedIds) {
    delete score.fieldConflicts[teamField(id)];
    delete score.fieldOverwrites[teamField(id)];
  }
  for(const entry of renamed) {
    const team=score.state.teams.find(item=>item.id===entry.id);
    if(team)team.name=entry.name;
  }
  for(const team of added) {
    if(!score.state.teams.some(item=>item.id===team.id))score.state.teams.push(structuredClone(team));
  }
  if(link)score.state.scoreLink=structuredClone(link);
  for(const {field,value} of numbers) {
    if(field!=='class' && (typeof field!=='string'||!field.startsWith('team:')))continue;
    if(!numberAllowed(value))continue;
    if(read(score.state,field)===undefined) {
      score.notice={key:operation.key,text:'삭제된 모둠의 점수 변경은 적용하지 않았습니다.'};
      continue;
    }
    write(score.state,field,value);
    delete score.fieldConflicts[field];
    delete score.fieldOverwrites[field];
  }
}

export function scoreDeltaBasis() { return {}; }

// Undo and adjustments may change both team and linked class values.
export function trackFieldDelta(score,before,operation) {
  const prior=new Map(before.teams.map(team=>[teamField(team.id),team.score]));
  prior.set('class',before.count);
  for (const field of fields(score.state)) {
    const current=read(score.state,field), change=current-prior.get(field);
    if (!change) continue;
    const overwrite=score.fieldOverwrites[field];
    if (overwrite) {
      overwrite.alternative+=change;
      if (operation.fieldBasis && operation.fieldBasis[field]!==overwrite.key && numberAllowed(overwrite.alternative)) {
        putCandidate(score,field,{device:operation.device||'unknown',label:operation.deviceLabel,
          at:operation.authoredAt||0,value:overwrite.alternative,adjusted:true});
      }
      for (const entry of score.fieldConflicts[field]||[]) {
        if (entry.adjusted) entry.value=overwrite.alternative;
      }
    }
    cleanField(score,field);
  }
}

export function fieldConflictOptions(score) {
  return Object.entries(score.fieldConflicts||{}).flatMap(([field,entries])=>{
    const current=read(score.state,field);
    if (current===undefined) return [];
    const values=new Map();
    for (const entry of entries) {
      if (entry.value===current || !numberAllowed(entry.value)) continue;
      const matches=values.get(entry.value)||[];
      matches.push({id:entry.device,label:entry.label});
      values.set(entry.value,matches);
    }
    if (!values.size) return [];
    const candidates=[...values].map(([value,devices])=>({value,devices}));
    return [{field,label:field==='class'?'학급 점수':teamByField(score.state,field).name,server:current,candidates,
      stamp:JSON.stringify([current,candidates])}];
  });
}

export function resolveFieldConflict(score,operation) {
  startFieldConflicts(score);
  const conflict=fieldConflictOptions(score).find(item=>item.field===operation.field);
  if (!conflict) return false;
  if (conflict.stamp!==operation.stamp ||
      ![conflict.server,...conflict.candidates.map(item=>item.value)].includes(operation.value)) {
    score.notice={key:operation.key,text:'비교 중 점수가 바뀌었습니다. 최신 값에서 다시 선택해 주세요.'};
    return false;
  }
  write(score.state,operation.field,operation.value);
  delete score.fieldConflicts[operation.field];
  delete score.fieldOverwrites[operation.field];
  return true;
}
