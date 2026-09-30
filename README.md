# Easy Roads

A calm drive through a rainy bamboo forest at dusk, in a PS1 style. Raw WebGL2, plain ES modules,
no engine and no build step: endless procedural land and lanes (`terrain.js`), a small rigid-body
physics engine (`physics.js`, `car.js`), and textures made in code (`textures.js`).

**Controls:** arrows or WASD to drive, Space handbrake, R back on the wheels, T tow to the nearest
road, F full screen.

**Run it:** `python3 -m http.server 8001` in this folder, then open http://localhost:8001.
Add `?profile` for frame and GPU timings.

**Deploy (Cloudflare Pages):** build command `sh build.sh`, build output directory `dist`.

`NOTES.md` has the design, the measurements and what's left to do. The car and wheel models are
from GGBotNet's PSX Style Cars (CC0).
