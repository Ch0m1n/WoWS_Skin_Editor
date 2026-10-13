let worker,sequence=0;
let known=new WeakSet();const pending=new Map();
export function resetProjectionBaker(){worker?.terminate();worker=null;known=new WeakSet();for(const request of pending.values())request.reject(Error('Model changed'));pending.clear();}
export async function bakeProjection(image,meshes,doc,options){
  if(!worker){worker=new Worker('/projection-worker.js',{type:'module'});worker.onmessage=({data})=>{const request=pending.get(data.id);pending.delete(data.id);if(!request){data.bitmap?.close();return;}data.error?request.reject(Error(data.error)):request.resolve(data);};worker.onerror=error=>{for(const request of pending.values())request.reject(Error(error.message));pending.clear();};}
  const geometry=[],targets=[];
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    if(!known.has(mesh)){
      const g=mesh.geometry,attributes={};for(const name of ['position','uv'])if(g.attributes[name]){
        const a=g.attributes[name];let array=a.array;
        if(a.isInterleavedBufferAttribute){array=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.getComponent(i,j);}
        attributes[name]={array,itemSize:a.itemSize};
      }
      geometry.push({id:mesh.uuid,attributes,index:g.index?.array,groups:g.groups});
    }
    for(const [materialIndex,material] of [].concat(mesh.material).entries())if(material.userData.docKey===doc.key)targets.push({id:mesh.uuid,matrix:mesh.matrixWorld.toArray(),materialIndex});
  }
  const bitmap=await createImageBitmap(image),id=++sequence;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,geometry,targets,image:bitmap,width:doc.base.width,height:doc.base.height,options},[bitmap]);for(const mesh of meshes)known.add(mesh);});
}
