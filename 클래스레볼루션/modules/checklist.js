import { getAll, transact, requestResult } from '../core/db.js';
import { stillAvatar } from '../core/avatar.js';
import { escapeHtml as esc } from '../core/text.js';
import { mountScoreComposer } from '../core/score-composer.js';

const TYPES = {
  symbol: { label: '◎○△×', color: '#efa34a', values: ['◎', '○', '△', '×'] },
  rating: { label: '1–5', color: '#7c8acb', values: [5, 4, 3, 2, 1] },
  check: { label: '✓', color: '#e56d98', values: [true] },
  score: { label: 'Score', color: '#7fa657', values: [] }
};
const localDate = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
const dateOffset = (date, days) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return localDate(d); };
const labelValue = value => value === true ? '✓' : String(value);
const typeOf = def => TYPES[def.inputType] || TYPES.score;

export function mountChecklist(root, { classId, bus }) {
  let date = localDate(new Date()), students = [], definitions = [], entries = [], revision = 0, busy = false;
  let focusedStudent = '', filterDefinition = '', filterValue = null, notice = '';
  const selected = new Set();
  let entryWrites = Promise.resolve();
  root.innerHTML = '<div class="roll-surface"></div><dialog class="student-dialog roll-dialog"></dialog>';
  const surface = root.querySelector('.roll-surface');
  const dialog = root.querySelector('.roll-dialog');
  const composer = mountScoreComposer(root, { classId, bus, onApplied: () => { selected.clear(); filterDefinition = ''; notice = '선택한 학생에게 점수를 지급했습니다.'; render(); } });

  async function refresh() {
    const request = ++revision;
    const data = await Promise.all(['students','checklistDefinitions','checklistEntries'].map(getAll));
    if (request !== revision) return;
    students = data[0].filter(s => s.classId === classId && s.status !== 'deleted').sort((a,b) => a.number - b.number);
    definitions = data[1].filter(d => d.classId === classId).sort((a,b) => (a.order || 0) - (b.order || 0));
    entries = data[2].filter(e => e.classId === classId && e.date === date);
    for (const id of selected) if (!students.some(s => s.id === id)) selected.delete(id);
    render();
  }
  const entryFor = (sid,did) => entries.find(e => e.studentId === sid && e.definitionId === did);
  const activeDefinitions = () => definitions.filter(d => !d.archived);

  function week() {
    const day = new Date(date + 'T12:00:00').getDay();
    const monday = dateOffset(date, -(day + 6) % 7);
    return '<div class="roll-week"><button data-roll="week-prev" aria-label="이전 주">‹</button>' +
      Array.from({length:7}, (_,i) => {
        const value = dateOffset(monday,i), d = new Date(value + 'T12:00:00');
        return '<button data-roll="day" data-date="' + value + '" aria-pressed="' + (date === value) + '"><b>' + '월화수목금토일'[i] +
          '</b><small>' + (d.getMonth()+1) + '월 ' + d.getDate() + '일</small></button>';
      }).join('') + '<button data-roll="week-next" aria-label="다음 주">›</button></div>';
  }

  function cell(student, def) {
    const value = entryFor(student.id,def.id)?.value;
    const attrs = ' data-student="' + esc(student.id) + '" data-definition="' + esc(def.id) + '"';
    const label = esc(student.name + ' ' + def.title);
    if (def.inputType === 'score') return '<input class="roll-number' + (value != null ? ' has-value' : '') + '" type="number" min="0" max="100" step="1"' +
      attrs + ' value="' + esc(value ?? '') + '" aria-label="' + label + '">';
    return '<div class="roll-choices">' + typeOf(def).values.map((option,i) => '<button data-roll="cell"' + attrs +
      ' data-value="' + esc(option) + '" class="roll-choice value-' + i + (value === option ? ' is-set' : '') + '" aria-pressed="' + (value === option) +
      '" aria-label="' + label + ' ' + labelValue(option) + '">' + labelValue(option) + '</button>').join('') + '</div>';
  }

  function column(def) {
    const kind = typeOf(def);
    const present = students.map(s => entryFor(s.id,def.id)?.value).filter(v => v != null && v !== false && v !== '');
    const counts = kind.values.map(v => present.filter(x => x === v).length);
    return '<section class="roll-column kind-' + esc(def.inputType) + '" style="--column-color:' + kind.color + '">' +
      '<header><button data-roll="edit" data-id="' + esc(def.id) + '"><strong>' + esc(def.title) + '</strong><span>' + kind.label + '</span></button></header>' +
      '<div class="roll-filter" aria-label="' + esc(def.title) + ' 값으로 대상 선택">' +
      (kind.values.length ? kind.values.map((value,i) => '<button data-roll="filter" data-id="' + esc(def.id) + '" data-value="' + esc(value) +
        '" aria-label="' + esc(def.title + ' ' + labelValue(value) + ' 학생 선택') + '" aria-pressed="' +
        (filterDefinition === def.id && filterValue === value) + '">' + labelValue(value) + '</button>').join('') :
        '<label>값 <input type="number" min="0" max="100" aria-label="' + esc(def.title) + ' 대상 값" data-filter="' + esc(def.id) + '"></label><button data-roll="filter-score" data-id="' + esc(def.id) + '">선택</button>') +
      '</div><div class="roll-column-rows">' + students.map(s => '<div class="roll-row' + (selected.has(s.id) ? ' is-selected' : '') + '">' + cell(s,def) + '</div>').join('') +
      '</div><footer>' + (kind.values.length ? '<div class="roll-counts">' + counts.map((n,i) => '<span class="value-' + i + '">' + n + '</span>').join('') + '</div>' :
        '<div>합계 ' + present.reduce((sum,v) => sum + Number(v || 0),0) + '</div>') +
      '<small>' + present.length + ' / ' + students.length + '명</small></footer></section>';
  }

  function render() {
    const previousScroll = surface.querySelector('.roll-scroll');
    const scrollPosition = [previousScroll?.scrollLeft || 0, previousScroll?.scrollTop || 0];
    const focused = students.find(s => s.id === focusedStudent);
    const defs = activeDefinitions();
    surface.innerHTML = '<header class="roll-toolbar">' + week() + '<button class="roster-control" data-roll="manage">할 일 리스트 수정</button></header>' +
      '<div class="roll-scroll"><div class="roll-matrix"><section class="roll-names"><h2>학생목록</h2><div class="roll-filter"><button data-roll="all">' +
      (selected.size ? selected.size + '명 선택취소' : '전체선택') + '</button></div><div>' + students.map(s =>
        '<div class="roll-row' + (selected.has(s.id) ? ' is-selected' : '') + '"><label><input type="checkbox" data-select="' + esc(s.id) + '"' + (selected.has(s.id) ? ' checked' : '') +
        '><small>' + esc(s.number) + '</small><span>' + esc(s.name) + '</span></label></div>').join('') +
      (!students.length ? '<button data-roll="students" class="roster-control">학생 등록</button>' : '') + '</div></section>' + defs.map(column).join('') +
      '<button class="roll-add-column" data-roll="add"><b>＋</b>할 일을<br>추가해 주세요.</button></div></div>' +
      '<aside class="roll-student-preview">' + (focused ? stillAvatar(focused.avatarId) + '<strong>' + esc(focused.name) + '</strong>' : '') + '</aside>' +
      '<footer class="roll-actions"><p role="status">' + esc(notice || '기록한 값은 개인점수에 자동 반영되지 않습니다.') + '</p><strong>' + selected.size + '명 선택</strong>' +
      '<button class="score-award" data-roll="reward"' + (!selected.size ? ' disabled' : '') + '>선택한 학생에게 점수 지급</button></footer>';
    const scroller = surface.querySelector('.roll-scroll');
    scroller.scrollLeft = scrollPosition[0]; scroller.scrollTop = scrollPosition[1];
  }

  function saveEntry(sid,did,value) {
    const recordDate = date;
    // Preserve rapid successive edits; filtering waits for the last committed value.
    entryWrites = entryWrites.then(async () => {
      try {
        await transact(['students', 'checklistEntries'], 'readwrite', async tx => {
          const student = await requestResult(tx.objectStore('students').get(sid));
          if (!student || student.classId !== classId || student.status === 'deleted') {
            throw new Error('명단에서 해당 학생을 찾을 수 없습니다.');
          }
          tx.objectStore('checklistEntries').put({ id: classId+'|'+recordDate+'|'+did+'|'+sid, classId, date:recordDate,
            studentId:sid, definitionId:did, value, updatedAt:new Date().toISOString() });
        });
        focusedStudent = sid;
        notice = '기록을 저장했습니다.';
        bus.publish('checklist.updated', {date:recordDate,studentId:sid,definitionId:did});
      } catch(error) { notice = '저장하지 못했습니다: '+error.message; }
      await refresh();
    }).catch(error => { notice = '기록을 다시 불러오지 못했습니다: ' + error.message; render(); });
    return entryWrites;
  }

  function showForm(def) {
    dialog.innerHTML = '<form class="student-form roll-definition-form" data-id="' + esc(def?.id || '') + '"><div class="student-dialog-title"><h2>' +
      (def ? '할 일 수정' : '새로운 할 일 추가') + '</h2><button type="button" data-roll="close" aria-label="닫기">×</button></div>' +
      '<label>할 일 이름<input name="title" maxlength="60" required value="' + esc(def?.title || '') + '" placeholder="예: 발표, 준비물, 독서 기록"></label>' +
      '<label>기록 방식<select name="type"' + (def ? ' disabled' : '') + '>' + Object.entries(TYPES).map(([key,t]) =>
        '<option value="'+key+'"'+(def?.inputType===key?' selected':'')+'>'+t.label+'</option>').join('')+'</select></label>' +
      '<p>항목의 값과 개인점수는 별도입니다. 기록 후 대상을 골라 수동으로 지급하세요.</p><p class="student-form-error" role="alert"></p>' +
      '<button class="student-form-save" type="submit">저장</button></form>';
    if (!dialog.open) dialog.showModal();
  }

  function showManager() {
    dialog.innerHTML = '<div class="student-form"><div class="student-dialog-title"><h2>할 일 리스트 수정</h2><button data-roll="close" aria-label="닫기">×</button></div><div class="roll-definition-list">' +
      definitions.map(def => '<div class="roll-definition-item' + (def.archived ? ' is-archived' : '') + '"><span style="background:' + typeOf(def).color + '">' + typeOf(def).label +
        '</span><button data-roll="edit" data-id="' + esc(def.id) + '">' + esc(def.title) + '</button><button data-roll="up" data-id="' + esc(def.id) + '" aria-label="' + esc(def.title) + ' 위로">↑</button>' +
        '<button data-roll="archive" data-id="' + esc(def.id) + '">' + (def.archived ? '복원' : '보관') + '</button></div>').join('') +
      '</div><button class="student-form-save" data-roll="add">＋ 새로운 할 일 추가</button></div>';
    if (!dialog.open) dialog.showModal();
  }

  const parsedValue = (def, raw) => def.inputType === 'check' ? raw === 'true' : ['rating','score'].includes(def.inputType) ? Number(raw) : raw;
  function chooseByValue(def, value) {
    filterDefinition = def.id; filterValue = value;
    selected.clear(); students.filter(s => entryFor(s.id,def.id)?.value === value).forEach(s => selected.add(s.id));
    notice = def.title + ' · ' + labelValue(value) + '에 해당하는 ' + selected.size + '명을 선택했습니다.';
    render();
  }

  root.addEventListener('click', async e => {
    const target = e.target.closest('[data-roll]');
    if (!target || busy) return;
    const action = target.dataset.roll, def = definitions.find(d => d.id === target.dataset.id);
    try {
      await entryWrites;
      if (action === 'close') { dialog.close(); return; }
      if (action === 'add') { showForm(); return; }
      if (action === 'edit') { showForm(def); return; }
      if (action === 'manage') { showManager(); return; }
      if (action === 'students') { document.querySelector('[data-mode="scoreboard"]').click(); return; }
      if (action === 'day' || action === 'week-prev' || action === 'week-next') {
        date = action === 'day' ? target.dataset.date : dateOffset(date,action === 'week-prev' ? -7 : 7);
        selected.clear(); filterDefinition=''; notice=''; await refresh(); return;
      }
      if (action === 'cell') {
        const item = definitions.find(d => d.id === target.dataset.definition);
        const value = parsedValue(item,target.dataset.value);
        await saveEntry(target.dataset.student,item.id,entryFor(target.dataset.student,item.id)?.value === value ? null : value);
      }
      if (action === 'filter') chooseByValue(def,parsedValue(def,target.dataset.value));
      if (action === 'filter-score') {
        const input = [...surface.querySelectorAll('[data-filter]')].find(n => n.dataset.filter === def.id);
        if (!input.value || !input.checkValidity()) { input.reportValidity(); return; }
        chooseByValue(def,Number(input.value));
      }
      if (action === 'all') { if(selected.size) selected.clear(); else students.forEach(s=>selected.add(s.id)); filterDefinition=''; render(); }
      if (action === 'reward') await composer.open({students:students.filter(s=>selected.has(s.id)),source:'checklist',reason:filterDefinition ? '체크리스트: '+definitions.find(d=>d.id===filterDefinition)?.title : '체크리스트 활동'});
      if (action === 'archive' || action === 'up') {
        await transact(['checklistDefinitions'],'readwrite',async tx => {
          const store = tx.objectStore('checklistDefinitions');
          const records = (await requestResult(store.index('classId').getAll(classId))).sort((a,b)=>(a.order||0)-(b.order||0));
          const index = records.findIndex(d=>d.id===def.id), current = records[index];
          if (!current) throw new Error('항목을 다시 확인해 주세요.');
          if (action === 'archive') store.put({...current,archived:!current.archived});
          else if(index>0) {
            [records[index-1],records[index]]=[records[index],records[index-1]];
            records.forEach((d,i)=>store.put({...d,order:i+1}));
          }
        });
        bus.publish('checklist.updated',{}); await refresh(); showManager();
      }
    } catch(error) { notice=error.message; render(); }
  });
  root.addEventListener('change', async e => {
    const target = e.target;
    if (target.dataset.select) {
      target.checked ? selected.add(target.dataset.select) : selected.delete(target.dataset.select);
      focusedStudent=target.dataset.select; filterDefinition='';render();
    }
    if (target.matches('.roll-number')) {
      if (!target.checkValidity()) {target.reportValidity();return;}
      await saveEntry(target.dataset.student,target.dataset.definition,target.value === '' ? null : Number(target.value));
    }
  });
  root.addEventListener('submit', async e => {
    const form=e.target;
    if (!form.matches('.roll-definition-form')) return;
    e.preventDefault(); if(busy)return; busy=true;
    try {
      const data=new FormData(form), title=String(data.get('title')||'').trim();
      if(!title)throw new Error('이름을 입력해 주세요.');
      await transact(['checklistDefinitions'],'readwrite',async tx=>{
        const store=tx.objectStore('checklistDefinitions');
        const previous=form.dataset.id ? await requestResult(store.get(form.dataset.id)) : null;
        if(form.dataset.id&&!previous)throw new Error('항목을 다시 확인해 주세요.');
        store.put({...previous,id:previous?.id||crypto.randomUUID(),classId,title,
          inputType:previous?.inputType||data.get('type'),rewardPoints:0,order:previous?.order||definitions.length+1,
          createdAt:previous?.createdAt||new Date().toISOString()});
      });
      dialog.close(); bus.publish('checklist.updated',{}); await refresh();
    } catch(error){form.querySelector('.student-form-error').textContent=error.message;}
    finally{busy=false;}
  });
  return {refresh};
}
