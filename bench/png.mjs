// The smallest valid PNG writer: 8-bit RGB, one zlib stream, no filtering. For the bench tools'
// pictures. And a reader, for 8-bit RGB or RGBA without interlacing (the car's textures).

import { deflateSync, inflateSync } from 'zlib';

// Returns { width, height, rgba: Buffer of 4 bytes per pixel }, the bytes as stored: colour
// profiles aren't applied, as the game's loadTexture doesn't (gl.js).
export function readPng(file) {
  let width, height, channels;
  const data = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at), type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[12]) throw new Error('not 8-bit RGB(A), uninterlaced');
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  // Each row starts with its filter: each byte stored as its difference from the one to the left
  // (a), above (b), or both, or above-left (c).
  const raw = inflateSync(Buffer.concat(data)), row = width * channels, rows = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)];
    for (let i = 0; i < row; i++) {
      const a = i >= channels ? rows[y * row + i - channels] : 0, b = y ? rows[(y - 1) * row + i] : 0;
      const c = y && i >= channels ? rows[(y - 1) * row + i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const guess = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rows[y * row + i] = raw[y * (row + 1) + 1 + i] + guess;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let k = 0; k < width * height; k++) rows.copy(rgba, k * 4, k * channels, k * channels + 3);
  return { width, height, rgba };
}

export function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);  // each row starts with filter type 0
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = bytes => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), check = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;  // 8 bits per channel, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
