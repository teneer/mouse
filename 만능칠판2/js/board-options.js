export const QUICK_DEFAULTS=['#000000','#ff0000','#0000ff','#008000','#ffffff'];
export const SIZE_DEFAULTS={pen:[1,3,5,9,14],marker:[10,18,30,42,56],text:[20,32,48,64,96]};
export const TEXT_TYPES=new Set(['i-text','textbox','text']);
export function targets(selection) {const out=[];const walk=o=>{if(!o)return;if(o.type==='activeSelection'||o.type==='group'){(o.getObjects?.()||[]).forEach(walk);}else if(o.type==='path'||TEXT_TYPES.has(o.type))out.push(o);};walk(selection);return out;}
export function applyAppearance(selection,{color,sizes,level}) {let n=0;for(const o of targets(selection)){const text=TEXT_TYPES.has(o.type),v={};if(color)v[text?'fill':'stroke']=color;if(level)v[text?'fontSize':'strokeWidth']=sizes[text?'text':o.isHighlighter?'marker':'pen'][level-1];if(Object.keys(v).length){o.set(v);o.setCoords?.();n++;}}return n;}
export function orderedToEdge(all,selected,front) {const ids=new Set(selected),moving=all.filter(o=>ids.has(o)),rest=all.filter(o=>!ids.has(o));return front?[...rest,...moving]:[...moving,...rest];}
export function parseQuickColors(value) {try{const a=JSON.parse(value);return Array.isArray(a)?a.filter(x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x)).map(x=>x.toLowerCase()).filter((x,i,all)=>all.indexOf(x)===i).slice(0,5):QUICK_DEFAULTS.slice();}catch{return QUICK_DEFAULTS.slice();}}
