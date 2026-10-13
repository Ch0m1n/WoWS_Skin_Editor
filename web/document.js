export const MAX_DIMENSION = 4096;
export function canvas(width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
}
export function uid() { return crypto.randomUUID(); }
export function checkedImage(image) {
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  if (!w || !h || w > MAX_DIMENSION || h > MAX_DIMENSION) throw Error('텍스처는 4096 × 4096 이하로 열어주세요.');
  return [w, h];
}
export async function imageFromURL(url) {
  const image = new Image(); image.src = url; await image.decode(); checkedImage(image); return image;
}
export function initializeDocument(doc) {
  if (doc.base) return;
  const [w, h] = doc.image ? checkedImage(doc.image) : [1024, 1024];
  doc.base = canvas(w, h); doc.composite = canvas(w, h);
  const ctx = doc.base.getContext('2d');
  if (doc.image) ctx.drawImage(doc.image, 0, 0); else { ctx.fillStyle = '#737e83'; ctx.fillRect(0, 0, w, h); }
}
export function newPaint(doc, name = '페인트') {
  initializeDocument(doc);
  return {id: uid(), name, kind: 'paint', visible: true, opacity: 1, blend: 'source-over', raster: canvas(doc.base.width, doc.base.height)};
}
export function newImage(doc, image, name) {
  initializeDocument(doc);
  return {id: uid(), name, kind: 'image', visible: true, opacity: 1, blend: 'source-over', image,
    x: .5, y: .5, scale: .35, rotation: 0, flip: false};
}
export function composite(doc, original = false, region = null) {
  initializeDocument(doc);
  const ctx = doc.composite.getContext('2d'), w = doc.base.width, h = doc.base.height;
  ctx.save();if(region){ctx.beginPath();ctx.rect(region.x,region.y,region.w,region.h);ctx.clip();}
  ctx.clearRect(0, 0, w, h); ctx.drawImage(doc.base, 0, 0);
  if (original) {ctx.restore();return doc.composite;}
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save(); ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.blend;
    if (layer.kind === 'image' && !layer.projection) {
      const width = w * layer.scale, height = width * layer.image.height / layer.image.width;
      ctx.translate(layer.x * w, layer.y * h); ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.scale(layer.flip ? -1 : 1, 1); ctx.drawImage(layer.image, -width / 2, -height / 2, width, height);
    } else ctx.drawImage(layer.raster, 0, 0);
    ctx.restore();
  }
  ctx.restore();return doc.composite;
}
export function serializeLayer(layer) {
  const {image, raster, ...rest} = layer;
  let data;
  if (raster) data = raster.toDataURL('image/png');
  else { const c = canvas(image.width, image.height); c.getContext('2d').drawImage(image, 0, 0); data = c.toDataURL('image/png'); }
  let originalData;
  if(layer.projection){const c=canvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);originalData=c.toDataURL('image/png');}
  return {...rest, data, ...(originalData?{originalData}: {})};
}
export async function serializeLayerAsync(layer) {
  const {image,raster,...rest}=layer;
  const source=raster||canvas(image.width,image.height);
  if(!raster)source.getContext('2d').drawImage(image,0,0);
  const blob=await new Promise(resolve=>source.toBlob(resolve,'image/png'));
  if(!blob)throw Error('레이어 이미지를 저장하지 못했어요.');
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
  let originalData;
  if(layer.projection){const original=canvas(image.width,image.height);original.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>original.toBlob(resolve,'image/png'));originalData=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});}
  return {...rest,data,...(originalData?{originalData}: {})};
}
export function cloneLayers(rows){return rows.map(row=>{const copy={...row};if(row.raster){copy.raster=canvas(row.raster.width,row.raster.height);copy.raster.getContext('2d').drawImage(row.raster,0,0);}return copy;});}
export async function restoreLayers(rows) {
  if (!Array.isArray(rows) || rows.length > 40) throw Error('텍스처당 레이어는 최대 40개예요.');
  const result = [];
  for (const value of rows) {
    if (!['image', 'paint'].includes(value.kind) || !['source-over', 'multiply', 'screen', 'overlay', 'copy'].includes(value.blend)) throw Error('지원하지 않는 레이어 형식이에요.');
    if (!value.data?.startsWith('data:image/png;base64,')) throw Error('레이어 이미지 형식이 올바르지 않아요.');
    for (const key of ['opacity', ...(value.kind === 'image' ? ['x', 'y', 'scale', 'rotation'] : [])]) {
      if (!Number.isFinite(value[key])) throw Error('레이어 좌표가 올바르지 않아요.');
    }
    if (value.opacity < 0 || value.opacity > 1 || (value.kind === 'image' && (value.scale <= 0 || value.scale > 10))) throw Error('레이어 값이 허용 범위를 벗어났어요.');
    const decoded = await imageFromURL(value.data), {data, originalData, ...row} = value;
    if(row.projection){
      const p=row.projection;
      if(row.kind!=='image'||!originalData?.startsWith('data:image/png;base64,')||!['origin','normal','cameraUp'].every(k=>Array.isArray(p[k])&&p[k].length===3&&p[k].every(Number.isFinite))||typeof p.meshName!=='string'||!Number.isFinite(p.maxAngle)||!Number.isFinite(p.depth))throw Error('이미지 투영 설정이 올바르지 않아요.');
      row.image=await imageFromURL(originalData);row.raster=canvas(decoded.width,decoded.height);row.raster.getContext('2d').drawImage(decoded,0,0);
    }
    else if (row.kind === 'image') row.image = decoded;
    else { row.raster = canvas(decoded.width, decoded.height); row.raster.getContext('2d').drawImage(decoded, 0, 0); }
    result.push(row);
  }
  return result;
}
export function imageBounds(doc, layer) {
  return {x: layer.x * doc.base.width, y: layer.y * doc.base.height};
}
