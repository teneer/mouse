import {goalAppliesToTeam,goalStatus,makeGoalRounds,parseGoalInterval,parseGoalScore} from './goal-model.js?v=goal-table-1';

const $=id=>document.getElementById(id);
const create=(tag,text)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
};
const button=(text,click)=>{
  const node=create('button',text);
  node.type='button';node.className='dialog-action';node.onclick=click;
  return node;
};
const label=(text,input)=>{
  const node=create('label',text);node.append(input);return node;
};
const sameTeams=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const labels={unreached:'미달성',reached:'도달',done:'완료'};

export function mountGoalTable({submit,teamList,classScore,modalState,confirmSave}) {
  const view=$('goal-management-view'), table=$('goal-table-body');
  const selectAll=$('goal-select-all'), add=$('goal-add-selected'), save=$('close-goal-view-btn');
  const dialog=$('goal-action-dialog'), fields=$('goal-action-fields'), apply=$('goal-action-apply');
  const actionError=$('goal-action-error'), editError=$('goal-edit-error');
  const tabs=[...view.querySelectorAll('[data-goal-scope]')];
  let system, draft=[], scope='class', base, opener, action, statusView;
  let pointerDown=false, pendingSort=false;
  let savedGoals=new Map(), savedRecords=new Map();
  const selected=new Set();
  const rows=new Map();

  const scoped=()=>draft.filter(goal=>goal.type===scope);
  const chosen=()=>scoped().filter(goal=>selected.has(goal.id) && !goal.archived);
  const savedGoal=goal=>savedGoals.get(goal.id);
  const canChangeStatus=(goal,teamId)=>{
    const saved=savedGoal(goal);
    return !!saved && !goal.archived && !goal.automatic && !saved.automatic
      && saved.score===goal.score && (goal.type==='class' || goalAppliesToTeam(saved,teamId));
  };
  const draftChanged=goal=>{
    const saved=savedGoal(goal);
    return !saved || goal.score!==saved.score || goal.automatic!==!!saved.automatic || !sameTeams(goal.teamIds,saved.teamIds);
  };

  function orderRows() {
    const ids=scoped().sort((a,b)=>(parseGoalScore(b.scoreText)??-Infinity)-(parseGoalScore(a.scoreText)??-Infinity));
    table.append(...ids.map(goal=>rows.get(goal.id)));
  }
  view.addEventListener('pointerdown',event=>{if(event.isPrimary)pointerDown=true;},true);
  function finishPointer(event) {
    if(!event.isPrimary)return;
    pointerDown=false;
    if(!pendingSort)return;
    pendingSort=false;
    requestAnimationFrame(()=>{if(view.style.display==='flex')orderRows();});
  }
  document.addEventListener('pointerup',finishPointer,true);
  document.addEventListener('pointercancel',finishPointer,true);
  function syncBulk() {
    const goals=scoped();
    const count=chosen().length, eligible=goals.filter(goal=>!goal.archived).length;
    selectAll.checked=!!eligible && count===eligible;
    selectAll.indeterminate=count>0 && count<eligible;
    selectAll.disabled=!eligible;
    $('goal-bulk-count').textContent=count+'개 선택';
    for(const control of view.querySelectorAll('[data-goal-bulk]'))control.disabled=count===0;
    view.querySelector('[data-goal-bulk=teams]').hidden=scope==='class';
  }
  function refreshScope() {
    view.dataset.goalScope=scope;
    for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab.dataset.goalScope===scope));
    for(const cell of view.querySelectorAll('th.goal-team-column'))cell.hidden=scope==='class';
    rows.clear();
    for(const goal of scoped())rows.set(goal.id,createRow(goal));
    table.replaceChildren();
    orderRows();
    $('goal-empty').hidden=rows.size>0;
    syncBulk();
  }

  function stateFor(goal,team,records,round) {
    const record=records.find(item=>item.teamId===team.id && item.milestone===round);
    const threshold=round??goal.score;
    return {team,state:goalStatus({score:threshold??Infinity},team.score,record),
      target:record??{id:JSON.stringify([goal.id,team.id]),goalId:goal.id,teamId:team.id,reached:null}};
  }
  const recordsFor=goal=>savedRecords.get(goal.id)??[];
  function goalTargets(goal,history,round,includeExcluded=false) {
    if(goal.archived)return history.filter(record=>record.status==='done' && record.milestone===round).map(record=>({
      team:{id:record.teamId,name:record.teamId===null?'학급':record.teamName??'모둠',
        score:record.teamId===null?classScore():teamList().find(team=>team.id===record.teamId)?.score??record.achievedScore},
      state:'done',target:record,applies:true
    }));
    const teams=goal.type==='class'?[{id:null,name:'학급',score:classScore()}]:teamList();
    return teams.flatMap(team=>{
      const applies=goal.type==='class'||goalAppliesToTeam(goal,team.id);
      if (!includeExcluded && (!applies || round!==undefined && !history.some(record=>record.teamId===team.id && record.milestone===round)))return [];
      return [{...stateFor(goal,team,history,round),applies}];
    });
  }
  function refreshStatus(goal,row) {
    const control=row.querySelector('.goal-state');
    const teamButton=row.querySelector('.goal-team-column button');
    if(teamButton)teamButton.textContent=Array.isArray(goal.teamIds)
      ?'모둠 '+teamList().filter(team=>goalAppliesToTeam(goal,team.id)).length+'개':'전체 모둠';
    const history=recordsFor(goal);
    if(goal.interval || history.some(record=>record.milestone!==undefined)) {
      const waiting=history.filter(record=>record.status==='pending').length;
      const done=history.filter(record=>record.status==='done').length;
      control.textContent=waiting?'대기 '+waiting:done?'완료 '+done:'미달성';
      control.dataset.state=waiting?'reached':done?'done':'unreached';
    } else {
      const states=goalTargets(goal,history);
      const done=states.filter(target=>target.state==='done').length;
      const reached=states.filter(target=>target.state==='reached').length;
      const state=reached?'reached':done?'done':'unreached';
      control.textContent=goal.type==='class'?(labels[states[0]?.state]??'기록 없음'):
        states.length?done+'/'+states.length+' 완료':'대상 없음';
      control.dataset.state=state;
    }
    control.title=draftChanged(goal)?'목표를 저장한 뒤 상태를 변경할 수 있습니다.':'달성 상태 확인';
  }

  function createRow(goal) {
    const row=create('tr');
    row.dataset.goal=goal.id;
    row.toggleAttribute('data-archived',!!goal.archived);
    row.innerHTML='<td data-label="선택"><input class="goal-row-check" type="checkbox" aria-label="목표 행 선택"></td>'+
      '<td data-label="목표 점수"><input class="goal-row-score" inputmode="numeric" aria-label="목표 점수"></td>'+
      '<td data-label="메시지"><input class="goal-row-message" maxlength="240" aria-label="메시지"></td>'+
      (goal.type==='team'?'<td data-label="적용 모둠" class="goal-team-column"></td>':'')+
      '<td data-label="달성 상태"></td><td data-label="자동완료"><input class="goal-row-auto" type="checkbox" aria-label="자동완료"></td>'+
      '<td data-label="반복"></td><td data-label="삭제"></td>';
    const check=row.querySelector('.goal-row-check'), score=row.querySelector('.goal-row-score');
    const message=row.querySelector('.goal-row-message'), automatic=row.querySelector('.goal-row-auto');
    check.checked=selected.has(goal.id);check.disabled=!!goal.archived;
    check.onchange=()=>{if(check.checked)selected.add(goal.id);else selected.delete(goal.id);syncBulk();};
    score.value=goal.scoreText;score.readOnly=message.readOnly=!!goal.archived;
    score.oninput=()=>{
      goal.scoreText=score.value;goal.score=parseGoalScore(score.value);
      refreshStatus(goal,row);
    };
    score.onchange=()=>{if(pointerDown)pendingSort=true;else orderRows();};
    score.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();score.blur();}};
    message.value=goal.message;message.oninput=()=>{goal.message=message.value;};
    automatic.checked=!!goal.automatic;automatic.disabled=!!goal.archived;
    automatic.onchange=()=>{goal.automatic=automatic.checked;refreshStatus(goal,row);};
    if(goal.type==='team') {
      const teamButton=button('',()=>showStatus(goal));
      teamButton.disabled=!!goal.archived;
      row.querySelector('.goal-team-column').append(teamButton);
    }
    const state=button('',()=>{
      const target=goal.type==='class' && !goal.interval && !recordsFor(goal).some(record=>record.milestone!==undefined)
        ? goalTargets(goal,recordsFor(goal))[0]:null;
      if(target && canChangeStatus(goal) && classScore()>=goal.score && target.state!=='unreached') {
        changeTargets([target],target.state!=='done');
      } else showStatus(goal);
    });
    state.classList.add('goal-state');
    row.querySelector('[data-label="달성 상태"]').append(state);
    refreshStatus(goal,row);
    const repeat=button(goal.repeat?'반복 '+(goal.repeat.index+1)+'/'+goal.repeat.count:goal.interval?'계속 반복':'반복',()=>editRepeat(goal));
    repeat.disabled=!!goal.archived;
    if(goal.repeat || goal.interval)repeat.classList.add('goal-repeat-active');
    row.querySelector('[data-label="반복"]').append(repeat);
    const remove=button('×',()=>deleteGoals([goal]));
    remove.classList.add('dialog-danger');remove.setAttribute('aria-label','목표 삭제');remove.title='목표 삭제';
    row.querySelector('[data-label="삭제"]').append(remove);
    if(goal.archived)message.title='완료 기록을 보존한 회차';
    return row;
  }

  function closeAction() {
    if(dialog.open)dialog.close();
    statusView=null;action=null;
  }
  function openAction(title,content,submitAction,kind='default') {
    dialog.dataset.kind=kind;
    $('goal-action-title').textContent=title;
    fields.replaceChildren(content);
    actionError.textContent='';
    apply.hidden=!submitAction;
    action=submitAction;
    if(!dialog.open)dialog.showModal();
  }
  $('goal-action-form').onsubmit=event=>{
    event.preventDefault();
    if(action?.())closeAction();
  };
  $('goal-action-close').onclick=$('goal-action-cancel').onclick=closeAction;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeAction();});

  function teamPicker(teamIds) {
    const fieldset=create('fieldset');fieldset.className='goal-team-picker';
    fieldset.append(create('legend','적용 모둠'));
    const all=create('input');all.type='checkbox';all.checked=!Array.isArray(teamIds);
    fieldset.append(label('전체 모둠',all));
    const list=create('div');list.className='goal-target-list goal-team-options';fieldset.append(list);
    const teams=teamList();
    const included=new Set(teamIds??teams.map(team=>team.id));
    const cards=teams.map(team=>{
      const card=teamCard(team,()=>{
        all.checked=false;
        if(included.has(team.id))included.delete(team.id);else included.add(team.id);
        sync();
      });
      list.append(card);
      return {id:team.id,card};
    });
    function sync() {
      for(const {id,card} of cards) {
        const applies=included.has(id);
        card.setAttribute('aria-pressed',String(applies));
        card.dataset.state=applies?'applied':'excluded';
        card.querySelector('.goal-target-label').textContent=applies?'적용':'미적용';
      }
    }
    all.onchange=()=>{
      if(all.checked)for(const team of teams)included.add(team.id);
      sync();
    };
    if(!teams.length)list.append(create('p','등록된 모둠이 없습니다.'));
    sync();
    const value=()=>all.checked?undefined:teams.filter(team=>included.has(team.id)).map(team=>team.id);
    return {fieldset,value};
  }
  function setTeams(goals,ids) {
    for(const goal of goals) {
      if(ids)goal.teamIds=[...ids];
      else delete goal.teamIds;
    }
    refreshScope();return true;
  }
  function editTeams(goals) {
    const picker=teamPicker(goals.length===1?goals[0].teamIds:undefined);
    openAction('적용 모둠',picker.fieldset,()=>setTeams(goals,picker.value()));
  }
  function editMessage(goals) {
    const input=create('input');input.maxLength=240;
    input.value=goals.length===1?goals[0].message:'';
    openAction('메시지 변경',label('메시지',input),()=>{
      for(const goal of goals)goal.message=input.value;
      refreshScope();return true;
    });
  }
  function deleteGoals(goals) {
    const ids=new Set(goals.map(goal=>goal.id));
    const remove=()=>{
      draft=draft.filter(goal=>!ids.has(goal.id));
      for(const id of ids)selected.delete(id);
      refreshScope();return true;
    };
    if(!system.records.some(record=>ids.has(record.goalId) && record.status==='done')) {
      remove();return;
    }
    const text=create('p','선택한 목표의 지급 완료 기록도 삭제됩니다.');
    openAction('목표 '+ids.size+'개 삭제',text,remove);
  }

  function editRepeat(goal) {
    const repeat=goal.repeat;
    const block=create('div');block.className='goal-repeat-fields';
    const inputs=[['시작 점수',repeat?.start??goal.scoreText],['점수 간격',repeat?.interval??goal.interval??10],['생성 회차',repeat?.count??2]].map(([name,value])=>{
      const input=create('input');input.type='text';input.inputMode='numeric';input.required=true;input.value=value;
      block.append(label(name,input));return input;
    });
    const message=create('input');message.maxLength=240;message.value=goal.message;
    const automatic=create('input');automatic.type='checkbox';automatic.checked=!!goal.automatic;
    block.append(label('메시지',message),label('자동완료',automatic));
    const picker=goal.type==='team'?teamPicker(goal.teamIds):null;
    if(picker)block.append(picker.fieldset);
    const preview=create('p');preview.className='goal-repeat-preview';block.append(preview);
    const settings=()=>{
      const [start,interval,count]=[parseGoalScore(inputs[0].value),parseGoalInterval(inputs[1].value),parseGoalInterval(inputs[2].value)];
      if(start===null || interval===null || count===null || start+interval*(count-1)>10000)return null;
      return {start,interval,count,message:message.value.trim(),automatic:automatic.checked,teamIds:picker?.value()};
    };
    function updatePreview() {
      const config=settings();
      if(!config){preview.textContent='목표 점수 범위 안에서 시작 점수, 간격, 회차를 입력해 주세요.';return;}
      const sample=Array.from({length:Math.min(6,config.count)},(_,i)=>(config.start+config.interval*i)+'점').join(' · ');
      let id=0;
      const plan=makeGoalRounds(draft,goal,config,system.records,()=>'$preview-'+ ++id);
      preview.textContent=sample+(config.count>6?' · …':'')+' ('+config.count+'개)'
        +(plan.removed?' · 기존 미완료 '+plan.removed+'개 삭제':'')
        +(plan.archived?' · 완료 회차 '+plan.archived+'개 기록 보존':'');
    }
    for(const input of inputs)input.oninput=updatePreview;
    updatePreview();
    openAction('반복 목표 설정',block,()=>{
      const config=settings();
      if(!config) {
        actionError.textContent='점수 범위와 회차를 확인해 주세요.';return false;
      }
      const plan=makeGoalRounds(draft,goal,config,system.records,()=>crypto.randomUUID());
      selected.delete(goal.id);
      draft=plan.goals.map(item=>({...item,scoreText:item.scoreText??String(item.score),message:item.message??''}));
      refreshScope();
      rows.get(plan.selected.id)?.scrollIntoView({block:'nearest'});
      return true;
    },'repeat');
  }

  async function changeTargets(targets,complete) {
    const records=targets.map(({target:{id,reached,goalId,teamId}})=>reached===null?{id,reached,goalId,teamId}:{id,reached});
    if(!records.length)return;
    if(!await submit({kind:'score-records',records,complete})) {
      const error=statusView?actionError:editError;
      error.textContent='상태를 변경하지 못했습니다. 현재 점수와 기록을 다시 확인해 주세요.';
      return;
    }
    refreshStatuses();
  }
  function showStatus(goal,milestone) {
    statusView={goal,milestone,selection:new Set()};
    const content=create('div');content.className='goal-target-status';
    openAction('달성 상태',content,null,'status');
    paintStatus(content);
  }
  function updateTargetScope(goal,targets,include) {
    const teams=teamList();
    const ids=new Set(teams.filter(team=>goalAppliesToTeam(goal,team.id)).map(team=>team.id));
    for(const {team} of targets) {
      if(include)ids.add(team.id);else ids.delete(team.id);
    }
    if(ids.size===teams.length)delete goal.teamIds;
    else goal.teamIds=teams.filter(team=>ids.has(team.id)).map(team=>team.id);
    refreshStatuses();
  }
  function statusTitle(goal,milestone) {
    const title=$('goal-action-title');
    const threshold=milestone??goal.score;
    const score=create('strong',Number.isFinite(threshold)?threshold+'점':'목표 점수');
    score.className='goal-target-threshold';
    const message=create('strong',goal.message.trim());
    title.replaceChildren(score,message);
  }
  function teamCard(team,onClick) {
    const card=button('',onClick);
    card.classList.add('goal-target-card');
    const status=create('span');status.className='goal-target-label';
    const facts=create('span');facts.className='goal-target-facts';
    facts.append(create('strong',team.name),create('span',Number.isFinite(team.score)?team.score+'점':'—'));
    card.append(status,facts);
    return card;
  }
  function paintStatus(content) {
    const {goal,selection}=statusView;
    const history=recordsFor(goal);
    const focus=document.activeElement?.dataset.statusFocus;
    content.replaceChildren();
    if (goal.automatic && !goal.archived)content.append(create('p','자동완료 사용 중'));
    if (draftChanged(goal) && !goal.archived)content.append(create('p','목표 변경은 목표 저장 후 적용됩니다.'));
    if(goal.interval || history.some(record=>record.milestone!==undefined)) {
      const rounds=[...new Set(history.map(record=>record.milestone))].sort((a,b)=>(b??Infinity)-(a??Infinity));
      if(rounds.length) {
        if(!rounds.includes(statusView.milestone))statusView.milestone=rounds[0];
        const picker=create('select');picker.setAttribute('aria-label','달성 회차');
        for(const round of rounds)picker.add(new Option(round===undefined?'한 번 달성':round+'점 회차',String(round)));
        picker.value=String(statusView.milestone);
        picker.onchange=()=>{
          statusView.milestone=rounds.find(round=>String(round)===picker.value);
          paintStatus(content);content.querySelector('select').focus();
        };
        content.append(label('달성 회차',picker));
      } else content.append(create('p','아직 달성한 회차가 없습니다.'));
    }
    statusTitle(goal,statusView.milestone);
    const targets=goalTargets(goal,history,statusView.milestone,true);
    if(!targets.length)content.append(create('p',goal.type==='team'?'등록된 모둠이 없습니다.':'완료 기록이 없습니다.'));
    const list=create('div');list.className='goal-target-list';content.append(list);
    const cases=targets.map(target=>{
      const {team,applies,state}=target, key=String(team.id);
      const card=teamCard(team,()=>{
        if(selection.has(key))selection.delete(key);else selection.add(key);
        updateActions();
      });
      card.dataset.state=applies?state:'excluded';card.dataset.statusFocus='card:'+key;
      card.disabled=!!goal.archived;
      card.querySelector('.goal-target-label').textContent=applies?labels[state]:'미적용';
      list.append(card);
      return {target,key,card};
    });
    const footer=create('div');footer.className='goal-target-actions';
    const count=create('span');count.setAttribute('aria-live','polite');
    const controls=create('div');
    const reach=button('도달'),complete=button('완료'),scope=goal.type==='team'?button('적용'):null;
    reach.dataset.statusFocus='reach';complete.dataset.statusFocus='complete';
    controls.append(reach,complete);
    if(scope){scope.dataset.statusFocus='scope';controls.append(scope);}
    footer.append(count,controls);content.append(footer);

    function updateActions() {
      const checked=cases.filter(({key})=>selection.has(key));
      for(const {key,card} of cases)card.setAttribute('aria-pressed',String(selection.has(key)));
      count.textContent=checked.length?checked.length+'개 선택':'선택 없음';
      const eligible=checked.map(({target})=>target).filter(({applies,team,state,target})=>
        applies && canChangeStatus(goal,team.id) && state!=='unreached' &&
        team.score>=(statusView.milestone??goal.score) &&
        (!goal.interval && statusView.milestone===undefined || target.reached!==null));
      const reachable=eligible.filter(({state})=>state==='done'), completable=eligible.filter(({state})=>state==='reached');
      reach.disabled=!reachable.length;complete.disabled=!completable.length;
      reach.onclick=()=>changeTargets(reachable,false);
      complete.onclick=()=>changeTargets(completable,true);
      const shouldApply=checked.some(({target})=>!target.applies);
      if(scope) {
        scope.disabled=!checked.length || !!goal.archived;
        scope.textContent=shouldApply||scope.disabled?'적용':'제외';
        scope.onclick=()=>updateTargetScope(goal,checked.map(({target})=>target),shouldApply);
      }
      const priority=shouldApply?scope:!complete.disabled?complete:!reach.disabled?reach:scope?.disabled?null:scope;
      for(const control of controls.children)control.classList.toggle('dialog-primary',control===priority && !control.disabled);
    }
    updateActions();
    if(focus) {
      const target=[...content.querySelectorAll('[data-status-focus]')].find(control=>control.dataset.statusFocus===focus);
      if(target && !target.disabled)target.focus({preventScroll:true});
    }
  }

  function refreshStatuses() {
    for(const goal of scoped()) {
      const row=rows.get(goal.id);
      if(row)refreshStatus(goal,row);
    }
    if(statusView && dialog.open)paintStatus(fields.firstElementChild);
  }
  function open(record) {
    if(!system)return;
    opener=document.activeElement;
    draft=structuredClone(system.goals).map(goal=>({...goal,scoreText:String(goal.score),message:goal.message??'',automatic:!!goal.automatic}));
    base=system.revision;
    selected.clear();
    scope=draft.find(goal=>goal.id===record?.goalId)?.type??(draft.some(goal=>goal.type==='class')||!draft.length?'class':'team');
    editError.textContent='';
    view.style.display='flex';
    modalState(true);
    refreshScope();
    const goal=record && draft.find(goal=>goal.id===record.goalId);
    if(goal) {
      rows.get(goal.id)?.scrollIntoView({block:'nearest'});
      showStatus(goal,record.milestone);
    } else $('cancel-goal-view').focus();
  }
  function close() {
    if(view.style.display!=='flex')return;
    closeAction();
    view.style.display='none';modalState(false);
    opener?.focus();opener=null;
  }
  save.onclick=async()=>{
    if(save.disabled)return;
    const goals=[];
    for(const goal of draft) {
      if(goal.score===null && !goal.scoreText.trim() && !goal.message.trim())continue;
      if(goal.score===null) {
        scope=goal.type;refreshScope();
        rows.get(goal.id).querySelector('.goal-row-score').focus();
        editError.textContent='목표 점수를 -10000~10000 사이의 정수로 입력해 주세요.';return;
      }
      const {scoreText,...fields}=goal;
      goals.push({...fields,message:goal.message.trim(),futureAutomatic:true});
    }
    save.disabled=true;editError.textContent='';
    try {
      if(await submit({kind:'score-goals',base,goals})) {confirmSave();close();}
      else editError.textContent='다른 기기에서 목표가 변경되었습니다. 창을 다시 열어 변경 사항을 확인해 주세요.';
    } finally {save.disabled=false;}
  };
  add.onclick=()=>{
    const goal={id:crypto.randomUUID(),type:scope,score:null,scoreText:'',message:'',automatic:false};
    draft.push(goal);refreshScope();
    rows.get(goal.id).querySelector('.goal-row-score').focus();
  };
  selectAll.onchange=()=>{
    for(const goal of scoped())if(!goal.archived) {
      if(selectAll.checked)selected.add(goal.id);else selected.delete(goal.id);
      rows.get(goal.id).querySelector('.goal-row-check').checked=selectAll.checked;
    }
    syncBulk();
  };
  for(const tab of tabs)tab.onclick=()=>{scope=tab.dataset.goalScope;refreshScope();};
  for(const control of view.querySelectorAll('[data-goal-bulk]'))control.onclick=()=>{
    const goals=chosen(), kind=control.dataset.goalBulk;
    if(!goals.length)return;
    if(kind==='message')editMessage(goals);
    else if(kind==='teams')editTeams(goals);
    else if(kind==='delete')deleteGoals(goals);
    else {
      for(const goal of goals)goal.automatic=kind==='auto-on';
      refreshScope();
    }
  };
  $('cancel-goal-view').onclick=$('cancel-goal-edit').onclick=close;
  view.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !dialog.open && !dialog.contains(event.target))close();
  });
  function update(model) {
    system=model;
    savedGoals=new Map(model.goals.map(goal=>[goal.id,goal]));
    savedRecords=new Map();
    for(const record of model.records) {
      if(!savedRecords.has(record.goalId))savedRecords.set(record.goalId,[]);
      savedRecords.get(record.goalId).push(record);
    }
    if(view.style.display==='flex')refreshStatuses();
  }
  return {open,close,update};
}
