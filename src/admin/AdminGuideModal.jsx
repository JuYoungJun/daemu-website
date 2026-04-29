// 어드민 페이지 공용 가이드 모달 셸.
//
// 페이지별 가이드는 자체 섹션 컴포넌트(<Section title="...">) 들로 children
// 을 채워 넣는다. 모달 셸과 head/foot 은 본 컴포넌트가 담당.
//
// 사용 예:
//   <AdminGuideModal title="..." onClose={...}>
//     <GuideSection title="...">...</GuideSection>
//     ...
//   </AdminGuideModal>

export default function AdminGuideModal({ title, onClose, children }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide" style={{ maxWidth: 920 }}>
        <div className="adm-modal-head">
          <h2>{title}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div style={{ fontSize: 13.5, color: '#2a2724', lineHeight: 1.85, wordBreak: 'keep-all' }}>
          {children}
        </div>
        <div className="adm-modal-foot">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export function GuideSection({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{
        fontSize: 14, color: '#231815', margin: '0 0 8px',
        paddingBottom: 6, borderBottom: '1px solid #e6e3dd',
        letterSpacing: '.02em', fontWeight: 600,
      }}>{title}</h3>
      {children}
    </div>
  );
}

export function GuideTable({ headers, rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 6, marginBottom: 8 }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} style={{
              background: '#f4f1ea', padding: '7px 10px', textAlign: 'left',
              fontWeight: 600, color: '#5a534b', fontSize: 11,
              letterSpacing: '.06em', textTransform: 'uppercase',
              borderBottom: '1px solid #d7d4cf',
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} style={{ padding: '7px 10px', borderBottom: '1px solid #f0ede7', verticalAlign: 'top' }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const guideListStyle = { paddingLeft: 22, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 4 };

// 공통 "사용 가이드 보기" 버튼 — mail-templates 패턴과 통일.
export function GuideOpenButton({ onClick }) {
  return (
    <button type="button" className="btn" onClick={onClick}
      style={{ background: '#1f5e7c', color: '#fff', border: '1px solid #1f5e7c' }}>
      사용 가이드 보기
    </button>
  );
}
