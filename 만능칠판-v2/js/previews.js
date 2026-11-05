export function loadCanvas(canvas, json) {
  return new Promise((resolve,reject)=>{
    try {
      let failures=0;
      canvas.loadFromJSON(json,()=>{
        canvas.requestRenderAll();
        if(failures)reject(Error(`${failures}개 객체를 복원하지 못했습니다. 원본 이미지 또는 백업 파일을 확인해주세요.`));else resolve();
      },(_source,object,error)=>{if(error || !object)failures++;});
    } catch(e) {reject(e);}
  });
}
// Fixed home viewport at 100%, never object bounding-box-fit or current zoom/pan.
export async function makeThumbnail(content, width=320) {
  const {frame}=content, ratio=width/frame.width;
  const c=new fabric.StaticCanvas(document.createElement('canvas'),{
    width,height:Math.max(1,Math.round(frame.height*ratio)),enableRetinaScaling:false,renderOnAddRemove:false
  });
  try {
    await loadCanvas(c,content.canvas);
    c.setViewportTransform([ratio,0,0,ratio,width/2-frame.cx*ratio,c.height/2-frame.cy*ratio]);
    c.renderAll();
    return c.toDataURL({format:'png',multiplier:1});
  } finally {c.dispose();}
}
