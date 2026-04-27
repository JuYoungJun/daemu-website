import { optimizeImage } from './imageOptim.js';
import { api } from './api.js';

// Image upload pipeline:
//  1. Optimize client-side (resize + JPEG re-encode)
//  2. Read as base64 for both local fallback (data URL) AND backend upload
//  3. If backend `/api/upload` is configured, also POST → get public URL.
//  4. Return { url (public if available, else data URL), previewUrl (data URL),
//             publicUrl (only when remote), name, size }
export async function uploadImage(rawFile) {
  const file = await optimizeImage(rawFile);

  // Read as base64 (we need this for either path)
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const base64 = (dataUrl.split(',')[1] || '');

  let publicUrl = null;
  if (api.isConfigured()) {
    try {
      const r = await api.post('/api/upload', {
        filename: file.name,
        content: base64,
        contentType: file.type || 'image/jpeg'
      });
      if (r && r.ok && r.url) publicUrl = r.url;
    } catch (e) { /* fallback below */ }
  }

  return {
    url: publicUrl || dataUrl,
    publicUrl,
    previewUrl: dataUrl,
    name: file.name,
    size: file.size,
    originalSize: rawFile.size,
    optimized: file !== rawFile,
    local: !publicUrl
  };
}
