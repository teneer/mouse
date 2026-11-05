const TYPES = new Set(['path', 'text', 'i-text', 'textbox', 'rect', 'circle', 'ellipse',
  'polygon', 'polyline', 'line', 'triangle', 'group', 'image']);
// Do not instantiate arbitrary Fabric classes or fetch URLs supplied by a backup/clipboard.
export function validateContent(input) {
  if (!input || !input.canvas || !Array.isArray(input.canvas.objects)) throw Error('화면 데이터 형식이 올바르지 않습니다.');
  const data = structuredClone(input);
  const f = data.frame;
  if (!f || ![f.width, f.height, f.cx, f.cy].every(Number.isFinite) ||
      f.width < 1 || f.height < 1 || f.width > 20000 || f.height > 20000 ||
      Math.abs(f.cx) > 1e8 || Math.abs(f.cy) > 1e8) throw Error('뷰포트 크기가 올바르지 않습니다.');
  let count = 0, segments = 0;
  const KEYS = new Set(('type version originX originY left top width height fill stroke strokeWidth strokeDashArray strokeLineCap strokeDashOffset strokeLineJoin strokeUniform strokeMiterLimit scaleX scaleY angle flipX flipY opacity shadow visible backgroundColor fillRule paintFirst globalCompositeOperation skewX skewY rx ry radius startAngle endAngle path pathOffset points x1 y1 x2 y2 text fontSize fontWeight fontFamily fontStyle lineHeight underline overline linethrough textAlign textBackgroundColor charSpacing styles direction minWidth splitByGrapheme deltaY src crossOrigin filters resizeFilter cropX cropY objects clipPath inverted absolutePositioned id isHighlighter selectable evented').split(' '));
  function visit(obj, depth = 0) {
    if (++count > 15000 || depth > 32 || !obj || !TYPES.has(obj.type)) throw Error('지원하지 않거나 너무 복잡한 객체입니다.');
    for (const key of Object.keys(obj)) if(!KEYS.has(key)) delete obj[key];
    if(obj.text !== undefined && (typeof obj.text!=='string' || obj.text.length>100000)) throw Error('텍스트 데이터가 너무 크거나 올바르지 않습니다.');
    if(obj.type==='path') {
      if(!Array.isArray(obj.path)) throw Error('경로 데이터 오류입니다.');
      segments+=obj.path.length;
      if(segments>1000000 || obj.path.some(row=>!Array.isArray(row)||typeof row[0]!=='string'||!/^([MmLlHhVvCcSsQqTtAaZz])$/.test(row[0])||row.slice(1).some(n=>!Number.isFinite(n)))) throw Error('경로 데이터가 너무 크거나 올바르지 않습니다.');
    }
    for (const key of ['left','top','width','height','scaleX','scaleY','angle','opacity']) {
      if (obj[key] !== undefined && (!Number.isFinite(obj[key]) || Math.abs(obj[key]) > 1e8)) throw Error('객체 좌표가 올바르지 않습니다.');
    }
    if (obj.type === 'image' && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(obj.src || '')) {
      throw Error('외부 URL 이미지는 가져올 수 없습니다. 원본 이미지를 파일로 넣어주세요.');
    }
    for (const key of ['fill','stroke']) {
      if (obj[key] && typeof obj[key] === 'object') throw Error('패턴/그라디언트 채움은 이 버전에서 가져올 수 없습니다.');
    }
    if (obj.filters?.length) throw Error('이미지 필터가 있는 가져오기 데이터는 지원하지 않습니다.');
    delete obj.customLayer;
    obj.visible = true; obj.selectable = true; obj.evented = true;
    if (obj.clipPath) visit(obj.clipPath, depth + 1);
    if (obj.objects) {
      if (!Array.isArray(obj.objects)) throw Error('그룹 데이터 오류입니다.');
      obj.objects.forEach(child => visit(child, depth + 1));
    }
  }
  data.canvas.objects.forEach(obj => visit(obj));
  if (typeof data.canvas.background !== 'string') data.canvas.background = '#D6B588';
  if (data.canvas.backgroundImage || data.canvas.overlayImage || data.canvas.clipPath) {
    throw Error('캔버스 배경 이미지/마스크는 파일 객체로 다시 넣어주세요.');
  }
  return data;
}
