import {SERIAL_PROPS,uid} from './js/constants.js';
import {validateContent} from './js/validation.js';
const utf8To64=s=>{const bytes=new TextEncoder().encode(s);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
const from64=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));
const escapeHTML=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function freshIds(obj) {obj.id=uid();obj.objects?.forEach(freshIds);}
function dataURLBlob(url) {const [header,body]=url.split(',');const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));return new Blob([bytes],{type:header.match(/:(.*?);/)[1]});}
export function parseBoardHTML(html) {
  if(!html || html.length>20*1024*1024) return null;
  const node=new DOMParser().parseFromString(html,'text/html').querySelector('[data-whiteboard-v2]');
  if(!node) return null;
  const payload=JSON.parse(from64(node.getAttribute('data-whiteboard-v2')));
  return validateContent({canvas:{objects:[payload.object],background:'#fff'},frame:{width:1280,height:720,cx:0,cy:0}}).canvas.objects[0];
}
export class SystemClipboard {
  constructor({canvas,allowed,run,onChange,onFiles,onText,notify,isTextEditing}) {
    Object.assign(this,{canvas,allowed,run,onChange,onFiles,onText,notify,isTextEditing});
    document.addEventListener('copy',e=>this.nativeCopy(e,false));
    document.addEventListener('cut',e=>this.nativeCopy(e,true));
    document.addEventListener('paste',e=>this.nativePaste(e));
  }
  capture() {
    const object=this.canvas.getActiveObject();if(!object) throw Error('먼저 복사할 객체를 선택해주세요.');
    const json=object.toObject(SERIAL_PROPS);
    if(json.type==='activeSelection') json.type='group';
    const encoded=utf8To64(JSON.stringify({object:json}));
    if(encoded.length>20*1024*1024) throw Error('선택한 내용이 너무 큽니다. 나누어 복사해주세요.');
    const plain=object.text || object.getObjects?.().map(o=>o.text || '').filter(Boolean).join('\n') || '만능칠판 객체';
    
    const bounds=object.getBoundingRect(true,true),multiplier=Math.min(1,4096/Math.max(bounds.width,bounds.height,1));
    const pngURL=object.toDataURL({format:'png',multiplier,enableRetinaScaling:false});
    const png=dataURLBlob(pngURL);
    const body=['text','i-text','textbox'].includes(object.type)?escapeHTML(plain).replace(/\n/g,'<br>'):`<img src="${pngURL}" alt="만능칠판 객체">`;
    const html=`<div data-whiteboard-v2="${encoded}">${body}</div>`;
    if(html.length>32*1024*1024)throw Error('복사 데이터가 너무 큽니다. 객체를 나누어 복사해주세요.');
    return {html,plain,png,objects:this.canvas.getActiveObjects().slice()};
  }
  async writeSystem(pack) {
    if(!navigator.clipboard?.write || typeof ClipboardItem==='undefined') throw Error('이 브라우저에서는 복사 버튼을 지원하지 않습니다. Ctrl/Cmd+C를 사용해주세요.');
    const data={'image/png':pack.png,'text/plain':new Blob([pack.plain],{type:'text/plain'})};
    if(!ClipboardItem.supports || ClipboardItem.supports('text/html')) data['text/html']=new Blob([pack.html],{type:'text/html'});
    try {await navigator.clipboard.write([new ClipboardItem(data)]);}
    catch(firstError) {
      // Some browsers only accept PNG. This fallback still copies to the real OS clipboard.
      await navigator.clipboard.write([new ClipboardItem({'image/png':pack.png})]);
      this.notify('이 브라우저에서는 이미지로 복사했습니다. 편집 가능한 복사는 Ctrl/Cmd+C를 사용해주세요.');
    }
  }
  remove(pack) {this.canvas.discardActiveObject();pack.objects.forEach(o=>this.canvas.remove(o));this.canvas.requestRenderAll();this.onChange();}
  nativeCopy(event,cut) {
    if(!this.allowed() || this.isTextEditing()) return;
    try {
      const pack=this.capture();
      if(!event.clipboardData) return;
      event.clipboardData.setData('text/plain',pack.plain);
      event.clipboardData.setData('text/html',pack.html);
      event.preventDefault();
      if(cut) this.remove(pack);
      this.writeSystem(pack).catch(()=>this.notify('객체/텍스트를 복사했습니다. 외부 앱으로 이미지 복사는 복사 버튼을 사용해주세요.'));
    } catch(e) {this.notify(e.message);}
  }
  async copy(cut=false) {
    if(!this.allowed() || this.isTextEditing()) return;
    try {const pack=this.capture();await this.writeSystem(pack);if(cut)this.remove(pack);this.notify('시스템 클립보드에 복사했습니다.');}
    catch(e) {this.notify(`복사하지 못했습니다. ${e.message}`);}
  }
  nativePaste(event) {
    if(!this.allowed() || this.isTextEditing() || !event.clipboardData) return;
    const d=event.clipboardData,html=d.getData('text/html');
    const files=Array.from(d.files).filter(f=>/^image\/(png|jpeg|gif)$/.test(f.type));
    const text=d.getData('text/plain');
    if(!html.includes('data-whiteboard-v2') && !files.length && !text) return;
    event.preventDefault();
    this.run(async()=>{
      const object=parseBoardHTML(html);
      if(object) await this.pasteObject(object);
      else if(files.length) await this.onFiles(files);
      else if(text) this.onText(text);
    });
  }
  async paste() {
    if(!this.allowed() || this.isTextEditing()) return;
    // Start permission request synchronously inside the click handler.
    if(!navigator.clipboard?.read) {this.notify('Ctrl/Cmd+V로 붙여넣어주세요.');return;}
    const reading=navigator.clipboard.read();
    await this.run(async()=>{
      let items;try {items=await reading;}catch{throw Error('클립보드 권한이 거부되었습니다. Ctrl/Cmd+V를 사용해주세요.');}
      let text='',image=null;
      for(const item of items) {
        if(item.types.includes('text/html')) {
          const object=parseBoardHTML(await (await item.getType('text/html')).text());
          if(object) {await this.pasteObject(object);return;}
        }
        const type=item.types.find(t=>/^image\/(png|jpeg|gif)$/.test(t));
        if(type && !image) {const blob=await item.getType(type);image=new File([blob],'clipboard.'+(type==='image/jpeg'?'jpg':type.split('/')[1]),{type});}
        if(item.types.includes('text/plain')) text=await (await item.getType('text/plain')).text();
      }
      if(image) await this.onFiles([image]);else if(text) this.onText(text);else this.notify('붙여넣을 이미지나 텍스트가 없습니다.');
    });
  }
  async pasteObject(json) {
    freshIds(json);
    const objects=await new Promise(resolve=>fabric.util.enlivenObjects([json],resolve));
    const object=objects[0];if(!object)throw Error('클립보드 객체를 복원하지 못했습니다.');
    const c=this.canvas,center=fabric.util.transformPoint(new fabric.Point(c.width/2,c.height/2),fabric.util.invertTransform(c.viewportTransform));
    object.setPositionByOrigin(center,'center','center');object.setCoords();c.add(object);c.setActiveObject(object);c.requestRenderAll();this.onChange();
  }
}
