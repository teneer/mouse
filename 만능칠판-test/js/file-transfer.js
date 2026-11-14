import {uid} from './constants.js';

const chunk = 32 * 1024;
const rtcOptions = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
const timeout = 20000;

async function description(peer, local, signal) {
  await peer.setLocalDescription(local);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', check);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const check = () => {if(peer.iceGatheringState === 'complete') done();};
      const timer = setTimeout(done, 4500);
      peer.addEventListener('icegatheringstatechange', check);
      signal.addEventListener('abort', done, {once:true});
      if (signal.aborted) done();
      else check();
    });
  }
  signal.throwIfAborted();
  return peer.localDescription.toJSON();
}

function waitForBuffer(channel, signal) {
  if (channel.bufferedAmount < 512 * 1024) return;
  return new Promise((resolve,reject) => {
    const stop = () => {
      cleanup();
      reject(Error('파일 보내기가 중단되었습니다.'));
    };
    const ready = () => {cleanup();resolve();};
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow',ready);
      channel.removeEventListener('close',stop);
      signal.removeEventListener('abort',stop);
    };
    channel.addEventListener('bufferedamountlow',ready,{once:true});
    channel.addEventListener('close',stop,{once:true});
    signal.addEventListener('abort',stop,{once:true});
    if (signal.aborted || channel.readyState !== 'open') stop();
  });
}

export class FileTransfer {
  constructor(cloud, files, onChange) {
    Object.assign(this,{cloud, files, onChange});
    this.incoming = new Map();
    this.outgoing = new Map();
    this.known = new Set();
    this.holders = new Map();
  }

  start() {
    if (this.stopListening || !this.cloud.online) return;
    const {fs,deviceId} = this.cloud;
    this.stopListening = fs.onSnapshot(fs.query(this.cloud.collection('transfers'),
      fs.where('participants','array-contains',deviceId)), snapshot => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        if (data.receiver !== deviceId) continue;
        if (change.type === 'removed') {
          this.outgoing.get(change.doc.id)?.abort();
        } else if (change.type === 'added' && data.status === 'offered' &&
            Date.now() - data.created?.toMillis() < 120000) {
          this.send(change.doc.ref,data).catch(console.warn);
        }
      }
    }, this.cloud.events.error);
  }

  stop() {
    this.stopListening?.();
    this.stopListening = null;
    for (const task of this.incoming.values()) task.controller.abort();
    for (const controller of this.outgoing.values()) controller.abort();
    this.known.clear();
    this.holders.clear();
  }

  async advertise(info, asset) {
    if (!this.cloud.online || this.known.has(info.id)) return;
    this.known.add(info.id);
    try {
      const {fs,deviceId} = this.cloud;
      await fs.setDoc(this.cloud.ref('availability',deviceId,'files',info.id), {id:info.id,size:asset.blob.size});
    } catch (error) {
      this.known.delete(info.id);
      throw error;
    }
  }

  async sources(info) {
    const {fs,devices,deviceId} = this.cloud;
    const results = await Promise.all(devices.filter(device=>device.id!==deviceId).map(async device => {
      const snapshot = await fs.getDocFromServer(this.cloud.ref('availability',device.id,'files',info.id));
      return snapshot.exists() ? device.id : null;
    }));
    const holders = results.filter(Boolean);
    this.holders.set(info.id,holders);
    return holders;
  }

  cancel(id) {this.incoming.get(id)?.controller.abort();}

  async receive(info) {
    if (this.incoming.has(info.id)) return;
    if (!this.cloud.online) throw Error('기기 연결이 온라인 상태일 때 받을 수 있습니다.');
    if (!globalThis.RTCPeerConnection) throw Error('이 브라우저에서는 기기 간 파일 전송을 지원하지 않습니다.');
    if (await this.files.store.getAsset(info.id)) return;
    if (this.incoming.has(info.id)) return;
    const controller = new AbortController();
    this.incoming.set(info.id,{controller,label:'연결 중…'});
    this.onChange(info.id);
    try {
      const devices = await this.sources(info);
      controller.signal.throwIfAborted();
      if (!devices.length) throw Error('파일을 가진 기기에서 앱을 열어 주세요.');
      let lastError;
      for (const device of devices) {
        try {
          const asset = await this.receiveFrom(info,device,controller.signal);
          await this.files.store.putAsset(asset);
          this.files.invalidate(info.id);
          this.advertise(info,asset).catch(console.warn);
          return;
        } catch (error) {
          controller.signal.throwIfAborted();
          lastError = error;
          if (error.name === 'QuotaExceededError') throw error;
        }
      }
      throw lastError;
    } finally {
      this.incoming.delete(info.id);
      this.onChange(info.id);
    }
  }

  async receiveFrom(info, device, signal) {
    const {fs,deviceId} = this.cloud;
    const peer = new RTCPeerConnection(rtcOptions);
    const channel = peer.createDataChannel('whiteboard-file');
    channel.binaryType = 'arraybuffer';
    const ref = this.cloud.ref('transfers',uid());
    let stop, timer, abort, announced = false;
    const buffers = [];
    let bytes = 0, header, ended = false;
    const completion = new Promise((resolve,reject) => {
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(()=>reject(Error('직접 연결이 완료되지 않았습니다. 파일이 있는 기기에서 앱을 열어 주세요.')),timeout);
      };
      abort = () => reject(new DOMException('파일 받기를 취소했습니다.','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      channel.onclose = () => {if(!ended) reject(Error('기기 간 연결이 끊겼습니다.'));};
      peer.onconnectionstatechange = () => {if(peer.connectionState==='failed') reject(Error('기기 간 직접 연결에 실패했습니다.'));};
      channel.onmessage = ({data}) => {
        try {
          arm();
          if (typeof data === 'string') {
            const message = JSON.parse(data);
            if (!header && message.size === info.size) {header = message;return;}
            if (!header || message.done !== true || bytes !== info.size) throw Error('파일 전송 내용이 올바르지 않습니다.');
            ended = true;
            resolve({id:info.id,blob:new Blob(buffers,{type:header.type}),password:header.password});
            return;
          }
          if (!header || !(data instanceof ArrayBuffer) || bytes + data.byteLength > info.size) throw Error('파일 크기가 일치하지 않습니다.');
          buffers.push(data);
          bytes += data.byteLength;
          const label = `받는 중 ${Math.floor(bytes/Math.max(1,info.size)*100)}%`;
          const task = this.incoming.get(info.id);
          if (task && task.label !== label) {task.label = label;this.onChange(info.id);}
        } catch (error) {reject(error);}
      };
      arm();
    });
    completion.catch(()=>{});
    try {
      const offer = await description(peer,await peer.createOffer(),signal);
      const announcement=fs.setDoc(ref,{sender:deviceId,receiver:device,participants:[deviceId,device],
        fileId:info.id,offer,created:fs.serverTimestamp(),status:'offered'});
      try {await Promise.race([announcement,completion]);}
      catch(error) {announcement.then(()=>fs.deleteDoc(ref)).catch(()=>{});throw error;}
      announced = true;
      signal.throwIfAborted();
      let answering = false;
      const remote = new Promise((_,reject) => {
        stop = fs.onSnapshot(ref,snapshot => {
          const data = snapshot.data();
          if (data?.status === 'unavailable') reject(Error('이 기기에 파일이 없습니다.'));
          if (data?.answer && !answering) {
            answering = true;
            peer.setRemoteDescription(data.answer).catch(reject);
          }
        },reject);
      });
      return await Promise.race([completion,remote]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort',abort);
      stop?.();
      peer.close();
      if (announced) fs.deleteDoc(ref).catch(console.warn);
    }
  }

  async send(ref, request) {
    if (this.outgoing.has(ref.id)) return;
    const {fs} = this.cloud;
    const controller = new AbortController();
    this.outgoing.set(ref.id,controller);
    const {signal} = controller;
    const asset = await this.files.store.getAsset(request.fileId).catch(()=>null);
    if (!asset || signal.aborted || !globalThis.RTCPeerConnection) {
      this.outgoing.delete(ref.id);
      if (!signal.aborted) await fs.updateDoc(ref,{status:'unavailable'});
      return;
    }
    const peer = new RTCPeerConnection(rtcOptions);
    const timer = setTimeout(()=>controller.abort(),timeout);
    let sending = false;
    const done = () => {
      clearTimeout(timer);
      peer.close();
      this.outgoing.delete(ref.id);
    };
    signal.addEventListener('abort',done,{once:true});
    peer.ondatachannel = ({channel}) => {
      if (sending) {channel.close();return;}
      sending = true;
      channel.bufferedAmountLowThreshold = 128 * 1024;
      channel.onopen = async () => {
        clearTimeout(timer);
        try {
          const {blob,password} = asset;
          channel.send(JSON.stringify({size:blob.size,type:blob.type,password}));
          for (let pos = 0; pos < blob.size; pos += chunk) {
            await waitForBuffer(channel,signal);
            signal.throwIfAborted();
            channel.send(await blob.slice(pos,pos+chunk).arrayBuffer());
          }
          channel.send(JSON.stringify({done:true}));
        } catch (error) {console.warn('파일 보내기 실패',error);done();}
      };
      channel.onclose = done;
    };
    try {
      await peer.setRemoteDescription(request.offer);
      const answer = await description(peer,await peer.createAnswer(),signal);
      await fs.updateDoc(ref,{answer,status:'answered'});
    } catch (error) {done();throw error;}
  }
}
