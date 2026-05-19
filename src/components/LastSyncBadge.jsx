// Admin 페이지 헤더에 표시되는 동기화 상태 배지.
//
// 이전 회귀: backend hydrate 실패 시 옛 localStorage 캐시가 silent 노출됨 →
// 운영자가 stale 데이터로 의사결정. (예: AdminOutbox 가 backend 발송 이력
// 못 받아도 옛 outbox 만 보여줘서 "메일이 안 갔다" 인식 늦음.)
//
// 본 컴포넌트는 다음 세 상태 명시 표시:
//   - 동기화 중 (loading=true): 옅은 회색 점 + "동기화 중…"
//   - 성공 (lastSyncAt set, error=null): "마지막 동기화 5초 전 ✓"
//   - 실패 (error truthy): 빨간 점 + "동기화 실패 ⚠ 캐시 표시 중"
//
// 사용 예:
//   <LastSyncBadge loading={loading} lastSyncAt={lastSyncAt} error={fetchError} />
//
// admin 페이지의 useEffect hydrate 함수가 try/catch 로 lastSyncAt/error
// state 를 갱신하면 됨.

import { useEffect, useState } from 'react';

function _formatRelative(ts) {
  if (!ts) return '';
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 5) return '방금';
  if (diff < 60) return `${Math.floor(diff)}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const BASE_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  letterSpacing: '.04em',
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid rgba(0,0,0,.08)',
  background: '#fafafa',
  color: '#4a4744',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const DOT_STYLE = {
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
};

export default function LastSyncBadge({ loading, lastSyncAt, error, label = '데이터' }) {
  // 1초마다 relative time 갱신 — 너무 짧은 간격이라 렌더 비용 미미.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10000); // 10s
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <span style={{ ...BASE_STYLE, background: '#fdf2f0', borderColor: '#f5c8c0', color: '#8a3320' }}
            title={String(error).slice(0, 200)}>
        <span style={{ ...DOT_STYLE, background: '#c43c1c' }} />
        {label} 동기화 실패 · 캐시 표시 중
      </span>
    );
  }
  if (loading && !lastSyncAt) {
    return (
      <span style={BASE_STYLE}>
        <span style={{ ...DOT_STYLE, background: '#bdb8b0' }} />
        {label} 동기화 중…
      </span>
    );
  }
  if (lastSyncAt) {
    return (
      <span style={BASE_STYLE} title={new Date(lastSyncAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}>
        <span style={{ ...DOT_STYLE, background: '#5ea35a' }} />
        {loading ? '재동기화 중…' : `마지막 동기화 ${_formatRelative(lastSyncAt)}`}
      </span>
    );
  }
  // 아직 한 번도 sync 시도 안 한 상태 — 표시 안 함 (혼란 회피).
  return null;
}
