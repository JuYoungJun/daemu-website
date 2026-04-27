import { optimizeImage } from './imageOptim.js';

// No external CDN. Image is optimized client-side via browser-image-compression
// (Web Worker), then encoded as base64 and stored directly in localStorage.
// Suitable for the project's expected media volume (small photos, occasional uploads).
export async function uploadImage(rawFile) {
  const file = await optimizeImage(rawFile);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      url: reader.result,
      name: file.name,
      size: file.size,
      originalSize: rawFile.size,
      optimized: file !== rawFile,
      local: true
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
