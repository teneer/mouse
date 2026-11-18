import {applyFieldPatch,resolveFieldConflict,startFieldConflicts,trackFieldDelta} from './score-conflicts.js?v=server-order-1';
import {changeGoals,completeReachedAutomaticGoals,readGoals,reconcileGoals} from '../score/goal-model.js?v=conflict-fields-1';
const min = -10000, max = 10000;
const empty = () => ({count:0,teams:[],scoreLink:{enabled:true,points:3}});
const copy = value => structuredClone(value);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const inRange = score => Number.isSafeInteger(score) && score >= min && score <= max;
const bounded = score => inRange(score) ? score : 0;
const total = state => state.teams.reduce((sum,team)=>sum+team.score,0);
function undoHistory(score) {
  if(!Array.isArray(score.undoStack)) {
    score.undoStack=score.undo?.amount?[{key:score.version,group:score.undo.group,
      amount:score.undo.amount,targets:score.undo.targets||null}]:[];
  }
  return score.undoStack;
}
function invalidateUndoForDirectEdit(score,patch={}) {
  const stack=undoHistory(score);
  if(patch.link||(patch.numbers||[]).some(item=>item.field==='class')){stack.length=0;return;}
  const changed=new Set([...(patch.removed||[]),
    ...(patch.numbers||[]).filter(item=>item.field?.startsWith('team:')).map(item=>item.field.slice(5))]);
  if(changed.size)score.undoStack=stack.filter(item=>!item.targets?.some(id=>changed.has(id)));
}
function rememberEffect(score,key,effect,replay=false) {
  score.version=key;
  score.effect=replay?{...effect,replay:true}:effect;
  score.sounds??=[];
  score.sounds.push({key,effect,replay});
  if(score.sounds.length>64)score.sounds.shift();
}

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
    board.score ??= {state:scoreSnapshot(operation.snapshot,key),version:key,epoch:key,overwrite:null,undo:null,conflicts:[],notice:null,effect:null,undoStack:[]};
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
    const activeTargets=operation.targets
      ? operation.targets.filter(id=>score.state.teams.some(team=>team.id===id)) : operation.targets;
    const missed=activeTargets?.length!==operation.targets?.length;
    const effect = applyDelta(score.state,{...operation,targets:activeTargets});
    if (!effect) {
      score.notice = {key,text:'모둠이 삭제되었거나 점수 범위를 벗어나 대기 중이던 점수 조작을 적용하지 못했습니다.'};
      return;
    }
    reconcileGoals(score.state,before,operation);
    score.notice=missed?{key,text:'삭제된 모둠을 제외한 점수 변경을 반영했습니다.'}:null;
    const stack=undoHistory(score), previous=stack[stack.length-1], targets=activeTargets||null;
    if(previous && previous.group===operation.group && equal(previous.targets,targets)) {
      previous.amount+=operation.amount;
      previous.key=key;
      if(!previous.amount)stack.pop();
    } else stack.push({key,group:operation.group,amount:operation.amount,targets});
    if(stack.length>500)stack.shift();
    score.undo=null;
    rememberEffect(score,key,effect,operation.replay===true);
    return;
  }
  if (kind === 'score-undo') {
    const stack=undoHistory(score),last=stack[stack.length-1];
    if(!last)return;
    const effect=applyDelta(score.state,{amount:-last.amount,targets:last.targets});
    if(!effect) {
      score.notice={key,text:'대상 모둠 또는 점수 범위가 변경되어 되돌릴 수 없습니다.'};
      return;
    }
    stack.pop();
    score.undo=null;
    reconcileGoals(score.state,before,operation);
    score.notice=null;
    rememberEffect(score,key,effect,operation.replay===true);
    return;
  } else if (kind === 'score-patch') {
    const link=score.state.scoreLink;
    applyFieldPatch(score,operation);
    invalidateUndoForDirectEdit(score,operation.patch);
    if (score.state.count===before.count && equal(score.state.teams,before.teams) && equal(score.state.scoreLink,link)) return;
  } else if (kind === 'score-field-choice') {
    if (!resolveFieldConflict(score,operation)) return;
  } else if (kind === 'score-edit') {
    const candidate=scoreSnapshot({...operation.snapshot,goalSystem:score.state.goalSystem},key);
    if(equal(score.state,candidate))return;
    score.state=candidate;
    undoHistory(score).length=0;
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
      undoHistory(score).length=0;
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
