// 부수효과: 어드민 raw script 들이 사용하는 헬퍼를 window 에 노출.
import { DB, badgeStr, confirmDel } from './db.js';
import { Auth } from './auth.js';
import { api } from './api.js';
import { sendAutoReply, sendAdminReply, sendCampaign, sendDocument, isEmailEnabled } from './email.js';
import { uploadImage, uploadVideo, uploadMedia } from './upload.js';
import { downloadCSV } from './csv.js';
import { escapeHtml, safeUrl as safeUrlBase, safeMediaUrl, validateOutboundUrl } from './safe.js';
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
  // CRITICAL — admin-hydrate-helper.js + admin-inquiries-page.js + admin-content-page.js
  // 등 RawPage script 들이 backend 동기화에 사용. 노출 안 되면 모든 hydrate 가
  // silent fail → 환경별 데이터 차이 발생.
  window.api = api;
  window.badge = badgeStr;
  window.confirmDel = confirmDel;
  window.escHtml = escHtml;
  window.escAttr = escHtml; // alias — same escape rules cover attribute values
  window.escUrl = escUrl;
  // public raw scripts (work.js 등) 가 backend 데이터 (외부 url / 로고) 를
  // 렌더할 때 React 쪽과 동일한 sanitize 를 쓰도록 노출. 직접 구현 복제하면
  // safe.js 보강 시 한쪽에만 반영되어 XSS / Open Redirect 회귀.
  window.safeMediaUrl = safeMediaUrl;
  window.validateOutboundUrl = validateOutboundUrl;

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
