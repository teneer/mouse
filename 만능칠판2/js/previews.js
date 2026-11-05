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
// The thumbnail mirrors the viewport that was visible when the screen was saved.
// `viewportTransform` is a Fabric transform from canvas/world coordinates to screen pixels.
export async function makeThumbnail(content,viewportTransform=null,viewportWidth=null,viewportHeight=null,width=320) {
  const {frame}=content;
  const sourceWidth=Number.isFinite(viewportWidth)&&viewportWidth>0?viewportWidth:frame.width;
  const sourceHeight=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:frame.height;
  const ratio=width/sourceWidth;
  const height=Math.max(1,Math.round(sourceHeight*ratio));
  const c=new fabric.StaticCanvas(document.createElement('canvas'),{width,height,enableRetinaScaling:false,renderOnAddRemove:false});
  try {
    await loadCanvas(c,content.canvas);
    const v=Array.isArray(viewportTransform)&&viewportTransform.length===6&&viewportTransform.every(Number.isFinite)
      ? viewportTransform
      : [1,0,0,1,sourceWidth/2-frame.cx,sourceHeight/2-frame.cy];
    c.setViewportTransform(v.map((n,i)=>i<4?n*ratio:n*ratio));
    c.renderAll();
    return c.toDataURL({format:'png',multiplier:1});
  } finally {c.dispose();}
}
