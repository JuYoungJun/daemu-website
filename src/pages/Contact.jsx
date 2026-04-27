import { useState } from 'react';
import { useFadeUp } from '../hooks/useFadeUp.js';
import { DB } from '../lib/db.js';
import { sendAutoReply, isEmailEnabled } from '../lib/email.js';

const TABS = ['창업 컨설팅','메뉴 개발','브랜드 디자인','인테리어/공간 설계','원두/베이커리 납품','기타 문의'];

export default function Contact() {
  const [active, setActive] = useState('창업 컨설팅');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', brand: '', region: '', open: '', msg: '', topic: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useFadeUp([]);

  const isEtc = active === '기타 문의';
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
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

    DB.add('inquiries', inquiry);

    let mailNote = '';
    if (form.email) {
      try {
        const r = await sendAutoReply({
          to_email: form.email,
          to_name: form.name,
          category: active,
          message: form.msg
        });
        if (r.ok) mailNote = '입력하신 이메일(' + form.email + ')로 접수 확인 메일이 발송되었습니다.';
        else if (r.simulated) mailNote = '입력하신 이메일(' + form.email + ')로 접수 확인 메일이 발송될 예정입니다.';
        else mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      } catch (err) {
        mailNote = '메일 발송에 일시적 문제가 있어 담당자가 직접 연락드리겠습니다.';
      }
    }

    alert('상담 신청이 접수되었습니다. (' + active + ')\n\n' + mailNote + '\n\n담당 매니저가 빠른 시일 내에 연락드리겠습니다.');
    setForm({ name:'', phone:'', email:'', brand:'', region:'', open:'', msg:'', topic:'' });
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
                  <div className="field full"><input type="text" placeholder="이름" value={form.name} onChange={update('name')} required /></div>
                  <div className="field"><input type="text" placeholder="연락처(선택)" value={form.phone} onChange={update('phone')} /></div>
                  <div className="field"><input type="email" placeholder="E-mail" value={form.email} onChange={update('email')} required /></div>
                  <div className="field full"><input type="text" placeholder="문의 제목" value={form.topic} onChange={update('topic')} required /></div>
                  <div className="field full"><textarea placeholder="자유롭게 문의 내용을 적어주세요" value={form.msg} onChange={update('msg')} required></textarea></div>
                  <div className="field full center">
                    <button className="btn" type="submit" disabled={submitting}>{submitting ? '전송 중…' : '문의 보내기'}</button>
                  </div>
                  <div className="field full center">
                    <p className="contact-auto-reply-note">입력하신 이메일로 접수 확인 메일이 발송됩니다.</p>
                  </div>
                </div>
              ) : (
                <div className="form-grid">
                  <div className="field full"><input type="text" placeholder="이름(회사명)" value={form.name} onChange={update('name')} required /></div>
                  <div className="field"><input type="text" placeholder="연락처" value={form.phone} onChange={update('phone')} /></div>
                  <div className="field"><input type="email" placeholder="E-mail" value={form.email} onChange={update('email')} required /></div>
                  <div className="field full"><input type="text" placeholder="브랜드명(또는 사업분야)" value={form.brand} onChange={update('brand')} /></div>
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
                  <div className="field full center">
                    <button className="btn" type="submit" disabled={submitting}>{submitting ? '전송 중…' : '상담 신청하기'}</button>
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
