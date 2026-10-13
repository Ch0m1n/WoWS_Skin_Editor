import {BufferGeometry,BufferAttribute} from './vendor/three/build/three.module.js';
import {MeshBVH} from './vendor/three-mesh-bvh/index.module.js';
self.onmessage=({data})=>{
  try{const result=data.map(item=>{const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(item.position,3));if(item.index)g.setIndex(new BufferAttribute(item.index,1));g.groups=item.groups;const tree=new MeshBVH(g,{indirect:true,targetLeafSize:12});return MeshBVH.serialize(tree);});self.postMessage({result});}
  catch(error){self.postMessage({error:error.message});}
};
