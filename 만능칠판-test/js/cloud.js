import {uid} from './constants.js';
import {applyOperation, boardPages, newBoard, validView} from './cloud-model.js';
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
    this.latestView = null;
    this.boardReady = false;
    this.online = false;
    this.retryDelay = 1000;
  }

  async authenticate(config) {
    if (this.user && JSON.stringify(this.config) === JSON.stringify(config)) return;
    if (this.options) throw Error('현재 연결을 해제한 뒤 다른 Firebase 프로젝트를 연결해주세요.');
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

  async create(config, label, pages) {
    await this.authenticate(parseFirebaseConfig(config));
    const options = {config:this.config, boardId:uid(), label, initial:true};
    const {fs, db, deviceId} = this;
    const board = fs.doc(db, 'wbBoards', options.boardId);
    const batch = fs.writeBatch(db);
    batch.set(board, {owner:deviceId, head:0, created:fs.serverTimestamp()});
    batch.set(fs.doc(board, 'devices', deviceId), {label, joined:fs.serverTimestamp()});
    await batch.commit();
    this.options = options;
    try {await this.enqueue({kind:'seed', pages}, false);}
    catch(error) {this.options=null;throw error;}
    await this.store.setMeta('cloudConnection', options);
    await this.start(options);
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
    this.stopApproval?.();
    const {fs, db, deviceId} = this;
    this.stopApproval = fs.onSnapshot(fs.doc(db, 'wbBoards', request.options.boardId, 'requests', request.code), {includeMetadataChanges:true}, async snapshot => {
      if (isReady(snapshot) && snapshot.data().approved === true && snapshot.data().deviceId === deviceId) {
        try {
          this.stopApproval?.();
          await this.store.setMeta('cloudConnection', request.options);
          await this.store.setMeta('cloudRequest', null);
          this.events.approved();
          await this.start(request.options);
        } catch (error) {this.events.error(error);}
      }
    }, this.events.error);
  }

  async approve(code) {
    const {fs, db} = this;
    const request = this.ref('requests', code.replace(/[\s-]/g,'').toUpperCase());
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
    if (request) {
      await this.authenticate(parseFirebaseConfig(request.options.config));
      this.waitForApproval(request);
      this.events.waiting(request.code);
    }
  }

  async start(options) {
    await this.authenticate(parseFirebaseConfig(options.config));
    this.options = options;
    this.state = await this.store.getMeta('cloud-state:' + options.boardId) || newBoard();
    this.pending = new Map((await this.store.listCloudOperations(options.boardId)).map(operation => [operation.id, operation]));
    const {fs} = this;
    const statusError = error => {
      this.online = false;
      this.events.status();
      this.events.error(error);
    };
    this.subscriptions.push(fs.onSnapshot(this.ref(), {includeMetadataChanges:true}, snapshot => {
      if (!isReady(snapshot)) {
        this.online = false;
        this.events.status();
        return;
      }
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
      if (isReady(snapshot) && validView(snapshot.data())) {
        this.latestView = snapshot.data();
        this.events.view(this.latestView);
      }
    }, this.events.error));
    if (options.initial && this.pending.size && !this.state.revision) {
      this.boardReady = boardPages(this.projected()).length > 0;
      this.events.board();
    }
    if (this.state.revision > 0) {
      this.boardReady = true;
      this.events.board();
    }
    this.events.status();
  }

  async disconnect() {
    if (this.pulling || this.pushing || this.pending.size) throw Error('서버에 보낼 변경이 남아 있습니다. 동기화를 마친 뒤 연결을 해제해주세요.');
    clearTimeout(this.retryTimer);
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.stopApproval?.();
    this.options = null;
    this.boardReady = false;
    this.online = false;
    this.head = 0;
    this.devices = [];
    this.latestView = null;
    this.state = newBoard();
    await this.store.setMeta('cloudConnection', null);
    await this.store.setMeta('cloudRequest', null);
    this.events.status();
  }

  projected() {
    const board = structuredClone(this.state);
    let revision = board.revision;
    for (const operation of this.pending.values()) applyOperation(board, operation, ++revision);
    return board;
  }

  async enqueue(operation, startPush = true) {
    if (!this.options) throw Error('기기 연결을 확인해주세요.');
    const record = {...structuredClone(operation), id:uid(), boardId:this.options.boardId, time:Date.now()};
    await this.store.putCloudOperation(record);
    this.pending.set(record.id, record);
    if (startPush) {
      this.events.board();
      this.push().catch(error=>this.retrySync(error));
    }
    return record;
  }

  async pull() {
    if (this.pulling || !this.online) return this.pulling;
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
          if (this.pending.has(entry.operationId)) confirmed.push(entry.operationId);
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
    if (!this.online || this.pushing || this.pulling || !this.pending.size || !this.options) return;
    const {fs, db} = this;
    this.pushing = true;
    try {
      // Keep an operation pending until its committed sequence is applied by pull().
      for (const operation of [...this.pending.values()]) {
        if (operation.sent) continue;
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
    } finally {
      this.pushing = false;
      this.events.status();
      if (this.online && this.state.revision < this.head) this.pull().catch(error=>this.retrySync(error));
    }
  }

  retrySync(error) {
    const temporary = ['unavailable','deadline-exceeded','aborted','internal','resource-exhausted'].includes(error.code);
    if (!temporary) {this.events.error(error);return;}
    clearTimeout(this.retryTimer);
    if (!this.options) return;
    this.retryTimer=setTimeout(()=>{
      if (this.online) this.pull().catch(next=>this.retrySync(next));
    },this.retryDelay);
    this.retryDelay=Math.min(this.retryDelay*2,60000);
  }

  async sendView(view) {
    if (!this.boardReady || !this.online || !validView(view)) return;
    await this.fs.setDoc(this.ref('control','view'), {...view, device:this.deviceId, at:this.fs.serverTimestamp()});
  }
}
