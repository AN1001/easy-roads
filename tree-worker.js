// Makes the cherry and maple trees' models off the main thread, for main.js (trees.js's treeModel):
// each message is a tree to make (`detailed`: its near model too), and a number for it; the answer,
// that number and the model, its arrays handed over (transferred, not copied).

import { treeModel } from './trees.js';

onmessage = ({ data }) => {
  const model = treeModel(data.tree, data.detailed);
  postMessage({ id: data.id, ...model }, [model.vertices.buffer, model.indices.buffer]);
};
