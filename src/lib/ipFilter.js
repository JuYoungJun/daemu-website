// 개발자 IP 화이트리스트 — localStorage 'daemu_dev_ip_whitelist' 에 콤마/공백
// 구분으로 저장된 IP/CIDR 목록을 모니터링/analytics 응답에서 자동 필터.
//
// 지원:
//   · 단일 IPv4 (예: 121.130.1.1)
//   · CIDR (예: 192.168.0.0/24)
//   · 공백/콤마 둘 다 구분자
//
// 백엔드 IP geolocation 통합 전에는 client-side 에서 응답에 포함된 IP 필드를
// 검사해 필터하는 형태. 서버에서 IP 정보를 노출하지 않는 환경에선 효과 없음.

export function getDevIpWhitelist() {
  try {
    const raw = localStorage.getItem('daemu_dev_ip_whitelist') || '';
    return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

// IPv4 → 32-bit 정수.
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n * 256) + v;
  }
  return n;
}

// IP 가 entry(단일 IP 또는 CIDR)와 일치하는지.
function matchEntry(ip, entry) {
  if (!ip || !entry) return false;
  if (!entry.includes('/')) return ip === entry;
  const [base, bitsStr] = entry.split('/');
  const bits = parseInt(bitsStr, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipv4ToInt(ip);
  const baseN = ipv4ToInt(base);
  if (ipN == null || baseN == null) return false;
  if (bits === 0) return true;
  const mask = (~0) << (32 - bits);
  return (ipN & mask) === (baseN & mask);
}

// IP 가 화이트리스트에 포함되는지(= 필터링 대상). 빈 화이트리스트면 항상 false.
export function isWhitelistedIp(ip) {
  if (!ip) return false;
  const list = getDevIpWhitelist();
  if (!list.length) return false;
  return list.some((entry) => matchEntry(ip, entry));
}

// IP 필드를 가진 객체 배열을 필터. 화이트리스트 IP 항목 제거.
// 객체에서 IP 가 들어있을 가능성 있는 키들을 자동 검사.
const IP_KEYS = ['ip', 'ip_addr', 'remote_addr', 'client_ip', 'source_ip'];
export function filterByDevIp(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const list = getDevIpWhitelist();
  if (!list.length) return rows;
  return rows.filter((r) => {
    if (!r || typeof r !== 'object') return true;
    for (const k of IP_KEYS) {
      if (r[k] && isWhitelistedIp(r[k])) return false;
    }
    return true;
  });
}
