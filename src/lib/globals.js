// Side-effect: expose admin helpers on window so inlined admin page scripts work.
import { DB, badgeStr, confirmDel } from './db.js';
import { Auth } from './auth.js';
import { sendAutoReply, sendAdminReply, sendCampaign, sendDocument, isEmailEnabled } from './email.js';
import { uploadImage } from './upload.js';
import { downloadCSV } from './csv.js';

if (typeof window !== 'undefined') {
  window.DB = DB;
  window.Auth = Auth;
  window.badge = badgeStr;
  window.confirmDel = confirmDel;

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
