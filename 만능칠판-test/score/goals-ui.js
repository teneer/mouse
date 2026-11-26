import {goalStatus,parseGoalScore,parseGoalInterval} from './goal-model.js?v=goal-queue-1';
import {celebrationSections,createGoalCelebrationQueue,mountGoalCelebration} from './goal-celebration.js?v=device-audio-1';

const $ = id => document.getElementById(id);
const button = (label,action,classes='dialog-action') => {
  const item = document.createElement('button');
  item.type = 'button';item.className=classes;item.textContent = label;item.onclick = action;
  return item;
};

export function wireGoals({submit,teamList,classScore,teamAccent,celebrate,confirmSave,modalState}) {
  const view = $('goal-management-view'), popup = $('goal-celebration');
  const localPopup=mountGoalCelebration(popup);
  const saveButton=$('close-goal-view-btn');
  const navigation=$('goal-nav-list'), detail=view.querySelector('.goal-detail');
  const scopeButtons=[...view.querySelectorAll('[data-goal-scope]')];
  const detailButtons=[...view.querySelectorAll('[data-goal-mode]')];
  let scope='class', selectedRow, opener;
  const celebrations = createGoalCelebrationQueue(celebrate);
  let records = new Map();
  let system, active, timer, editingRevision, previous;
  const dropdown=document.createElement('div');
  dropdown.className='goal-status-menu';
  dropdown.setAttribute('popover','auto');
  view.querySelector('.dialog-sheet').append(dropdown);
  let dropdownOwner;
  function closeDropdown() {
    if (dropdown.matches(':popover-open')) dropdown.hidePopover();
    dropdownOwner?.setAttribute('aria-expanded','false');
    dropdownOwner=null;
  }
  dropdown.addEventListener('toggle',event=>{
    if (event.newState==='closed' && !dropdown.matches(':popover-open')) closeDropdown();
  });
  function showDropdown(control,actions) {
    const close=dropdownOwner===control && dropdown.matches(':popover-open');
    closeDropdown();
    if (close) return;
    dropdown.replaceChildren(...actions.map(([label,action])=>{
      const item=button(label,()=>{closeDropdown();action();});
      item.disabled=!action;
      return item;
    }));
    dropdownOwner=control;
    control.setAttribute('aria-expanded','true');
    dropdown.showPopover();
    const rect=control.getBoundingClientRect(), margin=8;
    dropdown.style.left=Math.max(margin,Math.min(rect.left,innerWidth-dropdown.offsetWidth-margin))+'px';
    const below=rect.bottom+4, above=rect.top-dropdown.offsetHeight-4;
    dropdown.style.top=Math.max(margin,below+dropdown.offsetHeight<=innerHeight-margin?below:above)+'px';
  }
  window.addEventListener('resize',closeDropdown);
  $('goal-settings').addEventListener('scroll',closeDropdown);
  document.addEventListener('pointerdown',event=>{
    for (const item of view.querySelectorAll('[data-confirm-cancel]')) {
      if (!item.contains(event.target)) item.removeAttribute('data-confirm-cancel');
    }
  },true);
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
  function show(record) {
    showGroup([record]);
  }
  function showGroup(group) {
    active=group;
    const pending=group.filter(row=>row.status==='pending');
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
    if (view.style.display==='flex') refreshRows();
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
      for (const record of records) add(1,record.message||'학급 선물',()=>openSettings(record));
    } else if (records.length===1) add(1,records[0].message||'선물 지급 관리',()=>openSettings(records[0]));
    else add(records.length,`지급 대기 선물 ${records.length}개`,()=>openSettings(records[0]));
  }
  function addRow(type,goal={}) {
    const row=document.createElement('div');row.className='goal-row goal-edit-row';
    row.dataset.goal=goal.id || crypto.randomUUID();
    row.dataset.type=type;
    row.innerHTML=`
      <div class="goal-fields">
        <label class="goal-field goal-type-field"><span>유형</span><select class="goal-frequency" aria-label="목표 유형"><option value="once">한 번</option><option value="repeat">반복</option></select></label>
        <div class="goal-thresholds">
          <label class="goal-field goal-start-field"><span>목표 점수</span><input type="text" class="goal-score" autocomplete="off" spellcheck="false" aria-label="목표 점수"></label>
          <label class="goal-field goal-interval-field" hidden><span>점마다</span><input type="text" inputmode="numeric" class="goal-interval" autocomplete="off" aria-label="반복 간격"></label>
        </div>
        <label class="goal-field goal-message-field"><span>축하 메시지</span><input class="goal-message" maxlength="240" aria-label="축하 메시지"></label>
        <label class="goal-auto"><input class="goal-completion" type="checkbox" aria-label="자동 완료"><span>자동 완료</span></label>
      </div>
      <section class="goal-progress" aria-label="선물 지급 현황">
        <h3 tabindex="-1">선물 지급 현황</h3>
        <div class="goal-progress-body"></div>
      </section>`;
    const frequency = row.querySelector('.goal-frequency');
    const intervalField = row.querySelector('.goal-interval-field');
    const scoreInput = row.querySelector('.goal-score');
    frequency.value = goal.interval ? 'repeat' : 'once';
    scoreInput.value = goal.score??'';
    row.querySelector('.goal-interval').value = goal.interval??'';
    frequency.onchange = () => {
      const repeating = frequency.value === 'repeat';
      intervalField.hidden = !repeating;
      row.toggleAttribute('data-repeating',repeating);
      scoreInput.placeholder = repeating ? '첫 점수' : '';
      scoreInput.setAttribute('aria-label',repeating ? '첫 목표 점수' : '목표 점수');
      scoreInput.previousElementSibling.textContent = repeating ? '점부터' : '목표 점수';
    };
    frequency.onchange();
    row.querySelector('.goal-message').value=goal.message??'';
    row.querySelector('.goal-completion').checked=!!goal.automatic;
    const remove=button('목표 삭제',()=>{
      row.remove();
      selectGoal($(type+'-goals-list').firstElementChild, type);
    },'dialog-action dialog-danger goal-remove');
    remove.title='목표 삭제';
    remove.setAttribute('aria-label','목표 삭제');
    row.querySelector('.goal-fields').append(remove);
    row.addEventListener('input',()=>{
      const item=navigation.querySelector('[aria-current=true]');
      if(row===selectedRow && item)item.textContent=goalLabel(row);
    });
    $(type+'-goals-list').append(row);
    return row;
  }
  function goalLabel(row) {
    const score=row.querySelector('.goal-score').value.trim();
    const message=row.querySelector('.goal-message').value.trim();
    return [score && score+'점',message].filter(Boolean).join(' · ') || '새 목표';
  }
  function setDetailMode(mode) {
    detail.dataset.mode=mode;
    for (const control of detailButtons)control.setAttribute('aria-pressed',String(control.dataset.goalMode===mode));
  }
  function selectGoal(row,type) {
    scope=type;
    selectedRow=row;
    for (const control of scopeButtons)control.setAttribute('aria-pressed',String(control.dataset.goalScope===type));
    for (const item of view.querySelectorAll('.goal-edit-row'))item.hidden=item!==row;
    $('goal-empty').hidden=!!row;
    for (const control of detailButtons)control.disabled=!row;
    const items=[...$(type+'-goals-list').children].map(item=>{
      const control=button(goalLabel(item),()=>{
        selectGoal(item,type);
        navigation.querySelector('[aria-current=true]').focus();
      });
      if (item===row)control.setAttribute('aria-current','true');
      return control;
    });
    navigation.replaceChildren(...items);
    refreshRows();
  }
  function openSettings(record) {
    if (!system) return;
    opener=document.activeElement;
    editingRevision=system.revision;
    for (const type of ['class','team']) {
      $(type+'-goals-list').replaceChildren();
      system.goals.filter(goal=>goal.type===type).forEach(goal=>addRow(type,goal));
    }
    view.style.display='flex';
    modalState(true);
    const requested=system.goals.find(goal=>goal.id===record?.goalId);
    const type=requested?.type ?? (system.goals.some(goal=>goal.type==='class') || !system.goals.length?'class':'team');
    const list=$(type+'-goals-list');
    const row=[...list.children].find(item=>item.dataset.goal===requested?.id) || list.firstElementChild;
    if (row && record?.milestone!==undefined)row.dataset.round=String(record.milestone);
    setDetailMode(record?'rewards':'settings');
    $('goal-include-existing').checked=false;
    $('goal-edit-error').textContent='';
    selectGoal(row,type);
    (record && row ? row.querySelector('.goal-progress h3') : $('cancel-goal-view')).focus();
  }
  function closeView() {
    if (view.style.display!=='flex') return;
    closeDropdown();
    view.style.display='none';
    editingRevision=undefined;
    modalState(false);
    opener?.focus();
    opener=null;
  }
  async function saveGoals() {
    if (saveButton.disabled) return;
    const goals=[];
    for (const type of ['class','team']) for (const row of $(type+'-goals-list').children) {
      const input=row.querySelector('.goal-score'), score=parseGoalScore(input.value);
      const message=row.querySelector('.goal-message').value.trim();
      const repeating = row.querySelector('.goal-frequency').value === 'repeat';
      const intervalValue = row.querySelector('.goal-interval').value;
      if (!input.value.trim() && !message && (!repeating || !intervalValue.trim())) continue;
      const interval = repeating ? parseGoalInterval(intervalValue) : null;
      if (score===null || repeating && interval===null) {
        setDetailMode('settings');
        selectGoal(row,type);
        (score===null ? input : row.querySelector('.goal-interval')).focus();
        $('goal-edit-error').textContent = score===null
          ? '목표 점수를 -10000~10000 사이의 정수로 입력해 주세요.'
          : '반복 간격을 1~10000 사이의 정수로 입력해 주세요.';
        return;
      }
      goals.push({id:row.dataset.goal,type,score,message,automatic:row.querySelector('.goal-completion').checked,
        ...(repeating ? {interval} : {})});
    }
    $('goal-edit-error').textContent='';
    saveButton.disabled=true;
    try {
      if (await submit({kind:'score-goals',base:editingRevision,goals,includeExisting:$('goal-include-existing').checked})) {
        confirmSave();
        closeView();
      } else $('goal-edit-error').textContent='목표를 저장하지 못했습니다. 현재 설정을 확인한 뒤 다시 시도해 주세요.';
    } finally {saveButton.disabled=false;}
  }
  function setStatus(control,state,record) {
    const oldState=control.dataset.status;
    const label=state==='done'?'✓ 완료':state==='reached'?'도달':'미도달';
    control.dataset.status=state;
    if (state!==oldState) control.removeAttribute('data-confirm-cancel');
    control.innerHTML='<span class="goal-status-text"></span><span class="goal-cancel-text">완료 취소</span>';
    control.querySelector('.goal-status-text').textContent=label;
    control.setAttribute('aria-label',state==='done'?'완료, 누르면 완료 취소':label);
    control.classList.toggle('goal-dropdown-trigger',state!=='done');
    if (state!=='done') control.setAttribute('aria-expanded','false');
    else control.removeAttribute('aria-expanded');
    control.onpointerdown=event=>{control.dataset.pointer=event.pointerType;};
    control.onclick=event=>{
      if (state==='done') {
        if (event.detail>0 && control.dataset.pointer==='touch' && !control.hasAttribute('data-confirm-cancel')) {
          control.dataset.confirmCancel='';
          return;
        }
        control.removeAttribute('data-confirm-cancel');
        change([record],false);
      } else if (state==='reached') showDropdown(control,[
        ['완료 처리',()=>change([record],true)],['메시지 보기',()=>show(record)]
      ]);
      else showDropdown(control,[['목표 점수에 도달하면 완료할 수 있습니다.',null]]);
    };
  }

  function describeTarget(goal,team,record) {
    const state=goalStatus(goal,team.score,record);
    const target=record?.status==='done'||record?.status==='pending' ? record : {
      id:JSON.stringify([goal.id,team.id]),reached:record?.reached??null,goalId:goal.id,teamId:team.id,
      status:'pending',type:goal.type,score:goal.score,achievedScore:team.score,message:goal.message,teamName:team.name
    };
    return {team,state,target};
  }

  function renderTargets(body,groups,selected) {
    const list=document.createElement('div');
    list.className='goal-team-list';
    body.append(list);
    const checks=[];
    for (const {team,state,target} of groups) {
      const item=document.createElement('div');
      item.className='goal-team-progress';
      if (state==='done')item.dataset.done='true';
      const check=document.createElement('input');
      check.type='checkbox';check.disabled=state==='unreached';check.value=target.id;
      check.checked=!check.disabled&&selected.has(target.id);check.setAttribute('aria-label',team.name+' 선택');
      if (!check.disabled)checks.push({check,target,state});
      const name=document.createElement('strong');name.textContent=team.name;
      const control=button('',null,'dialog-action goal-status');
      setStatus(control,state,target);
      item.append(check,name,control);list.append(item);
    }
    if (!checks.length)return;
    const actions=document.createElement('div');actions.className='goal-tabs';
    if (checks.some(({state})=>state==='reached'))actions.append(button('도달 대상 전체선택',()=>{
      for (const {check,state} of checks)check.checked=state==='reached';
    }));
    for (const complete of [true,false]) {
      const state=complete?'reached':'done';
      if (checks.some(item=>item.state===state))actions.append(button(complete?'선택 완료':'선택 완료 취소',()=>{
        change(checks.filter(item=>item.check.checked && item.state===state).map(({target})=>target),complete);
      },complete?'dialog-action dialog-primary':'dialog-action'));
    }
    body.append(actions);
  }

  function renderRecurringRows(row,body,history,selected) {
    if (!history.length) {
      body.append('아직 달성한 회차가 없습니다.');
      return;
    }
    const rounds=new Map();
    for (const record of history) {
      const round=record.milestone===undefined?'once':String(record.milestone);
      if (!rounds.has(round))rounds.set(round,[]);
      rounds.get(round).push(record);
    }
    const keys=[...rounds.keys()].sort((a,b)=>a==='once'?1:b==='once'?-1:Number(b)-Number(a));
    const current=keys.includes(row.dataset.round)?row.dataset.round:
      keys.find(key=>rounds.get(key).some(record=>record.status==='pending'))??keys[0];
    row.dataset.round=current;
    const picker=document.createElement('select');
    picker.setAttribute('aria-label','달성 회차');
    for (const key of keys) {
      const pending=rounds.get(key).filter(record=>record.status==='pending').length;
      const label=key==='once'?'한 번 달성':key+'점 회차';
      picker.add(new Option(label+(pending?' · 지급 대기 '+pending:''),key,key===current,key===current));
    }
    picker.onchange=()=>{
      row.dataset.round=picker.value;
      refreshRows();
      body.querySelector('select').focus();
    };
    const label=document.createElement('label');
    label.className='goal-round-picker';
    label.append('달성 회차',picker);
    body.append(label);
    const names=new Map(teamList().map(team=>[team.id,team.name]));
    renderTargets(body,rounds.get(current).map(record=>({
      team:{name:record.teamId===null?'학급':names.get(record.teamId)??record.teamName??'모둠'},
      state:record.status==='pending'?'reached':record.status==='done'?'done':'unreached',
      target:record
    })),selected);
  }

  function refreshRows() {
    closeDropdown();
    const row=selectedRow;
    if (!row) return;
    const body=row.querySelector('.goal-progress-body');
    const selected=new Set([...body.querySelectorAll('input:checked')].map(input=>input.value));
    body.replaceChildren();
    const goal=system.goals.find(item=>item.id===row.dataset.goal);
    if (!goal) {
      body.append('목표를 저장하면 지급 현황을 확인할 수 있습니다.');
      return;
    }
    const history=system.records.filter(record=>record.goalId===goal.id);
    if (goal.interval || history.some(record=>record.milestone!==undefined)) {
      renderRecurringRows(row,body,history,selected);
      return;
    }
    const found=new Map(history.map(record=>[record.teamId,record]));
    const targets=goal.type==='class'?[{id:null,name:'학급',score:classScore()}]:teamList();
    if (!targets.length)body.append('등록된 모둠이 없습니다.');
    else renderTargets(body,targets.map(team=>describeTarget(goal,team,found.get(team.id))),selected);
  }

  for (const control of scopeButtons)control.onclick=()=>{
    const type=control.dataset.goalScope;
    if (type!==scope) selectGoal($(type+'-goals-list').firstElementChild,type);
  };
  for (const control of detailButtons)control.onclick=()=>setDetailMode(control.dataset.goalMode);
  $('goal-add-selected').onclick=()=>{
    const row=addRow(scope);
    setDetailMode('settings');
    selectGoal(row,scope);
    row.querySelector('.goal-score').focus();
  };

  view.addEventListener('keydown',event=>{
    if (event.key==='Escape' && !dropdown.matches(':popover-open'))closeView();
  });
  saveButton.onclick=saveGoals;
  $('cancel-goal-view').onclick=$('cancel-goal-edit').onclick=closeView;
  return {openSettings,update,giftGroup,reset(){celebrations.reset();close();previous=null;closeView();}};
}
