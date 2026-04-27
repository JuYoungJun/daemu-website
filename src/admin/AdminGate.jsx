import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import { Auth } from '../lib/auth.js';
import { DB } from '../lib/db.js';
import { api } from '../lib/api.js';
import ChangePasswordForm from './ChangePasswordForm.jsx';

export default function AdminGate() {
  const [loggedIn, setLoggedIn] = useState(() => Auth.isLoggedIn());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mustChange, setMustChange] = useState(() => !!Auth.user()?.must_change_password);
  const [showChange, setShowChange] = useState(false);

  useEffect(() => { document.title = 'Admin — DAEMU'; }, []);

  // Refresh /api/auth/me on mount so the forced-change flag stays accurate
  // even if it changed on another device or via admin reset.
  useEffect(() => {
    if (loggedIn && api.isConfigured()) {
      Auth.refreshMe().then((u) => {
        if (u) setMustChange(!!u.must_change_password);
        else { Auth.logout(); setLoggedIn(false); }
      });
    }
  }, [loggedIn]);

  const onLogin = async (e) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.target);
    const email = String(fd.get('admin_id') || '').trim();
    const password = String(fd.get('admin_pw') || '');
    setLoading(true);
    const res = await Auth.login(email, password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || '로그인 실패');
      return;
    }
    setMustChange(!!res.mustChangePassword);
    setLoggedIn(true);
  };
  const onLogout = () => {
    Auth.logout();
    setLoggedIn(false);
    setMustChange(false);
    setShowChange(false);
  };

  if (loggedIn && (mustChange || showChange)) {
    return (
      <AdminShell>
        <main className="page">
          <section className="wide admin-page">
            <h1 className="page-title">Admin</h1>
            <ChangePasswordForm
              forced={mustChange}
              onDone={() => {
                setMustChange(false);
                setShowChange(false);
                alert('비밀번호가 변경되었습니다.');
              }}
            />
            {!mustChange && (
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setShowChange(false)}>
                  취소
                </button>
              </div>
            )}
            {mustChange && (
              <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#8c867d' }}>
                비밀번호를 변경한 후 대시보드로 이동합니다.
                <div style={{ marginTop: 12 }}>
                  <button type="button" onClick={onLogout}
                    style={{ background: 'transparent', border: 'none', color: '#b04a3b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                    다른 계정으로 로그인
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      </AdminShell>
    );
  }

  if (!loggedIn) {
    return (
      <AdminShell>
        <main className="page fade-up">
          <section className="wide admin-page">
            <h1 className="page-title">Admin</h1>
            <div className="admin-login-wrap">
              <div className="admin-login-box">
                <h2>관리자 로그인</h2>
                <p>대무 관리자 전용 페이지입니다.</p>
                {!api.isConfigured() && <p style={{fontSize:11,color:'#a09a92',marginTop:-12}}>※ 백엔드 미연결 상태 — 데모 모드로 진행됩니다.</p>}
                <form onSubmit={onLogin}>
                  <div className="admin-login-field"><input type="text" name="admin_id" placeholder="관리자 아이디 (이메일)" autoComplete="username" required /></div>
                  <div className="admin-login-field"><input type="password" name="admin_pw" placeholder="비밀번호" autoComplete="current-password" required /></div>
                  {error && <div style={{color:'#b04a3b',fontSize:12,margin:'4px 0 8px'}}>{error}</div>}
                  <button className="btn" type="submit" disabled={loading}>{loading ? '확인 중…' : '로그인'}</button>
                </form>
              </div>
            </div>
          </section>
        </main>
      </AdminShell>
    );
  }

  const inq = DB.get('inquiries');
  const ord = DB.get('orders');
  const crm = DB.get('crm');
  const cmp = DB.get('campaigns');
  const newInq = inq.filter(i => i.status === '신규').length;
  const pendingOrd = ord.filter(o => o.status === '접수' || o.status === '처리중').length;
  const leads = crm.filter(c => c.status === 'lead' || c.status === 'qualified').length;
  const sentCmp = cmp.filter(c => c.status === 'sent').length;

  const me = Auth.user() || { role: 'admin', email: '데모', name: '관리자' };
  // Permission map mirrors backend auth.PERMISSIONS — keep in sync.
  const PERM = {
    'content':       ['admin', 'developer'],
    'works':         ['admin', 'developer', 'tester'],
    'inquiries':     ['admin', 'tester'],
    'partners':      ['admin'],
    'orders':        ['admin', 'tester'],
    'stats':         ['admin', 'tester', 'developer'],
    'media':         ['admin', 'developer'],
    'mail':          ['admin', 'developer', 'tester'],
    'crm':           ['admin'],
    'campaign':      ['admin'],
    'promotion':     ['admin'],
    'popup':         ['admin', 'developer', 'tester'],
    'outbox':        ['admin', 'developer', 'tester'],
    'users':         ['admin'],
  };
  const can = (k) => PERM[k]?.includes(me.role);
  const ROLE_BADGE = { admin: '관리자', tester: '테스트', developer: '개발' };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide admin-page">
          <h1 className="page-title">Admin</h1>
          <div className="admin-dashboard">
            <div className="admin-header">
              <div>
                <h2>관리자 대시보드</h2>
                <div style={{ fontSize: 12, color: '#5f5b57', marginTop: 6 }}>
                  <strong>{me.name || me.email}</strong>
                  <span style={{ display: 'inline-block', marginLeft: 8, padding: '2px 8px', background: '#2a2724', color: '#f6f4f0', borderRadius: 2, fontSize: 10, letterSpacing: '.06em' }}>
                    {ROLE_BADGE[me.role] || me.role}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" type="button" onClick={() => setShowChange(true)}
                  style={{ minWidth: 120 }}>비밀번호 변경</button>
                <button className="btn admin-logout-btn" type="button" onClick={onLogout}>로그아웃</button>
              </div>
            </div>

            <div className="admin-stats-grid">
              <div className="admin-stat-card"><span className="admin-stat-number">{newInq}</span><span className="admin-stat-label">신규 상담 문의</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{pendingOrd}</span><span className="admin-stat-label">처리 대기 발주</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{leads}</span><span className="admin-stat-label">활성 리드</span></div>
              <div className="admin-stat-card"><span className="admin-stat-number">{sentCmp}</span><span className="admin-stat-label">발송된 캠페인</span></div>
            </div>

            <h3 className="admin-section-title">관리 메뉴</h3>
            <div className="admin-menu-grid">
              {can('content')   && <MenuCard to="/admin/content" title="콘텐츠 관리" desc="연혁, 소개, 서비스 등 사이트 콘텐츠를 수정합니다." items={['회사 소개 수정','연혁 관리','서비스 항목 편집','프로세스 내용 수정']} />}
              {can('works')     && <MenuCard to="/admin/works" title="작업사례 관리" desc="포트폴리오 및 작업사례를 등록하고 수정합니다." items={['작업사례 등록','기존 사례 수정','이미지 업로드','게시 상태 관리']} />}
              {can('inquiries') && <MenuCard to="/admin/inquiries" title="상담/문의 관리" desc="고객 상담 신청 및 문의 내역을 확인하고 관리합니다." items={['신규 문의 확인','상담 상태 관리','메일 자동회신 설정','문의 이력 검색']} />}
              {can('partners')  && <MenuCard to="/admin/partners" title="파트너 계정 관리" desc="파트너 계정 발급, 권한 설정, 승인을 관리합니다." items={['신규 계정 발급','계정 승인/거절','역할 및 권한 설정','계정 비활성화']} />}
              {can('orders')    && <MenuCard to="/admin/orders" title="발주 관리" desc="파트너 발주 접수, 처리, 출고 상태를 관리합니다." items={['신규 발주 확인','발주 상태 변경','상품 등록 및 가격','정산 내역 관리']} />}
              {can('stats')     && <MenuCard to="/admin/stats" title="통계 및 리포트" desc="방문자, 문의, 발주 등 주요 지표를 확인합니다." items={['방문자 통계','문의 유입 분석','발주 현황 리포트','월별 매출 추이']} />}
              {can('media')     && <MenuCard to="/admin/media" title="미디어 관리" desc="이미지 및 영상을 업로드하고 관리합니다." items={['이미지 업로드','영상 업로드','미디어 라이브러리','용량 관리']} />}
              {can('mail')      && <MenuCard to="/admin/mail" title="메일 자동회신 설정" desc="상담 문의 접수 시 자동으로 발송되는 회신 메일을 관리합니다." items={['자동회신 템플릿 편집','카테고리별 회신 설정','발송 이력 확인','자동회신 ON/OFF']} />}
            </div>

            <h3 className="admin-section-title" style={{marginTop:'48px'}}>마케팅 / CRM</h3>
            <div className="admin-menu-grid">
              {can('crm')       && <MenuCard to="/admin/crm" title="CRM" desc="리드와 고객 관계를 파이프라인 단계로 관리합니다." items={['리드 → 검토중 → 전환 단계 추적','태그·세그먼트 분류','활동 메모 타임라인','예상 거래 금액']} />}
              {can('campaign')  && <MenuCard to="/admin/campaign" title="캠페인" desc="이메일·SMS·Kakao 캠페인 작성, 예약, 발송, 결과 분석." items={['CRM 단계/태그 기반 세그먼트','즉시 / 예약 / 초안 저장','오픈율·클릭률 추적','뉴스레터 구독자 관리']} />}
              {can('promotion') && <MenuCard to="/admin/promotion" title="프로모션" desc="쿠폰 코드와 이벤트/공지를 관리합니다." items={['정률·정액·1+1 할인','유효기간·최대사용 횟수','실시간 사용량 추적','이벤트/공지 배너']} />}
              {can('popup')     && <MenuCard to="/admin/popup" title="팝업" desc="사이트 팝업 배너를 등록·수정하고 노출 규칙을 관리합니다." items={['중앙/우하단/상단 위치','이미지 + CTA 버튼','노출 빈도 (매번/일1회/영구1회)','타겟 페이지 + 노출/클릭 추적']} />}
              {can('outbox')    && <MenuCard to="/admin/outbox" title="Outbox" desc="이메일·캠페인·계약서 발송 이력을 확인합니다." items={['백엔드 API 호출 로그','시뮬레이션 / 발송완료 / 실패 구분','수신자·제목·본문 검색','데모 환경에서도 발송 시뮬레이션 확인']} />}
            </div>

            {can('users') && (
              <>
                <h3 className="admin-section-title" style={{marginTop:'48px'}}>시스템</h3>
                <div className="admin-menu-grid">
                  <MenuCard to="/admin/users" title="사용자 권한 관리" desc="관리자 / 테스트 / 개발 권한 계정을 발급하고 관리합니다." items={['신규 계정 발급','권한 변경 (admin · tester · developer)','계정 활성화 / 비활성화','자기 계정 보호 (셀프 권한 강등 차단)']} />
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </AdminShell>
  );
}

function MenuCard({ to, title, desc, items }) {
  return (
    <div className="admin-menu-card">
      <h4>{title}</h4>
      <p>{desc}</p>
      <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>
      <Link to={to} className="btn admin-menu-btn">관리하기</Link>
    </div>
  );
}
