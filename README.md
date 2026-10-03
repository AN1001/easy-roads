# Easy Roads

A calm drive through a rainy bamboo forest at dusk, in a PS1 style. Raw WebGL2, plain ES modules,
no engine and no build step: endless procedural land, lanes, rivers, timber bridges and groups of cherry, broadleaf and maple trees, and ferns, bushes (some in flower) and rocks, all made in code (`terrain.js`, `bridges.js`, `trees.js`, `nature.js`), a small rigid-body
physics engine (`physics.js`, `car.js`), and textures made in code (`textures.js`).

**Controls:** arrows or WASD to drive, Space handbrake, R back on the wheels, T tow to the nearest
road, F full screen, M sound on and off, H the controls hint. On a phone or tablet, one joystick:
put a thumb down anywhere and drag (up drives, down brakes and reverses, sideways steers). The first
touch goes full screen where the browser allows; on an iPhone, add it to the home screen for that.

**Run it:** `python3 -m http.server 8001` in this folder, then open http://localhost:8001.
Add `?profile` for frame and GPU timings. `node bench/relief.mjs map.png` draws a top-down map.

**Deploy (Cloudflare Pages):** build command `sh build.sh`, build output directory `dist`.

`NOTES.md` has the design, the measurements and what's left to do. The car and wheel models are
from GGBotNet's PSX Style Cars (CC0), and the engine's sound from the same author's car sound
effects (CC0); the rest of the sound is made in code.
