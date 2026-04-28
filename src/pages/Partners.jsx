import { useState, useEffect, useMemo } from 'react';
import { useFadeUp } from '../hooks/useFadeUp.js';
import { PartnerAuth, defaultPasswordHint } from '../lib/partnerAuth.js';
import { PRODUCT_CATALOG, findProduct } from '../lib/partnerProducts.js';
import { DB } from '../lib/db.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';
import { api } from '../lib/api.js';

export default function Partners() {
  useFadeUp([]);
  useSeo({
    title: 'Partners — 파트너사 모집 및 발주 포털',
    description: '대무 파트너 전용 발주 및 운영 포털. 본사 승인 후 발주서·계약서 발송, 실시간 발주 추적, 파트너 계정 관리.',
    path: '/partners',
    keywords: '대무 파트너, 카페 납품 파트너, 베이커리 원두 파트너, B2B 발주 포털',
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Partners', path: '/partners' }])],
  });
  const [partner, setPartner] = useState(() => PartnerAuth.current());
  const [mustChange, setMustChange] = useState(() => partner ? PartnerAuth.needsPasswordChange(partner) : false);
  const [mode, setMode] = useState('login');

  useEffect(() => {
    const onChange = () => {
      const p = PartnerAuth.current();
      setPartner(p);
      setMustChange(p ? PartnerAuth.needsPasswordChange(p) : false);
    };
    window.addEventListener('daemu-db-change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('daemu-db-change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const handleLogin = (p, mustChangeFlag) => {
    setPartner(p);
    setMustChange(mustChangeFlag);
  };

  const handleLogout = () => {
    PartnerAuth.logout();
    setPartner(null);
    setMustChange(false);
  };

  if (partner && mustChange) {
    return <ForcePasswordChange partner={partner} onDone={() => setMustChange(false)} onLogout={handleLogout} />;
  }
  if (partner) {
    return <PartnerPortal partner={partner} onLogout={handleLogout} />;
  }

  return <PartnersGate mode={mode} setMode={setMode} onLogin={handleLogin} />;
}

/* ─────────────── 로그인 + 가입 ─────────────── */

function PartnersGate({ mode, setMode, onLogin }) {
  return (
    <main className="page fade-up">
      <section className="wide partners-page">
        <h1 className="page-title">Partners</h1>

        <div className="partners-intro-block">
          <div className="partners-copy">
            <h2>대무 파트너 전용<br />발주 및 운영 포털</h2>
            <p>
              대무 파트너 포털은 본사, 지점, 외부 파트너사를 위한<br />
              제한된 접근 기반의 발주 및 운영 관리 시스템입니다.<br /><br />
              계정은 관리자 승인을 통해 발급되며,<br />
              역할에 따라 접근 권한이 구분됩니다.
            </p>
          </div>

          <div className="partners-login-box">
            <div style={{display:'flex',gap:0,marginBottom:18,borderBottom:'1px solid #d7d4cf'}}>
              <button type="button" onClick={() => setMode('login')}
                style={tabBtnStyle(mode === 'login')}>로그인</button>
              <button type="button" onClick={() => setMode('signup')}
                style={tabBtnStyle(mode === 'signup')}>가입 신청</button>
            </div>
            {mode === 'login' ? <LoginForm onLogin={onLogin} /> : <SignupForm onDone={() => setMode('login')} />}
          </div>
        </div>
      </section>

      <section className="partners-section-block">
        <div className="wide">
          <h3 className="partners-section-title">발주 워크플로우</h3>
          <p className="partners-section-sub">Order Workflow</p>
          <div className="partners-card-grid">
            <article className="partners-outline-card"><span className="step-num">01</span><h4>상품 선택</h4><p>카테고리별 상품 조회 후<br />필요 수량 입력</p></article>
            <article className="partners-outline-card"><span className="step-num">02</span><h4>장바구니 발주</h4><p>여러 상품을 묶어 한 번에 제출<br />정기 발주·재주문 지원</p></article>
            <article className="partners-outline-card"><span className="step-num">03</span><h4>실시간 추적</h4><p>접수 → 처리중 → 출고완료<br />단계별 알림 및 명세서 수령</p></article>
          </div>
        </div>
      </section>

      <NewsletterCTA />
    </main>
  );
}

function tabBtnStyle(active) {
  return {
    flex: 1, padding: '10px 0', background: 'none', border: 'none',
    borderBottom: active ? '2px solid #111' : '2px solid transparent',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
    color: active ? '#111' : '#8c867d'
  };
}

function LoginForm({ onLogin }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const r = PartnerAuth.login({ id, password });
    if (r.ok) onLogin(r.partner, r.mustChangePassword);
    else setErr(r.reason === 'not-found' ? '등록되지 않은 계정입니다. 가입 신청 후 본사 승인을 받으세요.' : '비밀번호가 일치하지 않습니다.');
  };

  return (
    <form onSubmit={submit}>
      <h3>파트너 로그인</h3>
      <p style={{fontSize:12,color:'#8c867d',marginBottom:18}}>
        가입 후 본사 승인을 받으면 로그인 가능합니다.<br />
        초기 비밀번호는 <strong>등록한 휴대폰 뒷 4자리</strong> 입니다.<br />
        첫 로그인 시 비밀번호 변경 안내가 나타납니다.
      </p>
      <div className="partners-login-field"><input type="text" placeholder="아이디 (이메일 / 회사명 / 담당자명 / 연락처)" value={id} onChange={(e) => setId(e.target.value)} required /></div>
      <div className="partners-login-field"><input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      {err && <p style={{color:'#c0392b',fontSize:12,marginTop:8}}>{err}</p>}
      <button className="btn partners-login-btn" type="submit">로그인</button>
    </form>
  );
}

function SignupForm({ onDone }) {
  const [form, setForm] = useState({ company:'', person:'', phone:'', email:'', type:'', message:'' });
  const [submitted, setSubmitted] = useState(false);
  const u = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    PartnerAuth.signup(form);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div>
        <h3>신청 완료</h3>
        <p style={{fontSize:13,color:'#4a4744',lineHeight:1.7,margin:'12px 0 24px'}}>
          가입 신청이 접수되었습니다.<br />
          본사 검토 후 등록된 이메일/전화로 안내드립니다 (영업일 1-2일).<br /><br />
          승인되면 자동으로 파트너 계정이 발급되며,<br />
          초기 비밀번호는 입력하신 <strong>휴대폰 뒷 4자리</strong> 입니다.<br />
          첫 로그인 시 비밀번호 변경을 안내드립니다.
        </p>
        <button className="btn" type="button" onClick={onDone}>로그인 화면으로</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h3>파트너 가입 신청</h3>
      <p style={{fontSize:12,color:'#8c867d',marginBottom:18}}>본사 검토 후 승인됩니다.</p>
      <div className="partners-login-field"><input type="text" placeholder="회사명" value={form.company} onChange={u('company')} required /></div>
      <div className="partners-login-field"><input type="text" placeholder="담당자 성함" value={form.person} onChange={u('person')} required /></div>
      <div className="partners-login-field"><input type="tel" placeholder="연락처 (예: 010-0000-0000)" value={form.phone} onChange={u('phone')} required /></div>
      <div className="partners-login-field"><input type="email" placeholder="이메일" value={form.email} onChange={u('email')} required /></div>
      <div className="partners-login-field"><input type="text" placeholder="업종 (예: 원두 납품)" value={form.type} onChange={u('type')} /></div>
      <div className="partners-login-field"><textarea placeholder="소개 / 요청사항 (선택)" value={form.message} onChange={u('message')} rows={3} style={{width:'100%',padding:12,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit'}}></textarea></div>
      <button className="btn partners-login-btn" type="submit">신청 보내기</button>
    </form>
  );
}

/* ─────────────── 비밀번호 변경 강제 ─────────────── */

function ForcePasswordChange({ partner, onDone, onLogout }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (pw1.length < 6) return setErr('비밀번호는 최소 6자 이상이어야 합니다.');
    if (pw1 !== pw2) return setErr('비밀번호가 일치하지 않습니다.');
    if (pw1 === defaultPasswordHint(partner)) return setErr('초기 비밀번호와 다른 값을 사용해주세요.');
    const r = PartnerAuth.changePassword(partner.id, pw1);
    if (r.ok) onDone();
    else setErr('변경 실패: ' + (r.reason || ''));
  };

  return (
    <main className="page fade-up">
      <section className="wide" style={{maxWidth:560,margin:'0 auto'}}>
        <div style={{textAlign:'center',marginTop:48,marginBottom:32}}>
          <p style={{fontSize:11,letterSpacing:'.2em',color:'#8c867d',textTransform:'uppercase'}}>FIRST LOGIN</p>
          <h1 className="page-title" style={{margin:'14px 0 4px'}}>비밀번호 변경</h1>
          <p style={{fontSize:14,color:'#6f6b68',marginTop:18,lineHeight:1.7}}>
            보안을 위해 초기 비밀번호를<br />새로운 비밀번호로 변경해 주세요.<br />
            <span style={{fontSize:12,color:'#8c867d'}}>변경 후 다음 로그인부터 새 비밀번호를 사용합니다.</span>
          </p>
        </div>

        <form onSubmit={submit} style={{maxWidth:380,margin:'0 auto',padding:'0 24px'}}>
          <div style={{marginBottom:14}}>
            <label style={{display:'block',fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase',marginBottom:8}}>새 비밀번호 (6자 이상)</label>
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required minLength={6} autoFocus
              style={{width:'100%',padding:12,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit',boxSizing:'border-box'}} />
          </div>
          <div style={{marginBottom:14}}>
            <label style={{display:'block',fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase',marginBottom:8}}>새 비밀번호 확인</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6}
              style={{width:'100%',padding:12,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit',boxSizing:'border-box'}} />
          </div>
          {err && <p style={{color:'#c0392b',fontSize:12,marginBottom:12}}>{err}</p>}
          <button className="btn" type="submit" style={{width:'100%',marginTop:8}}>비밀번호 변경 완료</button>
          <button type="button" onClick={onLogout} style={{display:'block',margin:'18px auto 0',background:'none',border:'none',color:'#8c867d',fontSize:12,textDecoration:'underline',cursor:'pointer'}}>다음에 변경하기 (로그아웃)</button>
        </form>
      </section>
    </main>
  );
}

/* ─────────────── 파트너 포털 ─────────────── */

function PartnerPortal({ partner, onLogout }) {
  const [tab, setTab] = useState('shop');
  return (
    <main className="page fade-up">
      <section className="wide partners-page">
        <h1 className="page-title">Partner Portal</h1>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #d7d4cf',padding:'24px 0',marginBottom:24,gap:16,flexWrap:'wrap'}}>
          <div>
            <p style={{fontSize:12,letterSpacing:'.14em',color:'#8c867d',textTransform:'uppercase',margin:0}}>{partner.role || '파트너'}</p>
            <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontWeight:400,fontSize:32,margin:'4px 0 0',fontStyle:'italic'}}>{partner.name}</h2>
            <p style={{fontSize:13,color:'#6f6b68',margin:'4px 0 0'}}>{partner.person} {partner.phone ? '· ' + partner.phone : ''}</p>
          </div>
          <button type="button" className="btn" onClick={onLogout}>로그아웃</button>
        </div>

        <div style={{display:'flex',gap:32,borderBottom:'1px solid #e6e3dd',marginBottom:36,flexWrap:'wrap'}}>
          {[['shop','상품 발주'],['history','발주 이력'],['account','계정 / 비밀번호']].map(([k,l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              style={{background:'none',border:'none',padding:'14px 0',fontFamily:'inherit',fontSize:13,letterSpacing:'.04em',color:tab===k?'#111':'#8c867d',cursor:'pointer',borderBottom:tab===k?'2px solid #111':'2px solid transparent',marginBottom:-1}}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'shop' && <Shop partner={partner} onSubmitted={() => setTab('history')} />}
        {tab === 'history' && <History partner={partner} onReorder={() => setTab('shop')} />}
        {tab === 'account' && <Account partner={partner} />}
      </section>
    </main>
  );
}

/* 상품 발주 (장바구니) */
function Shop({ partner, onSubmitted }) {
  const [cart, setCart] = useState({}); // sku → qty
  const [note, setNote] = useState('');

  const addToCart = (sku, delta = 1) => {
    setCart((c) => {
      const next = { ...c, [sku]: Math.max(0, (c[sku] || 0) + delta) };
      if (next[sku] === 0) delete next[sku];
      return next;
    });
  };
  const setQty = (sku, qty) => {
    const n = Math.max(0, parseInt(qty || 0, 10));
    setCart((c) => {
      const next = { ...c };
      if (n === 0) delete next[sku]; else next[sku] = n;
      return next;
    });
  };

  const items = useMemo(() => Object.entries(cart).map(([sku, qty]) => {
    const p = findProduct(sku);
    return p ? { ...p, qty, subtotal: p.price * qty } : null;
  }).filter(Boolean), [cart]);

  const total = items.reduce((a, x) => a + x.subtotal, 0);

  const submit = () => {
    if (!items.length) { alert('상품을 1개 이상 담아주세요.'); return; }
    const summary = items.length === 1
      ? items[0].name
      : `${items[0].name} 외 ${items.length - 1}종`;
    const totalQty = items.reduce((a, x) => a + x.qty, 0);
    const avgPrice = totalQty ? Math.round(total / totalQty) : 0;
    DB.add('orders', {
      partner: partner.name,
      partnerId: partner.id,
      product: summary,
      qty: totalQty,
      price: avgPrice,
      total,
      items: items.map(x => ({ sku: x.sku, name: x.name, unit: x.unit, qty: x.qty, price: x.price })),
      note,
      status: '접수'
    });
    window.dispatchEvent(new Event('daemu-db-change'));
    alert(`발주가 접수되었습니다.\n총 ${items.length}종 / ${totalQty}개 / ${total.toLocaleString('ko')}원\n본사 확인 후 처리 단계로 진행됩니다.`);
    setCart({});
    setNote('');
    onSubmitted && onSubmitted();
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:32,alignItems:'flex-start'}}>
      <div>
        {PRODUCT_CATALOG.map((cat) => (
          <div key={cat.category} style={{marginBottom:36}}>
            <h3 style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'#8c867d',margin:'0 0 14px',fontWeight:500}}>{cat.category}</h3>
            <div style={{borderTop:'1px solid #d7d4cf'}}>
              {cat.items.map((p) => (
                <div key={p.sku} style={{display:'grid',gridTemplateColumns:'1fr 90px 110px 120px',gap:12,alignItems:'center',padding:'18px 0',borderBottom:'1px solid #e6e3dd'}}>
                  <div>
                    <div style={{fontSize:14,color:'#222',fontWeight:500}}>{p.name}</div>
                    <div style={{fontSize:11,color:'#8c867d',marginTop:2,letterSpacing:'.04em'}}>{p.sku} · {p.unit}</div>
                  </div>
                  <div style={{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:18,color:'#111'}}>{p.price.toLocaleString('ko')}<span style={{fontSize:11,marginLeft:4,color:'#6f6b68',fontFamily:'inherit',fontStyle:'normal'}}>원</span></div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <button type="button" onClick={() => addToCart(p.sku, -1)} style={qtyBtnStyle}>−</button>
                    <input type="number" min="0" value={cart[p.sku] || 0} onChange={(e) => setQty(p.sku, e.target.value)}
                      style={{width:42,padding:'4px 0',textAlign:'center',border:'1px solid #d7d4cf',background:'#fff',fontSize:13,fontFamily:'inherit'}} />
                    <button type="button" onClick={() => addToCart(p.sku, 1)} style={qtyBtnStyle}>+</button>
                  </div>
                  <button type="button" onClick={() => addToCart(p.sku, 1)} className="adm-btn-sm"
                    style={{padding:'6px 12px',fontSize:11,border:'1px solid #b9b5ae',background:'transparent',cursor:'pointer',justifySelf:'end'}}>
                    + 담기
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <aside style={{position:'sticky',top:24,padding:'24px',background:'#f6f4f0',border:'1px solid #d7d4cf'}}>
        <h3 style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'#8c867d',margin:'0 0 14px',fontWeight:500}}>장바구니</h3>
        {!items.length ? (
          <p style={{fontSize:13,color:'#8c867d',margin:'24px 0',textAlign:'center'}}>담긴 상품이 없습니다.</p>
        ) : (
          <>
            <div style={{borderTop:'1px solid #d7d4cf',marginBottom:14}}>
              {items.map((x) => (
                <div key={x.sku} style={{padding:'12px 0',borderBottom:'1px solid #e6e3dd'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                    <span style={{fontSize:13,color:'#222'}}>{x.name}</span>
                    <button onClick={() => setQty(x.sku, 0)} style={{background:'none',border:'none',color:'#8c867d',fontSize:11,cursor:'pointer'}}>×</button>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:11,color:'#6f6b68'}}>
                    <span>{x.qty} × {x.price.toLocaleString('ko')}원</span>
                    <span style={{color:'#111',fontWeight:500}}>{x.subtotal.toLocaleString('ko')}원</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'space-between',padding:'12px 0',borderBottom:'2px solid #111',marginBottom:14}}>
              <span style={{fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase'}}>합계</span>
              <span style={{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:24,color:'#111'}}>{total.toLocaleString('ko')}원</span>
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="배송 메모, 요청사항 (선택)" rows={3}
              style={{width:'100%',padding:10,fontFamily:'inherit',fontSize:12,border:'1px solid #d7d4cf',background:'#fff',marginBottom:12,resize:'vertical',boxSizing:'border-box'}} />
            <button type="button" onClick={submit} className="btn" style={{width:'100%'}}>발주 제출</button>
          </>
        )}
      </aside>
    </div>
  );
}

const qtyBtnStyle = {
  width: 24, height: 24, padding: 0, border: '1px solid #b9b5ae',
  background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
};

/* 발주 이력 + 시각 상태 + 재주문 */
function History({ partner, onReorder }) {
  const [orders, setOrders] = useState(() => DB.get('orders').filter((o) => o.partnerId === partner.id || o.partner === partner.name).reverse());

  useEffect(() => {
    const refresh = () => setOrders(DB.get('orders').filter((o) => o.partnerId === partner.id || o.partner === partner.name).reverse());
    window.addEventListener('daemu-db-change', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('daemu-db-change', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [partner.id, partner.name]);

  const totalAmt = orders.reduce((a, o) => a + (Number(o.total || 0) || (Number(o.qty || 0) * Number(o.price || 0))), 0);

  const reorder = (o) => {
    if (o.items && o.items.length) {
      o.items.forEach((it) => {
        DB.add('orders', {
          partner: partner.name,
          partnerId: partner.id,
          product: it.name,
          qty: it.qty,
          price: it.price,
          total: it.qty * it.price,
          items: [it],
          status: '접수',
          reorderOf: o.id
        });
      });
    } else {
      DB.add('orders', { ...o, id: undefined, date: undefined, status:'접수', reorderOf: o.id });
    }
    window.dispatchEvent(new Event('daemu-db-change'));
    alert('재주문이 접수되었습니다.');
  };

  const cancelOrder = (o) => {
    if (o.status !== '접수') { alert('접수 단계의 발주만 취소 가능합니다.'); return; }
    if (!confirm('이 발주를 취소하시겠습니까?')) return;
    DB.del('orders', o.id);
    window.dispatchEvent(new Event('daemu-db-change'));
  };

  if (!orders.length) {
    return (
      <div style={{textAlign:'center',padding:'72px 0',color:'#8c867d'}}>
        <p>아직 발주 이력이 없습니다.</p>
        <button type="button" className="btn" style={{marginTop:18}} onClick={onReorder}>발주하러 가기</button>
      </div>
    );
  }

  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',borderTop:'1px solid #d7d4cf',borderBottom:'1px solid #d7d4cf',marginBottom:32}}>
        <KPI value={orders.length} label="전체 발주" />
        <KPI value={orders.filter(o => o.status === '출고완료').length} label="출고완료" />
        <KPI value={totalAmt.toLocaleString('ko')} label="누적 총액 (원)" />
      </div>

      {orders.map((o) => <OrderCard key={o.id} order={o} onReorder={() => reorder(o)} onCancel={() => cancelOrder(o)} />)}
    </>
  );
}

function KPI({ value, label }) {
  return (
    <div style={{padding:'24px',textAlign:'center',borderRight:'1px solid #e6e3dd'}}>
      <b style={{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:36,display:'block',color:'#111'}}>{value}</b>
      <span style={{fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase'}}>{label}</span>
    </div>
  );
}

function OrderCard({ order, onReorder, onCancel }) {
  const STAGES = ['접수', '처리중', '출고완료'];
  const stageIdx = STAGES.indexOf(order.status);
  const items = order.items && order.items.length ? order.items : null;
  const total = order.total || (Number(order.qty || 0) * Number(order.price || 0));

  return (
    <div style={{border:'1px solid #d7d4cf',padding:'24px',marginBottom:18,background:'#fff'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:16,flexWrap:'wrap'}}>
        <div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:22,color:'#111'}}>#{String(order.id).slice(-6)}</div>
          <div style={{fontSize:12,color:'#8c867d',marginTop:2}}>{order.date} {order.reorderOf && '· 재주문'}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {order.status === '접수' && <button type="button" onClick={onCancel} className="adm-btn-sm" style={cancelBtnStyle}>취소</button>}
          <button type="button" onClick={onReorder} className="adm-btn-sm" style={smallBtnStyle}>재주문</button>
        </div>
      </div>

      {/* Status Timeline */}
      <div style={{display:'flex',alignItems:'center',margin:'18px 0',padding:'18px 0',borderTop:'1px solid #f0ede7',borderBottom:'1px solid #f0ede7'}}>
        {STAGES.map((s, i) => (
          <div key={s} style={{flex:1,display:'flex',alignItems:'center'}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,minWidth:60}}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                border: i <= stageIdx ? '1.5px solid #111' : '1.5px solid #d7d4cf',
                background: i <= stageIdx ? '#111' : '#fff',
                color: i <= stageIdx ? '#f6f4f0' : '#b9b5ae',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12
              }}>{i <= stageIdx ? '✓' : (i + 1)}</div>
              <span style={{fontSize:11,letterSpacing:'.04em',color: i <= stageIdx ? '#111' : '#8c867d'}}>{s}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div style={{flex:1,height:1,background: i < stageIdx ? '#111' : '#d7d4cf',marginBottom:18}}></div>
            )}
          </div>
        ))}
      </div>

      {/* Items */}
      <div>
        {items ? (
          <div>
            {items.map((it, i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',fontSize:13,borderBottom: i < items.length - 1 ? '1px dashed #e6e3dd' : 'none'}}>
                <span><span style={{color:'#8c867d',fontSize:11,marginRight:8}}>{it.sku}</span>{it.name}</span>
                <span style={{color:'#6f6b68'}}>{it.qty} × {it.price.toLocaleString('ko')}원</span>
                <span style={{minWidth:90,textAlign:'right',color:'#111',fontWeight:500}}>{(it.qty * it.price).toLocaleString('ko')}원</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{fontSize:13,color:'#4a4744'}}>{order.product} · {order.qty || '-'}{order.qty ? '개' : ''} · 단가 {Number(order.price || 0).toLocaleString('ko')}원</div>
        )}
        {order.note && <p style={{margin:'12px 0 0',padding:'10px 12px',background:'#f6f4f0',fontSize:12,color:'#6f6b68'}}>{order.note}</p>}
      </div>

      <div style={{display:'flex',justifyContent:'space-between',marginTop:16,paddingTop:14,borderTop:'1px solid #f0ede7'}}>
        <span style={{fontSize:11,color:'#8c867d',letterSpacing:'.14em',textTransform:'uppercase'}}>합계</span>
        <span style={{fontFamily:"'Cormorant Garamond',serif",fontStyle:'italic',fontSize:22,color:'#111'}}>{total.toLocaleString('ko')}원</span>
      </div>
    </div>
  );
}

const smallBtnStyle = { padding:'6px 12px', fontSize:11, border:'1px solid #b9b5ae', background:'transparent', cursor:'pointer', fontFamily:'inherit' };
const cancelBtnStyle = { ...smallBtnStyle, color:'#c0392b', borderColor:'#c0392b' };

/* 계정 + 비밀번호 변경 */
function Account({ partner }) {
  const [editing, setEditing] = useState(false);
  const [pw0, setPw0] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');

  // Snyk NoCryptoTimingAttacks: constant-time string compare so an attacker
  // can't leak the partner password byte-by-byte via response-time analysis.
  // (Length-mismatch still leaks length, which is acceptable here — we're
  //  still on legacy in-browser auth, scheduled for removal during Cafe24
  //  migration when Partner login moves server-side under FastAPI + bcrypt.)
  const constantTimeEqual = (a, b) => {
    a = String(a || '');
    b = String(b || '');
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  const submit = (e) => {
    e.preventDefault();
    setMsg('');
    const expected = partner.password || defaultPasswordHint(partner);
    if (!constantTimeEqual(pw0, expected)) return setMsg('현재 비밀번호가 일치하지 않습니다.');
    if (pw1.length < 6) return setMsg('새 비밀번호는 최소 6자 이상이어야 합니다.');
    if (pw1 !== pw2) return setMsg('새 비밀번호가 일치하지 않습니다.');
    if (pw1 === pw0) return setMsg('현재 비밀번호와 다른 값을 입력해주세요.');
    const r = PartnerAuth.changePassword(partner.id, pw1);
    if (r.ok) {
      setMsg('✓ 비밀번호가 변경되었습니다.');
      setPw0(''); setPw1(''); setPw2('');
      setEditing(false);
    } else {
      setMsg('변경 실패: ' + r.reason);
    }
  };

  return (
    <div style={{maxWidth:560,fontSize:13,lineHeight:1.9,color:'#4a4744'}}>
      <h3 style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'#8c867d',margin:'0 0 14px',fontWeight:500}}>계정 정보</h3>
      <dl style={{display:'grid',gridTemplateColumns:'120px 1fr',rowGap:14,columnGap:16,margin:0}}>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>회사명</dt><dd>{partner.name}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>담당자</dt><dd>{partner.person || '-'}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>연락처</dt><dd>{partner.phone || '-'}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>이메일</dt><dd>{partner.email || '-'}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>업종</dt><dd>{partner.type || '-'}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>권한</dt><dd>{partner.role || '-'}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>등록일</dt><dd>{partner.date}</dd>
        <dt style={{color:'#8c867d',fontSize:11,letterSpacing:'.14em',textTransform:'uppercase'}}>비번 변경일</dt><dd>{partner.passwordUpdatedAt ? new Date(partner.passwordUpdatedAt).toLocaleDateString('ko') : '미변경 (초기 비번 사용 중)'}</dd>
      </dl>
      <p style={{marginTop:24,fontSize:12,color:'#8c867d'}}>계정 정보 변경(회사명/연락처 등)은 본사로 문의해주세요. (daemu_office@naver.com)</p>

      <div style={{marginTop:48,paddingTop:24,borderTop:'1px solid #d7d4cf'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <h3 style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'#8c867d',margin:0,fontWeight:500}}>비밀번호 변경</h3>
          {!editing && <button type="button" onClick={() => setEditing(true)} className="adm-btn-sm" style={smallBtnStyle}>변경하기</button>}
        </div>
        {editing && (
          <form onSubmit={submit} style={{display:'grid',gap:14,maxWidth:380}}>
            <div>
              <label style={{display:'block',fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase',marginBottom:6}}>현재 비밀번호</label>
              <input type="password" value={pw0} onChange={(e) => setPw0(e.target.value)} required autoFocus
                style={{width:'100%',padding:10,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit',boxSizing:'border-box'}} />
            </div>
            <div>
              <label style={{display:'block',fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase',marginBottom:6}}>새 비밀번호 (6자 이상)</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required minLength={6}
                style={{width:'100%',padding:10,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit',boxSizing:'border-box'}} />
            </div>
            <div>
              <label style={{display:'block',fontSize:11,letterSpacing:'.14em',color:'#6f6b68',textTransform:'uppercase',marginBottom:6}}>새 비밀번호 확인</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6}
                style={{width:'100%',padding:10,border:'1px solid #ccc',borderRadius:4,fontSize:14,fontFamily:'inherit',boxSizing:'border-box'}} />
            </div>
            {msg && <p style={{fontSize:12,color: msg.startsWith('✓') ? '#2e7d32' : '#c0392b',margin:0}}>{msg}</p>}
            <div style={{display:'flex',gap:10}}>
              <button type="submit" className="btn">변경 완료</button>
              <button type="button" onClick={() => { setEditing(false); setMsg(''); setPw0(''); setPw1(''); setPw2(''); }} className="adm-btn-sm" style={smallBtnStyle}>취소</button>
            </div>
          </form>
        )}
        {!editing && msg && <p style={{fontSize:12,color: msg.startsWith('✓') ? '#2e7d32' : '#c0392b',margin:0}}>{msg}</p>}
      </div>
    </div>
  );
}

/* ─────────────── 뉴스레터 구독 (Public CTA) ─────────────── */

function NewsletterCTA() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ kind: '', text: '' });
    if (!consent) {
      setStatus({ kind: 'err', text: '개인정보 수집·이용 동의가 필요합니다.' });
      return;
    }
    setLoading(true);
    try {
      if (api.isConfigured()) {
        const r = await api.post('/api/newsletter/subscribe', {
          email: email.trim(), name: name.trim(),
          source: 'partners-page', privacy_consent: true,
        });
        if (r.ok) {
          setStatus({ kind: 'ok', text: r.already ? '이미 구독 중인 이메일입니다.' : '구독이 완료되었습니다. 새 소식을 보내드릴게요.' });
          setEmail(''); setName(''); setConsent(false);
        } else if (r.status === 429) {
          setStatus({ kind: 'err', text: '구독 시도가 너무 빠르게 발생했습니다. 잠시 후 다시 시도해 주세요.' });
        } else {
          setStatus({ kind: 'err', text: r.error || '구독에 실패했습니다.' });
        }
      } else {
        // Demo mode — write to localStorage so admin Campaign page picks it up.
        const subs = DB.get('subscribers');
        const lower = email.trim().toLowerCase();
        if (subs.find((s) => (s.email || '').toLowerCase() === lower)) {
          setStatus({ kind: 'ok', text: '이미 구독 중인 이메일입니다.' });
        } else {
          DB.add('subscribers', { email: lower, name: name.trim(), status: '활성', source: 'partners-page' });
          setStatus({ kind: 'ok', text: '구독이 완료되었습니다. (데모 모드 — localStorage 저장)' });
          setEmail(''); setName(''); setConsent(false);
        }
      }
    } catch (err) {
      setStatus({ kind: 'err', text: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="partners-section-block" style={{ background: '#f6f4f0' }}>
      <div className="wide">
        <h3 className="partners-section-title">뉴스레터 구독</h3>
        <p className="partners-section-sub">Newsletter</p>
        <p style={{ maxWidth: 620, color: '#5f5b57', fontSize: 14, lineHeight: 1.7, margin: '0 auto 22px', textAlign: 'center' }}>
          신규 매장 오픈 소식, 시즌 메뉴 공개, 컨설팅 인사이트를 이메일로 보내드립니다.<br />
          언제든지 수신 거부할 수 있습니다.
        </p>
        <form onSubmit={submit}
          style={{ maxWidth: 540, margin: '0 auto', display: 'grid', gap: 10 }}>
          <input type="text" placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', padding: 12, border: '1px solid #d7d4cf', background: '#fff', borderRadius: 4, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <input type="email" placeholder="이메일 주소" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ width: '100%', padding: 12, border: '1px solid #d7d4cf', background: '#fff', borderRadius: 4, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#6f6b68', lineHeight: 1.6 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: 3 }} />
            <span>(필수) 개인정보 수집·이용에 동의합니다. 수집 항목: 이메일, 이름. 보유기간: 구독 해제 시까지. 자세한 내용은 <a href="/privacy" style={{ color: '#231815', textDecoration: 'underline' }}>개인정보 처리방침</a>을 확인해 주세요.</span>
          </label>
          <button type="submit" className="btn" disabled={loading}
            style={{ marginTop: 4 }}>{loading ? '처리 중…' : '구독 신청'}</button>
          {status.text && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: status.kind === 'ok' ? '#2e7d32' : '#c0392b' }}>
              {status.text}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
