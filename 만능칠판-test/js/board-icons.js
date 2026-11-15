const svgNamespace='http://www.w3.org/2000/svg';

export function setBoardIcon(element,name) {
  let icon=element.querySelector(':scope > .board-icon');
  if(!icon){
    icon=document.createElementNS(svgNamespace,'svg');
    icon.setAttribute('class','board-icon');
    icon.setAttribute('viewBox','0 0 24 24');
    icon.setAttribute('aria-hidden','true');
    icon.append(document.createElementNS(svgNamespace,'use'));
    element.prepend(icon);
  }
  icon.firstElementChild.setAttribute('href',new URL(`../icons.svg?v=1#${name}`,import.meta.url).href);
}
