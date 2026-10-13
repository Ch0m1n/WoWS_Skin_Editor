import * as THREE from 'three';
export function sourceMap(material){return material?.userData.originalMap||material?.map;}
export function uvAttribute(mesh,material){const channel=sourceMap(material)?.channel||0;return mesh.geometry.attributes[channel?'uv'+channel:'uv'];}
export function vertexUV(mesh,material,index){const attribute=uvAttribute(mesh,material);if(!attribute)return null;const uv=new THREE.Vector2().fromBufferAttribute(attribute,index),map=sourceMap(material);if(map){if(map.matrixAutoUpdate)map.updateMatrix();uv.applyMatrix3(map.matrix);}return uv;}
export function hitUV(hit){
  const material=[].concat(hit.object.material)[hit.face.materialIndex||0],attribute=uvAttribute(hit.object,material);if(!attribute)return null;
  const positions=hit.object.geometry.attributes.position,local=hit.point.clone().applyMatrix4(hit.object.matrixWorld.clone().invert());
  const ids=[hit.face.a,hit.face.b,hit.face.c],vertices=ids.map(i=>new THREE.Vector3().fromBufferAttribute(positions,i));
  const bary=THREE.Triangle.getBarycoord(local,...vertices,new THREE.Vector3());if(!bary)return null;
  const uv=new THREE.Vector2();ids.forEach((i,j)=>uv.addScaledVector(new THREE.Vector2().fromBufferAttribute(attribute,i),bary.getComponent(j)));
  const map=sourceMap(material);if(map){if(map.matrixAutoUpdate)map.updateMatrix();map.transformUv(uv);if(map.flipY)uv.y=1-uv.y;}return uv;
}
