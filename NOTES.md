# Easy Roads: optimisation notes

A running log of what we've learned, what we've measured, and what's still to do.
Rule of thumb: **measure first, then optimise the thing the numbers point at.**
Worst-case frame time matters as much as the average: one late frame is a visible hitch.

## Target machine

| | |
|---|---|
| Computer | MacBook Pro, Intel Core i5-8279U (4 cores, 2.4 GHz), 8 GB RAM, macOS 15.7 |
| GPU | Intel Iris Plus Graphics 655 (integrated, shares system memory) |
| Displays | Built-in Retina 2560×1600 + ultrawide 3440×1440 @ **50 Hz** |
| Frame budget | 20 ms per frame at 50 Hz (16.7 ms at 60 Hz) |
| Power | Profiles so far ran on battery (79% → 71%), no thermal throttling |

## Why web 3D lags on this machine

- **Pixel count, not scene complexity.** A PS3 game rendered ~1280×720 = 0.9 M pixels.
  Fullscreen on the ultrawide is 3440×1440 = **5 M pixels**, and the Retina panel is 4 M.
  Every pixel costs GPU time (measured below: ~1.2 ms per million pixels with antialiasing),
  and integrated GPUs are weakest at exactly this (fill rate).
- **Compositing overhead.** Getting a frame onto the screen costs the browser's GPU process
  and macOS's WindowServer real work every frame, on top of our own rendering (measured below).
- **Thermal throttling:** Intel MacBook Pros slow down under sustained load.
- **Two displays** share the same GPU and memory bandwidth.
- **Stutter** (as opposed to low FPS) comes from terrain generated on the main thread,
  shaders compiling mid-game, garbage-collection pauses, and compositor hiccups.

## What made PS2/PS3 games look good

Mostly art direction and faking things, not bitwise tricks:
baked lighting (vertex colours/lightmaps), fog, limited draw distance, hand-painted
textures, skyboxes and billboards for distant things, low resolution, and strict
polygon/texture budgets. Their low-level tricks mostly worked around tiny memory
(PS2: 32 MB RAM, 4 MB VRAM), which this machine doesn't have.

## The look: PS1, a rainy night in a bamboo forest (night until 28 Sep 2026, dusk until 1 Oct 2026)

Misty, pixelated, low-poly. What makes it, and where it lives:

| Ingredient | Setting | Where |
|---|---|---|
| **Very low resolution**, upscaled in sharp blocks | ~360 rows when fullscreen; block size set by the screen, not the window, and a whole number of screen pixels (5 on the Retina laptop, 4 on the ultrawide); `image-rendering: pixelated` | `main.js` (`FULLSCREEN_ROWS`), `style.css` |
| **5-bit colour + ordered dithering** | 32 levels per channel (PS1), 4×4 Bayer pattern | `dither()` in `shaders/dither.glsl`, used by every lit fragment shader |
| **Mist** | Its own colour, darker and greener than the sky: a slate grey, (6.5, 7.5, 8)/31, with half the sky's warmth in the west, so what it hides reads as more forest in the mist, not as sky showing through (29 Sep 2026: the horizon's pale blue-grey before, which made the end of the land and the gaps past the bamboo look like open sky). From 200 m it pales, a quarter of the way to the horizon's colour by 400 m, so the furthest ridges stand out as fainter layers. None within 10 m; beyond, it thickens as real mist does (each 140 m hides about two thirds of what's behind), scaled to be all mist at 400 m, where the land stops being drawn. Up to half as much again low down (from 5 m above the roads' average level to 25 m below), so it lies in the valleys. (Was navy fog, 80–400 m, a smoothstep) | `main.js` (`FOG_*`), `sky.glsl` (`MIST`, `HAZE`, `mistColor`, `mist`) |
| **Sky** | Overcast: brightest at the horizon, darker overhead, a warm glow low in the west that fades within ~10° up. Low clouds drift over it on the wind (a texture on a plane 300 m up, twice over at two sizes for ragged edges), darker where thick, lighter in the gaps, sinking into the haze towards the horizon. Below it, all the way round, a treeline: more misty forest past the land, 0.2–2.6° up in swells and bumps (the clouds' texture read round two circles), in the colour the mist reaches at 400 m. Drawn last, at the far plane, wherever nothing else is | `sky.vert`, `sky.frag`, `skyColor` in `sky.glsl`, clouds in `textures.js` |
| **Dusk light** | Overcast: a blue-grey sky from above, a dim green bounce from the forest below, a little afterglow from the west; the warm headlight cone as before (full within ~18°, gone past ~32°, half brightness at 15 m). No moon | `dusk()` and `headlight()` in `sky.glsl`, lamp position in `main.js` |
| **Forest country** | Endless and procedural, smooth-shaded: rolling hills, long rounded ridges (20–60 m above the shallow valleys) and smaller spurs off them; nothing steeper than ~55°. Bamboo in groves, thick over about two fifths of the land, with clearings over about a fifth; the ground darker under it. The lanes rise and fall with the land (in some places following the hills closely, in others keeping lower and flatter), so they climb over crests and dip into hollows rather than running along canyon floors. Far off (80–150 m), past the bamboo that's drawn, the groves are tinted as its tops. A network of dirt lanes: main ones 6.5 m wide, the rest 5.5 m (6 and 5 until 30 Sep 2026, then 8 and 7 for a day), east-west, north-south and diagonal; junctions rare (every ~2.2 km of road): T, Y and crossroads. No roundabouts. The lanes wind gently between junctions (the rally stages of 29-30 Sep 2026, with tight corners and crests to jump, were reverted on 30 Sep) | `terrain.js`, `terrain.frag` |
| **Bamboo** | Stalks 7–15 m tall and 7–16 cm across, planted on a 1.5 m grid by how thick the grove is, none within 1 m of a lane and thinner up to 5 m from it; leaning a little, and out over the lanes. Green to yellowish, ringed at the nodes (every 31–44 cm: a pale ridge, the sheath's dark scar, a whitish band of wax), some with lichen; wet, so their edges shine. Leaves from 45% of the way up: sprays of narrow leaves drooping from twigs, see-through between them by the dither. A breeze sways them, gusts sweeping across the groves; the car and the camera push them aside rather than hitting them, and those the car pushed spring back up slowly (half way in 1 s, 90% in 2 s). Near (within 26–34 m, each at its own distance, dissolving from one to the other over 4 m): 5-sided tubes, 3 crossed leaf cards; further: 1-pixel lines, one card facing the camera with a picture of the crossed cards on it ("strands"); from 180–200 m (each 6 m square at its own distance, its stalks dissolving into its clump over 20 m, in 75-80% mist) to the mist's end at 400 m, clumps: one card facing the camera for each 6 m square where bamboo grows (and more than 3 m from a lane), a picture of a clump of stalks and leaves | `terrain.js` (`grove`, `plantBamboo`, `plantClumps`), `bamboo.js`, `bamboo.glsl`, `stalk.*`, `leaves.*`, `clump.*`, `textures.js` |
| **Rain** | 5,000 streaks, each the line a drop falls in 1/25 s, in a 40 × 20 × 40 m box round the camera that they wrap round: fixed in the world, so driving passes through them. Pale, see-through by the dither; not lit by the headlight (1 Oct 2026: at night the drops crossing its beam flickered). On the puddles, rings spread (the droplets splashing up round the car, 160 a second, were taken out on 1 Oct 2026: they flickered in the headlight) | `rain.*`, `particles.js` (`rainOnGround`), `ripple` in `terrain.frag` |
| **Sandy dirt roads** | Pale damp sand, darker where it's wetter, with a few puddles (one wettest patch in ten: ~0.5% of it, about one every 200 m; a tenth of it until 29 Sep 2026) that reflect the sky (its colour the way the reflection looks), a third looking down into them and almost all of it at a glancing angle (Fresnel), so the lane shines further off; wet sand does too, much less. Far off, a puddle fades into a glint (its texture's mipmaps: the share of a pixel it covers). The rain rings them: in each half-metre square a drop lands about once a second, and a ring spreads and fades, turning the reflection round (bright rings on a dark puddle up close, dark on a shining one further off). The edge frays into grass: wandering ±0.5 m (noise, baked into the vertex), blended over 0.8 m and pushed in and out by the grass's tufts; then grass to forest floor 2.5–3.5 m out. No markings | `terrain.js` (`FRAY`), `terrain.frag`, `textures.js` |
| **Textures** | Nine layers of 128 × 128, made in code at startup. The ground's four are tiles at 8 texels per metre (16 m across): the bank (earth with stones bedded in it, lit on top and shadowed below, runs of wet and moss) hangs on slopes with its rows level; the floor has fallen leaves 2-3 texels long, dry and pale or dark and wet, and moss; grass is clumps of blades, with tufts in its alpha; sand has grit and pebbles, and how wet it is in its alpha. The bamboo's culm: 32 strips, each 4 texels round and 4 m up at 32 per metre. Its leaves: one card, the stalk up the middle; and for far stalks, a picture of three such cards crossed at 60°, seen from the side (as thick with leaves as a near stalk's). The far clumps: two pictures side by side, each 7 stalks and their leaves (as thick as a far stalk's). The clouds: their thickness in the alpha. `NEAREST` up close, mipmaps in the distance | `textures.js`, the shaders |
| **Dust, smoke and water** | Faint: earth off the road from the tyres (more from the driven back wheels, more sliding), a ring of it on a hard landing (sand, on the road), smoke from tyres sliding on the road (sand 29-30 Sep 2026, reverted), a little exhaust. Round puffs, see-through by the dither pattern (no blending), lit by the sky, the headlight and red by the tail lights. Through a puddle, water: drops thrown up and out, more the faster (a bow wave to the sides from the front tyres, up and behind from the back ones), falling back down; found where the puddles are drawn, from the puddles' texture's own texels | `particles.js`, `particles.*` shaders |
| No antialiasing, flat shading | | already in place |
| **Textured low-poly car** | "Car 03" from GGBotNet's PSX Style Cars (CC0): 336-triangle body + 4 × 28-triangle wheels, `NEAREST`, no mipmaps. Its texture is two of the model's 128 × 128 side by side (256 × 128): the faces left of the middle (+x) read the second, so the sides, and the halves of the roof, bonnet, back and front, each have their own texels (the model's left is its right mirrored) | `car.js` (`parseBody`), `obj.js`, `loadTexture` in `gl.js`, `car.frag` |
| **Green car** (rally livery 29-30 Sep 2026, then back) | The model's own dark green paint (`car3_zen.png`, `bench/livery.mjs --zen`: `car3.png` twice over, as the body's texture is laid out). No spoiler; the upright brake light in the middle of the back bumper (from the rally days) gone 1 Oct 2026 | `bench/livery.mjs`, `assets/Car 03/` |
| **Bouncy physics** | A rigid body on four sprung wheels (1.6 bounces a second, damping ratio 0.45): it bobs over bumps, leans ~4° in corners, dives ~2.5° braking, flies off crests and lands on its springs. Each wheel spins at its own speed and hangs down in the air; the front two steer (±29°, less at speed) | `physics.js`, `car.js`, wheel matrices in `main.js` |
| **Glowing tail lights** | The texture's pure reds (green and blue exactly 0) are drawn unlit: always on at their own red (1×; 0.6× until 29 Sep 2026, when they read as unlit), three times as bright braking, where the red past full burns towards orange-white (their brightest parts; their edges stay red). The upright brake light in the middle of the back bumper was removed on 1 Oct 2026 (round lamps drawn over these in `car.frag` that day were taken out again at the user's request: the texture's own lights are the ones wanted). They light nothing else | `car.frag`, `TAIL_*` in `main.js` |
| **Brake-light glow** (1 Oct 2026) | Red light from the tail lights on what's close behind the car, as a rounded pool: an oval 1.6 m across and 2.4 m back, its middle 1.3 m behind the lights, falling off as 1 / (1 + d²)² (first a cone from the lights, which the user found "too straight"). Faint driving, much stronger braking (0.06 + 0.3 × (brightness − 1)); on the road twice as strong where it's wet, and a little on the rain just behind. (The car's soft shadow, added the same day, taken out again at the user's request) | `tailGlow` in `sky.glsl`, `terrain.frag`, `rain.frag` |
| **Night** (1 Oct 2026; back to dusk 2 Oct 2026) | The same rainy forest at night: a dark blue sky (SKY (2, 3, 5)/31 at the horizon), mist darker still, the sky's light a faint blue (raised a third the same day: a little too dark), a trace of glow in the west; the headlight is most of the light. (Stars came and went the same day: in `sky.frag` at the game's resolution, then on a full-resolution canvas behind it, then in `sky.frag` again, single pixels; removed at the user's request.) The dusk values are kept in comments | `sky.glsl`, `sky.frag`, the clear colour in `main.js` |
| **Sunny day** (2 Oct 2026; back to the rainy night the same day: "doesn't really fit the aesthetic") | Night and rain saved for later, to come and go during a drive: a blue sky (SKY (20, 24, 28)/31 at the horizon, ZENITH (0.26, 0.45, 0.78)), a sun ~40° up in the west-north-west with a disc and halo, sparse white clouds (`CLEAR` 0.45 of the texture's thickness is clear sky), a pale green-grey summer haze for the mist; light from the sun (`SUN_LIGHT`), the blue sky and a bounce. No rain streaks or rain sound, a dry road (no puddles or splashes), drier bamboo sheen, the headlight off and the tail glow on the ground a quarter as strong. The switches are `uWeather` in the frame block (`RAIN`, `LIGHTS` in `main.js`); the night's and dusk's colours are kept in `sky.glsl`'s comments | `sky.glsl`, `sky.frag`, `frame.glsl`, `terrain.frag`, `stalk.vert`, `main.js`, `sound.js` |
| **Sound** (1 Oct 2026) | See "Sound, controls hint, touch controls" in Measurements | `sound.js` |

- Fully misted land matches the sky's treeline behind it exactly, with no seam: both are the mist's
  colour at its furthest, looking that way (`mistColor` at 400 m, `mistAlong(dir, 1)` in the sky),
  dithered by the same pattern. So chunks appearing or going at the land's far edge never show.
  (Until 29 Sep 2026 the mist was the sky's horizon colour, and met the sky itself.) `SKY` is an
  exact colour level (whole 31sts), so away from the glow the dither leaves it untouched.
- The headlight uses half-wrapped lighting (`0.5 + 0.5 · N·L`): physically, flat ground ahead
  is lit at a glancing angle and would barely show the beam.
- **Model scale and texel density.** Blockbench: 16 units = 1 m (its OBJ/glTF export divides by
  16). Textures at 16 texels per metre (Blockbench resolution 16, one texel per unit). Measured
  in game at 360 rows: the car is 46 px/m when parked and ~30 px/m at 20–26 m/s, because the
  camera's easing trails ~6 m further back at speed. So a texel is 2.9 px parked, ~1.8 px
  driving, and never under 1 px. 32/m would drop to ~0.9 px at speed, and with `NEAREST` and
  no mipmaps, sub-pixel texels shimmer. Revisit if the camera distance changes.
  The downloaded car is denser than that: its body texture averages **31 texels/m** and the
  wheels 58 (area-weighted, measured from the OBJ). So body texels are ~1.5 px parked and
  ~1 px at speed, and the rim detail is sub-pixel (the spinning hides it). The 16/m figure
  is for models made in Blockbench.
- **Tail lights by colour, not by a separate mask.** Every light texel is pure red; even the
  red car's paint has green ≥ 33/255. One test in the shader, no extra texture, and it works
  for all three body colours. The amber indicators and white reverse lights stay unlit. The
  rally livery's reds keep green ≥ 16/255 (`bench/livery.mjs` makes sure), so only the lights glow.
- Later: vertex snapping (PS1 wobble), affine texture warp, reverse lights and indicators. (The
  brake lights' red on the road: done 29 Sep 2026.)
- **Texel density.** The ground's 8 texels per metre (12.5 cm texels) is half the car's 16: the
  road beside the car is seen at a slant, where a texel is ~6 px across but under 2 px deep at
  360 rows, and at 16 it would be under 1 px deep and shimmer. Up close (the camera against a
  bank) the texels are big squares, as on a PS1.
- **Shared shader code.** GLSL has no includes, so `loadProgram` pastes in any
  `#include "file"` (one level deep: an included file's own includes aren't): `frame.glsl` (the
  per-frame uniform block, in every shader), `sky.glsl` (sky, mist, light, headlight; in the lit
  shaders, fragment or vertex), `dither.glsl` (the 5-bit dither; fragment shaders only, as it
  reads `gl_FragCoord`) and `bamboo.glsl` (this frame's list, loading a stalk, its lean, sway and
  bending aside; in the three bamboo vertex shaders).

## Decisions

- **Raw WebGL2, no engine.** The point is to control and understand every GPU call.
- **No build step.** Plain ES modules served by `python3 -m http.server`.
- **Our own small physics engine** (`physics.js`, ~140 lines), not a library: one rigid body,
  impulses, and the terrain as the only thing to hit. Every force is visible and tunable, and
  nothing is allocated per step. It replaced "sit the car on 4 ground samples", which felt
  glued to the ground and sank the wheels into bumps (measured below).
- **Drifting was assisted, arcade-style, for a while** (29-30 Sep 2026, heading for a rally game:
  a drift assist, all-wheel drive, rally stages, a rally livery). On 30 Sep it was all reverted to
  the zen game at the user's request: the original handling (Space a plain handbrake), the gently
  winding lanes (kept 7 m wide), the green car. What was learned is under "Measurements" (from
  "Easy drifting" to "Back to the handbrake drift"); the rally version's files are in the session's
  scratchpad (`rally_final/`), and `bench/livery.mjs` still paints the rally livery without `--zen`.
- **Endless procedural terrain, built around the camera** (`terrain.js`), instead of one fixed
  map. Everything comes from integer hashes of grid coordinates, so the same place always looks
  the same, nothing is stored, and there's no edge. The roads come first and the land is shaped
  around them: the road network is a pure function of position, and the land is flattened near
  it. (Carving roads into existing land, or finding routes through it, needs searching; this
  needs only a distance.) Each road's height along it comes from sampling the land's shape
  (without roads) along the road itself: still a pure function, so the roads can follow the
  hills without any search.
- **Grow the code only when needed.** No files or abstractions ahead of real code.
- **Models are OBJ + PNG, read by our own small parser** (`obj.js`). Text is easy to inspect
  and learn from; the car parses in ~1.2 ms at startup. Assets are CC0, in `assets/`.
- **The car's livery is a PNG made by a script** (`node bench/livery.mjs`), not painted at startup
  like the ground's textures: the game loads it as it loaded the model's own, and it can be opened
  and touched up in any image editor. The script is where to change it (its colours, the number,
  where the stickers go, how muddy), then run it again.
- **The textures are made in code** (`textures.js`), not painted: the ground's, the bamboo's and
  the clouds. Like the terrain, tunable by changing a number, with nothing to download and no build
  step. They only multiply the shaders' colours, so a painted PNG could replace any layer later.
  `node bench/textures.mjs` draws them to a PNG to look at.
- **The bamboo is made in code too** (`bamboo.js`, with `terrain.js` planting it), not a
  downloaded model (asked for, 28 Sep 2026: basic fillers first).

## Optimisations in place

| What | Where | Why |
|---|---|---|
| **Render ~360 rows fullscreen, browser upscales in blocks** | `main.js` (`FULLSCREEN_ROWS`), `style.css` | Fullscreen renders 576×360 on the laptop, 860×360 on the ultrawide: 1/16 of the pixels. Part of the look, and the stretch happens during compositing, which runs anyway. (Was a 720-row cap: 1720×720) |
| **Antialiasing off** | `main.js` | Roughly halves per-pixel cost. Edges get PS2-style jaggies |
| **Terrain in chunks, only visible ones drawn** | `terrain.js`, `main.js` | Skips chunks behind the camera / off-screen (frustum test) or past the fog's end (all mist anyway). ~52 of ~240 drawn |
| **Levels of detail: a vertex every 1 m within 100 m, 2 m within 220 m, 4 m to 400 m** | `terrain.js` (`createTerrain`, `select`), `main.js` (`DETAIL`), `terrain.vert` (`uChunk`) | Every chunk is 31 × 31 vertices, so coarser ones cover 60 or 120 m. A chunk gives way to its 4 finer children only once they can all be drawn: no holes while they're built. Skirts hide the cracks between levels. ~240 chunks built instead of ~740; ~52 drawn instead of ~170; terrain GPU 1.68 → 0.95 ms |
| **Chunks kept in rings** of 14², 13² and 9² slots, one per level | `terrain.js` | Chunk (cx, cz) of a level always lives in slot (cx mod n, cz mod n): the chunks left behind free exactly the slots the new ones need. No map lookups, no allocation, and each slot keeps its GPU buffer and VAO for good (`bufferData` refills it, with new storage: see "Nothing the GPU may still be reading is written to") |
| **Chunks built before they're needed, soonest first** | `terrain.js` (`mostDue`), `main.js` (`AHEAD`) | By distance, not by whole rows of chunks: they come into range a few at a time, each 40 m (1.1 s at top speed) before it's needed: before the fog shows it, or before its level takes over |
| **Chunks built in a worker; on the main thread only what's needed at once** | `terrain-worker.js`, `terrain.js` (`update`, `buildChunk`, `packChunk`), `main.js` | A module worker builds whole chunks (~0.5 ms each), the soonest due first, four asked at a time; each comes back packed into one transferred buffer, which goes back with a later ask (3 Oct 2026). The main thread still builds a hole on screen within 333 m (`SEEN`) and the ground under the car at once, and everything where no worker starts (a row at a time, within `BUILD_BUDGET` ms a frame, up to `CATCH_UP` times it when behind, at most `ROWS_PER_MS` rows per ms: Firefox's clock is rounded to 1 ms). Main thread 0.33 → 0.11 ms a frame for the terrain in Node, driving the road |
| **Rows skip roads that can't matter** | `terrain.js` (`nearbyRoads`, `farFromRoads`) | Per 11 vertices of a row, only the pieces whose edge comes within LAND_ROUNDING of the nearest (the smooth minimums reach no further); where every road is 76.5 m+ away, no road maths at all. The same bytes exactly |
| Each chunk finds its nearby road pieces once | `terrain.js` (`findRoads`) | Room for 176 pieces within 79.5 m of the chunk (the most measured: 83), so each vertex checks a handful instead of the whole network |
| **Roads worked out once, kept for the next chunks** | `terrain.js` (`cacheRoad`) | A road's bends and its height along it (sampling the land every 40 m) are most of the work of finding roads, and neighbouring chunks want the same few: 64 slots, one per hash of the road. 0.513 → 0.420 ms per chunk; the same bytes |
| `heightAt` remembers the last chunk it used | `terrain.js` | The wheels and hull points nearly always share a chunk. Skips two divides and two `%` per call: physics 11 → 7 µs per frame |
| All chunks share one index buffer, the squares in serpentine strips six wide | `terrain.js`, `main.js` | Same 30×30 grid layout (plus the skirts), so 12.2 KB of indices serves the whole terrain. In strips (3 Oct 2026), a vertex is still in the GPU's post-transform cache when the next row comes to it: ~1,080 vertex shader runs a chunk through a cache of 16-48 vertices, not 1,860 (row by row: 961 from 64 up). `STRIP` in `terrain.js`: 30 is row by row again |
| **Terrain vertex = 8 bytes: height, road edge, normal, grove** | `terrain.js`, `terrain.vert` | Height in cm (16-bit, ±327 m); cm from the road's edge, frayed (16-bit); the normal as 3 bytes; how thick the bamboo grows (a byte, 0-127: it held the distance along a dash until the roads became dirt). 961 vertices per chunk, then 124 for its skirts. x/z come from `gl_VertexID`, the chunk's origin and spacing. Since 3 Oct 2026 a texel of an RGBA16I texture (a row per slot), read by `gl_VertexID`, the bytes unpacked in `terrain.vert` (they were attributes: `vertexAttribIPointer` for the two 16-bit integers, 4 normalized bytes) |
| **The land in one draw: a copy (instance) per chunk** | `main.js` (`chunkCopies`), `terrain.vert` | Per chunk drawn, where it is, its spacing and its slot's row, in a small buffer (one per turn); one `drawElementsInstanced`, nearest first. ~41 draws and ~123 calls a frame → 1 draw and 5 calls (3 Oct 2026) |
| 4-byte vertex stride | `main.js` | Metal requires vertex strides to be multiples of 4 bytes; anything else makes the browser convert the buffer first |
| `Uint16` indices | `terrain.js` | Half the size of 32-bit indices. A chunk has 961 vertices, far below the 65535 "primitive restart" index |
| Fog distances live in the UBO | `main.js`, shaders | JS culling and the shader's fog use the same numbers, set in one place |
| Integer hash noise (`Math.imul`, shifts, xor), gradient (Perlin) noise | `terrain.js` | Fast, repeatable randomness; same seed, same world. One 16-entry table of directions, rather than a cos/sin per grid point. A noise lookup's 4 corners share their hash multiplies (3 instead of 12), and `noise` is kept small enough for V8 to inline (see "Cleanup and review") |
| Land skips the noise it won't use | `terrain.js` (`landHeight`) | Road and narrowest verge: just the road's level. Past `WILD` m: no verge noise. Hills and ridges only once the land is known to be wild |
| The road's direction is only worked out when asked for | `terrain.js` (`roadDistance`, `nearestRoad`) | Building remembers which road piece is nearest, not the point on it and an `atan2` for every closer piece found; `nearestRoad` works those out once |
| Car: no normals stored; flat normals from `dFdx`/`dFdy` | `car.frag` | Less vertex data, and gives the faceted low-poly look for free. (The terrain did the same until its steep walls turned into a saw-tooth of facets; it now stores smooth normals, which also made its pass 35% cheaper) |
| Colour from slope, distance and road distance in the shader | `terrain.frag` | Bank, forest floor, canopy tint, grass, sand and puddles with no colour data per vertex; the textures only shade them |
| **All 9 made textures are one texture array**, bound to unit 1 once at startup | `gl.js` (`createTextureArray`), `main.js` | One sampler picks the layer (ground, bamboo, clouds), so there's no texture binding per frame or per chunk (the car keeps unit 0). 128 × 128 RGBA × 9 layers: 576 KB, 768 KB with mipmaps |
| Each pixel reads only the textures it needs | `terrain.frag` | Sand only near the road, grass only in the bands along it, bank only where the ground isn't flat, the floor only where it isn't all bank: one read for most pixels, two in a blend. (Reading only what's needed measured −0.03 ms against always reading both, with the old rock and dust: see "Textures and dust") |
| Mipmap level worked out from the world position | `terrain.frag` | Once, from `dFdx`/`dFdy` of the position, for every read (`textureLod`). The GPU's own estimate would blur every pixel where the texture coordinates jump (materials, the bank's two directions), and isn't defined inside the `if`s |
| The bank's two directions blended by dither | `terrain.frag` | Where a slope turns between facing x and facing z, each pixel takes one direction or the other by the Bayer pattern: one texture read instead of the two a smooth blend needs, and no seam |
| **Bamboo: not instanced; each stalk pulled from a texture** | `bamboo.js`, `bamboo.glsl`, `main.js` | Instanced, each stalk cost ~0.16 µs whatever its model's size (see "Bamboo, rain and sky"). Instead each level-0 chunk slot has a row of a float texture (2 texels a stalk), refilled with the chunk, and the vertex shaders work out the stalk and the vertex of its model from `gl_VertexID`: stalks + leaves 4.04 → 1.77 ms at 860 × 360, with the other steps below |
| **Bamboo: a list made each frame, stalk by stalk** | `bamboo.js` (`update`), `bamboo.glsl` (`loadEntry`), `main.js` | JS picks the stalks to draw: within 210 m, from chunks the land is drawn from, a 6 m square at a time (skipped whole out of view or all clump; taken whole, in a tight loop, in view and all stalks; else stalk by stalk against the view's sides), near or far by each one's own distance. The list (which stalk; whether bent; how much of it is there) is an integer texture, a 32-bit number an entry, uploaded each frame (~10,300 entries, ~45 KB with the near ones' room; one of three textures, taking turns; 8 bytes an entry, ~97 KB, until 3 Oct 2026); how far a bent one is bent is in a second texture at the same entry, uploaded only where any are, which the vertex shaders read by `gl_VertexID`; the near ones have its first 2,048 entries to themselves, so the far ones go straight into place. Per-chunk choices drew every stalk of a chunk within 30 m as near (up to ~70 m away) and every one of a chunk partly in view: near stalks 1,500 → ~200. ~0.22 ms of JS (Node) for ~8,700 stalks and ~1,700 clumps; 0.16 ms since 3 Oct 2026 (each box tested only against the planes its chunk's box crosses, in one linear test) |
| **Bamboo: three levels of detail** | `bamboo.js`, `stalk.vert`, `leaves.vert`, `clump.*` | Past that, the cost is vertices: ~7-9 ns each, whatever the shader (leaving the headlight and the wet sheen out of the far ones' lighting measured no faster). Within 26–34 m (each stalk its own distance, the two dissolving into each other over 4 m): 5-sided tubes in 2 segments (18 vertices), 3 leaf cards of 2 quads (18). Beyond, where a stalk is under ~1.8 pixels: a line (2 vertices; always a pixel wide, where a thin tube flickers) and one card facing the camera (4), a picture of the 3 crossed cards. From 180–200 m (each 6 m square at its own distance, all its stalks dissolving into its clump over 20 m, so they swap a few at a time, never show both or neither, and do it in 75-80% mist) to 400 m: clumps, one card facing the camera (4 vertices) for each 6 m square where bamboo grows, standing for its ~10 stalks |
| **Bamboo: a handful of draws a frame** | `main.js` (`drawBamboo`, `drawList`) | With indices, as many stalks as 16-bit vertex numbers reach (3,640 or 4,096) per draw: ~7 draws for stalks, leaves and clumps |
| **Clumps planted by every chunk, at every level** | `terrain.js` (`plantClumps`), `main.js` | On the same 6 m squares of the world with the same random numbers, from each chunk's own vertices: a finer chunk has the same clumps as the coarser one it replaces (99.4% of them at level 1, 96% at level 2; the rest deep in the mist). Drawn from the chunks the land is drawn from, so never twice and never missing; stalks too, so a chunk built while its parent is still drawn adds nothing until it's drawn; a level-1 chunk drawn where its level-2 parent was (only clumps) dissolves from clumps into stalks over 0.6 s. None within 3 m of a lane's edge: the card, turned to the camera, would stand out over it. A texel each in a float texture, a row per slot. ~1% more building time |
| **Stalks planted by level 0's and level 1's chunks, the same ones** | `terrain.js` (`plantBamboo`, `STALK_LEVELS`) | On the same 1.5 m squares of the world, with the grove worked out afresh at each (2 noises), not read from the vertices: a level-1 chunk and its four level-0 children plant the same stalks (5,158 of 5,161, the rest beside roads; feet within 14 cm, tips within 18 cm for 99%), so the land changing level at 100 m changes nothing. A 6 m square after another, a row of squares a building step once the chunk's heights are done (a level-1 chunk's 1,600 places at once were 0.2-0.3 ms past the budget). Level 0's chunk 0.567 → 0.604 ms to build. A level-1 chunk's 1,600 stalks: 51 KB in JS and on the GPU; the stalks' texture 1,600 texels wide, a level-0 chunk's in half a row, a level-1 chunk's in two: 11.2 MB |
| **Lighting and mist at the corners** | `stalk.vert`, `leaves.vert`, `clump.vert`, `terrain.vert` | As the PS1 did (Gouraud). The fragment shaders only read the texture: colour = texel × scale + add, the light in the scale, the sheen and the mist in the add. Stalks' pass 0.30 → 0.16 ms, leaves' 0.43 → 0.34. The land keeps its headlight per pixel (the cone's edge would smear across 1 m squares), with the daylight and the mist at the corners: 0.93 → 0.81 ms |
| **Leaves and clumps before the land** | `main.js` | They hide much of it, and its pixels behind them fail the depth test: 3% less GPU time in all than drawing them after it |
| **Sky drawn last, at the far plane** | `sky.*`, `main.js` | One triangle covering the screen at depth 1, tested `LEQUAL`: only the pixels nothing else covered are shaded (0.07 ms). Its direction per pixel from `inverse(uViewProj)`, worked out at its 3 corners |
| **Rain: no buffers, one draw** | `rain.vert` | Each drop's place from hashing its number (`gl_VertexID`), falling with the time and wrapping round a box that follows the camera: no work per drop in JS, 10,000 vertices in 0.08 ms |
| **Particles: one upload and one draw call** | `particles.js`, `main.js` | Live particles are kept at the front of preallocated arrays (a dead one is swapped for the last), so `bufferSubData` uploads just those (with an element count, not a `subarray`, which would allocate) and one `drawArrays(POINTS)` draws them. Three buffers, taking turns |
| Particles see-through by dither, not blending | `particles.frag` | "Screen door": pixels under the pattern's threshold are discarded. No sorting, no blending, depth-tested like everything else, and the colours stay on the 32 levels. Each particle shifts the pattern, so overlapping puffs cover different pixels |
| Mist, all mist by the draw distance, and the sky's treeline the same colour | `sky.glsl` (`mist`, `mistColor`), `sky.frag` | Hides the terrain's edges and the draw distance; PS2-style atmosphere. Its thickness is in the UBO, so `main.js` works out `SEEN` from the same curve |
| Back-face culling | `main.js` | GPU skips triangles facing away (the terrain's underside) |
| Canvas only resized on window resize | `main.js` | Setting `canvas.width` reallocates the canvas's memory |
| Clock-based animation | `main.js` | Same speed at 50, 60 or 120 fps |
| No allocations in the game loop (explicit ones) | `math.js`, `main.js` | Matrices created once; `lookAt` takes plain numbers, not arrays. V8 still boxes fractional numbers passed to or returned from functions it doesn't inline: ~1.5 MB/s while driving, a ~0.1 ms minor GC a few times a second (see "Cleanup and review") |
| Car vertex = 5 floats (x, y, z, u, v), 20 bytes | `obj.js`, `main.js` | Only 411 + 34 vertices (10.2 KB for the body; 382 until the livery's two copies, which store the middle line's corners once for each), so packing smaller isn't worth the code. Corners that share a position and texture coordinate are stored once |
| Car attribute locations fixed in the shader (`layout(location = …)`) | `car.vert`, `main.js` | Body and wheel VAOs use them directly: no `getAttribLocation` |
| **One wheel mesh, drawn 4 times** | `car.js`, `main.js` | The model's built-in wheels are cut out at load (64 faces: every face whose corners all sit inside a tyre). Per frame, per wheel: its own spin, and its height on its spring written into one reused offset matrix. 10 matrix multiplies, no allocations. The body's and the wheels' matrices go up as one uniform array, the wheel drawn as 4 copies (`car.vert`): 2 draws, not 5 (3 Oct 2026) |
| Textures: `NEAREST`, no mipmaps, clamped; decoded with no colour conversion or premultiplying | `gl.js` | The PS1 look, exact texel values (so the tail-light test can rely on them), no mipmap memory |
| Vertex Array Objects (one per mesh) | `main.js` | Switching mesh is one `bindVertexArray` instead of re-describing buffers |
| Car drawn before terrain (front to back) | `main.js` | Terrain pixels hidden behind the car fail the depth test and are never shaded |
| Terrain chunks drawn nearest first | `main.js` | Same idea for hills hiding hills. The chunk grid is walked away from the camera, so no sorting. −5% terrain time |
| **Physics in short equal steps** (≤ 1/120 s: 2 per frame at 60 fps, 3 at 50) | `car.js` | Springs and contacts stay stable at any frame rate, with no interpolation needed. 5.5 µs per frame at 60 fps, 8 µs at 50: 0.04% of the frame |
| Physics vectors are plain numbers and reused typed arrays | `physics.js`, `car.js` | Nothing allocated per step. The body's orientation is kept as both a quaternion (to integrate) and a matrix (its axes, used everywhere), and the car's model matrix is copied straight from it |
| Ground height uses the mesh's own triangles | `terrain.js` | Car sits exactly on the rendered surface, not a smoothed approximation: both read the same whole-cm heights. The same lookup gives the triangle's normal, for contacts |
| **Uniform Buffer Object** for per-frame values (view-projection + camera) | `main.js`, shaders | One upload shared by every shader, instead of the same uniforms per program. `multiply` writes straight into the UBO's array, so no copy. Three, taking turns |
| **Nothing the GPU may still be reading is written to** | `main.js` (`TURNS`, `uploadRow`) | The GPU runs a frame or two behind. Refilling a buffer or texture it may still be drawing from makes some drivers stop and wait for it: macOS's OpenGL among them, which Firefox and Zen draw with (Chrome's Metal copes). So what's refilled every frame (the bamboo's list, the frame's uniforms, the particles) has three copies, taking turns; a finished chunk's rows of the bamboo's textures go through a pixel buffer of their own, which the GPU copies into the texture after the draws already sent; and its vertices get new storage (`bufferData`), not the slot's old one refilled. Free in Chrome (measured); not measured in Zen |
| Per frame (3 Oct 2026, driving the road): ~134 calls, ~35 draws: 1 UBO upload (and binding this turn's), car (10 calls, 2 draws), the land (5 calls, 1 draw), bamboo (2-4 for the list, ~15 for stalks, leaves and clumps), ground cover (~50 calls, ~18 draws), trees (~10), particles, rain and sky, and a few as chunks arrive | `main.js` | Each `gl.*` call has a fixed crossing cost (see below). Was ~370 calls and ~88 draws (`bench/count.js`). JS mean 0.8 ms while driving (0.7 before the bamboo's list); in Node 0.55 → 0.28 ms with the workers |
| `alpha` left at default | `main.js` | Turning it off was measured slower here |
| Shader status checked once, after linking | `gl.js` | Each status check waits for the GPU process. Startup blocking roughly halved (see measurements) |
| Terrain grid size is a shader constant, not a uniform | `terrain.vert` | Lets the compiler turn `gl_VertexID / 31` into a multiply and shift. Too small to measure at ~20k vertices |
| No array literals in the maths, even outside the loop | `math.js` | `perspective` (runs on resize) writes elements directly, so the whole file really is allocation-free |
| **Trees, bridges and broadleaf drawn with indices** | `trees.js` (`vertex`, `triangle`), `blocks.js` (`blockWriter`, `shareVertices`), `main.js` (`fillBuilt`) | Each vertex stored once, the triangles as indices: a cherry's near model ~2.2 times fewer vertices shaded, the far one ~1.75, broadleaf ~3.4. The same triangles in the same order (3 Oct 2026) |
| **Cherry and maple models made in a worker** | `tree-worker.js`, `main.js` (`askTree`) | One asked for at a time (~1 ms each in Node, made on the main thread a frame at a time before); after a jump, all within SEEN still made here at once. A new tree is held back if it's in view within SEEN the first time it could be drawn (3 Oct 2026) |
| **Value noise from shared products** | `shaders/noise.glsl` (`built.frag`, `nature.frag`) | The eight corners' hashes from three products, `(c + 1) × k = c × k + k`: 11 integer multiplies a noise, not 32 (slow on Intel), blended in the same order: the same numbers (3 Oct 2026) |
| **Ground cover: copies by distance, sectors from where the camera looks, only changed calls** | `main.js` (`gatherNature`, `natureView`) | Copies within their kind's fade + 15 m, not whole chunks (~500 → ~300 a frame); sectors counted from the camera's look, the nearest bucket in the middle, so a kind's copies in view are one draw (29 → 18); uniforms and the copies' pointers set only when they change (~164 → ~53 calls). Nothing allocated (3 Oct 2026) |
| **Walls near the car only** | `main.js` (`wallAt`, `WALL_REACH`), `trees.js` (`treesNear`), `nature.js` (`copiesNear`) | Trees and boulders within 10 m of the car, found once a frame, instead of every tree for every wall point at every physics step: 0.06 → 0.004 ms a frame in Node (3 Oct 2026) |
| **Trees found a few squares a frame** | `terrain.js` (`findTrees`, `GROUPS_A_CALL`) | Three new 35 m squares a frame rather than ~37 at once every 50 m (~2.5 ms in Node); all at once after a jump (3 Oct 2026) |

The cube (`shaders/cube.*`) is no longer in the game, but `bench/frames.html` still profiles it.

## Measurements

### PS1-style reflections (4 Oct 2026)

Asked for: the reflections great but too true to life for the rest. A PS1 had no reflections to
speak of: a small low-resolution picture, flipped or mapped onto the water, in 15-bit colour,
wobbling in steps. So (water.frag): what's reflected is looked up at the middle of its block, 45
rows of blocks down the screen (at 90, 2 pixels of the 288 × 180 canvas at 576 × 360: hardly to be
seen); the small waves move 10 times a second, not smoothly, and tilt the surface in steps of 0.01,
so the reflection jumps a block at a time; it takes 30% of the water's own murk; and the water is
dithered to 5 bits a channel, as everything else already was (it alone wasn't). GPU the same (water
0.33 → 0.34 ms at a bank, `?profile&step=60`).

### The shingle's edge smooth, bamboo down the banks in patches (4 Oct 2026)

Asked for: the gravel didn't blend in, its blend pixellated though the textures aren't; and bamboo a
little way down the banks, not too far.

- **Why pixellated**: the ground textures are drawn unfiltered close up (MAG_FILTER NEAREST, the PS1
  look), and the band's edge wandered by the litter texture enlarged 2.5×, so it stepped along 30 cm
  texel squares (and by the stones' texels). Now terrain.frag pushes it in and out by value noise
  (noise.glsl `noise3`, eased): ±0.25 m at 0.7 m and ±2 m at 3.5 m. Terrain GPU +0.01-0.03 ms by rivers.
- **Bamboo** (terrain.js `grove`): in patches (noise at 35 m) along the grassy and reedy stretches (not
  the stony ones' beaches), it grows from 0.3 m past the water's edge as it wanders (bankIn), thick by
  2.5 m; elsewhere from 2 m past the river's widest, thick by 8 m, as before. Stalks within 4 m of the
  water in a 450 × 2,800 m strip by a river: 116 → 399, 23 of them on the bank's slope. It leans out
  over the water as before (plantBamboo). Stalks' GPU the same at three river views (0.17-0.21 ms).
- **Checked**: nothing on the bridges' roads; every bridge both ways, never in the air; on the road
  40 min, 0 jumps; chunks build in 0.73 ms (checksum `b1825defd82feebe`); screenshots.

### Shingle, a wet line, and stretches along the rivers (3 Oct 2026)

Asked for: the banks' shape good, their detail still inadequate. From the photos of Japanese river
bridges (see "Gentle, low banks"), suggested and asked for 1-3 of: (1) a band of pale rounded stones
along the water, a beach on the inside of bends; (2) a dark, mossy wet line just above the water; (3)
the river in stretches, grassy, stony or reedy, every few tens of metres; (4) tall grass leaning over
the water, (5) stone-faced banks at the bridges, (6) driftwood, leaning trees, steps: left for later
(the user expects the grass, 4, to matter most).

- **A byte for the shore** (terrain.js `shoreByte`): the vertex had no room, so the normal's y is no
  longer kept (terrain.vert and nature.js work it out from x and z: the ground never faces down), and
  its byte holds, by a river, how far past the water's (wandering) edge the vertex is (5 bits, -0.6 to
  2.5 m by tenths) and how wide a band of shingle runs along the water there (3 bits, by 0.35 m). The
  width is the stretch's (noise at 45 m: reedy, none; grassy, 0.35-0.7 m; stony, 1-2.45 m), and on a
  stony or grassy stretch wider on the inside of a bend (riverDistance's curvature over 16 m, from 1/500
  to 1/125 m, up to 1.4 m more).
- **terrain.frag**: the shingle, the bank's texture laid flat at a third of its scale in pale grey,
  its edge pushed in and out by the stones (±0.25 m) and over a few metres (±1.2 m: a narrow band comes
  and goes in patches; at a constant width it read as a kerb), on into the shallows; above it no
  riverbed, so grass comes down to the stones (or the water, on a reedy stretch: before, 0.5-2.5 m of
  silt texture everywhere). The wet line: up to 0.45 m past the water, darker, mossy, a little shine.
- **nature.js `banky`** by stretch: reedy, reeds thicker and in more of it (0.8, from a patch of 0.05);
  stony, few reeds (0.2) and on the beach only the bank's stones (0.3 of its squares); grassy as before.
- **Checked**: chunks build in the same time (0.71 ms; checksum `3d6ea91a84bbc91c`); bench/loop.mjs JS
  0.23 ms a frame p50; on the road 40 min, 0 jumps; nothing on the bridges' roads; screenshots at two
  bridges, a bank and a stony stretch. GPU (`?profile&step=60`, 576 × 360): terrain +0.02-0.03 ms by
  rivers, the rest within the noise.

### Roads cross the rivers at the valley floor: the banks at a bridge as low as anywhere (3 Oct 2026)

Asked for: the banks just along the river from a bridge nearly flat (ideal), but high at the bridge;
why? Because the land there is the road's, not the river's: a road only partly follows the land
(`follow`, 0.2-0.95 of the relief), so across a valley it runs up to 3.2 m above the floor, and the
land beside it is held at its height for the verge (4.5-16.5 m) and only meets the land's own height
50 m further. The last change brought crossings down to 1.6 m above the water, still 0.8 m above the
valley floor (0.8 m above the water): the bank at the bridge 1.8 m, along the river 0.8-0.9.

- terrain.js `liftRoad`: a crossing now at the valley floor (`BRIDGE_ABOVE` 0.1 m above it, was
  `BRIDGE_HIGH` 1.6 m above the water), level for 25 m from the water (was 15) and rising at 3% from
  there (was 4.5%), so where the road's own bank begins it's further from the river. A node within
  those 25 m is lowered too (by where it is, so every road there agrees): left as it was, the roads
  either side of one on a river's bank met it in a 0.8 m crest that threw the car 0.33 s (the bridge
  drive, one bridge of 68).
- Now: the banks at the bridges 0.96 m above the water (median; 1.8 before), 0.88 at 30 m along, 0.83
  from 60 m; decks a median 1.7 m above the water at their highest (the arch).
- **Checked**: on the road 40 min, 0 jumps, 0 tip-overs; every bridge both ways, never in the air;
  nothing on the bridges' roads; no cut road vertex past a deck's ends; screenshots at four bridges.
  Chunks build in the same time (0.72 ms; checksum `db98df67f233ef3d`).

### Gentle, low banks, as at Japanese river bridges (3 Oct 2026)

Asked for: the banks still steep and a bit high; look at pictures of Japanese bridges. Photos looked at
(image search: Togetsukyo at Arashiyama, footbridges at Narai, country footbridges): the banks are
gentle, ~20-35°, grass right down to a stony margin at the water, which is only 0.5-1 m below the land;
the bridges low over it. Ours were 56-67° (1.5-2.4 m up per m out), the water 1.5 m below the valley
floor.

- terrain.js: `RIVER_DROP` 1.5 → 0.8 m; `RIVER_BANK` 1.5 → 0.45 m per m and `BANK_STEEPER` 0.9 → 0.3 (so
  0.45-0.75 per m, 24-37°); `BRIDGE_HIGH` 2 → 1.6 m. riverBed skips bankHeight's noise wherever the land
  is below the plain bank (it can only be higher), as the gentler banks reach ~3× further: chunks build
  in the same time (0.72 ms; checksum `a5ad370fc032e373`).
- nature.js `banky`: the bank face's stones, ferns and sedge on ground less steep than before (normal's
  y under 0.92, was 0.8), as the faces are gentler.
- Now: banks 0.8-0.9 m above the water away from the roads (were 1.5), 1.8 m at the bridges (2.2 in
  the last change, 4.9 before it); decks a median 2.5 m above the water; bridges a little longer (median
  45 m, was 43; a tenth over 73, was 63) as the gentler banks cut further into the roads.
- **Checked**: on the road 40 min, 0 jumps, 0 tip-overs; every bridge driven both ways, never in the
  air; nothing on the bridges' roads; no cut road vertex past a deck's ends (the uncovered ones are
  beside the narrower decks, as before: 601 of 7,822, 487 of 6,608 before); screenshots at four
  bridges and a bank. GPU as the last change (ground cover 2.0-2.3 ms from two bridges).

### Lower banks at the bridges, stones and plants on the bank faces (3 Oct 2026)

Asked for: the banks far too high in general, though smaller a little way from the bridges; and still
bare, nothing on their sides. Why they were high: away from the roads the land sinks to the valley
floor (`VALLEY`, 4 m below roadLevel) and the water is 1.5 m below that, so the banks were 1.5 m
everywhere but at the roads. A road kept whatever lift it came with (its land's relief, smoothed over
80 m and limited to a 6% grade, so one coming off a ridge couldn't get down in time), and the land
beside it is held at its height for the verge (4.5-16.5 m) and only reaches the wild land's height 50 m
further. So at every crossing the river was cut through a raised road: decks a median 5.7 m above the
water (a tenth 18 m or more), the banks beside them 4.9 m (a tenth over 12 m), the same 15 m along the
river, 4 m at 30 m, back to 1.5-1.7 m from 60 m. The scene a user sees from a road is all at the
crossings.

- **Roads come down to the rivers** (terrain.js `liftRoad`, `BRIDGE_HIGH`): wherever a road's corner is
  within 15 m of the water's edge, its lift is no more than puts it 2 m above the water, rising from
  there along the road at no more than 4.5% (into `dip`, by two passes along it, after the grade's
  limit); then the grade's limit again from the ends, which aren't lowered (every road at a node must
  agree). Measured along the road, not by riverDistance: tried first as a cap by riverDistance, which
  is only right near a river (a kilometre off it changes by up to 6 m a metre), and the cap pulled a
  road 1 km from any river down a 33% step (4 jumps in bench/physics.mjs's on-road drives, all at one
  spot). Now: decks a median 2.8 m above the water (2.5-3.3), banks at the bridge 2.2 m (1.7-2.8),
  2.1 m at 30 m along, 1.6 m at 60 m (the highest ground within 8 m of the water, lumps included). 125 of the points every 250 m on roads in 12 × 12 km moved, by a
  median 3.2 m (a tenth by 17 m or more, most 35 m: those were banks across the valley floor); the
  land 25 m beside them above the road: median 0.7 → 1.0 m, at most 6.7 → 8.9 m.
- **On the bank faces** (nature.js `banky`): where the water's layer reaches (4 m past the edge) and the
  ground is steep (normal's y under 0.8), on the 1.2 m squares: stones set in the bank (BANK_STONES,
  new: 2-4 lumpy rocks, half buried and not flattened underneath, so they stand out of the slope;
  faded as the ferns, level 0 only) 16%, ferns 10%, sedge 24%. Not on the big boulders in the water.
- **Checked**: on the road (bench/physics.mjs) 40 min, 0 jumps, 0 tip-overs; every bridge in 12 × 12 km
  driven both ways, 0 s in the air; no road vertex the river cuts is newly left without a deck over it
  (487 aren't, the strip beside the narrower decks, as before); nothing grows on the bridges' roads
  (bench/bridges.mjs); screenshots from three bridges and a bank, old and new. Chunks build in the
  same time (0.73 ms; checksum now `3d2a1973e71c4c77`).
- **Cost** (headless Chrome, Metal, 576 × 360, `?profile&step=60`, GPU p50): the ground cover from
  bridges and a bank 1.5-1.6 → 1.9-2.3 ms (the views see more of the banks now, and ~30% more
  triangles in a river chunk: 36k → 46k, ferns and the stones); the whole frame's GPU +0.3-0.7 ms. Not
  measured in Zen.

### Livelier rivers: reflections, uneven banks and plants on them, arched bridges (3 Oct 2026)

Asked for: the rivers looked bland; the user's guesses: (1) banks completely even, (2) bare banks,
just a texture, (3) little on the water but lily pads, (4) water not reflective, (5) flat bridges.

- **Banks** (terrain.js `bankHeight`): the water's edge wanders in by up to 1.8 m (noise at 23 m); the
  banks rise 1.5-2.4 m per m out (noise at 41 m); lumps of up to 0.5 m (noise at 4.5 and 1.9 m); and
  at the waterline, where the edge has wandered in, a muddy shelf rising only 0.3 per m, from 1.5 m out
  under the water. All of it only ever higher than the plain bank, which is what findBridges asks about,
  so a road the river cuts is still always on a bridge (checked: no road vertex newly cut and not under
  a deck, at 66 bridges; the ones that aren't are the same strip beside the narrower decks as before).
  The riverbed's wet band follows the wandering edge. Chunks build in the same time (0.72 ms).
- **On the banks** (nature.js `banky`, level-0 chunks near a river, 1.2 m squares): reeds with bulrushes
  in beds, from 40 cm deep to 30 cm above the water (mostly on the shelf), and sedge tussocks up the wet
  bank; ferns up the banks however steep, and more bushes on them (0.3, from level 0.5). Reeds and sedge
  fade by 40-55 m, as the ferns. (The old REEDS kind, off with the grass, is back for this.) ~33 more
  copies per river chunk. Bamboo near a river leans out over the water as it does over a road
  (plantBamboo: from up to 10 m back from where it starts, 2 m from the water).
- **On the water** (water.frag `floating`): mats of duckweed in the shallows and in patches out from
  them, speckled up close; a broken scum of foam where it's under 22 cm deep (at the banks, round the
  boulders), slowly stirring; bits of bamboo culm, 0.8-2.2 m, with dark nodes, drifting a little. The
  fallen leaves now look in the 4 nearest squares, not 9 (they never drift further).
- **Reflections** (water.frag `reflected`): the frame is now drawn into a framebuffer of our own
  (main.js `scene`: colour and depth renderbuffers), and just before the water its colour and depth are
  copied into textures (`copy`, units 9 and 10) for water.frag to read; at the end its colour is copied
  onto the canvas (which has no depth buffer now). Per water pixel, the reflected ray is stepped through
  the copied depth: 10 steps from 0.6 m, 1.6× further each (to ~40 m), and on passing behind something,
  narrowed in 3 halvings; only if it's then within 0.6 m (+2% of the distance) behind it is it a hit
  (else it passed behind something in front, like a trunk between camera and water, and steps on).
  Where it finds nothing, or leaves the screen, the sky as before; it fades out at the screen's edges.
  The screen position along the ray is linear in the distance before the divide by w, so a step is one
  multiply-add, not a matrix. Reflection 0.5 of the colour looking straight down (was 0.3), almost all
  at a glancing angle. None under thick mist (90%) or what fully covers the water. `?aa` still works: the
  scene's framebuffer is multisampled then, and the copies resolve it.
- **Arched bridges** (terrain.js `arch`): each deck rises in a sin² arch, 0.9 m in the middle (less on
  short bridges: bending no tighter than a 120 m curve over the top), its corners every 2 m. At an
  80 m curve the car left the deck for up to 0.08 s over the top at 25 m/s; at 120 m, never (every
  bridge in 12 × 12 km driven over both ways, `followTheRoad`); bench/physics.mjs on the road unchanged
  (40 min, 0 jumps, 0 tip-overs). The JS a frame is the same from a bridge (bench/loop.mjs, 0.28-0.34 ms).
- **Cost** (headless Chrome on this Mac, Metal, 576 × 360, `?profile&step=60`; GPU p50, ms):

  | | Old | New |
  |---|---|---|
  | Water, from a bank with the river filling much of the view (`-2324,-117,at,100`) | 0.89 | 1.38 |
  | Water, from a bank along a river (`-5061,-159,at,177`) | 0.48 | 0.77 |
  | Water, from two bridges (`-4560,-4086,back`, `-5020,2301`) | 0.29 | 0.42-0.47 |
  | Ground cover at three bridges (the bank plants) | 0.92-1.16 | 1.19-1.43 |
  | Clearing + copying onto the canvas (`present`), away from rivers | ~0.06 (clear) | 0.02 + 0.07 |

  Of the water's 1.38 ms at the worst view: reflections ~0.6, leaves 0.2, the rest ~0.1 each. Tried and
  dropped: 16 steps (+0.2 ms, hardly different to see), 6 steps of 2× (bridges' piles lost from the
  reflection), sinking the water layer's dry vertices below the ground so the depth test drops them
  (no faster). Timings from a spawn on a bank move about (the car rolls down it): compare with
  `&step=60`. Not measured in Zen: Firefox has no GPU timers; watch the frame time near a river.
- **Checked**: nothing grows on the bridges' roads (bench/bridges.mjs, 69 bridges); screenshots at four
  rivers and a bridge (old and new side by side); `?aa`.
- **New**: `?spawn=x,z,at,degrees` puts the car exactly there, off the road too, facing that way: to look
  along a river from its bank. The profiler shows `water` and `present`.

### Nothing grows on the bridges' roads (3 Oct 2026)

Asked for: rocks and bamboo (perhaps ferns and bushes too) growing on bridges and their approaches,
blocking the road.

- **Why**: where a river's banks cut a road away (under a bridge and beside it), buildRow pushes the
  vertices' road edge out to UNPAINTED (8 m), so no sand is painted there. Everything planted read that
  same number (plantBamboo, plantClumps, nature.js's `sample`), so on those vertices the road looked 8 m
  away, and stalks (7-15 m tall: up through the deck), rocks, slabs and boulders (which stop the car)
  grew on the road's line, under the deck and through it. Counted over the 69 bridges within a 12 ×
  12 km square (`bench/bridges.mjs`; levels 0 and 1 counted separately, so most twice): 966 stalks, 4 clumps (+5 at level 2), 48 clusters of stones, 59
  rocks, 18 slabs and 27 boulders within 0.5 m of the road or the deck (a boulder: within its radius
  and half the car).
- **Fix**: each chunk keeps a second copy of the road's edge per vertex, `slot.edges` (frayed, as
  before, but never pushed out by a cut), and everything planted reads that; the vertices keep the
  painted one, so where the road is painted doesn't change (the vertices' checksum the same,
  `5237b7bd2fd6352c`). The bridge's road is then just a road to what's planted: nothing within 1 m of its
  edge (bamboo), 1.5 m (rocks), 2.5 m (ferns, bushes), 3 m (clumps), 6 m (boulders). The decks are narrower
  than the road and their sunk ends are on it, so all of them are clear. 1.9 KB more a chunk sent from the
  worker (at most 72 KB of CHUNK_BYTES' 96). Trees already used the road's own distance.
- **Checked**: after, nothing within those distances at any of the 69 bridges. Of 13,125 chunks over
  3 km (levels 0-2), the only 19 whose bamboo, clumps or ground cover changed are ones a river cuts a road
  in. Levels 0 and 1 near the bridges disagree on fewer places than before (244 against 300 of ~44,000:
  what can come or go as a chunk gives way to its children), so nothing new pops. Screenshots (headless
  Chrome, 576 × 360, `?step=60`, HOLD 90) at five bridges, from 25 m before each and from on three
  decks, both ways: stalks stood up through the decks and across the far end before, none after; the
  views facing away from the bridges identical to the pixel.

### Half the main thread's JS, a third of the draws: workers, indices, one draw for the land (3 Oct 2026)

Asked for: optimise everything as far as it will go, CPU and GPU, for Zen on the Iris Plus 655 at
~576 × 360, with nothing visibly changing (no pop-in, LOD swaps or culling that shows; fading only in
thick mist; whatever comes late held back until out of sight), the loop allocation-free, nothing
downloaded; from the leads above (ground cover, trees, bamboo's list, the walls, building in a worker).
Done in a cloud session: no Mac, no GPU.

**How it was measured, without the Mac.** Headless Chromium drawing through SwiftShader (software:
bound by pixels, so its GPU timings only compare A with B); the work counted instead (`bench/count.js`:
calls, draws, vertices, copies, bytes uploaded); the JS timed in Node, main.js itself against a WebGL
context that does nothing (`bench/loop.mjs`, V8 as in Chrome: Firefox runs the same JS slower); and
nothing visibly changed proved by screenshots: `?step=60` (every frame 1/60 s of the game) with
`HOLD` (bench/headless.mjs: the game stopped at a given frame, `Math.random` seeded) makes the same
picture every run, so each change was diffed (`bench/diff.mjs`) against the version before all this, at
576 × 360, in nine views: driving the road at the start (frames 240 and 900), rocks and cherries far
off (spawn -2298,-2998), a cherry close (-2486,-995), a bush (-2284,-71), cherries, maples, fallen
petals, bushes and rocks (-1319,-3126 facing back), a bridge (-2284,-71 facing back), and circling
through a grove, bending stalks (frames 250 and 400). After every change: **0 of 207,360 pixels
differ**, in all of them. (The noise and the bamboo's list were also checked number for number: the
same values, 5 M list entries with near and far stalks bent.)

**What changed** (all in place of the same work, giving the same result):

- **The land built in a worker** (`terrain-worker.js`, a module worker): whole chunks, asked for four
  at a time, the soonest due first, each back packed into one transferred buffer that goes back with
  the next ask. The main thread still builds a hole on screen within SEEN and the ground under the car
  at once, and everything if no worker starts (the old way, unchanged: `bench/keepup.js` 22.7 chunks
  a second, all 153 drawable, none behind). The building code moved out of `createTerrain` unchanged:
  the same bytes (`bench/build.mjs` checksum `5237b7bd2fd6352c`). The terrain's main-thread JS 0.33 →
  0.11 ms a frame (Node, driving the road; what's left is choosing what to draw and finding trees).
- **The cherry and maple models made in a worker** (`tree-worker.js`, one asked at a time; ~1-2 ms
  each on the main thread before, a frame at a time); after a jump all within SEEN still made at once
  here. A new one is held back if it's in view within SEEN the first time it could be drawn.
- **Trees found a few squares a frame** (three new 35 m squares, not ~37 at once every 50 m, ~2.5 ms;
  all at once after a jump). **Bridges** laid into typed arrays with indices: 3.3 → 0.2 ms a bridge,
  the hitch as one came near.
- **The land in one draw**: each slot's vertices a row of an RGBA16I texture (`terrain.vert` reads them
  by `gl_VertexID`), each chunk drawn a copy (instance), nearest first: 41 draws and 123 calls a frame
  → 1 and 5. Its squares in serpentine strips six wide, for the vertex cache: through a FIFO cache of
  16-48 vertices ~1,080 vertex shader runs a chunk instead of 1,860; from 64 up, 961 row by row against
  1,045-1,065 (simulated; which the Iris has isn't known here: `STRIP` in terrain.js, 30 for row by row).
- **Trees with indices**: the cherry and maple models (trees.js writes each vertex once: tube rings,
  card corners, the petals' shared corners), the broadleaf shapes and the bridges. Vertices shaded a
  frame, driving the road: cherries, maples and bridges 8,563 → 4,884, broadleaf 25,401 → 7,377 (at the
  cherries: 12,897 → 7,351 and 46,768 → 13,720). Making a model 1.00 → 0.92 ms.
- **The noise** (rocks, bark, timber, petals: `shaders/noise.glsl`): the eight corners' hashes from
  three products, 11 integer multiplies a noise instead of 32 (integer multiplies are slow on Intel),
  the same numbers.
- **Ground cover**: only copies within their kind's fade + 15 m gathered (whole chunks before): ~500 →
  ~300 copies a frame; sectors counted from where the camera looks, the nearest bucket in the middle:
  29 → 18 draws; the fade, sway and bloom set only when they change, and a kind's copies re-pointed only
  when its run starts elsewhere: 164 → 53 calls. `gatherNature` allocates nothing now.
- **Bamboo**: its list a 32-bit number an entry (which, bent or not, how much is there), the bends in a
  second texture uploaded only where any are: ~45 KB uploaded a frame instead of ~74-97. `update`'s
  culling tests a box only against the planes its chunk's box crosses, a stalk's or clump's in one
  linear test, the squares walked without dividing: 0.22 → 0.16 ms a frame (Node).
- **The car's walls** test the trees and boulders within 10 m, found once a frame (every tree, for
  every point of the car, at every physics step before), and `wallAt` makes no array: 0.06 → 0.004 ms.
- **The car**: one matrix upload, the body drawn once and the wheel four times as copies: 5 → 2 draws.
- Trees drawn sorted by insertion (nothing made). `fillBuilt`, `blockWriter` reuse their arrays.

**Work a frame** (`bench/loop.mjs ... count`, frames 3,000-6,000, driving the road from the start; at
the cherries, -1319,-3126, in brackets):

| | Before | After |
|---|---|---|
| WebGL calls | 367 (389) | 134 (154) |
| Draws | 88 (95) | 35 (41) |
| Vertices shaded (indexed: each once, a perfect cache) | 204,401 (232,181) | 158,996 (170,242) |
| Copies (instances) drawn | 509 (513) | 360 (370) |
| Bytes uploaded | 94,731 (92,176) | 51,452 (50,274) |
| The land: draws, calls | 41, 123 | 1, 5 |
| Ground cover: draws, copies, vertices, calls | 29, 499, 61,106, 164 | 18, 306, 37,403, 53 |

**Main thread JS a frame** (Node, V8, 3,000 frames after 3,000, two runs each; the workers played
between frames):

| Drive | Before: mean, p90, p99, max (ms) | After |
|---|---|---|
| The road from the start | 0.53-0.59, 1.38-1.44, 1.83-1.97, 5.2-6.4 | 0.26-0.27, 0.37-0.41, 0.69-0.74, 2.9-3.5 |
| From the cherries (-1319,-3126) | 0.54-0.57, 1.39-1.42, 1.86-1.89, 3.4-4.6 | 0.27-0.31, 0.42-0.47, 0.70-0.85, 2.6-3.9 |
| From the bridge (-2284,-71) | 0.55-0.57, 1.40-1.42, 1.93-2.02, 3.4-5.5 | 0.30-0.32, 0.48-0.52, 0.75-0.83, 2.7-2.9 |

By function (CPU profile, the road, ms a frame with what each calls): `frame` 0.67 → 0.34; bamboo's
`update` 0.22 → 0.16; `terrain.update` 0.33 → 0.11; the physics step 0.08 → 0.02 (walls 0.06 → 0.004).
The garbage Node measures (~190 KB a frame) is mostly the workers' building in the same process, and
boxed numbers (V8's: Firefox doesn't box them); on the main thread, ~25 KB a frame.

**GPU, SwiftShader** (headless Chromium, the road, p50 over 450 frames, ms, two alternating runs;
software rendering, so only which way each pass moved means anything):

| Pass | 576 × 360 before | after | 160 × 100 before | after |
|---|---|---|---|---|
| Ground cover | 14.5-14.9 | 12.2-12.5 | 7.6-8.1 | 5.4 |
| Trees | 14.3-14.6 | 15.2-15.4 | 5.4-5.7 | 5.1-5.4 |
| The land | 44.3-44.5 | 43.9-44.3 | 16.5-17.2 | 15.7-15.9 |
| Bamboo leaves, stalks | 58.1-58.3, 12.5 | 58.4-58.6, 12.4-12.7 | 11.2-11.7, 5.7-6.0 | 11.0-11.2, 5.6-5.7 |

The trees read ~5% slower in SwiftShader at 576 × 360 (its pixels, not its vertices, are the cost
there, and it may take indexed draws differently); a third fewer vertices at 160 × 100. Startup, the
physics (`bench/physics.mjs`: the same results to the digit) and the land are unchanged.

**Not done, and why.** Fewer fern triangles, or LODs for the stones: a fern fades out by 55 m, at ~35%
mist, and a swap before that could show. Merging the ground cover's kinds into fewer draws (vertex
pulling by shape): the Iris measured ~0.16 µs a copy and draws mattering less than vertices (see
"Bamboo, rain and sky"), and it'd read 4 texels a vertex. Not drawing broadleaf trees past the mist's
end (400-450 m): mist-coloured, they could still show against the clouds above the treeline. Building
bamboo's list in a worker: a frame late, the view's edges would need wider culling.

**To measure on the Mac:** (1) GPU per pass in headless Chrome (Metal), `?profile&autodrive=road&size=576x360`,
before and after alternately: the land (if slower, the strips: `STRIP = 30`), trees, ground cover;
(2) in Zen, `?profile` driving the road: JS, worst frame and late frames, and that "rows built" stays
0 (the workers started; Firefox has module workers from 114); (3) Zen's console: the new shader code
(RGBA16I and R32UI textures read with `texelFetch`, `uniform mat4 uModels[5]` indexed by
`gl_InstanceID`, bit operations) compiles in Firefox's translation (as `unpackSnorm2x16` once didn't);
(4) whole-GPU busy and the fans (`bench/sample-system.sh`) before and after.

### Late arrivals held back, building catches up; where the time goes (3 Oct 2026)

Asked for: objects sometimes "load in dramatically" round the car, as if late rather than culled:
"perhaps by making them not load in if they are too late". Then: optimise everywhere (handed to a
cloud session: see the leads below).

- **What came late**: (1) after a jump (the first frame, a tow), the cherry and maple models were
  made one a frame, nearest first, so they sprang up round the car over a second or more, and the
  ground cover waited up to 250 ms (NATURE_REFRESH) to be gathered; (2) where the building falls
  behind (Zen: Firefox's clock is rounded to 1 ms, its JS slower, its frame rate maybe lower;
  `bench/keepup.js` at 3× slower and 30 fps: 16.6 chunks a second built of 22.7 needed, 127 drawable
  chunks of 153), a finer chunk arrives once its land is in view, and its bushes and rocks (level 1)
  or ferns (level 0) appear with it; (3) the ground cover's sector culling had no margin for the
  copies' width or the tilted camera's bottom corners (they reach ~4° wider than the sides' middle
  at 576 × 360, more tilted further): copies close by at the view's edges came in as the car turned.
  The tree slots never run out (at most 23 cherries and maples within 450 m, at 60 places; 48 slots).
- **Fixes**: after a jump, every tree within SEEN (333 m) is made at once, near ones whole, and the
  ground cover gathered at once (main.js `jumped`). Building falling behind (the chunk needed
  soonest due within `ahead / 2`, 20 m) gets up to CATCH_UP (3) times the budget (terrain.js
  `update`): keepup at 3× slower, 30 fps: 22.5 chunks a second, all 153 drawable. And what still
  comes late isn't let in while it can be seen: a chunk drawn for the first time in place of its
  coarser parent (drawn last frame) holds back its new kinds' copies that are within their fade and
  in view (`heldCopies`, keyed by kind and world square, so the finer chunks that take over hold
  them too), and a newly found tree whose model's made in view within SEEN is `held`; each is let
  in once it's out of view or beyond its distance. Forcing the building 33× slower: 75 copies held
  in 20 s, 47 let in later, out of sight. Sector culling: the reach is now the view's widest corner
  along the ground (from the view matrix) + half a sector + asin(moved / 25) + the biggest copy's
  width (2.5 m) seen from 25 - moved m (all of it once moved is within 5 m of 25). Ground cover GPU
  ~2.0 → ~2.2 ms driving the road (more copies at the edges); JS unchanged (~1.1 ms mean).
- **Where the time goes now** (headless Chrome, 576 × 360, `?autodrive=road`, p50): GPU ~5.1 ms:
  ground cover 2.0, trees 1.25, terrain 0.62, bamboo leaves 0.55, stalks 0.3, clear 0.13. JS ~1.0
  ms mean (CPU profile, self time per second: bamboo.js `update` 11.6 ms, `treeWall` 4.2 (every
  tree, every wall point, every physics step), `frame` 3.8, `wallAt` 2.2 (allocates an array each
  call), the terrain's building ~10 in all, GC 0.6).
  - The ground cover by group (timer queries round each: they add a little): ferns 0.76, bushes
    0.46, stones 0.32, boulders 0.17, rocks 0.15, slabs 0.12, flowering 0.14. Its fragment shader is
    ~45% of it (a trivial one: 2.0 → 1.06 ms); copies gathered per kind are ~3× those within its
    fade (whole chunks within fade + 15 m are taken: ferns 175 gathered, 58 within 55 m), each still
    run through the vertex shader; and per copy far more than its vertices explain (rocks 0.15 ms for
    28 copies of 60 vertices): per-draw costs (~27 instanced draws a frame) or the timer queries.
  - Leads not yet taken: copies filtered by distance when gathered; cheaper rock shading (two
    3D noises a pixel, 8 integer hashes each: slow on Intel Gen9); fewer fern triangles; the trees
    drawn without indices (drawArrays: no vertex reuse) and their bark's five noises; `treeWall`
    and `wallAt`; bamboo's list (97 KB uploaded a frame); building the terrain in a worker.

### Pop-in, flowers, grass off; the ground cover culled by sector (3 Oct 2026)

Asked for: bushes visibly appearing, trees changing too much from far model to near, the flowering
bushes' flowers jagged (a few whole cards of blossom), grass faded so near it was better without;
trees and bushes kept (they make the place); and the fans still came on.

- **Measure at the game's size**: it renders ~360 rows (576 × 360 on the laptop), not 1280 × 720;
  there the pixels cost little and vertices (everything drawn, seen or not) most. At 576 × 360 at
  the usual spot: the ground cover 4.2 ms, everything else 2.1.
- **No more shrinking away**: each kind of ground cover fades out dithered (nature.vert's vFade
  against the screen's dither pattern; beyond its fade, a copy's vertices are put outside the view)
  where the mist's thick: bushes 95-130 m (was shrinking 55-75), rocks 80-110, ferns 40-55.
- **Grass off** (`GRASS` in nature.js: tufts, tall grass, wildflowers, reeds; their code kept).
- **Flowering bushes**: a new texture layer, FLOWERING (textures.js): the leaves with 40 small
  five-petalled flowers over them, twice as bright; every card of a flowering bush wears it, and
  nature.frag colours the bright texels in the kind's uBloom (white, pink, lilac, muted) instead of
  the leaves' green. Far off, the mipmaps blend them into a paler speckle.
- **Trees**: the far model keeps the near one's crown card for card (copied), and only the twigs go
  (trunk, limbs and branches three-sided): ~3,300 vertices against ~9,100; from 90 m (was 70),
  the near one made within 115.
- **The ground cover culled**: drawn all round the camera, ~5 times what's in view. Now each kind's
  copies are sorted, as they're gathered, into buckets: within NATURE_NEAR (25 m), and 16 sectors
  round the camera; each frame only the runs of buckets the view may take in are drawn (the view's
  half-width + half a sector + how far the camera's moved since: asin(moved / 25)); a run is one
  draw, the copies' attributes re-pointed to its start (WebGL2 has no base instance). Gathered
  again once the camera's 12 m on. Bush cores coarse (20 triangles, was 80: hidden by the cards).
- **After** (576 × 360): ground cover 4.2 → 1.1-1.4 ms; in all ~3.1 ms (trees ~1.0, terrain 0.3,
  bamboo leaves 0.3, stalks 0.15). Not measured in Zen.

### Stutter and fans: tree models, culling, far trees (3 Oct 2026)

Asked for: "hyperoptimise the whole game"; then, midway: the flowering bushes too vibrant, the
game stuttering a lot and the fans coming on (grass suspected).

- **Where the time went** (headless Chrome, 1280 × 720, at 4042, 5433 facing back; GPU ms p50):
  11.6 in all, of which the trees 4.9 and the ground cover 3.9; everything else ~2.8 (terrain 0.9,
  bamboo leaves 1.0, stalks 0.3, clear 0.3). Single runs vary by ±2 ms (other things on the GPU):
  compare alternating runs.
- **The stutter**: timing each part of the frame (car, terrain, scatter, gathering, bamboo, tree
  models) driving the road for 20 s: everything under ~3.5 ms except the cherry and maple models,
  6.5 ms each on average, up to 21 ms, and all of a newly found group made in the same frame. Fixed:
  (1) trees.js writes vertices straight into one reused Float32Array (no array of numbers to push
  onto and copy): 2.1 → 1.3 ms a tree in Node; (2) one model a frame at most, nearest first; (3) a
  tree's far model only until it comes within TREE_DETAIL (95 m): 0.54 ms (the shape still grows
  from the same random numbers, its vertices not written; checked: the same far model either way).
  After: the worst frame 4-6 ms, but the first second (shaders compiling: 48 ms).
- **Far trees** (trees.js `treeModel`): from TREE_LOD (70 m) a cherry or maple draws its far model:
  trunk and limbs, four-sided; a card in a third of the clusters, twice the size, two each; its
  petals on cards twice the size: ~900 vertices, against ~9,100. Of 16 cherries and maples here,
  11 were 280-370 m off, deep in the mist, each drawn whole.
- **Culling**: cherries and maples out of view aren't drawn, the rest nearest first; broadleaf trees
  likewise, their per-shape lists of copies refilled each frame from those in view. Trees 4.9 →
  2.5 (far models) → 1.1 (broadleaf culled).
- **Ground cover**: grass shrinks away by 30 m (was 50), ferns by 32 (was 40), bushes by 75 (was 95),
  bushes 16 leaf cards (was 22, now 15% bigger). By group, before these: grass 0.9, ferns 0.8,
  rocks 0.5, bushes 1.0. Flowering bushes muted (colours ~0.5 rather than ~0.85) and on a fifth of
  their cards (was 40%).
- **After**: 6.2-7.8 ms in all (was 11.6): trees ~1.1, ground cover ~2.6-3.0. Not measured in Zen.

### Our own ground cover and maples, instead of the nature pack (3 Oct 2026)

Asked for: the pack's models didn't fit the look of the rest; take all of it out, and make our own,
as the cherry trees are: high-performance grass, bushes and rocks. All of it is now made in code at
startup (`nature.js`, no files to load); `bench/nature.py` and the pack's `game/` folder are gone,
build.sh no longer copies it (dist 3.2 MB → 1.3 MB). The pack itself was deleted
from assets/ too (3 Oct 2026).

- **Kinds** (30, in `nature.js` `KINDS`): grass tufts (4 shapes, 9 blades), tall grass (2), tufts
  with wildflowers (4: white, buttercup, violet, pink), reeds with bulrushes (2), ferns (3), stones
  (clusters, 2), rocks (3), a slab, boulders (2), bushes (4 shapes) and bushes in flower (3: white,
  pink, lilac). Per vertex: position, normal, uv, sway, colour, layer (13 floats); per copy as before.
- **Look**: grass, reeds and ferns are solid triangles in vertex colours (dark at the root to the
  meadow's green at the tip, some dry), lit mostly as the ground under them; bushes a dark lumpy core
  (an icosahedron split once) with 22 leaf cards laid round it facing out, wearing a new texture
  layer, LEAF (textures.js: a spray of broad pointed leaves, grey, tinted by the vertex colour),
  or the blossom's for the flowering ones; rocks lumpy icosahedra, faceted, mottled and mossy on
  top in the shader (two noises), shining wet in the rain, as the bridges' timber does.
- **Where**: tufts on 1 m squares as before (reeds on the banks; tall grass and wildflowers in the
  open), ferns on 3 m squares under the bamboo and along its edges, bushes on 6 m, rocks on 5 m
  (more on the banks and steep ground). Boulders only 6 m or more from the road, and they stop the
  car (`rockWall`, from the gathered copies, in main.js's `wallAt`).
- **Maples** (trees.js): made as the cherries are (`treeModel`, `tree.kind === 'maple'`): forking
  higher, fewer and more upright limbs, LEAF cards (1.8 m) in the tree's own crimson, scarlet,
  orange or gold, now and then the next colour; fallen leaves under it (the petals' cards, in its
  colour). At most 4 a group, as the cherries. Its leaves' cut-out is dithered by cover
  (built.frag): cut at half, a maple 60 m off showed bare branches (the mipmaps average leaf and
  gap). Broadleaf trees are all the tree_01 model again.
- **Cost** (headless Chrome, 1280 × 720, at 4042, 5433 facing back; GPU ms per frame, p50):
  - First version, 450 × 237 driving the road: 19.7 ms. By group: ferns 8.9, grass 5.7, rocks 4.8,
    bushes 1.0. Two causes. Tiny triangles: far off a blade or a leaflet is under a pixel, and the
    GPU shades at least a 2 × 2 block per triangle; so one triangle a blade (was three), ferns 5
    steps a frond with shared stem points (was 9, unshared), stones and rocks on a plain icosahedron
    (20 faces; boulders and slabs 80). And `discard`: every pixel of every kind went through the
    near camera's fade (near.glsl), and a shader that can discard stops the GPU hiding what's behind
    before shading it, so grass drawn over itself was shaded every time. nature.frag is now compiled
    twice (`#define SOLID`, gl.js `loadProgram`'s new `defines`): the solid kinds (all but the
    bushes) without the fade or the cut-out, drawn first. Then: grass 1.5, ferns 2.0, rocks 1.2,
    bushes 1.4. Ferns fade by 40 m (was 60) and rocks by 75 (was 120): 3.6 ms.
  - Here: the ground cover 3.5 ms, the trees 4.8 (maples now cards, as cherries), all 10.7;
    with ?nonature 8.2. (The pack was 3.1-3.2 ms here, all 12.3.) Not measured in Zen.

### The nature pack: ground cover, more trees, meadows (3 Oct 2026) (replaced the same day: above)

Asked for: the open areas looked off and bland; use the CC0 nature pack (assets/retro_nature_pack,
by ElegantCrow: 8 trees, 8 bushes, 12 grass models, low-poly, 128-256 px textures in four seasons)
to improve everything. The plan: (1) ground cover over the whole map: grass tufts and patches on the
verges, in the clearings and on the river's banks, bushes along the groves' edges and in the
clearings, some in flower; (2) the pack's trees among the broadleaf groups, and red autumn maples in
groups of their own; (3) meadow ground in the clearings instead of leaf litter; (4) all of it
instanced, cheap enough.

- **Files** (`bench/nature.py` → `assets/retro_nature_pack/game/`): the 27 models in one OBJ;
  textures in two strips, each a texture array: 18 layers of 128 × 128 (grass, the 8 bushes in
  summer and 7 flowering spring ones, picked by measuring: over 2% of texels bright and not green)
  and 11 of 256 × 256 (8 trees in summer, the 3 reddest in autumn: tree04, 03, 02); clear texels'
  colours bled in (black in the pack).
- **Drawing** (`nature.js`, `shaders/nature.*`): every model in one vertex and one index buffer;
  per kind (36), a VAO and a buffer of copies, one instanced draw each. Copies shrink to nothing
  between two distances (grass 40-55 m, its patches 35-50, bushes 70-95) rather than vanishing.
  Foliage lit as if facing out from the plant's middle and up; sways, the higher the more; alpha
  dithered; texture × 1.0 (× 0.8 read as black tufts against the ground).
- **Scattering** (`nature.js` `scatter`): each chunk, when it's uploaded, on world squares (so a
  chunk and its finer children agree), from its vertices (height, road edge, grove byte, slope):
  tufts on 1 m squares (finest chunks only), grass clumps and patches on 4 m, bushes on 6 m (two
  finest levels); flowering bushes 35% in the open, 10% elsewhere. 0.07 ms a chunk. Reeds: tufts on
  the banks' slopes round the water's edge (the riverbed's byte can't tell the bed from the bank at
  the waterline, so only where it slopes). Gathered from the drawn chunks within each kind's fade
  (+15 m) whenever the drawn chunks or the trees change, at most every 250 ms.
- **Grass off** (later the same day, asked for): `GRASS = false` in nature.js: no tufts, clumps or
  patches (bushes, trees and the meadow ground stay). True brings them back as measured here.
- **Trees**: groups now 25% cherries (at most 4 a group, was 8), 12% maples, the rest broadleaf, 60% of
  those the pack's (1.5-2.1× its size: 6-11 m). Trunks stop the car as before.
- **Meadows** (terrain.frag): level ground where the bamboo's thinner than 0.4 is grass, greener
  or drier in broad patches (the litter's texture at 1/8 scale), the litter showing in places.
- **Near the camera** (`shaders/near.glsl`): trees and plants fade out (dithered) from 4.5 m to none
  within 2 m of the camera: the chase camera was looking out from inside cherry crowns by the road.
- **Cost** (headless Chrome, 1280 × 720, at 4042, 5433 facing back; GPU ms per frame, p50):
  - First version: the pack 17-18 ms. By kind: bushes 13.8 (~4,300 of them, to 190 m: their crossed
    cards drawn over each other many times), grass patches 2.5, tufts 1.8 (~16,000), pack trees 0.5.
    Fixed: bushes nearer and fewer (6 m squares, fade by 95 m), patches fade by 50 m, and only
    chunks within reach gathered: ~5,500 tufts, ~330 bushes; the pack 3.1-3.2 ms.
  - Found on the way: the trees from before (cherries, broadleaf) cost 7.7 ms: cherries ~0.19 ms
    each (31 here), the tree_01 broadleaf ~0.035 (49). Cherry groups capped at 4: 14 here, the trees
    4.4 ms. (Moving the blossom's shading noise into the vertices and the petals' edge noise to a
    cheap wave changed nothing measurable: it's their geometry and cards, not the shading.)
  - Now: all GPU sections 12.3 ms, 9.1 with `?nonature` (new: turns the pack off, to measure it).
    New profiler sections `trees` and `nature`. Not measured in Zen.

### Broadleaf trees, and trees in groups (3 Oct 2026)

- **The model**: assets/tree_01 (laubbaum.blend, from the user: three trees, 720 vertices each, and a
  1536 × 2048 texture of a twig card, a leaf card and bark). No Blender here: `bench/blend2obj.py`
  reads the .blend itself (2.67, 64-bit: its blocks and the DNA that describes their structs: each
  object's mesh, MVert/MPoly/MLoop/MLoopUV, moved by its obmat, z up to y up), and
  `bench/tree01.py` splits it into tree_a (Circle to Circle.004 and the 53 Plane leaf cards), tree_b
  (Circle.005) and tree_c (Circle.009), each standing at 0, 0, 0 (8.0, 7.9 and 9.6 m tall), as
  `tree_01.obj`; and the texture at 384 × 512 (`tree_01.png`, 350 KB; ~90 texels a metre on a leaf
  card), its clear texels' colour filled in from the leaves round them (black in the original:
  the mipmaps would have darkened every leaf's edge).
- **Drawing** (trees.js `loadBroadleaf`, `shaders/tree.*`): the three shapes in one buffer (2,604
  vertices each, as triangles), one instanced draw per shape for all the trees of it (where each
  stands, turned, 0.8-1.2× its size). Bark smooth-shaded; leaf cards lit as if facing out from the
  crown and up; leaves sway, more the higher. Alpha dithered (not cut at half), so crowns don't thin
  far off. Its texture's lighting is a sunny day's: × 0.75. Mipmapped, linear (a photo, not texel art).
- **Groups** (terrain.js `groupIn`): in each 35 m square, one in 0.8 has a group round a point in its
  middle, if that's within 30 m of a road's edge or 20 m of a river's: 1 to 8 trees (mostly few)
  within 12 m, 4.5 m apart at least, each checked where it stands (as before; broadleaf trees may
  stand where the bamboo's up to 0.5 thick, cherries 0.15, with a clearing round them). 3 in 10 groups
  cherries, the rest broadleaf. Over 16 places 3 km apart: ~55 trees within 450 m (0-98), ~11 of them
  cherries (were ~13 trees, all cherries). Finding them: median 1 ms every 50 m driven, at most 17 ms
  (a square with a big cherry group: each cherry samples 121 ground heights for its petals); 15-70 ms
  on a jump to a new place.
- **Trunks**: every trunk stops the car at least 0.36 m round (`WALL_RADIUS`): a broadleaf's (~0.16 m)
  slipped between the car's wall points (0.6-0.7 m apart) on a glancing hit, and the car drove through
  it. Two more wall points down each side. Driven at a broadleaf from three angles: stopped each
  time, 2.3 m from the trunk. Physics bench unchanged.

### Cherry trees in blossom (3 Oct 2026)

Then, asked for: three times the branches, and the fallen petals seen much further off and thinning
out at their edge (the square cards showed: the petals stopped dead at the last whole square).

- **Branches**: 5-7 limbs (was 3-5), each into 3-5 branches and those into 3-5 twigs (was 2-3):
  ~3× the branches. Twigs 4-sided; 3 blossom cards per cluster (was 5), as there are ~3× the
  clusters. ~9,200 vertices a tree (26 near the bridge at 4042, 5433: 11.5 MB, 109 ms to make).
- **One buffer per tree** (main.js `TREE_SLOTS`, 48, made at the start): all trees in one buffer,
  refilled whenever one came or went, would now be ~11 MB each time; a tree found now fills only its
  own (~0.44 MB, its model made then, ~4 ms).
- **Petals**: reach 7 m (was 4.5; terrain.js's ground grid 11 × 11, ± 7.5 m), their texture laid
  by where they are from the trunk, so built.frag thins them from 1 m out to none by 7 m, the edge
  wandering ±1.25 m by noise. Not cut at half alpha but against a random threshold per 4 cm of ground,
  so far off, where the mipmaps average them, they're still a pink speckle; and thinner from 15 to
  60 m away. (The screen's 4 × 4 dither pattern, tried first, drew a far patch, squeezed into a few
  rows at a glancing angle, as a regular dotted line.)

- **Where** (terrain.js `findTrees`): in each 20 m square, one in 0.8 might have one, at a random
  point in its middle; it does if that's a clearing (grove under 0.15 there and under 0.45 3.5 m
  round it), within 3-16 m of a road's edge or 14 m of a river's, out of the water, and fairly level
  (under 1.8 m of rise across 6 m). Each square is worked out once and kept while near (450 m).
  Rejections over 16 places 3 km apart: 4,300 too far from a road or river, 1,141 the odds, 168 not a
  clearing. 50 m squares gave ~2 trees within 450 m; 20 m squares give ~13 (0-23). Cost: ~2.6 ms
  every 50 m driven (with the bridges' search), ~40 ms on a jump to a new place.
- **Model** (trees.js `treeModel`, made once per tree): a trunk (0.24 m, forking at 1.7-2.5 m,
  leaning a little, starting 0.5 m underground) into 3-5 limbs spreading wide, each into 2-3
  branches, each into 2-3 twigs; tapered 6-sided tubes, bent between their two pieces. Blossom: 5
  cards crossed at random, 1.1-1.7 m, round each twig's end and each branch's middle, lit as if
  facing out from the crown. Fallen petals: cards on the ground's 1.5 m grid (heights from terrain.js,
  2 cm above) within 4.5 m of the trunk.
- **Textures** (textures.js, layers 10-12, so 13 now): BARK (reddish grey, pale lenticel bands round
  it), BLOSSOM (900 five-petalled flowers in a lumpy round clump, alpha cut), PETALS (scattered, in
  drifts). All 13 layers take 91 ms.
- **Drawing**: built.vert / built.frag, a buffer of their own, without culling (both sides of the
  cards); bark mottled and mossy, blossom and petals alpha-tested, the blossom lit softly and shaded
  in patches (noise at 0.7 m), stirring 5 cm in the wind. First pass was too bright and flat a pink
  for the dusk: colour [0.95, 0.72, 0.80] to [0.80, 0.56, 0.64], less light.
- **Trunks stop the car** (trees.js `treeWall`): the car's wall points (car.js `WALL_POINTS`) now add
  points along the bumpers and down the sides, at most 0.6 m apart, as a trunk could slip between
  the bumper's corners (1.48 m apart). Driven at a trunk: from 9.7 m/s to a stop with the bumper on
  it. Physics bench unchanged (on the road 23.0 m/s, 0 jumps; off road identical with or without the
  new points).

### Bridge ends sunk into the road, river plants and boulders, aged timber (2 Oct 2026)

- **Bridge ends** (terrain.js `BRIDGE_SINK`): each deck runs on 1.5 m into the road at both ends,
  sinking to 10 cm below it, so the ground swallows its ends evenly (before, only where the road
  bulged above the deck's straight end piece: one end, by chance). The end posts reach 30 cm below
  the deck. The car doesn't drive on the sunk ends but on `drive`, the deck carried straight on:
  driving the sunk kink at 25 m/s gave 4 jumps and a tip-over in the 40 min on-road bench (from 0);
  with `drive`, back to 0 (23.0 m/s).
- **End posts**: their caps (two blocks on top) taken off, as asked.
- **Big boulders** (terrain.js `bigBoulder`): in each 16 m square, 30% have one, 2.2-3.8 m across,
  0.4-1.2 m out of the water, a lumpy dome; only where its middle is in the water. Solid ground
  (the car hits them), textured as riverbed.
- **On the water** (water.frag `floating`), procedural, nothing added to the buffers: lily pads in
  patches (1.6 m squares, likelier in the thick 9 m patches), 0.6-1.1 m across with a notch and
  veins; one in 8 with a pink lotus (eight petals, yellow heart); fallen bamboo leaves (yellowed,
  brown or green), drifting back and forth, slowly turning. Pads fade out from 50-90 m, leaves from
  20-40 m (smaller than a pixel beyond).
- **Aged timber** (built.frag): each board its own shade (by which 25 cm board across the grain),
  weathered silver-grey in patches and darkened in others (noise at 1.7 m), a fine mottle (12 cm), and
  moss in patches, more on what faces up, speckled. First tried heavier (threshold 0.62): the deck
  read as mostly green; 0.68-0.82 is subtler.
- **Cost**: chunks 0.68 ms (unchanged). The water's and timber's extra shading isn't measured
  (headless Chrome only; few pixels).

### Deeper rivers, water as its own layer, narrower bridges (2 Oct 2026)

Asked for: rivers were too shallow (the bed was the water's surface: you could drive along them),
the bed too flat, the textures glitched by the banks, and the water zig-zagged at its edges (it was
painted on the land's vertices: a hard cut where the interpolated grove byte crossed -0.5). And
bridges ~30% narrower.

- **Bed** (terrain.js `riverBed`): the banks carry on down under the water to a bed `RIVER_DEPTH`
  1.6 m deep in the middle (60% of that at the sides), uneven (±0.5 m noise at 6 m), with boulders
  (noise at 2.5 m, up to 2.2 m tall), the tallest breaking the surface by up to 0.35 m. 2.6 m was
  tried first: the car vanished completely under the water; at 1.6 m its roof shows.
- **Water** (`shaders/water.vert` / `water.frag`, main.js): a layer of its own, on the chunk's grid
  (not its skirts), for chunks with a vertex within 4 m of a river's edge (`slot.wet`): per vertex the
  water's height and how deep it is (`slot.water`, 2 shorts). Blended over the land, no depth
  writes, drawn after the land; murky, see-through in the shallows (35% opaque at the edge, 95% from
  1.6 m deep), reflecting the sky as the puddles do, with small drifting waves and the rain's rings
  (`ripple` moved into `shaders/ripple.glsl`, shared with terrain.frag). The shoreline is now where
  the land's triangles cross the water's: smooth, at every level of detail.
- **Banks**: the grove byte is now, where negative, how much riverbed a vertex is: -127 under the
  water, fading to 0 from 0.5 to 2.5 m past its edge (it blends smoothly into the groves, which start
  2 m out). terrain.frag textures it as dark wet silt and stones (the bank texture laid flat at half
  scale; hung down the slope where steep), with a little shine.
- **Wading** (car.js `WATER_DRAG`, terrain.js `waterAt`): the water slows the car, by up to 1.6/s
  once 1 m in. In headless Chrome, full throttle along a river: 10 m in 5.5 s, and the boulders turned
  it into the bank. The camera stays 1 m above the water.
- **Bridges**: `BRIDGE_NARROW` 0.7: half-widths 2.3-2.6 m (were 3.25-3.75), narrower than the road:
  one car at a time; the end posts stand in the road's edges.
- **Cost**: chunks 0.68 ms each (bench/build.mjs); physics bench unchanged (23.0 m/s, 0 tip-overs).
  The water layer's GPU cost is not measured (only chunks near a river draw it).

### Timber bridges with railings that stop the car (2 Oct 2026)

Every bridge is now a weathered timber bridge, built of blocks in code (`blocks.js` lays boxes along a
line into one buffer, drawn by `shaders/built.*`). Each has a plank deck laid across two beams, a
railing each side (posts every 2 m, a top rail and a middle one), taller capped posts at the ends, and
bents of two piles and a cross-beam into the river every 7 m and at its middle. A timber texture was
added (textures.js `wood`, 16 texels a metre): boards with gaps, butt joints, nails, knots, and some
greyed by weather. Decks and railings run 0.3 m past each joint, so a bend leaves no wedge, and so
does `groundAt`'s deck (1 m).

The railings stop the car (bridges.js `bridgeWall`, blocks.js `inBox`): the body's hull points are
pushed out of them by physics.js's `collideWithWall`, with the same impulses as the ground (bounce 0.2,
friction 0.3), so it knocks and scrapes along. Checked in Node: steering into a railing from the
middle of a bridge, the car slows from 18 to 9 m/s and stays on the deck.

The same day, stone and vermilion bridges, tunnels, villages with lanes and block houses, and rice
paddies were built, then all undone at the user's request, leaving only these timber bridges. Things
learnt then, in case they come back:
- A terrain shader that can `discard` loses the early depth test: 33% more terrain GPU time, even
  with nothing discarded.
- A height-field can't have a hole for a tunnel's mouth.
- A cache of village houses must only be filled from a road search that covers them.

### Rivers and bridges (2 Oct 2026)

The start of making the world worth exploring (the plan: postage stamps to collect across the map).
Bridges are plain blocks for now; models can come later.

- **Rivers** (terrain.js, "Rivers"): where a broad noise (2,400 m) plus a little of a finer one
  (350 m, so they meander) crosses 0. The distance from a river's middle is the noise over its slope,
  worked out on an 8 m grid and blended. Rivers are 12 m wide and run along the floor of a broad
  valley: the hills and ridges sink to the valley floor within 350 m of the water (relief), so the
  roads, which follow the land, come down to them. The water is level across the river, 1.5 m below
  the valley floor, between banks of 1.5 m up per m out. The land, roads included, is cut down to the
  banks wherever it's higher. Water vertices carry -127 in the grove byte, and terrain.frag draws them
  as dark water that reflects the sky like the puddles, with the rain's rings. There's no bamboo
  within 8 m of the water. Roads stop bending (their meander and winding) from 150 m to 20 m from a
  river, so they cross it straight.
- **Bridges** (terrain.js, findBridges; bridges.js; shaders/bridge.*): over every road piece the
  banks cut into, plus one more each end, each corner as high as the road there (+5 cm), so a bridge
  follows the road even where it runs along a river. Found among the roads within 500 m of the camera,
  again every 100 m (0.3 ms on average, 1 ms at worst, in Node). Each piece is drawn as a deck, a low
  wall each side, and a pier under the river's middle. The car drives on `terrain.groundAt`: the
  ground, or a deck where that's higher.
- **Measured** over 24 × 24 km: 278 bridges (one per ~2 km²). Lengths: median 40 m, p90 70 m, at most
  211 m (a road alongside a river). Deck over the river's middle: at least 1.7 m, median 4.8 m. Before
  the valleys were widened (150 m) the median was 6 m and some were 25 m+. 8 bridges are over a bank
  only (the road comes close without crossing). Every road corner the banks cut into is on a bridge
  (54,661 checked); before bridges started from any cut piece, not just crossings, 20 weren't.
- **Cost:** chunk building +11% (0.68 to 0.76 ms a chunk in Node). Worked out at every vertex, the
  river was +57%; the 8 m grid with a small table of its corners, and passing the distance on rather
  than asking again, brought it down.
- **Not yet:** the walls and pier don't stop the car (it can drive off a bridge into the river, and
  drives on the water: T tows it back). The water is level across but follows roadLevel along the
  river, so it slopes gently (up to ~5%).
- `bench/relief.mjs` now draws the water (blue) and the bridges (red, near the centre). `?spawn=x,z,back`
  faces the car the other way along the road.

### Sunny day, then the rainy night, then the rainy dusk (2 Oct 2026)

Then, asked which "original" they meant, "Yes dusk": back to the rainy dusk of before 1 Oct 2026
(`sky.glsl`'s colours and light, the clear colour in `main.js` and `sky.frag`'s comment exactly as
in the commit f56071f), headlights on. Kept from since: the tail lights' glow on the road, rain not
lit by the headlight, no rain splashes, the `uWeather` switches; the night's and day's values are
in `sky.glsl`'s comments. Checked in headless Chrome.


Back to the rainy night the same day ("Sunny doesn't really fit the aesthetic - can you revert to
the original old rainy and dark"): the night's colours and light in `sky.glsl` and its clouds in
`sky.frag` exactly as before, `RAIN = 1, LIGHTS = 1`. Kept: the `uWeather` switches (at 1 they do
just what the old code did), `daylight()`, and the day's values in `sky.glsl`'s comments, for
weather that changes over a drive later. Checked in headless Chrome: the same night as before.
The sunny day, as it was:

Asked for: "revert back to day and make it sunny, save rain and night for later, we could make
that dynamic". Not a revert to the dusk (that was overcast and rainy): new day colours, a sun and
white clouds (see "Sunny day" in the look table). Rain and night are switches now, in a new vec4 at
the end of the frame block (`uWeather`: x rain, y lights; `frameData` 40 → 44 floats), set from
`RAIN = 0, LIGHTS = 0` in `main.js`: the rain isn't drawn, its sound is silent, the road's
wetness and puddles (and their splashes) are scaled by it, the headlight and most of the tail glow
by the lights. The sky and light colours are still constants: making day and night change over a
drive means turning those into uniforms too. `dusk()` is now `daylight()` (and `vDusk`
`vDaylight`).

Checked in headless Chrome (three places along the roads, and a drive with `?profile`): it draws,
GPU per frame much as before (land 0.52 ms, leaves 0.49, stalks 0.31, sky 0.05; rain 0). Colours
judged by eye from the screenshots, not tuned further.


### Sound, controls hint, tail lamps, car shadow, touch controls (1 Oct 2026)

Asked for: "Add control hint and sfx and make a bamboo rustle sound. Then subtle rounded brake lights
and remove the vertical brake light strip. Add car shadow. Finally add touch controls." (And the slow
first load: "likely browser related", left.)

- **Sound** (`sound.js`, Web Audio), started by the first key or touch (and woken by later ones: a
  touch only counts once the finger lifts; checked in an emulated phone):
  - The engine: the downloaded `Car_Engine_Start_Up` once, then `Car_Engine_Loop` looping, its speed
    following the back wheels (0.75× idling to 1.75× at 30 m/s), louder and brighter (a low-pass
    opening up) on the throttle. Converted to WAV by `bench/sounds.mjs` (headless Chrome decodes the
    OGGs: Vorbis, which not every Safari can; 22,050 Hz mono; the loop's end crossfaded into its
    start over 80 ms; the start-up scaled down from a peak of 1.18): 124 + 84 KB.
  - Made in code: rain (a hiss, and a lower patter); the tyres' grit (bursts of noise a few ms long,
    played faster the faster they roll; softer off the road); sliding; splashing through puddles
    (`kickUp` now says how many tyres are on the road and in puddles); and the bamboo: leaves
    brushing (longer bursts, high-passed) as loud as the car is pushing stalks aside (`bamboo.js`'s
    new `pushed`, radians a frame) plus a little for those still springing back, and now and then a
    hollow knock (two tones, the second an overtone, dying in 0.14 s) for a stalk it reaches, at most
    about 6 a second.
  - M mutes; it stops while the page is hidden. **Not heard by me** (headless): the levels are guesses
    to tune by ear. The audio context runs; no console errors.
- **Controls hint** (`ui.js`, `style.css`): the keys along the bottom, fading 8 s after the first
  press; H shows or hides it. On touch screens, one line about the buttons.
- **Later the same day:** the rain's splashes of droplets round the car taken out (`rainOnGround`:
  lit by the headlight, they flickered; the streaks themselves no longer catch the headlight either;
  the rings on the puddles stay). The bamboo's data textures are filled with zeros when made: Firefox
  warned that it was clearing them itself before the first partial upload. (It also warns that
  uploads "from a buffer with a final row with a byte count smaller than the row stride" can cost
  extra: the bamboo's rows through their pixel buffer; not reproduced here, left.)
- **Touch controls, later the same day: one joystick, nothing else** (asked for: "a single joystick
  with no other controls"). A ring resting at the bottom left; a thumb down anywhere brings it there;
  dragging up to 60 px steers as far as it's pushed, and past a third of the way up or down presses
  the accelerator or the brake. No hint on touch screens. The first touch goes full screen (the whole
  page, so the joystick comes too) and locks to landscape where the browser allows (Android; iPhone
  Safari can't, so `index.html` has the web app tags and `manifest.webmanifest`: added to the home
  screen, it opens full screen, sideways). `100dvh` for the canvas, so phones' moving toolbars don't
  leave a gap. Checked in Chrome emulating a phone: drives, steers, sound starts, full screen.
  Tow, flip and mute have no touch control (the car rights itself after 2 s stuck anyway).
- *(First version, replaced:)* **Touch controls** (`ui.js`), only on touch screens (`pointer: coarse`): a steering pad on the left
  (which side of its middle each thumb is; slide across), the accelerator, brake and handbrake on the
  right, tow / flip / sound along the top. They hold the same key codes in `held` as the keyboard.
  Checked in Chrome emulating a phone sideways (844 × 390, 3×): driving and steering work. Also: a
  viewport meta tag, and the pixel blocks are sized from the screen's shorter side (a phone's
  `screen.height` stays its long side turned sideways).
- **Then, same day:** the shadow taken out again; night instead of dusk, with stars; the brake
  lights' red glow on the road behind (see the look's table).
- **Brake light strip removed** (`car3_zen.png` repainted without the bumper's light). Round lamps drawn over the tail lights the same day were reverted: the user wanted the texture's own lights, always on and glowing, kept. **Shadow:** see the look's table.
- **Engine quieter** (asked for, same day): running 0.22-0.46 → 0.09-0.20, start-up 0.5 → 0.2. Changed by ear-less guess.
- **Speed:** a 25 s `?autodrive=road` drive: JS p50 1.1 ms, p99 2.3, terrain GPU 0.50 ms, no late
  frames: as before. `dist/` 41 files, 624 KB (the two WAVs added to `build.sh`).

### Tow fixed and its pause cut; first-frame warm-up; fps in the profile (1 Oct 2026)

Asked for: the tow freeze and pause (from the review below); "the game also stutters on first load";
and "ran really slow when I tested it in safari on an m4 macbook - both safari and zen were faster on
my intel machine". Headless Chrome on this machine (Intel), test server on port 8002 (the user's
8001 left alone); the scripts are in the session's scratchpad (`fix/`).

- **Tow freeze fixed.** `nearestRoad` searches one cell each way, and two if no road comes within
  one (a road found further away than the square searched reaches might not be the nearest).
  40,000 random places: no NaN (was 1), the known spot (−517345, −353763) finds its road 1,771 m
  away; 0.59 ms a call, slowest 2.7. And T does nothing if the answer isn't finite (never seen).
- **Tow pause: 158-178 → 34-46 ms** (the frame after T, JS; 6 tows of 5-15 km, in the browser,
  through a DevTools breakpoint at the end of a frame: the tow done there, timed the next frame).
  1. Not building everything missing (`cut ? Infinity : budget`), only the holes inside `SEEN`,
     as every frame does: 86-119 ms. Fewer than measured in Node in the review (39-56 ms, which
     had the road cache warm): cold, it's ~130 chunks. Plus ~22 ms of uploads in the frame.
  2. **Only the holes on screen** (`terrain.update`'s new `planes`): 34-51 chunks of ~130. A
     hole's box is tested against the view from the land's lowest to its highest (−60 to 100 m:
     the land measured −39 to 75 m in every chunk round 150 random places): tested as ±1000 m, the
     view volume, tilted down, took in the bottoms of boxes behind the camera and almost nothing
     was left out (~100 holes). The rest are built by the budget over the next few seconds, nearest
     first, so turning finds few: after each tow, driving in a tight circle for 5 s filled 0-9 holes
     as they came into view, 1-2 in a frame, 1.6-4.1 ms; no frame over 5 ms; no gaps in the land
     in the screenshots.
  - A 30 s `?autodrive=road` drive is unchanged (before / after: JS p50 1.3 / 1.0 ms, p99 2.4 /
    2.2, 1 late frame each, the first); `bench/keepup.js` none behind; `bench/build.mjs`'s
    checksum unchanged (962083aadeaf2ee3).
- **First load.** Headless Chrome shows no stutter: from the first frame (9.6-10.5 ms of JS, the
  first uploads) every gap is 16.6-16.8 ms, standing or driving. So it's likely the browser:
  Firefox (and so Zen) on macOS draws with OpenGL, which finishes making a program only the first
  time it draws with it. Every program draws on the first frame except the particles', which drew
  first a frame or two later, when the rain's first splashes appear. Now the first frame draws one
  particle anyway (the buffer's zeros: no opacity, every pixel discarded). GL error 0 on the first
  three frames; no console errors. **Not checked in Zen or Safari**: to see, `?profile`'s "late
  frames in 10 s" just after loading.
- **Safari on an M4.** Can't be run here (no Safari without taking over the screen, and this is
  an Intel Mac). The game's work is small for an M4 (~360 rows, ~3 ms of Intel GPU, ~1.2 ms of
  JS), so something outside it is the likelier cause; one candidate: Safari halves the frame rate
  in Low Power Mode. So `?profile`'s overlay now shows the frames a second (over the last 50
  frames) after the canvas size: 30 there would be Safari holding the page back; 60 with many late
  frames, the game. (The overlay already worked in Safari: no GPU timings, as in Firefox.)

### Renamed Easy Roads; on GitHub; ready for Cloudflare Pages (30 Sep 2026)

Asked for: "rename project as easy-roads and push to github", and "prep for cloudflare pages deploy".
Was "Zen Drive" in folder `drive-game`: now the page title, these notes, `bench/frames.html`, the
launch config and the folder are `easy-roads` / Easy Roads. Pushed to a private GitHub repo,
`AN1001/easy-roads`. `build.sh` copies what the game loads into `dist/` (37 files, 376 KB: no
notes, benches or .blend files); `dist/` checked in headless Chrome through the dev server
(`/dist/`): every file loads, GL error 0. See Tools for the Pages settings.

### Code review: bugs and speed (30 Sep 2026)

Asked for: "a full codebase review looking for bugs and performance improvements". Every file read
(game, shaders, benches); nothing changed yet. Scratch scripts in the session's scratchpad (`review/`).

**Bugs found (not fixed yet).**

- **Towing (T) far from any road freezes the game.** (Fixed 1 Oct 2026: see above.) `nearestRoad` searches one cell (1,600 m) each
  way (the comment on `searchList` says two). With no road piece in that square it answers NaN: the
  car is placed at NaN, and the next frame throws in `terrain.update` (`slots[NaN]`), which stops
  the game loop. 1 of 40,000 random places, e.g. (−517345, −353763), where the nearest road is
  ~1,771 m away; 8 more found a road over 1,600 m away, which may not be the nearest. Reachable by
  driving ~1.6 km across country, or with `?spawn=` there. Fix: search ±2 cells when nothing is
  within one (`NET` allows it), and don't tow if the answer isn't finite.
- **Stale:** the ground under the groves is tinted as their tops from 80-150 m (`terrain.frag`,
  `CANOPY_FROM/TO`, "where clumps stand for the bamboo"), but since 29 Sep the clumps take over at
  180-200 m and stalks are drawn to 200 m. Possibly fine as a look; not checked by eye. Comments:
  `particles.frag` says the tail lights light the puffs (they light nothing); `bench/livery.mjs`'s
  `SPOILER` refers to car.js's spoiler (gone).

**Speed** (headless Chrome, 860 × 360, following the road for 40-45 s):

- JS per frame p50 1.2 ms, p99 2.3; only the first two frames over 3 ms (9.9, 3.4: startup). 1 late
  frame in 2,542. GPU ~2.9 ms: leaves 0.86, terrain 0.77, stalks 0.48, clear 0.18, clumps 0.12,
  the rest under 0.1 each. No page errors, GL error 0.
- CPU profile (20 s): busy ~0.65 ms a frame in our functions; `bamboo.update` 0.23 ms of it (35%),
  then `roadDistance`, `layers`, `buildRow` ~0.03 each; garbage collection 6 ms in 20 s.
- `bench/keepup.js`: none behind in any case, even 3 × slower.
- **A tow is one long frame** (cut to 34-46 ms on 1 Oct 2026: see above)**:** it builds everything missing around the new place at once, 230-270
  chunks, 142-180 ms (Node; it was ~40 ms, 81 chunks, when the tow was made a cut on 28 Sep). Filling
  only the holes inside `SEEN`, as every other frame does, is 64-81 chunks, 39-56 ms; the rest (in
  96%+ mist) would follow at the usual 1 ms a frame. Startup likewise: textures ~50 ms and puddles
  ~25 ms (while the shaders load), then 257 chunks in ~200-250 ms.
- Unmeasured, small: `terrain.frag` works out the sky's reflection and the headlight for every
  pixel, even off the road (no shine) and far past the headlight's reach.

### A little narrower and less windy (30 Sep 2026)

Asked for: "make them a little narrower and the roads a little less windy". `HALF_WIDTH` [3.5, 3, 3]
→ [3.25, 2.75, 2.75] (lanes 5.5 m, main roads 6.5); lanes' short bends `WIND` 14 → 10 m (main roads
4 → 3) and long ones `MEANDER` 42 → 36 m (main roads unchanged, 12). Changed by feel, not
re-measured.

### Narrower lanes (30 Sep 2026)

Asked for: "make the lanes narrower". `HALF_WIDTH` in terrain.js [4, 3.5, 3.5] → [3.5, 3, 3]: lanes
6 m wide, main roads 7 (between the original 5 / 6 and the 7 / 8 of the rally days). Changed by
feel, not re-measured.

### Back to the zen game: gentle lanes, green car, original handling (30 Sep 2026)

Asked for: "revert back to the zen game where the roads are less windy and the car is green". Asked
which parts: the original handling; the green paint without the spoiler, but keeping the always-on
tail lights (three times as bright braking) and the muddy bumper brake light; the old lanes, but
kept 7 m wide (main roads 8).
- `car.js`, `main.js`, `terrain.js`, `particles.js`, `bench/physics.mjs`, `bench/keepup.js` are back
  to the copy taken before the rally-stage and drifting work (29 Sep), then: `HALF_WIDTH` [4, 3.5,
  3.5] (was [3, 2.5, 2.5]); no spoiler (`parseBody` returns the body alone); the texture
  `car3_zen.png`. The tail lights were already in that copy.
- `bench/livery.mjs --zen` paints `car3_zen.png`: the model's green (both copies), and only the
  bumper's brake light (with its mud fleck). The rally livery is still made without `--zen`.
- Checked: `bench/physics.mjs` gives the original numbers (0-100 km/h 8.7 s; on the road 53.9 km at
  22.4 m/s, off the road 1.2% of frames, no tip-overs; off road 1 tip-over in 40 minutes).
  `bench/build.mjs` checksum `204cd64e4025a259`; keep-up at 30 m/s: none behind in any case.
  Headless Chrome: no page errors, GL error 0; the green car on the wide lane, its tail lights
  brighter and the bumper light lit, braking.
The rally version's files are kept in the session scratchpad (`rally_final/`). Not checked in Zen.

### Back to the handbrake drift (30 Sep 2026)

Asked for: "revert back to handbrake drift being the only drift". `car.js` is back to the version in
"Drift while Space is held" below (hold Space and steer above 8 m/s to drift, let go to straighten;
slower, the handbrake U-turn; slides from bumps only straightened), and `turnBody` is gone from
physics.js. Checked: the hold harness gives the same numbers as then (1.5 s at 12 / 18 / 25 m/s:
69 / 67 / 78°, 25-32° sideways, straight 0.52-0.62 s after letting go); 0 spins in 20 minutes of
random keys.

### Space: a tight turn instead of a drift (30 Sep 2026)

Asked for: "make space do a tight turn - in that it increases the turn radius" (turns tighter).
Checked with the hold harness, random keys (20 min, 60 min heavy on Space), the road drifter
(holding Space through corners), `bench/physics.mjs`; headless Chrome: no page errors, GL error 0.
- Held with the steering turned above 8 m/s, the car's path swings round a 10 m circle
  (`DRIFT_RADIUS`, was 25; at most 2 rad/s, `DRIFT_TURN`, was 1), and the car is turned with it
  (`turnBody` in physics.js), so it points where it goes; the tail's held ~11-14° out (`DRIFT_ANGLE`,
  was 26-37°), just a lean. Speed kept, as before. Let go: back in line in 0.25-0.33 s (was 0.45-0.65).
- Space + full lock 1.5 s at 12 / 18 / 25 m/s: the path turns 129 / 155 / 156° (was 69 / 67 / 78°),
  at most 11-12° sideways (was 25-32°). Normal full lock at 20 m/s is still 31 m.
- 0 spins in either random-key run. The road drifter leaves the road in 0.0% of its tight-turn frames
  (1.7% drifting). Off road, random (5% Space): 11 tip-overs in 40 minutes (8 before).
Not checked in Zen, and not driven by hand.

### Drift while Space is held; quicker acceleration (30 Sep 2026)

Asked for: "make the car drift only when space is pressed and return back when let go, it is
currently quite difficult to control, and make the car accelerate even faster". Measured in Node: a
hold-to-drift harness (Space and full lock held 0.5 or 1.5 s from 6-25 m/s, then let go), random
keys (20 min, and 60 min heavy on Space and brake), the road drifter (now holding Space through
each corner), `bench/physics.mjs`; headless Chrome: no page errors, GL error 0.

- **Space is the drift key.** Held with the steering turned, above 8 m/s (`DRIFT_SLOW`), the car
  drifts that way at full speed (the swing and speed-keeping from before); steer the other way and it
  swings across. Let go and the angle wanted is 0 at once: straight in 0.45-0.65 s. The tap, its 0.4 s
  kick and the tap-and-hold are gone. Below 8 m/s it's the handbrake, as before: the back wheels lock
  and the tail swings right round, a U-turn (so U-turns now need slowing to 8 m/s first). At speed it
  never locks the back wheels (Space held going straight at 29 m/s spun the car). The angle eases in
  over 0.15 s (was 0.3).
- **Acceleration:** engine 12000 → 16000 N, forward grip (`TRACTION`) 1.2 → 1.6, drag 8 → 10:
  0-100 km/h in 2.9 s (was 3.6), top speed the same (~37 m/s). Braking keeps its own grip,
  `BRAKE_GRIP` 1.2: with 1.6 it pulled 1.55 g, and a car still turning spun under it.
- **Spins found and fixed along the way:** hard braking at 23-29 m/s just after turning swung the
  tail round, the loaded fronts out-pulling the light backs. Now 70% of the braking is at the front
  (`BRAKE_FRONT`, was even); braking hard, a front tyre has up to 40% less grip to turn with
  (`BRAKE_TURN`); and a slide is caught from 17° (`DRIFT_FROM`, was 26°: it's only ever straightened
  now, so this doesn't bring back sliding).
- **Tip-overs:** the faster car and the drift at speed took random off-road driving from 4 to 14
  tip-overs in 40 minutes; the sideways tyre forces now push 28 cm up (`ROLL_CENTRE`, was 20):
  8, and the car leans 2.0° at the limit (was 3.4°).

| | Before | After |
|---|---|---|
| Letting go mid-drift at 12-25 m/s | straight in ~0.9 s | 0.45-0.65 s |
| Space + full lock 1.5 s, then let go, at 12 / 18 / 25 m/s: path turned, angle | (tap) | 69 / 67 / 78°, 32 / 27 / 25°, speed kept (15.8 / 21.6 / 27.1 m/s at release) |
| Road drifter: off the road while drifting | 5.4% | 1.7% (0.2% overall) |
| 0-100 km/h / braking from top speed | 3.6 s / 1.43 g | 2.9 s / 1.61 g |
| Random keys 20 min / Space-heavy 60 min | 0 spins | 0 spins (every swing past 100° a slow U-turn or reversing) |
| Autopilot on the road (40 min) | off 0.0%, no tip-overs | the same |
| Off road, random, 40 min: tip-overs | 4 (+2 before today) | 8 |

Not checked in Zen, and not driven by hand.

### Gentler drifts, wider lanes (30 Sep 2026)

Asked for: "Drifting is a bit too aggressive, can you tone it down and make the lane wider". Changed
by feel, then checked with the drift harnesses, the scripted drifter and `bench/build.mjs`:
- `DRIFT_RADIUS` 15 → 25 m, `DRIFT_TURN` 1.5 → 1 rad/s, `DRIFT_ANGLE` 46°/32° → 37°/26°. Held drifts
  settle at 25-32° (were 29-41°) and swing round 125-146° in 3 s (were 181-237°); a 90° corner at
  12-24 m/s takes 0.87-1.27 s (0.82-0.92), still at full speed. 0 spins in 20 minutes of random keys.
- Lanes 5 → 7 m wide, main roads 6 → 8 (`HALF_WIDTH` in terrain.js). The scripted drifter leaves the
  road in 5.4% of its drifting frames (11.9% before both changes), 0.2% overall. Build checksum
  `99c64d711328c46e`; headless Chrome: no page errors, GL error 0, the bamboo clear of the edges.
Not checked in Zen, and not driven by hand.

### Far less sliding; drifts that swing round like a handbrake turn, at full speed (30 Sep 2026)

Asked for: "make the vehicle slide around far far less and also make drifting like the handbrake
turn except it doesn't lose speed at all." Measured in Node (random steering over the terrain with
no handbrake, split by cause; the drift, U-turn and random-key harnesses; `bench/physics.mjs`);
headless Chrome: no page errors, GL error 0.

- **Sliding:** the tyres grip 1.4 sideways at the front and **1.5 at the back** (was 1.2 / 1.05):
  with the back holding more, the tail stays put and the car runs a little wide at the limit
  instead. Of what sliding was left, 63% was a slide (a landing, a bump) that became a drift and was
  then held because the key was into the turn: now only a handbrake tap starts a drift that can be
  held; a slide past 26° (`DRIFT_FROM`, was 15°) is caught and straightened.
- **Drifting:** after a tap, with the key into the turn, the car's path swings round at least as fast
  as round a 15 m circle (`DRIFT_RADIUS`; at most 1.5 rad/s, `DRIFT_TURN`), scaled by how far the
  eased angle has got; and until the brake (or the handbrake held past a tap) it keeps its speed.
  Not physics: the tyres act as before, then the velocity is turned and scaled to make it so.
  Holding the handbrake is still the slow U-turn (and slows the car).
- **The autopilot** steered twice as hard since the wider lock at speed (`STEER_FADE` 25) and weaved
  off the road (2.0% of frames): its gain is halved (3 → 1.5 per rad), 0.0% now.

| | Before | After |
|---|---|---|
| Random steering over the terrain: over 10° sideways / p90 | 8.2% of frames / 7.9° | 2.6% / 3.0° (what's left: landings, steep ground, slides being caught) |
| Full lock at 10 / 20 / 25 m/s | 6.4 / 35.7 / 55.7 m | 7.8 / 30.5 / 48.3 m, 1.3 g |
| 90° drift corner (tap, full lock) at 12 / 20 / 24 m/s | 1.03 / 1.68 / 2.0 s, slowest 10.7 / 18.0 / 21.8 | 0.82 / 0.92 / 0.87 s, slowest 12.1 / 19.9 / 24.1 |
| Held drift, 3 s, from 10 / 18 / 22 m/s: speed, path turned | 6.3 / 16.1 / 19.6 m/s; 228 / 118 / 99° | 11.2 / 19.1 / 22.9 m/s; 181 / 204 / 237° |
| Handbrake + throttle held, U-turn from 10 / 20 m/s | 1.25 s, 3.8 m / 2.17 s, 9 m | 1.20 s, 3.9 m / 2.07 s, 11.8 m |
| Random keys 20 min / handbrake-heavy 60 min | 0 spins | 0 spins (every swing past 100° a handbrake U-turn or reversing) |

`bench/physics.mjs`: on the road 42.6 km, no tip-overs, off the road 0.0%; off road 2 + 2 tip-overs
in 40 minutes (was 4 + 2). Not checked in Zen, and not driven by hand.

### Tighter turning (30 Sep 2026)

Asked for: "greatly increase the cars turning radius - you can barely turn it" (i.e. turn tighter).
Checked with `bench/physics.mjs flat` (full-lock circles) and the drift harnesses. Steering lock
alone hardly helped (0.5 → 0.6 rad and fading half as fast: 13.3 → 12.7 m at 10 m/s): full lock
already asked for more than the mud's sideways grip (0.9 / 0.8), so the fronts just slid. So the
tyres grip more sideways, **1.2 front, 1.05 back** (the back still less, so the tail goes first), with
**`MAX_STEER` 0.6** and **`STEER_FADE` 25** (was 10). `DRIFT_HOLD` back to 0.85, its value for 1.2.

| Full lock | Before | After |
|---|---|---|
| 10 / 15 m/s | 13.3 / 29.7 m | 6.4 / 13.0 m |
| 20 / 25 m/s | 44.6 / 74.0 m, 0.84-0.90 g | 35.7 / 55.7 m, 1.13-1.17 g |

Faster than ~18 m/s it's the grip that limits it, not the steering. Drifts: still steady (29-34°,
± 0.3-3°), 0 spins in 20 minutes of random keys; they now scrub more speed (from 10 m/s: 6.3 m/s after 3
s, was 10.0) and turn tighter. Not checked in Zen, and not driven by hand.

### Steadier drifts, and corners wide enough to drift (30 Sep 2026)

Asked for: "Can you make the drifting more controlled and stable and can you tune the turns in the
map to make them driftable - currently a lot are just too tight to drift properly". Measured in
Node: a drift-steadiness harness (tap and hold at 10-22 m/s: peak, settled angle ± sd, speed; keys
pulsed 0.3 s on / 0.2 s off), the U-turn and random-key harnesses, road statistics over 64 km, a
scripted driver that drifts every corner on the real roads (old and new roads, same car),
`bench/physics.mjs`, `bench/build.mjs`, `bench/keepup.js`; headless Chrome: no page errors, GL error 0.

**Drifting.** On flat ground a held drift didn't wobble; what wasn't steady was the speed. The
angle came from the speed *now*: a slow drift scrubbed speed, asked for more angle, scrubbed more,
and collapsed into a pivot (10 m/s → 3.6 in 3 s, 189° round). And letting go of a key for a moment
dropped the wanted angle to 0 at once, so tapping keys made the drift come and go (8-21°).
- The angle, glide and power are set once, from the speed the drift started at. (The handbrake-held
  U-turn angle still follows the speed now: that one should swing round as the car slows.)
- The slow angle 63° → 46° (`DRIFT_ANGLE`), and slow drifts put down 60% of the engine (was 50%).
- The angle wanted eases to where the keys say over 0.3 s (`DRIFT_EASE`). Letting go now
  straightens it in ~0.9 s (was ~0.65).

| Tap and hold, throttle | Before | After |
|---|---|---|
| From 10 m/s: settled angle, speed after 3 s | 54° ± 4.2, 3.6 m/s (pivoted 189°) | 39° ± 1.2, 10.0 m/s |
| From 14 / 18 / 22 m/s | 46° ± 1.3, 32 ± 1.1, 30 ± 0.4; 11.4 / 20.1 / 22.6 m/s | 36 ± 0.7, 32 ± 0.4, 30 ± 0.3; 15.2 / 19.8 / 22.8 m/s |
| Keys pulsed at 12 / 18 m/s | 10-21°, 8-18° | 21-27°, 18-23° |
| Handbrake held, U-turn from 10 m/s | 1.8 s, 3.3 m | 1.95 s, 3.3 m |
| Random keys, 20 min | 0 spins | 0 spins |

**Corners** (`terrain.js`): a drift goes round about 12 m at 10 m/s, 23 m at 15 and 35 m at 18, so
the corners were only driftable at a crawl. Radii: hairpins 11-14 → 18-24 m, squares 15-20 → 24-32,
tight 18-28 → 28-40, medium 30-60 → 40-70, fast 45-80 → 55-90. Wider corners fit less often (3.4 a
km), so the lanes' stretches between them are 25-110 m (were 40-200); that left less room for crests,
so they need 70 m (was 90) and come on 40% of long enough stretches (30%).

| Roads, 64 km | Before | After |
|---|---|---|
| Corners under 45 m | 4.65 a km, 294° of turning a km | 4.44 a km, 216° |
| Their tightest point: p10 / p50 / p90 | 13 / 20 / 39 m | 25 / 32 / 40 m |
| Bend radius at joints p5 / p25 / p50 | 17 / 61 / 171 m | 28 / 61 / 151 m |
| Crests | 1.64 a km | 1.67 |
| Closest roads (same / other) | 21.8 / 37.0 m, none under 15 | 30.7 / 34.7 m, none under 15 |
| Pieces per chunk, most (levels 0-2) | 64 / 73 / 85 | 74 / 84 / 90 (room for 176) |
| Scripted drifter, 26 km: off the road while drifting / overall | 19.6% / 9.4% | 11.9% / 1.8% |

The drifter taps the handbrake where the road turns 20° in the next 10 m (and 34° in 25), holds
into the turn while its travel lags the road 10 m on, and lets go when it doesn't. It's crude (a
person reads the corner better); the comparison is what counts. Lanes are 5 m wide, and a car 30°
sideways takes ~3 m of that: wider lanes would make drifting easier still.

`bench/build.mjs`: 0.65 ms per chunk, checksum `f243094c88621f3c`. Keep-up at 37 m/s: none behind
(5 of 2432 on the 3× slower machine at 30 fps). `bench/physics.mjs` on the road: 42.7 km at 17.8
m/s, no tip-overs, off the road 0.5% of frames. Not checked in Zen, and not driven by hand.

### Mud, all-wheel drive, and drifts for tight turns (29 Sep 2026)

Asked for: "Drifting is quite difficult on tight turns because once you start it is hard to stop and
it doesn't feel right. Can you make accelleration much faster - it's a rally car, and can you make the
car slide around more since its muddy. Can you change the drift to be more drifty since it is hard
to make U turns." Measured in Node: a new U-turn harness (180° from 10/15/20 m/s with various keys,
and stopping a drift), the drift tests, random keys, `bench/physics.mjs`; headless Chrome runs, no
page errors, GL error 0.

**Before:** a drift held 30° whatever the speed, and on the throttle sped up: a handbrake-tap U-turn
from 10 m/s took 3 s and 30 m; holding the handbrake stopped the car dead at 90°.

- **Acceleration: all-wheel drive, 12000 N** (40% to the front), air drag 8: 0-100 km/h in 3.6 s
  (was 5.6), top speed about the same (~37 m/s). Forwards the tyres grip 1.2 × load (`TRACTION`,
  knobbly tyres digging in), so it isn't held back by the mud's sideways grip.
- **Mud:** sideways grip 0.9 at the front, 0.8 at the back (was 1.2 both), so the tail steps out at
  the limit, and a slide past 15° becomes a managed drift. Full lock at 20 m/s goes round 45 m
  (was 36), at 0.9 g. Steering at random over the terrain with no handbrake, over 10° sideways in
  8.9% of frames (was 4.8%), p90 8.3° (3.5°).
- **Drift angle by speed:** started with the handbrake, it wants ~63° at 8 m/s and below, down to
  ~32° by 20 (`DRIFT_ANGLE`); started by a slide, always ~32°, or steering hard in a slow corner
  swung the car round in 1.5 m circles. With the handbrake *held*, from ~120° (free to swing right
  round: a U-turn) at 8 m/s to ~40° at 20. At speed 80° held spun it.
- **Glide and power by speed:** drifting, the scrub cut (`DRIFT_GLIDE` 0.3) and the engine put down
  (`DRIFT_POWER`, 0.5 → 0.75) grow from 8 to 20 m/s: a slow drift stays slow and tight, a fast one
  holds its speed (20 m/s held 3 s: 22). At full power a drift from 12 m/s sped up to 16, 21 m round.
- **Stopping it:** braking now ends a drift too (as letting go and steering out do).
- **The handbrake drags 3000 N** (was the back tyres' whole grip): held, it stopped the car halfway
  round a U-turn.
- **Bug:** the tail's angle read 0 when the car went less than 2 m/s forwards, which at 80° it does:
  the assist let go and it spun. Now it's read up to 120°, going any way at over 2 m/s.

| U-turn (heading 180°), full lock | Before: time, width | After |
|---|---|---|
| From 10 m/s, handbrake tap, then throttle | 2.95 s, 30 m | 2.27 s, 14 m |
| From 10 m/s, handbrake 0.6 s, then throttle | 2.27 s, 16 m | 1.75 s, 6.8 m |
| From 10 / 15 m/s, handbrake held (and throttle) | stops at 92° / 119° | 1.4-1.8 s, 3-5 m |
| From 20 m/s, handbrake 0.6 s, then throttle | 3.77 s, 47 m | 3.17 s, 33 m |
| Stopping a 12 m/s drift: let go / let go and brake | 0.50 / 0.83 s | 0.67 / 0.58 s (from 53°, was 26°) |
| 90° corner at 12 / 20 m/s (handbrake tap): time, slowest | 1.12 / 1.53 s, 10.1 / 17.7 m/s | 1.03 / 1.68 s, 10.7 / 18.0 m/s |
| Random keys, 20 min | 0 spins | 0 spins; 17 swings past 100° with the handbrake held, U-turns |

`bench/physics.mjs`: on the road 42.5 km at 17.7 m/s, no tip-overs, off the road 0.6% of frames (was
0.1%: the autopilot slides wide now and then); off road 23.8 / 22.6 m/s, 80 / 60 jumps, 4 / 2
tip-overs (was 21.1 / 19.5, 7 / 1). The knobs: `GRIP`, `BACK_GRIP`, `TRACTION`, `ENGINE`,
`FRONT_DRIVE`, and the `DRIFT_*`/`HANDBRAKE*` numbers in car.js. Not checked in Zen, and not driven
by hand.

### A faster car, and drifts that keep their speed (29 Sep 2026)

Asked for: "make drifting keep more speed and make the car faster". Measured in Node (the drift
tests and path trace from the section below, `bench/physics.mjs`, `bench/keepup.js` at the new top
speed, crest jumps at 25-35 m/s); headless Chrome: no page errors, GL error 0.

- **Engine 6000 → 8000 N, air drag 6.5 → 5.5 N per (m/s)²** (`car.js`): top speed ~30 → ~37 m/s
  (108 → 134 km/h). Off the line it's the back tyres' grip that limits it, not the engine.
- **Drifting keeps its speed:** a drift scrubs speed because the tyres push sideways against a car
  going partly sideways. Drifting, the part of that push that's against the way the car's going is
  cut by `DRIFT_GLIDE` (0.3), so the push across (what bends the path) is untouched. With the new
  engine alone, a held drift at 20 m/s still slowed to 16.4 m/s in 3 s; at 0.6 it sped up to 23;
  0.3 holds it at 20.
- A held drift goes round a wider circle than before, because it's going faster (the same sideways
  push): at 20 m/s, 32°/s (was 37°/s, while slowing to 14 m/s). Into a corner it's as quick: 90° at
  20 m/s in 1.53 s (was 1.50).

| | Before | After |
|---|---|---|
| 0-100 km/h / speed after 12 s | 8.7 s / 29.4 m/s | 5.6 s / 35.0 m/s |
| Braking from top speed | 2.43 s, 33.7 m (from 29.4) | 2.85 s, 46.1 m (from 35.0), 1.25 g |
| Handbrake tap, key held, 3 s at 20 m/s | ends at 13.9 m/s | 20.0 m/s |
| Held drift, 5 s, from 10 / 14 / 18 / 22 m/s | ends 9.4-12.3 m/s | 16.3-21.1 m/s |
| 90° corner (handbrake tap, full lock) at 16 / 20 m/s: slowest | 12.8 / 14.9 m/s | 13.9 / 17.7 m/s |
| Drifts held / spins (12 runs; 20 min random keys; 60 min handbrake-heavy) | 12 / 0 / 0 / 0 | 12 / 0 / 0 / 0 |
| Crest jumps of 0.7 / 1.1 / 1.5 m, driven at 35 m/s | – | 0.58 / 0.90 / 1.15 s in the air, hardest landing 8.7 m/s on the bump stops, always upright |
| Keep-up at top speed (`bench/keepup.js`, 60 and 30 fps) | 0 frames behind at 30 m/s | 0 at 37 m/s; the 3× slower machine at 30 fps: 19 of 2432 behind (0 at 30 m/s) |
| `bench/physics.mjs` off road (random, mostly full throttle), 2 × 20 min | 17.3 / 15.8 m/s, 30 / 20 jumps, 1 / 1 tip-overs | 21.1 / 19.5 m/s, 64 / 48 jumps, 7 / 1 tip-overs |
| `bench/physics.mjs` on the road (autopilot, up to 25 m/s) | 40.7 km, 0 tip-overs, off the road 0.1% | 41.7 km, 0 tip-overs, 0.1% |

**Off road, flat out over the hills, it tips over more** (8 in 40 minutes, was 2): it's going faster
over more jumps. It's set back on its wheels after 2 s. If that's a nuisance, the knobs are
`CENTRE_Y` and `ROLL_CENTRE` in car.js (see "Physics engine" below on what they did before).
`bench/keepup.js` now drives at 37 m/s. Not checked in Zen, and not driven by hand.

### Drifting without the countersteer, and grip back (29 Sep 2026)

Asked for: "The drifting is bugged, when I try to drift the car drifts a little and moves in the
opposite direction - possible because of auto countersteer - turn that off anyway. Also the car is a
bit too slidy when driving normally." Measured in Node (flat-ground drift tests, random keys, a
path trace of what a player would press, random steering over the terrain) and `bench/physics.mjs`;
checked in headless Chrome.

**What was wrong.** The assist (below) pointed the front wheels where the front of the car was going.
Drifting left with the key held left at 20 m/s, that was 23° to the *right* of the car, and the
path curved at 21°/s: a wider line than on grip (30°/s), with the nose 30° in. From behind the car,
it slid off the other way. And the soft tyres (grip falling away past 7° of slip, the back 25% more,
20% less again on the throttle, 25% less again once drifting) let the tail out in any quick corner:
steering at random over the terrain with no handbrake, the car was over 10° sideways in 26% of
frames, and full lock at 20 m/s went round 67 m, not 38.

- **Tyres: back to the original's,** stiff: each cancels its sideways slide in a step, up to
  1.2 × its load, and slides past that. The handbrake leaves the back ones 0.2 (was 0.4 originally).
- **Drifting.** The front wheels always follow the keys. A handbrake tap with the steering turned
  (above 5 m/s), or a slide past 15°, starts a drift that way, for at least 0.4 s. Then only the
  back tyres' sideways grip is managed: 0.85, +4 per rad the tail is past 29° (the angle wanted
  while the key's into the turn; 0 when it isn't), +1 per rad/s it's swinging out, within 0.2–3.
  While the tail is still out the other way (just switched with a tap), 3, to swing it across.
  The drift ends once the tail's within 5°.
- **Why the back grip.** With the fronts steered into the turn and sliding, they pull the nose in
  with all their grip; only the back tyres can balance that. Holding the tail at an angle takes
  about the front's grip (0.85 with the throttle moving weight back); more brings the tail in and
  pulls the car round, less lets it out. It's the back tyres' sideways force that bends the path,
  so the car goes the way it's steered.
- **Tuning:** with 1.2 as the base the tail settled 5° short (24°), hence 0.85. With a ceiling of 2,
  brake, handbrake, throttle and steering all at once at 25 m/s spun once in 20 minutes of random
  keys (braking moves weight to the front, which then out-pulled the back); 3 caught it.
- **The cost: a drift scrubs speed.** Held on the throttle it slows towards ~10 m/s, where it goes
  round about 11 m (the hairpins are 11-14 m). A 90° corner at 20 m/s bottoms out at 14.9 m/s
  (17.6 before), but takes 1.5 s, not 2.4.

| On flat ground (Node) | Before (countersteer, soft tyres) | After |
|---|---|---|
| Handbrake tap, key held left, 20 m/s: path over 3 s | 21°/s, front wheels -23° (out of the turn), 21 m/s at the end | 37°/s, +12° (into it), 13.9 m/s |
| The same at 12 m/s | 32°/s, -22° | 53°/s (~11 m round), +15° |
| A 90° corner, handbrake tap and full lock, at 12 / 20 m/s | 1.38 / 2.40 s, slowest 10.1 / 17.6 m/s | 1.12 / 1.50 s, 9.9 / 14.9 m/s |
| Drifts held (12 runs, 10-22 m/s) | 12 of 12, 25-29° | 12 of 12, 19-26° (the car; the back axle ~28°) |
| Let go of the key mid-drift | under 5° in 0.5 s | under 5° in 0.37-0.48 s, 0.1° past |
| Drifts switched every 2.5 s with a tap | ±30°, no spin | ±22-26°, across in ~0.75 s, no spin |
| Random keys, 20 min | 0 spins; past 15° 26% of the time | 0 spins; 7% |
| Random keys heavy on the handbrake (40%) and brake (25%), 60 min | – | 0 spins |
| Full lock and throttle at 15 / 20 / 25 m/s | 42 / 67 / 69 m, ~0.75 g | 20.5 / 37.7 / 61.6 m, 1.03-1.11 g (as originally) |
| Random steering over the terrain, no handbrake (8 × 2 min): over 10° sideways | 25.9% of frames, p90 28° | 1.6%, p90 2.6° (originally 1.5%, 2.6°) |

`bench/physics.mjs`: on the road 40.7 km at 17.0 m/s (was 40.4 at 16.8), no tip-overs, off the road
0.1% of frames (the same); off road 1 tip-over in each 20 minutes (was 0 and 0; the original tyres,
1 in all); the handbrake flick at 15 m/s turns 178° in 3 s, up to 25° sideways (was 114°, 29°);
`updateCar` 6.4 µs at 60 fps (the same). Headless Chrome: runs, no page errors, GL error 0, and a
tap with the key held drifts the car round to the left. Not checked in Zen, and not driven by hand.

### Easy drifting, rally-stage roads and small jumps (29 Sep 2026)

(The tyres and drift assist in this section were replaced the same day: see above.)

Asked for: "revamp the drifting system to make it easy and fun, can you also do the same for the
map adding more twists and turns as well as small jumps. The paths should be mildly curvy with the
tight turns like a real rally track." Measured in Node with scratch harnesses on `car.js` and
`terrain.js` (flat-ground drift tests, 20 minutes of random keys, road statistics over 66 km of
road), `bench/physics.mjs`, `bench/build.mjs`, `bench/keepup.js`, and headless Chrome against a
copy from before.

**Drifting, before: it barely could, and when it did, nothing caught it.** Each tyre cancelled its
whole sideways slide in one physics step, up to grip × load, so a handbrake slide stopped the moment
it was let go (a 0.3 s flick at 18 m/s: the back slipped 7° and gripped again), and the throttle
couldn't hold one. Past the limit, a slide simply grew: 44 spins in 20 minutes of random keys.

- **Tyres** (`car.js`): sideways, a grip curve. The force grows with the slip angle to GRIP × load
  (1.1; was 1.2) at 7°, then falls as the tyre slides, to 1.0 (front) and 0.75 (back) by 20°. So a
  slide, once started, carries on, and it's the tail that goes. Below 3 m/s a tyre grips outright,
  as before, or a parked car creeps.
- **Throttle:** the driven back tyres grip 20% less sideways on it, from 10 m/s (fully by 16), so
  at speed the limit is power oversteer; slower, a hairpin is taken on grip at full lock (10.4 m at
  10 m/s; drifting, it went round 20 m, too wide for the new hairpins).
- **Handbrake:** the back tyres' sideways grip 0.2 (was 0.4), and pulled with the steering turned
  above 5 m/s it starts a drift, for at least 0.4 s, so a tap is enough.
- **The assist, which makes it easy:** once the back axle slips past 8° (fully by 15°), the front
  wheels point where the front of the car is going (the countersteer a driver would do), turned
  from there by up to 7° to swing the tail out towards 37° while the key's held into the turn
  (it settles at ~30°), or back in line when it isn't; damped by how fast the tail is swinging.
  Drifting, the back tyres grip 25% less again, so the front ones have the authority to hold it
  either way. It lasts until the tail's back within 3.5°. Two things that didn't work: countersteer
  by the back's slip angle alone (0.9×) left the fronts pulling the nose in and spun the car in half
  the runs; and the countersteer through the keys' 12/s smoothing lagged a car swinging at 30°/s
  and let the tail swing back in (drifts oscillated 0-44°). The keys are smoothed; the countersteer
  follows the car at once.
- **Bug:** stopped with no pedal pressed, the brakes hold the car; "stopped" was forward speed under
  1 m/s, which a car sliding sideways at 20 m/s is too, so lifting off mid-slide stopped it dead.
  Now its speed over the ground (up and down not counted: landing, it's held as before).
- **Camera:** turned 60% of the way from where the car points to where it's going (`CAMERA_SWING`),
  so a drift shows the road ahead, with the car sideways on it.
- **Sand, not smoke,** from tyres sliding on the road (particles.js): the smoke was from when the
  roads were tarmac.

| On flat ground (Node) | Before | After |
|---|---|---|
| Handbrake with full lock (0.15, 0.3, 0.6 s at 10-22 m/s), then throttle and full lock, 12 runs | held a drift (mean slip > 15°) 0 of 12 | 12 of 12, mean 25-29°, no spins |
| Let go of the steering mid-drift | – | under 5° in 0.5 s, 2-4° past straight |
| Drifts switched left, right, left every 2.5 s, a handbrake tap each time | 3-4° either way | ±30°, no spin |
| Random keys every 0.15-1.35 s, 20 minutes | 44 spins; sideways past 15° 8% of the time | 0 spins; 26% |
| Full lock at 10 m/s | 10.4 m, 1.0 g | 10.4 m, 0.98 g (grip) |
| Full lock, throttle, at 15 / 20 / 25 m/s | 21 / 38 / 62 m, ~1.05 g | drifting at ~29°: 42 / 67 / 69 m, 0.71-0.79 g |
| Braking from 29 m/s | 1.23 g | 1.20 g |
| `updateCar`, 60 fps | 6.2 µs | 6.4 µs |

**The roads, before:** each a smooth curve between junctions pushed from side to side by noise:
bends, but none tight (1.2% of the road under 30 m radius), and no hairpins, which turn the road
back on itself, which a shift from side to side can't. **Now** (`layOut` in terrain.js) each road
is laid out along that curve as a rally stage: stretches that bend a little from side to side
(never tighter than 60 m), and between them tight corners, as pace notes call them: switchbacks
(hairpins of 11-14 m, a leg back, a hairpin the other way, and on past the first), square
dog-legs (15-20 m), chicanes, corners that tighten, medium ones. Main roads keep to faster ones.
It's laid out like a turtle in the curve's own frame (along it and across it), a metre at a time,
with a corner kept every 10 m or 11° of turning (shorter pieces round corners), and each corner
tried out first. Within 60 m of a junction the road is exactly on its curve, and within 160 m it
has no corners, so junctions keep their angles.

| Roads (six 3.2 km squares, 66 km) | Before | After |
|---|---|---|
| Bend radius at the pieces' joints, p5 / p25 / p50 | 38 / 70 / 134 m | 17 / 61 / 171 m |
| Share of the road tight (< 30 m) / medium / flowing (> 90 m) | 1.2 / 33.5 / 64.8% | 7.0 / 19.4 / 73.3% |
| Tight corners | 1.1 per km | 3.75 per km |
| Crests to jump | none | 1.6 per km |
| Closest centre lines away from the roads' ends: the same road / another | 28.8 / 21.3 m | 21.8 / 37.0 m |

- **Where it went wrong first:** two switchbacks in a row put their hairpins 11 m apart; the stretch
  after a switchback turned back towards the road's curve across the first hairpin (a loop); and
  two roads leaving a junction at a shallow angle wandered to 12 m of each other. Now the road
  marks the 10 m patches of its frame it passes, and a corner that comes within a patch of road
  laid more than 60 m before is turned the other way or left out; a switchback includes the leg
  out past its first hairpin; a stretch near older road goes straight on; and the first and last
  60 m are on the curve.
- The stretches were straighter than the old roads at first (median radius 265 m): wandering
  further and more often (`FLOW_*`) took them to 171 m, "mildly curvy".
- Most corners on one road: 398 (room for 800); most crests: 6 (16). Most road pieces per chunk:
  64, 73, 85 at levels 0-2 (46, 53, 66 before, on the same drives); `ROAD_PIECES` stays 176.
- Laying out a road, with the rest of finding it: 0.38 ms. Building (`bench/build.mjs`, alternating
  with the copy from before, twice): 0.60 → 0.65 ms a chunk (+8%: more, shorter pieces near each;
  checksum now `e67610fbcf432800`). Keep-up (`bench/keepup.js`): no frames behind, 0.23 ms of
  building a frame at top speed (0.25 before).

**Small jumps:** a crest across the road (`JUMP_*`), 0.7-1.5 m high, a Gaussian rising over ~8 m
and falling over ~6 m, at the middle of a third of the side roads' stretches at least 90 m long (a
fifth of the main roads'). Added to the road's lift where it's read (`crest` in roadDistance), from
each piece's nearest crest (kept in the piece: 16 numbers now, not 13), so it's exact along the
road rather than straight lines between corners 10 m apart; the verges rise with it and the land
beyond eases in, as for any rise. Driving over one on flat ground (Node, the mesh's 1 m grid and
whole cm):

| Crest | 10 m/s | 15 m/s | 20 m/s | 25 m/s |
|---|---|---|---|---|
| 0.7 m | stays down | stays down | 0.18 s in the air | 0.37 s |
| 1.1 m | stays down | 0.13 s | 0.48 s | 0.67 s |
| 1.5 m | stays down | 0.40 s | 0.72 s | 0.88 s, lands at 6.3 m/s on its bump stops |

Always upright. **The autopilot** (`followTheRoad`) now steers for the road 8 m + 0.4 s ahead
*along* it (`roadAhead` in terrain.js walks the road's pieces, through junctions onto the
straightest road): 15 m ahead in a straight line cut across a switchback to the other leg. It
brakes in time for the bends it sees in the next 80 m, cornering at up to 6 m/s².

`bench/physics.mjs`, before (old car, old roads) → after:

| | Before | After |
|---|---|---|
| On the road, 40 min | 53.9 km at 22.4 m/s | 40.4 km at 16.8 m/s (corners) |
| Jumps of 0.3 s or more on the road | 0 | 38 |
| Off the road | 1.2% of frames | 0.1% |
| Tip-overs on the road / off road (40 min each) | 0 / 1 | 0 / 0 |
| Deepest tyre on the road, p99 / max | 0.3 / 2.4 cm | 0.3 / 5.1 cm |

**In Chrome** (headless, 860 × 360, 40 s following the road, alternating with the copy from before,
twice each): JS p50 1.2-1.3 ms either way, p99 2.4 / 2.3-2.4; all GPU passes p50 2.56 / 2.62-2.64
ms; 0-1 late frames either way; GL error 0. The first frame builds 522 rows (10 ms) where the old
roads' start built none: the new start is 42 m from 600,-330 and its camera crosses a chunk's
edge. Screenshots: drifting with the keys (handbrake tap, full lock), and the autopilot over the
stages. Not checked in Zen, and not driven by hand: only by scripted keys.

### Livery changes, spoiler, tail lights light nothing else (29 Sep 2026)

Asked for: remove the purple line, a checkerboard instead of the back window's lettering, no red
light from the tail lights on the surroundings, a vertical brake light in the middle, and "a simple
spoiler".

- **Livery** (`bench/livery.mjs`): the pinstripes are red and yellow (the purple one gone, sides and
  back); the strip across the top of the back window is yellow and black checks, 3 texels square.
  The windscreen's strip is still purple.
- **Brake light, upright in the middle of the back bumper** (up the middle of the back window until
  asked to move it the same day): the bumper's back is its own strip of the texture (v 16.6-22.1,
  0.53-0.39 m up, its middle at u 1.3), so 2 texels either side of the middle (~9 cm) by 5 rows
  (~14 cm), with 30% of its texels under a fleck of mud (which then isn't lit). Texels (230, 0, 8): pure red to car.frag's tail-light test, and the
  touch of blue marks it as lit only braking (uTail.w > 2); otherwise it's drawn as a dark red lens
  (its colour × the sky's light × 0.4). None of the model's own tail-light texels has any blue.
- **No red light on the road or the dust:** `tailLight` (sky.glsl), its use in terrain.frag and
  the dust's red tint (particles.frag) are gone, and TAIL_COLOR with them; uTail.xyz is still
  uploaded (the bamboo's bending uses the same position in JS) but no shader reads it. The lamps
  themselves are as before: 1× driving, 3× braking with the overflow burning orange-white.
- **Spoiler** (`SPOILER` in car.js): three boxes added to the body's mesh by `parseBody`: a wing
  1.32 m wide, 34 cm deep and 4 cm thick at the back of the roof (1.52-1.56 m up), on two struts.
  24 faces, 96 vertices (411 → 507). All its corners read one texel, (2, 2) of the first copy, which
  no face of the model uses (livery.mjs checks) and which livery.mjs paints white. Black first: from
  the chase camera it vanished against the dark roof. Physics unchanged (it's only drawn).
- Checked in the viewer and in the game (headless Chrome: driving, turning, braking; GL error 0).
  Not measured: 12 more triangles, and less terrain work than before. Not checked in Zen.

### Tail lights always on, brighter braking (29 Sep 2026)

Asked for: "make the tail lights always on and glow extra bright when braking". They were always
on, but at 0.6× their texels (red 103-255, mostly 166-214) came out ~100-156 on screen, no
brighter than the white paint beside them; braking at 1.6× only took them to 255, as far as pure
red goes, so a bigger number alone couldn't make braking brighter.

- **Now:** 1× while driving (their own red, the lens's pattern kept), 3× braking (`TAIL_LIGHT`,
  `BRAKE_LIGHT`). What red can't show burns into green and blue (`BURN` in car.frag, 0.45 and 0.3
  of the overflow): braking, the brightest pixel read back is (255, 230, 150), where it was (255,
  0, 0); the lamps' darker texels stay red. And the light is thrown on the ground behind the car
  (`tailLight` in sky.glsl, in terrain.frag): red, only behind (the headlight's direction turned
  round), half-wrapped, half as bright 2 m from the lights, gone by 8 m; faint while driving, a red
  pool braking. The car hides the first ~1.5 m of road behind it from the chase camera. The dust
  behind already took its red from the same brightness, so it's redder too.
- **Cost, Chrome, 30 s following the road, alternating with a copy from before, 3 runs each:** the
  land pass 0.77, 0.77, 0.77 ms p50 before, 0.80, 0.80, 0.78 after (+0.02-0.03 ms); the whole frame
  within the runs' noise (2.52-2.54 before, 2.38-2.45 after). The first try, without the 8 m
  cut-off, worked the light out for every pixel of land: +0.06 ms in the one clean pair of runs.
  Not checked in Zen.

### Rally livery (29 Sep 2026)

Asked for: "retexture the car to make it look like a rally car ... Main body white with sponsors
bright yellow, red, blue and purple. Numbers in yellow and the car has mud on it as well", the
sponsors as "mangled text in some coloured boxes or designs like that", and the left/right fix.

- **The model's texture is mirrored.** Measured from Car3.obj (each face's texels per metre, and
  which way they run): one picture of the car's side serves both sides, the left one mirrored; the
  bonnet, roof and tailgate are one strip, from the middle out to one side, mirrored for the other
  half; so are the back and the front. It's 33 texels per m everywhere, lined up with the car's
  axes (the side: u = 64 - 33z, v = 134 - 33y), so a sticker can be drawn on the texel grid and
  stay sharp. Lettering would have read backwards on one side, and a number across the middle of
  the roof couldn't be drawn at all.
- **The fix: two copies.** `parseBody` (car.js) sends every face left of the middle (+x, by its
  corners' average) to a second copy of the texture beside the first (u → (u + 1) / 2, the rest
  u / 2), through a new `placeUV` hook in `parseObj`. 256 × 128: 128 KB on the GPU, was 64 KB. The
  corners on the middle line are now stored once for each copy: 382 → 411 vertices. No texture
  coordinate reaches the edge (u from 0.008 to 0.989), so nothing reads across into the other copy.
- **Painted by a script** (`bench/livery.mjs`, 0.3 s), which writes `car3_rally.png`; main.js
  loads it instead of car3.png. The paint is where car3.png, car3_red.png and car3_yellow.png
  differ (10.0k of 16.4k texels): the glass, lights, trim and grille are the same in all three and
  are kept as they are. Each paint texel's brightness against the green's flat paint (its panel
  lines and shading) multiplies the new colours, stickers included, so they follow the panels. The
  script draws the model's triangles into the texture to know where on the car each texel is (and
  texels on an edge, within half a diagonal: the game reads those too), which is what places the
  mud. Stickers go on the texel grid: on the right side's copy back to front, and across the middle
  (roof, bonnet, back, front) folded out from each one's middle texel.
- **The design:** see "Rally livery" in The look. The lettering is random real letter shapes,
  3 × 5 texels (the bonnet's twice that), in words, 30% of them with a texel knocked out or added.
  The number is 6 × 9 texels with strokes 2 thick on the doors (0.27 m tall), twice that on the
  roof, and 3 × 5 on the back. The bonnet's box and the windscreen's strip are turned to read from
  the front, as on real rally cars; the roof's reads from behind, for the chase camera.
- **The mud** is a function of where on the car a texel is, so it runs on across the texture's
  seams: caked below 30 cm (a wandering edge, ±9 cm); just behind each wheel up to 55 cm, dying
  away over the next ~0.6 m; round the wheel arches; up to 42 cm on the back and 38 cm on the front;
  above that, splashes, 40% of texels at the edge, a third as many every 10 cm higher. Wet and dark
  low down, drier and paler higher up, darker in the panel lines. None on top (the rain washes it)
  or on the lights. The first try left the spray's height on for the whole car behind each wheel and hid
  the sill's sponsor and the bottom of the door numbers.
- **Checked** in a scratch viewer (the model from 8 angles, in headless Chrome) and in the game
  (headless: parked, driving, braking, turning both ways): the lettering reads the right way round
  on both sides, and the numbers on the doors, roof and back. At dusk the white comes out a
  light blue-grey (90th-percentile pixel (140, 148, 165), against (74, 74, 58) for the road beside
  it), not glaring. Pure-red texels: exactly the model's 38 tail-light texels in each copy, none of
  the livery's; the brightest tail-light pixel is still 156 driving and 255 braking.
- **Cost:** none measurable. The car pass is 0.03 ms p50, as before (Chrome, 30 s following the
  road: all passes 2.55 ms, JS 1.2 ms p50). Not checked in Zen.

### Leaves flickering thin, and puddles growing in (29 Sep 2026)

After playing the version below: "the trees leaves seem to flicker becoming much more transparent
for a second and then returning back to normal when I got close to them ... noticeable for lone
trees with the sky behind them", and "I can see [the puddles] load in a bit - could you fix this
and reduce the puddle count by 10x".

**The leaves.** Where a stalk swaps from its strand to its full model (26-34 m), both its cards are
drawn, dissolving by the dither pattern: the near cards keeping the pixels whose threshold is under
their share, the far card likewise. But a stalk's cards share one shift of the pattern, so both kept
the *same* pixels: half way, only half of them, where each should have had the other half. **The
far card now counts the pattern the other way** (`leaves.frag`), as the line does against the tube,
so between them they keep the pixels either would. Measured in headless Chrome on a leaves-only
copy (1 in 8 stalks, only those 24-36 m away, drawn on magenta; share of the screen covered, 4
views):

| | view 1 | view 2 | view 3 | view 4 |
|---|---|---|---|---|
| Full model only, before | 2.42% | 3.05% | 1.86% | 4.22% |
| Strand only | 2.95% | 3.71% | 2.24% | 4.89% |
| Half way, before | 1.84% | 2.30% | 1.31% | 3.27% |
| Full model only, now | 2.91% | 3.66% | 2.23% | 4.91% |
| Half way, now | 2.94% | 3.67% | 2.26% | 4.87% |

It also showed the **full model's leaves a fifth thinner than the strand's** there: its 3 cards
dissolve by the same pattern, so where they cross, each one's leaves take the same pixels as the
other's, while the strand's picture of them has each leaf where it is. Blurred by the mipmaps (a
leaf's texels are all-or-nothing only up close), that loses leaves. The near cards' leaves count
× 1.4 (`NEAR_LEAVES`), matched to the strand's within 2%. (A shift of the pattern per card instead
made up only half the difference, and would have broken the swap's other half: the far card
complements only the card that shares its shift.) The strands are as they were.

**The puddles.** They were the sand texture's wettest texels (alpha over 0.8), in a 16 m tile. Far
off, the mipmaps blur the wetness, and blurred, it falls short of 0.8: the puddles shrank and went,
between 40 and 100 m, where the mist is only 20-50% (at the terrain shader's mip level for each
distance, the share of the puddles' area left over 0.8: 30 m 97%, 40 m 84%, 50 m 71%, 60 m 57%, 80 m
7%, 100 m 0%). Driving up, they grew back in. Now:

- **A texture of their own** (`createPuddles` in `textures.js`, unit 5): 512 texels square at 8 per
  metre, repeating every 64 m. Red is how wet (the same noise the sand's alpha was); green is 255
  where it's a puddle, 0 where not, so its mipmaps blur a puddle to the share of a pixel that it
  covers, and it fades into a glint on the road rather than going. Sharp texels up close (the
  magnification filter is still nearest), trilinear with anisotropic filtering further off (16×:
  the road seen at a slant, a pixel reaches far along it and hardly across), read with gradients
  worked out from the world position, as the ground's textures are.
- **One wettest patch in ten is a puddle**: the patches over 0.8 are found (touching at a side or a
  corner, across the tile's edges) and one in ten, at random, kept; the rest are damp patches. In
  the tile: 66 patches, 7 puddles, 0.44 per 16 m square (was 6), covering 0.5% of the road (was
  10%); about one on the road every 200 m. The splashes read the same texels (`puddleAt`).
- Made in 19 ms at startup (Chrome, cold); the noise worked out cell by cell (`layeredTile`, the
  same bytes as `layered` texel by texel). 0.7 MB of GPU memory with its mipmaps.

**Driving** (40 s, alternating with the last version; the first run of the old one, with the
machine still busy, dropped): GPU p50 2.67 → 2.65-2.67 ms (land 0.76 → 0.76, leaves 0.92 →
0.90-0.91), JS p50 1.2 → 1.2 ms, p99 2.4 → 2.4, no late frames either way, JS heap ~45 → ~44 MB.

### Trees loading in: strands to 200 m (29 Sep 2026)

After playing the version below: "I can still see trees load in, can you make them load in outside
of render distance".

**What was left to see.** Counting pops (see below) found none within 100 m any more: what could
still be seen were the swaps done gradually. Strands dissolving out of the clumps at 70-90 m, where
the mist is only about half, so trees could be watched forming out of the pictures; and at ~30 m,
each strand turning into a full stalk, its leaves suddenly twice as thick (one card facing the
camera, then three crossed).

**What changed.**

- **Strands to ~200 m; clumps from 180-200 m**, dissolving over 20 m, in 75-80% mist. Stalks
  only grew on level 0's chunks (to ~100 m), so **level 1's chunks (to 220 m) plant them too**, the
  same ones: each from its 1.5 m square of the world, with the grove worked out afresh there rather
  than read from the chunk's vertices (terrain.js). Level 0 against level 1 over the same ground:
  5,158 stalks the same, 1 and 2 not (beside roads, where the edge is read from coarser vertices);
  feet within 14 cm (buried 30), tips p99 18 cm apart, at most 45 (the lean out over a lane).
- **Near to far: the strand's card is a picture of the three crossed cards** seen from the side
  (a new texture layer: the leaf card, and the same squeezed to half either way, one mirrored), so
  a stalk is as thick with leaves either way; and the two **dissolve into each other over 4 m**
  (both drawn: the leaves by the dither, the tube or the line whole, by the stalk's own random
  number, the line counting the other way so it's one or the other). The clumps' pictures use the
  same crossed leaves, so they're as thick as the strands they swap with.
- A level-1 chunk drawn where its level-2 parent was (only clumps) dissolves into stalks over 0.6
  s; drawn in place of its level-0 children, or they of it, at once: they have the same stalks.
- Building: a level-1 chunk's 1,600 places planted a row of 6 m squares per building step, once its
  heights are done (all at once, the worst frame with JS 3 × slower went 2.0 → 3.1 ms; spread,
  1.85). Level 0's chunk 0.567 → 0.604 ms (the grove afresh at each place); same bytes.
- The list, for ~8,700 stalks: a chunk's stalks kept a 6 m square at a time, so a square out of
  view or all clump is skipped whole and one all in view is copied in a tight loop; the near
  stalks' room at the start of the list, so the far ones go straight into place; a count of bent
  stalks per chunk, so chunks with none take the tight loop too; squares' shares by squared
  distances, with a square root only inside the band. 325 → 220 µs a frame (Node, 24 views; 140 at
  70-90 m).

**Measured** (the popping count as before, but the camera eased as main.js's is: the test camera had
been turning to each road piece's direction at once, a few degrees at each joint, and the stalks at
the view's sides flicking in and out of it were counted; stalks matched by where they stand, adding
up a stalk's near and far entries):

| Pops a second | 0-100 m | 100-350 m | 350-400 m |
|---|---|---|---|
| 5 m/s, last version / now | 0.0 / 0.0 | 0.4 / 0.5 | 37.2 / 37.2 |
| 25 m/s, last version / now | 0.0 / 0.0 | 2.1 / 2.7 | 183.2 / 183.2 |

Both pop nothing a viewer could see (350-400 m: clumps coming into range in total mist); the
difference is what the count can't see, the slow swaps: now at 180-200 m instead of 70-90.

- **Driving** (40 s, alternating with the last version, twice each): late frames 0-1 either way;
  far stalks p50 1,465 → 8,440, clumps 1,977 → 1,637; GPU p50 2.13 → 2.67 ms (stalks 0.23 → 0.48,
  leaves 0.58 → 0.92, clumps 0.17 → 0.12); JS p50 1.0 → 1.3 ms, p99 2.1 → 2.4; JS heap ~36 → ~45 MB.
- **GPU memory** ~11 → ~20 MB: the stalks' texture 2.5 → 11.2 MB, the lists 3 × 256 KB.
- At 172 × 72 the strands cost ~7.5-9 ns a vertex whatever their lighting: leaving the headlight
  (past 100 m) and the sheen (for the lines) out measured no faster (0.159 → 0.162, 0.311 → 0.317
  ms), so they're as they were.
- Stalks within 35 m with leaves on screen left out of the list: 0 of 25,188 (144 views).

### Trees coming and going (29 Sep 2026)

After playing the version above in Zen: "It appears to be worse now, the chunked trees have a
problem in that the chunks appear too close to the road and they don't get replaced fast enough
leading to trees vanishing and some appearing. I think the problem might actually have been too
aggressive LOD. Can you make the trees on/nearby the path fully featured and then the ones further
out strands and the ones a bit more out the pictures." "I tried driving slowly and found the same
issue in that trees just appear out of nowhere." "I also think the flat line trees are very
effective and should be used more often."

**Why trees came and went.** Not the LOD distances alone, though bringing the clumps in to 40-55 m
made it plain:

- **A stalk and the clump standing for it swapped at unrelated distances.** Each stalk swapped at
  its own distance (by its number in the chunk), measured from itself; each clump likewise. Over the
  swapping band, a square could show its stalks and its clump, or neither.
- **Stalks were drawn from any level-0 chunk that was built**, even while its parent was still
  drawn there (until all four children are built), with the parent's clumps: both; then the
  parent's clumps went all at once.
- **Clumps stood out over the lanes.** A clump is a 6 m card turned to the camera, planted where the
  grove is thick, which starts 1 m from a lane's edge: looking down the lane, a card up to 2 m over
  it.
- A small one: the chunk box that culls stalks was 4 m wider than the chunk, but the tallest stalks'
  leaves reach ~8 m past their foot: ~3 stalks in a view were left out at its sides (of ~1,730;
  none within 35 m, over 144 views).

**What changed** (`bamboo.js`, `terrain.js`, the bamboo shaders):

- Full stalks (tubes, 3 crossed cards) within 26-34 m, each stalk its own distance; strands (a
  line and one card) from there; clumps from 70-90 m. **Each 6 m square swaps all its stalks for its
  clump at once**, at its own distance measured from its middle, dissolving one into the other over
  10 m by the dither (the leaves and clumps pixel by pixel, the lines stalk by stalk): never both,
  never neither. How much of each is there goes to the GPU in the list's second number (the bend
  now two 12-bit fractions, and 8 bits for that).
- Stalks only from chunks the land is drawn from. When a level-0 chunk is first drawn, its squares
  dissolve from clumps into stalks over 0.6 s: if it's late (built after it was wanted), the
  coarser chunk's pictures don't turn into trees in one frame.
- No clump within 3 m of a lane's edge (the half-width of its card).
- The chunk box for culling stalks is as wide as the tallest stalk reaches (8.25 m).

**Measured** (Node: the camera driven along the road for 20 s from 3 places, the land built at 1 ms
a frame as in the game; a pop is a stalk or clump coming or going by half or more in one frame,
inside the middle of the view; clumps matched by where they stand, so one planted by a finer chunk
in the same place isn't counted):

| | 0-50 m | 50-100 m | 100-350 m | 350-400 m |
|---|---|---|---|---|
| Before, 5 m/s (a second) | 29.4 | 19.6 | 7.3 | 41.2 |
| After, 5 m/s | 0.0 | 0.0 | 7.2 | 41.0 |
| Before, 25 m/s | 98.2 | 64.1 | 17.9 | 186.0 |
| After, 25 m/s | 0.0 | 0.1 | 17.9 | 185.4 |

What's left: from 100 m, the few squares where a coarser chunk's clump differs from a finer one's
(mist 50-97%); at 350-400 m, clumps coming into range at the mist's end, where they can't be seen.

- **Cost** (driving 40 s, alternating with the version before, twice each): far stalks p50 296 →
  1,465; GPU p50 1.89-1.96 → 2.13 ms (stalks 0.15 → 0.23, leaves 0.45 → 0.58, clumps 0.20 → 0.17),
  about what it was before the LOD was made more aggressive; JS p50 0.7-0.8 → 1.0 ms. The list
  (Node, 24 views): 79 → 132 µs (145 before working each chunk's squares out once a frame).
- Clumps across levels, with the lanes kept clear: level 1 agrees with level 0 on 348 squares (1
  not), level 2 on 341 (11 not): as before. Building unchanged (same bytes).
- Screenshots from the same four places look much the same close up; further off, strands where
  clumps were. Against the sky, the strands' single leaf cards, pointed at the top, look a little
  like conifers (see "Not done" in "Bamboo overhaul, mist and treeline").

### The car rocking on the lanes, and choppiness in Zen (29 Sep 2026)

After playing the overhaul in Zen: "the car seems to rock back and forward a lot when driving on the
path"; "the bamboo loading is a lot better but is still a bit laggy, the game feels more choppy...
maybe more aggressive LOD, more flat shoots, group together, batch gpu, make a picture wall of single
shoots further out... I think loading/memory might be a problem now".

**The rocking was the road, every ~10 m.** Measured in Node (`bench/physics.mjs`'s terrain and car,
following the road): the car pitched against the ground under it at 2-3 Hz, and that frequency grew
with speed, one bump per ~10 m of road, the length of a road piece. Nothing like it on flat ground.

| Following the road | Pitch rate, rms | Its peak |
|---|---|---|
| Flat ground, throttle on and off at 22 m/s | 0.7°/s | – |
| Road, throttle on and off at 10 / 16 / 22 m/s | 4.1 / 7.1 / 8.7°/s | 0.96 / 1.56 / 2.14 Hz |
| Road, full throttle | 7.5°/s | 2.5 Hz |
| **After** (the same four road runs) | **1.2 / 1.5 / 1.7 / 2.3°/s** | no peak per piece |

- **Why:** a road's height comes from its lift (`liftRoad`), kept at each corner, ~10 m apart,
  and blended by `roadDistance` from every piece nearly as near as the nearest. Those pieces gave
  their lift at their own nearest point: for the pieces either side of the one the car is on, their
  end, the joint. Weighting each joint's lift in pulled the road's height towards the joints: along
  it, the grade swung from half what it was at each joint to a third more halfway along. On a 3%
  climb that's 1.5% ↔ 4% every 10 m, which pitched the car ±0.5-0.9° at the ~1.7 Hz its springs
  pitch at. (Whole-cm heights add a little: with exact heights, 1.70 → 1.58°/s.)
- **Fix:** the pieces of the nearest road's group give their lift carried on along their own
  line past their ends (up to a piece's length each way). On a steady grade they all agree, so the
  blend is exact; where the grade changes, the blend changes smoothly (at a joint, the grade is the
  average of the two pieces'). Other roads' pieces still stop at their ends, as before (carried on
  across a junction, a climbing side road would tilt the road it meets).
- The road's height profile, along its middle, by wavelength: 10 m 5.5 → 0.4 mm, 12 m 3.9 → 0.4
  mm; the rest unchanged. Pitch against the ground, following the road: rms 0.82 → 0.40°, p99
  1.81 → 0.92°; pitch rate rms 9.5 → 2.7°/s; 2-3 Hz from 71% of it to 7% (what's left is slow:
  hills, and the autopilot's throttle going on and off).
- The land moved very little: within 20 m of a road, p50 1 cm, p99 11 cm; on the road p99 5 cm,
  max 10; anywhere, at most 22 cm (6 places, 800 m squares, every 2 m).
- `bench/physics.mjs`, on the road: 53.9 km at 22.4 m/s, no tip-overs, no jumps; a wheel on its
  bump stop 0.2 → 0.1% of frames; deepest tyre p99 0.7 → 0.3 cm. Off road much as before.
- Building: 0.554 → 0.566 ms a chunk (+2%); checksum now `b2a09c112ead5891`.

**Choppiness.** In headless Chrome it wasn't choppy before these changes either: driving 40 s,
0-1 late frames, JS 0.9 ms p50 (2.0 p99), GPU 2.07 ms. So it's something Zen does differently, and
Zen can't be measured here: on macOS, Firefox draws WebGL with OpenGL, but this Chrome has no
OpenGL backend any more (`--use-angle=gl` gives no WebGL 2), and it only draws through Metal. What
OpenGL on macOS is known to do, and the overhaul made more of: stop and wait for the GPU when a
buffer or texture it may still be reading is refilled. The overhaul added the bamboo's list,
refilled every frame, and a row of the clumps' texture (in use every frame) for every chunk built at
every level (~19 a second at top speed), besides the stalks' rows for level 0. Changed (see the
optimisations): three copies taking turns for what's refilled every frame; chunk rows through a
pixel buffer; chunk vertices into new storage; and at most 100 rows of building per ms of budget,
as Firefox's clock (rounded to 1 ms, much coarser with fingerprinting protection) may not stop it.

**More aggressive LOD** (undone the same day: see "Trees coming and going"): clumps take over from the stalks at 40-55 m, not 60-80. Screenshots from
the same spots look much the same. Start view (GPU ms p50, alternate runs, the clear pass 0.185):

| Stalks to / near to | Stalks | Leaves | Clumps | All passes |
|---|---|---|---|---|
| 60-80 / 30 m (before) | 0.157 | 0.326 | 0.171 | 1.851 |
| **40-55 / 30 m (kept)** | 0.111 | 0.253 | 0.199 | 1.762 |
| 60-80 / 20 m | 0.146 | 0.297 | 0.173 | 1.826 |
| 40-55 / 20 m | 0.101 | 0.221 | 0.202 | 1.726 |

- Near to 20 m saves only ~0.03 ms more, and stalks 20-30 m away turn from shaded tubes into 1-pixel
  lines: kept at 30.
- **Grouping the far clumps** (1 in 4 at level 2): 0.02 ms less; drawing no level-2 clumps at all,
  ~1,000 of them, only 0.03 ms. Not worth coarser clumps.
- The list: 100 → 78 µs a frame (Node, 24 views); ~2,600 entries instead of ~3,200.
- **Driving** (40 s, before and after alternating, twice each): GPU p50 2.07 → 1.96 ms (stalks
  0.20 → 0.15, leaves 0.54 → 0.45, clumps 0.17 → 0.20); JS p50 0.9 → 0.8 ms, p99 2.0 → 1.9; 0-1
  late frames either way. Far stalks p50 944 → 296.

**Memory isn't it:** on the GPU, ~11 MB in all (stalks' texture 2.5 MB, clumps' 2.9, land 3.9,
the bamboo's indices 0.5, textures 0.7, the lists 0.4); the JS heap ~35 MB after driving 40 s, with
~0.3 ms of garbage collection a second.

**Not done:** Zen itself is unmeasured (see above). The `?profile` overlay now counts late frames in
the last 10 s, and says Firefox has no GPU timings rather than showing NaN, so it can be read there.

### Bamboo overhaul, mist and treeline (29 Sep 2026)

Asked for after playing phases 3-4: "The horizon does not load the bamboo fast enough - I often
reach the end and have bamboo load in around me"; "The fog is too similar to the sky colour and so
when the bamboo fails to load and at the end of the road render distance it looks like the sky can
be seen"; "make the bamboo come up more slowly when you run it over"; "overall the bamboo needs a
performance overhaul". Measured in headless Chrome at 860 × 360 on this machine. For side-by-side
screenshots and A/B timings, the pre-overhaul copy was served on a second port (see "Measurement
pitfalls").

**What changed.**

- **Bamboo to the mist's end.** It was drawn to 120 m (fading from 90), with the land going on to
  400 m: at 120 m the mist is only 58%, so where it stopped showed, and it seemed to grow in
  around the car. Now clumps take over from the stalks at 60-80 m and go on to 400 m, planted by
  every chunk at every level (see the optimisations).
- **The mist has its own colour**, a darker slate green-grey than the sky, paling a little from
  200 m to 400 m; and the sky has a treeline all round the horizon in the mist's furthest colour,
  so past the land (or through a gap) there's more misty forest, not sky. A treeline paler than
  the land's furthest mist was tried first: it gave a layer more, but showed the land's far edge,
  which comes and goes in 120 m chunks. So the mist pales to the treeline's colour by 400 m.
- **Stalks spring back slowly.** They were bent aside by working out, in the vertex shader, how
  far the car was from each: nothing kept, so they stood again the moment it passed. Now JS
  keeps a bend and its speed for every stalk the car has touched (at most 4,096 at once), pushes
  them away from the car's line each frame (at least as far as before, and never back into it),
  and lets them go as damped springs: half way up in 1 s, 90% in 2.1 s. The bend goes to the GPU
  in the frame's list. The camera still pushes stalks from the lens on the GPU, at once.
- **The bamboo's list**, **three levels of detail**, **lighting at the corners**, **leaves and
  clumps before the land**: see the optimisations.
- `dither.glsl` split from `sky.glsl`, so vertex shaders can include the sky's light and mist.

**Steps** (the start view, GPU ms p50; compare within a row pair only, see the pitfalls):

| Step | Stalks | Leaves | Clumps | Land | All passes |
|---|---|---|---|---|---|
| Before (runs where the clear pass took 0.18-0.20) | 0.62-0.73 | 0.75-0.89 | – | 0.88-1.06 | 2.56-3.03 |
| The list and the clumps (per-stalk choices; ~1,100 stalks and ~2,000 clumps, not 5,600 stalks) | 0.28-0.31 | 0.38-0.43 | 0.13-0.14 | 0.98-1.10 | 2.08-2.32 |
| Leaves and clumps before the land | | | | | −3% |
| Leaves lit and misted at the corners | | 0.43 → 0.34 | | | |
| Stalks lit, sheened and misted at the corners | 0.30 → 0.16 | | | | |
| The land's daylight and mist at the corners | | | | 0.93 → 0.81 | |
| **After** (same clock as before, back to back) | **0.16** | **0.33** | **0.18** | **0.81** | **1.90** (was 2.85) |
| After, at 172 × 72 (vertices and draws; before: 0.37, 0.44, –, 0.28) | 0.08 | 0.14 | 0.09 | 0.32 | 0.83 (was 1.28) |

**Driving** (following the road for 60 s, two runs each, old and new alternating):

| | Before | After |
|---|---|---|
| Frames, dropped | 3,568 / 3,570, 0 | 3,567 / 3,569, 0 |
| GPU p50 / p99: stalks | 0.71-0.73 / 0.95-1.24 | 0.22-0.23 / 0.37-0.51 |
| leaves | 1.08-1.23 / 1.45-2.05 | 0.56-0.57 / 0.87-1.04 |
| clumps | – | 0.18 / 0.34-0.39 |
| land | 0.84-0.87 / 1.13-1.54 | 0.75-0.77 / 1.00-1.39 |
| All passes, p50 | 3.05-3.25 | 2.13-2.16 |
| Stalks drawn p50 / max | 5,637 / 7,858 (to 120 m) | near 211 / 396, far 947 / 1,511, clumps 2,036 / 2,280 (to 400 m) |
| JS mean (25 s runs) | 0.70 | 0.89-0.94 |

The bamboo costs half what it did (1.8-2.0 → 0.96 ms) and now reaches 400 m instead of 120.

- **JS:** the list takes ~90 µs a frame in Node (135 before skipping the checks for chunks wholly
  in view, and working each stalk's handover distance out once). In the page, timed with its own
  timer (which steps by 0.1 ms) round the call and averaged, 283 µs; but that doesn't fit the
  frame's JS mean, up only ~0.2 ms in all, and a CPU profile of the page put it at ~0.1 ms (main
  thread busy 0.15 ms a frame more in all). Bending: ~5 µs.
- **Building:** 0.543 → 0.549 ms a chunk (`bench/build.mjs`, level 0: 25 clumps each), checksum
  unchanged (`f5917ea5a0b723e0`). Keep-up: no frames behind, 0.19 ms a frame at top speed.
- **Clumps across levels** (the same ground built at levels 0, 1 and 2): level 1 agrees with level
  0 on 349 of 351 squares (heights within 7 cm), level 2 on 342 of 355 (within 33 cm).
- **Tried and dropped:** the dither's Bayer threshold worked out from the bits of x and y
  instead of looked up in a constant array: no faster (land 5.12-5.21 against 4.99-5.07 × the
  clear pass).
- **Not done:** the leaves' card is widest two fifths of the way up and pointed at the top, so far
  off, stalks (and clumps, drawn the same way) look a little like conifers.

### Bamboo, rain and sky (29 Sep 2026)

"Can you make the bamboo and its textures, can you add those effects to the puddles, the rain and
the sky. Can you also make it a bit less windy." Phases 3 and 4 of the plan, the puddle splashes
from the to-do list, a sky, and lanes that wind a little less. Measured in headless Chrome at
860 × 360 (as fullscreen on the ultrawide) on this machine, and with the Node benches.

**What changed.**

- **Bamboo.** How thick it grows (`grove`: noise on two scales, 90 and 20 m) is worked out for
  every vertex and kept in its spare byte. Level-0 chunks plant stalks from it on a 1.5 m grid
  (at most 400 a chunk), which the GPU reads from a float texture. Textures made in code: the culm
  (nodes, wax, lichen) and a card of leaves. See "The look" and the optimisations.
- **Rain** (`rain.*`): streaks from `gl_VertexID`; tiny droplets splashing up round the car
  (`rainOnGround`); rings spreading on the puddles (`ripple` in `terrain.frag`).
- **Puddle splashes** (`kickUp`): a tyre is in a puddle where the sand texture's own texel there
  (`wetnessAt`) is over `PUDDLES` and the road's frayed edge (`edgeAt`, blended as the GPU does) is
  more than 0.8 m away: the same test as `terrain.frag`. Drops only: fine spray puffs were tried,
  but pale and see-through on the dark road, their dither showed as squares of dots.
- **Sky** (`sky.*`): gradient, glow in the west, drifting clouds; the mist takes the horizon's
  colour the same way, so it still meets the sky without a seam. The frame block gained `uTime`
  (seconds; m per pixel at 1 m).
- **Less winding:** meanders 55 → 42 m, short bends 20 → 14 m (main roads 15/5 → 12/4). Measured
  over every pair of joined pieces in 16 × 16 km: bend radius p5 27 → 37 m, p50 96 → 126 m, bends
  under 30 m 7.2% → 1.4%. (The table in "Rolling hills" measured differently: 28 / 113 m.)
- **Clearings:** at first the groves were thick over 62% of the land, with clearings over 8%:
  from the lane, walls of stalks, and the misty ridges and the sky hidden. Now 43% and 21%
  (`smoothstep(-0.35, 0.2)` of the noise; the mean thickness 0.77 → 0.61, and ~20% fewer stalks).
- **Up close:** leaf cards within 2-5 m of the camera dissolve (their texels would fill the
  screen), and stalks within 1.2 m of it lean clear of the lens, as they do round the car.

**Drawing the bamboo** (the start view, ~7,000 stalks, 23 chunks, GPU ms p50 for stalks + leaves;
at 172 × 72 almost nothing is left but the work per vertex and per draw):

| Step | 860 × 360 | 172 × 72 |
|---|---|---|
| Instanced: a 6-sided tube in 4 segments (35 vertices), 3 cards of 3 × 3 (27); a draw per chunk | 1.94 + 2.10 | 1.58 + 1.48 |
| Chunks beyond 45 m as lines (3 vertices) and single quads | 1.91 + 2.06 | 1.69 + 1.63 |
| Every attribute starting on a multiple of 4 bytes | 1.92 + 2.04 | 1.72 + 1.62 |
| Not instanced: stalks from a float texture, a draw per chunk | 1.49 + 1.81 | 1.11 + 1.31 |
| A few draws for all the chunks (400 numbers each, those not planted dropped) | 1.43 + 1.73 | 1.07 + 1.23 |
| Fewer triangles: tube 5 × 3, cards 2 quads each, near within 30 m, 2 far cards; exact numbering | 0.90 + 1.15 | 0.57 + 0.75 |
| Far: one-segment lines, one card facing the camera; tube 5 × 2 | 0.84 + 0.93 | 0.45 + 0.53 |

- **Instancing** (Chrome → ANGLE → Metal on the Iris Plus 655): ~0.16 µs per instance, whatever
  its size. Lines of 3 vertices cost 1.49 ms against 1.69 for tubes of 35; one instance per chunk
  cost 0.40 ms. The rain's 10,000 vertices in one plain draw take 0.08 ms.
- **Then vertices:** ~7 ns each whatever the shader (the land's 42,000 cost 0.28 ms at 172 × 72).
- **Small draws:** a draw of one stalk cost ~17-20 µs of GPU time (1 chunk 0.05 ms, 5: 0.14,
  10: 0.22), but it isn't a fixed cost per draw: a few big draws cost barely less than a draw per
  chunk. Changing a uniform between draws made no difference.

**Driving** (following the road for 60 s, after the clearings; before: the same run, 20 s):

| | Before | After |
|---|---|---|
| Frames, dropped | 1,203, 3 | 3,566, 0 |
| JS p50 / p99 / max | 0.5 / 1.7 / 4.6 ms | 0.5 / 1.6 / 3.7 ms |
| GPU p50: clear, car, terrain, particles | 0.20, 0.03, 1.15, 0.03 | 0.19, 0.03, 0.82, 0.03 |
| GPU p50: stalks, leaves, rain, sky | – | 0.68, 1.03, 0.08, 0.07 |
| GPU p50, all passes | ~1.4 ms | ~2.9 ms |
| Stalks drawn p50 / max; particles max | – | 5,637 / 7,858; 146 |

The land got cheaper (1.15 → 0.82 ms): the stalks, drawn first, hide much of it. The leaves are
the dearest pass: ~half the work per vertex (most of it far cards), half their pixels.

- **Building** (`bench/build.mjs`, level 0 only, so every chunk plants): 0.431 → 0.538-0.555 ms a
  chunk (noisy runs), of which planting ~0.03 ms; the rest is the grove's two noises at every
  vertex. Skipping the smaller noise where the larger one already decides gave the same bytes but
  was slower (0.558 ms, more garbage: probably no longer inlined), so it's back as it was.
  Checksum `f5917ea5a0b723e0`.
- **Keep-up** (`bench/keepup.js`): no frames behind in any case; 0.20 ms of building a frame at
  top speed at 60 fps.
- **Physics** (`bench/physics.mjs`): following the road, 53.6 km at 22.3 m/s, no tip-overs, no
  jumps, off the road 1.2% of frames; off road, 17.4 and 14.3 m/s, one tip-over in all.
- **Textures:** 52 ms to make all seven the first time, as at startup (Node), was 42 for the four.

### Rolling hills and rare junctions (28 Sep 2026)

After playing the forest: "The relief needs to be reworked, it seems to be the same as the canyons
but this doesn't make sense since the forest shouldn't have such low recessions. Can you change
the relief so that the road is more bendy and twisty and goes up and down more as well at certain
points. Can you also remove the roundabouts and make the other features [junctions] far, far more
rare - they should be surprising not common." Scratch scripts measured the network, the roads'
bends and grades, and the land beside them, from `terrain.js`'s own functions.

**What changed.**

- **The roads rise and fall with the land** (`liftRoad`). Along each road, the land's shape
  without roads (`relief`) is sampled every 4 corners (~40 m), scaled by how closely roads
  follow the land there (`follow`: 0.2 to 0.95, changing every few km, so in some places the
  lanes climb and dip with the hills and in others keep lower and flatter), smoothed over ~80 m
  each way, limited to 6% steeper than `roadLevel` (forwards, then back), and rounded over the
  tops. At a node, by the land at the node, so every road meeting there agrees. Each piece keeps
  its lift at both ends; `roadDistance` blends the lifts of every piece within `LAND_ROUNDING`
  of the nearest (by how near), and the land is `roadLevel` + the lift beside the road, turning
  into `roadLevel` + `relief` over the same `RISE` as before.
- **Shallower, gentler land:** ridges 40 ± 20 m (were 65), wider (0.4 of their noise, not 0.3);
  spurs 10 m (16); hills ±12 m (16); valleys 4 m below `roadLevel` (20).
- **More bends:** meanders (up to ~55 m either way, ~260 m long) as well as short bends (~20 m,
  ~55 m long), faded in over 80 m from each node.
- **Junctions 4× rarer:** nodes on a 1,600 m grid (was 400), side roads 45% (50%), diagonals 20%
  (25%). Lowering the chances alone barely helped (1.0 to 1.75 km apart, with dead ends
  appearing): a node left with one road gets another to avoid a dead end.
- **No roundabouts**, and all their code (rings, islands, trimming roads to them) is gone.

**Measured** (before → after; the roads over ~60 km of them).

| | Before | After |
|---|---|---|
| Road between junctions, along the roads | 0.5 km | 2.2 km (68% of nodes are junctions; the rest bends) |
| Bend radius p5 / p50; share under 30 m | 44 m / 170 m; – | 28 m / 113 m; 6.4% |
| Grade p50 / p90 / p99 / max | 1.7% / – / 6.3% / 7.9% (canyons) | 4.3% / 8.7% / 11.3% / 14% |
| Crests and dips, radius p1 / tightest | – | 366 m / 67 m |
| Land 40 m either side, above the road (as if fully wild), p5 / p50 / p95 | −22 / +4 / +56 m | −14 / +8 / +36 m |
| Triangles steeper than 60°; steepest | 1.08%; 69° | 0%; 54° |
| Level of detail, p99.9 error, every 2 m / 4 m | 12 / 42 cm | 6 / 21 cm |
| Largest crack between levels, share of the skirt | 11% | 19% |
| Road pieces per chunk, most by level | 55, 70, 110 | 40, 51, 83 (room: 176) |
| Building a chunk (`bench/build.mjs`) | 0.518 ms | 0.443 ms (0.513 before caching roads) |

- **A step in the land:** at first, 32 triangles over 56°, up to 69°, 35 m from a winding road:
  where the nearest point of the road jumped from one bend to the next (which was 3 m higher),
  the lift jumped with it. Blending over every piece within 10 m of the nearest (not just the
  nearest of each road): none over 56°.
- **Jumps at the ends of roads:** 497% grades at first. Smoothing pulled the lift next to a node
  away from the node's own, which was put back afterwards, leaving a step. Now the ends are
  pinned before the grade limit, which then works in from both ends: at most 14%.
- **The cache** (`cacheRoad`): the same checksum with and without it (`586f5664ae2511a0` now).
- **Driving** (`bench/physics.mjs`): following the road, 52 km at 21.5 m/s, no tip-overs, no
  jumps, off the road 1.1% of frames (was 3.1%); off road, 2 × 20 minutes at 17.2 and 15.7 m/s
  (were 12.8, 12.7: the land is gentler), one tip-over in all, bump stop 4.9% and 4.1%.
- **Keep-up** (`bench/keepup.js`): no frames behind in any case; 0.16-0.93 ms of building a frame.
- **Frames** (headless Chrome, 860×360, following the road for 60 s): 3,750 frames, 1 dropped;
  terrain GPU p50 1.09 ms, p99 2.19; JS p50 0.4 ms, mean 0.62, p99 1.6; ~50 chunks drawn.
- **Towing** (`nearestRoad` far from a road) now searches 1.6 km each way for the nearest road,
  working out ~60 long roads: ~40 ms (measured once in Node, not warmed up; it happens in the
  frame where the camera cuts anyway).

### Forest country and dirt lanes (28 Sep 2026)

(The land, the roads' shape and the junctions changed again the same day: see "Rolling hills and
rare junctions" above. The roads' surface, the look and the textures are as here.)

"Don't download any assets for now, use basic fillers and make the terrain first. Also can you
change the roads to be dirt/sandy roads with some fade by the edges." Phases 1 and 2 of the plan
(see "Plan: the map rework"). Tools: `bench/relief.mjs` (maps), `bench/headless.mjs`
(screenshots, frames), and scratch scripts reading `terrain.js`'s own functions.

**What changed** (`terrain.js`, the shaders, `textures.js`, `main.js`).

- **Roads.** 6 and 5 m wide (were 8 and 6.5). Each road winds: its corners moved sideways by
  noise along it (up to ~18 m on side roads, 6 on main ones, bends ~70 m long), eased in over
  50 m from each node, so junctions keep their angles. Pieces ~10 m (were 16), to follow the
  bends. Roundabouts only where main roads cross or 5 roads meet (they were also at a quarter of
  side-road crossroads), 12 m to the middle of the ring (was 15). No markings: the middle lines
  and all their machinery went (where lines stop, pieces split where they start, the painted
  flags, the centre and dash numbers); a piece is 12 numbers (was 16).
- **Bends,** over ~10,000 joints between pieces: radius p1 33 m, p5 44 m, median 170 m; 3.4%
  tighter than 40 m; the tightest 19 m (a node's bend). (Winding ±14 m at first: p5 55 m, median
  223 m, too straight for "winding".)
- **Vertex:** the road's edge is now a 16-bit number in cm, frayed by noise (±0.5 m, ~2.5 m
  bulges) where it's under 8 m; the middle-line and dash bytes are gone.
- **Land:** hills (±16 m, 220 m across, 3 layers), big ridges (a 500 m noise near 0, rounded
  along the top, 65 ± 20 m), spurs (170 m, 16 m), minus 20 m for the valley floors; the rise from
  the verge 35 → 50 m.
- **Tuning the land** by its relief: the height above the roads' level where it's fully wild
  (200,000 points, from `landHeight` itself).

  | | p10 | p50 | p90 | below the road |
  |---|---|---|---|---|
  | First try: ridges 55 m, valleys 12 m, rise 35 m | −14 m | +16 m | +43 m | 34% |
  | Narrower ridges (0.3 of the noise), 65 m, valleys 16 m | −20 m | 0 | +46 m | 50% |
  | Plus spurs, valleys 20 m, rise 50 m (kept) | −18 m | +5 m | +51 m | 44% |

  The first try put every lane in a trench: the land beside it rose by about the same amount
  everywhere, within 35 m, so steep featureless walls ran alongside the road in every
  screenshot. With half the land below the roads' level, a lane runs along a bank with a view
  over a valley about as often as through a cutting. The big ridges alone made rings round
  basins on the map; the spurs break them into a network.
- **The look, tuned from screenshots.** Puddles seen from above read as black holes at
  Fresnel's 2%: they now reflect at least a third of the sky. Normalising each texture channel
  on its own turned the bank pink (the moss's green was taken off everything else): now only the
  brightness. Puddles covered 40% of the road at first; now ~10%.

**Level of detail and cracks** (the 1 m mesh over 6 areas of 480 m; "Levels of detail" has the
canyons' numbers).

| | p50 | p99 | p99.9 | max |
|---|---|---|---|---|
| Every 2 m against the 1 m mesh | 0.5 cm | 6.5 cm | 12 cm | 42 cm |
| Every 4 m | 2.0 cm | 24.5 cm | 42 cm | 89 cm |

- Cracks where levels meet (a finer chunk's edge vertex against the coarser one's straight edge,
  as a share of the finer chunk's skirt): largest 11% (1 m chunks, 48,960 edges) and 10% (2 m,
  12,960). Worked out from the land's heights along the chunk lines, not from drawn chunks.
- Slopes: 1.08% of 1 m triangles steeper than 60°, the steepest 69° (canyons: 0.9%, 71°).

**Cost.**

- **Road lists:** most pieces per chunk 55, 70 and 110 by level (were 38, 47, 59: shorter pieces,
  and roads reach 79.5 m now); room raised from 128 to 224.
- **Building** (`bench/build.mjs`): 0.526 ms per chunk against 0.518 for the old terrain run in
  the same session (+1.5%); garbage collections 106 per 1,000 chunks (was 138). Checksum
  `77ee774413da4e3c` (was `40ffc5957b8a126a`).
- **Keep-up** (`bench/keepup.js`): no frames behind in any of the four cases; building 0.20,
  0.41, 0.66 and 1.13 ms a frame (60 fps, 30 fps, and each 3× slower); 244 chunks at startup.
  `SEEN` is now 333 m: where the new mist is 96% sky colour.
- **Frames** (headless Chrome, 860×360, following the road for 60 s): 3,732 frames, 0 dropped.
  Terrain GPU p50 1.05 ms, p99 2.0 (at night: 0.95, 1.92: the mist's `exp`, two texture reads
  along the road's edges, the puddles); JS p50 0.4 ms, mean 0.67, p99 1.6; ~51 chunks drawn.

**Driving** (`bench/physics.mjs`).

- **The road autopilot tipped over 6 times in 40 minutes** (none on the old roads). All six
  were at the new, smaller roundabouts: at ~21 m/s it drove straight over the island's 1 m
  mound (with flat islands: none). The mound is now 0.6 m, rising over 6 m, and the ring 12 m
  (not 10): none.
- On the road: 55 km at 23 m/s on average, 0 tip-overs, off the road in 3.1% of frames (3.8%
  off the tarmac before), a bump stop hit in 0.2%. Off road, 2 × 20 minutes: 12.8 and 12.7 m/s,
  one tip-over in each, bump stop 5.9% and 5.7%, airborne 3.6% and 2.6%, tyres over 1 cm into
  the ground 1.0% and 0.9% of frames. 6.4 µs per `updateCar` at 60 fps.

**Not done / known:** bamboo (phase 3) and rain (phase 4); the particles are still dust (spray,
in phase 4); the sky is one flat colour (a gradient needs a pass of its own); nothing measured
in Zen.

### Why the fans come on (28 Sep 2026)

"The fans come on, but Activity Monitor says the game only uses ~20% CPU." Measured in real,
full-screen browser windows on the ultrawide (3440 × 1440 at 50 Hz), following the road for 30 s:
a throwaway Zen (the browser it's played in) or Chrome instance with its own profile, sampled
with `top` (per process) and `ioreg` (whole-GPU busy), as in `bench/sample-system.sh`.

| Setup | Whole GPU busy | Browser processes CPU | WindowServer CPU |
|---|---|---|---|
| Zen, full screen, a static page | 11% | 20% | 25% |
| **Zen, full screen, the game** | **54%** | 27% | 29% |
| Chrome, full screen, the game | 46% | 27% | 27% |
| Chrome, 900 × 420 window, the same 860 × 360 render | 12% | 25% | 31% |

- **It's the GPU, not the CPU.** Activity Monitor's CPU column counts 100% per thread (this machine
  has 8) and leaves the GPU out entirely (Window → GPU History shows it). The whole machine's CPU
  stayed at 15–19% of all threads in every run, but the GPU went from 11% to about half busy. On
  this MacBook the GPU is part of the CPU's chip: same power limit, same heat, same fan.
- **And not the game's own drawing.** Timer queries put that at ~1 ms of each 20 ms frame (~5%).
  The same render in a small window is 12%. What costs the rest is showing it full screen: 50
  times a second the browser stretches the 860 × 360 picture to 3440 × 1440 (5 million pixels) and
  macOS composites the screen. The "Render ~360 rows" row above assumed the stretch was free
  because compositing "runs anyway"; for a canvas that changes every frame, at full screen, it
  isn't: it's most of the GPU's work. (The earlier frame-budget runs used the browser pane, which
  never shows the canvas at full size, so they couldn't see this.)
- Zen costs a little more than Chrome (54% against 46%), within what one run each can tell apart.
- The CPU percentages include the Claude app redrawing its chat during the runs (WindowServer is at
  ~25% even on the static page). `ioreg`'s figure is busy time at the GPU's current clock, not
  power; `sudo powermetrics --samplers gpu_power,cpu_power` would give watts.

### Textures and dust (28 Sep 2026)

Reproduce with `bench/headless.mjs` and `?profile&autodrive=road&size=860x360` (40 s following
the road from the canyon spawn), against a copy of the game whose `terrain.frag` has the old
untextured logic, served on another port. Old and new alternated, back to back; the machine
was busy (load average 4–6), so single runs vary by ±0.05 ms.

| Terrain pass p50 | Old (untextured) | New | Cost |
|---|---|---|---|
| Both textures read for every pixel | 0.464 / 0.493 ms | 0.636 / 0.656 ms | +0.17 |
| **Only the textures each pixel needs (kept)** | 0.514 / 0.451 ms | 0.648 / 0.594 ms | **+0.14** |
| Same, `NEAREST_MIPMAP_NEAREST` (no blend between mipmap levels) | 0.489 / 0.422 ms | 0.597 / 0.636 ms | +0.11 / +0.21 |

- **Textures cost ~0.14 ms a frame** on the ultrawide's 860 × 360, ~30% of the terrain pass, and
  0.7% of a 20 ms frame. On the laptop's 576 × 360, about two-thirds of that.
- Dropping the blend between mipmap levels made no difference that shows through the noise, so
  the blend stays: without it, a line crosses the ground where one level gives way to the next.
- **Dust and smoke:** the particle pass is 0.026 ms p50 (p99 0.05–0.11). Following the road
  there are ~12 in the air on average (mostly exhaust), up to ~60; ~30 driving off road, ~80 in
  a handbrake slide on dirt. JS per frame unchanged: p50 0.2 ms, p99 0.8–0.9 in both.
- **Startup:** making the textures takes 38–74 ms in headless Chrome (a cold JIT: 20 ms in Node
  once warm), about as long as building the first 81 chunks (55–64 ms in the same runs). It runs
  while the shaders and models load, but locally they arrive sooner, so it adds most of that to
  the load. Not moved to a worker: it's once, before the first frame.
  - It first took 87 ms in Node: `%` on numbers V8 doesn't know are whole is a floating-point
    remainder (`fmod`), and the noise did 8 of them per lookup, plus `Math.hypot`. Bit masks
    (every tile period is a power of two) and `Math.sqrt`: 38 ms cold, 20 warm.
- **Physics unchanged:** the wheels now also record where the tyre touches, how fast it slides
  and how hard it landed, for the dust. `bench/physics.mjs` gives the same driving results to
  the digit; its cost, run alone with and without those lines, alternated: 6.8–6.9 / 9.9–10.1 µs
  (60 / 50 fps) in both. The terrain's checksum is unchanged (`761ca53886115fc1`).
- **Looks:** the textures only show where there's light: moonlit walls, and the headlight's pool.
  Outside the beam, moonlit asphalt sits between colour levels 1 and 2, where its texture's
  ±20% is only a change in the dither. Dust at night is about as bright as the ground it came from, so it's lit as if it
  scatters most of the moonlight (`0.8 × MOON`, against the ground's `N·L`), and opacity starts
  at 0.45–0.6. It shows most as two plumes behind the back wheels, red near the tail lights.

### Cleanup and review (28 Sep 2026)

A pass over the whole codebase for bugs, loose ends and speed. Reproduce with
`node bench/build.mjs` (building: time, garbage, checksum) on a copy of the old `terrain.js` and
the new one, and `bench/headless.mjs` with `?profile&autodrive=road&size=860x360` (frames).

**Bugs.**

- **The car started 114 m from its spawn point, on a different road.** `nearestRoad` answered in
  an object that every chunk build also wrote to, and `main.js` read it *after* the startup
  build of 81 chunks. So the car started wherever the last chunk's last vertex was nearest to a
  road. Every `?spawn=` measurement, and the physics bench's cost test, ran somewhere other than
  intended (the same place each time, so comparisons still held). The default spawn is now really
  at the canyon T-junction near (600, −260), where more canyon wall is in view: the terrain pass
  costs 0.54 ms p50 there, against 0.43 ms on the old route, measured back to back.
- **Towing sent the camera sailing across the map.** T moves the car up to a few hundred metres,
  and the camera eased after it for about a second, over the hills, with the land popping in
  around it. While it lagged, the car's chunk and the ring around the camera wanted the same slot,
  so each kept rebuilding the other's chunk. A tow is now a cut: the camera jumps behind the car,
  and everything missing around it is built in that frame, as at startup: up to ~40 ms (81 chunks
  at ~0.45 ms, when the tow goes too far to keep any), while the picture changes completely anyway.
- **Two copies of the road-following autopilot** (`?autodrive=road` and the physics bench) had
  drifted apart: the game eased off by ground speed, the bench by forward speed. Now there's one,
  `followTheRoad` in `car.js`. The bench's driving numbers came out identical to the digit.
- **The profiler's overlay was unreadable**: dark navy text (`#123`), from before the night look,
  on a navy sky. Now light grey.
- **"Circling" wasn't "no building".** `?autodrive` circles carry the camera across 2–3 chunk
  borders a lap, and each crossing builds a new row: 3.2 rows a frame on average, against 4.7
  following the road flat out. The frames table below labelled circling as no building.

**Faster building.** Node, 625 chunks in each of 4 places (canyons, hills, mixed), 6 rounds. Every
vertex byte is hashed, and the hash is the same before and after every step.

| Change | ms per chunk |
|---|---|
| Before | 0.63 |
| A noise lookup's 4 corners share their hash multiplies (3 `Math.imul` instead of 12) | 0.59 |
| + `roadDistance` stops working out the nearest point and heading (an `atan2`) for every closer piece it finds: only `nearestRoad` needs them. And `landHeight` skips noise it would throw away (the verge's width once past `WILD`, canyon vs hills while still on the verge) | 0.51 |
| + `noise` small enough for V8 to inline again (a `slope` helper; see Gotchas) | 0.45 |
| + no fraction stored in a module-level variable per vertex | **0.43** (−31%) |

- Building now takes ~0.45 ms per chunk, ~13 µs per row. Where the time goes now: noise about
  half, road distances ~15%.
- Headless Chrome: the startup build of all 81 chunks took 50 ms (was 68–84). Following the road
  for 60 s, twice: 3,700 frames, 0 and 1 dropped; JS p50 0.2 ms, p99 0.8 (was 0.9), max 1.6–1.8.

**Garbage.** These notes said the game loop allocates nothing. Chrome's allocation sampler
(DevTools protocol, `HeapProfiler.startSampling`, 15 s circling) says ~1.5 MB/s, all of it
boxed numbers (see Gotchas):

| Where | KB/s |
|---|---|
| Terrain building (`buildRow`, `layers`, `noise`, `roadDistance`) | ~950 |
| Physics (`wheelStep`, `step`, `collideWithGround`, `heightAt`, `responseAt`) | ~490 (~8 KB a frame) |
| `main.js` (`frame`, `lookAt`) | ~25 |

- With `--js-flags=--trace-gc`: 100–125 minor GCs per 30 s of driving (Chrome's young generation
  is small, ~1 MB). p50 0.11 ms each; a few took 1–3.5 ms, still well inside a 20 ms frame whose
  own JS is under 1 ms at p99. Measured
  before the last two changes above, which cut building's garbage by another ~25% (Node: 990 →
  722 minor GCs per 10,000 chunks, ~190 → ~140 KB per chunk).
- Left as it is. Removing the physics' boxing means writing every vector result into an output
  array; a Web Worker would take the terrain's garbage off the main thread. Neither is worth it
  while the GCs stay this small.

**Considered, not done.**

- **A dead band before the ring moves**, so that jiggling across a chunk's edge doesn't rebuild a
  row each time. A new row joins the ring 120 m ahead of the camera and is needed once it's
  inside the fog's 100 m: 20 m of warning, ~0.7 s at 30 m/s. A dead band of *d* m takes *d* of
  those 20 m, and at top speed a diagonal crossing (17 chunks, ~8 ms of building, ~0.3 s at
  50 fps) needs ~9 m of them. It would only help back-and-forth jiggling; circling crosses
  borders for real.
- **Checked and fine:** `heightAt` at chunk edges. `x − floor(x / 30) · 30` never came out
  negative (an index of −1 would read outside the chunk) over 18 million positions just below
  chunk edges.

### Endless canyon terrain (28 Sep 2026)

Reproduce with `node bench/physics.mjs` (driving), `node bench/relief.mjs` (a top-down map and
build time), and `bench/headless.mjs` with `?profile&autodrive=road&size=860x360` (frames).

**How it works** (`terrain.js`).

- **Roads.** One node per 400 m cell, jittered ±100 m. An east-west road runs through every row
  of nodes; north-south roads join half the neighbouring pairs. So there are no dead ends and
  junctions come every ~500 m, as T-junctions or crossroads. Between nodes each road swings up to
  60 m sideways, and it's drawn as a Catmull-Rom curve (smooth through the nodes, no kinks), cut
  into ~17 m straight pieces. The distance to the nearest piece says where the road is.
- **Road markings.** Each vertex stores its signed distance to the nearest east-west road and,
  separately, to the nearest north-south road (one byte each, 5 cm steps, ±6.35 m), or "unknown"
  if it's further away or past the end of the road. The shader only trusts a distance if all three
  corners of the triangle know it. East-west roads are the main roads: their middle line carries
  on through junctions; a side road's lines stop at the main road's edge, and an edge line breaks
  where another road joins.
- **Road height** is one smooth field (3 layers of noise, 900 m across, ±20 m), not a profile
  along each road. Crossing roads therefore meet at the same height with no extra work. Over
  120 km of road: grade median 1.7%, p99 6.3%, max 7.9%. The same field tilts the road sideways by
  about as much (median 2%, max 7.6%, ~4°).
- **The land** is the road's height, plus how wild it's allowed to be: nothing on the road and
  its verge (8–20 m from the middle, varying), then rising to full over 35 m. The distance used
  is a smooth minimum of the distances to the two nearest roads, so the land doesn't crease along
  the line halfway between them at a junction's corners. It's smooth, for now:
  - **Canyon country:** mesas 50 m tall (a noise layer pushed through a `smoothstep`, so it's
    mostly either plateau or floor), and gorges 35 m deep where a second noise crosses 0.
  - **Hills:** 3 layers of noise (±24 m), plus round-bottomed dry washes along the same zero
    crossings.
  - Which of the two you're in changes every couple of km.
  - Every slope stays under ~2 m of rise per metre (70°): 0.9% of triangles are steeper than 60°.
    The 1 m grid can't draw anything steeper smoothly.
- **Smooth shading.** Each vertex stores the ground's normal there, from the heights either side
  of it (each chunk builds a one-vertex border of heights for its edges). The shader blends the
  three corners' normals, instead of lighting each 1 m triangle flat. The layered rock is just
  colour: broad bands shading from red to pale with height.
- **Chunks:** 9 × 9 of 30 × 30 m around the camera (enough to reach the 100 m fog), in a ring of
  slots. When the camera enters a new chunk, the row or column falling out of range is
  reassigned to the one coming in. Each slot is then rebuilt a row at a time, nearest first, for
  at most 0.5 ms a frame, and uploaded to its own GPU buffer once finished. A chunk isn't drawn
  until it's complete. Physics asking for a chunk that isn't built (only after a teleport) builds
  it on the spot.
- "Endless" in practice: grid indices go through 32-bit integer hashes, so the finest noise
  (5.5 m grid) repeats after ~24 million km. Float32 vertex positions are the real limit: 1 mm
  steps at 10 km from the start, 8 mm at 100 km (about an hour flat out). Both are well under a
  pixel at 360 rows.

**Build cost** (Node, 81-chunk rings in fresh areas, 6 rounds each).

| Where | Per chunk (961 vertices, 1,089 heights with the border) |
|---|---|
| Canyons | 0.56–0.91 ms |
| Hills | 0.57–0.77 ms |
| Start area (both) | 0.67–0.79 ms |

- About 0.5–0.8 µs per height: ~15 noise lookups and a few road pieces. Skipping the hills'
  noise in pure canyon (and the other way round) saved ~20%.
- In headless Chrome, a cold build of all 81: 68–84 ms. The browser pane took 146–480 ms for the
  same, varying from load to load: the pane is slow and noisy for this (see pitfalls).
- (Build times here are from before the cleanup, which made building 31% faster: see "Cleanup and
  review".)
- **Startup builds all 81 chunks at once: ~60 ms in Node, 146–188 ms in the browser pane**
  (whose JIT hasn't warmed up yet at load; the old fixed 64-chunk map took 12.7 ms). It happens
  before the first frame, so it adds to load time only. Building just the nearest 25 would cut it
  to a third, but the rest would then appear through the fog over the first second.
- **While driving:** a chunk boundary is crossed about once a second at full speed. That brings
  9 new chunks (17 on a diagonal), which must be built before the car covers the 20 m between the
  ring's edge and the fog's end: ~0.2 ms a frame, flat out.

**Frames** (headless Chrome, 860×360 = ultrawide fullscreen, 60 Hz, following the road through
canyons).

| Build budget | Frames | Dropped | JS p50 / p99 / max | Terrain GPU p50 / p99 | Chunks drawn |
|---|---|---|---|---|---|
| 1 ms | 2,571 | 1 | 0.2 / 1.4 / 4.8 ms | 0.42 / 0.90 ms | 18 (max 22) |
| **0.5 ms (kept)** | 3,552 | 0 | 0.6 / 1.0 / 2.0 ms | 0.42 / 0.56 ms | 18 (max 22) |
| 0.5 ms, circling (not "no building": see below) | 2,390 | 0 | 0.2 / 0.7 / 1.7 ms | 0.37 / 2.6 ms | 4–21 |

- Rows built: 4.7 per frame on average, p99 22. The chunks never fell behind: none was missing
  inside the fog.
- A third run of the 0.5 ms setting dropped 66 frames, with 8–18 ms spikes in *every* GPU pass
  at once (car included). The next run, same code: 0 dropped. So that was contention from
  outside the page, as before.
- **No Web Worker needed yet.** Building takes ~0.2 ms a frame when it's needed at all, and the
  budget caps the worst frame. A worker would cost a copy per chunk, a second copy of the code in
  another thread, and the stale-cache problem twice over.

The table above is for the first version (4-byte vertices, flat shading); the smooth version
builds as fast, and its terrain pass is cheaper (see "Second pass" below).

**Driving on it** (`bench/physics.mjs`: random keys off road, or following the road at up to
25 m/s; 5-minute drives, 4 per row except the road's 8).

| | Speed | Tip-overs | On side or roof | Bump stop | Airborne | Tyre in ground p99 / > 1 cm |
|---|---|---|---|---|---|---|
| Old hills (fixed map) | – | every 3.3 min | – | 20% of frames | 5% | 3.9 cm / 18% |
| First version: hills | 9.1 m/s | every 6.7 min | 2.8% | 8.3% | 6.3% (90 jumps) | 2.5 cm / 6.9% |
| First version: canyons (cliffs) | 2.3 m/s | every 2.5 min | 8.9% | 18% | 1.3% | 5.2 cm / 27.5% |
| **Smooth: hills** | 12.8 m/s | 1 in 20 min | 1.2% | 6.0% | 4.2% (43 jumps) | 1.1 cm / 1.1% |
| **Smooth: canyons** | 10.7 m/s | 1 in 20 min | 4.6% | 5.8% | 4.6% (39 jumps) | 1.6 cm / 1.9% |
| **Smooth: on the road** | 21.6 m/s (52 km) | none | 0% | 1.0% | 0.1% | 1.5 cm / 1.3% |

- In the first version's canyons, random driving mostly bumped along the cliffs, or climbed a
  few steps and tumbled back down. Smooth walls are climbable in places, so it gets about.
- On the road, the bump stop is hit where the road-following driver cuts off a bend or junction
  and crosses rough ground: 1,385 of 1,401 bump-stop frames were more than 8 m from any road.
  T tows the car back to the road.
- Tyre depth is now measured straight out of the ground, not straight down: on a cliff, a point
  a few cm inside the face is metres below the top of it.
- Physics cost: 5–9 µs per frame (60 / 50 fps), up from 5.5–8. Noisy between runs.

**What had to change to get there.**

- **The hills rose 24 m within 15 m of the verge at first**: up to 67° slopes with a sharp crease
  at the bottom. A tyre only rests on the one triangle under it, so its rim sank into the crease:
  p99 10 cm into the ground. Rising over 40 m instead, and round-bottomed washes instead of
  V-shaped ones: 2.5 cm.
- **The body was pushed straight up out of the ground.** With cliffs, a bumper 1 m under a
  cliff's top is only a few cm inside its face, and lifting it 1 m would pop the car onto the
  cliff. It's now pushed out along the ground's normal, by the depth measured that way.
- **A wheel reached ground 78 m away**, found by a stress test (`?autodrive` circles hung the page,
  so 25 two-minute drives with jittery frame times ran in Node): the car on its side against a
  cliff, a wheel's suspension starting *inside* the rock. The ray met that triangle's plane
  behind it, at a negative distance, which still counted as touching. Full spring force with a
  78 m lever arm: spin went 3 → 626 rad/s in one step, then the position grew without bound, and
  the road search looped forever over "cells" from 10¹⁹ to 10¹⁹ (at that size, `k++` doesn't
  change `k`). Clamping the distance at 0 fixed it: 7.5 hours of stress driving since, peak spin
  14 rad/s.
- **Stuck leaning on a wall.** The automatic reset waited for the car to tip past 72°; leaning at
  60–72° against a canyon wall it never did. It now resets past 60°.
- **The first canyon looked like sand dunes**: the land rose smoothly over 25 m and the steps
  faded in with it. Steps at full strength from just past the verge, over a 15 m rise, gave
  cliffs. (Then the cliffs went; see below.)

**Levels of detail (28 Sep 2026).** At 400 m, a 1 m square is about a pixel: most far triangles
were sub-pixel, and ~740 chunks were built for ~170 drawn.

- **How coarse, measured first:** the 1 m mesh against the same land sampled every s m (its
  triangles), over 4 areas of 480 m (canyons, hills, mixed). 1 px at d m is ~0.0023 d m (45°,
  360 rows).

  | Every | p50 | p99 | p99.9 | max | p99.9 under 1 px beyond |
  |---|---|---|---|---|---|
  | 2 m | 0.5 cm | 7.5 cm | 15 cm | 31 cm | 63 m |
  | 4 m | 1.8 cm | 28 cm | 50 cm | 1.1 m | 217 m |
  | 8 m | 8 cm | 1.06 m | 1.8 m | 3.7 m | 782 m (not used) |

  So: 1 m within 100 m (the middle line too: see below), 2 m to 220 m, 4 m to 400 m. Each level's
  chunks are 31 × 31 vertices, so 30, 60 and 120 m across: the same index list, and the vertex
  shader multiplies by the spacing (`uChunk.z`).
- **Choosing what to draw** (`select`, every frame, ~21 µs): from each top-level chunk within the
  fog, a chunk gives way to its 4 children where the finer level takes over, but only once they
  (or theirs) can all be drawn; if a chunk isn't built but its children are, they're used anyway.
  So the land never has holes while finer chunks are built: the coarse one stays until they're
  ready. A hole can only happen if building falls far behind; one within `SEEN` (360 m) is built
  at once.
- **Building ahead** (`mostDue`): each chunk is wanted `AHEAD` (40) m before it's needed (a top
  chunk before it's inside the fog, a finer one before its parent is inside where its level takes
  over), and no longer once it's 40 m inside where its own children take over. The one needed
  soonest is built first, across all levels. Rings of 14², 13² and 9² slots (446, was 961) are
  just enough for everything a level can want at once.
- **Cracks between levels:** a finer chunk's edge has vertices between the coarser one's, which
  needn't lie on its straight edge. Each chunk hangs a skirt from its edges: 124 more vertices
  (copies of the edge ones, 2 m per m of spacing lower) and 240 triangles, facing out (a crack can
  only be seen from the other chunk's side). Checked over 160 camera positions and 11,488 edges
  where levels meet: the largest gap was 14% of the skirt covering it; none uncovered.
- **Markings:** the edge lines are painted at every level (they come from the distance to the
  tarmac's edge, which interpolates well); the middle line only in 1 m chunks: finding it needs
  every corner of a triangle within 1.55 m of it, and two lines can be 5.25 m apart. At 100 m it's
  under a pixel wide.
- **Level 0 is unchanged:** the 1 m chunks' vertices match the old ones byte for byte.
- **Results** (headless Chrome, 860×360, following the road; all at 1 m → levels): chunks drawn
  170 → 52; terrain GPU 1.68 → 0.95 ms (p99 3.91 → 1.92); JS per frame 0.72 → 0.63 ms (p99 1.7 →
  1.6). Startup: 737 chunks → 238, 0.58 → 0.21 s in the browser pane. `bench/keepup.js` (Node):
  ~19 chunks built a second at top speed (was ~30), 0.21 ms of building a frame, and no frames
  behind, even at 30 fps with building 3× slower (was 591 of 3,000). Road lists: room for 128
  pieces each (the most measured: 38, 47, 59 by level), 7 MB in all (was ~23 MB).
- **V8's inlining budget.** A 1 m chunk builds ~7% slower than before in Node (0.48 → 0.515 ms),
  though its code is the same: V8 no longer inlines `landHeight` into `buildRow`. It inlines at
  most 920 bytes of bytecode into a function, and `landHeight` plus what V8 had already inlined
  into it came to 913 (465 of it inlined; in the old runs, 39). Tried and reverted: storing its
  result instead of returning it, a separate row-building function, writing `roadBytes` and
  `farFromRoads` into `buildRow`. With `--max-inlined-bytecode-size-cumulative=3000` the same
  code takes 0.445 ms. Choosing chunks as functions returning numbers (`due`, `gap`) boxed them:
  now inline in `mostDue` (0.531 → 0.515 ms).
- **Physics bench** (`bench/physics.mjs`, its first run on the new road network too): runs;
  following the road 40 min, off the tarmac in 3.8% of frames, no tip-overs; 6.6 µs per
  `updateCar` at 60 fps.
- **Not done / known:** the switch between levels at 100 and 220 m can pop slightly (up to a few
  pixels on steep walls; no blending between levels). The middle line stops at 100 m. Zen not
  measured.

**Render distance ×4 (28 Sep 2026).** Fog 20–100 m → 80–400 m (the same curve, 4 times as far);
chunks built within 440 m (was 140), finished at once within 360 m (was 90); the far clip plane is
FOG_END (it was already 400); building budget 0.5 → 1 ms per frame.

- **Browser pane** (Chrome, 860×360 = ultrawide fullscreen, following the road; before → after):
  chunks drawn ~28 → ~170; terrain GPU 0.15 → 1.6 ms (p99 1.85); JS per frame ~0.45 → 1.1 ms
  (p99 1.8; ~500 GL calls for the chunks, 3 each); startup 737 chunks in 0.58 s (was 86).
  Memory: 961 slots, ~37 KB each in JS (24.6 KB of it the road list), 7.7 KB each on the GPU.
- **Keep-up** (`bench/keepup.js`, Node, frames starting with a chunk unbuilt inside 360 m):
  0.5 ms budget: 0 at 60 fps, but building needed 0.28 ms a frame on average, and with building
  3× slower 613 of 6,000 frames fell behind. 1 ms budget: 0 at 60 and 30 fps, and at 60 fps 3×
  slower; only 30 fps *and* 3× slower falls behind (591 of 3,000).
- **Where to cut it next, if needed:** far chunks at a coarser grid (done next: "Levels of
  detail"), and all chunks in one instanced draw call (vertex data pulled from a texture array)
  instead of 3 calls each (not done: with levels, only ~52 chunks are drawn).

**Chunk loading (28 Sep 2026).** "I can see chunks loading when I drive." Measured in Node with
`bench/keepup.js` (the camera at 30 m/s, diagonally, 3 km, building as main.js does); the game
itself wasn't measured in Zen.

- **Before:** a 9 × 9 square around the camera's chunk. Crossing into the next chunk brought a
  whole row of 9 new ones (17 diagonally) at once, only 20 m before the fog showed them, and
  "nearest" was by chunk (Chebyshev), so the square's far corners, never seen, could be built
  before the chunks straight ahead.
- **Now:** chunks within 140 m of the camera, nearest point first; an 11 × 11 ring of slots
  holds them. They come into range continuously (~10 a second flat out), each with 40 m of
  warning. Any still unbuilt within 90 m (`SEEN`: 96% fog) is built at once, past the budget.
  Slots are reassigned only when their new chunk is about to be built, so old chunks stay drawn
  meanwhile.
- **Building:** 0.60 → 0.46 ms per chunk (`bench/build.mjs`), checksum unchanged. Each 11-vertex
  stretch of a row copies out only the road pieces that can change it (`nearbyRoads`: lists
  average 9.7 pieces, 4.6 kept), and skips the road maths where all roads are 61.5 m+ away
  (`farFromRoads`). The dash byte is now 0 where there's no centre line (it was unused there), so
  the filtered and unfiltered results match byte for byte.
- **Keep-up** (frames starting with a chunk unbuilt inside 90 m, of 3,000-6,000; building 3×
  slower stands in for a slower machine or JS engine; noisy: other load on the machine):

  | | 60 fps | 30 fps | 60 fps, 3× slower | 30 fps, 3× slower |
  |---|---|---|---|---|
  | before (the square; same builder) | 0 | 0-93 | 0 | 3-22 |
  | now | 0 | 0 | 0 | 0-3 |

- **Browser pane:** loads with no errors; 86 chunks at startup; ~28 drawn; 0.45 ms JS per frame
  on average following the road.
- **Not measured:** Zen itself (Firefox rounds `performance.now()` to ~1 ms, so each frame's
  budget there is 0.5 ms only on average).

**Road network, third version (28 Sep 2026).** "A proper complex road network, not just T junctions",
and the white edge lines never joined up at junctions (they stopped short of each other, leaving a
gap at each corner). Tools: `bench/relief.mjs` (map); scratch scripts rendered the markings exactly
as the GPU interpolates them.

- **Network** (`terrain.js`, "The road network"). Nodes on a jittered 400 m grid (±15%). Roads
  east-west, north-south and across some squares' diagonals (the shorter one, never into a node
  that already has 4 roads, so no crossings between nodes). 25% of whole lines are main roads.
  A node whose roads all leave within 45° (dead end, sharp V), or three within 90°, gets an extra
  road opposite. Roundabouts where main roads cross, at 5+ roads, and at 25% of side crossroads.
  At each node the main road, else the straightest pair (≥ 60° apart for 2 roads, ≥ 135° for
  more), carries on as one smooth curve; the rest end there. Over 6,561 nodes: 3-way 34%, 4-way
  25%, roundabouts 11%, bends 27%, empty 2%, dead ends 0%.
- **Markings.** Per vertex: distance from the tarmac's edge (a smooth minimum over road groups,
  so corners are rounded; divided by its gradient so edge lines stay 15 cm wide round corners),
  signed distance to the nearest painted middle line (unknown past 1.55 m or past a line's end),
  and distance along a dash. A road ending at a through road is cut off square along that road's
  middle (with the cut's distance ×4), so the rounding can't pull out the far edge. Side-road
  lines stop 3.5 m either side of each node, inside the gap between dashes, so their signs never
  need to agree across a node; main roads run east or north, so theirs always do. Rendered
  top-down at 6–10 cm/px: 0 stray yellow or white pixels at a T, a roundabout, bends, Ys and
  two 500 m squares.
- **Vertex format** unchanged in size: the padding byte now holds the dash.
- **Chunk road lists match a wide search** at 392,000 random points, once (1) roads within
  WILD + LAND_ROUNDING are included (a road just beyond WILD still rounds the land distance; the
  old code could crack chunk edges this way too) and (2) the smooth minimum is chained nearest
  first (it isn't associative, and chunks find groups in different orders).
- **Cost:** 0.57 ms per chunk in Node vs 0.42 before (+36%; `bench/build.mjs`). `findRoads` is
  29 µs per chunk (was 70 before caching each search's chances in a grid and trimming its windows).
- **Roundabout islands** are a 1 m flat-topped mound (the land's distance rule made a cone).
- **Default spawn** moved to (600, −330): heading north into a roundabout.
- **Not done / known:** pieces are ~16 m regardless of curvature, so tight bends (radius ~25 m at
  90° bends) show corners in the lines (fit pieces adaptively). No stop lines. `followTheRoad` and
  `bench/physics.mjs` weren't re-run on the new network (the autopilot may circle roundabouts).
  Headless frame timings not re-measured.

**Second pass: smooth land, junction markings, the mid-air glitch (28 Sep 2026).** After playing
it: "jarring textures, divots that repeat periodically, some too deep, casting strange shadows";
no markings near T-junctions, and small square patches of road running diagonally into the land
from their corners; and the car glitching in mid-air over deep valleys.

- **The periodic divots were the rock steps and flat shading.**
  - Steps every 6 m of height, applied to *all* ground, cut a ledge into gentle floors and mesa
    tops each time they crossed a 6 m level: rows of evenly spaced grooves, each casting a dark
    line.
  - On the walls, the steps made risers of up to 10 m per 1 m grid square. Lit flat, a steep
    face's triangles alternate light and dark with the grid's diagonals: a regular diamond
    pattern. 5.4% of triangles were steeper than 70°.
  - (Not the hash: its low 4 bits, used to pick gradients, match at every offset tested 6.3%
    of the time, the same as its high bits and as chance.)
  - Fixed by removing the steps, the 0.5 m bumps and the rough ledges; widening walls to
    ≤ ~2 m/m (triangles steeper than 70°: 5.4% → 0.02%, the steepest 83° → 71°); and smooth
    shading with stored normals.
  - Smooth shading alone still left the diagonal pattern on the steepest walls: the grid just
    can't draw them.
- **The junction glitches were the road distance's sign.**
  - One byte held the signed distance to whichever road was nearest, clamped at ±5 m. Wherever
    the nearest road changes (along the line halfway between two roads, which runs diagonally
    out of a junction's corner), the sign flips. Blending +5 with −5 across a triangle passes
    through 0, so every triangle on that line got a sliver of road: the diagonal patches.
  - The missing markings were deliberate, and wrong: markings were switched off within 12 m of
    any junction.
  - Rendering the markings exactly as the GPU interpolates them, top down at 7 cm per pixel,
    the old encoding had 5,005 road pixels more than 0.5 m from any road around one T-junction,
    and 3,757 across 800 × 800 m. The new one (two distances, "unknown" instead of a clamp, and
    each road's end marked): 0 and 0.
- **The mid-air glitch was the suspension reaching the far side of the valley.**
  - Each wheel follows its suspension line to the plane of the triangle below. Flying over a
    valley, the first guess is far below, so the second look is far away along the line, often
    on the far wall. Carried back under the car, that wall's plane can pass above the wheel:
    clamped to 0 (the fix above), that counted as touching, with full spring force, in mid-air.
  - Now a wheel whose first guess is beyond its reach is simply in the air.
  - Frames with a wheel "on the ground" while 1.5 m or more above it, over 40 minutes of random
    driving: 683 before, 0 after.
- **Cost.** Vertices doubled to 8 bytes (the normal); building stayed at 0.56–0.91 ms per chunk,
  as the smoother land needs fewer noise lookups than the border and normals add.
  - Headless Chrome, following the road for 60 s: 1 dropped frame in 3,572; JS p50 0.2 ms, p99
    0.9 ms. The terrain pass fell from 0.42 to 0.27 ms p50, because reading a stored normal is
    cheaper than working out a flat one from screen-space derivatives for every pixel.
  - Its p99 was 4–9 ms in both runs, with 4 ms spikes in clearing the screen too, so something
    outside the page was busy.
  - 5 hours of stress driving (40 random + 20 circling drives of 5 minutes): no blow-ups.

### Physics engine: a rigid body on sprung wheels (28 Sep 2026)

Reproduce with `node bench/physics.mjs`.

Measured with 1.3 Hz springs. They were then stiffened to 1.6 Hz by feel (less bouncy wheels,
10 cm of droop in the air instead of 15), without re-measuring.

**How it works.**

- **The body** (`physics.js`):
  - One rigid body: position, velocity, orientation (a quaternion) and spin.
  - Every force is applied as an impulse (force × step) at a point, so it both moves and twists
    the body.
  - Each frame is split into equal steps of at most 1/120 s.
- **Each wheel** (`car.js`, `wheelStep`):
  - Follows its suspension line down to the terrain's triangle.
  - Rests the tyre on it as a cylinder.
  - Pushes the car up with a spring and damper, along the ground's normal.
- **Its tyre:**
  - Cancels its own sideways and rolling slide, up to grip × load. Past that it slides.
  - The engine drives the back wheels (rear-wheel drive, like the AE86); the brakes resist rolling.
  - The handbrake locks the back wheels and cuts their sideways grip to a third, so the tail
    swings out.
- **Body collisions:**
  - 22 points on the body are kept out of the ground by impulses: the bumper corners, sills,
    door tops and roof, plus the bottom of each fully squashed tyre, which acts as the bump stop.
  - Hard hits bounce back 30%.

**Why the old car clipped.** It tilted one rigid plane through 4 ground samples at the middle of
each axle and each side. A wheel's own patch of ground could be above that plane.

Tyre depth into the ground: 8 random 5-minute drives on the hills, with the same keys for both
cars (the middle row is the first tuning, over one of those drives):

| | Median | p99 | Worst | Frames with a tyre > 1 cm in |
|---|---|---|---|---|
| Old: car on 4 ground samples | 9.0 cm | 29 cm | 57 cm | 96% |
| New, wheel centre a radius above the ground point | 2.0 cm | 6.9 cm | 15 cm | 83% |
| **New, tyre rested as a cylinder** (kept) | **0.2 cm** | **3.9 cm** | 16 cm | **18%** |

- In the middle version, 99.8% of the clipping was at a tyre's *edge*. The ground under a wheel
  often tilts across it, so one side of the 19 cm tyre dips in.
- What's left is creases between the 1 m triangles under a tyre's edge: 1.5 cm when it happens,
  half a pixel at the game's resolution. On flat or tilted planes the deepest is 4 mm (the body
  moves during the frame's last step).
- A wheel pushed past its bump stop is drawn rising into its arch, where the body hides it,
  rather than sinking into the ground.

**On flat ground.**

| Test | Result |
|---|---|
| Dropped from 50 cm | Squashes 9.5 cm below its resting height and rebounds 1.5 cm above it. Settled in ~1.2 s |
| Full throttle | 0–100 km/h in 8.7 s (a real AE86: ~8.5), top speed ~29.5 m/s. Nose up 1.5° |
| Braking from 29 m/s | 1.23 g, 34 m, nose down 2.5°. Holding the brake then reverses |
| Full lock at 10 / 15 / 20 / 25 m/s | Turning circle radius 10 / 21 / 38 / 62 m, ~1.0–1.1 g, leaning ~4° |
| Handbrake flick (0.4 s), full lock, 15 m/s | Turns 118° in 3 s, the tail sliding out 13° |
| Parked on a 20° slope, no pedals | Holds (the brakes hold a stopped car) |
| 3 m ramp at full throttle | 1.5 s in the air, 4.1 m up, lands on its bump stops, bounces once, stays upright |

**Tuning against tipping over.** The first version (centre of mass 50 cm up, damping ratio
0.3, sideways tyre forces at axle height) tipped over constantly on these hills. Over 8 random
5-minute drives:

| Centre of mass | Damping | Sideways forces at | Tip-overs in 40 min | Lean in a 15 m/s turn |
|---|---|---|---|---|
| 0.50 m | 0.3 | axle (0.32 m) | 39 | 5.1° |
| 0.35 m | 0.45 | axle | 12 | 1.3° |
| **0.35 m** | **0.45** | **0.2 m (kept)** | **12** | **4.3°** |
| 0.35 m | 0.3 | 0.2 m | 18 | 4.2° |
| 0.35 m | 0.35 | 0.2 m | 25 | 4.2° |
| 0.30 m | 0.45 | 0.2 m | 11 | 3.0° |
| 0.35 m | 0.45 | the ground | 18 (20 min) | 9.4° |

- **The tip-overs built up over a second or two, while driving across 20–49° hillsides at
  5–13 m/s.** A real car tips there too. None was at high speed, and the handbrake was on for
  only one.
- **The height the sideways forces act at** (the roll centre) sets the lean in corners, but
  hardly changes how often the car tips. So 0.2 m gives back the lean for free.
- **At the ground, the lean doubles to 9°, and so do the tip-overs.**
- Kept: 12 in 40 minutes, about one every 3 minutes of deliberately reckless driving. R, or
  2 seconds stuck on its side, puts the car back on its wheels. Smoother roads are the real fix.
- On these hills, a wheel is on its bump stop in 20% of frames: bumps ~1.5 m apart are faster
  than 1.3 Hz springs can follow. The car is airborne 5% of the time: 167 jumps over 0.3 s in
  40 minutes.

**Cost.**

- **JS:** `updateCar` takes 5.5 µs per frame at 60 fps (2 steps) and 8 µs at 50 fps (3 steps),
  up from 0.27 µs. Still 0.04% of the frame.
- **Frame, in headless Chrome** (`bench/headless.mjs`, `?profile&autodrive&size=576x360`,
  1,497 frames):
  - JS p50 0.1 ms, p99 0.5 ms.
  - Car pass 0.032 ms p50, p99 0.054. Unchanged, since the physics adds no draws.
  - One dropped frame. It came with 3.6–3.9 ms spikes in every pass at once, so it came from
    outside the page.

### Textured car: model, animation, tail lights (28 Sep 2026)

- **The model.** Car 03's file is 5.6 m long (the pack's author notes its scale is off), so it's
  scaled by 0.7 to 3.9 × 1.85 × 1.5 m, almost exactly the old box car, so the camera and
  headlight needed no changes. Its front is +z, like the game: the tail-light texels are on
  the faces at the −z end. The ground is now sampled under the axles and wheels, which are
  worked out from the wheel positions.
- **Cutting out the built-in wheels.** "All corners within 0.35 m of a wheel centre, and
  within 0.14 m of its middle side to side" caught exactly the 64 wheel faces (4 × 16, 112
  triangles), and no face was only partly inside. The body keeps 336 triangles.
- **Animation, simulated in Node** (`updateCar` at 60 steps a second): the front wheels reach
  28.6° left and right. Roll is 2–3° in a full left turn at 11–16 m/s, and overshoots to −4°
  when the steering flips. Pitch is −2.1° (nose up) pulling away, settling to −1.4° as drag
  builds. It's +5.7° (nose down) braking from 19 m/s, back to 0.8° once stopped.
- **Brake lights, read back from the canvas** (brightest pure-red pixel, 0–255): 156 while
  driving, **255** while braking, 156 again after letting go.
- **GPU cost, provisional:** the car pass was **0.033 ms** p50 (p99 0.063) at 576×360, against
  0.054 ms for the box car. That's only 14 frames, because the pane was hidden (one frame every
  2 s), so re-measure with the window on screen. 5 draws instead of 1 hasn't made it slower.

### What the dither costs, and cheaper ways to get the pattern (26 Sep 2026)

`?profile&autodrive&size=1720x720` (6× the laptop's real pixel count, to make per-pixel costs
easy to see), 25 s per run, laptop display. Only the terrain shader was changed; terrain pass p50:

| Variant | Terrain p50 | vs no dither |
|---|---|---|
| No dither: plain 8-bit output | 0.858 ms | – |
| Rounding to 32 levels only, no pattern | 0.906 ms | +0.05 |
| **4×4 table (kept)** | **1.041 / 1.042 ms** | **+0.18** |
| Table, but position forced to 0: same work, output has no pattern | 1.055 ms | +0.20 |
| 4×4 texture, `texture(uDither, gl_FragCoord.xy / 4)` | 1.028 ms | +0.17 |
| Pattern from integer bit maths (`x ^ y`, shifts) | 1.080 / 1.085 ms | +0.22 |
| Pattern from float maths (`fract`, `step`, `abs`) | 1.150 ms | +0.29 |

- **The cost is the extra instructions, not the dithered output.** Forcing every pixel to the
  same pattern cell keeps the work but removes the pattern, and costs the same. The terrain
  shader is short, so the ~15 instructions dithering adds are about 20% more work per pixel.
  Every shaded fragment pays it, including ones later hidden behind nearer hills.
- Working out the pattern (+0.13) costs more than the rounding itself (+0.05).
- The table is already the cheapest way to compute the pattern: bit maths is 4–10% slower. The
  texture was 1% faster, within noise, and needs a texture set up in JS: not worth it.
- At the real laptop size (576×360, 1/6 the pixels) the whole dither costs ~0.03 ms of a
  16.7 ms frame.
- Ordered dither is already the cheapest kind: error diffusion (Floyd–Steinberg) needs each
  pixel's left and upper neighbours to be finished first, so it can't run pixels in parallel.

### Block size from the screen; power-of-two sizes (26 Sep 2026)

A fixed row count made the block size depend on the window: a small window got the same
number of rows as fullscreen, so smaller blocks. Now the block size comes from the screen
(`screen.height × devicePixelRatio / 360`, rounded to whole screen pixels), so every window
uses fullscreen's block size. Checked: the 607×334 browser pane renders 243×134 in 5-pixel
blocks, the same blocks as fullscreen's 576×360 (it used to get ~334 rows of 2-pixel blocks).
A `TARGET_ROWS = 330` setting was already giving 360 rows fullscreen on the laptop because of
the rounding (1800 / 330 = 5.45, so 5-pixel blocks, 1800 / 5 = 360 rows).

`?profile&autodrive&size=…`, 30 s each, laptop display (60 Hz):

| Render size | Pixels | Clear | Terrain | Our GPU total | Dropped |
|---|---|---|---|---|---|
| 512×256 (powers of two) | 131,072 | 0.096 | 0.198 | **0.348 ms** | 0 |
| 511×257 (both odd) | 131,327 | 0.093 | 0.202 | **0.347 ms** | 0 |
| 576×360 (laptop fullscreen) | 207,360 | 0.138 | 0.255 (worst 0.42) | **0.447 ms** | 0 |

- **Power-of-two render sizes make no difference.** Identical within noise. Power-of-two only
  ever mattered for textures in WebGL1 (mipmaps, repeat wrapping); WebGL2 has no such limit.
  GPUs shade in small tiles, so an odd edge wastes at most one partial tile row: nothing.
- Laptop fullscreen costs 0.45 ms of a 16.7 ms frame. The ultrawide at 860×360 has 1.5× the
  pixels; not measured yet.
- Occasional 8–9 ms spikes in the clear pass (p99 0.11–0.15 ms) came with the Claude app at
  38–43% CPU: outside the page.

### PS1 night look (26 Sep 2026)

`?profile&autodrive`, 30 s, emulated 3440×1440 viewport. It reported 2× pixel density, so it
rendered 459×192 (the real ultrawide at 1× would give 430×180).

| | Before (1720×720) | PS1 look (459×192) |
|---|---|---|
| Our GPU per frame | 1.42 ms | **0.32 ms** |
| Clear | 0.64 ms | 0.09 ms (p99 0.25) |
| Car | 0.06 ms | 0.05 ms |
| Terrain avg / worst | 0.72 / 2.4–3.0 ms | 0.17 / 0.32 ms |
| Chunks drawn | ~21 | ~11 (fog ends at 70 m, not 140) |
| JS | 0.12 ms | 0.10 ms |

- 14× fewer pixels outweighs the heavier fragment shader (lighting + dither) by far.
- Terrain's worst frame fell from ~2.6 to 0.32 ms: the old spikes scaled with pixel count.
- 1 dropped frame, and one clear spiked to 6 ms: the Claude app itself was at 37–44% CPU.
- Whole-GPU busy was 12.7%, but **not comparable** with the 16% earlier: frames came every
  16.7 ms, so the window had moved to the 60 Hz Retina display, which composites differently.

### Cheaper clear (rejected) and nearest-first chunks (26 Sep 2026)

Same setup: `?profile&autodrive`, 30 s per run, 1720×720, whole-GPU busy from `ioreg`.
The idea: clear only depth, then draw the sky last as one full-screen triangle at depth 1.0,
so it shades only the pixels nothing else covered, instead of every pixel being cleared to sky
colour and then mostly drawn over.

| Variant | Clear | Sky | Our GPU total | Whole GPU busy |
|---|---|---|---|---|
| Full colour + depth clear (kept) | 0.637 / 0.636 | – | 1.42 / 1.42 | 16.4% / 16.1% |
| Depth-only clear + sky last | 0.636 | 0.110 | 1.51 | 16.6% |
| Same, `preserveDrawingBuffer: true` | 0.087 | 0.107 | 0.97 | 16.0% |
| Full clear, `preserveDrawingBuffer: true` | 0.289 | – | 1.07 | 16.2% |

- **Clearing only depth saved nothing.** With the default `preserveDrawingBuffer: false`, the
  WebGL spec requires the browser to clear the drawing buffer before each frame, so Chrome
  clears the colour buffer itself. The sky pass was then pure extra cost (+0.11 ms).
- **`preserveDrawingBuffer: true` makes our timings look 31% better, but the machine does the
  same work.** Chrome no longer clears for us (clear 0.64 → 0.09 ms), but it must then copy
  every frame for the compositor instead. That copy isn't in our timer queries, and whole-GPU
  busy didn't drop (16.0–16.2% vs 16.1–16.4%; a real 0.44 ms saving would be ~2%).
- About half of the "clear" pass (0.64 vs 0.29 ms) is Chrome's own per-frame buffer handling,
  not our clear. Nothing the page can remove.
- A repeat of the preserved + sky run was dropped: Spotlight (`mds_stores`) used 60–80% CPU
  during it and GPU load swung from 8% to 26%.
- Kept: the plain full clear. A sky pass only earns its place once the sky isn't one flat
  colour (gradient, sun), since then it has to be drawn anyway.

**Nearest-first chunks, done by walking the grid** (no sorting): terrain 0.720 / 0.728 ms vs
0.757 / 0.758 fixed order, the same saving as sorting by distance (0.710 / 0.712).

### Code review checks: profiler overhead, chunk draw order (26 Sep 2026)

Same setup as below: `?autodrive`, 30 s per run, 3440×1440 viewport rendering 1720×720,
whole-GPU busy from `bench/sample-system.sh`. The two options used were temporary code, since removed.

**Does the per-pass profiler inflate what it measures?** Suspected because ANGLE on Metal
may split the frame into separate GPU submissions at each timer query. **It doesn't, measurably:**

| Run | Our GPU time (ms) | Whole GPU busy |
|---|---|---|
| 3 timer queries (clear / car / terrain), summed | 1.45 | 16.2%, 16.4% (repeat) |
| 1 timer query around the whole frame | 1.36 | 15.6% |
| No profiler at all | – | 15.8% |

- Timing each pass separately adds ≤ 0.09 ms; the whole-GPU load is the same with no profiler.
- **So the clear really costs ~0.6 ms** (1.36 ms frame − ~0.8 ms car + terrain), though about
  half of it turned out to be Chrome's own clear (see above).
- Rare spikes in a pass's worst time (clear max 2.3–4.5 ms, p99 0.70 ms) appear in every mode,
  including one query per frame: GPU contention from outside the page, not our work.

**Does chunk draw order matter?** Chunks were drawn in a fixed order (−z to +z), so facing −z
drew far chunks first and near hills were then shaded over them.

| Chunk order | Terrain GPU (ms) avg / p99 / max |
|---|---|
| Nearest first (sorted by distance) | 0.710 / 1.00 / 2.96, repeat 0.712 / 1.00 / 2.84 |
| Fixed (current) | 0.757 / 1.06 / 2.58, repeat 0.758 / 1.03 / 2.44 |
| Farthest first (worst case) | 0.827 / 1.12 / 2.76 |

- **Real but small:** nearest-first saves 6% of terrain time (0.05 ms of a 20 ms frame).
  Farthest-first costs 9% more. Overdraw will grow once there are trees and rocks.
- The worst terrain frames (2.4–3.0 ms) happen in every order, so order isn't what causes them.

**Shader loading** (4 shaders, unique source each time so no cache hits): checking every
compile and link status blocked for 5.4–6.9 ms; checking only the link status, 2.3–3.1 ms
(after the first try, which was 13.9 vs 7.1 ms).
Every status check makes JS wait for the GPU process to finish the work queued before it.

### Optimisations 1–3: render scale, antialiasing off, chunk culling (26 Sep 2026)

In-game profiler, `?profile&autodrive`, 30 s (~1,600 frames) per run, same drive each time.
All runs have the ultrawide's pixel count (3440×1440 window) as the target.
GPU ms = our work from timer queries: average (worst).

| Run | Renders | Clear | Car | Terrain | Our GPU | Whole GPU busy | Dropped |
|---|---|---|---|---|---|---|---|
| A. Before: antialiasing on, no culling | 3440×1440 | 2.97 (5.91) | 0.11 (3.82) | 4.45 (**13.92**) | **7.52** | 68% ≈ 13.5 ms | 1 |
| C. Culling + antialiasing off | 3440×1440 | 2.43 (2.56) | 0.08 (0.24) | 2.49 (6.00) | 5.00 | 38% ≈ 7.6 ms | 0 |
| D. All three (720-row cap) | 1720×720 | 0.64 (2.40) | 0.06 (0.19) | 0.77 (2.63) | **1.47** | 16% ≈ 3.2 ms | **0** |
| D without culling | 1720×720 | 0.64 (2.95) | 0.06 (0.61) | 0.92 (3.23) | 1.62 | 17% | 0 |

- **Overall: our GPU time 7.5 → 1.5 ms (5× less), worst terrain frame 13.9 → 2.6 ms,
  whole GPU 68% → 16% busy.** Browser/macOS compositing (estimated) ~6.0 → ~1.7 ms.
- **Antialiasing off** (A → C): terrain 4.45 → 2.49 ms and whole GPU 68% → 38% at the same
  resolution. The clear only dropped 2.97 → 2.43 ms: clearing 5 M pixels still costs.
- **Render scale** (C → D): ¼ of the pixels, our GPU 5.0 → 1.5 ms.
- **Culling** (D without → D): 64 → ~21 chunks drawn, terrain 0.92 → 0.77 ms (−17%),
  worst 3.2 → 2.6 ms, JS 0.145 → 0.127 ms. Smaller than the ~0.75 ms "fixed vertex cost"
  predicted earlier: that number came from fitting a line through two resolutions, and
  was wrong. **Measure the change itself; don't trust predictions from two data points.**
- **The clear is now the biggest single item** (0.64 of 1.47 ms). Next candidate.
- **Background macOS jobs can ruin the worst case.** One culling + no-antialiasing run
  dropped 29 frames with an 11 ms JS stall. During it, Spotlight (`mds`), storage-scan
  extensions and `softwareupdated` used 60–70% CPU each on this 4-core machine. The rerun,
  with a quiet machine, dropped 0. Code can't prevent this; spare headroom is the defence.
- A second culling-only run at 3440×1440 with antialiasing (B) overlapped the start of that
  background load, so its numbers aren't used.

### Frame budget: terrain + car (26 Sep 2026)

In-game profiler (`?profile&autodrive`), 30 s (~1,600 frames) per size, car driving circles,
Claude app pane on the 50 Hz ultrawide, laptop charging. Budget: 20 ms per frame.
GPU times are averages from timer queries (worst in brackets).

| Render size | Clear | Car | Terrain | Our GPU total | Whole GPU busy | Compositing (est.) | Dropped / worst gap |
|---|---|---|---|---|---|---|---|
| 1656×444 (pane) | 0.76 (0.84) | 0.06 (0.21) | 1.29 (1.63) | 2.1 ms | 24% ≈ 4.8 ms | ~2.7 ms | 0 / 21.1 ms |
| 1720×720 | 1.25 (1.37) | 0.08 (0.25) | 1.86 (4.02) | 3.2 ms | 32% ≈ 6.4 ms | ~3.2 ms | 0 / 21.2 ms |
| 3440×1440 | 2.83 (5.23) | 0.11 (3.72) | 4.37 (**12.64**, p99 9.27) | 7.3 ms | 65% ≈ 13.0 ms | ~5.7 ms | **2** / 59.8 ms |

- **JS per frame:** 0.08 ms average, 0.4 ms worst, at every size (input, car physics,
  camera, all GL calls). The CPU side is idle 99.6% of the frame.
- "Compositing (est.)" = whole-GPU busy × 20 ms − our GPU time. It covers the browser and
  WindowServer putting the frame on screen, plus antialiasing resolve. Approximate: macOS
  reports busy % at the GPU's current clock speed.
- **Terrain cost ≈ 0.75 ms fixed + 0.73 ms per million pixels.** The fixed part is its
  65,025 vertices / 129,032 triangles, including everything behind the camera or beyond
  the fog.
- **Clearing the screen is 36–39% of our GPU time.** With 4× antialiasing every pixel
  holds 4 colour + 4 depth samples to clear.
- **Worst case is what breaks 3440×1440:** average use leaves 7 ms spare, but terrain
  spikes to 9–13 ms (camera facing into hillsides covers more pixels, plus GPU contention
  with the compositor), and 2 frames were dropped in 30 s.
- **The UBO's saving isn't measurable** at this scale: 2 fewer GL calls (~0.1 µs). Its
  value is that more shaders can share per-frame data for free.

### Terrain (26 Sep 2026)

- Building the 255×255 terrain (65,025 heights × 5 noise layers + 387,096 indices):
  **12.7 ms**, on the main thread at startup (logged to the console).
  Fine at startup, but done mid-drive it would be a visible hitch (20 ms budget), which is
  why chunk generation needs to move to a Web Worker.
- GPU data: 254 KB of heights + 756 KB of indices, uploaded once.
- Not yet profiled for frame pacing or GPU time (the pane was hidden, which pauses
  `requestAnimationFrame`). Next step: point `bench/frames.html` at the terrain.

### Frame profile (26 Sep 2026)

Made with `bench/frames.html` and `bench/sample-system.sh` (see Tools).
Chrome 152 inside the Claude app's browser pane, 1656×444 window on the 50 Hz ultrawide.
20 s (1,000 frames) per setting unless noted. Target: a new frame every 20 ms.

| Setting | Our GPU time avg / p99 / max (ms) | Whole GPU busy | Dropped frames | Worst gap (ms) |
|---|---|---|---|---|
| Empty loop, no WebGL | – | 3% | 0 | 21.1 |
| Clear only, 1656×444 | 0.75 / 0.80 / 0.85 | 15% | 0 | 21.1 |
| **Game as-is, 1656×444** | **0.87 / 0.92 / 1.05** | **17%** | **0** | **21.1** |
| Game, 3440×1440 | 5.91 / 6.26 / 6.36 | 65% | 0 | 21.1 |
| Game, 3440×1440, antialias off | 2.68 / 2.79 / 3.18 | 25% | 0 | 21.1 |
| Game, 3440×1440, alpha off | 9.16 / 11.78 / 12.45 | 79% | 0 | 21.1 |
| Game, 3440×1440, antialias + alpha off | 2.70 / 2.79 / 3.29 | 28% | 0 | 21.1 |
| Game, 1720×720, antialias + alpha off | 0.72 / 0.75 / 0.76 | 18% | 0 | 21.4 |

- "Our GPU time" is our own rendering, from timer queries. "Whole GPU busy" comes from macOS
  (`ioreg`) and includes the browser's and WindowServer's compositing.
- The 3440×1440 rows render the ultrawide's full pixel count, but the pane then shows them
  shrunk. Compositing a real fullscreen window would cost more than shown here.

Across all settings:
- **JS per frame:** average 0.03–0.04 ms, worst 0.7 ms (0.2% and 3.5% of the budget).
- **Frame callback start:** 0.8 ms after the frame began (median), p99 ≤ 1.5 ms,
  worst 8.2 ms (in the alpha-off run).
- **Frame-to-frame timing** varies by ±1–2 ms (std dev 0.5–1.0 ms, p99 gap 21–22 ms).
  That shifts the cube by ~0.1° at most, far too small to see.

Longer runs of the game as-is:

| Run | Frames | Dropped | Worst gap | Details |
|---|---|---|---|---|
| 60 s, untouched | 2,998 | 1 | 61.9 ms (2 refreshes missed) | At 16 s. Just before it: our JS 0 ms, GPU 0.9 ms, callback on time. The browser logged a 62 ms frame with **no script and no main-thread blocking** |
| 30 s, screenshot every 2 s | 1,500 | 0 | 22.1 ms | Screenshots delayed our callback by up to 7.2 ms, not enough to miss a frame |

**Total: ~12,500 frames recorded, 1 dropped, and that one was caused outside the page.**

Cost of individual calls, measured in the page by looping many calls:

| Call | Time |
|---|---|
| Frame maths (2 rotations + 2 multiplies) | 0.46–0.63 µs |
| `new Float32Array(16)` | 35 ns |
| `gl.uniformMatrix4fv` | 64–70 ns |
| `gl.drawElements` (cube) | 55 ns |
| `gl.getError` | **67–71 µs**, ~1,000× the others, because it waits for a reply from the GPU process |

System while profiling: WindowServer 27–41% CPU, Claude's GPU process 21–33% CPU,
the page's own process 7–9% CPU.

### What the profile says

Fine, not causing lag:
- Our JS, draw calls and uniform uploads: ~0.04 ms of a 20 ms frame.
- Garbage collection: nothing allocated in the loop; no slow frames caused by script.
- The cube itself: 0.12 ms of GPU time on top of clearing the screen.
- Frame production: across ~12,500 frames the page itself never missed a frame.

Costs that will matter as the game grows:
- **Pixels.** GPU time grows in a straight line with resolution: ~1.2 ms per million pixels
  with antialiasing, ~0.55 ms without. At 3440×1440 with antialiasing, an almost empty scene
  already uses 30% of the frame budget and keeps the GPU 65% busy.
  1720×720 without antialiasing: 0.72 ms, **8× cheaper**.
- **Antialiasing (MSAA)** roughly doubles the per-pixel cost.
- **`alpha: false` backfires with antialiasing on:** +55% GPU time (9.2 vs 5.9 ms) and the
  worst callback delays. With antialiasing off it makes no difference. It's often recommended
  as an optimisation; measured, it isn't one here.
- **Compositing.** At pane size our rendering is ~4% of each frame's time, yet the whole GPU
  goes from 3% to 17% busy. Most of the GPU cost of showing the canvas is the browser and
  macOS compositing it, not our drawing.

The micro-stutter:
- **Not caused by the game.** The one dropped frame happened while our code and GPU work
  were normal and the page's main thread was idle.
- A page can only see when frames are *produced*, not when they reach the screen. A frame
  produced on time but shown late or twice by the browser's compositor or WindowServer is
  invisible to this profiler. With WindowServer and Claude's GPU process this busy, and the
  Claude app redrawing the chat while it works, that's the likely source of the stutter
  visible in the pane.
- To see presentation drops: Chrome DevTools → Performance → record. The **Frames** track
  marks dropped and partially presented frames.

### Matrix maths and allocation (Node 26 / V8, 5 M runs × 3 rounds)

Reproduce with `node bench/math.mjs` (add `--trace-gc` to see the pauses).

| Operation | Time per call |
|---|---|
| `new Float32Array(16)` | ~52–64 ns |
| 4×4 multiply into a reused matrix | ~134–151 ns |
| 4×4 multiply allocating a new matrix | ~160–172 ns |

Garbage collection over the 30 M allocations in the run:
**~7,000 minor collections (one per ~4,300 allocations), avg 0.09 ms, worst 0.78 ms.**

What this means:
- Allocating is cheap, but the collector pauses are what cause hitches.
  A 0.78 ms pause is ~4% of a 20 ms frame. Many objects per frame make them frequent.
- At the cube's scale (5 allocations per frame ≈ 0.3 µs) it made no visible difference.
  The fix is a habit for later, when terrain, cars and particles exist.
- JS arithmetic is not the bottleneck. The multiply isn't even hand-tuned
  (unrolling the loops should make it several times faster) and it doesn't matter yet.

### Measurement pitfalls

- **Debugging hook.** Code evaluated through the browser pane's debugging hook ran several
  times slower (multiply ~600–1,100 ns) and gave backwards results. The same maths in the
  page's own code ran at normal speed, in line with Node. Benchmark in page code or Node,
  never through a debugger or automation hook.
- **Timer resolution is 0.1 ms** (the page isn't cross-origin isolated). Single-frame JS
  times are only accurate to 0.1 ms; measure µs-scale costs by looping many calls.
  Cross-origin isolation would give 5 µs.
- **The Claude app's browser pane isn't a clean environment.** It shares its GPU process with
  the app itself. Confirm important results in a standalone browser.
- **Frame rate follows the display.** `requestAnimationFrame` runs at 50 fps on the ultrawide,
  not a fixed 60.
- **`bench/headless.mjs` runs one at a time.** An `eval` awaiting a `setTimeout` promise never
  returned in the headless page, and the next run, on the same debugging port, attached to that
  hung page instead of its own (and seemed to hang too). Kill any leftover headless Chrome first
  (`pkill -f remote-debugging-port=9333`). Piped through `tail`, its output only shows at the end.
- **The GPU's clock differs from run to run, by up to ~1.6×.** The same page measured 2.84 ms
  for all passes in one headless run and 4.50 in the next, every pass scaled alike, the clear
  pass too. Compare A and B alternately, a few times each, and check the clear pass (fixed work)
  matches between the pairs compared.
- **The previous version, side by side:** copy its files to a folder with `index.html`,
  `style.css` and a link to `assets`, serve it with `python3 -m http.server 8002` there, and point
  `bench/headless.mjs` at each port in turn: screenshots from the same spawn points, timings
  alternating.
- **µs-scale JS in the page:** the timer steps by 0.1 ms, so sample it instead: the DevTools
  protocol's `Profiler` domain (`setSamplingInterval` 50 µs, `start`, `stop`) gives self time per
  function and per line (`positionTicks`).
- **A tiny render size shows the work per vertex.** At 172 × 72 the pixels cost almost nothing,
  so what's left of a pass is its vertices and draws (how the bamboo's cost was split).
- **A hidden page doesn't render.** Browsers pause `requestAnimationFrame` when the page isn't
  visible, and dropped it to **1 fps** when the Claude app's window was behind another one
  (the page still reported itself as "visible"). Profiles must run with the window on screen.
  When the pane itself is hidden, `document.hidden` is true, frames stop altogether, and
  timers slow to about once a second (a polling loop in the console timed out).
- **Zen's (Firefox's) OpenGL can't be reproduced here.** Chrome on this Mac only draws through
  Metal: `--use-angle=gl` in headless Chrome gives no WebGL 2 context at all. Firefox's GPU costs,
  and any waiting in its driver, can only be seen in Firefox itself (`?profile` shows frame gaps,
  late frames and JS; Firefox has no GPU timer queries unless a setting is changed).
- **Checking visuals without the pane:** headless Chrome renders the real WebGL page. Its
  `--screenshot` flag captures straight after loading, before the game has run any frames (two
  "seconds apart" screenshots came out identical), so use `bench/headless.mjs`: it drives Chrome
  over the DevTools protocol, waits in real time, presses keys, saves screenshots and reads
  `profiler.report()`.
- **Checking pixel values:** `gl.readPixels` inside a `requestAnimationFrame` callback added
  after the game's own one runs straight after the game draws, before the frame is shown.
  That's how the brake-light brightness was read. Debugging only: readback stalls the GPU.
- **Stale code after an edit.** `python3 -m http.server` sends no `Cache-Control`, so Chrome
  guesses files are fresh for 10% of the time since they last changed (an hour-old file: ~6 min)
  and loads modules and shaders from its cache without asking the server. Changing the page's
  query string (`?v=2`) doesn't help: only `index.html` is refetched. Workaround: in the console,
  `fetch('main.js', {cache: 'reload'})` for each edited file, then reload. Check the server log
  shows `200` for the files you changed.
  It bit again after the physics rewrite: a normal reload fetched the new `car.js` and
  `physics.js` but never asked for `terrain.js`, whose cached copy was two days old. Its
  `heightAt` doesn't fill in the ground's normal, so the wheels never found the ground and the
  car jittered in place. Clearing the browser's cache fixed it.
- **Timer queries only see our own GPU work.** A change can look like a win in them while
  moving the same work into the browser's compositor (`preserveDrawingBuffer: true` did
  exactly that). When a change touches how frames are handed to the browser, check
  whole-GPU busy too.
- **GPU "disjoint" events** (clock or power changes) make timer results meaningless. The in-game
  profiler now drops those frames' GPU times; `profiler.report().gpuDiscarded` counts them.
- **Test logic outside the browser.** Driving and terrain code are plain JS, so they can be
  simulated in Node without a GPU (car driven, turned, braked and reversed this way).
  `bench/physics.mjs` does this for the physics.
- **Physics results are chaotic.** Tiny differences grow, so one drive says little: a 20-minute
  run gave a variant 2 tip-overs, and 40 minutes over 8 drives gave the same variant 12. Compare
  tunings over many long drives. And check the harness counts the right thing: counting only
  "upside down" missed cars lying on their side, and a car pinned against the map's edge
  looked like it was driving slowly.
- **A shared answer object gets overwritten behind your back.** `nearestRoad` returned the same
  object that every chunk build wrote to, so the 81-chunk startup build moved the spawn point
  114 m, onto a different road. Nothing looked wrong: the car still started on a road, the same
  one every time. Now only `nearestRoad` writes that object, and `main.js` copies it.
- **Busy macOS background jobs inflate GPU timings.** With storage and Spotlight indexing at
  load average 4–5, the terrain pass measured 0.43 ms p50 on a route that measured 0.27 ms
  earlier the same day. Check `uptime` (and `top`) before comparing GPU numbers across sessions;
  compare A/B back to back.
- **Rare blow-ups need stress tests, not test drives.** The 78 m wheel (see "Endless canyon
  terrain") never happened in 80 minutes of bench driving; it showed up as a frozen page in one
  headless run. 25 two-minute drives in Node with jittery frame times found it in seconds; the
  same drives with fixed 1/60 s frames didn't. Check any physics change with many short drives
  and a check for runaway speed or spin.
- **Don't time things while something else is running.** Chunk building measured 0.9–1.6 ms
  with a stress test running in another process, and 0.6–0.9 ms without it.
- **Startup in the browser pane varies 3×** from load to load (146–480 ms for the same 81 chunks,
  which take 68–84 ms in headless Chrome). Time startup in headless Chrome or a normal window.
- **SwiftShader is not a GPU** (3 Oct 2026, the cloud box): software rendering at 576 × 360 is
  bound by pixels (the land 44 ms and the leaves 58 ms of ~155), where the Iris is bound by vertices
  and draws. Count the work instead (`bench/count.js`), time JS in Node (`bench/loop.mjs`), and for
  GPU timings compare A and B alternately, at a tiny size (160 × 100) for the work per vertex.
- **Node's `PerformanceObserver` for `gc` saw nothing inside a synchronous loop** (its entries come
  when the event loop runs, and a frame count compared as a string never started it): `v8.GCProfiler`
  reports them synchronously.
- **`pkill -f pattern` kills the shell running it** when the pattern is on its own command line (it
  matches itself): kill by process name (`pkill -x chrome`).
- **A page stuck in a loop doesn't answer the DevTools protocol.** `bench/headless.mjs` just
  waits: look for a Chrome process at 100% CPU, and kill it (`pkill -f remote-debugging-port=9333`).

### Gotchas

- **A low-poly model's texture is usually mirrored**: one side's texels serve both sides, and a
  symmetric panel's two halves share theirs. Anything that must read one way (letters, numbers)
  needs its own texels on each side: the car's are two copies (`parseBody`, 29 Sep 2026).
- **`mat4()` in math.js is all zeros, not the identity**: every function writes the whole matrix
  it makes, so it's never needed. Pass it straight as a model matrix and nothing is drawn.
- `half` is a reserved word in GLSL ES; a variable called `half` fails to compile.
- **A vertex shader can't include code that mentions `gl_FragCoord`**, even in a function it
  never calls: it isn't declared there. Hence `dither.glsl`, apart from `sky.glsl`.
- **Firefox (and Zen) on macOS can't compile `unpackSnorm2x16`** (29 Sep 2026): it rewrites
  shaders into desktop GLSL, which needs an extension for the packing functions, and puts the
  `#extension` line after other code, so the shader fails ("#extension must always be before any
  non-preprocessor tokens"). Chrome was fine. `bamboo.glsl` unpacks the bend by hand instead.
  Valid WebGL 2 isn't enough: check new built-in functions in Firefox too.
- **Firefox rounds `performance.now()` to 1 ms** (without cross-origin isolation), and much
  coarser with its fingerprinting protection on. A loop that runs "until 1 ms has passed" can run
  until the clock next ticks: cap the work as well (`ROWS_PER_MS` in `terrain.js`).
- **OpenGL drivers wait for the GPU when a buffer or texture it may still be reading is
  refilled** (macOS's OpenGL, which Firefox draws WebGL with; Chrome's Metal copes). Take turns over
  copies for what's refilled every frame, upload textures through a pixel buffer, or give a buffer
  new storage with `bufferData` (see the optimisations).
- Moving the window between displays with different pixel density doesn't fire `resize`
  (its size in CSS pixels doesn't change). `main.js` also watches a `resolution` media query.
- If the GPU process restarts, the WebGL context and every object in it are lost. `main.js`
  reloads the page when the browser hands back a new context.
- macOS `top -l 0` means "forever", not "zero samples".
- **Compare after the mipmaps blur, and things vanish in the distance** (29 Sep 2026): the puddles
  were the wetness over 0.8, and the wetness blurred far off falls short of it. Keep what's compared
  in a texture of its own (0 or 1), and let the mipmaps blur that into a share.
- **Two things dissolving into each other by the dither must count the pattern opposite ways**
  (29 Sep 2026), or at the same share they keep the same pixels, and half way through, half of
  each is missing: the line against the tube, the far leaves against the near ones.
- Viewport emulation (the pane's custom sizes, DevTools device mode) also fakes `screen` to the
  emulated size, so it can't test sizing that depends on the screen. Test with a real window.
- OBJ texture coordinates run upwards, and images are stored top row first: `obj.js` flips
  them (`1 − v`) rather than relying on `UNPACK_FLIP_Y_WEBGL`, which browsers don't all
  apply to `ImageBitmap`s.
- The car pack's `.mtl` names `Car3.png`, but the file is `car3.png`. That works on macOS's
  case-insensitive disk but would fail on a case-sensitive server, so the code uses the
  real name.
- **Wagon-wheel effect:** at 25 m/s a wheel turns 1.3 rad per frame at 60 fps, more than
  its 8-sided pattern's repeat (0.79 rad), so the spin looks slow or backwards at speed.
  Real, filmed cars do the same.
- **Gravity before the dampers lifts the car.** Adding gravity at the start of a physics step
  means the dampers see the car falling at g × step every step, and push back: 100 N per wheel,
  6 mm of lift at rest. Gravity goes in after the springs.
- **A tyre is a cylinder, not a point.** Resting a wheel's centre `radius` above the ground
  under it sank one edge of the 19 cm-wide tyre whenever the ground tilted across it (99.8% of
  the clipping left after the rewrite). Resting a cylinder on a plane is one formula: its reach
  is `radius·√(1 − (axle·n)²) + halfWidth·|axle·n|`.
- With 16-bit indices, index 65535 means "restart" in WebGL2, so meshes top out at
  65,535 vertices (255×255 grid), or need 32-bit indices.
- **Integer vertex data needs `vertexAttribIPointer`** and an `in ivec2` in the shader.
  `vertexAttribPointer` with `gl.SHORT` converts to floats on the way in, so bit tricks no
  longer work.
- **`>>` on a signed `int` in GLSL ES 3.00 copies the sign bit**, so `(v << 24) >> 24` turns the
  low byte of `v` into a signed −128…127. JS's `>>` does the same.
- **Heightfield collisions: push out along the normal, not up.** Measured straight down, a point
  just inside a cliff face can be metres below the surface.
- **A ray's hit can be behind it, or far away.** Intersecting a line with a triangle's *plane*
  can give a negative distance, or a hit on a far-off triangle's plane carried back under the
  car. The suspension clamps it at 0, and stops looking once it's beyond the tyre's reach.
- **Interpolated signed distances need care.** Where the nearest road changes, a signed distance
  flips sign, and blending across the flip passes through 0: a road that isn't there. Store
  "unknown" instead of clamping, and ignore triangles with an unknown corner.
- **GLSL `smoothstep(a, b, x)` is undefined when a ≥ b** (it works on some GPUs). For a falling
  edge, swap the arguments of the `mix` instead.
- **V8 boxes fractions crossing a function call it didn't inline.** A double passed to or returned
  from a non-inlined function (or stored in a module-level `let`) becomes a heap-allocated
  number. V8 only inlines functions of up to 460 bytes of bytecode, within a total of 920 per
  optimised function. `noise` was 445 bytes; sharing the hash multiplies pushed it over, and
  building made 40% more garbage until a helper (`slope`) shrank it to 339.
  `node --trace-turbo-inlining` shows the decisions.
- **Textures read inside an `if` need their level given** (`textureLod`, `textureGrad`). The GPU
  works out the mipmap level from how the coordinates differ between neighbouring pixels, which
  isn't defined where some of them skip the read.
- `flat` is a reserved word in GLSL ES 3.00 (an interpolation qualifier), like `half`.
- **Points are clipped by their centre:** a particle whose centre leaves the screen vanishes
  whole, even if part of its square would show. Fine for small puffs.
- **∞ − ∞ is NaN.** A smooth minimum of two distances, both infinite with no road nearby, gave
  NaN heights, stored as 0: flat squares of land at height 0.

## Rules we're following

1. Allocate once, reuse forever. Nothing inside the game loop creates objects or arrays.
   Watch for hidden allocations: `[a, b]`, spread `...`, closures, `.map()`/`.filter()`, strings.
   Also fractions (not whole numbers) passed to or returned from a function V8 doesn't inline,
   or stored in a module-level `let`: each is boxed. Tolerated in the maths-heavy code for now.
2. Keep `gl.*` calls per frame to a minimum. Each call is validated by the browser,
   sent to the GPU process, and translated to Metal.
3. Never read back from the GPU in the loop (`getError`, `readPixels`, `getParameter`).
   It makes JS wait for the GPU process to reply: `getError` alone costs ~70 µs.
4. Use the smallest data type that fits (bytes/shorts for positions, colours, indices).
5. Pixel count is the budget: every million pixels costs ~0.55–1.2 ms of GPU time here.
   Render ~360 rows fullscreen and let the browser upscale in whole-number blocks.
   Power-of-two sizes don't matter (measured); the pixel count does.
6. Leave `alpha` and `preserveDrawingBuffer` at their defaults. Turning alpha off was
   measured slower; preserving the buffer only moves work into the browser's compositor.
7. Measure before optimising, and check the worst frame, not just the average.

## Plan: the map rework, a rainy bamboo forest (planned 28 Sep 2026; phases 1-4 done)

Replace canyon country at night with a **rainy bamboo forest at dusk**: narrow lanes winding
through dense groves, mist in layers, the wet road glinting in the headlights. The PS1 look stays
(~360 rows, 5-bit colour and dither, low poly, `NEAREST` textures). Work in phases, each one
playable and measured before the next.

**Decided (with the user):**

- **Time: rainy dusk.** Blue-grey fading light, headlights on and glinting off the wet road.
- **Mist: layered ridges.** The forest thick nearby, then hills fading into pale layers out to
  400 m, like an ink painting. (29 Sep 2026, asked for: not the sky's colour, which read as open
  sky past the land; now a darker slate, paling a little far off.) Bamboo is only drawn nearby; the far land stays (the levels of
  detail were built for this).
- **Off the road: stalks bend aside.** No hard collisions: stalks near the car lean away from it
  (in the vertex shader), so you can push through a grove.
- **Roads: narrow winding lanes.** Keep the network code (`findRoads` and the rest of the road
  section of `terrain.js`), but narrower and curvier, with fewer roundabouts.
- **Roads are sandy dirt, fading into the grass at their edges** (asked for when starting, 28 Sep
  2026), not wet asphalt.
- **No downloaded models for now:** basic fillers made in code; the terrain first.

**Stays as it is:** the road network's machinery, chunk streaming and levels of detail (1/2/4 m,
drawn to 400 m, built 40 m ahead, 1 ms a frame), physics, particles, the profiler and benches.

**Phase 1: mood (done 28 Sep 2026).** Pale blue-grey sky and mist (thickening with distance, and
lying lower in the valleys), overcast light, the new ground textures, and sandy dirt roads with
frayed edges and puddles. `night.glsl` became `sky.glsl`. See "Forest country and dirt lanes" in
the measurements, and "The look". Not done: a highlight from the headlights on the wet road (the
camera, behind the car, can't see its own headlights mirrored in a puddle ahead), puddles in dips
(the roads' level is too smooth to have many: they come from noise).

**Phase 2: land and roads (done 28 Sep 2026).** Rounded hills, ridges and spurs instead of mesas
and gorges; lanes 6 and 5 m wide, winding, no markings; the far land tinted as the tops of trees
(60-160 m). Then, after playing it ("the same as the canyons"): shallower valleys, gentler
slopes, lanes that rise and fall with the hills and bend more, no roundabouts, and junctions
4× rarer (see "Rolling hills and rare junctions"). All the benches re-run. Not done: "steeper
ridges further off" (roads' distances stop at 76.5 m, so the land can't know it's far from one).

**Phase 3: bamboo (done 29 Sep 2026).** As planned, except: made in code (no model); not
instanced but pulled from a texture, which measured 2.3× cheaper here, with lines and
camera-facing cards past 30 m; groves from noise, stored per vertex, which also darkens the ground
under them and decides the far tint; the camera pushes stalks aside too. ~2.9 ms of GPU a frame
in all (was ~1.4). See "Bamboo, rain and sky" in the measurements. What was planned:

- **One low-poly stalk** (5-6 sides, rings at the joints: geometry or texture), with a few
  crossed leaf cards near the top, alpha-tested with the dither pattern for soft edges (like the
  particles). Made in code, or a Blockbench OBJ (16 texels per metre, see "The look").
- **Drawn instanced:** per stalk only a few bytes (position, height, lean, tint, sway phase);
  one instanced draw per chunk, or all at once.
- **Placement** from hashes per chunk, like the roads (the same every visit, nothing stored): a
  jittered grid with density from noise (thick groves, clearings), none on the tarmac or verge
  (the chunk's road distances are already worked out when it's built). Stalks 8-15 m, a slight
  lean, green to yellow.
- **Only near:** level-0 chunks, out to ~100-150 m; beyond, the canopy tint (phase 2). Rough
  count: ~300 stalks per 30 m chunk → ~15,000 in range. Measure (add a profiler pass); fewer
  sides or flat cards further away if needed.
- **Wind sway and bending aside:** in the vertex shader, more towards the top. Stalks within a
  few metres of the car lean away from it (the car's position is almost in the frame block
  already: add it). Purely from positions, nothing stored per stalk.
- **Culling:** the chunk's box, taller by the stalks' height.

**Phase 4: rain (done 29 Sep 2026)**, and the puddles' splashes and rings. Not done: spray off
the wet road (tried as puffs: they dithered into squares of dots). What was planned:

- **Streaks:** a few thousand short slanted lines in a box around the camera, their positions
  worked out in the vertex shader from their index and the time (they wrap round the box), so
  no work per drop in JS; one draw call. Bright where they cross the headlight beams.
- **Splashes** on the road near the camera, and **spray** from the tyres on wet tarmac instead of
  dust (`particles.js`: its particles, now 512, are enough for spray, not for rain).

**After phase 4 (29 Sep 2026):** the bamboo reworked after playing it: clumps to the mist's end,
a mist darker than the sky with a treeline past the land, stalks that spring back slowly, and half
the GPU time. See "Bamboo overhaul, mist and treeline".

**Phase 5: extras.**

- **Sound:** done 1 Oct 2026 (see Measurements). Not yet: the acceleration recordings, gears.
- Stone lanterns or small shrines at junctions, as warm lights at dusk; brake-light glow on the
  wet road (already on the list below).

**Budget:** now ~0.9 ms JS (mean) and ~2.15 ms GPU per frame at 860×360 (headless Chrome), the
land the dearest pass (~0.75 ms), then the leaves (~0.56). Cheaper still, if needed: 2 near
cards, not 3; the clumps from 50 m; a cheaper land shader.

**Still open:** middle lines on lanes; a Blockbench bamboo, if the code-made one ever looks too
plain.

**Models found (28 Sep 2026; nothing downloaded yet).** "CC0" means its own page says so;
"per list" means only a curated list does.

| For | Model | Licence | Notes |
|---|---|---|---|
| Bamboo | Quaternius "Bamboo" ×2, "Bamboo Mid" ([1](https://poly.pizza/m/FUgtfvqgMx), [2](https://poly.pizza/m/xBPj13w3JQ), [3](https://poly.pizza/m/z0d6CbNtrz)) | CC0 | 400 triangles (the first): too many for ~15,000 stalks; a reference, or the nearest few. FBX/glTF |
| Forest floor, rocks | Quaternius [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) | CC0 | 116 models: 40 trees, 35 plants and flowers, 27 rocks, grass, bushes. The free version has ~60-70% of them |
| | Quaternius [Ultimate Stylized Nature](https://quaternius.com/packs/ultimatestylizednature.html) | CC0 | 63 models, free |
| | Kenney [Nature Kit](https://kenney.nl/assets/nature-kit) | CC0 | ~330: trees, rocks, plants, ground pieces |
| | Elegant Crow [Retro PSX Nature Pack](https://elegantcrow.itch.io/retro-psx-nature-pack) | CC0 (textures from ambientCG, also CC0) | PS1-style: 8 trees, 8 bushes, 12 grass; the closest to our look |
| Roadside | Quaternius [Torii Gate](https://poly.pizza/m/7SyXZ62xR5) | CC0 | 236 triangles |
| | Kay Lousberg [Post Lantern](https://poly.pizza/m/ZSQ65S4lEu) ([Hanging Lantern](https://poly.pizza/m/3jzk3YShv1) not checked) | CC0 | |
| | Animimo [Japanese Vending Machine](https://animimostudios.itch.io/japanese-vending-machine) | CC0 | PSX/PS2-style, GLB, 512² texture from a photo |
| | Kenney [City Kit (Roads)](https://kenney.nl/assets/city-kit-roads), [Retro Urban Kit](https://kenney.nl/assets/retro-urban-kit) | CC0 | Road signs, traffic lights, street props |
| | Road barriers, cones, fences, rural houses (PS1-style, several authors) | CC0 per list | In [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection), a list of commercially usable retro assets |

Ruled out: "Japanese Stone Lamp" (Flopsi: CC-BY 3.0); "Free Fern Plant" (Yughues: CC-BY, though
filed in a "CC0" collection); "Sinto Shrine Essentials" (paid, no licence stated); miziziziz's
PS1 nature assets (models CC0, but the rock textures can't be redistributed); Meshy's "CC0"
bamboo and torii (AI-generated, behind an account); Google Poly models on Poly Pizza (CC-BY).

**Fitting them in:** `obj.js` reads OBJ with one texture (`v`, `vt`, `f`), no materials. Most
Quaternius and Kenney models are coloured per material instead: read `usemtl`/`Kd` from the MTL
file (small), or bake the colours into a tiny palette texture. glTF/GLB ones go through Blender
to OBJ (or a small GLB reader). They're smooth stylised low-poly, cleaner than the PS1-style
packs; the low resolution and dither will pull them together, but check side by side.

## Still to do (in rough priority order)

- [ ] **Postage stamps to collect across the map** (asked for 2 Oct 2026). Done so far: rivers, and
      timber bridges whose railings stop the car (see those notes).
- [ ] **River improvements** (asked for 3 Oct 2026). Done the same day: uneven banks with a muddy
      shelf, reeds, sedge, ferns and bushes on them, bamboo leaning over the water, duckweed, foam and
      bits of culm on it, reflections, arched bridges (see "Livelier rivers"); roads down to the
      water at the crossings, with stones, ferns and sedge on the banks (see "Lower banks"), and the
      banks gentle and low, as in photos of Japanese bridges (see "Gentle, low banks"), as low at
      the bridges as anywhere (see "Roads cross the rivers at the valley floor"); shingle, a wet
      line, and grassy, stony and reedy stretches (see "Shingle, a wet line"). Next: tall grass
      leaning over the water (the user's pick); then stone-faced banks by the bridges, driftwood,
      leaning trees with their roots showing, steps down to the water. Still to
      choose from:
      - The water flowing: its waves, leaves and lily pads drifting downstream (it has no direction
        now: the waves only drift), faster where it's narrower.
      - Its level: level across, but it follows roadLevel along the river, so it slopes up to ~5% and
        can run uphill; falling only one way, with small rapids or weirs where it drops.
      - Shape: every river is still ~12 m wide; wider and narrower stretches, pools, shingle beaches on
        the inside of bends, now and then a stream joining.
      - Mist lying lower over the water.
      - Sound: running water as the car comes near, louder over a bridge.
      - Crossings: a ford where a lane meets a shallow stretch, stepping stones, a stamp by the water.
- [ ] **Map rework: a rainy bamboo forest at dusk.** See "Plan: the map rework" above; phases 1-4
      are done (bamboo, rain, sky: 29 Sep 2026), phase 5 (sound, lanterns) is left.
- [x] **Splashes through puddles**, a particle effect of their own (asked for 28 Sep 2026, made 29
      Sep): drops thrown up and out, found by the same test as the shader's puddles.
- [x] **Measure first:** frame-pacing profiler with GPU time and system load (`bench/frames.html`).
- [x] Sample terrain: one 255×255 mesh, heights only, fog, flat shading.
- [ ] Profile the terrain: point `bench/frames.html` at it (GPU time, worst frame, at 3440×1440 too).
- [ ] Run `bench/frames.html` fullscreen in Chrome **and** Safari on the ultrawide, plugged in,
      to get clean numbers outside the Claude app.
- [ ] Record a DevTools Performance trace to check for presentation drops (Frames track).
- [ ] Check whether the ultrawide can run at 60 Hz. 3440×1440 at 50 Hz often means the
      connection (e.g. HDMI) is the limit; DisplayPort / USB-C usually allows 60.
- [x] **Vertex Array Objects** once there's more than one mesh.
- [x] Drivable car with chase camera (arrow keys / WASD).
- [x] **Uniform Buffer Object** for per-frame values (view-projection, camera).
- [x] In-game profiler: `?profile` overlay with frame time, JS and per-pass GPU time.
- [x] **Textured car** from a CC0 pack: OBJ loader, `NEAREST` textures, spinning and
      steering wheels, body lean, glowing tail and brake lights.
- [x] Re-measure the car pass: 0.032 ms p50, p99 0.054, over 1,497 frames (headless Chrome, 576×360).
- [x] **Physics engine:** rigid body on sprung wheels, tyre grip, body collisions, handbrake,
      reset. The car bounces and flies, and the wheels no longer sink into the ground.
- [x] **Endless canyon terrain with roads:** a road network, flat roads (grade ≤ 8%), canyons
      and hills beyond, built around the camera a row at a time. On the road: no tip-overs or
      bump-stop hits in 51 km.
- [x] Smooth terrain (no steps or bumps, smooth shading), junction markings, the mid-air glitch.
- [x] Cleanup and review: spawn point, tow camera, one shared autopilot, building 31% faster.
- [x] Textures for the rock, dust, verge and road, made in code; worn road paint.
- [x] Faint dust and smoke from the car: tyres off the tarmac, hard landings, sliding, exhaust.
- [ ] Maybe: steps and cliffs in the mesh again. The rock texture now draws the strata, but
      real ledges need a finer grid where they are.
- [ ] The chase camera only stays above the ground under it; on a tight bend in a canyon it
      could end up inside a wall.
- [ ] Brake-light glow on the road behind (a red point light in the terrain shader: `uTail` is
      already in the UBO, and lights the dust), reverse lights, indicators.
- [ ] Blob shadow under the car (`assets/Shadow (3D)`): needs blending, or a dithered
      "screen-door" transparency that fits the PS1 look.
- [ ] Car sounds (`assets/Sound effects`).
- [ ] Maybe: a dead band before the chunk ring moves, so driving back and forth across a chunk's
      edge doesn't rebuild a row each time. Costs warning time at the leading edge (see "Cleanup
      and review"); only worth it if rebuilding ever shows up in frame times.
- [ ] Maybe: fewer boxed numbers in the physics (~8 KB per frame). Only if minor GCs ever show
      up in frame times; they don't yet.

Ranked by the frame-budget measurements (biggest win for fullscreen ultrawide first):

- [x] **1. Render scale:** at most 720 rows, browser upscales (see measurements). Now ~192
      rows for the PS1 look.
- [x] **2. Antialiasing off.**
- [x] **3. Terrain chunks with culling** (frustum + fog distance). Chunks are also the
      building block for streaming an endless road.
- [x] ~~Cheaper clear~~: tried, no gain. Chrome clears the colour buffer every frame anyway,
      and `preserveDrawingBuffer` only moves the work into a compositor copy (see measurements).
- [x] **Draw chunks nearest first:** −5% terrain time (0.757 → 0.72 ms), by walking the grid
      away from the camera. Matters more once there are trees and rocks to overdraw.
- [ ] **4. Dynamic resolution:** drop render scale when frames get slow (worst case, not
      average). Also absorbs thermal throttling and background macOS jobs.
- [ ] **Less heat at full screen** (see "Why the fans come on"): most of the GPU's work there is
      presenting each frame at 3440 × 1440, not drawing it. To measure: a frame-rate cap (30 fps
      halves the presenting), and making the canvas itself the full-screen element
      (`requestFullscreen`), which may let the browser hand it to macOS to scale instead of copying
      it at full size.
- [ ] **5. Level of detail:** coarser terrain far away, where the fog hides detail anyway.
- [ ] Cheaper terrain fragment shader (measure first; it's the per-pixel part of terrain).
- JS needs nothing: 0.08 ms of a 20 ms frame.
- [ ] **Instancing** for trees, rocks, posts, road markings.
- [x] **Terrain generation in a Web Worker** (3 Oct 2026): `terrain-worker.js`; the main thread keeps
      building what's needed at once (holes in view, the ground under the car) and everything without one.
- [ ] **Precompile all shaders at load** so nothing compiles mid-drive.
- [ ] **Bake lighting into vertex colours; use fog** for atmosphere and draw distance.
- [x] **Object pools** for particles (preallocated arrays, live ones first) and chunks (each slot
      of the ring keeps its buffers).
- [ ] Cross-origin isolation headers on the dev server, for 5 µs timers
      (also needed later for `SharedArrayBuffer` in workers). The same small server script
      could send `Cache-Control: no-cache`, ending the stale-code pitfall.
- [ ] Unroll the matrix multiply (only if profiling ever shows it matters).
- [x] 3-byte vertex stride: Metal requires 4-byte multiples, so the cube's `Int8` × 3 layout
      gets converted by the browser. The terrain uses a 4-byte stride from the start.

## Tools

- **Deploy (Cloudflare Pages):** connect the GitHub repo `AN1001/easy-roads`; framework preset
  None, build command `sh build.sh`, build output directory `dist`. Or by hand: `sh build.sh`, then
  `wrangler pages deploy dist --project-name easy-roads`. A file the game starts loading must be
  added to `build.sh`, or the deployed game won't find it.
- **Dev server:** `python3 -m http.server 8001` in this folder, then `http://localhost:8001`.
  (Port 8001 since the project moved here; the Claude app's preview tool still ran its server
  from the old session folder, so the server runs in a Terminal tab instead.)
- **In-game profiler:** `http://localhost:8001/?profile` shows the worst frame gap, late frames
  in the last 10 s (a refresh or more late), JS time and GPU time per pass (clear / car / stalks /
  terrain / leaves / clumps / particles / rain / sky / trees / nature / water / present; not in Firefox, which has no timer queries) once a
  second, plus chunks drawn, terrain rows built, particles in the air, bamboo stalks drawn near
  and far, clumps drawn, and stalks bent (or springing back).
  Add `&autodrive` to drive circles hands-free (no new terrain gets built), or `&autodrive=road`
  to follow the road (terrain keeps being built), and `&size=3440x1440` to render at a fixed
  resolution. `&step=60` moves the game on 1/60 s each frame however long it took (the same drive
  frame by frame, however slowly a software renderer draws it). `&spawn=x,z` starts on the road nearest that point, to measure the same place
  again (the default: `600,-330`; others used: `-1000,-400`, `2000,1500`; before the cleanup,
  the car actually started 114 m from the given point: see "Cleanup and review"); `&spawn=x,z,at,90`
  puts it exactly there, off the road too, facing 90° (+x; 0 is +z). `&aa` turns
  antialiasing back on and `&nocull` draws every chunk, to measure what each one saves.
  The pane's Viewport menu (or a custom emulated size) tests the render size for real.
  `profiler.report()` in the console gives full stats (mean / p50 / p99 / max, dropped frames).
- **`bench/frames.html`**: frame-pacing profile. Open it through the local server and don't
  touch anything until the table appears (~3 minutes). `?seconds=60` records longer per
  setting; `?only=2` runs one setting. Full results are in `window.profile`.
- **`bench/sample-system.sh <seconds> <folder>`**: run alongside a profile. Samples whole-GPU
  busy % every second and the busiest processes every 5 s. Match samples to settings using the
  wall-clock times in `window.profile`.
- **`bench/math.mjs`**: matrix maths and allocation benchmark (`node bench/math.mjs`).
- **`bench/physics.mjs`**: car physics test drives in Node (`node bench/physics.mjs`, or `flat`
  for just the flat-ground tests): drop, acceleration, braking, cornering, handbrake, parking on
  slopes, a ramp jump, 20 minutes each of random driving from two groups of 4 places, 40
  minutes of following the road, and cost per frame.
- **`bench/keepup.js`**: whether chunk building keeps up at top speed: the camera driven straight
  across the land, frame by frame, as main.js builds; frames that found a hole, building per
  frame, startup (`node bench/keepup.js`).
- **`bench/build.mjs`**: how fast `terrain.js` builds chunks, how much garbage that makes, and a
  checksum of every vertex byte (`node bench/build.mjs [path/to/terrain.js]`). For making
  building faster without changing the land: run it on the old and new copies and compare.
- **`bench/textures.mjs`**: the textures as a PNG, in their colours at full brightness, with the
  grass's tufts and a corner of the puddles' texture (how wet; puddles white) below, the leaves, the far clumps and the far
  stalks' leaves on grey
  and the clouds' thickness, and how long they took to make (`node bench/textures.mjs out.png [zoom]`). For tuning
  `textures.js` without running the game. (`bench/png.mjs` is the PNG writer it shares with
  `relief.mjs` and `livery.mjs`, and a reader for 8-bit PNGs without interlacing.)
- **`bench/livery.mjs`**: `--zen` paints the car the game uses, `car3_zen.png` (the model's green and
  the bumper's brake light); without it, the rally livery, `assets/Car 03/car3_rally.png`, from the
  model's texture (see "Rally livery" in Measurements); `node bench/livery.mjs [zoomed.png]` also
  writes it 6× the size to look at. 0.3 s.
- **`bench/relief.mjs`**: a top-down map of the terrain as a PNG (shaded relief, and the roads'
  sand out to their frayed edges), and how long its chunks took to build. `node bench/relief.mjs map.png 0 0 2400 2`
  maps 2.4 km around the start at 2 m per pixel.
- **`bench/headless.mjs`**: runs the game in headless Chrome with key presses, screenshots and
  profiler reads (usage at the top of the file). Works when the pane is hidden. `CHROME` gives
  Chrome's path (macOS's Google Chrome if not), `ANGLE` the backend (metal on macOS, swiftshader
  elsewhere: software, pixel-bound, its GPU timings relative only). A step `profile: ms` CPU-profiles
  the page (top functions as ms a frame; `profileFile` saves it). `COUNT=1` injects `bench/count.js`;
  `HOLD=n` stops the game after its nth frame, seeds `Math.random` and hides the controls hint
  (`"held": true` waits for it), and with `?step` that's the same picture every run; `VIEWPORT=576x360`
  makes screenshots one pixel per pixel. Runs can go side by side (each Chrome picks its own port).
- **`bench/count.js`**: counts each frame's WebGL work: calls, draws, indices, vertices (the vertex
  shader's runs with a perfect cache), copies (instances) and bytes uploaded, all told and per program
  (`window.__counts.report()`). Wraps every call, so it slows the JS: time without it.
- **`bench/loop.mjs`**: the game itself (main.js) in Node, against a WebGL context that does nothing:
  the JS a frame takes, to the µs, the same drive every time (`node bench/loop.mjs [frames] [query]
  [count|garbage|noworker]`); `count` counts the WebGL work (`count.js`), `garbage` samples where the
  garbage is made. It plays the workers itself, between frames, untimed (their garbage counts, though).
  `node --cpu-prof bench/loop.mjs` for a CPU profile, and `node bench/cpuprofile.mjs file [frames]`
  to read it (self and total time a function, a frame).
- **`bench/bridges.mjs`**: whether anything grows on the bridges' roads: stalks, clumps, ground cover
  and boulders near each of the 69 bridges in a 12 × 12 km square, against the deck and the road's
  edge (`node bench/bridges.mjs`, ~20 s; `VERBOSE=1` lists each one; another folder's terrain.js and
  nature.js to compare).
- **`bench/diff.mjs`**: how two screenshots differ: pixels, by how much, and where (`a.png b.png [where.png]`).
- **Controls:** arrows or WASD drive; Space is the handbrake, R puts the car back on its wheels
  (it also happens by itself after 2 s stuck on its side or roof, or leaning over 60°), T tows it
  back to the nearest road (the camera cuts straight there, and the land around is built at once).
- **Long Animation Frames API** (`PerformanceObserver`, type `long-animation-frame`): reports
  any frame of 50 ms+. If it lists scripts, our code was slow; if it lists none and shows no
  blocking, the stall was outside the page.
- **Chrome DevTools → Performance**: tick "Memory" for a flat line (no garbage) vs a sawtooth
  (allocating every frame); the Frames track shows dropped and partially presented frames.
- **Spector.js**: captures one frame and lists every `gl.*` call.
- `node --trace-gc`: prints every garbage-collection pause.
