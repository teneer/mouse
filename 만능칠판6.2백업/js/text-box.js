const hexColor = (value, fallback) => typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

export function normalizeTextBoxStyle(style={}) {
  return {
    background:style?.background ? hexColor(style.background,'#ffffff') : '',
    border:normalizeTextBoxBorder(style?.border)
  };
}

export function normalizeTextBoxBorder(value) {
  if(!value || !Number.isFinite(value.width) || value.width<=0)return null;
  return {color:hexColor(value.color,'#000000'),width:Math.min(30,value.width)};
}

export function installTextBoxBorder(fabric) {
  const text=fabric.Text.prototype;
  const render=text._render;
  text._render=function(ctx){
    const border=this.wbTextBorder;
    if(border && this.width>0 && this.height>0){
      // Keep the outline inside Fabric's object bounds so cache, hitbox and
      // selection dimensions match the rectangle at every scale.
      const width=Math.min(border.width,this.width/2,this.height/2);
      ctx.save();
      ctx.lineWidth=width;
      ctx.strokeStyle=border.color;
      ctx.strokeRect((width-this.width)/2,(width-this.height)/2,this.width-width,this.height-width);
      ctx.restore();
    }
    render.call(this,ctx);
  };
  for(const type of [fabric.Text,fabric.IText,fabric.Textbox]){
    if(!type.prototype.cacheProperties.includes('wbTextBorder')){
      type.prototype.cacheProperties=[...type.prototype.cacheProperties,'wbTextBorder'];
    }
  }
}

export function fixedObjectLabel(object) {
  if(object.type==='path')return {kind:object.isHighlighter?'형광펜':'펜',detail:''};
  if(['text','i-text','textbox'].includes(object.type))return {kind:'텍스트',detail:(object.text||'').split('\n')[0].slice(0,55)};
  if(object.wbAsset)return {
    kind:object.wbPage?'PDF':'이미지',
    detail:object.wbAsset.name+(object.wbPage?` · ${object.wbPage}쪽`:'')
  };
  return {kind:object.type==='group'?'그룹':object.type==='image'?'이미지':'개체',detail:''};
}
