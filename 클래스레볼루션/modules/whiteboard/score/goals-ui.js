import {goalStatus,parseGoalScore} from './goal-model.js?v=goal-status-1';
import {mountGoalCelebration} from './goal-celebration.js';

const $ = id => document.getElementById(id);
const button = (label,action,classes='dialog-action') => {
  const item = document.createElement('button');
  item.type = 'button';item.className=classes;item.textContent = label;item.onclick = action;
  return item;
};

export function wireGoals({submit,teamList,classScore,teamAccent,celebrate,confirmSave}) {
  const view = $('goal-management-view'), popup = $('goal-celebration');
  const showLocalPopup=mountGoalCelebration(popup);
  const saveButton=$('close-goal-view-btn');
  const queue = [];
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
  const modalState = open => {
    document.body.classList.toggle('score-modal-open',open);
    window.frameElement?.dispatchEvent(new CustomEvent('score-management-modal',{detail:open}));
  };
  const emitPopup = detail => window.frameElement?.dispatchEvent(new CustomEvent('score-celebration',{detail}));
  function show(record, replay) {
    active=record;
    const complete=record.status==='pending'?async ()=>{
      const accepted=await change([record],true);
      if (accepted && active===record) close();
      return accepted;
    }:null;
    const score=String(record.achievedScore??record.score)+'점';
    const detail={
      type:record.type,
      title:record.type==='class'?'학급 목표 달성':'모둠 목표 달성',
      achievement:record.type==='team'?(record.teamName||'모둠')+' · '+score:score,
      message:record.message,
      accent:record.type==='team'?teamAccent(record.teamId):null,
      close,complete
    };
    if (window.frameElement) {
      showLocalPopup(null);
      emitPopup(detail);
    } else {
      emitPopup(null);
      showLocalPopup(detail);
    }
    clearTimeout(timer);timer=setTimeout(close,4000);
    if (!replay) celebrate();
  }
  function advance() {
    while (!active && queue.length) {
      const pending=queue.shift();
      const record=system.records.find(row=>row.id===pending.id && row.reached===pending.reached);
      if (record && record.status!=='withdrawn' && (record.status==='pending' || record.automatic)) show(record,false);
    }
  }
  function close() {
    clearTimeout(timer);active=null;showLocalPopup(null);emitPopup(null);advance();
  }
  function update(model, announce) {
    system=model;
    if (active) {
      const latest=system.records.find(row=>row.id===active.id);
      if (!latest || latest.reached!==active.reached || latest.status==='withdrawn' || active.status==='pending' && latest.status==='done') close();
    }
    if (announce && previous) {
      const seen=new Map(previous.records.map(row=>[row.id,row.reached]));
      for (const row of system.records) {
        if (!row.silent && row.status!=='withdrawn' && row.reached!==seen.get(row.id)) queue.push(row);
      }
    }
    previous=structuredClone(system);
    advance();
    if (view.style.display==='flex') refreshRows();
  }
  function change(records,complete) {
    if (!records.length) return;
    return submit({kind:'score-records',records:records.map(({id,reached,goalId,teamId})=>
      reached===null?{id,reached,goalId,teamId}:{id,reached}),complete});
  }
  document.addEventListener('pointerdown',event=>{
    window.frameElement?.dispatchEvent(new Event('score-frame-pointer'));
    if (active && !popup.contains(event.target)) close();
  },true);
  window.frameElement?.addEventListener('score-dismiss-celebration',()=>{if (active) close();});
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
      for (const record of records) add(1,record.message,()=>show(record,true));
    } else if (records.length===1) add(1,records[0].message,()=>show(records[0],true));
    else add(records.length,`달성 기록 ${records.length}개`,()=>openRecords(teamId));
  }
  function addRow(type,goal={}) {
    const row=document.createElement('div');row.className='goal-row goal-edit-row';
    row.dataset.goal=goal.id || crypto.randomUUID();
    row.dataset.type=type;
    row.innerHTML=`
      <div class="goal-fields">
        <label class="goal-field"><span>목표 점수</span><input type="text" class="goal-score" autocomplete="off" spellcheck="false" aria-label="목표 점수"></label>
        <label class="goal-field"><span>축하 메시지</span><input class="goal-message" maxlength="240" aria-label="축하 메시지"></label>
        <label class="goal-auto"><input class="goal-completion" type="checkbox" aria-label="자동 완료"><span>자동 완료</span></label>
        <button type="button" class="dialog-action goal-status" aria-expanded="false"><span class="goal-status-text">새 목표</span></button>
      </div>
      <div class="goal-progress" hidden>
        <div class="goal-progress-body"></div>
      </div>`;
    row.querySelector('.goal-score').value=goal.score??'';
    row.querySelector('.goal-message').value=goal.message??'';
    row.querySelector('.goal-completion').checked=!!goal.automatic;
    const remove=button('×',()=>row.remove(),'dialog-action dialog-danger goal-remove');
    remove.title='목표 삭제';
    remove.setAttribute('aria-label','목표 삭제');
    row.querySelector('.goal-fields').append(remove);
    const progress=row.querySelector('.goal-progress'), status=row.querySelector('.goal-status');
    progress.id='goal-details-'+row.dataset.goal;
    status.setAttribute('aria-controls',progress.id);
    status.onclick=()=>{if(type==='team')setExpanded(row,progress.hidden);};
    $(type+'-goals-list').append(row);
  }
  function setExpanded(row,expanded) {
    row.querySelector('.goal-progress').hidden=!expanded;
    row.querySelector('.goal-status').setAttribute('aria-expanded',String(expanded));
  }
  function openSettings() {
    if (!system) return;
    editingRevision=system.revision;
    for (const type of ['class','team']) {
      $(type+'-goals-list').replaceChildren();
      system.goals.filter(goal=>goal.type===type).forEach(goal=>addRow(type,goal));
    }
    view.style.display='flex';
    modalState(true);
    refreshRows();
    $('cancel-goal-view').focus();
  }
  function openRecords(teamId) {
    openSettings();
    const record=system.records.find(row=>row.teamId===teamId && row.status==='pending');
    if (!record) return;
    const row=[...view.querySelectorAll('.goal-edit-row')].find(item=>item.dataset.goal===record.goalId);
    if (row) {
      row.scrollIntoView({block:'nearest'});
      if (row.dataset.type==='team') setExpanded(row,true);
      else row.querySelector('.goal-status').click();
    } else show(record,true);
  }
  function closeView() {
    closeDropdown();
    view.style.display='none';
    editingRevision=undefined;
    modalState(false);
  }
  async function saveGoals() {
    if (saveButton.disabled) return;
    const goals=[];
    for (const type of ['class','team']) for (const row of $(type+'-goals-list').children) {
      const input=row.querySelector('.goal-score'), score=parseGoalScore(input.value);
      const message=row.querySelector('.goal-message').value.trim();
      if (!input.value.trim() && !message) continue;
      if (score===null || !message) {
        $('goal-edit-error').textContent='목표 점수는 -10000~10000 사이의 정수로 입력하고 축하 메시지를 작성해 주세요.';return;
      }
      goals.push({id:row.dataset.goal,type,score,message,automatic:row.querySelector('.goal-completion').checked});
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
        ['완료 처리',()=>change([record],true)],['메시지 보기',()=>show(record,true)]
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

  function refreshRows() {
    closeDropdown();
    for (const row of view.querySelectorAll('.goal-edit-row')) {
      const goal=system.goals.find(item=>item.id===row.dataset.goal);
      if (!goal) continue;
      const found=new Map(system.records.filter(rec=>rec.goalId===goal.id).map(rec=>[rec.teamId,rec]));
      const status=row.querySelector('.goal-status');
      if (goal.type==='class') {
        const info=describeTarget(goal,{id:null,name:'학급',score:classScore()},found.get(null));
        row.querySelector('.goal-progress').hidden=true;
        status.removeAttribute('aria-controls');
        setStatus(status,info.state,info.target);
        continue;
      }
      const body=row.querySelector('.goal-progress-body');
      const groups=teamList().map(team=>describeTarget(goal,team,found.get(team.id)));
      const finished=groups.filter(info=>info.state==='done').length;
      status.querySelector('.goal-status-text').textContent=
        (finished && finished===groups.length?'✓ ':'')+finished+'/'+groups.length+' 완료';
      const selected=new Set([...body.querySelectorAll('input:checked')].map(input=>input.value));
      body.replaceChildren();
      const list=document.createElement('div');
      list.className='goal-team-list';
      body.append(list);
      const checks=[];
      for (const {team,state,target} of groups) {
        const item=document.createElement('div');
        item.className='goal-team-progress';
        if (state==='done') item.dataset.done='true';
        const check=document.createElement('input');
        check.type='checkbox';check.disabled=state==='unreached';check.value=target.id;
        check.checked=!check.disabled&&selected.has(target.id);check.setAttribute('aria-label',team.name+' 선택');
        if (!check.disabled) checks.push({check,target,state});
        const name=document.createElement('strong');name.textContent=team.name;
        const control=button('',null,'dialog-action goal-status');
        setStatus(control,state,target);
        item.append(check,name,control);list.append(item);
      }
      if (checks.length) {
        const actions=document.createElement('div');actions.className='goal-tabs';
        actions.append(button('도달 모둠 전체선택',()=>checks.forEach(({check,state})=>{check.checked=state==='reached';})));
        for (const complete of [true,false]) actions.append(button(complete?'선택 완료':'선택 완료 취소',()=>{
          change(checks.filter(({check,state})=>check.checked && state===(complete?'reached':'done')).map(({target})=>target),complete);
        },complete?'dialog-action dialog-primary':'dialog-action'));
        body.append(actions);
      }
    }
  }
  $('goal-management-view').querySelectorAll('.add-row-btn').forEach(control=>{control.onclick=()=>addRow(control.dataset.type);});
  saveButton.onclick=saveGoals;
  $('cancel-goal-view').onclick=$('cancel-goal-edit').onclick=closeView;
  return {openSettings,update,giftGroup,reset(){queue.length=0;close();previous=null;closeView();}};
}
