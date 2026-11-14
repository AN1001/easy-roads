// Makes the textures (textures.js) off the main thread, for main.js, as it starts: no message asks;
// the answer is their pixels and the puddles' texels, handed over (transferred, not copied).

import { createTextures, createPuddles } from './textures.js';

const pixels = createTextures(), puddles = createPuddles();
postMessage({ pixels, puddles }, [pixels.buffer, puddles.buffer]);
