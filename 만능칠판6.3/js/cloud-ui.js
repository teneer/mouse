import {wireFirebaseGuide} from './firebase-guide.js';
import {uid} from './constants.js';
import {assetReferences} from './files.js';
import {deviceInviteURL, encodeDeviceKey, encodeInvite, parseFirebaseConfig, readDeviceKey, readInvite} from './cloud-config.js';
import {drawDeviceQR} from './device-qr.js';
import {FileTransfer} from './file-transfer.js';

const $ = id => document.getElementById(id);
const text = (id, value) => {$(id).textContent = value;};
const message = error => ({
  'auth/configuration-not-found':'Firebase 설정 안내 4단계에서 익명 로그인과 프로젝트 ID를 확인해 주세요.',
  'auth/operation-not-allowed':'Firebase 콘솔에서 익명 로그인을 켜 주세요.',
  'permission-denied':'Firebase 보안 규칙과 기기 승인 상태를 확인해 주세요.',
  'auth/invalid-api-key':'Firebase 웹 앱 설정을 다시 확인해 주세요.',
  QuotaExceededError:'브라우저 저장 공간이 부족합니다.',
  AbortError:'파일 받기를 취소했습니다.'
})[error.code || error.name] || error.message;
const fileSize = size => size < 1024 ? size + ' B' : size < 1048576 ? (size/1024).toFixed(1) + ' KB'
  : (size/1048576).toFixed(1) + ' MB';

export function wireCloudUI({cloud,files,openModal,notify,flush,pages,current,useLocal,renderFiles,goTo,prepareSeed,scoreSync,finishEdits}) {
  const localFiles = new Set(), messages = new Map();
  const modalOpen = id => $(id).style.display === 'flex';
  let reconnectOptions=null;
  let redraw, manuallyChanged = false, previousOnline = false;
  let activeStage = 'start', renderedKey = null, deviceListSignature, selectedDevice;
  const guide=wireFirebaseGuide($('deviceFirstGuide'));
  const titles={start:'기기 연결',first:'처음 연결하기',guide:'기기 추가 방법',key:'이 기기 추가하기',
    connected:'기기 관리',invite:'기기 추가',legacy:'코드로 연결',join:'연결 코드 발급',rename:'기기 이름 바꾸기',
    remove:'기기 연결 해제',disconnect:'이 기기에서 연결 해제'};
  document.addEventListener('pointerdown',event=>{
    for (const menu of $('deviceList').querySelectorAll('details[open]')) if (!menu.contains(event.target)) menu.open=false;
  });
  $('deviceRenameInput').addEventListener('keydown',event=>{
    if (event.key==='Enter' && !event.isComposing) {event.preventDefault();$('deviceRenameSave').click();}
  });
  const transfer = new FileTransfer(cloud,files,id=>{
    const label = transfer.incoming.get(id)?.label;
    if (label) files.transfers.set(id,label);
    else files.transfers.delete(id);
    renderFiles();
    queueFiles();
  });

  function stage(name) {
    activeStage = name;
    const guideOpen = name === 'guide';
    const shown = guideOpen ? 'first' : name;
    text('deviceTitle',titles[name]);
    if (name==='first' || guideOpen) guide.open(guideOpen,guideOpen?5:0);
    $('deviceModal').querySelector('.device-dialog').scrollTop=0;
    for (const item of $('deviceModal').querySelectorAll('[data-stage]')) item.hidden = item.dataset.stage !== shown;
    text('deviceMessage','');
    if (name === 'invite') drawInvite();
  }

  function drawInvite() {
    const {options, deviceInvite, inviteError, online} = cloud;
    const show = online && !!deviceInvite;
    const key = show ? encodeDeviceKey(options, deviceInvite) : null;
    $('deviceStartInvite').hidden = !online || deviceInvite !== null;
    $('deviceInviteDetails').hidden = !show;
    text('deviceInviteStatus',inviteError
      ? '초대 상태를 확인할 수 없습니다. Firebase에 최신 보안 규칙이 게시되었는지 확인해주세요.'
      : !online || deviceInvite === undefined ? '초대 상태를 확인하는 중…'
      : show ? '초대는 직접 종료할 때까지 계속 사용할 수 있습니다.'
      : '열려 있는 초대가 없습니다.');
    if (key === renderedKey) return;
    renderedKey = key;
    const canvas = $('deviceInviteQR');
    if (key) {
      try {drawDeviceQR(canvas,deviceInviteURL(key));canvas.hidden = false;}
      catch {canvas.hidden = true;text('deviceInviteStatus','QR을 표시할 수 없습니다. 연결 키를 복사해 주세요.');}
    } else canvas.width = canvas.height = 0;
  }

  function drawDevices() {
    const canManage=cloud.online && !cloud.revoked;
    const canRemove=canManage && cloud.deviceInvite!==undefined;
    const signature=JSON.stringify([canManage,canRemove,cloud.deviceId,cloud.devices]);
    if (signature===deviceListSignature) return;
    deviceListSignature=signature;
    const devices=[...cloud.devices].sort((a,b)=>Number(b.id===cloud.deviceId)-Number(a.id===cloud.deviceId));
    const entries=devices.map(device=>{
      const item=document.createElement('li'), label=document.createElement('strong');
      const own=device.id===cloud.deviceId;
      label.textContent=device.label;
      item.append(label);
      if (own) {
        const badge=document.createElement('span');
        badge.className='device-own-badge';badge.textContent='이 기기';item.append(badge);
      }
      if (!canManage) return item;
      const menu=document.createElement('details'), trigger=document.createElement('summary'), actions=document.createElement('div');
      menu.className='device-row-menu';
      trigger.textContent='⋯';trigger.setAttribute('aria-label',device.label+' 메뉴');
      actions.className='device-row-actions';
      function option(label,show,danger=false) {
        const button=document.createElement('button');
        button.type='button';button.textContent=label;
        button.className=danger?'dialog-action dialog-danger':'dialog-action';
        button.onclick=()=>{menu.open=false;selectedDevice=device;show();};
        actions.append(button);
      }
      option('이름 바꾸기',()=>{
        stage('rename');const input=$('deviceRenameInput');input.value=device.label;input.focus();input.select();
      });
      if (!own && canRemove) option('연결 해제',()=>{
        stage('remove');
        text('deviceRemoveMessage',device.label+'의 칠판 연결을 해제할까요?'+
          (cloud.deviceInvite?' 열려 있는 초대의 키로 다시 등록할 수 있습니다.':''));
      },true);
      menu.append(trigger,actions);item.append(menu);
      menu.addEventListener('toggle',()=>{if (menu.open) {
        for (const other of $('deviceList').querySelectorAll('details[open]')) if (other!==menu) other.open=false;
      }});
      return item;
    });
    $('deviceList').replaceChildren(...entries);
  }

  function action(id, handler) {
    const button = $(id);
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      text('deviceMessage','');
      try {await handler();}
      catch (error) {text('deviceMessage',message(error));}
      finally {button.disabled = false;}
    };
  }

  function status() {
    const linked = !!cloud.options;
    const waiting = cloud.pending.size;
    const label = linked
      ? cloud.revoked ? '이 기기의 연결이 해제되었습니다'
      : cloud.online ? waiting ? `동기화 중 · 전송 대기 ${waiting}건` : '연결됨'
      : `오프라인 · 전송 대기 ${waiting}건`
      : '로컬 모드';
    text('deviceStatus',label);
    $('deviceStatus').dataset.online=String(linked && cloud.online);
    if ($('cloudSyncStatus').textContent !== label) text('cloudSyncStatus',label);
    $('cloudSyncStatus').dataset.offline = String(linked && !cloud.online);
    $('deviceSeedScore').hidden = !linked || !cloud.boardReady || !cloud.online ||
      cloud.state.revision < cloud.head || !!cloud.projectedScore();
    $('deviceResume').hidden = linked || !reconnectOptions;
    if (linked) {
      if (!['connected','guide','invite','legacy','rename','remove','disconnect'].includes(activeStage)
        || (cloud.revoked && !['connected','disconnect'].includes(activeStage))) stage('connected');
      $('deviceShowInvite').hidden = cloud.revoked;
      $('deviceLegacy').hidden = cloud.revoked;
      $('deviceInvite').value = cloud.revoked ? '' : encodeInvite(cloud.options);
      drawDevices();
      if (activeStage === 'invite') drawInvite();
    }
    if (cloud.online) {
      transfer.start();
      if (!previousOnline) boardChanged().catch(error=>notify(message(error)));
    } else if (!linked || cloud.revoked) transfer.stop();
    if (cloud.online !== previousOnline) queueFiles();
    previousOnline = cloud.online;
  }

  function allFiles() {
    const result = new Map();
    const pageList = pages();
    for (const [index,page] of pageList.entries()) {
      const canvas = page.id === current()?.id ? current().content.canvas : page.content.canvas;
      for (const [id,info] of assetReferences(canvas.objects)) {
        if (!result.has(id)) result.set(id,{info,positions:[]});
        result.get(id).positions.push({id:page.id,label:`${index+1}쪽`});
      }
    }
    return result;
  }

  async function boardChanged() {
    for (const {info} of allFiles().values()) {
      if (!localFiles.has(info.id) || (cloud.online && !transfer.known.has(info.id))) {
        const asset = await files.store.getAsset(info.id);
        if (asset) {
          localFiles.add(info.id);
          if (cloud.online) transfer.advertise(info,asset).catch(console.warn);
        }
      }
    }
    queueFiles();
  }

  function queueFiles() {
    if (!modalOpen('fileManagerModal')) return;
    clearTimeout(redraw);
    redraw = setTimeout(()=>drawFiles().catch(error=>notify(message(error))),150);
  }

  function objectRows(){
    const result=[];
    for(const [pageIndex,page] of pages().entries()){
      for(const [index,object] of (page.content.canvas.objects||[]).entries()){
        result.push({pageId:page.id,pageLabel:(pageIndex+1)+'쪽',index,object});
      }
    }
    const kind=o=>o.wbAsset?.type==='pdf'?'PDF':o.wbAsset?'이미지':({path:'필기',text:'텍스트','i-text':'텍스트',textbox:'텍스트',group:'그룹',rect:'도형',circle:'도형',ellipse:'도형',polygon:'도형',polyline:'도형',line:'도형',triangle:'도형'})[o.type]||'개체';
    const name=(o,i)=>o.wbName||o.wbAsset?.name||(['text','i-text','textbox'].includes(o.type)?String(o.text||'').replace(/\\s+/g,' ').slice(0,36):kind(o)+' '+(i+1));
    return result.sort((a,b)=>kind(a.object).localeCompare(kind(b.object),'ko')||name(a.object,a.index).localeCompare(name(b.object,b.index),'ko'));
  }
  function drawObjects(){
    const list=$('managedObjects'),rows=objectRows();
    text('emptyManagedObjects',rows.length?'':'칠판에 개체가 없습니다.');
    list.replaceChildren(...rows.map(({pageId,pageLabel,index,object})=>{
      const entry=document.createElement('li'),info=document.createElement('div');
      const title=document.createElement('strong');title.textContent=(object.wbAsset?.type==='pdf'?'PDF':object.wbAsset?'이미지':object.type)+' · '+(object.wbName||object.wbAsset?.name||(['text','i-text','textbox'].includes(object.type)?String(object.text||'').replace(/\\s+/g,' ').slice(0,36):'개체 '+(index+1)));
      const detail=document.createElement('p');detail.textContent=pageLabel+(object.wbAsset?' · 파일 참조':'');
      info.append(title,detail);
      const actions=document.createElement('div');actions.className='cloud-buttons';
      const go=document.createElement('button');go.type='button';go.className='action-btn';go.textContent='위치 보기';go.onclick=()=>goTo(pageId);
      actions.append(go);entry.append(info,actions);return entry;
    }));
  }
  async function drawFiles() {
    drawObjects();
    const list = $('managedFiles');
    const found = allFiles();
    text('emptyManagedFiles',found.size ? '' : '칠판에 배치된 이미지나 PDF가 없습니다.');
    const rows = [];
    for (const {info,positions} of found.values()) {
      const entry = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = info.name;
      const detail = document.createElement('p');
      const saved = await files.store.getAsset(info.id);
      const downloading = transfer.incoming.get(info.id);
      detail.textContent = [fileSize(info.size),downloading?.label || (saved ? '이 기기에 저장됨' : messages.get(info.id) || '이 기기에 없음')].join(' · ');
      const holders = transfer.holders.get(info.id);
      if (holders) {
        const devices = cloud.devices.filter(device=>device.id!==cloud.deviceId);
        if (devices.length) detail.textContent += ' · ' + devices.map(device=>
          device.label + ' ' + (holders.includes(device.id) ? '저장됨' : '없음')).join(', ');
      }
      const actions = document.createElement('div');
      actions.className = 'cloud-buttons';
      const add = (label,onClick,disabled=false) => {
        const button = document.createElement('button');
        button.type = 'button';button.className = 'action-btn';button.textContent = label;
        button.onclick = onClick;button.disabled = disabled;
        actions.append(button);
      };
      for (const position of positions) add(position.label,()=>goTo(position.id));
      if (downloading) add('받기 취소',()=>transfer.cancel(info.id));
      else if (!saved) add(messages.has(info.id)?'다시 받기':'이 기기로 받기',async ()=>{
        messages.delete(info.id);
        try {await transfer.receive(info);await boardChanged();}
        catch (error) {messages.set(info.id,message(error));queueFiles();}
      },!cloud.online);
      if (cloud.online) add('기기별 저장 상태 확인',async ()=>{
        try {
          const found = await transfer.sources(info);
          if (!found.length && !saved) messages.set(info.id,'다른 연결 기기에 저장된 파일을 찾지 못했습니다.');
          queueFiles();
        } catch (error) {notify(message(error));}
      });
      entry.append(title,detail,actions);
      rows.push(entry);
    }
    list.replaceChildren(...rows);
  }

  $('deviceConnectBtn').onclick = () => {
    openModal('deviceModal');
    if (cloud.options) stage('connected');
    else if (!manuallyChanged) stage('start');
    status();
  };
  $('fileManagerBtn').onclick = async () => {
    openModal('fileManagerModal');
    await drawFiles().catch(error=>notify(message(error)));
  };
  $('deviceFirst').onclick = () => {manuallyChanged = true;stage('first');};
  $('deviceAdd').onclick = () => {manuallyChanged = true;stage('key');};
  $('deviceShowInvite').onclick = () => stage('invite');
  $('deviceLegacy').onclick = () => stage('legacy');
  $('deviceLegacyJoin').onclick = () => stage('join');
  $('deviceGuide').onclick = () => stage('guide');
  for (const button of $('deviceModal').querySelectorAll('[data-device-back]')) {
    button.onclick = () => {
      stage(activeStage==='legacy'||activeStage==='guide'?'invite':activeStage==='join'?'key':cloud.options?'connected':'start');
    };
  }
  action('deviceRenameSave',async ()=>{
    if (!selectedDevice) return;
    try {await cloud.renameDevice(selectedDevice.id,$('deviceRenameInput').value);}
    catch (error) {
      if (error.code==='permission-denied') throw Error('기기 이름 변경을 사용하려면 Firebase에 최신 보안 규칙을 게시해 주세요.');
      throw error;
    }
    stage('connected');
    text('deviceMessage','기기 이름을 저장했습니다.');
  });
  action('deviceRemoveConfirm',async ()=>{
    if (!selectedDevice) return;
    await cloud.removeDevice(selectedDevice.id);
    stage('connected');
    text('deviceMessage','기기 연결을 해제했습니다.');
  });
  action('deviceCheck',async ()=>{
    const config = parseFirebaseConfig($('firebaseConfig').value);
    await cloud.authenticate(config);
    $('deviceSeed').disabled = false;
    text('deviceMessage','Firebase 인증을 확인했습니다. 첫 동기화에서 Firestore 접근 권한을 확인합니다.');
  });
  $('firebaseConfig').oninput = () => {$('deviceSeed').disabled = true;};
  action('deviceSeed',async ()=>{
    await flush();
    text('deviceMessage','이 기기의 칠판을 준비하는 중…');
    await cloud.create(parseFirebaseConfig($('firebaseConfig').value),
      $('deviceFirstName').value.trim() || '교실 PC',await prepareSeed(),scoreSync.snapshot());
    stage('connected');status();
  });
  action('deviceSeedScore',async ()=>{
    if (!cloud.options || !cloud.online || cloud.state.revision < cloud.head || cloud.projectedScore()) return;
    if (!confirm('이 기기의 현재 학급·모둠 점수를 공유 칠판의 시작값으로 사용할까요? 교실 PC에서 한 번만 실행하세요.')) return;
    await cloud.enqueue({kind:'score-seed',key:uid(),snapshot:scoreSync.snapshot()});
    text('deviceMessage','이 기기의 점수를 공유 시작값으로 등록합니다.');
  });
  action('deviceStartInvite',async ()=>{
    await cloud.changeDeviceInvite();
  });
  action('deviceEndInvite',async ()=>{
    if (!cloud.deviceInvite) return;
    await cloud.changeDeviceInvite(cloud.deviceInvite);
  });
  action('deviceCopyKey',async ()=>{
    if (!cloud.online || !cloud.deviceInvite) throw Error('열려 있는 초대가 없습니다.');
    await navigator.clipboard.writeText(encodeDeviceKey(cloud.options,cloud.deviceInvite));
    text('deviceMessage','연결 키를 복사했습니다.');
  });
  action('deviceJoinWithKey',async ()=>{
    const invite = readDeviceKey($('deviceJoinKey').value);
    await flush();
    await cloud.joinDevice(invite,$('deviceKeyName').value.trim() || '새 기기');
    $('deviceJoinKey').value = '';
    manuallyChanged = false;stage('connected');status();
    text('deviceMessage','칠판에 연결했습니다.');
  });
  action('deviceRequest',async ()=>{
    const code = await cloud.request(readInvite($('deviceJoinLink').value.trim()),$('deviceJoinName').value.trim() || '새 기기');
    waiting(code);
  });
  action('deviceApprove',async ()=>{
    await cloud.approve($('deviceApprovalCode').value);
    $('deviceApprovalCode').value = '';
    text('deviceMessage','새 기기를 승인했습니다.');
  });
  action('deviceCopyLink',async ()=>{
    await navigator.clipboard.writeText($('deviceInvite').value);
    text('deviceMessage','연결 링크를 복사했습니다.');
  });
  action('deviceResume',async ()=>{
    await flush();await cloud.store.setMeta('cloudConnection',reconnectOptions);await cloud.start(reconnectOptions);
    stage('connected');status();
  });
  $('deviceDisconnect').onclick=()=>stage('disconnect');
  action('deviceDisconnectConfirm',async ()=>{
    const previous=cloud.revoked ? null : cloud.options;
    await cloud.disconnect(async()=>{await finishEdits();await scoreSync.idle();});
    reconnectOptions=previous;status();
    stage('start');await useLocal();
  });
  function approved() {stage('connected');}
  function waiting(code) {
    if (activeStage === 'key') return;
    manuallyChanged = true;
    stage('join');
    text('devicePairCode',code.match(/.{1,5}/g).join(' '));
    $('devicePairCode').hidden = false;
    text('deviceMessage','먼저 연결한 기기에서 이 코드를 10분 안에 승인해 주세요.');
  }
  if (location.hash.startsWith('#WB5.')) {
    try {
      readDeviceKey(location.href);
      $('deviceJoinKey').value = location.hash.slice(1);
      history.replaceState(history.state,'',location.pathname + location.search);
      manuallyChanged = true;stage('key');openModal('deviceModal');
    } catch {}
  } else if (location.hash) {
    try {
      readInvite(location.href);
      $('deviceJoinLink').value = location.href;
      manuallyChanged = true;stage('join');openModal('deviceModal');
    } catch {}
  }
  cloud.store.getMeta('cloudPrevious').then(options=>{reconnectOptions=options;status();}).catch(console.warn);
  return {status,boardChanged,approved,waiting};
}
