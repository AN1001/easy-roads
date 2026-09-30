// Matrix multiply: writing into a reused matrix vs allocating a new one each call.
// Run with:  node bench/math.mjs
// Add --trace-gc to see every garbage collection pause.

import * as m from '../math.js';

const N = 5_000_000;
const a = m.rotationX(m.mat4(), 0.3);
const b = m.rotationY(m.mat4(), 0.4);
const out = m.mat4();

// The old allocating version, kept here for comparison.
function allocMultiply(a, b) {
  const o = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      o[col * 4 + row] = sum;
    }
  }
  return o;
}

let sink = 0;  // stops V8 optimising the work away

function time(fn) {
  const start = performance.now();
  fn();
  return ((performance.now() - start) * 1e6 / N).toFixed(1) + ' ns';
}

for (let round = 1; round <= 3; round++) {
  const reuse = time(() => { for (let i = 0; i < N; i++) sink += m.multiply(out, a, b)[0]; });
  const alloc = time(() => { for (let i = 0; i < N; i++) sink += allocMultiply(a, b)[0]; });
  const bare  = time(() => { for (let i = 0; i < N; i++) sink += new Float32Array(16).length; });
  console.log(`round ${round}: reuse ${reuse} | alloc ${alloc} | new Float32Array(16) ${bare}`);
}
