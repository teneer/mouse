import {mountGoalTable} from './goal-table.js?v=goal-bulk-controls-1';
import {celebrationSections,createGoalCelebrationQueue,mountGoalCelebration} from './goal-celebration.js?v=device-audio-1';

const $ = id => document.getElementById(id);
const button = (label,action,classes='dialog-action') => {
  const item = document.createElement('button');
  item.type = 'button';item.className=classes;item.textContent = label;item.onclick = action;
  return item;
};

export function wireGoals({submit,teamList,classScore,teamAccent,celebrate,confirmSave,modalState}) {
  const localPopup=mountGoalCelebration($('goal-celebration'));
  const table=mountGoalTable({submit,teamList,classScore,modalState,confirmSave});
  const celebrations=createGoalCelebrationQueue(celebrate);
  let records=new Map();
  let system,active,timer,previous;
  const emitPopup = detail => window.frameElement?.dispatchEvent(new CustomEvent('score-celebration',{detail}));
  function refreshSkip() {
    const action = active && celebrations.hasPending(records) ? skipRemaining : null;
    if (window.frameElement) window.frameElement.dispatchEvent(new CustomEvent('score-celebration-skip',{detail:action}));
    else localPopup.setSkip(action);
  }
  function skipRemaining() {
    celebrations.clear();
    close();
  }
  function showGroup(group) {
    active=group;
    const pending=group.filter(row=>row.status==='pending' && !system.goals.find(goal=>goal.id===row.goalId)?.automatic);
    const complete=pending.length ? async ()=>{
      const accepted=await change(pending,true);
      if (accepted && active===group) close();
      return accepted;
    } : null;
    const detail={
      sections:celebrationSections(group,teamList(),teamAccent),
      completeLabel:pending.length>1?'모두 완료 처리':'완료 처리',
      close,complete
    };
    if (window.frameElement) {
      localPopup.show(null);
      emitPopup(detail);
    } else {
      emitPopup(null);
      localPopup.show(detail);
    }
    clearTimeout(timer);timer=setTimeout(close,10000);
    refreshSkip();
  }
  function advance() {
    if (active) return;
    const group = celebrations.take(records);
    if (group.length) showGroup(group);
  }
  function close() {
    clearTimeout(timer);active=null;localPopup.show(null);emitPopup(null);advance();
    refreshSkip();
  }
  function update(model, announce) {
    system=model;
    records=new Map(model.records.map(row=>[row.id,row]));
    const added=announce && previous && celebrations.enqueue(model.records,previous,!!active);
    previous=new Map(model.records.map(row=>[row.id,row.reached]));
    const next=active && added ? celebrations.take(records) : [];
    if (next.length) showGroup(next);
    else if (active) {
      const remaining=active.filter(row=>{
        const latest=records.get(row.id);
        return latest && latest.reached===row.reached && latest.status!=='withdrawn' &&
          !(row.status==='pending' && latest.status==='done');
      });
      if (!remaining.length) close();
      else if (remaining.length!==active.length) showGroup(remaining);
    }
    advance();
    refreshSkip();
    table.update(model);
  }
  function change(records,complete) {
    if (!records.length) return;
    return submit({kind:'score-records',records:records.map(({id,reached,goalId,teamId})=>
      reached===null?{id,reached,goalId,teamId}:{id,reached}),complete});
  }
  document.addEventListener('pointerdown',()=>{
    window.frameElement?.dispatchEvent(new Event('score-frame-pointer'));
  },true);
  function giftGroup(parent,teamId=null) {
    if (!parent) return;
    parent.replaceChildren();
    const records=system?.records.filter(row=>row.teamId===teamId && row.status==='pending') || [];
    parent.hidden=!records.length;
    if (!records.length) return;
    const add=(quantity,title,action)=>{
      const control=button('🎁',action,'');
      control.title=title;control.setAttribute('aria-label',title);
      if (quantity>1) control.append(document.createTextNode('×'+quantity));
      parent.append(control);
    };
    if (teamId===null && records.length<=2) {
      for (const record of records) add(1,record.message||'학급 선물',()=>table.open(record));
    } else if (records.length===1) add(1,records[0].message||'선물 지급 관리',()=>table.open(records[0]));
    else add(records.length,`지급 대기 선물 ${records.length}개`,()=>table.open(records[0]));
  }
  return {openSettings:table.open,update,giftGroup,reset(){celebrations.reset();close();previous=null;table.close();}};
}
