import {MeshBVH,acceleratedRaycast} from './vendor/three-mesh-bvh/index.module.js';
export async function accelerateMeshes(meshes){
  const geometries=[...new Set(meshes.filter(m=>!m.isSkinnedMesh).map(m=>m.geometry))];
  const data=geometries.map(g=>{const p=g.attributes.position;let position;if(p.isInterleavedBufferAttribute){position=new Float32Array(p.count*3);for(let i=0;i<p.count;i++)position.set([p.getX(i),p.getY(i),p.getZ(i)],i*3);}else position=p.array.slice();return{position,index:g.index?.array.slice(),groups:g.groups};});
  const worker=new Worker('/bvh-worker.js',{type:'module'});
  try{const result=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.onerror=e=>reject(Error(e.message));worker.postMessage(data,data.flatMap(x=>[x.position.buffer,...(x.index?[x.index.buffer]:[])]));});
    geometries.forEach((g,i)=>{g.boundsTree=MeshBVH.deserialize(result[i],g,{setIndex:false});});
    for(const mesh of meshes)if(mesh.geometry.boundsTree&&!mesh.isSkinnedMesh)mesh.raycast=acceleratedRaycast;
  }finally{worker.terminate();}
}
