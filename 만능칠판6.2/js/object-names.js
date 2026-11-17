const TEXT_TYPES=new Set(['text','i-text','textbox']);
const KIND={
  path:'필기',text:'텍스트','i-text':'텍스트',textbox:'텍스트',
  group:'그룹',image:'이미지','wb-file':'이미지',rect:'도형',circle:'도형',
  ellipse:'도형',polygon:'도형',polyline:'도형',line:'도형',triangle:'도형'
};
export function objectKind(object){
  if(object?.wbAsset?.type==='pdf')return 'PDF';
  if(object?.wbAsset)return '이미지';
  return KIND[object?.type]||'개체';
}
export function objectName(object,index=0){
  const custom=typeof object?.wbName==='string'?object.wbName.trim():'';
  if(custom)return custom.slice(0,80);
  if(object?.wbAsset?.name)return String(object.wbAsset.name).slice(0,80);
  if(TEXT_TYPES.has(object?.type)){
    const text=String(object.text||'').replace(/\s+/g,' ').trim();
    if(text)return text.slice(0,36)+(text.length>36?'…':'');
  }
  return objectKind(object)+' '+(index+1);
}
export function objectDisplayName(object,index=0){
  return objectKind(object)+' · '+objectName(object,index);
}
