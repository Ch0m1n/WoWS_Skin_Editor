import * as THREE from './vendor/three/build/three.module.js';
import {projectImage} from './projection.js';
const meshes=new Map();
self.onmessage=event=>{
  const {id,geometry,targets,image,width,height,options}=event.data;
  try{
    for(const data of geometry){
      const g=new THREE.BufferGeometry();
      for(const [name,a] of Object.entries(data.attributes))g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize));
      if(data.index)g.setIndex(new THREE.BufferAttribute(data.index,1));g.groups=data.groups;
      const mesh=new THREE.Mesh(g);mesh.matrixAutoUpdate=false;meshes.set(data.id,mesh);
    }
    const output=new OffscreenCanvas(width,height),context=output.getContext('2d');
    let source=image;
    if(options.flip){const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.translate(image.width,0);ctx.scale(-1,1);ctx.drawImage(image,0,0);source=c;}
    const vector=a=>new THREE.Vector3().fromArray(a);
    const args={...options,image:source,context,point:vector(options.point),normal:vector(options.normal),cameraUp:vector(options.cameraUp)};
    let count=0;
    for(const target of targets){
      const mesh=meshes.get(target.id);mesh.matrix.fromArray(target.matrix);mesh.matrixWorld.copy(mesh.matrix);
      count+=projectImage({...args,mesh,materialIndex:target.materialIndex});
      if(options.mirror){const point=args.point.clone(),normal=args.normal.clone();point.x=2*options.centerX-point.x;normal.x*=-1;count+=projectImage({...args,mesh,materialIndex:target.materialIndex,point,normal,rotation:-args.rotation});}
    }
    const bitmap=output.transferToImageBitmap();self.postMessage({id,count,bitmap},[bitmap]);
  }catch(error){self.postMessage({id,error:error.message});}
  finally{image.close();}
};
