import {uid} from './constants.js';
import {applyOperation, boardPages, newBoard, validView, validViewState} from './cloud-model.js?v=celebration-1';
import {applyScoreOperation} from './shared-score.js?v=celebration-1';
import {parseFirebaseConfig} from './cloud-config.js';

const sdk = 'https://www.gstatic.com/firebasejs/11.10.0';
const sequence = revision => String(revision).padStart(12, '0');
const chunkSize = 200000; // UTF-8 Firestore document limit also holds for non-ASCII text.
const isReady = snapshot => snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;

export class CloudBoard {
  constructor(store, events) {
    this.store = store;
    this.events = events;
    this.state = newBoard();
    this.pending = new Map();
    this.options = null;
    this.subscriptions = [];
    this.devices = [];
    this.deviceInvite = undefined;
    this.inviteError = null;
    this.revoked = false;
    this.latestView = null;
    this.boardReady = false;
    this.online = false;
    this.retryDelay = 1000;
  }

  async authenticate(config) {
    if (this.user && JSON.stringify(this.config) === JSON.stringify(config)) return;
    if (this.options && JSON.stringify(this.options.config) !== JSON.stringify(config)) throw Error('현재 연결을 해제한 뒤 다른 Firebase 프로젝트를 연결해주세요.');
    const [app, auth, fs] = await Promise.all([
      import(sdk + '/firebase-app.js'), import(sdk + '/firebase-auth.js'), import(sdk + '/firebase-firestore.js')
    ]);
    const name = 'whiteboard-' + config.projectId + '-' + config.appId;
    const firebase = app.getApps().find(item => item.name === name) || app.initializeApp(config, name);
    const login = auth.getAuth(firebase);
    await login.authStateReady();
    this.user = login.currentUser || (await auth.signInAnonymously(login)).user;
    this.fs = fs;
    this.db = fs.getFirestore(firebase);
    this.config = config;
  }

  ref(...parts) {return this.fs.doc(this.db, 'wbBoards', this.options.boardId, ...parts);}
  collection(...parts) {return this.fs.collection(this.db, 'wbBoards', this.options.boardId, ...parts);}
  get deviceId() {return this.user?.uid;}

  async create(config, label, pages, score) {
    await this.authenticate(parseFirebaseConfig(config));
    const options = {config:this.config, boardId:uid(), label, initial:true};
    const {fs, db, deviceId} = this;
    const board = fs.doc(db, 'wbBoards', options.boardId);
    const batch = fs.writeBatch(db);
    batch.set(board, {owner:deviceId, head:0, created:fs.serverTimestamp()});
    batch.set(fs.doc(board, 'devices', deviceId), {label, joined:fs.serverTimestamp()});
    await batch.commit();
    this.options = options;
    try {await this.enqueue({kind:'seed', pages, score}, false, options);}
    catch(error) {this.options=null;throw error;}
    await this.start(options);
  }

  async changeDeviceInvite(expectedToken = null) {
    if (!this.online) throw Error('기기가 온라인일 때 초대를 관리할 수 있습니다.');
    const {fs, db} = this;
    const ref = this.ref('control', 'deviceInvite');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    await fs.runTransaction(db, async tx => {
      const current = (await tx.get(ref)).data()?.token;
      if (expectedToken) {
        if (current === expectedToken) tx.delete(ref);
      } else if (!current) tx.set(ref, {token});
    });
  }

  async joinDevice({config, boardId, token}, label) {
    if (this.options || this.connecting) throw Error('현재 연결을 먼저 확인해주세요.');
    const previousRequest = this.approvalRequest;
    this.cancelApproval();
    this.connecting = true;
    try {
      await this.authenticate(parseFirebaseConfig(config));
      const {fs, db, deviceId} = this;
      const device = fs.doc(db, 'wbBoards', boardId, 'devices', deviceId);
      await fs.runTransaction(db, async tx => {
        if (!(await tx.get(device)).exists()) {
          tx.set(device, {label, joined:fs.serverTimestamp(), inviteToken:token});
        }
      });
      const options = {config:this.config, boardId, label};
      await this.store.setMeta('cloudConnection', options);
      await this.store.setMeta('cloudRequest', null);
      await this.start(options);
    } catch (error) {
      if (!this.options && previousRequest) {
        try {
          await this.authenticate(previousRequest.options.config);
          this.waitForApproval(previousRequest);
        } catch (restoreError) {this.events.error(restoreError);}
      }
      if (error.code === 'permission-denied') {
        throw Error('유효한 초대를 찾을 수 없습니다. 초대 상태 또는 Firebase 보안 규칙을 확인해 주세요.');
      }
      throw error;
    } finally {this.connecting = false;}
  }

  async removeDevice(id) {
    if (!this.online) throw Error('기기가 온라인일 때 연결을 해제할 수 있습니다.');
    await this.fs.deleteDoc(this.ref('devices', id));
  }

  cancelApproval() {
    this.stopApproval?.();
    this.stopApproval = null;
    this.approvalRequest = null;
  }

  async request(options, label) {
    await this.authenticate(parseFirebaseConfig(options.config));
    const {fs, db, deviceId} = this;
    const code = uid().replaceAll('-', '').slice(0, 20).toUpperCase();
    const reference = fs.doc(db, 'wbBoards', options.boardId, 'requests', code);
    await fs.setDoc(reference, {deviceId, label, created:fs.serverTimestamp()});
    const request = {options:{config:this.config,boardId:options.boardId,label}, code};
    await this.store.setMeta('cloudRequest', request);
    this.waitForApproval(request);
    return code;
  }

  waitForApproval(request) {
    this.cancelApproval();
    this.approvalRequest = request;
    const {fs, db, deviceId} = this;
    this.stopApproval = fs.onSnapshot(fs.doc(db, 'wbBoards', request.options.boardId, 'requests', request.code), {includeMetadataChanges:true}, async snapshot => {
      if (!this.connecting && this.approvalRequest === request && isReady(snapshot)
        && snapshot.data().approved === true && snapshot.data().deviceId === deviceId) {
        try {
          this.connecting = true;
          this.cancelApproval();
          await this.store.setMeta('cloudConnection', request.options);
          await this.store.setMeta('cloudRequest', null);
          this.events.approved();
          await this.start(request.options);
        } catch (error) {this.events.error(error);}
        finally {this.connecting = false;}
      }
    }, this.events.error);
  }

  async approve(code) {
    const {fs, db} = this;
    const normalized = code.replace(/[\s-]/g,'').toUpperCase();
    if (!/^[A-Z0-9]{20}$/.test(normalized)) throw Error('새 기기에서 발급한 20자리 연결 코드를 입력해주세요.');
    const request = this.ref('requests', normalized);
    await fs.runTransaction(db, async tx => {
      const snapshot = await tx.get(request);
      if (!snapshot.exists()) throw Error('연결 코드를 찾지 못했습니다.');
      const data = snapshot.data();
      if (data.approved) return;
      if (Date.now() - data.created.toMillis() >= 600000) throw Error('연결 코드가 만료되었습니다. 새 기기에서 다시 발급해주세요.');
      const device = this.ref('devices', data.deviceId);
      if (!(await tx.get(device)).exists()) tx.set(device, {label:data.label, joined:fs.serverTimestamp(), requestCode:request.id});
      tx.update(request, {approved:true});
    });
  }

  async resume() {
    const options = await this.store.getMeta('cloudConnection');
    if (options) {await this.start(options);return;}
    const request = await this.store.getMeta('cloudRequest');
    if (request && !this.connecting && !this.options) {
      await this.authenticate(parseFirebaseConfig(request.options.config));
      if (this.connecting || this.options) return;
      this.waitForApproval(request);
      this.events.waiting(request.code);
    }
  }

  async start(options) {
    this.options = options;
    this.state = await this.store.getMeta('cloud-state:' + options.boardId) || newBoard();
    this.pending = new Map((await this.store.listCloudOperations(options.boardId)).map(operation => [operation.id, operation]));
    this.head = this.state.revision;
    this.boardReady = boardPages(this.projected()).length > 0;
    if (this.boardReady) this.events.board();
    this.events.status();
    this.connectServer(options).catch(this.events.error);
  }

  async connectServer(options) {
    try {await this.authenticate(parseFirebaseConfig(options.config));}
    catch (error) {
      if (this.options !== options || this.detaching) return;
      clearTimeout(this.authRetry);
      this.authRetry = setTimeout(()=>this.connectServer(options).catch(this.events.error),5000);
      this.events.error(error);
      return;
    }
    if (this.options !== options || this.detaching) return;
    const {fs} = this;
    const statusError = error => {
      if (this.options !== options) return;
      this.online = false;
      this.events.status();
      this.events.error(error);
    };
    this.subscriptions.push(fs.onSnapshot(this.ref(), {includeMetadataChanges:true}, snapshot => {
      if (this.options !== options) return;
      if (!isReady(snapshot)) {
        this.online = false;
        this.events.status();
        return;
      }
      if (this.revoked) return;
      this.online = true;
      this.head = Math.max(this.head || 0,snapshot.data().head);
      this.events.status();
      this.pull().catch(error=>this.retrySync(error));
    }, statusError));
    this.subscriptions.push(fs.onSnapshot(this.collection('devices'), snapshot => {
      this.devices = snapshot.docs.map(device => ({id:device.id, ...device.data()}));
      this.events.status();
    }, this.events.error));
    this.subscriptions.push(fs.onSnapshot(this.ref('control','view'), {includeMetadataChanges:true}, snapshot => {
      if (isReady(snapshot) && (validViewState(snapshot.data()) || validView(snapshot.data()))) {
        this.latestView = snapshot.data();
        this.events.view(this.latestView);
      }
    }, this.events.error));
    this.subscriptions.push(fs.onSnapshot(this.ref('control', 'deviceInvite'), {includeMetadataChanges:true}, snapshot => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      this.inviteError = null;
      this.deviceInvite = snapshot.data()?.token ?? null;
      this.events.status();
    }, error => {
      this.inviteError = error;
      this.deviceInvite = undefined;
      this.events.status();
    }));
    this.subscriptions.push(fs.onSnapshot(this.ref('devices', this.deviceId), {includeMetadataChanges:true}, snapshot => {
      if (snapshot.exists() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      this.revoked = true;
      this.online = false;
      this.devices = [];
      this.events.status();
    }, this.events.error));
  }

  async disconnect(waitForChanges) {
    if (!this.options || this.detaching) return;
    if (!this.boardReady) throw Error('공유 칠판을 불러온 뒤 연결을 해제해주세요.');
    this.detaching = true;
    const previous = this.revoked ? null : this.options;
    try {
      await waitForChanges();
      await Promise.allSettled([this.pulling,this.pushing]);
      await this.store.saveLocalHandoff(this.options.boardId,previous);
    } finally {this.detaching = false;}
    this.clearConnection();
  }

  clearConnection() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.authRetry);
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.cancelApproval();
    this.options = null;
    this.boardReady = false;
    this.online = false;
    this.head = 0;
    this.devices = [];
    this.deviceInvite = undefined;
    this.inviteError = null;
    this.revoked = false;
    this.latestView = null;
    this.state = newBoard();
    this.pending.clear();
    this.events.status();
  }

  projected() {
    const board = structuredClone(this.state);
    let revision = board.revision;
    for (const operation of this.pending.values()) applyOperation(board, operation, ++revision);
    return board;
  }

  projectedScore(drafts = []) {
    const board = {score:structuredClone(this.state.score)};
    const seen = new Set();
    for (const operation of this.pending.values()) {
      if (operation.kind.startsWith('score-')) {
        seen.add(operation.key);
        applyScoreOperation(board,operation);
      } else if (operation.kind === 'seed' && operation.score) {
        applyScoreOperation(board,{kind:'score-seed',snapshot:operation.score,key:'first-score'});
      }
    }
    for (const operation of drafts) {
      if (!seen.has(operation.key)) applyScoreOperation(board,operation);
    }
    return board.score ?? null;
  }

  async enqueue(operation, startPush = true, initialConnection) {
    if (!this.options) throw Error('기기 연결을 확인해주세요.');
    const record = {...structuredClone(operation), id:uid(), boardId:this.options.boardId, time:Date.now()};
    await this.store.putCloudOperation(record,initialConnection);
    this.pending.set(record.id, record);
    if (startPush) {
      this.events.board();
      this.push().catch(error=>this.retrySync(error));
    }
    return record;
  }

  async pull() {
    if (this.pulling || !this.online || this.detaching) return this.pulling;
    const {fs} = this;
    this.pulling = (async () => {
      while (this.state.revision < this.head) {
        const next = this.state.revision + 1;
        const query = fs.query(this.collection('operations'), fs.orderBy(fs.documentId()), fs.startAt(sequence(next)), fs.limit(100));
        const snapshot = await fs.getDocsFromServer(query);
        if (!snapshot.size) throw Error('서버의 변경 기록을 불러올 수 없습니다.');
        const nextState=structuredClone(this.state), confirmed=[];
        for (const document of snapshot.docs) {
          const entry = document.data();
          const revision = nextState.revision + 1;
          if (document.id !== sequence(revision)) throw Error('서버의 변경 기록 순서가 올바르지 않습니다.');
          let payload = entry.payload;
          if (entry.parts) {
            const parts = await fs.getDocsFromServer(fs.query(this.collection('operations',document.id,'parts'), fs.orderBy(fs.documentId())));
            if (parts.size !== entry.parts) throw Error('서버의 변경 내용을 모두 받을 수 없습니다.');
            payload = parts.docs.map(part => part.data().payload).join('');
          }
          const operation = JSON.parse(payload);
          applyOperation(nextState, operation, revision);
          confirmed.push(entry.operationId);
        }
        await this.store.cacheCloudState(this.options.boardId, nextState, confirmed);
        this.state=nextState;
        for (const id of confirmed) this.pending.delete(id);
        this.boardReady = boardPages(this.state).length > 0;
        this.events.board();
      }
    })().finally(() => {this.pulling = null;this.events.status();});
    await this.pulling;
    this.push().catch(error=>this.retrySync(error));
  }

  async push() {
    if (!this.online || this.pushing || this.pulling || !this.pending.size || !this.options || this.detaching) return;
    const {fs, db} = this;
    this.pushing = (async ()=>{
      // Keep an operation pending until its committed sequence is applied by pull().
      for (const operation of [...this.pending.values()]) {
        if (this.detaching || !this.online) break;
        if (operation.sent) continue;
        const permission = await this.store.getMeta('cloudConnection');
        if (permission?.boardId !== operation.boardId || this.detaching) break;
        const {time, boardId, id, sent, ...content} = operation;
        const payload = JSON.stringify(content);
        const parts = [];
        if (payload.length > chunkSize) {
          for (let start = 0; start < payload.length;) {
            let end = Math.min(start + chunkSize, payload.length);
            if (end < payload.length && /[\uD800-\uDBFF]/.test(payload[end - 1])) end--;
            parts.push(payload.slice(start,end));
            start = end;
          }
        }
        const revision = await fs.runTransaction(db, async tx => {
          const board = await tx.get(this.ref());
          const receipt = this.ref('receipts', id);
          const existing = await tx.get(receipt);
          if (existing.exists()) return existing.data().revision;
          const revision = board.data().head + 1;
          const ref = this.ref('operations', sequence(revision));
          const header = {operationId:id, author:this.deviceId, revision};
          if (parts.length) {
            for (const [index, data] of parts.entries()) tx.set(this.ref('operations', ref.id, 'parts', sequence(index)), {payload:data});
            header.parts = parts.length;
          } else header.payload = payload;
          tx.set(ref, header);
          tx.set(receipt, {revision});
          tx.update(this.ref(), {head:revision, last:ref.id});
          return revision;
        });
        operation.sent = true;
        this.head = Math.max(this.head ?? 0, revision);
      }
      this.retryDelay = 1000;
    })().finally(()=>{
      this.pushing = null;
      this.events.status();
      if (!this.detaching && this.online && this.state.revision < this.head) this.pull().catch(error=>this.retrySync(error));
    });
    await this.pushing;
  }

  setOffline() {
    if (!this.options) return;
    this.online = false;
    this.events.status();
  }

  retrySync(error) {
    const temporary = ['unavailable','deadline-exceeded','aborted','internal','resource-exhausted'].includes(error.code);
    if (!temporary) {this.events.error(error);return;}
    if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
      this.online = false;
      this.events.status();
    }
    clearTimeout(this.retryTimer);
    if (!this.options) return;
    this.retryTimer=setTimeout(async ()=>{
      if (!this.options || this.detaching) return;
      try {
        const snapshot = await this.fs.getDocFromServer(this.ref());
        if (!isReady(snapshot) || !this.options) return;
        this.head = Math.max(this.head || 0,snapshot.data().head);
        this.online = true;
        this.events.status();
        await this.pull();
      } catch (next) {this.retrySync(next);}
    },this.retryDelay);
    this.retryDelay=Math.min(this.retryDelay*2,60000);
  }

  async sendSharedView(state,toggle,changeTargets) {
    if (!this.online || !this.boardReady) {
      if (toggle!==undefined || changeTargets) throw Error('기기가 온라인일 때 화면 동기화를 변경할 수 있습니다.');
      return false;
    }
    const ref=this.ref('control','view');
    return this.fs.runTransaction(this.db,async tx=>{
      const before=(await tx.get(ref)).data();
      const existing=Array.isArray(before?.targets)?before.targets:[];
      const targets=changeTargets?[...new Set(changeTargets(existing))]:existing;
      if (toggle===undefined && !changeTargets &&
        (!before?.enabled || before.epoch!==state.epoch || !targets.includes(state.sourceTab))) return false;
      const enabled=targets.length>0 && (toggle??(changeTargets?true:before?.enabled));
      const view=changeTargets && !targets.includes(state.sourceTab) && before?.pageId ? before : state;
      tx.set(ref,{...view,enabled,targets,epoch:changeTargets||toggle!==undefined?state.epoch:before.epoch,
        device:this.deviceId,at:this.fs.serverTimestamp()});
      return true;
    });
  }

  async sendView(view) {
    if (!this.boardReady || !this.online || !validView(view)) return;
    await this.fs.setDoc(this.ref('control','view'), {...view, device:this.deviceId, at:this.fs.serverTimestamp()});
  }
}
