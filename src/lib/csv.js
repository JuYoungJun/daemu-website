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
import { siteToast, siteCsvPreview } from './dialog.js';

export function rowsToCSV(rows, columns) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = typeof c.key === 'function' ? c.key(r) : r[c.key];
    return escapeCsvCell(v);
  }).join(',')).join('\n');
  return '﻿' + header + '\n' + body;
}

// 동기 시그니처를 유지 — admin 페이지의 onClick 핸들러에서 그대로 호출 가능.
// 내부적으로는 미리보기 모달을 띄운 뒤 사용자 동의(또는 fallback) 시 다운로드.
// caller 가 await 할 필요는 없다 (false 를 즉시 반환하지 않고, 비동기로 진행).
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
    let name = sanitizeFilename(filename || 'download', 'export');
    if (!/\.csv$/i.test(name)) name += '.csv';
    // 어드민 메인의 "CSV 다운로드 설정" 에서 지정한 prefix 적용. 호출자가
    // 'daemu-' 로 시작하는 파일명을 이미 줬을 때는 prefix 가 'daemu-' 면 중복
    // 부착을 피하기 위해 기존 daemu- 부분을 제거하고 새 prefix 부착.
    try {
      const prefix = localStorage.getItem('daemu_csv_filename_prefix');
      if (prefix && typeof prefix === 'string' && prefix !== 'daemu-') {
        const stripped = name.replace(/^daemu-/, '');
        name = prefix + stripped;
      }
    } catch { /* ignore */ }

    // 미리보기 동의 후에만 실제 blob 생성 + 다운로드 트리거.
    Promise.resolve(siteCsvPreview({ filename: name, rows, columns, sampleSize: 10 }))
      .then((ok) => {
        if (!ok) return;
        try {
          const csv = rowsToCSV(rows, columns);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const triggered = triggerDownload(name, blob);
          if (triggered) {
            try { localStorage.setItem('daemu_last_csv_export', new Date().toISOString()); }
            catch { /* ignore */ }
            try { siteToast(`CSV 다운로드 시작 — ${name} (${rows.length}행)`); } catch { /* ignore */ }
          }
        } catch (e) {
          try { window.alert('CSV 생성 실패: ' + (e?.message || String(e))); } catch { /* ignore */ }
        }
      });
    return true;
  } catch (e) {
    try { window.alert('CSV 생성 실패: ' + (e?.message || String(e))); } catch { /* ignore */ }
    return false;
  }
}

// 동일 primitives 를 csv.js 에서도 가져갈 수 있게 re-export.
export { escapeCsvCell, sanitizeFilename };
