// 부수효과: 어드민 raw script 들이 사용하는 헬퍼를 window 에 노출.
import { DB, badgeStr, confirmDel } from './db.js';
import { Auth } from './auth.js';
import { api } from './api.js';
import { sendAutoReply, sendAdminReply, sendCampaign, sendDocument, isEmailEnabled } from './email.js';
import { uploadImage, uploadVideo, uploadMedia } from './upload.js';
import { downloadCSV } from './csv.js';
import { escapeHtml, safeUrl as safeUrlBase } from './safe.js';
import { nextPoNumber, nextSku } from './numbering.js';
import { decrementStock, adjustStock, getStock } from './inventory.js';
// 부수효과 import — raw script 가 쓸 window.openMediaPicker 등록.
import '../components/MediaPicker.jsx';

// Wrappers that match the legacy admin-page contract:
//   escHtml(x) → HTML-safe string for innerHTML interpolation
//   escUrl(x)  → either the safe URL string or the literal "#" so href="#"
//                degrades gracefully instead of dropping the link entirely
const escHtml = (s) => escapeHtml(s);
const escUrl = (s) => {
  const safe = safeUrlBase(s);
  return safe ? escHtml(safe) : '#';
};

if (typeof window !== 'undefined') {
  window.DB = DB;
  window.Auth = Auth;
  window.badge = badgeStr;
  window.confirmDel = confirmDel;
  window.escHtml = escHtml;
  window.escAttr = escHtml; // alias — same escape rules cover attribute values
  window.escUrl = escUrl;

  // Email API
  window.sendAutoReply = sendAutoReply;
  window.sendAdminReply = sendAdminReply;
  window.sendDocument = sendDocument;
  // sendAdminReplyWithAttachments alias for legacy admin-mail page
  window.sendAdminReplyWithAttachments = sendAdminReply;
  window.sendCampaign = sendCampaign;
  window.isEmailEnabled = isEmailEnabled;

  // Upload API (always client-side optimized + base64 stored)
  window.uploadImage = uploadImage;
  window.uploadVideo = uploadVideo;
  window.uploadMedia = uploadMedia;
  window.isUploadEnabled = () => false; // legacy flag, always local now

  // CSV
  window.downloadCSV = downloadCSV;
  window.exportToCSV = function (key, columns, filename) {
    const rows = DB.get(key);
    downloadCSV(filename || (key + '-' + new Date().toISOString().slice(0, 10) + '.csv'), rows, columns);
  };

  // 발주번호 / SKU 자동 생성 + 재고 차감 — 어드민 raw script(orders 등)에서 사용.
  window.nextPoNumber = nextPoNumber;
  window.nextSku = nextSku;
  window.decrementStock = decrementStock;
  window.adjustStock = adjustStock;
  window.getStock = getStock;
}
