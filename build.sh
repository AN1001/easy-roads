#!/bin/sh
# Copies the files the game loads into dist/, for Cloudflare Pages (build command `sh build.sh`,
# output directory `dist`). Nothing is compiled: the game runs as it is from this folder too. Leaves
# out the notes, benches and the models' .blend files. Add any new file the game loads here.
set -e
rm -rf dist
mkdir -p "dist/assets/Car 03" dist/assets/Wheel dist/assets/tree_01
cp style.css manifest.webmanifest *.js dist/  # (the modules, and the workers: terrain-worker.js, tree-worker.js, texture-worker.js)
cp -R shaders dist/
rm dist/shaders/cube.*  # bench/frames.html's only
cp "assets/Car 03/Car3.obj" "assets/Car 03/car3_zen.png" "dist/assets/Car 03/"
cp assets/Wheel/Wheel.obj assets/Wheel/wheel.png dist/assets/Wheel/
cp assets/tree_01/tree_01.obj assets/tree_01/tree_01.png dist/assets/tree_01/  # (made by bench/tree01.py from the .blend)
mkdir -p "dist/assets/Sound effects"
cp "assets/Sound effects/engine_loop.wav" "assets/Sound effects/engine_start.wav" "dist/assets/Sound effects/"
# index.html, naming main.js's modules, so the browser asks for them all at once, as soon as it has
# the page: otherwise it learns of them only from main.js, and of theirs from them (three round trips
# deep). Made from what's in dist, so it can't fall behind. Not the workers (fetched as workers,
# another kind of request). (Not the shaders and models either, as `preload as="fetch"`: in Chrome,
# on a slowed connection, reading the tree's texture then failed part-way, and the game never
# started: bench/startup.mjs with THROTTLE, 14 Nov 2026.)
LINKS=$(cd dist && ls *.js | grep -v -e '-worker\.js$' | sed 's|.*|  <link rel="modulepreload" href="&">|') \
  awk '/<\/head>/ { print ENVIRON["LINKS"] } { print }' index.html > dist/index.html
echo "dist: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
