// The functions taking the most time in a CPU profile (node --cpu-prof, or bench/headless.mjs's
// profileFile): self time (their own, not what they call) and total (with what they call), in ms
// over the profile, or a frame if the number of frames is given.
//
//   node bench/cpuprofile.mjs <file.cpuprofile> [frames] [how many]

import { readFileSync } from 'fs';

const [file, frames = 1, top = 40] = process.argv.slice(2);
const { nodes, samples, timeDeltas } = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(nodes.map(node => [node.id, node])), parent = new Map();
for (const node of nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const name = node => {
  const { functionName, url, lineNumber } = node.callFrame;
  return `${functionName || '(anonymous)'} ${url.split('/').pop()}${url ? `:${lineNumber + 1}` : ''}`;
};
const self = new Map(), total = new Map();
samples.forEach((id, k) => {
  const ms = (timeDeltas[k] ?? 0) / 1000;
  self.set(name(byId.get(id)), (self.get(name(byId.get(id))) ?? 0) + ms);
  const seen = new Set();  // a function counted once per sample, however deep it recurses
  for (let n = id; n !== undefined; n = parent.get(n)) {
    const key = name(byId.get(n));
    if (seen.has(key)) continue;
    seen.add(key);
    total.set(key, (total.get(key) ?? 0) + ms);
  }
});
const per = Number(frames);
console.log(`${file}: ms${per > 1 ? ' a frame' : ''}, self / total`);
for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) {
  console.log(`  ${(ms / per).toFixed(3).padStart(8)} ${(total.get(key) / per).toFixed(3).padStart(8)}  ${key}`);
}
