import {MAX_FILE_BYTES, MAX_PDF_PAGES} from './constants.js';
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
export async function decodeFiles(files,{signal,onProgress=()=>{},requestPassword=null}={}) {
  const results=[];
  if (!files.length) return results;
  if (files.reduce((n,f)=>n+f.size,0)>MAX_FILE_BYTES) throw Error('한 번에 가져오는 파일은 합계 40MB 이하여야 합니다.');
  for (const file of files) {
    checkCancelled(signal);
    if (/\.pdf$/i.test(file.name) || file.type==='application/pdf') {
      const lib=await pdfjs();
      const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
        cMapUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/cmaps/',cMapPacked:true,
        standardFontDataUrl:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/standard_fonts/'});
      task.onPassword=(update,reason)=>{
        Promise.resolve(requestPassword ? requestPassword(reason===2?'PDF 암호가 틀렸습니다. 다시 입력해주세요.':'PDF 암호를 입력해주세요.') : null)
          .then(password=>{if(password===null || password===undefined) task.destroy();else update(password);})
          .catch(()=>task.destroy());
      };
      const abort=()=>{task.destroy().catch(()=>{});};
      signal?.addEventListener('abort',abort,{once:true});
      try {
        const pdf=await task.promise;
        if(pdf.numPages>MAX_PDF_PAGES) throw Error(`PDF는 한 파일당 ${MAX_PDF_PAGES}쪽까지 지원합니다. PDF를 나누어 넣어주세요.`);
        for(let n=1;n<=pdf.numPages;n++) {
          checkCancelled(signal);onProgress(`${file.name}: ${n}/${pdf.numPages}쪽 변환 중`);
          const p=await pdf.getPage(n),base=p.getViewport({scale:1});
          const scale=Math.min(2,2048/Math.max(base.width,base.height));
          const v=p.getViewport({scale}),c=document.createElement('canvas');c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);
          await p.render({canvasContext:c.getContext('2d'),viewport:v,background:'rgb(255,255,255)'}).promise;
          results.push({image:await fabricImage(c.toDataURL('image/png')),name:`${file.name} ${n}쪽`});
          p.cleanup(); c.width=0;c.height=0;
        }
      } finally {signal?.removeEventListener('abort',abort);await task.destroy();}
    } else if (/\.(png|jpe?g|gif)$/i.test(file.name) || /^image\/(png|jpeg|gif)$/.test(file.type)) {
      onProgress(`${file.name || '클립보드 이미지'} 변환 중`);
      results.push({image:await fabricImage(await imageURL(file)),name:file.name});
    } else throw Error(`지원하지 않는 파일입니다: ${file.name}. PNG/JPG/GIF/PDF를 사용해주세요.`);
    if(results.length>100) throw Error('한 번에는 이미지/PDF 페이지 합계 100개까지만 넣을 수 있습니다.');
  }
  checkCancelled(signal);return results;
}
