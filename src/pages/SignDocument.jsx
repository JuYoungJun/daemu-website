// 공개 서명 페이지 — /sign/:token
//
// 인증이 필요하지 않습니다. 단, 토큰은 32자 이상의 URL-safe 랜덤 문자열이어야 하며
// 이메일로 전달된 정확한 링크를 알아야만 접근 가능합니다.
//
// 법적 효력 한계:
//   본 e-Sign은 데모/내부 결재용입니다. 강한 법적 효력이 필요한 계약서는
//   공인된 전자서명 서비스(DocuSign, Adobe Sign, 인증서 기반 KICA)와
//   신원 확인, 위변조 방지 PDF, 약관 합의 흐름이 함께 필요합니다.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSeo } from '../hooks/useSeo.js';

const STATUS_LABEL = { draft: '초안', sent: '발송됨', viewed: '열람됨', signed: '서명완료', canceled: '취소됨' };

export default function SignDocument() {
  const { token } = useParams();
  useSeo({ title: '문서 서명', path: `/sign/${token}`, description: '대무 — 전자 서명 페이지' });

  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!api.isConfigured()) {
        setError('백엔드가 연결되지 않았습니다. 데모 모드에서는 서명 페이지를 사용할 수 없습니다.');
        setLoading(false);
        return;
      }
      const r = await api.get('/api/sign/' + encodeURIComponent(token));
      if (!alive) return;
      if (r.ok) {
        setDoc(r.document);
      } else if (r.status === 410) {
        setError('이 문서는 취소되었습니다.');
      } else if (r.status === 404) {
        setError('유효하지 않은 서명 링크입니다. 다시 확인해 주세요.');
      } else {
        setError(r.error || '문서를 불러올 수 없습니다.');
      }
      setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [token]);

  if (loading) {
    return <CenterMsg>문서를 불러오는 중…</CenterMsg>;
  }
  if (error) {
    return <CenterMsg>{error}</CenterMsg>;
  }
  if (!doc) {
    return <CenterMsg>문서를 찾을 수 없습니다.</CenterMsg>;
  }
  if (doc.status === 'signed') {
    return (
      <CenterMsg>
        ✅ 이 문서는 이미 서명이 완료되었습니다.<br />
        <span style={{ fontSize: 12, color: '#8c867d', display: 'block', marginTop: 8 }}>
          서명 시각: {doc.signed_at ? new Date(doc.signed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
        </span>
      </CenterMsg>
    );
  }

  return <SignForm doc={doc} token={token} onDone={(d) => setDoc(d)} />;
}

function SignForm({ doc, token, onDone }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Match physical pixels for sharp signature on Retina screens.
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#231815';
  }, []);

  const getPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const isTouch = e.touches && e.touches[0];
    return {
      x: (isTouch ? e.touches[0].clientX : e.clientX) - r.left,
      y: (isTouch ? e.touches[0].clientY : e.clientY) - r.top,
    };
  };

  const start = (e) => {
    e.preventDefault();
    setDrawing(true);
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };
  const stop = () => setDrawing(false);

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const submit = async () => {
    setErr('');
    if (!name.trim()) { setErr('이름을 입력해 주세요.'); return; }
    if (!email.trim()) { setErr('이메일을 입력해 주세요.'); return; }
    if (!hasInk) { setErr('서명을 그려 주세요.'); return; }
    if (!consented) { setErr('약관 동의가 필요합니다.'); return; }
    setSubmitting(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const r = await api.post('/api/sign/' + encodeURIComponent(token), {
        signer_name: name.trim(),
        signer_email: email.trim(),
        signature_data: dataUrl,
        consented: true,
        consent_text: '본인은 본 전자 서명이 본인의 진정한 의사 표시임을 확인하며, 본 문서의 내용에 동의합니다.',
      });
      if (r.ok) {
        onDone(r.document);
      } else {
        setErr(r.error || '서명에 실패했습니다.');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page" style={{ background: '#f6f4f0', minHeight: '100vh', padding: '40px 16px' }}>
      <section style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #d7d4cf', padding: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
          {doc.kind === 'purchase_order' ? '발주서' : '계약서'} · 상태 {STATUS_LABEL[doc.status] || doc.status}
        </div>
        <h1 style={{ fontSize: 22, marginTop: 0, color: '#231815' }}>{doc.title}</h1>

        <div style={{ borderTop: '1px solid #e6e3dd', margin: '14px 0 20px' }}></div>

        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
          fontSize: 14, lineHeight: 1.8, color: '#2a2724', margin: 0,
        }}>{doc.body}</pre>

        <div style={{ marginTop: 28, padding: 14, background: '#fff8ec', border: '1px solid #f0e3c4', fontSize: 12, color: '#5a4a2a', lineHeight: 1.7 }}>
          <strong>⚖️ 전자 서명 안내</strong><br />
          본 서명은 대무 내부 결재 및 합의 확인을 위한 전자 서명입니다. 강한 법적 효력이 필요한 계약(공증, 부동산, 대출 등)에는
          공인 전자서명 서비스(DocuSign, Adobe Sign, KICA 인증서 + 신원확인 + 위변조 방지 PDF)가 별도로 필요합니다.
        </div>

        <h2 style={{ fontSize: 14, marginTop: 30, marginBottom: 10 }}>서명자 정보</h2>
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <input type="text" placeholder="성함 (필수)" value={name} onChange={(e) => setName(e.target.value)}
            style={{ padding: 12, border: '1px solid #d7d4cf', fontSize: 14, fontFamily: 'inherit' }} />
          <input type="email" placeholder="이메일 (필수)" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 12, border: '1px solid #d7d4cf', fontSize: 14, fontFamily: 'inherit' }} />
        </div>

        <h2 style={{ fontSize: 14, marginTop: 16, marginBottom: 6 }}>서명</h2>
        <p style={{ fontSize: 12, color: '#8c867d', margin: '0 0 8px' }}>아래 영역에 마우스/터치로 서명해 주세요.</p>
        <div style={{ position: 'relative', border: '1px dashed #b9b5ae', background: '#fff' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
            onTouchStart={start} onTouchMove={move} onTouchEnd={stop}
            style={{ display: 'block', width: '100%', height: 180, touchAction: 'none' }}
          />
          {!hasInk && (
            <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#b9b5ae', fontSize: 14, pointerEvents: 'none' }}>
              여기에 서명
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" onClick={clear} style={{ background: 'none', border: 'none', color: '#6f6b68', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
            지우고 다시 그리기
          </button>
          <span style={{ fontSize: 11, color: '#8c867d' }}>IP·시각·기기 정보가 감사 기록으로 저장됩니다.</span>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, fontSize: 12, color: '#5f5b57', lineHeight: 1.6 }}>
          <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            (필수) 본인은 본 전자 서명이 본인의 진정한 의사 표시임을 확인하며, 본 문서의 내용에 동의합니다.
            서명 정보(이름, 이메일, 서명 이미지, IP, 시각, 기기 정보)가 감사 기록으로 안전하게 보관됨에 동의합니다.
          </span>
        </label>

        {err && <p style={{ color: '#c0392b', fontSize: 12, margin: '12px 0 0' }}>{err}</p>}

        <button type="button" onClick={submit} disabled={submitting} className="btn"
          style={{ marginTop: 16, width: '100%', padding: '14px 0', fontSize: 14 }}>
          {submitting ? '처리 중…' : '서명하고 제출'}
        </button>

        <p style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid #e6e3dd', fontSize: 11, color: '#8c867d', textAlign: 'center', letterSpacing: '.06em' }}>
          대무 (DAEMU) · daemu_office@naver.com · 061-335-1239
        </p>
      </section>
    </main>
  );
}

function CenterMsg({ children }) {
  return (
    <main className="page" style={{ background: '#f6f4f0', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 36, maxWidth: 480, textAlign: 'center', color: '#2a2724', fontSize: 14, lineHeight: 1.7 }}>
        {children}
      </div>
    </main>
  );
}
