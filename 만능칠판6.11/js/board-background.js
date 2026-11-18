export const BACKGROUND_COLORS = [
  ['상아색', '#f5edda'], ['초록색', '#275746'], ['검은색', '#22272c']
];
export const BACKGROUND_PATTERNS = [
  ['plain', '무늬 없음'], ['grid', '모눈'], ['dots', '격자점'], ['lines', '줄공책']
];

export function normalizePattern(value) {
  const kind = BACKGROUND_PATTERNS.some(([key]) => key === value?.kind) ? value.kind : 'plain';
  const spacing = Number.isFinite(value?.spacing) ? Math.round(Math.min(96, Math.max(12, value.spacing))) : 32;
  return {kind, spacing};
}

export function setCanvasPattern(canvas, pattern) {
  canvas.wbBackgroundPattern = normalizePattern(pattern);
  if (canvas.wbPatternRendererInstalled) return;
  canvas.wbPatternRendererInstalled=true;
  const renderBackground = canvas._renderBackground;
  canvas._renderBackground = function (ctx) {
    renderBackground.call(this, ctx);
    const {kind, spacing} = this.wbBackgroundPattern;
    if (kind === 'plain') return;
    const [zoom,,,, x, y] = this.viewportTransform;
    const step = spacing * zoom;
    if (!Number.isFinite(step) || step < 3) return;
    const left = ((x % step) + step) % step, top = ((y % step) + step) % step;
    const color = typeof this.backgroundColor === 'string' ? this.backgroundColor : '';
    const dark = /^#[0-9a-f]{6}$/i.test(color) &&
      [1,3,5].reduce((sum, i, index) => sum + parseInt(color.slice(i, i+2), 16)*[.299,.587,.114][index], 0) < 125;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = dark ? '#ffffff40' : '#22354734';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (kind === 'dots') {
      for (let row = top; row < this.height; row += step) {
        for (let column = left; column < this.width; column += step) ctx.rect(column-1, row-1, 2, 2);
      }
      ctx.fill();
    } else {
      for (let row = top; row < this.height; row += step) {ctx.moveTo(0,row);ctx.lineTo(this.width,row);}
      if (kind === 'grid') for (let column = left; column < this.width; column += step) {
        ctx.moveTo(column,0);ctx.lineTo(column,this.height);
      }
      ctx.stroke();
    }
    ctx.restore();
  };
}
