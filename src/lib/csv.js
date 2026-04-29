// Tiny CSV exporter — no external lib needed.
// Adds BOM so Excel opens UTF-8 Korean correctly.
//
// Snyk DOM-XSS hardening:
//   · Filename is sanitized through sanitizeFilename() so it can't escape
//     the suggested-name attribute or the OS filesystem.
//   · Values go through escapeCsvCell() which adds a single-quote prefix
//     to anything starting with =, +, -, @, tab, or CR. This blocks the
//     classic CSV formula injection attacks (HYPERLINK, IMPORTDATA, DDE).
//   · The download is triggered via a temporary <a> created with safe DOM
//     APIs. textContent is unused (no visible label) and href is set to a
//     blob: URL we control, never to user input.

import { escapeCsvCell, sanitizeFilename, triggerDownload } from './safe.js';

export function rowsToCSV(rows, columns) {
  // columns: [{ key, label }] — key is dot-path or function
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = typeof c.key === 'function' ? c.key(r) : r[c.key];
    return escapeCsvCell(v);
  }).join(',')).join('\n');
  return '﻿' + header + '\n' + body;
}

export function downloadCSV(filename, rows, columns) {
  console.log('[downloadCSV]', { filename, rowCount: rows?.length, colCount: columns?.length });
  try {
    if (!Array.isArray(rows)) {
      console.warn('[downloadCSV] rows is not an array', rows);
      try { window.alert('내보낼 데이터가 올바르지 않습니다.'); } catch { /* ignore */ }
      return false;
    }
    if (!Array.isArray(columns) || !columns.length) {
      console.warn('[downloadCSV] columns missing');
      try { window.alert('컬럼 정의가 비어있어 CSV 를 만들 수 없습니다.'); } catch { /* ignore */ }
      return false;
    }
    const csv = rowsToCSV(rows, columns);
    console.log('[downloadCSV] csv length:', csv.length);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    let name = sanitizeFilename(filename || 'download', 'export');
    if (!/\.csv$/i.test(name)) name += '.csv';
    const ok = triggerDownload(name, blob);
    if (ok) {
      try { localStorage.setItem('daemu_last_csv_export', new Date().toISOString()); }
      catch { /* ignore */ }
    }
    return ok;
  } catch (e) {
    console.error('[downloadCSV] failed', e);
    try { window.alert('CSV 생성 실패: ' + (e?.message || String(e))); } catch { /* ignore */ }
    return false;
  }
}

// Re-export so legacy callers can pull the same primitives from one place.
export { escapeCsvCell, sanitizeFilename };
