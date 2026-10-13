// Metadata snapshots share immutable image/raster references. Painting journals only touched tiles.
export const snapshot=(doc,active)=>({key:doc.key,active,layers:doc.layers.map(row=>({...row,projection:row.projection?structuredClone(row.projection):undefined})),patches:new Map()});
export function capturePaint(entry,row,region){
  if(!entry||!entry.layers.some(old=>old.id===row.id&&old.raster===row.raster))return;
  const c=row.raster,ctx=c.getContext('2d'),tile=128;
  const x0=Math.max(0,Math.floor(region.x/tile)*tile),y0=Math.max(0,Math.floor(region.y/tile)*tile),right=Math.min(c.width,region.x+region.w),bottom=Math.min(c.height,region.y+region.h);
  for(let y=y0;y<bottom;y+=tile)for(let x=x0;x<right;x+=tile){const key=row.id+':'+x+':'+y;if(entry.patches.has(key))continue;const w=Math.min(tile,c.width-x),h=Math.min(tile,c.height-y);entry.patches.set(key,{id:row.id,canvas:c,x,y,data:ctx.getImageData(x,y,w,h)});}
}
export function restoreSnapshot(entry,doc,active){
  const inverse=snapshot(doc,active);
  for(const [key,patch] of entry.patches){const ctx=patch.canvas.getContext('2d');inverse.patches.set(key,{...patch,data:ctx.getImageData(patch.x,patch.y,patch.data.width,patch.data.height)});ctx.putImageData(patch.data,patch.x,patch.y);}
  doc.layers=entry.layers.map(row=>({...row,projection:row.projection?structuredClone(row.projection):undefined}));return inverse;
}
export const historyBytes=entry=>[...entry.patches.values()].reduce((sum,p)=>sum+p.data.data.byteLength,0);
