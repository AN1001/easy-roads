#!/bin/sh
# Copies the files the game loads into dist/, for Cloudflare Pages (build command `sh build.sh`,
# output directory `dist`). Nothing is compiled: the game runs as it is from this folder too. Leaves
# out the notes, benches and the models' .blend files. Add any new file the game loads here.
set -e
rm -rf dist
mkdir -p "dist/assets/Car 03" dist/assets/Wheel dist/assets/tree_01
cp index.html style.css manifest.webmanifest *.js dist/
cp -R shaders dist/
rm dist/shaders/cube.*  # bench/frames.html's only
cp "assets/Car 03/Car3.obj" "assets/Car 03/car3_zen.png" "dist/assets/Car 03/"
cp assets/Wheel/Wheel.obj assets/Wheel/wheel.png dist/assets/Wheel/
cp assets/tree_01/tree_01.obj assets/tree_01/tree_01.png dist/assets/tree_01/  # (made by bench/tree01.py from the .blend)
mkdir -p "dist/assets/Sound effects"
cp "assets/Sound effects/engine_loop.wav" "assets/Sound effects/engine_start.wav" "dist/assets/Sound effects/"
echo "dist: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
