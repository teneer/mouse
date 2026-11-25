const icons = {
  down:'▼', up:'▲', undo:'↶', redo:'↷',
  select:'🖱️', hand:'✋', pen:'🖊️', marker:'🖍️', text:'🔤', eraser:'🧽', trash:'🗑️',
  background:'🟫', home:'🏠', pages:'📑', sync:'🔄', score:'📊',
  'folder-open':'📂', save:'💾', copy:'📄', paste:'📋', image:'🖼️',
  devices:'📲', files:'🗂️', 'fixed-objects':'📌', 'pin-object':'📍',
  group:'🔗', ungroup:'⛓️‍💥', front:'⬆️', back:'⬇️',
  book:'📖', palette:'🎨', 'text-settings':'⚙️',
  'backup-down':'📤', 'backup-up':'📥', history:'🕘', 'answer-cover':'🪟'
};

export function setBoardIcon(element,name) {
  const glyph=icons[name];
  if(!glyph)return;
  let icon=element.querySelector(':scope > .board-icon');
  if(!icon){
    icon=document.createElement('span');
    icon.className='board-icon';
    icon.setAttribute('aria-hidden','true');
    element.prepend(icon);
  }
  icon.textContent=glyph;
}
