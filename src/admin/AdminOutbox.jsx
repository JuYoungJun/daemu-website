import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell.jsx';
import { Link } from 'react-router-dom';
import { downloadCSV } from '../lib/csv.js';
import { siteConfirm } from '../lib/dialog.js';
import { PageActions, GuideButton, OutboxGuide } from './PageGuides.jsx';

const STATUS_LABEL = {
  simulated: '시뮬레이션',
  sent: '발송완료',
  failed: '실패',
  error: '에러'
};

const STATUS_COLOR = {
  simulated: '#b87333',
  sent: '#2e7d32',
  failed: '#c0392b',
  error: '#c0392b'
};

export default function AdminOutbox() {
  const [log, setLog] = useState(() => loadLog());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const refresh = () => setLog(loadLog());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const filtered = log.filter((e) => {
    if (!filter) return true;
    return JSON.stringify(e).toLowerCase().includes(filter.toLowerCase());
  });

  const clear = async () => {
    if (!(await siteConfirm('Outbox 로그를 모두 지우시겠습니까? 실제 발송 이력에는 영향 없습니다.'))) return;
    localStorage.removeItem('daemu_outbox');
    setLog([]);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">Outbox</h1>

          <PageActions>
            <button type="button" className="adm-page-action-btn adm-page-action-btn--csv"
              onClick={() => downloadCSV(
                'daemu-outbox-' + new Date().toISOString().slice(0, 10) + '.csv',
                filtered,
                [
                  { key: 'id', label: 'ID' },
                  { key: (e) => new Date(e.ts).toISOString(), label: '시각' },
                  { key: 'status', label: '상태' },
                  { key: 'path', label: '경로' },
                  { key: (e) => e?.body?.to || '', label: 'To' },
                  { key: (e) => e?.body?.toName || '', label: 'ToName' },
                  { key: (e) => e?.body?.subject || '', label: '제목' },
                  { key: (e) => e?.body?.recipients ? e.body.recipients.length : '', label: '수신자수' },
                  { key: (e) => (e?.body?.body || '').slice(0, 500), label: '본문(앞500자)' },
                  { key: 'error', label: '오류' },
                ],
              )}>
              CSV 내보내기
            </button>
            <GuideButton GuideComponent={OutboxGuide} />
          </PageActions>

          <p className="adm-section-desc">백엔드 API 호출 이력. 데모(백엔드 미구성) 환경에서는 모든 발송이 <strong>시뮬레이션</strong>으로 기록되어 여기서 어떤 메일/요청이 나갔을지 확인할 수 있습니다.<br />실제 백엔드(<code>VITE_API_BASE_URL</code>) 연결 시 발송 결과(성공/실패)도 동일 위치에 누적됩니다.</p>

          <div className="adm-toolbar">
            <input type="search" placeholder="검색 (제목·수신자·내용)" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="spacer"></span>
            <span style={{fontSize:11,color:'#8c867d',letterSpacing:'.08em'}}>{filtered.length}건</span>
            <button type="button" className="adm-btn-sm danger" onClick={clear}>로그 비우기</button>
          </div>

          {!filtered.length ? (
            <div style={{textAlign:'center',padding:'80px 0',color:'#8c867d'}}>
              <p>아직 기록된 발송이 없습니다.</p>
              <p style={{fontSize:12,marginTop:6}}>Contact 폼 제출, 어드민 답변 메일, 캠페인 발송 등을 실행하면 여기에 누적됩니다.</p>
            </div>
          ) : (
            <div>
              {filtered.map((e) => (
                <div key={e.id} style={{border:'1px solid #d7d4cf',padding:'18px 22px',marginBottom:14,background:'#fff'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginBottom:10}}>
                    <div>
                      <span style={{
                        display:'inline-block',
                        fontSize:10,letterSpacing:'.14em',textTransform:'uppercase',
                        padding:'3px 10px',
                        border: '1px solid ' + (STATUS_COLOR[e.status] || '#6f6b68'),
                        color: STATUS_COLOR[e.status] || '#6f6b68'
                      }}>{STATUS_LABEL[e.status] || e.status}</span>
                      <span style={{marginLeft:10,fontFamily:'monospace',fontSize:11,color:'#8c867d'}}>{e.path}</span>
                    </div>
                    <span style={{fontSize:11,color:'#8c867d'}}>{new Date(e.ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
                  </div>
                  {e.body && (
                    <div style={{fontSize:13,color:'#4a4744',lineHeight:1.7}}>
                      {e.body.to && <div><strong style={{color:'#8c867d',fontSize:11,letterSpacing:'.08em',textTransform:'uppercase',marginRight:8}}>To</strong>{e.body.to} {e.body.toName ? '(' + e.body.toName + ')' : ''}</div>}
                      {e.body.subject && <div><strong style={{color:'#8c867d',fontSize:11,letterSpacing:'.08em',textTransform:'uppercase',marginRight:8}}>Subject</strong>{e.body.subject}</div>}
                      {e.body.recipients && <div><strong style={{color:'#8c867d',fontSize:11,letterSpacing:'.08em',textTransform:'uppercase',marginRight:8}}>Recipients</strong>{e.body.recipients.length}명</div>}
                      {e.body.body && <details style={{marginTop:8}}>
                        <summary style={{fontSize:11,color:'#6f6b68',cursor:'pointer',letterSpacing:'.08em',textTransform:'uppercase'}}>본문 보기</summary>
                        <pre style={{margin:'8px 0 0',padding:'12px 14px',background:'#f6f4f0',whiteSpace:'pre-wrap',fontSize:12,fontFamily:'inherit',lineHeight:1.6,border:'1px solid #e6e3dd'}}>{e.body.body}</pre>
                      </details>}
                    </div>
                  )}
                  {e.error && <div style={{marginTop:8,fontSize:12,color:'#c0392b'}}>오류: {e.error}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem('daemu_outbox') || '[]');
  } catch (e) {
    return [];
  }
}
