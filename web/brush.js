import {canvas} from './document.js';
const stamps=new Map();
export function paintStroke(ctx,x,y,previous,{size,color,hardness,opacity,spacing,erase}){
  ctx.save();ctx.globalCompositeOperation=erase?'destination-out':'source-over';ctx.globalAlpha=opacity;
  if(hardness>=.999&&opacity>=.999&&spacing<=.15){ctx.fillStyle=ctx.strokeStyle=color;ctx.lineWidth=size;ctx.lineCap=ctx.lineJoin='round';if(previous){ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(x,y);ctx.stroke();}ctx.beginPath();ctx.arc(x,y,size/2,0,Math.PI*2);ctx.fill();}
  else{
    const key=size+':'+color+':'+hardness;let stamp=stamps.get(key);
    if(!stamp){stamp=canvas(size+4,size+4);const s=stamp.getContext('2d'),r=size/2,c=size/2+2,gradient=s.createRadialGradient(c,c,r*hardness,c,c,r);gradient.addColorStop(0,color);gradient.addColorStop(1,'transparent');s.fillStyle=gradient;s.fillRect(0,0,stamp.width,stamp.height);if(stamps.size>24)stamps.clear();stamps.set(key,stamp);}
    const start=previous||{x,y},distance=Math.hypot(x-start.x,y-start.y),steps=previous?Math.max(1,Math.ceil(distance/Math.max(1,size*spacing))):0;
    for(let i=previous?1:0;i<=steps;i++){const f=steps?i/steps:0;ctx.drawImage(stamp,start.x+(x-start.x)*f-stamp.width/2,start.y+(y-start.y)*f-stamp.height/2);}
  }
  ctx.restore();
}
