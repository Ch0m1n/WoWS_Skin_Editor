// Connect surface samples only when their triangles share a continuous UV edge.
const wrapped = n => ((n % 1) + 1) % 1;
export function continuousSurface(a, b) {
  if (!a?.uv || !b?.uv || a.object !== b.object) return false;
  for (const axis of ['x', 'y']) {
    const raw = b.uv[axis] - a.uv[axis];
    if (Math.abs(wrapped(b.uv[axis]) - wrapped(a.uv[axis]) - raw) > 1e-5) return false;
  }
  if (a.faceIndex === b.faceIndex) return true;
  if (!a.face || !b.face) return false;
  const position = a.object.geometry.getAttribute('position'), uv = a.object.geometry.getAttribute('uv');
  if (!position || !uv) return false;
  const near = (attribute, i, j, dimensions) => dimensions.every(axis => Math.abs(attribute['get'+axis](i) - attribute['get'+axis](j)) < 1e-6);
  let shared = 0;
  for (const i of [a.face.a, a.face.b, a.face.c]) {
    if ([b.face.a, b.face.b, b.face.c].some(j => near(position,i,j,['X','Y','Z']) && near(uv,i,j,['X','Y']))) shared++;
  }
  return shared >= 2;
}
