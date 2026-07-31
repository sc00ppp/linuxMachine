import { readFileSync } from 'node:fs';

/** PNG: IHDR width/height are big-endian u32 at bytes 16 and 20. */
export function pngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

/** JPEG: walk segments to the first SOFn frame header. */
export function jpegSize(buffer) {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8
  ) {
    return null;
  }

  let index = 2;
  while (index < buffer.length - 9) {
    if (buffer[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = buffer[index + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry dimensions.
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        h: buffer.readUInt16BE(index + 5),
        w: buffer.readUInt16BE(index + 7),
      };
    }

    if (index + 3 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(index + 2);
    if (segmentLength < 2) return null;
    index += 2 + segmentLength;
  }
  return null;
}

export function imageSizeFromHeader(buffer) {
  return pngSize(buffer) ?? jpegSize(buffer);
}

export function readImageSize(filename) {
  // 64 KiB is plenty for normal PNG/JPEG headers and avoids loading the image.
  const header = readFileSync(filename).subarray(0, 65536);
  return imageSizeFromHeader(header);
}
