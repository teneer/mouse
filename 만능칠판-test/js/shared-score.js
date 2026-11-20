import {applyFieldPatch,resolveFieldConflict,startFieldConflicts,trackFieldDelta} from './score-conflicts.js';
import {changeGoals,completeReachedAutomaticGoals,readGoals,reconcileGoals} from '../score/goal-model.js?v=goal-queue-1';
const min = -10000, max = 10000;
const empty = () => ({count:0,teams:[],scoreLink:{enabled:true,points:3}});
const copy = value => structuredClone(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const inRange = score => Number.isSafeInteger(score) && score >= min && score <= max;
const bounded = score => inRange(score) ? score : 0;
const total = state => state.teams.reduce((sum,team)=>sum+team.score,0);

export function scoreSnapshot(value, key) {
  const initial = empty(), {scoreLink} = value || initial;
  return {
    count:bounded(value?.count),
    teams:(Array.isArray(value?.teams) ? value.teams : []).map((team,index)=>({
      id:team.id || key + ':' + index,
      name:String(team.name || '모둠 ' + (index+1)).slice(0,50),
      score:bounded(team.score)
    })),
    goalSystem:readGoals(value?.goalSystem),
    scoreLink:{enabled:scoreLink?.enabled !== false, points:Number.isSafeInteger(scoreLink?.points) && scoreLink.points > 0 ? scoreLink.points : 3}
  };
}

function applyDelta(state, operation) {
  const oldCount = state.count, oldTotal = total(state);
  const teams = operation.targets?.map(id=>state.teams.find(team=>team.id===id)) || [];
  if (!Number.isSafeInteger(operation.amount) || !operation.amount ||
    (operation.targets && (!teams.length || teams.some(team=>!team || !inRange(team.score+operation.amount))))) return null;

  const newTotal = oldTotal + teams.length * operation.amount;
  const rate = state.scoreLink.enabled ? state.scoreLink.points : 0;
  const classDiff = !operation.targets ? operation.amount : rate
    ? Math.floor(newTotal/rate)-Math.floor(oldTotal/rate) : 0;
  if (!inRange(oldCount+classDiff)) return null;
  state.count += classDiff;
  for (const team of teams) team.score += operation.amount;

  if (!operation.targets) return {kind:'class',oldCount,classDiff};
  return {kind:'team',idx:state.teams.indexOf(teams[0]),amount:operation.amount*teams.length,classDiff,oldCount,oldTotal,newTotal,rate};
}

export function applyScoreOperation(board, operation) {
  const {kind, key} = operation;
  if (kind === 'score-seed') {
    board.score ??= {state:scoreSnapshot(operation.snapshot,key),version:key,epoch:key,overwrite:null,undo:null,conflicts:[],notice:null,effect:null};
    return;
  }
  const score = board.score;
  if (!score) return;
  score.state.goalSystem ??= readGoals();
  completeReachedAutomaticGoals(score.state);
  const before = {count:score.state.count,teams:copy(score.state.teams)};
  if (kind === 'score-goals' || kind === 'score-records') {
    if (!changeGoals(score.state,operation)) score.notice = {key,text:'다른 기기에서 목표나 달성 기록이 변경되었습니다. 다시 확인해 주세요.'};
    else score.notice = null;
    return;
  }

  if (kind === 'score-delta') {
    if (operation.fieldBasis) startFieldConflicts(score);
    const activeTargets=operation.fieldBasis && operation.targets
      ? operation.targets.filter(id=>score.state.teams.some(team=>team.id===id)) : operation.targets;
    const missed=activeTargets?.length!==operation.targets?.length;
    const effect = applyDelta(score.state,{...operation,targets:activeTargets});
    if (!effect) {
      score.notice = {key,text:'모둠이 삭제되었거나 점수 범위를 벗어나 대기 중이던 점수 조작을 적용하지 못했습니다.'};
      return;
    }
    if (score.overwrite) {
      const {id,before} = score.overwrite;
      applyDelta(before,operation);
      if (operation.epoch && operation.epoch !== score.epoch && !score.conflicts.some(item=>item.id===id)) {
        score.conflicts.push({id,candidate:before});
      }
    }
    if (score.fieldConflicts) trackFieldDelta(score,before,operation);
    reconcileGoals(score.state,before,operation);
    score.notice=missed?{key,text:'삭제된 모둠을 제외한 점수 변경을 반영했습니다.'}:null;
    if (score.undo?.group !== operation.group || !equal(score.undo.targets,activeTargets||null)) {
      score.undo={group:operation.group,amount:0,targets:activeTargets||null};
    }
    score.undo.amount += operation.amount;
    score.version = key;
    score.effect = effect;
    score.sounds ??= [];
    score.sounds.push({key,effect});
    if (score.sounds.length>64) score.sounds.shift();
    return;
  }
  if (kind === 'score-undo') {
    if (score.version !== operation.base || !score.undo) {
      score.notice = {key,text:'다른 기기에서 점수를 바꿨습니다. 현재 점수를 확인한 뒤 되돌리기를 다시 선택하세요.'};
      return;
    }
    const undo = score.undo;
    if (undo.targets) {
      const teams = undo.targets.map(id=>score.state.teams.find(team=>team.id===id));
      const oldTotal = total(score.state), newTotal = oldTotal - undo.amount*teams.length;
      const rate = score.state.scoreLink.enabled ? score.state.scoreLink.points : 0;
      const change = rate ? Math.floor(newTotal/rate)-Math.floor(oldTotal/rate) : 0;
      if (teams.some(team=>!team || !inRange(team.score-undo.amount)) || !inRange(score.state.count+change)) return;
      for (const team of teams) team.score -= undo.amount;
      score.state.count += change;
    } else score.state.count -= undo.amount;
    if (score.overwrite) applyDelta(score.overwrite.before,{amount:-undo.amount,targets:undo.targets});
    if (score.fieldConflicts) trackFieldDelta(score,before,operation);
  } else if (kind === 'score-patch') {
    const link=score.state.scoreLink;
    applyFieldPatch(score,operation);
    if (score.state.count===before.count && equal(score.state.teams,before.teams) && equal(score.state.scoreLink,link)) return;
  } else if (kind === 'score-field-choice') {
    if (!resolveFieldConflict(score,operation)) return;
  } else if (kind === 'score-edit') {
    const candidate = scoreSnapshot({...operation.snapshot,goalSystem:score.state.goalSystem},key);
    if (equal(score.state,candidate)) return;
    if (score.version !== operation.base) {
      score.conflicts.push({id:key,candidate,device:operation.device,label:operation.deviceLabel,at:operation.authoredAt});
      return;
    }
    const previous = score.state;
    if (previous.count !== candidate.count || previous.teams.some(team=>
      (candidate.teams.find(next=>next.id===team.id)?.score ?? 0) !== team.score) ||
      candidate.teams.some(team=>team.score && !previous.teams.some(old=>old.id===team.id))) {
      score.overwrite = {id:key,before:copy(previous)};
      score.epoch = key;
    }
    score.state = candidate;
  } else if (kind === 'score-resolve') {
    const entry = score.conflicts.find(item=>item.id===operation.conflict);
    if (!entry) return;
    if (score.version !== operation.base) {
      score.notice = {key,text:'비교하는 동안 공유 점수가 변경됐습니다. 최신 점수와 다시 비교해 주세요.'};
      return;
    }
    if (operation.useCandidate) {
      score.state = {...copy(entry.candidate),goalSystem:score.state.goalSystem};
      score.epoch = key;
    }
    score.overwrite = null;
    score.conflicts = score.conflicts.filter(item=>item!==entry);
  } else return;
  reconcileGoals(score.state,before,operation);
  score.undo = null;
  if (kind!=='score-patch') score.notice = null;
  score.version = key;
  score.effect = null;
}
