// Tiny CSV exporter — no external lib needed.
// Adds BOM so Excel opens UTF-8 Korean correctly.

function escapeCell(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.join(' | ');
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function rowsToCSV(rows, columns) {
  // columns: [{ key, label }] — key is dot-path or function
  const header = columns.map(c => escapeCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => {
    const v = typeof c.key === 'function' ? c.key(r) : r[c.key];
    return escapeCell(v);
  }).join(',')).join('\n');
  return '﻿' + header + '\n' + body;
}

export function downloadCSV(filename, rows, columns) {
  const csv = rowsToCSV(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}
