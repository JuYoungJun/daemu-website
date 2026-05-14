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
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <strong style={{ fontSize: 16, color: '#231815' }}>서명이 완료되었습니다.</strong>
        <p style={{ fontSize: 13, color: '#5f5b57', margin: '14px 0 6px', lineHeight: 1.7 }}>
          {doc.title}
        </p>
        <span style={{ fontSize: 12, color: '#8c867d', display: 'block', marginTop: 4 }}>
          서명 시각: {doc.signed_at ? new Date(doc.signed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
        </span>
        <p style={{ fontSize: 12, color: '#6f6b68', marginTop: 16, lineHeight: 1.7 }}>
          별도 작업 없이 이 페이지를 닫으셔도 됩니다.<br />
          관련 문의는 <strong>daemu_office@naver.com</strong> 또는 <strong>061-335-1239</strong> 로 연락해 주세요.
        </p>
      </CenterMsg>
    );
  }

  return <SignForm doc={doc} token={token} onDone={(d) => setDoc(d)} />;
}

function SignForm({ doc, token, onDone }) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);  // 캔버스 reflow 시 다시 그리기 위한 stroke 보존.
  const currentStrokeRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  // 캔버스를 현재 viewport 크기에 맞춰 (Retina DPR 반영) 다시 그림.
  // resize / 회전 (orientationchange) 마다 호출되어, 이전에 그린 stroke 도 보존.
  const setupCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#231815';
    // 기존 stroke 재생.
    for (const stroke of strokesRef.current) {
      if (!stroke || stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  };

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    currentStrokeRef.current = [p];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = getPos(e);
    if (currentStrokeRef.current) currentStrokeRef.current.push(p);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };
  const stop = () => {
    if (currentStrokeRef.current && currentStrokeRef.current.length >= 2) {
      strokesRef.current.push(currentStrokeRef.current);
    }
    currentStrokeRef.current = null;
    setDrawing(false);
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    strokesRef.current = [];
    currentStrokeRef.current = null;
    setHasInk(false);
  };

  // 캔버스가 사실상 비어있는지 픽셀 단위 검증 — 모든 픽셀이 alpha=0 이면 빈 서명.
  // hasInk 만 신뢰하면 사용자가 점 한 개 찍고 제출하는 사실상 빈 서명 통과 가능.
  const isCanvasEffectivelyEmpty = () => {
    const c = canvasRef.current;
    if (!c) return true;
    try {
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      // 0~3 픽셀이상에 alpha 값이 있어야 의미 있는 서명. 작은 dust 는 무시.
      let inkPixels = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) inkPixels++;
        if (inkPixels > 50) return false;
      }
      return inkPixels <= 50;
    } catch { return false; }  // canvas tainted (cross-origin) — frontend 검증 skip.
  };

  const submit = async () => {
    if (submitting) return;  // 더블 클릭 차단.
    setErr('');
    const nameTrim = name.trim();
    const emailTrim = email.trim().toLowerCase();
    if (!nameTrim) { setErr('이름을 입력해 주세요.'); return; }
    if (!emailTrim) { setErr('이메일을 입력해 주세요.'); return; }
    // 단순 이메일 형식 — backend EmailStr 와 일치하는 정도만.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setErr('이메일 형식이 올바르지 않습니다.'); return;
    }
    if (!hasInk) { setErr('서명을 그려 주세요.'); return; }
    if (isCanvasEffectivelyEmpty()) {
      setErr('서명이 비어있습니다. 충분히 그려 주세요.'); return;
    }
    if (!consented) { setErr('약관 동의가 필요합니다.'); return; }
    setSubmitting(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const r = await api.post('/api/sign/' + encodeURIComponent(token), {
        signer_name: nameTrim,
        signer_email: emailTrim,
        signature_data: dataUrl,
        consented: true,
        consent_text: '본인은 본 전자 서명이 본인의 진정한 의사 표시임을 확인하며, 본 문서의 내용에 동의합니다.',
      });
      if (r.ok) {
        onDone(r.document);
      } else if (r.status === 403) {
        setErr('이 이메일은 본 문서의 서명 권한이 없습니다. 문서를 받은 메일 주소와 동일한지 확인해 주세요.');
      } else if (r.status === 409) {
        setErr('이미 서명이 완료된 문서입니다. 페이지를 새로고침해 주세요.');
      } else if (r.status === 410) {
        setErr('이 문서는 취소되었습니다. 발송자에게 문의해 주세요.');
      } else if (r.status === 413) {
        setErr('서명 이미지가 너무 큽니다. "지우고 다시 그리기" 후 더 작게 서명해 주세요.');
      } else {
        setErr(r.error || '서명에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } catch (e) {
      setErr('네트워크 오류로 서명에 실패했습니다. 잠시 후 다시 시도해 주세요.');
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
        <p style={{ fontSize: 12, color: '#8c867d', margin: '0 0 10px', lineHeight: 1.6 }}>
          본 문서를 <strong>수신하신 이메일 주소</strong>로 입력해 주세요. 등록된 수신자만 서명할 수 있습니다.
        </p>
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <input type="text" autoComplete="name" placeholder="성함 (필수)" value={name} onChange={(e) => setName(e.target.value)}
            style={{ padding: 12, border: '1px solid #d7d4cf', fontSize: 14, fontFamily: 'inherit' }} />
          <input type="email" autoComplete="email" inputMode="email"
            placeholder="문서를 받은 이메일 (필수)" value={email} onChange={(e) => setEmail(e.target.value)}
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
