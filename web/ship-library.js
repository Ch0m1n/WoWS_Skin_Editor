const $ = id => document.getElementById(id);
import {language, t} from './i18n.js';
const NATIONS = ['일본','미국','소련','독일','영국','프랑스','이탈리아','범아시아','유럽','네덜란드','영연방','범아메리카','스페인'];
const CLASSES = ['전함','순양함','구축함','항공모함','잠수함','보조함'];
export class ShipLibrary {
  constructor(api, load, report) {
    Object.assign(this,{api,load,report,ships:[],nation:'전체',type:'전체',page:0,request:0,selected:new Set(),jobs:[],activeShip:null,activeJob:null});
    this.prepared={};this.queueSignature='';
    const host=document.createElement('section'); host.className='game-library';
    host.innerHTML='<div class="game-settings"><label>워쉽 설치 폴더<select id="game-install"></select></label><button id="rescan-games">다시 감지</button><button id="refresh-ships">목록 갱신</button></div><div class="game-path"><input id="game-folder" placeholder="자동 감지되지 않으면 설치 폴더를 입력하세요"><button id="set-game-folder">폴더 지정</button></div><p id="catalog-status" role="status">게임 설치 폴더를 찾는 중이에요.</p><div id="nation-tabs" class="nation-tabs"></div><div class="ship-filters"><select id="ship-class" aria-label="함종"></select><input id="ship-search" placeholder="함선 이름 또는 코드 검색"></div><div id="ship-catalog" class="ship-catalog"></div><div class="catalog-pages"><button id="ships-prev">이전</button><span id="ship-count"></span><button id="ships-next">다음</button></div><details class="local-model-options"><summary>기존 추출 모델 · 직접 파일 열기</summary><div id="local-model-host"></div></details>';
    const dialog=$('model-dialog');dialog.classList.add('ship-browser');dialog.insertBefore(host,$('model-library'));
    const progress=document.createElement('div');progress.id='ship-preparation';progress.hidden=true;
    progress.innerHTML='<progress id="ship-progress" max="100" aria-label="'+t('preparationProgress')+'"></progress><span id="ship-progress-details" role="status"></span>';
    $('catalog-status').after(progress);
    const cancel=document.createElement('button');cancel.id='cancel-ship-preparation';cancel.textContent=t('cancelPreparation');cancel.onclick=()=>this.cancel(this.activeJob).catch(report);progress.append(cancel);
    const batch=document.createElement('div');batch.className='batch-preparation';batch.innerHTML=`<button id="prepare-selected">${t('prepareSelected')}</button><button id="clear-preselection">${t('clearPreselection')}</button><span id="preselection-count"></span><details id="preparation-queue"><summary>${t('preparationQueue')}</summary><div id="preparation-jobs"></div></details>`;$('ship-catalog').before(batch);
    const badge=document.createElement('button');badge.id='preparation-summary';badge.textContent=t('preparationQueue');badge.onclick=()=>{ $('open-model').click();$('preparation-queue').open=true;};$('geometry-info').before(badge);
    $('prepare-selected').onclick=()=>this.prepareSelected().catch(report);$('clear-preselection').onclick=()=>{this.selected.clear();this.render();};
    const open=document.createElement('button');open.id='open-selected-ship';open.className='accent';open.disabled=true;open.textContent=t('openSelectedShip');open.onclick=()=>this.openSelected().catch(report);batch.prepend(open);
    this.refreshQueue().catch(()=>{});setInterval(()=>this.refreshQueue().catch(()=>{}),2500);
    const local=$('local-model-host'); let node=$('model-library'); while(node){const next=node.nextElementSibling;local.append(node);node=next;}
    $('ship-class').replaceChildren(...['전체',...CLASSES].map(n=>new Option(n==='전체'?'전체 함종':n,n)));
    $('game-install').onchange=()=>this.selectGame().catch(report);
    $('rescan-games').onclick=()=>this.open(true).catch(report);
    $('refresh-ships').onclick=()=>this.selectGame(true).catch(report);
    $('set-game-folder').onclick=async()=>{try{const g=await(await api('game-folder',{folder:$('game-folder').value})).json();this.games=[...(this.games||[]).filter(x=>x.id!==g.id),g];this.renderGames(g.id);await this.selectGame();}catch(e){report(e);$('catalog-status').textContent=e.message;}};
    $('ship-class').onchange=()=>{this.type=$('ship-class').value;this.page=0;this.render();};
    $('ship-search').oninput=()=>{this.page=0;this.render();};
    const preparedFilter=document.createElement('label');preparedFilter.className='prepared-filter';const preparedOnly=document.createElement('input');preparedOnly.type='checkbox';preparedOnly.id='ship-prepared-only';const preparedLabel=document.createElement('span');preparedLabel.textContent=t('shipPreparedOnly');preparedFilter.append(preparedOnly,preparedLabel);document.querySelector('.ship-filters').append(preparedFilter);preparedOnly.onchange=()=>{this.page=0;this.render();};
    $('ships-prev').onclick=()=>{this.page--;this.render();};$('ships-next').onclick=()=>{this.page++;this.render();};
  }
  renderGames(selected){$('game-install').replaceChildren(...this.games.map(g=>new Option(`${g.folder} / ${g.build}`,g.id)));if(selected)$('game-install').value=selected;}
  async open(refresh=false){
    if(this.games&&!refresh){await this.refreshPrepared();this.render();return;}
    this.games=(await(await this.api('games')).json()).games;this.renderGames();
    if(this.games.length)await this.selectGame();else $('catalog-status').textContent=t('chooseGameFolder');
  }
  async wait(job,output,token){
    while(true){const value=await(await this.api('jobs/'+job)).json();if(token!==undefined&&token!==this.request)return null;
      output(value.message,value);if(value.status==='cancelled')return null;if(value.status==='error')throw Error(value.message);if(value.status==='done')return value.result;
      await new Promise(resolve=>setTimeout(resolve,800));}
  }
  showPreparation(value) {
    const bar=$('ship-progress'),elapsed=Math.max(0,Math.floor(Date.now()/1000-value.started));
    if(value.percent===null||value.percent===undefined)bar.removeAttribute('value');else bar.value=value.percent;
    const remaining=value.estimated_total_seconds-elapsed;
    const eta=value.estimated_total_seconds&&remaining>0?t('remainingEstimate',{seconds:Math.ceil(remaining)}):t('estimatingRemaining');
    const stage=value.status==='paused'?t('queuepaused'):value.status==='queued'?t('queueWaiting'):value.percent===null||value.percent===undefined?t('packageStage'):t('conversionProgress',{percent:value.percent});
    $('ship-progress-details').textContent=`${stage} · ${t('elapsedTime',{seconds:elapsed})} · ${eta}`;
  }
  async refreshQueue(){
    const {jobs}=await(await this.api('preparations')).json();this.jobs=jobs;
    const active=jobs.filter(j=>['queued','running','paused','cancelling'].includes(j.status));$('preparation-summary').textContent=t('queueSummary',{count:active.length});
    $('preparation-jobs').replaceChildren(...jobs.slice().reverse().map(job=>{const row=document.createElement('div');row.className='preparation-job';row.textContent=`${job.name} · ${t('queue'+job.status)}${job.percent!==null&&job.status==='running'?' · '+job.percent+'%':''}`;row.title=t(job.message||'');if(['queued','running'].includes(job.status)){const cancel=document.createElement('button');cancel.textContent=t('cancelPreparation');cancel.onclick=()=>this.cancel(job.id).catch(this.report);row.append(cancel);}return row;}));
    for(const card of document.querySelectorAll('.ship-card')){
      const job=jobs.find(j=>j.game===this.game&&j.code===card.dataset.code),badge=card.querySelector('.ship-prepared');
      if(badge)this.updatePreparedBadge(badge,card.dataset.code,job);
    }
    const signature=jobs.filter(j=>j.game===this.game).map(j=>j.id+':'+j.status).join('|');
    if(this.game&&signature!==this.queueSignature){this.queueSignature=signature;await this.refreshPrepared();this.render();}
  }
  async refreshPrepared(){
    if(!this.game)return;const game=this.game;const result=await(await this.api('prepared-ships/'+game)).json();
    if(game===this.game)this.prepared=result.ships;
  }
  updatePreparedBadge(badge,code,job){
    const cached=this.prepared[code];badge.dataset.cache=cached||'';
    badge.textContent=job&&['queued','running','paused','cancelling','error'].includes(job.status)?t('queue'+job.status):cached?t(cached==='ready'?'shipCached':'shipCacheStale'):'';
  }
  async cancel(job){if(!job)return;await this.api('cancel-preparation',{job});await this.refreshQueue();}
  async openSelected(){
    const ship=this.activeShip,game=this.game;if(!ship||this.preparing)return;
    this.preparing=true;$('open-selected-ship').disabled=true;$('ship-preparation').hidden=false;$('cancel-ship-preparation').disabled=true;
    $('ship-progress').removeAttribute('value');$('ship-progress-details').textContent=t('estimatingRemaining');
    try{const{job}=await(await this.api('ship-model',{game,code:ship.ShipCode,language})).json();this.activeJob=job;$('cancel-ship-preparation').disabled=false;
      const result=await this.wait(job,(message,value)=>{$('catalog-status').textContent=t(message);this.showPreparation(value);$('cancel-ship-preparation').disabled=value.status==='cancelling';});
      if(!result)return;const source=await(await this.api('job-model',{job})).json();$('model-dialog').close();await this.load(source);
    }catch(e){$('catalog-status').textContent=t(e.message);this.report(e);}
    finally{this.preparing=false;this.activeJob=null;$('ship-preparation').hidden=true;$('open-selected-ship').disabled=!this.activeShip;await this.refreshQueue();}
  }
  async prepareSelected(){
    const game=this.game,codes=[...this.selected];if(!codes.length)return;$('prepare-selected').disabled=true;
    try{for(const code of codes)await this.api('ship-model',{game,code,language});this.selected.clear();this.render();await this.refreshQueue();$('catalog-status').textContent=t('queuedShips',{count:codes.length});}
    finally{$('prepare-selected').disabled=!this.selected.size;}
  }
  async selectGame(refresh=false){
    if(!$('game-install').value||this.preparing)return;const token=++this.request;this.game=$('game-install').value;this.activeShip=null;this.selected.clear();this.ships=[];this.render();
    try{const{job}=await(await this.api('catalog',{game:this.game,refresh,language})).json();const result=await this.wait(job,message=>$('catalog-status').textContent=t(message),token);if(!result)return;
      await this.refreshPrepared();if(token!==this.request)return;this.ships=result.ships;this.nation='전체';this.page=0;$('catalog-status').textContent=t('catalogReady',{count:this.ships.length.toLocaleString(),locale:language});this.render();
    }catch(e){$('catalog-status').textContent=e.message;this.report(e);}
  }
  render(){
    $('open-selected-ship').disabled=!this.activeShip||this.preparing;$('open-selected-ship').textContent=this.activeShip?t('openNamedShip',{name:this.activeShip.LocalizedName}):t('openSelectedShip');
    $('preselection-count').textContent=t('preselectedCount',{count:this.selected.size});$('prepare-selected').disabled=!this.selected.size;
    const nations=['전체',...NATIONS.filter(n=>this.ships.some(s=>s.Nation===n)),...new Set(this.ships.map(s=>s.Nation).filter(n=>!NATIONS.includes(n)))];
    $('nation-tabs').replaceChildren(...nations.map(n=>{const b=document.createElement('button');b.textContent=n;b.classList.toggle('active',n===this.nation);b.onclick=()=>{this.nation=n;this.page=0;this.render();};return b;}));
    const query=$('ship-search').value.toLocaleLowerCase();const rows=this.ships.filter(s=>(this.nation==='전체'||s.Nation===this.nation)&&(this.type==='전체'||s.ShipClass===this.type)&&`${s.LocalizedName} ${s.ShipCode}`.toLocaleLowerCase().includes(query)).sort((a,b)=>a.Tier-b.Tier||a.LocalizedName.localeCompare(b.LocalizedName,'ko'));
    const filtered=$('ship-prepared-only').checked?rows.filter(s=>this.prepared[s.ShipCode]==='ready'):rows;
    const pages=Math.max(1,Math.ceil(filtered.length/60));this.page=Math.min(Math.max(0,this.page),pages-1);$('ship-count').textContent=t('pageCount',{count:filtered.length,page:this.page+1,pages});$('ships-prev').disabled=this.page===0;$('ships-next').disabled=this.page===pages-1;
    $('ship-catalog').replaceChildren(...filtered.slice(this.page*60,(this.page+1)*60).map(s=>{
      const b=document.createElement('button');b.className='ship-card';b.dataset.code=s.ShipCode;b.disabled=!s.Supported;b.title=s.Supported?`${s.LocalizedName} / ${s.ShipCode}`:(s.UnsupportedReason||'현재 추출할 수 없는 모델이에요.');
      const check=document.createElement('input');check.type='checkbox';check.className='preselect-ship';check.checked=this.selected.has(s.ShipCode);check.disabled=!s.Supported;check.setAttribute('aria-label',t('preselectShip',{name:s.LocalizedName}));check.onclick=e=>e.stopPropagation();check.onchange=()=>{check.checked?this.selected.add(s.ShipCode):this.selected.delete(s.ShipCode);$('preselection-count').textContent=t('preselectedCount',{count:this.selected.size});$('prepare-selected').disabled=!this.selected.size;};
      const ready=document.createElement('span');ready.className='ship-prepared';const previous=this.jobs.find(j=>j.game===this.game&&j.code===s.ShipCode);this.updatePreparedBadge(ready,s.ShipCode,previous);
      const img=document.createElement('img');img.loading='lazy';img.alt='';img.src=`/api/ship-icon/${this.game}/${s.ShipCode}`;img.onerror=()=>{img.remove();b.classList.add('without-icon');};
      const strong=document.createElement('strong');strong.textContent=s.LocalizedName||s.ShipCode;const small=document.createElement('small');small.textContent=`${t('Tier')} ${s.Tier} · ${t(s.Nation)} · ${t(s.ShipClass)}`;
      b.classList.toggle('selected',this.activeShip?.ShipCode===s.ShipCode);b.setAttribute('aria-pressed',String(this.activeShip?.ShipCode===s.ShipCode));
      b.append(check,img,strong,small,ready);b.onclick=()=>{if(this.preparing)return;this.activeShip=s;for(const card of $('ship-catalog').children){const selected=card.dataset.code===s.ShipCode;card.classList.toggle('selected',selected);card.setAttribute('aria-pressed',String(selected));}$('open-selected-ship').disabled=false;$('open-selected-ship').textContent=t('openNamedShip',{name:s.LocalizedName});$('catalog-status').textContent=t('shipSelected',{name:s.LocalizedName});};return b;
    }));
  }
}
