// Client-side image optimization using browser-image-compression.
// Runs in a Web Worker so the main thread isn't blocked.
//
// Targets:
//  - Long edge ≤ 1920px
//  - Output JPEG ~0.5MB cap
//  - SVG / GIF passthrough (vector / animation)
//  - Already-small images (< 200KB and < 1024px) pass through unchanged

import imageCompression from 'browser-image-compression';

const MAX_MB = 0.5;
const MAX_DIM = 1920;
const SKIP_BYTES = 200 * 1024;
const SKIP_DIM = 1024;

export async function optimizeImage(file) {
  if (!file || !file.type) return file;
  if (file.type === 'image/svg+xml') return file;
  if (file.type === 'image/gif') return file;
  if (!file.type.startsWith('image/')) return file;

  // Quick size check — skip very small files
  if (file.size < SKIP_BYTES) {
    const dim = await peekDimensions(file);
    if (dim && dim.w <= SKIP_DIM && dim.h <= SKIP_DIM) return file;
  }

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: MAX_MB,
      maxWidthOrHeight: MAX_DIM,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: 0.82
    });
    // Wrap as File so original-name preservation works downstream
    return new File(
      [compressed],
      file.name.replace(/\.(png|webp|heic|heif|bmp|tif{1,2})$/i, '.jpg'),
      { type: 'image/jpeg', lastModified: Date.now() }
    );
  } catch (err) {
    console.warn('imageCompression failed, returning original', err);
    return file;
  }
}

function peekDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
