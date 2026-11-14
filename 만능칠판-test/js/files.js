import {MAX_FILE_BYTES, uid} from './constants.js';
let pdfLibrary;
async function pdfjs() {
  if (!pdfLibrary) {
    pdfLibrary=import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs').then(lib=>{
      lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';return lib;
    }).catch(e=>{pdfLibrary=null;throw Error(`PDF 라이브러리를 불러오지 못했습니다. 인터넷/CDN 연결을 확인해주세요. ${e.message}`);});
  }
  return pdfLibrary;
}
function checkCancelled(signal) {if(signal?.aborted) throw new DOMException('가져오기를 취소했습니다.','AbortError');}
export function readDataURL(blob) {
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
}
export async function imageURL(blob) {
  const url=URL.createObjectURL(blob);
  try {
    const img=await new Promise((resolve,reject)=>{
      const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('이미지를 읽을 수 없습니다.'));i.src=url;
    });
    if (!img.naturalWidth || img.naturalWidth*img.naturalHeight>64000000) throw Error('이미지가 너무 큽니다. 6,400만 픽셀 이하로 줄여주세요.');
    const scale=Math.min(1,3072/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/png');
  } finally {URL.revokeObjectURL(url);}
}
export function fabricImage(url) {
  return new Promise((resolve,reject)=>fabric.Image.fromURL(url,(img,error)=>{
    if(error || !img?.width) reject(Error('이미지 객체를 만들 수 없습니다.'));else resolve(img);
  }));
}
const pdfOptions = {
  isEvalSupported:false,
  cMapUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',cMapPacked:true,
  standardFontDataUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/standard_fonts/'
};

async function openPDF(blob, password, requestPassword, signal) {
  const lib = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  checkCancelled(signal);
  const task = lib.getDocument({data, password, ...pdfOptions});
  task.onPassword = (update, reason) => {
    Promise.resolve(requestPassword?.(reason === 2 ? 'PDF 암호가 틀렸습니다. 다시 입력해주세요.' : 'PDF 암호를 입력해주세요.'))
      .then(value => value == null ? task.destroy() : update(value)).catch(()=>task.destroy().catch(()=>{}));
  };
  const destroy = async () => {
    signal?.removeEventListener('abort', abort);
    await task.destroy();
  };
  const abort = () => destroy().catch(()=>{});
  signal?.addEventListener('abort', abort, {once:true});
  try {return {pdf:await task.promise, destroy};}
  catch (error) {await destroy();checkCancelled(signal);throw error;}
}

export async function prepareFiles(files, {signal,onProgress,requestPassword}={}) {
  const assets = [], placements = [];
  let imageBytes = 0;
  for (const file of files) {
    checkCancelled(signal);
    const isPDF = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const id = uid();
    const name = (file.name || '클립보드 이미지').slice(0,512);
    const info = {id, name, type:isPDF ? 'pdf' : 'image', size:file.size};
    const asset = {id, blob:file};
    if (isPDF) {
      const ask = async message => {
        asset.password = await requestPassword?.(message);
        return asset.password;
      };
      const {pdf,destroy} = await openPDF(file, null, ask, signal);
      try {
        for (let page = 1; page <= pdf.numPages; page++) {
          checkCancelled(signal);
          onProgress?.(`${name} · ${page}/${pdf.numPages}쪽 확인 중`);
          const source = await pdf.getPage(page);
          const viewport = source.getViewport({scale:1});
          placements.push({wbAsset:info, wbPage:page, width:viewport.width, height:viewport.height});
          source.cleanup();
        }
      } finally {await destroy();}
    } else if (/\.(png|jpe?g|gif)$/i.test(name) || /^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      imageBytes += file.size;
      if (imageBytes > MAX_FILE_BYTES) throw Error('이미지는 한 번에 합계 40MB까지 가져올 수 있습니다.');
      onProgress?.(`${name} 확인 중`);
      const image = await fabricImage(await imageURL(file));
      placements.push({wbAsset:info, width:image.width, height:image.height});
    } else throw Error(`지원하지 않는 파일입니다: ${name}. PNG/JPG/GIF/PDF를 사용해주세요.`);
    assets.push(asset);
  }
  checkCancelled(signal);
  return {assets, placements};
}

export function assetReferences(objects, files = new Map()) {
  for (const object of objects) {
    if (object.wbAsset) files.set(object.wbAsset.id, object.wbAsset);
    if (object.objects) assetReferences(object.objects, files);
  }
  return files;
}

export function assetObjectInfo(info) {
  return info && /^[a-zA-Z0-9_-]{1,128}$/.test(info.id) && typeof info.name === 'string' &&
    info.name.length <= 512 && ['image','pdf'].includes(info.type) &&
    Number.isSafeInteger(info.size) && info.size >= 0;
}

export class BoardFiles {
  constructor(store) {
    this.store = store;
    this.cache = new Map();
    this.assets = new Map();
    this.pdfs = new Map();
    this.queue = [];
    this.rendering = 0;
    this.unavailable = new Set();
    this.transfers = new Map();
  }

  invalidate(id) {
    this.assets.delete(id);
    this.unavailable.delete(id);
    for (const [key, value] of this.cache) {
      if (key.startsWith(id + '/')) {
        this.cache.delete(key);
        value.waiters?.forEach(canvas => canvas.requestRenderAll());
      }
    }
  }

  async checkAvailability(id) {
    if (!this.assets.has(id)) {
      if (this.assets.size >= 4) this.assets.delete(this.assets.keys().next().value);
      const loading = this.store.getAsset(id).catch(error=>{this.assets.delete(id);throw error;});
      this.assets.set(id, loading);
      const asset = await loading;
      if (!asset) this.unavailable.add(id);
      return asset;
    }
    return this.assets.get(id);
  }

  lookup(object, canvas) {
    const {id} = object.wbAsset;
    const key = id + '/' + (object.wbPage || 0);
    if (this.unavailable.has(id)) return null;
    const entry = this.cache.get(key);
    if (entry) {
      if (entry.bitmap) {
        this.cache.delete(key);
        this.cache.set(key, entry);
      } else if (canvas) entry.waiters?.add(canvas);
      return entry.bitmap;
    }
    const waiters = new Set(canvas ? [canvas] : []);
    const job = {key, object, waiters};
    this.cache.set(key, job);
    this.queue.push(job);
    this.drain();
    return null;
  }

  drain() {
    while (this.rendering < 2 && this.queue.length) {
      const job = this.queue.shift();
      if (this.cache.get(job.key) !== job) continue;
      this.rendering++;
      this.render(job.object).then(bitmap => {
        if (this.cache.get(job.key) === job) {
          if (bitmap) this.cache.set(job.key,{bitmap});
          else this.cache.set(job.key,{});
          let bitmaps = 0;
          for (const [key, entry] of [...this.cache].reverse()) {
            if (entry.bitmap && ++bitmaps > 10) this.cache.delete(key);
          }
        }
      }).catch(error => {
        if (this.cache.get(job.key) === job) this.cache.set(job.key,{error:true});
        console.warn('PDF·이미지 표시 실패', error);
      }).finally(() => {
        this.rendering--;
        job.waiters.forEach(canvas => canvas.requestRenderAll());
        this.drain();
      });
    }
  }

  async render(object) {
    const {id, type} = object.wbAsset;
    const asset = await this.checkAvailability(id);
    if (!asset) {this.unavailable.add(id);return null;}
    if (type === 'image') return (await fabricImage(await imageURL(asset.blob))).getElement();
    if (!this.pdfs.has(id)) {
      const opening = openPDF(asset.blob, asset.password);
      this.pdfs.set(id, opening);
      if (this.pdfs.size > 2) {
        const oldest = this.pdfs.keys().next().value;
        this.pdfs.get(oldest).then(document => document.destroy()).catch(()=>{});
        this.pdfs.delete(oldest);
      }
    }
    const {pdf} = await this.pdfs.get(id);
    const page = await pdf.getPage(object.wbPage);
    const base = page.getViewport({scale:1});
    const viewport = page.getViewport({scale:Math.min(2,1600/Math.max(base.width,base.height))});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'), viewport, background:'#fff'}).promise;
    page.cleanup();
    return canvas;
  }

  installFabric() {
    const files = this;
    fabric.WbFile = fabric.util.createClass(fabric.Rect, {
      type:'wb-file',
      initialize(options) {
        this.callSuper('initialize', {...options, objectCaching:false, strokeWidth:0});
        this.id = options.id;
        this.wbAsset = options.wbAsset;
        this.wbPage = options.wbPage;
      },
      shouldCache() {this.ownCaching=false;return false;},
      _render(ctx) {
        const w = this.width, h = this.height;
        if (ctx.canvas.width && ctx.canvas.height && ctx.getTransform) {
          const transform=ctx.getTransform(), x=w/2, y=h/2;
          // The renderer sees group transforms and retina scaling in addition to the viewport.
          const dx=Math.abs(transform.a*x)+Math.abs(transform.c*y);
          const dy=Math.abs(transform.b*x)+Math.abs(transform.d*y);
          if(transform.e+dx<0 || transform.f+dy<0 || transform.e-dx>ctx.canvas.width || transform.f-dy>ctx.canvas.height)return;
        }
        const bitmap = files.lookup(this, this.canvas || this.group?.canvas);
        if (bitmap) {ctx.drawImage(bitmap,-w/2,-h/2,w,h);return;}
        const transfer = files.transfers.get(this.wbAsset.id);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(-w/2,-h/2,w,h);
        ctx.strokeStyle = '#536675';
        ctx.lineWidth = 2;
        ctx.setLineDash([8,6]);
        ctx.strokeRect(-w/2,-h/2,w,h);
        ctx.setLineDash([]);
        ctx.fillStyle = '#243746';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.min(18,w/8,h/6)}px sans-serif`;
        const label = transfer || (files.unavailable.has(this.wbAsset.id) ? '파일 관리에서 받기' : files.cache.get(this.wbAsset.id+'/'+(this.wbPage||0))?.error ? '파일을 표시할 수 없음' : '불러오는 중…');
        const name = this.wbPage ? `${this.wbAsset.name} · ${this.wbPage}쪽` : this.wbAsset.name;
        ctx.fillText(name,0,-12,w*.9);
        ctx.fillText(label,0,12,w*.9);
      }
    });
    fabric.WbFile.fromObject = (value, callback) => callback(new fabric.WbFile(value));
  }
}
