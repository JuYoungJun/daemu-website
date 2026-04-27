// Side-effect: expose admin helpers on window so inlined admin page scripts work.
import { DB, badgeStr, confirmDel } from './db.js';
import { Auth } from './auth.js';
import { sendAutoReply, sendAdminReply, sendCampaign, sendDocument, isEmailEnabled } from './email.js';
import { uploadImage } from './upload.js';
import { downloadCSV } from './csv.js';

// HTML / attribute / URL escapers — used in every admin innerHTML template
// string to neutralize stored XSS via inquiry/popup/CRM fields.
const HTML_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;' };
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => HTML_MAP[c]); }
function escUrl(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return '';
  if (v.startsWith('/') || v.startsWith('#') || v.startsWith('?')) return escHtml(v);
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return escHtml(v);
  const scheme = m[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') {
    return escHtml(v);
  }
  return '#'; // block javascript:, data:, vbscript:, file: etc.
}

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
  window.isUploadEnabled = () => false; // legacy flag, always local now

  // CSV export helper for admin pages
  window.downloadCSV = downloadCSV;
  // Convenience export shortcuts wired per-key
  window.exportToCSV = function (key, columns, filename) {
    const rows = DB.get(key);
    downloadCSV(filename || (key + '-' + new Date().toISOString().slice(0, 10) + '.csv'), rows, columns);
  };
}
