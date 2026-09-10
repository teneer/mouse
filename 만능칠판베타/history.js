// Each page has an independent bounded history. Viewport moves are not content edits.
export class PageHistory {
  constructor(limit = 40, byteLimit = 24 * 1024 * 1024) {
    this.limit = limit; this.byteLimit = byteLimit; this.pages = new Map();
  }
  reset(id, content) { this.pages.set(id, {items: [JSON.stringify(content)], index: 0}); }
  push(id, content) {
    if (!this.pages.has(id)) { this.reset(id, content); return; }
    const h = this.pages.get(id), value = JSON.stringify(content);
    if (h.items[h.index] === value) return;
    h.items.splice(h.index + 1); h.items.push(value); h.index++;
    let bytes = h.items.reduce((n, s) => n + s.length * 2, 0);
    while (h.items.length > 1 && (h.items.length > this.limit || bytes > this.byteLimit)) {
      bytes -= h.items.shift().length * 2; h.index--;
    }
  }
  canUndo(id) { return (this.pages.get(id)?.index ?? 0) > 0; }
  canRedo(id) { const h = this.pages.get(id); return !!h && h.index < h.items.length - 1; }
  step(id, direction) {
    if (direction < 0 ? !this.canUndo(id) : !this.canRedo(id)) return null;
    const h = this.pages.get(id); h.index += direction;
    return JSON.parse(h.items[h.index]);
  }
  remove(id) { this.pages.delete(id); }
}
