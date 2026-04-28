import { optimizeImage } from './imageOptim.js';
import { api } from './api.js';

const IMAGE_RE = /^image\//i;
const VIDEO_RE = /^video\//i;
const VIDEO_EXT_RE = /\.(mp4|webm)$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)$/i;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function fileKind(file) {
  if (VIDEO_RE.test(file.type) || VIDEO_EXT_RE.test(file.name)) return 'video';
  if (IMAGE_RE.test(file.type) || IMAGE_EXT_RE.test(file.name)) return 'image';
  return 'other';
}

async function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Image upload pipeline: optimize client-side → base64 → /api/upload (or
// data-URL fallback in demo mode).
export async function uploadImage(rawFile) {
  const file = await optimizeImage(rawFile);
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`이미지 용량 초과 (최대 ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`);
  }
  const dataUrl = await readAsBase64(file);
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
    local: !publicUrl,
    kind: 'image',
  };
}

// Video upload — no client-side compression (browsers don't have a
// reliable cross-platform video transcoder built in). Caller should warn
// for files > MAX_VIDEO_BYTES; backend re-validates.
export async function uploadVideo(rawFile) {
  if (rawFile.size > MAX_VIDEO_BYTES) {
    throw new Error(`영상 용량 초과 (최대 ${MAX_VIDEO_BYTES / 1024 / 1024}MB)`);
  }
  if (!VIDEO_RE.test(rawFile.type) && !VIDEO_EXT_RE.test(rawFile.name)) {
    throw new Error('지원하지 않는 영상 형식입니다 (.mp4, .webm 만 가능).');
  }
  const dataUrl = await readAsBase64(rawFile);
  const base64 = (dataUrl.split(',')[1] || '');

  let publicUrl = null;
  if (api.isConfigured()) {
    try {
      const r = await api.post('/api/upload', {
        filename: rawFile.name,
        content: base64,
        contentType: rawFile.type || 'video/mp4'
      });
      if (r && r.ok && r.url) publicUrl = r.url;
      else if (r && r.error) throw new Error(r.error);
    } catch (e) {
      // fall through — demo mode keeps the data URL but warns the caller
      if (!String(e).includes('Failed to fetch')) throw e;
    }
  }

  return {
    url: publicUrl || dataUrl,
    publicUrl,
    previewUrl: dataUrl,
    name: rawFile.name,
    size: rawFile.size,
    originalSize: rawFile.size,
    local: !publicUrl,
    kind: 'video',
  };
}

// Generic upload that routes to image or video.
export async function uploadMedia(rawFile) {
  const kind = fileKind(rawFile);
  if (kind === 'video') return uploadVideo(rawFile);
  if (kind === 'image') return uploadImage(rawFile);
  throw new Error('지원하지 않는 파일 형식입니다.');
}
