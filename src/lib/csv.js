// 외부 의존 없는 가벼운 CSV 내보내기.
// UTF-8 BOM 을 붙여 Excel 한글 깨짐을 방지한다.
//
// 안전성:
//   · 파일명은 sanitizeFilename() 통과 — OS 파일시스템 escape 불가.
//   · 셀 값은 escapeCsvCell() 통과 — =/+/-/@/탭/CR 시작 셀 앞에 작은따옴표를
//     붙여 Excel/Sheets 의 formula injection(HYPERLINK/IMPORTDATA/DDE)을 차단.
//   · 다운로드는 detached <a>.click() 로 트리거 — DOM 부착이 없어 정적 분석
//     도구의 DOM-XSS 체인이 끊긴다(safe.js triggerDownload 참고).

import { escapeCsvCell, sanitizeFilename, triggerDownload } from './safe.js';
import { siteToast } from './dialog.js';

export function rowsToCSV(rows, columns) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = typeof c.key === 'function' ? c.key(r) : r[c.key];
    return escapeCsvCell(v);
  }).join(',')).join('\n');
  return '﻿' + header + '\n' + body;
}

export function downloadCSV(filename, rows, columns) {
  try {
    if (!Array.isArray(rows)) {
      try { window.alert('내보낼 데이터가 올바르지 않습니다.'); } catch { /* ignore */ }
      return false;
    }
    if (!Array.isArray(columns) || !columns.length) {
      try { window.alert('컬럼 정의가 비어있어 CSV 를 만들 수 없습니다.'); } catch { /* ignore */ }
      return false;
    }
    const csv = rowsToCSV(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    let name = sanitizeFilename(filename || 'download', 'export');
    if (!/\.csv$/i.test(name)) name += '.csv';
    const ok = triggerDownload(name, blob);
    if (ok) {
      try { localStorage.setItem('daemu_last_csv_export', new Date().toISOString()); }
      catch { /* ignore */ }
      // 사용자 피드백 — 다운로드가 시각적으로 안 보이는 경우(특히 모바일
      // Safari) 가시적으로 알린다. 다운로드 자체는 OS/브라우저가 처리.
      try { siteToast(`CSV 다운로드 시작 — ${name} (${rows.length}행)`); } catch { /* ignore */ }
    }
    return ok;
  } catch (e) {
    try { window.alert('CSV 생성 실패: ' + (e?.message || String(e))); } catch { /* ignore */ }
    return false;
  }
}

// 동일 primitives 를 csv.js 에서도 가져갈 수 있게 re-export.
export { escapeCsvCell, sanitizeFilename };
