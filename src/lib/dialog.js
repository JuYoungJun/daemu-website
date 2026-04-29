// 사이트 다이얼로그 헬퍼 — DialogHost 가 mount 되어 window.site* 를
// 등록하기 전에 호출되더라도 안전하게 native fallback 으로 떨어집니다.
// (admin React 코드는 항상 DialogHost mount 이후 실행되므로 실제로는
// custom 모달이 보입니다.)

export function siteAlert(msg) {
  if (typeof window !== 'undefined' && window.siteAlert) {
    window.siteAlert(msg);
    return;
  }
  if (typeof window !== 'undefined') window.alert(msg);
}

export function siteConfirm(msg) {
  if (typeof window !== 'undefined' && window.siteConfirm) {
    return window.siteConfirm(msg);
  }
  if (typeof window === 'undefined') return Promise.resolve(false);
  return Promise.resolve(window.confirm(msg));
}

export function sitePrompt(msg, defaultValue = '', opts = {}) {
  if (typeof window !== 'undefined' && window.sitePrompt) {
    return window.sitePrompt(msg, defaultValue, opts);
  }
  if (typeof window === 'undefined') return Promise.resolve(null);
  // native prompt fallback
  const v = window.prompt(msg, defaultValue);
  return Promise.resolve(v == null ? null : v);
}

export function siteToast(msg, opts = {}) {
  if (typeof window !== 'undefined' && window.siteToast) {
    window.siteToast(msg, opts);
    return;
  }
  // 네이티브 토스트는 없음 — 피드백이 필요한 호출자는 siteAlert 도 함께 사용.
}

// CSV 미리보기 — 동의 시 true, 취소 시 false 를 resolve.
// 사용 예: const ok = await siteCsvPreview({ filename, rows, columns });
export function siteCsvPreview(opts) {
  if (typeof window !== 'undefined' && window.siteCsvPreview) {
    return window.siteCsvPreview(opts);
  }
  // DialogHost mount 전 fallback — 그냥 통과(true) 시켜 호출자가 다운로드.
  return Promise.resolve(true);
}
