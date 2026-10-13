import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {canvas, uid, initializeDocument, newPaint, newImage, composite, serializeLayer, serializeLayerAsync, cloneLayers, restoreLayers, imageFromURL} from './document.js';
import {bakeProjection, resetProjectionBaker} from './projection-baker.js';
import {continuousSurface} from './brush-stroke.js';
import {ShipLibrary} from './ship-library.js';
import {setupTextureImport} from './texture-import.js';
import {setupViewportSplitter} from './viewport-splitter.js';
import {accelerateMeshes} from './mesh-picking.js';
import {snapshot, capturePaint, restoreSnapshot, historyBytes} from './history.js';
import {paintStroke} from './brush.js';
import {setupWorkshopTools} from './workshop-tools.js';
import {setupPartMask} from './part-mask.js';
import {initI18n, t, language} from './i18n.js';

const $ = id => document.getElementById(id);
const state = {source: null, docs: new Map(), meshes: [], activeDoc: null, activeLayer: null, selectedMesh: null,
  tool: 'orbit', image: null, imageName: '', channel: 'albedo', undo: [], redo: [], dirty: false, xml: null, xmlName: 'camouflages.xml', xmlDirty: false};
let model = null, zoom = 'fit', stroke = null, imageDrag = null, autosaveTimer = 0, loading = false;
let imageHandles=null;
let renderNeeded = true, pendingDraw = false;
const invalidate = () => { renderNeeded = true; };
let renderer;
try{renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});}
catch{const element=canvas(1,1);renderer={isFallback:true,domElement:element,capabilities:{getMaxAnisotropy:()=>1},setPixelRatio(){},setClearColor(){},setSize(w,h){element.width=w;element.height=h;},render(){},getContext:()=>null,copyTextureToTexture(){}};document.querySelector('.workspace').dataset.view='2d';}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor('#1c252d'); renderer.outputColorSpace = THREE.SRGBColorSpace;
$('scene').append(renderer.domElement);
if(renderer.isFallback)for(const button of document.querySelectorAll('button[data-view]')){button.disabled=button.dataset.view!=='2d';button.classList.toggle('active',button.dataset.view==='2d');}
const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#1c252d', 50, 150);
const camera = new THREE.PerspectiveCamera(38, 1, .01, 10000);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
controls.addEventListener('change', invalidate);
scene.add(new THREE.HemisphereLight(0xe6f3ff, 0x748594, 2.3));
const keyLight = new THREE.DirectionalLight(0xffedce, 2.8); keyLight.position.set(15, 25, 12); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xa4c2d8, 1.6); fillLight.position.set(-20, 10, -15); scene.add(fillLight);
let grid = new THREE.GridHelper(35, 35, 0x43525e, 0x2f3d48); scene.add(grid);
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
const size = new THREE.Vector3(), center = new THREE.Vector3();
let extent = 20;

function message(text, error = false) { $('status').textContent = t(text); $('status').style.color = error ? '#f5a5a0' : ''; }
function busy(value, label = '모델을 불러오는 중이에요.') { loading = value; $('busy').hidden = !value; $('busy-label').textContent = label; }
async function api(path, payload) {
  let options={};if(payload){let body=JSON.stringify(payload);const headers={'Content-Type':'application/json'};if(body.length>8*1024*1024&&typeof CompressionStream!=='undefined'){body=await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).blob();headers['Content-Encoding']='gzip';}options={method:'POST',headers,body};}
  const response = await fetch('/api/' + path,options);
  if (!response.ok) { const data = await response.json(); throw Error(data.error || '요청을 처리하지 못했어요.'); }
  return response;
}
function report(error) { console.error(error); message(error.message || String(error), true); }
function action(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(report); }
function current() { return state.docs.get(state.activeDoc); }
function layer() { return current()?.layers.find(row => row.id === state.activeLayer); }
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function jsonDownload(data, name) { download(new Blob([JSON.stringify(data)], {type: 'application/json'}), name); }
function assetURL(source, name) { return '/api/assets/' + source.id + '/' + name.split('/').map(encodeURIComponent).join('/'); }

function resize() {
  const rect = $('scene').getBoundingClientRect();
  if (rect.width && rect.height) { renderer.setSize(rect.width, rect.height); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); }
  fitTexture();
  invalidate();
}
new ResizeObserver(resize).observe($('scene-wrap'));
new ResizeObserver(fitTexture).observe($('texture-scroll'));
const gpuNotice=document.createElement('div');gpuNotice.className='gpu-notice';gpuNotice.hidden=!renderer.isFallback;gpuNotice.textContent=t('gpuUnavailable');$('scene-wrap').append(gpuNotice);
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();gpuNotice.hidden=false;gpuNotice.textContent=t('gpuLost');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{gpuNotice.hidden=true;for(const doc of state.docs.values()){if(doc.texture)doc.texture.needsUpdate=true;for(const material of doc.materials)material.needsUpdate=true;}invalidate();});
function animate() { requestAnimationFrame(animate); controls.update(); if (renderNeeded) { renderer.render(scene, camera); renderNeeded = false; drawGizmo(); drawImageHandles(); } }
camera.position.set(20, 12, 20); controls.target.set(0, 1, 0); animate();
function drawGizmo() {
  const c = $('axis-gizmo'); if (!c) return; const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 100, 100);
  const inverse = camera.quaternion.clone().invert(); const axes = [['X', '#ef6f72', new THREE.Vector3(1,0,0)], ['Y', '#83c97a', new THREE.Vector3(0,1,0)], ['Z', '#67a7e8', new THREE.Vector3(0,0,1)]];
  const points = [];
  for (const [label, color, vector] of axes) for (const sign of [-1,1]) {
    const p = vector.clone().multiplyScalar(sign).applyQuaternion(inverse); points.push({label: sign > 0 ? label : '', color, x: 50 + p.x * 33, y: 50 - p.y * 33, z: p.z, vector: vector.clone().multiplyScalar(sign)});
  }
  points.sort((a,b) => a.z-b.z);
  for (const p of points) { ctx.strokeStyle = p.color; ctx.lineWidth=2; ctx.beginPath();ctx.moveTo(50,50);ctx.lineTo(p.x,p.y);ctx.stroke(); ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle=p.label?p.color:'#202a33';ctx.fill();ctx.stroke();ctx.fillStyle='#111c24';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.label,p.x,p.y); }
  c.axisPoints = points;
}

function focusView(axis) {
  if (!model) return;
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
  new THREE.Box3().setFromObject(model).getSize(size); new THREE.Box3().setFromObject(model).getCenter(center);
  extent = Math.max(size.x, size.y, size.z); const d = extent * 1.4;
  controls.target.copy(center); camera.up.set(0, 1, 0);
  if (axis === 'side') camera.position.copy(center).add(new THREE.Vector3(d, extent * .06, 0));
  else if (axis === 'front') camera.position.copy(center).add(new THREE.Vector3(0, extent * .08, d));
  else if (axis === 'top') { camera.position.copy(center).add(new THREE.Vector3(0, d, .001)); camera.up.set(0, 0, -1); }
  else camera.position.copy(center).add(new THREE.Vector3(extent * .95, extent * .38, extent * .45));
  camera.near = Math.max(.001, extent / 10000); camera.far = extent * 100; camera.updateProjectionMatrix(); controls.update();controls.enableDamping=damping;invalidate();
}
function disposeModel(old) {
  if (!old) return;
  const textures = new Set(), materials = new Set();
  old.traverse(mesh => { if (!mesh.isMesh) return; mesh.geometry.dispose(); for (const m of [].concat(mesh.material)) { materials.add(m); for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); } });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
}

async function prepareSource(source) {
  const base = assetURL(source, '');
  const manager = new THREE.LoadingManager();
  let pending = 0;
  const itemStart = manager.itemStart.bind(manager), itemEnd = manager.itemEnd.bind(manager);
  manager.itemStart = url => { pending++; itemStart(url); };
  manager.itemEnd = url => { pending--; itemEnd(url); };
  manager.setURLModifier(url => {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/api/assets/' + source.id + '/')) throw Error('모델은 같은 폴더의 로컬 파일만 참조할 수 있어요.');
    return url;
  });
  const failed = [];
  manager.onError = url => failed.push(url);
  let object;
  if (source.format === 'obj') {
    let materials = null;
    if (source.mtl) { const loader = new MTLLoader(manager); loader.setResourcePath(base); materials = await loader.loadAsync(assetURL(source, source.mtl)); materials.preload(); }
    const loader = new OBJLoader(manager); if (materials) loader.setMaterials(materials);
    const text = await (await fetch(assetURL(source, source.model))).text();
    const parsed = await new Promise((resolve, reject) => {
      const worker = new Worker('/obj-worker.js', {type: 'module'});
      worker.onmessage = event => { worker.terminate(); event.data.error ? reject(Error(event.data.error)) : resolve(event.data.meshes); };
      worker.onerror = error => { worker.terminate(); reject(Error(error.message)); }; worker.postMessage(text);
    });
    object = new THREE.Group();
    for (const part of parsed) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(part.attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize));
      geometry.groups = part.groups;
      const mats = part.materials.map(name => materials ? materials.create(name) : new THREE.MeshPhongMaterial({color: '#87949b'}));
      const mesh = new THREE.Mesh(geometry, mats.length === 1 ? mats[0] : mats); mesh.name = part.name; object.add(mesh);
    }
  } else object = (await new GLTFLoader(manager).loadAsync(assetURL(source, source.model))).scene;
  // Texture requests may finish after geometry. Wait before sampling material images.
  const deadline = Date.now() + 60000;
  while (pending > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (pending > 0) { disposeModel(object); throw Error('텍스처를 읽는 시간이 너무 길어요. 누락된 파일을 확인하세요.'); }
  const images = new Set(); object.traverse(mesh => { if (mesh.isMesh) for (const m of [].concat(mesh.material)) if (m.map?.image) images.add(m.map.image); });
  await Promise.all([...images].map(async image => { if (image instanceof HTMLImageElement) await image.decode(); }));
  if (failed.length) { disposeModel(object); throw Error('일부 모델 파일을 읽지 못했어요: ' + failed[0]); }
  return object;
}

async function installModel(object, source, savedDocuments = []) {
  resetProjectionBaker();
  const docs = new Map(), meshes = [], materialDocuments = new Map(), glbKeys = new Map();
  let manifest = [];
  if (source.manifest) { try { manifest = (await (await fetch(assetURL(source, source.manifest))).json()).textures || []; } catch { /* Optional metadata; path fields remain editable. */ } }
  const originals = [];
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes.push(mesh); mesh.userData.originalVisible = mesh.visible;
    for (const m of [].concat(mesh.material)) {
      if (materialDocuments.has(m)) continue;
      const image = m.map?.image;
      let key;
      if (image?.src) { const url = new URL(image.src, location.href); key = decodeURIComponent(url.pathname).split('/api/assets/' + source.id + '/')[1] || m.name || mesh.name; }
      else key = m.name || mesh.name || 'texture-' + docs.size;
      // Different glTF textures can have unnamed materials; map UUID keeps documents distinct in this load.
      if (source.format.startsWith('glb')) {
        const identity = m.map?.source || m;
        if (!glbKeys.has(identity)) glbKeys.set(identity, 'texture-' + glbKeys.size + '-' + (m.name || 'material'));
        key = glbKeys.get(identity);
      }
      if (!docs.has(key)) {
        const name = key.includes('data:') || key.startsWith('blob:') ? (m.name || 'texture-' + docs.size) + '.png' : key.split('/').at(-1);
        let target = 'textures/' + name.replace(/\.[^.]+$/, '') + '.dds';
        const entry = manifest.find(row => row.output === key);
        if (entry?.source?.startsWith('/content/')) target = entry.source.slice(1).replace(/\.dds$/i, '.dds');
        else {
          const stem = name.replace(/_albedo\.png$/i, '').replace(/_skinned$/, '');
          const related = manifest.find(row => row.role === 'metalness' && row.source?.startsWith('/content/') && row.source.split('/').at(-1) === stem + '_mg.dds');
          if (related) target = related.source.slice(1).replace(/_mg\.dds$/i, '_a.dds');
        }
        const stem = name.replace(/_albedo\.png$/i, '');
        const channels = Object.fromEntries(manifest.filter(row => row.output?.startsWith('textures/' + stem + '_') && ['normal','roughness','metalness','specular','ao'].includes(row.role)).map(row => [row.role, row.output]));
        docs.set(key, {key, name, image, layers: [], materials: [], meshes: new Set(), channels, channelImages: {}, target, flipY: m.map?.flipY !== false});
      }
      const doc = docs.get(key); doc.materials.push(m); materialDocuments.set(m, key); originals.push([m, key]);
    }
  });
  if (!meshes.length) throw Error('표시할 메시가 없는 모델이에요.');
  for (const mesh of meshes) for (const m of [].concat(mesh.material)) docs.get(materialDocuments.get(m))?.meshes.add(mesh);
  for (const saved of savedDocuments) {
    const doc = docs.get(saved.key) || [...docs.values()].find(d => d.name === saved.name||d.target===saved.target);
    if (!doc) { disposeModel(object); throw Error('원본 모델에서 텍스처를 찾지 못했어요: ' + saved.name); }
    initializeDocument(doc);
    if (doc.base.width !== saved.width || doc.base.height !== saved.height) {
      if(!confirm(t('resizeProjectTexture',{name:saved.name}))){disposeModel(object);throw Error(t('projectResizeCancelled'));}
      for(const row of saved.layers)if(row.raster){const resized=canvas(doc.base.width,doc.base.height);resized.getContext('2d').drawImage(row.raster,0,0,doc.base.width,doc.base.height);row.raster=resized;}
      saved.width=doc.base.width;saved.height=doc.base.height;
    }
    for (const row of saved.layers) if (row.raster && (row.raster.width !== saved.width || row.raster.height !== saved.height)) { disposeModel(object); throw Error('페인트 레이어 크기가 원본과 달라요.'); }
    doc.layers = saved.layers; doc.target = saved.target;
  }
  // Swap only after geometry and texture discovery have succeeded.
  try{await accelerateMeshes(meshes);}catch{message(t('workerFallback'));}
  if (model) { scene.remove(model); disposeModel(model); }
  for (const doc of state.docs.values()){doc.texture?.dispose();doc.patchTexture?.dispose();}
  model = object; scene.add(model); model.updateMatrixWorld(true);
  Object.assign(state, {source, docs, meshes, activeDoc: null, activeLayer: null, selectedMesh: null, undo: [], redo: [], dirty: false, xml: null, xmlDirty: false});
  for (const [m, key] of originals) { m.userData.docKey = key; m.userData.originalMap = m.map; }
  scene.remove(grid); grid.geometry.dispose(); grid.material.dispose();
  const box = new THREE.Box3().setFromObject(model); box.getSize(size); box.getCenter(center); extent = Math.max(size.x, size.y, size.z);
  grid = new THREE.GridHelper(extent * 2, 40, 0x43525e, 0x2e3c47); grid.position.set(center.x, box.min.y - extent * .007, center.z); scene.add(grid);
  scene.fog.near = extent * 3; scene.fog.far = extent * 9;
  $('welcome').hidden = true; $('ship-name').textContent = source.name; $('model-kind').textContent = source.format.toUpperCase();
  $('save-state').textContent = '원본 불러옴';
  $('part-count').textContent = meshes.length;
  $('geometry-info').textContent = meshes.length + ' PARTS / ' + [...meshes].reduce((n, m) => n + (m.geometry.index?.count || m.geometry.attributes.position.count) / 3, 0).toLocaleString('en-US', {maximumFractionDigits: 0}) + ' TRIANGLES';
  $('texture-select').replaceChildren(...[...docs.values()].map(doc => { const o = new Option(doc.name, doc.key); return o; }));
  renderParts();
  // Prefer the hull's albedo for the first editing surface.
  const first = [...docs.values()].find(doc => /(?:ship|Hull|JSC.*_1944_albedo)/i.test(doc.name)) || docs.values().next().value;
  selectDoc(first.key); renderMaterials(); focusView(); resize();
  invalidate(); message(t('modelOpened',{name:source.name}));
}
async function loadSource(source, keep = false) {
  if (!keep && state.dirty && !confirm('저장하지 않은 작업이 있어요. 프로젝트로 저장하지 않고 다른 모델을 열까요?')) return;
  busy(true);
  try { const object = await prepareSource(source); await installModel(object, source); }
  finally { busy(false); }
}
async function showLibrary() {
  shipLibrary.open().catch(report);
  const data = await (await api('library')).json();
  const host = $('model-library'); host.replaceChildren();
  for (const source of data.models) {
    const button = document.createElement('button'); button.className = 'model-card';
    const strong = document.createElement('strong'); strong.textContent = source.name;
    const small = document.createElement('small'); small.textContent = source.format.toUpperCase() + ' / LOCAL MODEL'; button.append(strong, small);
    button.onclick = action(async () => { $('model-dialog').close(); await loadSource(source); }); host.append(button);
  }
  if (!data.models.length) host.textContent = '모델 폴더를 아래에 입력하세요.';
  const draft = await readDraft();
  if (draft) { const restore = document.createElement('button'); restore.textContent = '마지막 자동 복구 사본 열기'; restore.className = 'wide'; restore.onclick = action(async () => { $('model-dialog').close(); await openProject(draft); }); host.prepend(restore); }
  $('model-dialog').showModal();
}

function renderParts() {
  const query = $('part-search').value.toLowerCase(); $('parts').replaceChildren();
  for (const mesh of state.meshes.filter(m => m.name.toLowerCase().includes(query))) {
    const row = document.createElement('div'); row.className = 'part-row' + (state.selectedMesh === mesh ? ' selected' : '');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = mesh.visible; toggle.setAttribute('aria-label', mesh.name + ' 표시');
    toggle.onclick = e => e.stopPropagation(); toggle.onchange = () => { mesh.visible = toggle.checked; markDirty(); };
    const label = document.createElement('span'); label.textContent = mesh.name || '부품'; row.title = mesh.name;
    row.append(toggle, label); row.onclick = action(() => selectMesh(mesh, 0)); row.tabIndex = 0; row.onkeydown = e => { if (e.key === 'Enter') row.click(); }; $('parts').append(row);
  }
}
function materialCategory(doc) {
  const text=[doc.name,...[...doc.meshes].map(m=>m.name)].join(' ').toLowerCase();
  if (/jga|aga|rga|bga|fga|gga|anti.?air|\baa\b|25mm|20mm|40mm/.test(text)) return '대공포';
  if (/jgm|agm|rgm|bgm|fgm|ggm|turret|artillery|torpedo|_gun/.test(text)) return '무장';
  if (/aircraft|airplane|_plane/.test(text)) return '항공기';
  if (/hull|_1944|_1940|_193|jsc|asb|asc|rsc|bsb|gsb|ship/.test(text)) return '선체';
  return '기타';
}
function renderMaterials() {
  const host=$('material-groups');host.replaceChildren();
  for(const category of ['선체','무장','대공포','항공기','기타']){
    const docs=[...state.docs.values()].filter(d=>materialCategory(d)===category);if(!docs.length)continue;
    const group=document.createElement('details');group.open=category==='선체';const title=document.createElement('summary');title.textContent=`${t(category)} · ${docs.length}`;group.append(title);
    for(const doc of docs){const card=document.createElement('button');card.className='material-card';card.title=doc.name;card.textContent=doc.name.replace(/_albedo\.png$/i,'');card.onclick=()=>selectDoc(doc.key);group.append(card);}host.append(group);
  }
}
function renderChannelButtons(){
  let bar=$('channel-tabs');if(!bar){bar=document.createElement('div');bar.id='channel-tabs';bar.className='channel-tabs';$('texture-wrap').insertBefore(bar,$('texture-scroll'));}
  const doc=current();bar.replaceChildren();if(!doc)return;
  for(const button of document.querySelectorAll('[data-tool="brush"],[data-tool="erase"],[data-tool="image"],#text-tool,#fill-tool,#new-layer'))button.disabled=state.channel!=='albedo';
  for(const [key,name] of [['albedo','색상'],['specular','광택'],['metalness','금속성'],['roughness','거칠기'],['normal','노멀'],['normalX','노멀 X'],['normalY','노멀 Y']]){
    const button=document.createElement('button');button.textContent=name;button.classList.toggle('active',key===state.channel);button.disabled=key!=='albedo'&&!doc.channels[key.startsWith('normal')?'normal':key];button.onclick=action(()=>showChannel(key));bar.append(button);
  }
}
async function showChannel(key){
  const doc=current();if(!doc)return;state.channel=key;renderChannelButtons();
  if(key==='albedo'){draw();message('색상 텍스처를 편집해요.');return;}
  const role=key.startsWith('normal')?'normal':key;
  if(!doc.channelImages[role])doc.channelImages[role]=await imageFromURL(assetURL(state.source,doc.channels[role]));
  if(state.activeDoc!==doc.key||state.channel!==key)return;
  const source=doc.channelImages[role],c=$('texture-canvas');c.width=doc.base.width;c.height=doc.base.height;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,c.width,c.height);
  if(key==='normalX'||key==='normalY'){const pixels=ctx.getImageData(0,0,c.width,c.height),offset=key==='normalX'?0:1;for(let i=0;i<pixels.data.length;i+=4){const value=pixels.data[i+offset];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);}
  message('재질 채널 미리보기 · 편집하려면 색상 탭을 선택하세요.');
}
function selectMesh(mesh, materialIndex) {
  state.selectedMesh = mesh; const material = [].concat(mesh.material)[materialIndex] || [].concat(mesh.material)[0];
  selectDoc(material.userData.docKey); renderParts();
}
function selectDoc(key) {
  const doc = state.docs.get(key); if (!doc) return;
  initializeDocument(doc); state.activeDoc = key; state.activeLayer = doc.layers.at(-1)?.id || null; state.channel = 'albedo';
  $('texture-select').value = key; $('texture-label').textContent = doc.name;
  $('texture-meta').textContent = t('textureMeta',{width:doc.base.width,height:doc.base.height,count:doc.meshes.size});
  draw(doc); renderLayers(); syncProperties(); drawUV(); fitTexture(); renderChannelButtons();
}
function unionRegion(a,b){if(!a)return b;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};}
function draw(doc = current(),region=null) {
  if (!doc) return;
  doc.dirty = true;if(!region)doc.fullDraw=true;else doc.dirtyRegion=unionRegion(doc.dirtyRegion,region);invalidate();
  if (doc.key !== state.activeDoc) { drawNow(doc); return; }
  if (pendingDraw) return; pendingDraw = true;
  requestAnimationFrame(() => { pendingDraw = false; drawNow(current()); });
}
function drawNow(doc = current()) {
  if (!doc) return;
  const region=doc.fullDraw?null:doc.dirtyRegion;
  const c = composite(doc, $('compare').checked,region);doc.fullDraw=false;doc.dirtyRegion=null;
  if (!doc.texture) {
    doc.preview = canvas(1,1); doc.texture = new THREE.CanvasTexture(doc.preview); doc.texture.colorSpace = THREE.SRGBColorSpace; doc.texture.flipY = doc.flipY;
    const original = doc.materials[0].userData.originalMap;
    if (original) { doc.texture.wrapS = original.wrapS; doc.texture.wrapT = original.wrapT; doc.texture.repeat.copy(original.repeat); doc.texture.offset.copy(original.offset); }
    doc.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); doc.texture.generateMipmaps = false; doc.texture.minFilter = THREE.LinearFilter;
    for (const m of doc.materials) { m.map = doc.texture; m.needsUpdate = true; }
  }
  const limit = Math.min(Number($('preview-quality').value),renderer.capabilities.maxTextureSize||4096), ratio = Math.min(1, limit / Math.max(c.width,c.height));
  const w=Math.round(c.width*ratio), h=Math.round(c.height*ratio);
  const resized=doc.preview.width!==w||doc.preview.height!==h;
  if (resized) {doc.texture.dispose();doc.preview.width=w;doc.preview.height=h;}
  const previewContext=doc.preview.getContext('2d');previewContext.save();if(region&&!resized){previewContext.beginPath();previewContext.rect(Math.floor(region.x*ratio)-1,Math.floor(region.y*ratio)-1,Math.ceil(region.w*ratio)+2,Math.ceil(region.h*ratio)+2);previewContext.clip();}previewContext.clearRect(0,0,w,h);previewContext.drawImage(c,0,0,w,h);previewContext.restore();
  if(region&&!resized){
    const x=Math.max(0,Math.floor(region.x*ratio)-1),y=Math.max(0,Math.floor(region.y*ratio)-1),right=Math.min(w,Math.ceil((region.x+region.w)*ratio)+1),bottom=Math.min(h,Math.ceil((region.y+region.h)*ratio)+1);
    if(right>x&&bottom>y){
      if(!doc.patch){doc.patch=canvas(1,1);doc.patchTexture=new THREE.CanvasTexture(doc.patch);doc.patchTexture.colorSpace=THREE.SRGBColorSpace;}
      doc.patch.width=right-x;doc.patch.height=bottom-y;doc.patch.getContext('2d').drawImage(doc.preview,x,y,right-x,bottom-y,0,0,right-x,bottom-y);
      renderer.copyTextureToTexture(doc.patchTexture,doc.texture,null,new THREE.Vector2(x,doc.flipY?h-bottom:y));
    }
  }else doc.texture.needsUpdate = true;
  invalidate();
  if (state.channel !== 'albedo' && doc.key === state.activeDoc) return;
  if (doc.key === state.activeDoc) {
    const view = $('texture-canvas'); if (view.width !== c.width || view.height !== c.height) { view.width = c.width; view.height = c.height; }
    const ctx = view.getContext('2d');ctx.save();if(region){ctx.beginPath();ctx.rect(region.x,region.y,region.w,region.h);ctx.clip();}ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(c, 0, 0);ctx.restore();
  }
}
function drawUV() {
  const doc = current(), output = $('uv-canvas'); if (!doc) return;
  output.width = Math.min(1024, doc.base.width); output.height = Math.min(1024, doc.base.height);
  const ctx = output.getContext('2d'); ctx.strokeStyle = '#b3d8e566'; ctx.lineWidth = .65; output.hidden = !$('uv-overlay').checked;
  if (output.hidden) return;
  const meshes = state.selectedMesh && doc.meshes.has(state.selectedMesh) ? [state.selectedMesh] : [...doc.meshes];
  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, uv = g.attributes.uv; if (!uv) continue; const idx = g.index;
    const mats = [].concat(mesh.material); const count = idx ? idx.count : uv.count;
    for (let n = 0; n < count; n += 3) {
      const group = g.groups.find(group => n >= group.start && n < group.start + group.count);
      if (group && mats[group.materialIndex]?.userData.docKey !== doc.key) continue;
      if (++triangles > 70000) break;
      ctx.beginPath(); for (let j = 0; j < 3; j++) { const id = idx ? idx.getX(n + j) : n + j; ctx[j ? 'lineTo' : 'moveTo'](uv.getX(id) * output.width, (doc.flipY ? 1 - uv.getY(id) : uv.getY(id)) * output.height); } ctx.closePath(); ctx.stroke();
    }
  }
}
function fitTexture() {
  const doc = current(); if (!doc?.base) return;
  const host = $('texture-scroll'), w = doc.base.width, h = doc.base.height;
  const ratio = zoom === 'fit' ? Math.max(.01, Math.min((host.clientWidth - 40) / w, (host.clientHeight - 30) / h)) : zoom;
  $('texture-stage').style.width = w * ratio + 'px'; $('texture-stage').style.height = h * ratio + 'px';
}
function thumb(row) {
  const c = canvas(32, 32), image = row.image || row.raster, ctx = c.getContext('2d');
  if (image) ctx.drawImage(image, 0, 0, 32, 32); return c.toDataURL();
}
function renderLayers() {
  const doc = current(); $('layers').replaceChildren();
  if (!doc) return;
  const groups=new Map();
  for (const row of [...doc.layers].reverse()) {
    const el = document.createElement('div'); el.className = 'layer-row' + ((state.selectedLayers?.has(row.id)||row.id===state.activeLayer) ? ' selected' : ''); el.tabIndex = 0;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.visible; check.setAttribute('aria-label', row.name + ' 표시');
    check.onclick = e => e.stopPropagation(); check.onchange = () => { checkpoint(); row.visible = check.checked; changed(); };
    const image = document.createElement('img'); image.className = 'layer-thumb'; image.src = thumb(row); image.alt = '';
    const label = document.createElement('span'); label.className = 'layer-label'; label.textContent = row.name;
    const small = document.createElement('small'); small.textContent = (row.locked?'LOCK · ':'')+(row.group?row.group+' · ':'')+(row.kind === 'image' ? 'IMG' : 'PAINT'); el.append(check, image, label, small);
    el.onclick = event => {if(event.ctrlKey||event.metaKey){state.selectedLayers??=new Set();state.selectedLayers.has(row.id)?state.selectedLayers.delete(row.id):state.selectedLayers.add(row.id);}else state.selectedLayers=new Set([row.id]);state.activeLayer = row.id; if(row.kind==='image')setTool('image');renderLayers(); syncProperties(); invalidate(); }; el.onkeydown = e => { if (e.key === 'Enter') el.click(); };
    let host=$('layers');if(row.group){if(!groups.has(row.group)){const container=document.createElement('details');container.open=true;const summary=document.createElement('summary');summary.textContent=row.group;summary.onclick=()=>{state.selectedLayers=new Set(doc.layers.filter(r=>r.group===row.group).map(r=>r.id));state.activeLayer=row.id;syncProperties();invalidate();};container.append(summary);groups.set(row.group,container);$('layers').append(container);}host=groups.get(row.group);}host.append(el);
  }
  const base = document.createElement('div'); base.className = 'layer-row'; base.textContent = '원본 텍스처 · 읽기 전용'; $('layers').append(base);
  syncUndo();
}
function syncProperties() {
  const row = layer(), exists = !!row&&!row.locked;
  for (const id of ['layer-name', 'blend', 'opacity', 'duplicate-layer', 'layer-up', 'layer-down', 'delete-layer','layer-x','layer-y','layer-scale','layer-rotation','flip']) $(id).disabled = !exists;
  $('delete-layer').disabled=!current()?.layers.some(r=>!r.locked&&(r.id===state.activeLayer||state.selectedLayers?.has(r.id)));
  $('transform-panel').hidden = row?.kind !== 'image'; $('layer-type').textContent = row?.kind === 'image' ? 'IMAGE' : row ? 'PAINT' : '—';
  if (!row) return;
  $('layer-name').value = row.name; $('blend').value = row.blend; $('opacity').value = row.opacity * 100; $('opacity-value').textContent = Math.round(row.opacity * 100) + '%';
  if (row.kind === 'image') { $('layer-x').value = Math.round(row.x * 100); $('layer-y').value = Math.round(row.y * 100); $('layer-scale').value = row.scale * 100; $('scale-value').textContent = Math.round(row.scale * 100) + '%'; $('layer-rotation').value = row.rotation; $('rotation-value').textContent = Math.round(row.rotation) + '°'; $('flip').checked = row.flip; }
}
function checkpoint() {
  const doc = current(); if (!doc) return;
  state.undo.push(snapshot(doc,state.activeLayer)); state.redo = [];
  while(state.undo.length>32)state.undo.shift();
  syncUndo();
}
function syncUndo() { $('undo').disabled = !state.undo.length; $('redo').disabled = !state.redo.length; }
async function history(from, to) {
  if (stroke || imageDrag || projectionDrag || loading) return;
  const snapshot = state[from].at(-1); if (!snapshot) return;
  const doc = state.docs.get(snapshot.key); if (!doc) return;
  state[from].pop();state[to].push(restoreSnapshot(snapshot,doc,state.activeLayer));
  selectDoc(doc.key); state.activeLayer = snapshot.active;state.selectedLayers=new Set(snapshot.active?[snapshot.active]:[]); changed();drawNow(doc);
}
function changed() { draw(); renderLayers(); syncProperties(); markDirty(); }
function markDirty() {
  state.revision=(state.revision||0)+1;
  invalidate();
  state.dirty = true; $('save-state').textContent = '저장하지 않은 변경';
  clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => saveDraft().catch(error => message('자동 복구 저장 실패: ' + error.message, true)), 1800);
}
function addLayer(row) { const doc = current(); if (!doc) throw Error('모델과 텍스처를 먼저 선택하세요.'); if (doc.layers.length >= 40) throw Error('텍스처당 최대 40개 레이어를 지원해요.'); doc.layers.push(row); state.activeLayer = row.id;state.selectedLayers=new Set([row.id]); changed(); }
function setTool(tool) {
  state.tool = tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  controls.enabled = true;
  controls.mouseButtons.LEFT = tool === 'orbit' ? THREE.MOUSE.ROTATE : -1;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  renderer.domElement.style.cursor = tool === 'orbit' ? 'grab' : 'crosshair';
  $('scene-hint').textContent = tool === 'image' ? t('imageLayerHint') : tool === 'orbit' ? '드래그 회전 · 휠 확대 · 클릭 부품 선택' : '표면 드래그로 칠하기 · 보기 도구로 시점 변경';
}
function beginPaint() {
  const doc = current(); if (!doc) return null;
  if(state.channel!=='albedo'){message('재질 채널은 미리보기예요. 색상 탭에서 편집하세요.',true);return null;}
  if ($('compare').checked) { message('원본 비교를 끄고 편집하세요.', true); return null; }
  if(layer()?.kind==='paint'&&layer().locked)return null;
  checkpoint();
  let row = layer(); if (!row || row.kind !== 'paint') { if (doc.layers.length >= 40) throw Error('레이어 수가 너무 많아요.'); row = newPaint(doc, '페인트 ' + (doc.layers.length + 1)); doc.layers.push(row); state.activeLayer = row.id; }
  row.visible = true; return row;
}
function paintPoint(row, x, y, previous) {
  const ctx = row.raster.getContext('2d'), r = Number($('brush-size').value);
  const left=Math.max(0,Math.floor(Math.min(x,previous?.x??x)-r/2-2)),top=Math.max(0,Math.floor(Math.min(y,previous?.y??y)-r/2-2));
  const region={x:left,y:top,w:Math.ceil(Math.max(x,previous?.x??x)+r/2+2)-left,h:Math.ceil(Math.max(y,previous?.y??y)+r/2+2)-top};
  capturePaint(state.undo.at(-1),row,region);
  partMask.paint(ctx,x,y,previous,{size:r,color:$('color').value,hardness:Number($('brush-hardness')?.value??100)/100,opacity:Number($('brush-opacity')?.value??100)/100,spacing:Number($('brush-spacing')?.value??15)/100,erase:state.tool==='erase'},region);
  while(state.undo.reduce((n,s)=>n+historyBytes(s),0)>192*1024*1024&&state.undo.length>1)state.undo.shift();
  if(stroke?.straight)stroke.straight.region=unionRegion(stroke.straight.region,region);draw(current(),region);
}
function straightPreview(shift){
  if(!shift){if(stroke)stroke.straight=null;return;}
  if(!stroke.straight){const snapshot=canvas(stroke.row.raster.width,stroke.row.raster.height);snapshot.getContext('2d').drawImage(stroke.row.raster,0,0);stroke.straight={snapshot,previous:stroke.previous,screen:stroke.screen,region:null};}
  const line=stroke.straight,region=line.region;
  if(region){const ctx=stroke.row.raster.getContext('2d');ctx.save();ctx.beginPath();ctx.rect(region.x,region.y,region.w,region.h);ctx.clip();ctx.clearRect(region.x,region.y,region.w,region.h);ctx.drawImage(line.snapshot,0,0);ctx.restore();draw(current(),region);}
  line.region=null;stroke.previous=line.previous;if(line.screen)stroke.screen=line.screen;
}
function texturePoint(event) { const rect = $('texture-canvas').getBoundingClientRect(), doc = current(); return {x: (event.clientX - rect.left) / rect.width * doc.base.width, y: (event.clientY - rect.top) / rect.height * doc.base.height}; }
$('texture-canvas').addEventListener('pointerdown', action(event => {
  if (event.button || !current() || loading) return;
  if(state.channel!=='albedo'){message('색상 탭에서 편집하세요.',true);return;}
  if(state.tool==='image'&&state.image){checkpoint();const p=texturePoint(event),doc=current(),row=newImage(doc,state.image,state.imageName);row.x=p.x/doc.base.width;row.y=p.y/doc.base.height;addLayer(row);state.image=null;return;}
  if (state.tool === 'brush' || state.tool === 'erase') { const row = beginPaint(); if (!row) return; stroke = {row, previous: texturePoint(event), where: '2d'}; paintPoint(row, stroke.previous.x, stroke.previous.y); }
  else if (layer()?.kind === 'image' && !layer().locked && !layer().projection && (state.tool === 'image' || state.tool === 'orbit')) { checkpoint(); const p = texturePoint(event); imageDrag = {p, x: layer().x, y: layer().y, id: layer().id,peers:current().layers.filter(r=>r.kind==='image'&&!r.locked&&state.selectedLayers?.has(r.id)).map(r=>({id:r.id,x:r.x,y:r.y}))}; }
  else return;
  $('texture-canvas').setPointerCapture(event.pointerId);
}));
$('texture-canvas').addEventListener('pointermove', event => {
  if (stroke?.where === '2d') {const samples=event.getCoalescedEvents?.();for (const sample of event.shiftKey?[event]:samples?.length?samples:[event]) {straightPreview(event.shiftKey); const p = texturePoint(sample); paintPoint(stroke.row, p.x, p.y, stroke.previous); stroke.previous = p; } }
  else if (imageDrag) { const p = texturePoint(event), row = layer(), doc = current(),dx=(p.x-imageDrag.p.x)/doc.base.width,dy=(p.y-imageDrag.p.y)/doc.base.height; row.x = imageDrag.x + dx; row.y = imageDrag.y +dy;for(const peer of imageDrag.peers){const r=doc.layers.find(r=>r.id===peer.id);if(r){r.x=peer.x+dx;r.y=peer.y+dy;}} draw(); syncProperties(); }
});
function endGesture() { if (stroke || imageDrag) { stroke = null; imageDrag = null; changed(); } }
$('texture-canvas').addEventListener('pointerup', endGesture); $('texture-canvas').addEventListener('pointercancel', endGesture);
function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect(); mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.firstHitOnly=true;raycaster.setFromCamera(mouse, camera); return raycaster.intersectObjects(state.meshes.filter(m => m.visible), false)[0];
}
let projectionDrag=null, projectionPreview=null;
imageHandles=document.createElementNS('http://www.w3.org/2000/svg','svg');imageHandles.id='image-handles';imageHandles.setAttribute('aria-label',t('imageTransformHandles'));$('scene-wrap').append(imageHandles);
const projectionVersions=new WeakMap(), pendingProjections=new Set();
function surfaceUp(hit,old){
  const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const up=old?new THREE.Vector3().fromArray(old.cameraUp).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().fromArray(old.normal),normal)):new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  return {normal:normal.toArray(),cameraUp:up.toArray()};
}
function projectionOptions(row,doc) {
  const p=row.projection,normal=new THREE.Vector3().fromArray(p.normal),up=new THREE.Vector3().fromArray(p.cameraUp);
  up.addScaledVector(normal,-up.dot(normal)).normalize();if(up.lengthSq()<.1)up.set(0,0,1).addScaledVector(normal,-normal.z).normalize();
  const right=new THREE.Vector3().crossVectors(up,normal).normalize();
  const point=new THREE.Vector3().fromArray(p.origin).addScaledVector(right,(row.x-.5)*extent).addScaledVector(up,(.5-row.y)*extent);
  return {...p,point:point.toArray(),width:extent*row.scale,rotation:row.rotation*Math.PI/180,flip:row.flip,flipYImage:row.flipYImage,flipY:doc.flipY,centerX:center.x};
}
function clearProjectionPreview(){if(!projectionPreview)return;scene.remove(projectionPreview);projectionPreview.geometry.dispose();projectionPreview.material.map.dispose();projectionPreview.material.dispose();projectionPreview=null;invalidate();}
function previewProjection(row,doc){
  const o=projectionOptions(row,doc),normal=new THREE.Vector3().fromArray(o.normal),up=new THREE.Vector3().fromArray(o.cameraUp);
  up.addScaledVector(normal,-up.dot(normal)).normalize();if(up.lengthSq()<.1)up.set(0,0,1).addScaledVector(normal,-normal.z).normalize();
  const right=new THREE.Vector3().crossVectors(up,normal).normalize();up.applyAxisAngle(normal,o.rotation);right.applyAxisAngle(normal,o.rotation);
  if(!projectionPreview){const texture=new THREE.Texture(row.image);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;projectionPreview=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide}));scene.add(projectionPreview);}
  const texture=projectionPreview.material.map;texture.repeat.set(row.flip?-1:1,row.flipYImage?-1:1);texture.offset.set(row.flip?1:0,row.flipYImage?1:0);
  projectionPreview.position.fromArray(o.point).addScaledVector(normal,extent*.0005);projectionPreview.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal));projectionPreview.scale.set(o.width,o.width*row.image.height/row.image.width,1);invalidate();
}
function imageHandlePoints(row,doc){
  const o=projectionOptions(row,doc),normal=new THREE.Vector3().fromArray(o.normal),up=new THREE.Vector3().fromArray(o.cameraUp);
  up.addScaledVector(normal,-up.dot(normal)).normalize();if(up.lengthSq()<.1)up.set(0,0,1).addScaledVector(normal,-normal.z).normalize();
  const right=new THREE.Vector3().crossVectors(up,normal).normalize();up.applyAxisAngle(normal,o.rotation);right.applyAxisAngle(normal,o.rotation);
  const point=new THREE.Vector3().fromArray(o.point),height=o.width*row.image.height/row.image.width;
  const rect=renderer.domElement.getBoundingClientRect(),host=$('scene-wrap').getBoundingClientRect();
  const screen=v=>{const p=v.project(camera);return{x:rect.left-host.left+(p.x+1)*rect.width/2,y:rect.top-host.top+(1-p.y)*rect.height/2,z:p.z};};
  return {center:screen(point.clone()),corners:[[-1,1],[1,1],[1,-1],[-1,-1]].map(([x,y])=>screen(point.clone().addScaledVector(right,x*o.width/2).addScaledVector(up,y*height/2)))};
}
function drawImageHandles(){
  if(!imageHandles)return;
  const row=projectionDrag?.candidate||layer(),doc=projectionDrag?.doc||current();
  if(!row?.projection||row.locked||!doc||(!row.visible&&!projectionDrag)||$('compare').checked){imageHandles.replaceChildren();return;}
  const {center,corners}=imageHandlePoints(row,doc);if(center.z<-1||center.z>1){imageHandles.replaceChildren();return;}
  const top={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2},length=Math.hypot(top.x-center.x,top.y-center.y)||1,rotation={x:top.x+(top.x-center.x)/length*28,y:top.y+(top.y-center.y)/length*28};
  imageHandles.innerHTML=`<polygon points="${corners.map(p=>`${p.x},${p.y}`).join(' ')}"/><line x1="${top.x}" y1="${top.y}" x2="${rotation.x}" y2="${rotation.y}"/>${corners.map((p,i)=>`<rect data-handle="scale" data-corner="${i}" x="${p.x-6}" y="${p.y-6}" width="12" height="12"/>`).join('')}<circle data-handle="rotate" cx="${rotation.x}" cy="${rotation.y}" r="7"/>`;
}
imageHandles.addEventListener('pointerdown',event=>{
  const mode=event.target.dataset.handle,row=layer(),doc=current();if(event.button||!mode||!row?.projection||projectionDrag)return;
  event.preventDefault();event.stopPropagation();const host=$('scene-wrap').getBoundingClientRect(),p={x:event.clientX-host.left,y:event.clientY-host.top},center=imageHandlePoints(row,doc).center;
  projectionDrag={row,doc,candidate:{...row},visible:row.visible,pointerId:event.pointerId,mode,center,startAngle:Math.atan2(p.y-center.y,p.x-center.x),startDistance:Math.hypot(p.x-center.x,p.y-center.y),startScale:row.scale,startRotation:row.rotation};
  row.visible=false;draw(doc);previewProjection(projectionDrag.candidate,doc);imageHandles.setPointerCapture(event.pointerId);
});
imageHandles.addEventListener('pointermove',event=>{
  if(!projectionDrag?.mode||event.pointerId!==projectionDrag.pointerId)return;
  const g=projectionDrag,host=$('scene-wrap').getBoundingClientRect(),dx=event.clientX-host.left-g.center.x,dy=event.clientY-host.top-g.center.y;
  if(g.mode==='scale')g.candidate.scale=Math.max(.01,Math.min(1.5,g.startScale*Math.hypot(dx,dy)/Math.max(1,g.startDistance)));
  else{const delta=Math.atan2(Math.sin(Math.atan2(dy,dx)-g.startAngle),Math.cos(Math.atan2(dy,dx)-g.startAngle));let angle=((g.startRotation-delta*180/Math.PI+540)%360)-180;if(event.shiftKey){const stops=[0,30,45,60,75,90,120,135,150,165,180];angle=Math.sign(angle)*stops.reduce((best,n)=>Math.abs(n-Math.abs(angle))<Math.abs(best-Math.abs(angle))?n:best,0);}g.candidate.rotation=angle;}
  previewProjection(g.candidate,g.doc);
});
imageHandles.addEventListener('pointerup',event=>{if(projectionDrag?.mode&&event.pointerId===projectionDrag.pointerId)finishImageMove();});
imageHandles.addEventListener('pointercancel',()=>finishImageMove(true));
function updateProjectedLayer(row,doc=current()) {
  const version=(projectionVersions.get(row)||0)+1;projectionVersions.set(row,version);
  const meshes=row.projection.scope==='material'?[...doc.meshes]:[...doc.meshes].filter(m=>m.name===row.projection.meshName);
  message(t('updatingImageLayer'));
  const task=bakeProjection(row.image,meshes,doc,projectionOptions(row,doc)).then(({bitmap,count})=>{
    try{if(projectionVersions.get(row)!==version||!doc.layers.includes(row))return;if(!count)throw Error(t('projectionEmpty'));
      row.raster=canvas(doc.base.width,doc.base.height);row.raster.getContext('2d').drawImage(bitmap,0,0);draw(doc);if(current()===doc)renderLayers();markDirty();message(t('imageLayerReady'));
    }finally{bitmap.close();}
  }).catch(report).finally(()=>pendingProjections.delete(task));pendingProjections.add(task);return task;
}
function beginImageMove(hit,event){
  if(layer()?.locked&&!state.image)return;
  if(state.channel!=='albedo')throw Error('색상 탭에서 이미지를 투영하세요.');
  const image=state.image|| (layer()?.kind==='image'?layer().image:null);if(!image)throw Error(t('chooseImageLayer'));
  const material=[].concat(hit.object.material)[hit.face.materialIndex],key=material.userData.docKey;
  let row=layer();if(!row||row.kind!=='image'||row.image!==image)row=null;
  if(row&&key!==state.activeDoc)throw Error(t('imageSameTexture'));
  if(key!==state.activeDoc)selectMesh(hit.object,hit.face.materialIndex);
  const candidate={...(row||newImage(current(),image,state.imageName)),x:.5,y:.5,scale:row?.projection?row.scale:Number($('stamp-size').value)/100,rotation:row?.projection?row.rotation:Number($('stamp-rotation').value),projection:{origin:hit.point.toArray(),...surfaceUp(hit,row?.projection),meshName:hit.object.name,scope:row?.projection?.scope||$('stamp-scope').value,maxAngle:row?.projection?.maxAngle??Number($('stamp-angle').value),depth:row?.projection?.depth??Number($('stamp-depth').value)/100,mirror:row?.projection?.mirror??$('stamp-mirror').checked}};
  projectionDrag={row,candidate,doc:current(),pointerId:event.pointerId,visible:row?.visible,startClient:{x:event.clientX,y:event.clientY},moved:!row};
  if(!row)previewProjection(candidate,current());renderer.domElement.setPointerCapture(event.pointerId);
}
function moveImageLayer(event){
  if(!projectionDrag||event.pointerId!==projectionDrag.pointerId)return;
  if(!projectionDrag.moved){if(Math.hypot(event.clientX-projectionDrag.startClient.x,event.clientY-projectionDrag.startClient.y)<3)return;projectionDrag.moved=true;projectionDrag.row.visible=false;draw(projectionDrag.doc);}
  const hit=pick(event);if(!hit?.uv)return;
  const material=[].concat(hit.object.material)[hit.face.materialIndex];if(material.userData.docKey!==projectionDrag.doc.key)return;
  const p=projectionDrag.candidate.projection;projectionDrag.candidate.projection={...p,origin:hit.point.toArray(),...surfaceUp(hit,p),meshName:hit.object.name};previewProjection(projectionDrag.candidate,projectionDrag.doc);
}
function finishImageMove(cancel=false){
  if(!projectionDrag)return;const {row,candidate,doc,visible,moved,mode}=projectionDrag;projectionDrag=null;clearProjectionPreview();
  if(row)row.visible=visible;
  if(row&&!moved&&!mode){invalidate();return;}
  if(cancel){draw(doc);return;}
  checkpoint();candidate.visible=true;
  const peers=row?doc.layers.filter(r=>r.kind==='image'&&!r.locked&&r.id!==row.id&&state.selectedLayers?.has(r.id)):[];
  for(const peer of peers){const scaleRatio=candidate.scale/row.scale,rotationDelta=candidate.rotation-row.rotation;peer.scale*=scaleRatio;peer.rotation+=rotationDelta;
    if(peer.projection){const oldPoint=new THREE.Vector3().fromArray(projectionOptions(peer,doc).point),pivot=new THREE.Vector3().fromArray(projectionOptions(row,doc).point),target=new THREE.Vector3().fromArray(projectionOptions(candidate,doc).point);oldPoint.sub(pivot).applyAxisAngle(new THREE.Vector3().fromArray(row.projection.normal),rotationDelta*Math.PI/180).multiplyScalar(scaleRatio).add(target);peer.x=peer.y=.5;peer.projection={...peer.projection,origin:oldPoint.toArray()};updateProjectedLayer(peer,doc);}}
  let target=row;if(row)Object.assign(row,candidate);else{target=candidate;target.raster=canvas(doc.base.width,doc.base.height);doc.layers.push(target);}
  state.activeLayer=target.id;state.image=null;changed();updateProjectedLayer(target,doc);
}
let pointerDown = null;
function deselectImage(){if(layer()?.kind!=='image')return;state.activeLayer=null;state.selectedLayers=new Set();if($('overlap-layers'))$('overlap-layers').hidden=true;renderLayers();syncProperties();invalidate();}
function imagesAtHit(hit){
  if(!hit?.uv)return null;const material=[].concat(hit.object.material)[hit.face.materialIndex],doc=state.docs.get(material?.userData.docKey);if(!doc?.base)return null;
  const x=Math.min(doc.base.width-1,Math.floor(((hit.uv.x%1+1)%1)*doc.base.width)),y=Math.min(doc.base.height-1,Math.floor((doc.flipY?1-((hit.uv.y%1+1)%1):((hit.uv.y%1+1)%1))*doc.base.height));
  const result=[];for(const row of doc.layers.slice().reverse()){if(row.kind!=='image'||!row.visible||!row.opacity||!row.projection||!row.raster)continue;if(row.raster.getContext('2d').getImageData(x,y,1,1).data[3]>16)result.push({row,doc});}return result;
}
function selectImageHit(hit,cycle=false){const candidates=imagesAtHit(hit)||[];if(!candidates.length)return false;const index=cycle?(candidates.findIndex(s=>s.row.id===state.activeLayer)+1)%candidates.length:0,selected=candidates[index];if(selected.doc.key!==state.activeDoc)selectDoc(selected.doc.key);state.activeLayer=selected.row.id;if(cycle||!state.selectedLayers?.has(selected.row.id))state.selectedLayers=new Set([selected.row.id]);const chooser=$('overlap-layers');if(chooser){chooser.replaceChildren(...candidates.map(s=>new Option(s.row.name,s.row.id)));chooser.value=selected.row.id;chooser.hidden=candidates.length<2;}renderLayers();syncProperties();invalidate();return true;}
renderer.domElement.addEventListener('pointerdown', action(event => {
  if (event.button || !model || loading) return;
  pointerDown = {x: event.clientX, y: event.clientY};
  if (state.tool === 'orbit') return;
  const hit = pick(event); if (!hit){deselectImage();return;}
  if (state.tool !== 'image') selectMesh(hit.object, hit.face.materialIndex);
  if ($('compare').checked) throw Error('원본 비교를 끄고 편집하세요.');
  if (state.tool === 'image') {if(!state.image&&!selectImageHit(hit,event.altKey)){deselectImage();return;} beginImageMove(hit,event); return; }
  const row = beginPaint(); if (!row || !hit.uv) return;
  stroke = {row, where: '3d', key: state.activeDoc, previous: null, screen: {x:event.clientX,y:event.clientY}, pointerId:event.pointerId};
  const x = ((hit.uv.x % 1 + 1) % 1) * row.raster.width, y = (current().flipY ? 1 - ((hit.uv.y % 1 + 1) % 1) : ((hit.uv.y % 1 + 1) % 1)) * row.raster.height;
  paintPoint(row, x, y); stroke.previous={x,y,hit}; renderer.domElement.setPointerCapture(event.pointerId);
}));
function paintSurfaceSample(hit) {
  if (!hit?.uv) { stroke.previous=null; return; }
  const material = [].concat(hit.object.material)[hit.face.materialIndex] || hit.object.material;
  if (material.userData.docKey !== stroke.key) { stroke.previous=null; return; }
  const x = ((hit.uv.x % 1 + 1) % 1) * stroke.row.raster.width, y = (current().flipY ? 1 - ((hit.uv.y % 1 + 1) % 1) : ((hit.uv.y % 1 + 1) % 1)) * stroke.row.raster.height;
  const prev = continuousSurface(stroke.previous?.hit,hit) ? stroke.previous : null;
  paintPoint(stroke.row, x, y, prev); stroke.previous = {x, y, hit};
}
function moveSurfaceBrush(event) {
  if (stroke?.where !== '3d' || event.pointerId !== stroke.pointerId) return;
  const samples=event.getCoalescedEvents?.();
  for (const sample of event.shiftKey?[event]:samples?.length ? samples : [event]) {
    straightPreview(event.shiftKey);
    const end={x:sample.clientX,y:sample.clientY},start=stroke.screen,hit=pick(sample);
    if (continuousSurface(stroke.previous?.hit,hit)) paintSurfaceSample(hit);
    else {
      // Trace the visible surface between sparse input events, rather than connecting UV islands.
      const steps=Math.max(1,Math.min(64,Math.ceil(Math.hypot(end.x-start.x,end.y-start.y)/3)));
      for (let i=1;i<=steps;i++) paintSurfaceSample(i===steps?hit:pick({clientX:start.x+(end.x-start.x)*i/steps,clientY:start.y+(end.y-start.y)*i/steps}));
    }
    stroke.screen=end;
  }
}
renderer.domElement.addEventListener('pointermove', moveSurfaceBrush);
renderer.domElement.addEventListener('pointermove', moveImageLayer);
renderer.domElement.addEventListener('pointerup', action(event => {
  if(projectionDrag){moveImageLayer(event);finishImageMove();pointerDown=null;return;}
  moveSurfaceBrush(event);
  if (state.tool === 'orbit' && pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 5) { const hit = pick(event); if(!selectImageHit(hit,event.altKey)){if(hit)selectMesh(hit.object, hit.face.materialIndex);deselectImage();} }
  pointerDown = null; endGesture();
}));
renderer.domElement.addEventListener('pointercancel', ()=>{finishImageMove(true);endGesture();});

function projectData() {
  return {schema: 'wows-skin-workshop/v1', source: state.source, activeDoc: state.activeDoc,
    documents: [...state.docs.values()].filter(doc => doc.layers.length).map(doc => ({key: doc.key, name: doc.name, width: doc.base.width, height: doc.base.height, target: doc.target, layers: doc.layers.map(serializeLayer)})),
    hiddenParts: state.meshes.filter(m => !m.visible).map(m => m.name), xml: state.xml ? new XMLSerializer().serializeToString(state.xml) : null, xmlName: state.xmlName, xmlDirty: state.xmlDirty};
}
async function projectDataAsync(){
  await Promise.all([...pendingProjections]);
  // Freeze editable raster buffers before asynchronous PNG encoding.
  const result={schema:'wows-skin-workshop/v1',source:state.source,activeDoc:state.activeDoc,documents:[],hiddenParts:state.meshes.filter(m=>!m.visible).map(m=>m.name),xml:state.xml?new XMLSerializer().serializeToString(state.xml):null,xmlName:state.xmlName,xmlDirty:state.xmlDirty};
  const docs=[...state.docs.values()].filter(d=>d.layers.length).map(d=>({key:d.key,name:d.name,width:d.base.width,height:d.base.height,target:d.target,layers:d.layers.map(row=>({...row}))}));
  for(const doc of docs){doc.layers=await Promise.all(doc.layers.map(serializeLayerAsync));result.documents.push(doc);}return result;
}
async function openProject(value) {
  if (value.schema !== 'wows-skin-workshop/v1' || !value.source || !Array.isArray(value.documents) || value.documents.length > 64) throw Error('지원하지 않는 프로젝트예요.');
  if (state.dirty && !confirm('현재 작업을 저장하지 않고 프로젝트를 열까요?')) return;
  // Validate images before replacing the current model.
  const prepared = [];
  for (const doc of value.documents) { const layers = await restoreLayers(doc.layers); prepared.push({...doc, layers}); }
  let xml = null; if (value.xml) xml = parseXML(value.xml);
  busy(true, '프로젝트를 복원하는 중이에요.');
  try {
    let source = value.source, object;
    if (source.format === 'glb-file') { const bytes = Uint8Array.from(atob(source.data), c => c.charCodeAt(0)); object = await parseEmbeddedGLB(bytes.buffer); }
    else {
      let resolved;
      try{resolved=await(await api('resolve-source',{source})).json();}
      catch(error){const folder=prompt(t('relinkModelPrompt'),source.folder||'');if(!folder)throw error;resolved=await(await api('resolve-source',{source,folder})).json();}
      if(resolved.job){while(true){const job=await(await api('jobs/'+resolved.job)).json();if(job.status==='error'||job.status==='cancelled')throw Error(job.message);if(job.status==='done'){source=job.result;break;}await new Promise(r=>setTimeout(r,600));}}
      else source=resolved.source;
      object=await prepareSource(source);
    }
    // Check stable texture identities and sizes before replacing the current document.
    await installModel(object, source, prepared);
    for (const doc of state.docs.values()) if (doc.layers.length) draw(doc);
    for (const mesh of state.meshes) if (value.hiddenParts?.includes(mesh.name)) mesh.visible = false;
    state.xml = xml; state.xmlName = value.xmlName || 'camouflages.xml'; state.xmlDirty = !!value.xmlDirty;
    selectDoc(state.docs.has(value.activeDoc) ? value.activeDoc : state.activeDoc); renderParts();
    state.dirty = false; $('save-state').textContent = '프로젝트 복원됨'; message('프로젝트를 복원했어요. 원본 모델 폴더는 계속 필요해요.');
  } finally { busy(false); }
}
async function draftDB() { return new Promise((resolve, reject) => { const request = indexedDB.open('wows-skin-workshop', 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
let savingDraft=null,lastBackupRevision=null;
async function saveDraft() {
  if(savingDraft){await savingDraft;if(lastBackupRevision!==state.revision)return saveDraft();return true;}
  if (!state.source)return true;
  if(loading||projectionDrag||stroke||imageDrag){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveDraft().catch(report),1800);return false;}
  const revision=state.revision;
  savingDraft=(async()=>{const value=await projectDataAsync();if(revision!==state.revision){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveDraft().catch(report),1800);return;}
    state.backupId=(await(await api('save-backup',value)).json()).id;lastBackupRevision=revision;
    try{const db=await draftDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,'latest');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}catch{ /* Disk backup remains available if browser quota is exhausted. */ }
    $('save-state').textContent=t('diskBackupSaved');
    return true;
  })();try{return await savingDraft;}finally{savingDraft=null;}
}
async function readDraft() {
  try { const db = await draftDB(); try { return await new Promise((resolve, reject) => { const req = db.transaction('drafts').objectStore('drafts').get('latest'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); } finally { db.close(); } } catch { return null; }
}
function parseXML(text) { if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('외부 엔터티 선언이 있는 XML은 지원하지 않아요.'); const xml = new DOMParser().parseFromString(text, 'application/xml'); if (xml.querySelector('parsererror')) throw Error('XML 문법을 확인하세요.'); if (!xml.getElementsByTagName('colorScheme').length) throw Error('colorScheme 항목이 없는 XML이에요.'); return xml; }
function schemes() { return state.xml ? [...state.xml.getElementsByTagName('colorScheme')] : []; }
function renderSchemes() { $('scheme-select').replaceChildren(...schemes().map((node, i) => new Option(node.getElementsByTagName('name')[0]?.textContent.trim() || '색상표 ' + i, String(i)))); renderColors(); }
function renderColors() {
  const node = schemes()[Number($('scheme-select').value)]; $('camo-colors').replaceChildren();
  if (!node) return;
  for (let i = 0; i < 4; i++) {
    const entry = node.getElementsByTagName('color' + i)[0]; if (!entry) continue;
    const values = entry.textContent.trim().split(/\s+/).map(Number); if (values.length !== 4 || values.some(v => !Number.isFinite(v))) continue;
    const label = document.createElement('label'); label.textContent = ['검정 마스크', '빨강 마스크', '초록 마스크', '파랑 마스크'][i];
    const input = document.createElement('input'); input.type = 'color'; input.value = '#' + values.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join(''); input.setAttribute('aria-label', '위장 색상 ' + i);
    input.oninput = () => { const rgb = [1, 3, 5].map(p => parseInt(input.value.slice(p, p + 2), 16) / 255); entry.textContent = [...rgb.map(v => v.toFixed(4)), values[3].toFixed(4)].join(' '); state.xmlDirty = true; markDirty(); message('XML 색상표를 수정했어요. 3D 위장 합성은 아직 지원하지 않아요.'); };
    label.append(input); $('camo-colors').append(label);
  }
}
async function showExport() {
  $('export-paths').replaceChildren();
  for (const doc of [...state.docs.values()].filter(d => d.layers.length)) {
    const label = document.createElement('label'); label.textContent = doc.name; const input = document.createElement('input'); input.value = doc.target;
    input.onchange = () => { doc.target = input.value; markDirty(); }; label.append(input); $('export-paths').append(label);
  }
  if (!$('export-paths').children.length && !state.xmlDirty) throw Error('변경한 텍스처나 XML이 없어요. 먼저 편집해보세요.');
  $('export-dialog').showModal();
}
async function exportWork() {
  await Promise.all([...pendingProjections]);
  const payload = {format: $('export-format').value, compression: $('dds-format').value, mipmaps: $('mipmaps').checked,
    textures: [...state.docs.values()].filter(d => d.layers.length).map(doc => ({name: doc.name, target: doc.target, data: composite(doc, false).toDataURL('image/png')})),
    xml: state.xmlDirty ? new XMLSerializer().serializeToString(state.xml) : null, xmlName: state.xmlName};
  busy(true, '텍스처와 밉맵을 만드는 중이에요.');
  try { const response = await api('export', payload); download(await response.blob(), (state.source?.name || 'wows') + '-skin.zip'); $('export-dialog').close(); message('편집 결과 ZIP을 저장했어요. 게임 원본과 출력 경로·형식을 비교하세요.'); }
  finally { busy(false); draw(); }
}
async function parseEmbeddedGLB(buffer) {
  // An imported GLB cannot fetch resources from remote sites or unrelated local files.
  const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw Error('외부 리소스가 있는 GLB예요. 모델과 이미지를 포함해 내보내세요.'); return url; });
  return (await new GLTFLoader(manager).parseAsync(buffer, '')).scene;
}

// File and editor actions.
const shipLibrary = new ShipLibrary(api, loadSource, report);
setupViewportSplitter();
setupWorkshopTools({api,state,openProject,projectDataAsync,saveDraft,checkpoint,changed,report,renderLayers,syncProperties,updateProjectedLayer,renderer,scene,keyLight,fillLight,current,deselectImage});
const partMask=setupPartMask({state,current,category:name=>({ '선체':'hull','무장':'weapons','대공포':'aa','항공기':'aircraft'}[materialCategory({name,meshes:[]})]||'other'),paintStroke,renderer,pick});
setupTextureImport({api,state,selectDoc,checkpoint,changed,busy,report});
const replaceBlend=new Option(t('textureReplaceBlend'),'copy');$('blend').append(replaceBlend);
let clickedAxis = null;
function alignAxis(vector) {
  if (!model || !vector) return;
  // Clear orbit momentum before snapping so damping cannot rotate the aligned view.
  const damping = controls.enableDamping;
  controls.enableDamping = false; controls.update();
  controls.target.copy(center); camera.up.set(0,1,0);
  if (Math.abs(vector.y) > .9) camera.up.set(0,0,-1);
  camera.position.copy(center).addScaledVector(vector,extent*1.4);
  controls.update(); controls.enableDamping = damping; invalidate();
}
$('axis-gizmo').onclick = event => {
  // Keep the first axis through a double click: the first snap moves the gizmo dots.
  if (event.detail <= 1) {
    const c=$('axis-gizmo'),r=c.getBoundingClientRect(),x=(event.clientX-r.left)*100/r.width,y=(event.clientY-r.top)*100/r.height;
    clickedAxis=[...(c.axisPoints||[])].reverse().find(p=>Math.hypot(p.x-x,p.y-y)<12)?.vector.clone() || null;
  }
  alignAxis(clickedAxis);
};
$('axis-gizmo').ondblclick = event => { event.preventDefault(); alignAxis(clickedAxis); };
$('preview-quality').onchange=()=>{for(const doc of state.docs.values())if(doc.texture)drawNow(doc);};
$('open-model').onclick = action(showLibrary); $('welcome-open').onclick = action(showLibrary);
$('load-folder').onclick = action(async () => { const folder = $('folder-path').value.trim(); if (!folder) throw Error('모델 폴더 경로를 입력하세요.'); const source = await (await api('open-folder', {folder})).json(); $('model-dialog').close(); await loadSource(source); });
$('load-glb').onclick = () => $('glb-file').click();
$('glb-file').onchange = action(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > 64 * 1024 * 1024) throw Error('GLB는 64 MiB 이하로 선택하세요.');
  if (state.dirty && !confirm('현재 변경을 저장하지 않고 GLB를 열까요?')) return;
  $('model-dialog').close(); busy(true);
  try { const buffer = await file.arrayBuffer(), data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); const object = await parseEmbeddedGLB(buffer); await installModel(object, {name: file.name.replace(/\.glb$/i, ''), format: 'glb-file', data}); } finally { busy(false); }
});
$('open-project').onclick = () => $('project-file').click();
$('project-file').onchange = action(async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; if (file.size > 96 * 1024 * 1024) throw Error('프로젝트는 96 MiB 이하로 선택하세요.'); await openProject(JSON.parse(await file.text())); });
$('save-project').onclick = action(async () => { if (!state.source) throw Error('모델을 먼저 열어주세요.'); jsonDownload(await projectDataAsync(), state.source.name + '.wowskin'); state.dirty = false; $('save-state').textContent = '프로젝트 다운로드 요청됨'; message('프로젝트 저장을 요청했어요. 다운로드 완료를 확인하세요.'); });
$('export').onclick = action(showExport); $('download-export').onclick = action(exportWork);
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('button[data-view]').forEach(button => button.onclick = () => { document.querySelector('.workspace').dataset.view = button.dataset.view; document.querySelectorAll('button[data-view]').forEach(b => b.classList.toggle('active', b === button)); resize(); });
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => { if (button.dataset.tool === 'image') $('image-file').click(); else setTool(button.dataset.tool); });
async function importImageFile(file){
  if (!current()) throw Error('모델을 먼저 열어주세요.');if(file.size>16*1024*1024)throw Error('이미지는 16 MiB 이하로 선택하세요.');
  const url=URL.createObjectURL(file);try{state.image=await imageFromURL(url);state.imageName=file.name||t('clipboardImage');setTool('image');message(t('imageReady',{name:state.imageName}));}finally{URL.revokeObjectURL(url);}
}
$('image-file').onchange = action(async event => { const file=event.target.files[0];event.target.value='';if(file)await importImageFile(file); });
$('text-tool').onclick = action(() => { if (!current()) throw Error('모델을 먼저 열어주세요.'); $('text-dialog').showModal(); });
$('add-text').onclick = action(() => { const text = $('text-value').value.trim(); if (!text) throw Error('문구를 입력하세요.'); const px = Math.max(8, Math.min(512, Number($('text-size').value) || 100)); const lines = text.split('\n'); const c = canvas(1, 1), ctx = c.getContext('2d'); ctx.font = 'bold ' + px + 'px "' + $('text-font').value + '"'; const width = Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + px; if (width > 4096 || lines.length * px * 1.3 > 4096) throw Error('문구가 너무 커요. 크기를 줄여주세요.'); c.width = width; c.height = Math.ceil(lines.length * px * 1.3 + px * .2); ctx.font = 'bold ' + px + 'px "' + $('text-font').value + '"'; ctx.fillStyle = $('color').value; ctx.textBaseline = 'top'; lines.forEach((line, i) => ctx.fillText(line, px / 2, i * px * 1.3)); checkpoint(); addLayer(newImage(current(), c, text.slice(0, 30))); state.image = c; state.imageName = text.slice(0, 30); setTool('image'); $('text-dialog').close(); });
$('fill-tool').onclick = action(() => { if (!current()) throw Error('모델을 먼저 열어주세요.'); checkpoint(); const row = newPaint(current(), '색 채우기'); const ctx = row.raster.getContext('2d'); ctx.fillStyle = $('color').value; ctx.fillRect(0, 0, row.raster.width, row.raster.height); addLayer(row); });
$('new-layer').onclick = action(() => { if (!current()) throw Error('모델을 먼저 열어주세요.'); checkpoint(); addLayer(newPaint(current(), '페인트 ' + (current().layers.length + 1))); });
$('duplicate-layer').onclick = action(async () => { await Promise.all([...pendingProjections]);const row = layer(); if (!row) return; checkpoint(); const [copy] = cloneLayers([row]); copy.id = uid(); copy.name += ' 복사'; addLayer(copy); });
$('delete-layer').onclick = () => { if (!layer()) return;const ids=new Set(current().layers.filter(row=>!row.locked&&(row.id===state.activeLayer||state.selectedLayers?.has(row.id))).map(row=>row.id));if(!ids.size)return;checkpoint(); const doc = current(); doc.layers = doc.layers.filter(row => !ids.has(row.id));state.selectedLayers=new Set(); state.activeLayer = doc.layers.at(-1)?.id || null; changed(); };
for (const [id, offset] of [['layer-up', 1], ['layer-down', -1]]) $(id).onclick = () => { if (!layer()) return; const rows = current().layers, i = rows.indexOf(layer()), j = i + offset; if (j < 0 || j >= rows.length) return; checkpoint(); [rows[i], rows[j]] = [rows[j], rows[i]]; changed(); };
for (const [id, key, convert] of [['layer-name', 'name', v => v.slice(0, 100)], ['blend', 'blend', v => v], ['opacity', 'opacity', v => Number(v) / 100], ['layer-x', 'x', v => Number(v) / 100], ['layer-y', 'y', v => Number(v) / 100], ['layer-scale', 'scale', v => Number(v) / 100], ['layer-rotation', 'rotation', Number]]) {
  $(id).addEventListener('change', () => { if (!layer()||layer().locked) return; const value = convert($(id).value); if (typeof value === 'number' && !Number.isFinite(value)) return;const old=layer()[key],rows=current().layers.filter(r=>!r.locked&&(r.id===state.activeLayer||state.selectedLayers?.has(r.id)));checkpoint();for(const row of rows){row[key]=row.id===state.activeLayer?value:['x','y','rotation'].includes(key)?row[key]+value-old:key==='scale'?row.scale*value/old:value;if(row.projection&&['x','y','scale','rotation'].includes(key))updateProjectedLayer(row);}changed(); });
}
$('flip').onchange = () => { if (!layer()) return; checkpoint(); layer().flip = $('flip').checked; changed();if(layer().projection)updateProjectedLayer(layer()); };
$('undo').onclick = action(() => history('undo', 'redo')); $('redo').onclick = action(() => history('redo', 'undo'));
$('brush-size').oninput = () => $('brush-size-value').textContent = $('brush-size').value;
$('stamp-size').oninput = () => $('stamp-size-value').textContent = $('stamp-size').value + '%';
$('part-search').oninput = renderParts; $('texture-select').onchange = () => { state.selectedMesh = null; selectDoc($('texture-select').value); renderParts(); };
$('show-all').onclick = () => { state.meshes.forEach(m => m.visible = m.userData.originalVisible); renderParts(); markDirty(); };
$('isolate').onclick = () => { if (!state.selectedMesh) { message('부품을 먼저 선택하세요.'); return; } state.meshes.forEach(m => m.visible = m === state.selectedMesh); renderParts(); markDirty(); };
$('uv-overlay').onchange = drawUV; $('compare').onchange = () => { for (const doc of state.docs.values()) if (doc.base) draw(doc); };
$('home-view').onclick = () => focusView(); document.querySelectorAll('[data-axis]').forEach(button => button.onclick = () => focusView(button.dataset.axis));
$('wireframe').onclick = () => { const on = !$('wireframe').classList.contains('active'); $('wireframe').classList.toggle('active', on); for (const mesh of state.meshes) for (const m of [].concat(mesh.material)) m.wireframe = on; invalidate(); };
$('zoom-fit').onclick = () => { zoom = 'fit'; fitTexture(); }; $('zoom-in').onclick = () => { zoom = zoom === 'fit' ? .5 : Math.min(4, zoom * 1.4); fitTexture(); }; $('zoom-out').onclick = () => { zoom = zoom === 'fit' ? .25 : Math.max(.05, zoom / 1.4); fitTexture(); };
$('camo-open').onclick = () => { renderSchemes(); $('camo-dialog').showModal(); }; $('load-xml').onclick = () => $('xml-file').click();
$('xml-file').onchange = action(async event => { const file = event.target.files[0]; event.target.value = ''; if (!file) return; if (file.size > 8 * 1024 * 1024) throw Error('XML은 8 MiB 이하로 선택하세요.'); state.xml = parseXML(await file.text()); state.xmlName = file.name; state.xmlDirty = false; renderSchemes(); });
$('scheme-select').onchange = renderColors; $('save-xml').onclick = action(() => { if (!state.xml) throw Error('위장 XML을 먼저 열어주세요.'); download(new Blob([new XMLSerializer().serializeToString(state.xml)], {type: 'application/xml'}), state.xmlName); });
const textInput=target=>!!target.closest?.('input,textarea,select,[contenteditable="true"]');
let copiedLayer=null;
document.addEventListener('copy',event=>{
  if(textInput(event.target)||!layer()||loading||projectionDrag||stroke)return;
  if(pendingProjections.size){message(t('waitForImageLayer'));return;}
  const token='WoWS-Skin-Workshop:'+uid();copiedLayer={token,row:cloneLayers([layer()])[0],key:current().key,width:current().base.width,height:current().base.height};
  event.clipboardData.setData('text/plain',token);event.preventDefault();message(t('layerCopied'));
});
document.addEventListener('paste',action(async event=>{
  if(textInput(event.target)||loading||projectionDrag||stroke)return;
  const file=[...(event.clipboardData?.files||[])].find(file=>file.type.startsWith('image/'));
  if(file){event.preventDefault();await importImageFile(file);return;}
  if(!copiedLayer||event.clipboardData?.getData('text/plain')!==copiedLayer.token||!current())return;
  event.preventDefault();const doc=current(),source=copiedLayer;
  if((source.row.projection&&source.key!==doc.key)||(source.row.kind==='paint'&&(source.width!==doc.base.width||source.height!==doc.base.height)))throw Error(t('pasteSameTexture'));
  checkpoint();const [copy]=cloneLayers([source.row]);copy.id=uid();copy.name+=' '+t('copySuffix');addLayer(copy);if(copy.kind==='image')setTool('image');message(t('layerPasted'));
}));
document.addEventListener('keydown', event => {
  if (textInput(event.target)) return;
  if(event.key==='Delete'&&!loading&&!stroke&&!projectionDrag&&!imageDrag&&layer()){event.preventDefault();$('delete-layer').click();}
  const modifier=event.ctrlKey||event.metaKey;
  if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); $('save-project').click(); }
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? $('redo') : $('undo')).click(); }
  if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); $('redo').click(); }
  if (event.key === 'Escape') {finishImageMove(true);deselectImage();setTool('orbit');}
});
document.addEventListener('pointerdown',event=>{if(event.target.closest('button[data-view],[data-tool],#channel-tabs,#open-model,#camo-open,.material-card'))deselectImage();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)deselectImage();});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
syncUndo(); syncProperties(); resize();
// Read-only access for integration checks and diagnostics.
window.workshop = {get state() { return state; }, get renderer() { return renderer; }, get camera() { return camera; }, get model() { return model; }, projectData};
const restartBackup=localStorage.getItem('workshop.restartBackup');if(restartBackup){localStorage.removeItem('workshop.restartBackup');api('read-backup',{id:restartBackup}).then(r=>r.json()).then(openProject).catch(report);}
initI18n();
$('ui-language').onchange=action(async()=>{const next=$('ui-language').value;if(!await saveDraft()){$('ui-language').value=language;throw Error(t('finishEditBeforeBackup'));}if(state.backupId)localStorage.setItem('workshop.restartBackup',state.backupId);localStorage.setItem('workshop.language',next);state.dirty=false;location.reload();});
