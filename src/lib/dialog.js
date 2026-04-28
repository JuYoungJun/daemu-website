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
  // No native toast — silently no-op, callers that need feedback should
  // also call siteAlert.
}
