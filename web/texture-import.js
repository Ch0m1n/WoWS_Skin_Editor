import {newPaint,imageFromURL,initializeDocument} from './document.js';
import {t} from './i18n.js';
const $=id=>document.getElementById(id);
const normalize=name=>name.replace(/\\/g,'/').split('/').at(-1).replace(/\.(png|dds)$/i,'').replace(/_albedo$/i,'_a').toLowerCase();
export function setupTextureImport({api,state,selectDoc,checkpoint,changed,busy,report}){
  const button=document.createElement('button');button.id='import-skin-textures';button.className='wide';button.textContent=t('importSkinTextures');$('texture-meta').after(button);
  const input=document.createElement('input');input.type='file';input.accept='.png,.dds';input.multiple=true;input.hidden=true;document.body.append(input);
  const folderInput=document.createElement('input');folderInput.type='file';folderInput.webkitdirectory=true;folderInput.multiple=true;folderInput.hidden=true;document.body.append(folderInput);
  const folderButton=document.createElement('button');folderButton.id='import-skin-folder';folderButton.className='wide';folderButton.textContent=t('importSkinFolder');button.after(folderButton);folderButton.onclick=()=>{if(!state.docs.size){report(Error(t('모델을 먼저 열어주세요.')));return;}folderInput.click();};
  const dialog=document.createElement('dialog');dialog.id='texture-import-dialog';dialog.innerHTML=`<h2>${t('importSkinTextures')}</h2><p>${t('textureImportHelp')}</p><div id="texture-import-rows"></div><p id="texture-import-error" role="status"></p><div class="dialog-actions"><button id="cancel-texture-import">${t('닫기')}</button><button id="apply-texture-import" class="accent">${t('applyTextureImport')}</button></div>`;document.body.append(dialog);
  let imports=[];button.onclick=()=>{if(!state.docs.size){report(Error(t('모델을 먼저 열어주세요.')));return;}input.click();};$('cancel-texture-import').onclick=()=>dialog.close();
  const readFiles=async picker=>{
    const files=[...picker.files].filter(f=>/\.(png|dds)$/i.test(f.name));picker.value='';if(!files.length)return;imports=[];$('texture-import-rows').replaceChildren();$('texture-import-error').textContent='';busy(true,t('readingExternalTextures'));
    try{
      for(const file of files){
        if(file.size>96*1024*1024)throw Error(t('externalTextureTooLarge'));
        const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
        const value=await(await api('import-texture',{data})).json();
        const row=document.createElement('label');row.className='texture-import-row';row.append(document.createTextNode(file.name+' · '+value.width+' × '+value.height));
        const select=document.createElement('select');select.append(new Option(t('chooseTextureTarget'),''));
        for(const doc of state.docs.values())select.append(new Option(doc.name,doc.key));
        const relative=(file.webkitRelativePath||file.name).replace(/\\/g,'/').toLowerCase(),byPath=[...state.docs.values()].filter(doc=>doc.target&&relative.endsWith(doc.target.toLowerCase()));
        const matches=byPath.length?byPath:[...state.docs.values()].filter(doc=>[doc.name,doc.target||''].some(name=>normalize(name)===normalize(file.name)));
        if(matches.length===1)select.value=matches[0].key;
        row.append(select);$('texture-import-rows').append(row);imports.push({file,value,select});
      }
      dialog.showModal();
    }catch(e){report(e);}finally{busy(false);}
  };
  input.onchange=()=>readFiles(input);folderInput.onchange=()=>readFiles(folderInput);
  $('apply-texture-import').onclick=async()=>{
    try{
      const rows=imports.map(row=>({...row,doc:state.docs.get(row.select.value)}));
      if(rows.some(row=>!row.doc))throw Error(t('chooseAllTextureTargets'));
      if(new Set(rows.map(row=>row.doc.key)).size!==rows.length)throw Error(t('duplicateTextureTarget'));
      for(const row of rows){initializeDocument(row.doc);if(row.value.width!==row.doc.base.width||row.value.height!==row.doc.base.height)throw Error(t('textureSizeMismatch',{name:row.file.name}));}
      if(rows.some(row=>row.doc.layers.length>=40))throw Error(t('tooManyTextureLayers'));
      $('apply-texture-import').disabled=true;
      for(const {file,value,doc} of rows){const image=await imageFromURL(value.data);selectDoc(doc.key);checkpoint();const layer=newPaint(doc,file.name);layer.blend='copy';layer.raster.getContext('2d').drawImage(image,0,0);doc.layers.push(layer);state.activeLayer=layer.id;changed();}
      dialog.close();$('status').textContent=t('externalTexturesImported',{count:rows.length});
    }catch(error){$('texture-import-error').textContent=error.message;}finally{$('apply-texture-import').disabled=false;}
  };
}
