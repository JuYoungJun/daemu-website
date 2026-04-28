// 관리자 페이지 상단에 표시되는 한국어 사용 안내 박스.
// 주의: 이 컴포넌트의 텍스트는 비기술 클라이언트 운영자를 대상으로 합니다.
// 짧고 구체적이고 실행 가능한 문장만 사용. UI 용어와 화면 영역 이름을 일치시키세요.

export default function AdminHelp({ title = '사용 안내', items = [] }) {
  if (!items.length) return null;
  return (
    <div className="adm-help-box" style={{
      margin: '0 0 22px',
      padding: '14px 18px',
      background: '#fff8ec',
      border: '1px solid #f0e3c4',
      borderLeft: '3px solid #c9a25a',
      borderRadius: 4,
      fontSize: 13,
      lineHeight: 1.7,
      color: '#5a4a2a',
    }}>
      <div style={{ fontWeight: 600, color: '#3f3320', marginBottom: 6, fontSize: 13, letterSpacing: '.02em' }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  );
}
