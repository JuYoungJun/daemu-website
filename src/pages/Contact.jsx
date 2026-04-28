import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFadeUp } from '../hooks/useFadeUp.js';
import { DB } from '../lib/db.js';
import { sendAutoReply, isEmailEnabled } from '../lib/email.js';
import { api } from '../lib/api.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd, faqLd } from '../lib/seo.js';

const CONTACT_FAQS = [
  { q: '상담은 어떻게 신청하나요?', a: '본 페이지의 카테고리를 선택하고 폼을 작성해 주시면, 1–2 영업일 내 담당 매니저가 회신합니다.' },
  { q: '비용은 미리 알 수 있나요?', a: '프로젝트 범위에 따라 견적이 달라지므로, 상담 신청 후 1차 무료 상담을 통해 견적을 안내드립니다.' },
  { q: '나주 외 지역도 가능한가요?', a: '네. 인천·광주·전남 등 전국 프로젝트 진행 가능. 화상 회의 + 현장 방문 병행.' },
];

function ConsentRow({ consent, setConsent }) {
  return (
    <div className="field full" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0', borderTop: '1px solid #e6e3dd' }}>
      <input id="privacy-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required
        style={{ marginTop: 4, width: 18, height: 18, accentColor: '#2a2724', flexShrink: 0 }} />
      <label htmlFor="privacy-consent" style={{ fontSize: 12, color: '#5f5b57', lineHeight: 1.6, cursor: 'pointer' }}>
        <strong style={{ color: '#222' }}>(필수)</strong> 개인정보 수집·이용에 동의합니다. 수집 항목: 이름, 이메일, 연락처(선택), 문의 내용 / 보유 기간: 3년 / 자세한 내용은 <Link to="/privacy" style={{ textDecoration: 'underline' }}>개인정보처리방침</Link>을 확인해 주세요.
      </label>
    </div>
  );
}

const TABS = ['창업 컨설팅','메뉴 개발','브랜드 디자인','인테리어/공간 설계','원두/베이커리 납품','기타 문의'];

export default function Contact() {
  const [active, setActive] = useState('창업 컨설팅');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', brand: '', region: '', open: '', msg: '', topic: ''
  });
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useFadeUp([]);
  useSeo({
    title: 'Contact — 상담·문의 접수',
    description: '카페 창업, 브랜드 개발, 메뉴 개발, 공간 설계 등 대무와 함께할 다양한 프로젝트를 상담하세요. 1–2 영업일 내 담당 매니저 회신.',
    path: '/contact',
    keywords: '카페 컨설팅 상담, 베이커리 창업 문의, 카페 견적 문의, 대무 연락',
    jsonLd: [
      breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Contact', path: '/contact' }]),
      faqLd(CONTACT_FAQS),
    ],
  });

  const isEtc = active === '기타 문의';
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!consent) {
      alert('개인정보 수집·이용에 동의해 주세요.');
      return;
    }
    setSubmitting(true);

    const inquiry = isEtc ? {
      name: form.name,
      email: form.email,
      phone: form.phone,
      topic: form.topic,
      msg: form.msg,
      type: active,
      status: '신규'
    } : {
      name: form.name,
      phone: form.phone,
      email: form.email,
      brand: form.brand,
      region: form.region,
      open: form.open,
      msg: form.msg,
      type: active,
      status: '신규'
    };

    // V3-10: only mirror to localStorage if there's no backend (offline
    // demo). When backend is configured, the API is the only writer so
    // production inquiries don't leak into the visitor's browser storage.
    if (!api.isConfigured()) DB.add('inquiries', inquiry);

    let mailNote = '';
    if (api.isConfigured()) {
      // Backend persists the inquiry AND fires the auto-reply server-side
      // — frontend doesn't touch the email API directly anymore.
      const r = await api.post('/api/inquiries', {
        name: form.name,
        email: form.email,
        phone: form.phone || '',
        brand_name: form.brand || '',
        location: form.region || '',
        expected_open: form.open || '',
        category: active,
        message: isEtc ? `[${form.topic || '기타'}] ${form.msg}` : form.msg,
        privacy_consent: true,
      });
      if (r.ok) {
        mailNote = '입력하신 이메일(' + form.email + ')로 접수 확인 메일이 발송됩니다.';
      } else if (r.status === 429) {
        mailNote = '문의가 너무 빠르게 접수되었습니다. 잠시 후 다시 시도해 주세요.';
      } else {
        mailNote = '접수는 완료되었지만 자동 회신 메일에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      }
    } else if (form.email) {
      // Demo mode (no backend): simulate via existing email lib so the
      // outbox in localStorage shows the simulated send.
      try {
        const r = await sendAutoReply({
          to_email: form.email,
          to_name: form.name,
          category: active,
          message: form.msg,
        });
        mailNote = r.simulated
          ? '입력하신 이메일(' + form.email + ')로 접수 확인 메일이 발송될 예정입니다.'
          : '입력하신 이메일(' + form.email + ')로 접수 확인 메일이 발송되었습니다.';
      } catch {
        mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      }
    }

    alert('상담 신청이 접수되었습니다. (' + active + ')\n\n' + mailNote + '\n\n담당 매니저가 빠른 시일 내에 연락드리겠습니다.');
    setForm({ name:'', phone:'', email:'', brand:'', region:'', open:'', msg:'', topic:'' });
    setConsent(false);
    setSubmitting(false);
  };

  return (
    <main className="page">
      <section className="wide fade-up">
        <h1 className="page-title">Contact</h1>
        <div className="contact-layout">
          <div className="intro-copy">
            <h2>이야기를 마주하고<br />브랜드의 다음 움직임을<br />함께 만들어보세요</h2>
            <p>카페 창업, 브랜드 개발, 메뉴 개발 등<br />대무와 함께할 수 있는 다양한 프로젝트를<br />상담하실 수 있습니다.</p>
          </div>

          <div>
            <div className="contact-tabs" role="tablist" aria-label="문의 카테고리">
              {TABS.map((t) => (
                <button key={t} type="button"
                  className={'contact-tab' + (active === t ? ' active' : '')}
                  onClick={() => setActive(t)}
                  aria-pressed={active === t}>
                  {t}
                </button>
              ))}
            </div>

            <form className="contact-react-form" onSubmit={onSubmit}>
              <input type="hidden" name="consult_category" value={active} />

              {isEtc ? (
                <div className="form-grid">
                  <div className="field full"><input type="text" placeholder="이름" autoComplete="name" value={form.name} onChange={update('name')} required /></div>
                  <div className="field"><input type="tel" inputMode="tel" placeholder="연락처(선택)" autoComplete="tel" value={form.phone} onChange={update('phone')} /></div>
                  <div className="field"><input type="email" inputMode="email" placeholder="E-mail" autoComplete="email" value={form.email} onChange={update('email')} required /></div>
                  <div className="field full"><input type="text" placeholder="문의 제목" value={form.topic} onChange={update('topic')} required /></div>
                  <div className="field full"><textarea placeholder="자유롭게 문의 내용을 적어주세요" value={form.msg} onChange={update('msg')} required></textarea></div>
                  <ConsentRow consent={consent} setConsent={setConsent} />
                  <div className="field full center">
                    <button className="btn" type="submit" disabled={submitting || !consent}>{submitting ? '전송 중…' : '문의 보내기'}</button>
                  </div>
                  <div className="field full center">
                    <p className="contact-auto-reply-note">입력하신 이메일로 접수 확인 메일이 발송됩니다.</p>
                  </div>
                </div>
              ) : (
                <div className="form-grid">
                  <div className="field full"><input type="text" placeholder="이름(회사명)" autoComplete="name" value={form.name} onChange={update('name')} required /></div>
                  <div className="field"><input type="tel" inputMode="tel" placeholder="연락처" autoComplete="tel" value={form.phone} onChange={update('phone')} /></div>
                  <div className="field"><input type="email" inputMode="email" placeholder="E-mail" autoComplete="email" value={form.email} onChange={update('email')} required /></div>
                  <div className="field full"><input type="text" placeholder="브랜드명(또는 사업분야)" autoComplete="organization" value={form.brand} onChange={update('brand')} /></div>
                  <div className="field">
                    <select required value={form.region} onChange={update('region')}>
                      <option value="" disabled>매장 위치(예정 지역)</option>
                      <option>서울</option><option>경기</option><option>인천</option><option>대전/세종/충청</option>
                      <option>대구/경북</option><option>부산/경남</option><option>광주/전라</option><option>강원</option>
                      <option>제주</option><option>기타</option>
                    </select>
                  </div>
                  <div className="field">
                    <select required value={form.open} onChange={update('open')}>
                      <option value="" disabled>예상 오픈 시기</option>
                      <option>1개월 이내</option><option>3개월 이내</option><option>6개월 이내</option>
                      <option>1년 이내</option><option>미정</option>
                    </select>
                  </div>
                  <div className="field full"><textarea placeholder="문의내용" value={form.msg} onChange={update('msg')}></textarea></div>
                  <ConsentRow consent={consent} setConsent={setConsent} />
                  <div className="field full center">
                    <button className="btn" type="submit" disabled={submitting || !consent}>{submitting ? '전송 중…' : '상담 신청하기'}</button>
                  </div>
                  <div className="field full center">
                    <p className="contact-auto-reply-note">
                      {isEmailEnabled() ? '문의 접수 시 입력하신 이메일로 자동 확인 메일이 발송됩니다.' : '문의 접수 시 입력하신 이메일로 자동 확인 메일이 발송될 예정입니다.'}
                    </p>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>

        <div className="contact-bottom fade-up">
          <h3>▸ CONTACT INFO</h3>
          <div>
            <p><strong>전화</strong> &nbsp; <a href="tel:0613351239">061-335-1239</a></p>
            <p><strong>메일</strong> &nbsp; <a href="mailto:daemu_office@naver.com">daemu_office@naver.com</a></p>
            <p><strong>상담 가능 시간</strong> &nbsp; MON-FRI 09:00~18:00</p>
            <p style={{marginTop:'16px'}}>반갑습니다. 문의를 남겨주시면 담당 매니저가 관련 내용 확인 후 빠른 시일 내에 연락드리겠습니다.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
