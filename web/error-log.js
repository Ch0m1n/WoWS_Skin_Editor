import {language, t} from './i18n.js';

export function errorDescription(raw) {
  const text=String(raw),translated=t(text);
  if(translated!==text)return translated;
  if(/Failed to fetch|NetworkError|Load failed/i.test(text))return t('errorNetwork');
  if(text.startsWith('자동 복구 저장 실패: '))return t('errorBackup');
  if(language==='en'&&/[가-힣]/.test(text))return t('errorUnknown');
  return text;
}

export function setupErrorLog() {
  const button=document.getElementById('error-log-toggle'),panel=document.getElementById('error-log-panel');
  const list=document.getElementById('error-log-list'),notice=document.getElementById('error-notice');
  const entries=[];let unread=0,timer;
  const updateButton=()=>{button.textContent=t('errorLog')+(unread?` (${unread})`:'');button.classList.toggle('has-errors',unread>0);};
  function open(value){if(value)(document.querySelector('dialog[open]')||document.body).append(panel);panel.hidden=!value;button.setAttribute('aria-expanded',String(value));if(value){unread=0;notice.hidden=true;clearTimeout(timer);render();}updateButton();}
  function render(){
    list.replaceChildren();
    if(!entries.length){const empty=document.createElement('p');empty.textContent=t('errorLogEmpty');list.append(empty);return;}
    for(const entry of [...entries].reverse()){
      const row=document.createElement('article'),time=document.createElement('time'),description=document.createElement('p');
      time.dateTime=new Date(entry.time).toISOString();time.textContent=new Date(entry.time).toLocaleTimeString(language==='en'?'en-US':'ko-KR');
      description.textContent=entry.description+(entry.count>1?` ×${entry.count}`:'');
      const details=document.createElement('details'),summary=document.createElement('summary'),original=document.createElement('pre');
      summary.textContent=t('errorOriginal');original.textContent=entry.original;details.append(summary,original);
      const copy=document.createElement('button');copy.textContent=t('errorCopy');
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(`${new Date(entry.time).toISOString()}\n${entry.description}\n${entry.original}`);copy.textContent=t('errorCopied');}catch{copy.textContent=t('errorCopyFailed');}};
      row.append(time,description,details,copy);list.append(row);
    }
  }
  button.onclick=()=>open(panel.hidden);
  document.getElementById('error-log-close').onclick=()=>{open(false);button.focus();};
  document.getElementById('error-log-clear').onclick=()=>{entries.length=0;unread=0;notice.hidden=true;clearTimeout(timer);render();updateButton();};
  document.getElementById('error-notice-open').onclick=()=>{open(true);button.focus();};
  document.getElementById('error-notice-close').onclick=()=>{notice.hidden=true;clearTimeout(timer);};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();open(false);button.focus();}});
  document.addEventListener('close',event=>{if(event.target.contains(panel)){open(false);document.body.append(panel);}if(event.target.contains(notice))document.body.append(notice);},true);
  updateButton();render();
  return {add(error){
    const raw=error?.message||String(error),original=error?.stack||raw,description=errorDescription(raw),now=Date.now(),previous=entries.at(-1);
    if(previous&&previous.original===original&&now-previous.time<2000){previous.count++;previous.time=now;}else{entries.push({time:now,description,original,count:1});if(entries.length>100)entries.shift();}
    if(panel.hidden){unread=Math.min(100,unread+1);document.getElementById('error-notice-text').textContent=description;(document.querySelector('dialog[open]')||document.body).append(notice);notice.hidden=false;clearTimeout(timer);timer=setTimeout(()=>{notice.hidden=true;},10000);}else render();
    updateButton();return description;
  }};
}
