const duration=2200;

export function mountPursuitAlert() {
  const overlay=document.createElement('aside');
  overlay.className='pursuit-alert';
  overlay.hidden=true;
  overlay.setAttribute('role','alert');
  document.body.append(overlay);

  const queue=[];
  let active=false;
  function showNext() {
    if(active || !queue.length)return;
    active=true;
    const {warnings,play}=queue.shift();
    const flash=document.createElement('div');
    flash.className='pursuit-alert-flash';
    flash.setAttribute('aria-hidden','true');
    const box=document.createElement('div');
    box.className='pursuit-alert-box';
    for(const {target,message} of warnings) {
      const section=document.createElement('section');
      const name=document.createElement('p');
      name.className='pursuit-alert-target';
      name.textContent=target;
      const heading=document.createElement('strong');
      heading.className='pursuit-alert-heading';
      heading.textContent='추격당함';
      section.append(name,heading);
      if(message) {
        const text=document.createElement('p');
        text.className='pursuit-alert-message';
        text.textContent=message;
        section.append(text);
      }
      box.append(section);
    }
    overlay.replaceChildren(flash,box);
    overlay.hidden=false;
    play();
    setTimeout(()=>{
      overlay.hidden=true;
      overlay.replaceChildren();
      active=false;
      showNext();
    },duration);
  }
  return detail=>{
    queue.push(detail);
    showNext();
  };
}
