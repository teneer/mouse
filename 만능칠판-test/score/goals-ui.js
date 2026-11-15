import {parseGoalScore} from './goal-model.js?v=celebration-1';
import {mountGoalCelebration} from './goal-celebration.js';

const $ = id => document.getElementById(id);
const button = (label,action,classes='dialog-action') => {
  const item = document.createElement('button');
  item.type = 'button';item.className=classes;item.textContent = label;item.onclick = action;
  return item;
};

export function wireGoals({submit,teamList,teamAccent,celebrate,confirmSave}) {
  const view = $('goal-management-view'), popup = $('goal-celebration');
  const showLocalPopup=mountGoalCelebration(popup);
  const saveButton=$('close-goal-view-btn');
  const queue = [];
  let system, active, timer, editingRevision, previous;
  const modalState = open => {
    document.body.classList.toggle('goals-modal-open',open);
    window.frameElement?.dispatchEvent(new CustomEvent('score-goals-modal',{detail:open}));
  };
  const central=$('goal-central-popup');
  try {central.checked=localStorage.getItem('whiteboard.goal-central')==='1';} catch {}
  central.onchange=()=>{try {localStorage.setItem('whiteboard.goal-central',central.checked?'1':'0');} catch {}};
  const emitPopup = detail => window.frameElement?.dispatchEvent(new CustomEvent('score-celebration',{detail}));
  const visible = () => !window.frameElement?.closest('[aria-hidden="true"]');
  function show(record, replay) {
    if (!visible() && !(central.checked && window.frameElement)) return;
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
    if (central.checked && window.frameElement) {
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
    return submit({kind:'score-records',records:records.map(({id,reached})=>({id,reached})),complete});
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
      const control=button(teamId===null?'🎁':'',action,'');
      control.title=title;control.setAttribute('aria-label',title);
      if (teamId!==null) {
        const gift=document.createElement('span');
        gift.className='team-gift-mark';gift.setAttribute('aria-hidden','true');
        gift.innerHTML='<span class="team-gift-bow"></span>';
        control.append(gift);
      }
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
    status.onclick=()=>setExpanded(row,progress.hidden);
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
      setExpanded(row,true);
      row.scrollIntoView({block:'nearest'});
    } else show(record,true);
  }
  function closeView() {
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
  function refreshRows() {
    for (const row of view.querySelectorAll('.goal-edit-row')) {
      const goal=system.goals.find(item=>item.id===row.dataset.goal);
      if (!goal) continue;
      const body=row.querySelector('.goal-progress-body');
      const found=new Map(system.records.filter(rec=>rec.goalId===goal.id).map(rec=>[rec.teamId,rec]));
      const teams=goal.type==='class'?[{id:null,name:'학급'}]:teamList();
      const finished=teams.filter(team=>found.get(team.id)?.status==='done').length;
      row.querySelector('.goal-status-text').textContent=goal.type==='class'
        ? (finished?'✓ 완료':found.get(null)?.status==='pending'?'달성 · 완료 대기':'미달성')
        : (finished && finished===teams.length?'✓ ':'')+finished+'/'+teams.length+' 완료';
      const selected=new Set([...body.querySelectorAll('input:checked')].map(input=>input.value));
      body.replaceChildren();
      const checks=[];
      for (const team of teams) {
        const record=found.get(team.id), done=record?.status==='done', pending=record?.status==='pending';
        const item=document.createElement('div');
        item.className='goal-team-progress';
        if (done) item.dataset.done='true';
        const check=document.createElement('input');
        check.type='checkbox';check.disabled=!(done||pending);
        if (!check.disabled) {
          check.value=record.id;check.checked=selected.has(record.id);
          checks.push({check,record});
        }
        check.setAttribute('aria-label',team.name+' 선택');
        const name=document.createElement('strong'), state=document.createElement('span'), actions=document.createElement('div');
        name.textContent=team.name;
        state.textContent=done?'✓ 완료':pending?'완료 대기':'미달성';
        actions.className='goal-team-actions';
        if (done||pending) actions.append(button(done?'완료 취소':'완료 처리',()=>change([record],!done),
          done?'dialog-action':'dialog-action dialog-primary'));
        if (pending) actions.append(button('메시지 보기',()=>show(record,true)));
        item.append(check,name,state,actions);
        body.append(item);
      }
      if (goal.type==='team' && checks.length) {
        const actions=document.createElement('div');actions.className='goal-tabs';
        actions.append(button('완료 대기 전체선택',()=>checks.forEach(({check,record})=>{check.checked=record.status==='pending';})));
        for (const complete of [true,false]) actions.append(button(complete?'선택 완료':'선택 완료 취소',()=>{
          change(checks.filter(({check,record})=>check.checked && record.status===(complete?'pending':'done')).map(({record})=>record),complete);
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
