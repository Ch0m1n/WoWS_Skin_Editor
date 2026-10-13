import {t} from './i18n.js';
export function setupViewportSplitter(){
  const host=document.querySelector('.canvases'),bar=document.createElement('div');
  bar.id='viewport-splitter';bar.tabIndex=0;bar.setAttribute('role','separator');bar.setAttribute('aria-orientation','horizontal');bar.setAttribute('aria-label',t('resizeViewports'));bar.title=t('resizeViewports');
  host.insertBefore(bar,document.getElementById('texture-wrap'));
  let ratio=Number(localStorage.getItem('workshop.splitRatio'))||.58;
  function set(value,save=true){ratio=Math.max(.2,Math.min(.8,value));host.style.setProperty('--scene-ratio',ratio+'fr');host.style.setProperty('--texture-ratio',(1-ratio)+'fr');bar.setAttribute('aria-valuemin','20');bar.setAttribute('aria-valuemax','80');bar.setAttribute('aria-valuenow',String(Math.round(ratio*100)));if(save)localStorage.setItem('workshop.splitRatio',ratio);}
  set(ratio,false);
  bar.onpointerdown=e=>{if(e.button)return;e.preventDefault();bar.setPointerCapture(e.pointerId);bar.classList.add('dragging');};
  bar.onpointermove=e=>{if(!bar.hasPointerCapture(e.pointerId))return;const rect=host.getBoundingClientRect();set((e.clientY-rect.top)/(rect.height-8),false);};
  const stop=()=>{bar.classList.remove('dragging');set(ratio);};bar.onpointerup=stop;bar.onpointercancel=stop;
  bar.ondblclick=()=>set(.58);
  bar.onkeydown=e=>{if(!['ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();set(e.key==='Home'?.58:ratio+(e.key==='ArrowUp'?-.03:.03));};
}
