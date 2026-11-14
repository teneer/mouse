import {assetReferences} from './files.js';
import {encodeInvite, parseFirebaseConfig, readInvite} from './cloud-config.js';
import {FileTransfer} from './file-transfer.js';

const $ = id => document.getElementById(id);
const text = (id, value) => {$(id).textContent = value;};
const message = error => ({
  'auth/operation-not-allowed':'Firebase 콘솔에서 익명 로그인을 켜 주세요.',
  'permission-denied':'Firebase 보안 규칙과 기기 승인 상태를 확인해 주세요.',
  'auth/invalid-api-key':'Firebase 웹 앱 설정을 다시 확인해 주세요.',
  QuotaExceededError:'브라우저 저장 공간이 부족합니다.',
  AbortError:'파일 받기를 취소했습니다.'
})[error.code || error.name] || error.message;
const fileSize = size => size < 1024 ? size + ' B' : size < 1048576 ? (size/1024).toFixed(1) + ' KB'
  : (size/1048576).toFixed(1) + ' MB';

export function wireCloudUI({cloud,files,openModal,notify,flush,pages,current,changeView,useLocal,renderFiles,goTo,prepareSeed,startView}) {
  const localFiles = new Set(), messages = new Map();
  const modalOpen = id => $(id).style.display === 'flex';
  let reconnectOptions=null;
  let redraw, manuallyChanged = false, previousOnline = false, guideOpen = false;
  const transfer = new FileTransfer(cloud,files,id=>{
    const label = transfer.incoming.get(id)?.label;
    if (label) files.transfers.set(id,label);
    else files.transfers.delete(id);
    renderFiles();
    queueFiles();
  });
  try {$('viewSync').checked = localStorage.getItem('wb42.viewSync') === 'true';} catch {}

  function stage(name) {
    guideOpen = name === 'guide';
    const shown = guideOpen ? 'first' : name;
    $('deviceSetupControls').hidden = guideOpen;
    for (const item of $('deviceModal').querySelectorAll('[data-stage]')) item.hidden = item.dataset.stage !== shown;
    text('deviceMessage','');
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
    text('deviceStatus',linked
      ? cloud.online ? cloud.pending.size ? `연결됨 · 전송 대기 ${cloud.pending.size}건` : '연결됨' : '연결 대기 중'
      : '이 기기의 칠판을 사용 중');
    $('viewSync').disabled = !cloud.boardReady;
    $('deviceResume').hidden = linked || !reconnectOptions;
    if (linked) {
      if ($('deviceConnected').hidden && !guideOpen) stage('connected');
      $('deviceInvite').value = encodeInvite(cloud.options);
      const entries = cloud.devices.map(device => {
        const li = document.createElement('li');
        li.textContent = device.label + (device.id === cloud.deviceId ? ' (이 기기)' : '');
        return li;
      });
      $('deviceList').replaceChildren(...entries);
    }
    if (cloud.online) {
      transfer.start();
      if (!previousOnline) boardChanged().catch(error=>notify(message(error)));
    } else if (!linked) transfer.stop();
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

  async function drawFiles() {
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
  $('deviceAdd').onclick = () => {manuallyChanged = true;stage('join');};
  $('deviceGuide').onclick = () => stage('guide');
  for (const button of $('deviceModal').querySelectorAll('[data-device-back]')) {
    button.onclick = () => stage(cloud.options ? 'connected' : 'start');
  }
  $('viewSync').onchange = () => {
    try {localStorage.setItem('wb42.viewSync',String($('viewSync').checked));}catch{}
    if ($('viewSync').checked && !cloud.latestView) startView();
    changeView();
  };
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
      $('deviceFirstName').value.trim() || '교실 PC',await prepareSeed());
    stage('connected');status();
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
    await flush();await cloud.start(reconnectOptions);await cloud.store.setMeta('cloudConnection',reconnectOptions);
    stage('connected');status();
  });
  action('deviceDisconnect',async ()=>{
    await flush();
    const previous=cloud.options;
    await cloud.disconnect();
    await cloud.store.setMeta('cloudPrevious',previous);reconnectOptions=previous;status();
    stage('start');await useLocal();
  });
  function approved() {stage('connected');notify('기기 승인 완료 · 칠판을 불러오는 중입니다.');}
  function waiting(code) {
    manuallyChanged = true;
    stage('join');
    text('devicePairCode',code.match(/.{1,5}/g).join(' '));
    $('devicePairCode').hidden = false;
    text('deviceMessage','먼저 연결한 기기에서 이 코드를 10분 안에 승인해 주세요.');
  }
  if (location.hash) {
    try {
      readInvite(location.href);
      $('deviceJoinLink').value = location.href;
      manuallyChanged = true;stage('join');openModal('deviceModal');
    } catch {}
  }
  cloud.store.getMeta('cloudPrevious').then(options=>{reconnectOptions=options;status();}).catch(console.warn);
  return {status,boardChanged,approved,waiting};
}
