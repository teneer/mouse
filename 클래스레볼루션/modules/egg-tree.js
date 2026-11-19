export function mountEggTree(meter) {
  const world = meter.querySelector('.tree-level');
  const fill = meter.querySelector('.growth-tree-fill');
  const marker = meter.querySelector('.growth-tree-marker');
  const label = marker.querySelector('strong');
  const scene = meter.closest('.growth-world');
  const stars = Array.from({ length: 10 }, () => {
    const star = document.createElement('i');
    star.className = 'tree-star';
    world.append(star);
    return star;
  });
  let current;
  let target;
  let frame;
  let phase;

  function draw(height, camera, count) {
    const level = Math.floor(camera / 10) * 10;
    const offset = camera - level;
    stars.forEach((star, index) => {
      const slot = ((index + 1 - offset + 10) % 10) || 10;
      star.style.bottom = slot * 10 + '%';
    });
    const span = meter.clientHeight;
    scene.style.setProperty('--camera-offset', offset * span / 10 + 'px');
    scene.style.setProperty('--sky-repeat', Math.max(1, span / 3) + 'px');
    const step = (height - camera) * 10 + '%';
    marker.style.bottom = step;
    fill.style.height = step;
    label.textContent = count;
  }
  function stopAt(count) {
    cancelAnimationFrame(frame);
    frame = phase = null;
    current = target = count;
    draw(count, Math.floor(count / 10) * 10, count);
  }
  function tick(now) {
    if (!phase) {
      if (current === target) { frame = null; return; }
      const next = current + Math.sign(target - current);
      phase = { next, start: now };
    }
    const { next, start } = phase;
    const base = Math.floor(current / 10) * 10;
    const nextBase = Math.floor(next / 10) * 10;
    const up = next > current;
    const crossing = base !== nextBase;
    const hop = Math.max(75, 430 / Math.sqrt(Math.max(1, Math.abs(target - current))));
    const pan = crossing ? 650 : 0;
    const elapsed = now - start;
    const t = Math.min(1, Math.max(0, (elapsed - (!up ? pan : 0)) / hop));
    const c = pan ? Math.min(1, Math.max(0, (elapsed - (up ? hop : 0)) / pan)) : 0;
    const camera = base + (nextBase - base) * c * c * (3 - 2 * c);
    // Ease past the star, then settle exactly on it before the camera moves.
    const travel = 1 + 2.5 * (t - 1) ** 3 + 1.5 * (t - 1) ** 2;
    draw(current + (next - current) * travel, camera, next);
    if (elapsed >= hop + pan) { current = next; phase = null; }
    frame = requestAnimationFrame(tick);
  }
  return function update(count, animate) {
    if (current == null || !animate) { stopAt(count); return; }
    target = count;
    if (frame == null && current !== target) frame = requestAnimationFrame(tick);
  };
}
