import * as THREE from './vendor/three/build/three.module.js';

// Bake a planar image into the hit mesh's original UVs. No added overlay geometry:
// the preview and exported texture use the same pixels.
export function projectImage({mesh, materialIndex, image, context, point, normal, width, rotation, cameraUp, maxAngle = 75, depth = .35, flipY = true}) {
  const up = cameraUp.clone().addScaledVector(normal, -cameraUp.dot(normal)).normalize();
  if (up.lengthSq() < .1) up.set(0, 0, 1).addScaledVector(normal, -normal.z).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  up.applyAxisAngle(normal, rotation); right.applyAxisAngle(normal, rotation);
  const height = width * image.height / image.width;
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
  if (!uv) throw Error('이 부품에는 UV 좌표가 없어요.');
  mesh.updateWorldMatrix(true, false);
  const idx = g.index, count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), delta = new THREE.Vector3();
  const tw = context.canvas.width, th = context.canvas.height;
  let painted = 0;
  for (let n = 0; n < count; n += 3) {
    if (g.groups.length && !g.groups.some(group => n >= group.start && n < group.start + group.count && group.materialIndex === materialIndex)) continue;
    const ids = [0, 1, 2].map(j => idx ? idx.getX(n + j) : n + j);
    a.fromBufferAttribute(pos, ids[0]).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, ids[1]).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, ids[2]).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(b, a); ac.subVectors(c, a);
    if (ab.cross(ac).normalize().dot(normal) < Math.cos(maxAngle * Math.PI / 180)) continue;
    const projected = [a, b, c].map(v => {
      delta.subVectors(v, point);
      return [(delta.dot(right) / width + .5) * image.width, (.5 - delta.dot(up) / height) * image.height, delta.dot(normal)];
    });
    // Keep the projection near the hit surface, not distant parallel parts.
    if (projected.every(v => Math.abs(v[2]) > width * depth)) continue;
    if ([0, 1].some(axis => projected.every(v => v[axis] < 0) || projected.every(v => v[axis] > (axis ? image.height : image.width)))) continue;
    const target = ids.map(i => [uv.getX(i) * tw, (flipY ? 1 - uv.getY(i) : uv.getY(i)) * th]);
    const [s, t, u] = projected, [p, q, r] = target;
    const dx1 = t[0] - s[0], dy1 = t[1] - s[1], dx2 = u[0] - s[0], dy2 = u[1] - s[1];
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-8) continue;
    const ax = ((q[0] - p[0]) * dy2 - (r[0] - p[0]) * dy1) / det;
    const bx = ((r[0] - p[0]) * dx1 - (q[0] - p[0]) * dx2) / det;
    const ay = ((q[1] - p[1]) * dy2 - (r[1] - p[1]) * dy1) / det;
    const by = ((r[1] - p[1]) * dx1 - (q[1] - p[1]) * dx2) / det;
    const maxU = Math.max(...target.map(v => v[0])) / tw, minU = Math.min(...target.map(v => v[0])) / tw;
    const maxV = Math.max(...target.map(v => v[1])) / th, minV = Math.min(...target.map(v => v[1])) / th;
    if (maxU - minU > 4 || maxV - minV > 4) continue;
    for (let tileX = Math.floor(minU); tileX <= Math.floor(maxU); tileX++) {
      for (let tileY = Math.floor(minV); tileY <= Math.floor(maxV); tileY++) {
        context.save(); context.beginPath(); target.forEach(([x, y], i) => context[i ? 'lineTo' : 'moveTo'](x - tileX * tw, y - tileY * th)); context.closePath(); context.clip();
        context.setTransform(ax, ay, bx, by, p[0] - ax * s[0] - bx * s[1] - tileX * tw, p[1] - ay * s[0] - by * s[1] - tileY * th);
        context.drawImage(image, 0, 0); context.restore();
      }
    }
    painted++;
  }
  return painted;
}
