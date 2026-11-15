const $ = id => document.getElementById(id);
const statuses = {pending:'미완료',done:'완료',withdrawn:'회수됨'};
const button = (label,action) => {
  const item = document.createElement('button');
  item.type = 'button';item.textContent = label;item.onclick = action;
  return item;
};

export function wireGoals({submit,teamList,celebrate}) {
  const view = $('goal-management-view'), popup = $('goal-celebration');
  const chosen = new Set(), queue = [];
  let system, active, timer, editingRevision, specificTeam, previous;
  const gifts = {class:'🎁',team:'📦'};

  function message(record) {
    return record.type === 'team' ? record.teamName + ' ' + record.message : record.message;
  }
  function show(record, replay) {
    active=record;
    $('goal-celebration-title').textContent = record.type === 'class' ? '학급 목표 달성' : '모둠 목표 달성';
    $('goal-celebration-message').textContent = message(record);
    const use=$('goal-celebration-use');
    use.hidden=record.status!=='pending';
    use.textContent=record.reward?'보상 사용 처리':'확인 완료';
    popup.dataset.type=record.type;
    popup.hidden=false;
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
    clearTimeout(timer);active=null;popup.hidden=true;advance();
  }
  function update(model, announce) {
    system=model;
    if (active) {
      const latest=system.records.find(row=>row.id===active.id);
      if (!latest || latest.status==='withdrawn' || active.status==='pending' && latest.status==='done') close();
    }
    if (announce && previous) {
      const seen=new Map(previous.records.map(row=>[row.id,row.reached]));
      for (const row of system.records) {
        if (!row.silent && row.status!=='withdrawn' && row.reached!==seen.get(row.id)) queue.push(row);
      }
    }
    previous=structuredClone(system);
    advance();
    if (view.style.display==='flex' && !$('goal-records').hidden) renderRecords();
  }
  function change(records,complete) {
    submit({kind:'score-records',records:records.map(({id,reached})=>({id,reached})),complete});
  }
  $('goal-celebration-close').onclick=close;
  $('goal-celebration-use').onclick=()=>{if (active) {change([active],true);if (active)close();}};

  function giftGroup(parent,teamId=null) {
    if (!parent) return;
    parent.replaceChildren();
    const records=system?.records.filter(row=>row.teamId===teamId && row.status==='pending') || [];
    parent.hidden=!records.length;
    const type=teamId===null?'class':'team', icon=gifts[type];
    if (!records.length) return;
    const add=(label,title,action)=>{
      const control=button(label,action);control.title=title;control.setAttribute('aria-label',title);
      parent.append(control);
    };
    if (type==='class' && records.length<=2) {
      for (const record of records) add(icon,record.message,()=>show(record,true));
    } else if (records.length===1) add(icon,records[0].message,()=>show(records[0],true));
    else add(icon+'×'+records.length,`달성 기록 ${records.length}개`,()=>openRecords(teamId));
  }
  function addRow(type,goal={}) {
    const row=document.createElement('div');row.className='goal-row goal-edit-row';
    row.dataset.goal=goal.id || crypto.randomUUID();
    row.innerHTML='<input type="number" class="goal-score" min="-10000" max="10000" aria-label="기준 점수"><input class="goal-message" maxlength="240" aria-label="축하 문구"><select class="goal-completion" aria-label="완료 방식"><option value="manual">교사가 직접 완료</option><option value="auto">자동 완료</option></select><label><input class="goal-reward" type="checkbox"> 보상 있음</label>';
    row.querySelector('.goal-score').value=goal.score??'';
    row.querySelector('.goal-message').value=goal.message??'';
    row.querySelector('.goal-completion').value=goal.automatic?'auto':'manual';
    row.querySelector('.goal-reward').checked=!!goal.reward;
    row.append(button('삭제',()=>row.remove()));
    $(type+'-goals-list').append(row);
  }
  function openSettings() {
    if (!system) return;
    editingRevision=system.revision;
    for (const type of ['class','team']) {
      $(type+'-goals-list').replaceChildren();
      system.goals.filter(goal=>goal.type===type).forEach(goal=>addRow(type,goal));
    }
    $('goal-settings').hidden=false;$('goal-records').hidden=true;view.style.display='flex';
  }
  function showSettingsTab() {
    if (editingRevision===undefined) {openSettings();return;}
    $('goal-settings').hidden=false;$('goal-records').hidden=true;
  }
  function openRecords(teamId) {
    specificTeam=teamId;
    $('goal-status-filter').value='pending';
    $('goal-settings').hidden=true;$('goal-records').hidden=false;
    view.style.display='flex';chosen.clear();renderRecords();
  }
  function closeView() {view.style.display='none';editingRevision=undefined;chosen.clear();}
  function saveGoals() {
    const goals=[];
    for (const type of ['class','team']) for (const row of $(type+'-goals-list').children) {
      const input=row.querySelector('.goal-score'), score=input.valueAsNumber;
      const message=row.querySelector('.goal-message').value.trim();
      if (!input.value && !message) continue;
      if (!Number.isInteger(score) || score < -10000 || score > 10000 || !message) {
        $('goal-edit-error').textContent='기준 점수와 축하 문구를 입력해 주세요.';return;
      }
      goals.push({id:row.dataset.goal,type,score,message,automatic:row.querySelector('.goal-completion').value==='auto',
        reward:row.querySelector('.goal-reward').checked});
    }
    $('goal-edit-error').textContent='';
    submit({kind:'score-goals',base:editingRevision,goals,includeExisting:$('goal-include-existing').checked});
    closeView();
  }
  function renderRecords() {
    const filter=$('goal-target-filter'), status=$('goal-status-filter').value;
    const options=new Map([['all','전체 대상'],['class','학급'],['teams','전체 모둠']]);
    for (const team of teamList()) options.set('team:'+team.id,team.name);
    for (const row of system.records) if (row.teamId && !options.has('team:'+row.teamId)) options.set('team:'+row.teamId,row.teamName);
    const target=specificTeam!==undefined ? specificTeam===null?'class':'team:'+specificTeam : filter.value;
    specificTeam=undefined;
    filter.replaceChildren(...[...options].map(([value,label])=>new Option(label,value)));
    filter.value=options.has(target)?target:'all';
    const records=system.records.filter(row=>(status==='all'||row.status===status) &&
      (filter.value==='all'||filter.value===row.type||filter.value==='teams'&&row.type==='team'||filter.value==='team:'+row.teamId));
    const sort=$('goal-sort').value;
    records.sort((a,b)=>sort==='score'?a.score-b.score:(sort==='old'?1:-1)*((a.time||0)-(b.time||0)));
    const list=$('goal-record-list');
    list.replaceChildren();
    if (!records.length) list.textContent='표시할 달성 기록이 없습니다.';
    for (const row of records) {
      const item=document.createElement('article'), title=document.createElement('strong'), text=document.createElement('p');
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=chosen.has(row.id);
      checkbox.disabled=row.status==='withdrawn'||row.automatic;
      checkbox.setAttribute('aria-label',message(row)+' 선택');
      checkbox.onchange=()=>{if (checkbox.checked) chosen.add(row.id);else chosen.delete(row.id);};
      title.textContent=(row.teamName||'학급')+' · '+row.score+'점 · '+statuses[row.status];
      text.textContent=row.message;
      item.append(checkbox,title,text);
      if (row.status!=='withdrawn') item.append(button('메시지 보기',()=>show(row,true)));
      if (row.status==='pending') item.append(button(row.reward?'보상 사용':'확인 완료',()=>change([row],true)));
      if (row.status==='done'&&!row.automatic) item.append(button('되돌리기',()=>change([row],false)));
      list.append(item);
    }
    for (const [id,complete] of [['goal-complete-selected',true],['goal-undo-selected',false]]) {
      $(id).onclick=()=>{change(records.filter(row=>chosen.has(row.id) && (complete?row.status==='pending':row.status==='done')),complete);chosen.clear();};
    }
  }
  $('goal-settings-tab').onclick=showSettingsTab;
  $('goal-records-tab').onclick=()=>openRecords();
  for (const id of ['goal-status-filter','goal-target-filter','goal-sort']) $(id).onchange=()=>{chosen.clear();renderRecords();};
  $('goal-management-view').querySelectorAll('.add-row-btn').forEach(control=>{control.onclick=()=>addRow(control.dataset.type);});
  $('close-goal-view-btn').onclick=saveGoals;
  $('cancel-goal-view').onclick=$('cancel-goal-edit').onclick=closeView;
  return {openSettings,update,giftGroup,reset(){queue.length=0;close();previous=null;closeView();}};
}
