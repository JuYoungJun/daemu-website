// 뉴스레터 구독 취소 공개 페이지 — /unsubscribe
//
// 사용자는 본인 이메일을 입력하고 취소 버튼을 누릅니다. 백엔드 endpoint
// (/api/newsletter/unsubscribe)는 행이 있으면 status='unsubscribed'로
// 변경하고, 없으면 idempotent하게 ok를 반환합니다.
//
// 이메일 본문에 들어가는 취소 링크는 /unsubscribe?email=xxx 같은 형태로
// query param을 통해 자동 채움도 지원합니다.

import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSeo } from '../hooks/useSeo.js';

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const initialEmail = (params.get('email') || '').trim();
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useSeo({
    title: '뉴스레터 구독 취소',
    description: '대무 뉴스레터 구독을 취소합니다.',
    path: '/unsubscribe',
  });

  useEffect(() => {
    document.title = '뉴스레터 구독 취소 — 대무 (DAEMU)';
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      if (api.isConfigured()) {
        const r = await api.post('/api/newsletter/unsubscribe', {
          email: email.trim(),
          privacy_consent: true,
        });
        if (r.ok) {
          setResult({ ok: true, message: '구독이 취소되었습니다. 감사합니다.' });
        } else {
          setResult({ ok: false, message: r.error || '취소 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
        }
      } else {
        // Demo mode — localStorage subscribers에서 제거
        try {
          const list = JSON.parse(localStorage.getItem('daemu_subscribers') || '[]');
          const lower = email.trim().toLowerCase();
          const next = list.map((s) =>
            (s.email || '').toLowerCase() === lower ? { ...s, status: '비활성' } : s,
          );
          localStorage.setItem('daemu_subscribers', JSON.stringify(next));
          window.dispatchEvent(new Event('daemu-db-change'));
          setResult({ ok: true, message: '구독이 취소되었습니다. (데모 모드)' });
        } catch {
          setResult({ ok: false, message: '취소 처리에 실패했습니다.' });
        }
      }
    } catch (err) {
      setResult({ ok: false, message: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page" style={{ background: '#f6f4f0', minHeight: '100vh', padding: '60px 16px' }}>
      <section style={{ maxWidth: 520, margin: '0 auto', background: '#fff', border: '1px solid #d7d4cf', padding: 36 }}>
        <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
          Newsletter
        </div>
        <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 500, margin: '0 0 14px', color: '#231815' }}>
          뉴스레터 구독 취소
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.75, color: '#5a534b', marginBottom: 22 }}>
          아래에 구독했던 이메일을 입력하시면 즉시 발송이 중단됩니다.<br />
          개인정보는 법적 보존 의무 외에 별도로 보관하지 않으며, 다시 구독하시려면 Partners 페이지에서 가능합니다.
        </p>

        {result && (
          <div style={{
            padding: '12px 16px',
            marginBottom: 18,
            background: result.ok ? '#eef6ee' : '#fff0ec',
            border: '1px solid ' + (result.ok ? '#cfe5cf' : '#f0c4c0'),
            color: result.ok ? '#2e7d32' : '#c0392b',
            fontSize: 13,
            lineHeight: 1.6,
          }}>
            {result.message}
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <input type="email" required placeholder="구독 이메일 주소"
            value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 12, border: '1px solid #d7d4cf', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button type="submit" className="btn" disabled={submitting || !email.trim()}
            style={{ padding: '12px 0', fontSize: 14 }}>
            {submitting ? '처리 중…' : '구독 취소'}
          </button>
        </form>

        <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid #e6e3dd', textAlign: 'center', fontSize: 12, color: '#8c867d', letterSpacing: '.04em' }}>
          <Link to="/" style={{ color: '#5a534b', textDecoration: 'none' }}>← 메인으로 돌아가기</Link>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #e6e3dd', textAlign: 'center', fontSize: 11, color: '#b9b5ae', letterSpacing: '.06em' }}>
          대무 (DAEMU) · daemu_office@naver.com · 061-335-1239
        </div>
      </section>
    </main>
  );
}
