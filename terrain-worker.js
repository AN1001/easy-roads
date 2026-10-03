// Builds the land's chunks off the main thread, for terrain.js (createTerrain's `worker`; main.js
// starts it, as a module worker). Each message asks for one chunk, its level and place, and may
// bring back a buffer a chunk went out in; the answer is the chunk, packed into such a buffer and
// handed over (transferred, not copied).

import { newSlot, buildChunk, packChunk, CHUNK_BYTES } from './terrain.js';

const slots = [];   // per level, one to build in
const spares = [];  // buffers to pack into
onmessage = ({ data }) => {
  if (data.spare) spares.push(data.spare);
  const slot = slots[data.level] ??= newSlot(0, data.level);
  buildChunk(slot, data.cx, data.cz);
  const bytes = spares.pop() ?? new ArrayBuffer(CHUNK_BYTES);
  postMessage(packChunk(slot, bytes), [bytes]);
};
