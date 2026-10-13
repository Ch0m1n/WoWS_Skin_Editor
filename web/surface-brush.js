import * as THREE from 'three';
import {canvas} from './document.js';
import {paintStroke} from './brush.js';
import {uvAttribute,vertexUV} from './texture-uv.js';

// Paint the same camera-space footprint onto each visible triangle. UV islands
// remain separate; a steep step receives the projection, rather than a UV circle.
export function createSurfaceBrush({camera,renderer,pick,commit}) {
  const scratch=canvas(1,1);
  let gesture=null;
  const project=(p,mesh,rect)=>{const v=p.clone().applyMatrix4(mesh.matrixWorld).project(camera);return{x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2,z:v.z};};
  function triangle(mesh,index,doc,rect){
    const g=mesh.geometry,ids=[0,1,2].map(n=>g.index?g.index.getX(index*3+n):index*3+n);
    const world=ids.map(i=>new THREE.Vector3().fromBufferAttribute(g.attributes.position,i));
    const screen=world.map(p=>project(p,mesh,rect));
    const group=g.groups.find(group=>index*3>=group.start&&index*3<group.start+group.count),material=[].concat(mesh.material)[group?.materialIndex||0];if(!uvAttribute(mesh,material))return null;
    const uv=ids.map(i=>{const p=vertexUV(mesh,material,i);return {x:p.x*doc.base.width,y:(doc.flipY?1-p.y:p.y)*doc.base.height};});
    const a=screen[0],b=screen[1],c=screen[2],det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
    if(Math.abs(det)<1e-7||screen.some(p=>p.z<-1||p.z>1))return null;
    const dx1=b.x-a.x,dy1=b.y-a.y,dx2=c.x-a.x,dy2=c.y-a.y;
    const u1=uv[1].x-uv[0].x,u2=uv[2].x-uv[0].x,v1=uv[1].y-uv[0].y,v2=uv[2].y-uv[0].y;
    const A=(u1*dy2-u2*dy1)/det,C=(u2*dx1-u1*dx2)/det,B=(v1*dy2-v2*dy1)/det,D=(v2*dx1-v1*dx2)/det;
    return {screen,uv,world,A,B,C,D,E:uv[0].x-A*a.x-C*a.y,F:uv[0].y-B*a.x-D*a.y};
  }
  function start(hit,doc,size){
    gesture={};const rect=renderer.domElement.getBoundingClientRect(),tri=triangle(hit.object,hit.faceIndex,doc,rect);
    const scale=tri?Math.sqrt(Math.abs(tri.A*tri.D-tri.B*tri.C)):0;
    gesture.size=Math.max(1,Math.min(300,scale>1e-7?size/scale:size));
    return gesture.size;
  }
  function paint(row,doc,start,end,options){
    if(!gesture)return;
    const rect=renderer.domElement.getBoundingClientRect(),r=gesture.size/2+1;
    const bounds={left:Math.min(start.x,end.x)-r,right:Math.max(start.x,end.x)+r,top:Math.min(start.y,end.y)-r,bottom:Math.max(start.y,end.y)+r};
    const left=(bounds.left-rect.left)/rect.width*2-1,right=(bounds.right-rect.left)/rect.width*2-1;
    const top=1-(bounds.top-rect.top)/rect.height*2,bottom=1-(bounds.bottom-rect.top)/rect.height*2;
    const crop=new THREE.Matrix4().set(2/(right-left),0,0,-(right+left)/(right-left),0,2/(top-bottom),0,-(top+bottom)/(top-bottom),0,0,1,0,0,0,0,1);
    for(const mesh of doc.meshes){
      if(!mesh.visible)continue;
      const g=mesh.geometry,matrix=crop.clone().multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld);
      const frustum=new THREE.Frustum().setFromProjectionMatrix(matrix);
      const samples=new Map();
      const visit=index=>{
        const group=g.groups.find(group=>index*3>=group.start&&index*3<group.start+group.count),mat=[].concat(mesh.material)[group?.materialIndex||0];
        if(mat?.userData.docKey!==doc.key)return;
        const tri=triangle(mesh,index,doc,rect);if(!tri)return;
        if(Math.max(...tri.screen.map(p=>p.x))<bounds.left||Math.min(...tri.screen.map(p=>p.x))>bounds.right||Math.max(...tri.screen.map(p=>p.y))<bounds.top||Math.min(...tri.screen.map(p=>p.y))>bounds.bottom)return;
        const corners=[[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.right,bounds.bottom],[bounds.left,bounds.bottom]].map(([x,y])=>({x:tri.A*x+tri.C*y+tri.E,y:tri.B*x+tri.D*y+tri.F}));
        // Split wrapped triangles into texture tiles instead of bridging their UVs.
        const minTileX=Math.floor(Math.min(...tri.uv.map(p=>p.x))/doc.base.width),maxTileX=Math.ceil(Math.max(...tri.uv.map(p=>p.x))/doc.base.width)-1;
        const minTileY=Math.floor(Math.min(...tri.uv.map(p=>p.y))/doc.base.height),maxTileY=Math.ceil(Math.max(...tri.uv.map(p=>p.y))/doc.base.height)-1;
        if(maxTileX-minTileX>4||maxTileY-minTileY>4)return;
        for(let tx=minTileX;tx<=maxTileX;tx++)for(let ty=minTileY;ty<=maxTileY;ty++){
          const ox=tx*doc.base.width,oy=ty*doc.base.height;
          const x=Math.max(0,Math.floor(Math.max(Math.min(...corners.map(p=>p.x)),Math.min(...tri.uv.map(p=>p.x)))-ox-1));
          const y=Math.max(0,Math.floor(Math.max(Math.min(...corners.map(p=>p.y)),Math.min(...tri.uv.map(p=>p.y)))-oy-1));
          const right=Math.min(doc.base.width,Math.ceil(Math.min(Math.max(...corners.map(p=>p.x)),Math.max(...tri.uv.map(p=>p.x)))-ox+1));
          const bottom=Math.min(doc.base.height,Math.ceil(Math.min(Math.max(...corners.map(p=>p.y)),Math.max(...tri.uv.map(p=>p.y)))-oy+1));
          if(right<=x||bottom<=y)continue;
          scratch.width=right-x;scratch.height=bottom-y;const ctx=scratch.getContext('2d'),center=tri.uv.reduce((v,p)=>({x:v.x+p.x/3,y:v.y+p.y/3}),{x:0,y:0});
          ctx.beginPath();tri.uv.forEach((p,i)=>{const dx=p.x-center.x,dy=p.y-center.y,n=Math.hypot(dx,dy)||1;ctx[i?'lineTo':'moveTo'](p.x+dx/n*.75-ox-x,p.y+dy/n*.75-oy-y);});ctx.closePath();ctx.clip();
          ctx.setTransform(tri.A,tri.B,tri.C,tri.D,tri.E-ox-x,tri.F-oy-y);
          paintStroke(ctx,end.x,end.y,start,{...options,size:gesture.size,erase:false});ctx.setTransform(1,0,0,1,0,0);
          // Test the covered screen samples, rather than the triangle centroid.
          const pixels=ctx.getImageData(0,0,scratch.width,scratch.height),det=tri.A*tri.D-tri.B*tri.C;
          for(let py=0;py<scratch.height;py++)for(let px=0;px<scratch.width;px++){
            const alpha=(py*scratch.width+px)*4+3;if(!pixels.data[alpha])continue;
            const u=px+.5+ox+x-tri.E,v=py+.5+oy+y-tri.F,sx=(tri.D*u-tri.C*v)/det,sy=(tri.A*v-tri.B*u)/det;
            const sampleX=Math.round(sx),sampleY=Math.round(sy),key=sampleX+':'+sampleY;
            if(!samples.has(key))samples.set(key,pick({clientX:sampleX,clientY:sampleY}));
            const hit=samples.get(key);if(!hit||hit.object!==mesh||hit.faceIndex!==index)pixels.data[alpha]=0;
          }
          ctx.putImageData(pixels,0,0);
          commit(row,scratch,{x,y,w:right-x,h:bottom-y},options.erase);
        }
      };
      if(g.boundsTree)g.boundsTree.shapecast({intersectsBounds:box=>frustum.intersectsBox(box),intersectsTriangle:(_,index)=>{visit(index);return false;}});
      else for(let i=0;i<(g.index?.count||g.attributes.position.count)/3;i++)visit(i);
    }
  }
  return {start,paint};
}
