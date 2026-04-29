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
  const csv = rowsToCSV(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  // Force the .csv extension after sanitizing — caller may have stripped it.
  let name = sanitizeFilename(filename || 'download', 'export');
  if (!/\.csv$/i.test(name)) name += '.csv';
  const ok = triggerDownload(name, blob);
  // 백업 시점 기록 — AdminMonitoring 의 "데이터 백업 상태" 카드가 이 값을 표시.
  if (ok) {
    try { localStorage.setItem('daemu_last_csv_export', new Date().toISOString()); }
    catch { /* ignore */ }
  }
  return ok;
}

// Re-export so legacy callers can pull the same primitives from one place.
export { escapeCsvCell, sanitizeFilename };
