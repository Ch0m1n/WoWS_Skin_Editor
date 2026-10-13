import {OBJLoader} from './vendor/three/examples/jsm/loaders/OBJLoader.js';
self.onmessage = event => {
  try {
    const object = new OBJLoader().parse(event.data), meshes = [], transfers = [];
    object.traverse(mesh => {
      if (!mesh.isMesh) return;
      const attributes = {};
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        attributes[name] = {array: attribute.array, itemSize: attribute.itemSize}; transfers.push(attribute.array.buffer);
      }
      meshes.push({name: mesh.name, attributes, groups: mesh.geometry.groups,
        materials: [].concat(mesh.material).map(material => material.name)});
    });
    self.postMessage({meshes}, transfers);
  } catch (error) { self.postMessage({error: error.message}); }
};
