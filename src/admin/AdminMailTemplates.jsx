// 메일 템플릿 라이브러리.
//
// 기존 /admin/mail 은 "상담 자동회신" 단일 템플릿입니다. 이 페이지는 그와
// 별개로 운영자가 *여러 개* 템플릿을 저장해두고 단체 발송, 1:1 발송,
// 캠페인 등에서 재사용할 수 있게 합니다.
//
// 데이터: localStorage 'daemu_mail_templates' — 형태:
//   [{ id, name, category, subject, body, variables, active, updatedAt }]
//
// 향후 backend 연결 시 같은 형태로 mail_template_lib 테이블에 흡수됩니다
// (B1 모델: backend-py/models.py 의 MailTemplateLib).
//
// 단체 발송 UI 는 동일 페이지 하단의 "단체 발송" 패널에 있습니다.
// 실제 발송은 RESEND_API_KEY 가 백엔드에 등록된 후 활성화됩니다 — 그 전까지는
// outbox simulation 으로만 기록됩니다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { downloadCSV } from '../lib/csv.js';
import { api } from '../lib/api.js';
import { isEmailEnabled } from '../lib/email.js';
import { safeMediaUrl, validateOutboundUrl } from '../lib/safe.js';
import { siteAlert, siteConfirm, sitePrompt, siteToast } from '../lib/dialog.js';
import { DB } from '../lib/db.js';
import { renderInlineMarkdown, renderMailBody } from '../components/MailBodyRenderer.jsx';
import MailTemplatesGuide from './MailTemplatesGuide.jsx';
import { GuideButton } from './PageGuides.jsx';

const STORAGE_KEY = 'daemu_mail_templates';

const CATEGORIES = [
  { value: 'general', label: '일반' },
  { value: 'newsletter', label: '뉴스레터' },
  { value: 'event', label: '이벤트/공지' },
  { value: 'partner', label: '파트너 안내' },
  { value: 'reply', label: '회신/안내' },
];

function readTemplates() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveTemplates(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('daemu-db-change'));
}
function nextId(list) {
  return list.length ? Math.max(...list.map((x) => Number(x.id) || 0)) + 1 : 1;
}

// 첫 진입 시 자동 시드되는 기본 템플릿 5종.
// 이미 같은 이름이 있으면 건드리지 않습니다(idempotent).
const SEED_TEMPLATES = [
  {
    name: '신규 파트너 환영',
    category: 'partner',
    subject: '[대무] {{이름}}님, 파트너 등록을 환영합니다',
    body:
`안녕하세요 {{이름}}님,

대무 파트너로 등록해 주셔서 감사합니다.
지금부터 발주 포털을 통해 다음 기능을 사용하실 수 있습니다:

  · 표준 카탈로그 발주
  · 발주 진행 상태 실시간 확인
  · 계약서·발주서 e-Sign 서명 및 사본 다운로드

문의 사항은 본 메일에 회신해 주세요.

대무 (DAEMU)
daemu_office@naver.com · 061-335-1239`,
    active: true,
  },
  {
    name: '발주 처리 안내',
    category: 'reply',
    subject: '[대무] {{발주번호}} 발주가 접수되었습니다',
    body:
`안녕하세요 {{이름}}님,

요청하신 발주 {{발주번호}} 가 정상 접수되었습니다.

  · 접수일: {{접수일}}
  · 예정 출고: {{출고예정일}}
  · 합계: {{합계금액}}

진행 상태는 파트너 포털에서 실시간 확인 가능합니다.
변경 또는 취소가 필요하시면 출고 1영업일 전까지 연락 주세요.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '뉴스레터 — 시즌 메뉴',
    category: 'newsletter',
    subject: '[대무] {{이름}}님께 보내는 이번 시즌 추천 메뉴',
    body:
`안녕하세요 {{이름}}님,

대무가 새로 큐레이션한 이번 시즌 메뉴를 소개드립니다.

![](https://juyoungjun.github.io/daemu-website/assets/work-croissants.png)

  · 봄 시그니처 — 딸기 크렘 다누아즈
  · 한정 베이커리 — 무화과 크림 브리오슈
  · 시즌 음료 — 로즈 라떼

자세한 레시피 노트와 도입 사례는 [메뉴 상세 보기]({{상세링크}}) 에서 확인하실 수 있습니다.

수신을 원치 않으시면 본 메일 하단의 수신거부 링크를 이용해 주세요.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '미팅 일정 안내',
    category: 'general',
    subject: '[대무] {{이름}}님과의 미팅 일정 확인',
    body:
`안녕하세요 {{이름}}님,

요청하신 미팅 일정을 아래와 같이 조정했습니다.

  · 일시: {{일시}}
  · 장소: {{장소}}
  · 참석자: {{참석자}}
  · 안건: {{안건}}

변경이 필요하시면 1영업일 전까지 회신 부탁드립니다.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '이벤트/공지 안내',
    category: 'event',
    subject: '[대무] {{이벤트명}} 안내',
    body:
`안녕하세요 {{이름}}님,

{{이벤트명}} 을 다음과 같이 진행합니다.

  · 일정: {{시작일}} ~ {{종료일}}
  · 대상: {{대상}}
  · 혜택: {{혜택}}

자세한 내용은 아래에서 확인하실 수 있습니다.
{{상세링크}}

대무 (DAEMU)`,
    active: true,
  },
  // ── 운영 변동 대응용 템플릿 ───────────────────────────────────────
  {
    name: '발주 마감 시간 안내 (정기)',
    category: 'partner',
    subject: '[대무] {{이름}}님, 발주 마감 시간 안내',
    body:
`안녕하세요 {{이름}}님,

대무 발주 운영 시간을 안내드립니다.

  · 평일 발주 마감: 매일 {{마감시간}} (이후 접수분은 다음 영업일 처리)
  · 주말·공휴일: 발주 접수 불가 → 다음 영업일 자동 처리
  · 긴급 발주: {{긴급연락처}} 로 직접 연락 부탁드립니다

마감 후 접수된 건은 자동으로 다음 영업일에 처리되어 출고일이 1일 미뤄질 수 있습니다.
양해 부탁드립니다.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '공휴일·연휴 발주 휴무 안내',
    category: 'partner',
    subject: '[대무] {{이름}}님, {{휴무명}} 발주 휴무 안내',
    body:
`안녕하세요 {{이름}}님,

{{휴무명}} 으로 인해 다음 기간 동안 발주 접수가 중단됩니다.

  · 휴무 기간: {{시작일}} ~ {{종료일}}
  · 정상 운영 재개: {{재개일}}
  · 마지막 출고일: {{마지막출고일}}
  · 첫 출고 재개일: {{첫출고일}}

휴무 전 미리 발주가 필요하신 분은 {{사전마감일}} 까지 접수 부탁드립니다.
긴급 사항은 {{긴급연락처}} 로 연락 부탁드립니다.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '택배사 사정 — 배송 지연 안내',
    category: 'reply',
    subject: '[대무] {{이름}}님 발주 {{발주번호}} — 택배사 사정으로 배송 지연',
    body:
`안녕하세요 {{이름}}님,

{{발주번호}} 발주 건의 배송이 택배사 사정으로 지연되고 있어 안내드립니다.

  · 사유: {{지연사유}}
  · 영향 지역: {{영향지역}}
  · 예상 지연 기간: {{예상지연}}
  · 변경된 도착 예상일: {{변경도착예정일}}

택배사 운영이 정상화되는 즉시 출고가 진행됩니다.
긴급한 상품의 경우 {{긴급연락처}} 로 연락 부탁드리며, 가능한 범위 내에서 대안을 안내드리겠습니다.

대무 (DAEMU)
daemu_office@naver.com · 061-335-1239`,
    active: true,
  },
  {
    name: '발주 일시 중단 — 시스템·재고',
    category: 'partner',
    subject: '[대무] {{이름}}님, 발주 일시 중단 안내 ({{사유}})',
    body:
`안녕하세요 {{이름}}님,

{{사유}} 으로 인해 발주 접수가 일시 중단됩니다.

  · 중단 기간: {{시작일}} ~ {{종료일}}
  · 영향 상품: {{영향상품}}
  · 복구 예정 시점: {{복구예정}}
  · 정상 처리 재개일: {{재개일}}

이 기간 중 접수된 발주는 시스템상 처리가 지연될 수 있어 정상화 후 일괄 처리됩니다.
이미 진행 중인 발주는 정상 출고됩니다.

불편을 드려 죄송하며, 빠른 정상화를 위해 노력하겠습니다.

대무 (DAEMU)`,
    active: true,
  },
  {
    name: '발주 정상 재개 안내',
    category: 'partner',
    subject: '[대무] {{이름}}님, 발주 정상 재개 — {{재개일}}',
    body:
`안녕하세요 {{이름}}님,

{{사유}} 으로 일시 중단되었던 발주가 정상 재개됨을 안내드립니다.

  · 재개일: {{재개일}}
  · 첫 정상 출고일: {{첫출고일}}

중단 기간 동안 미처리된 발주분은 {{재처리일}} 부터 순차적으로 처리됩니다.
지속된 협조에 감사드리며, 빠른 정상 운영으로 보답하겠습니다.

대무 (DAEMU)`,
    active: true,
  },
];

function ensureSeedTemplates() {
  const current = readTemplates();
  const existingNames = new Set(current.map((t) => (t.name || '').trim()));
  const toAdd = SEED_TEMPLATES.filter((t) => !existingNames.has(t.name));
  if (!toAdd.length) return current;
  const now = new Date().toISOString();
  let nid = nextId(current);
  const seeded = toAdd.map((t) => ({ ...t, id: nid++, createdAt: now, updatedAt: now }));
  const next = [...current, ...seeded];
  saveTemplates(next);
  return next;
}

// {{var_name}} 자리표시자 추출. 한글 변수명도 허용.
const VAR_RE = /\{\{\s*([^\s{}]+?)\s*\}\}/g;
function extractVariables(text) {
  const set = new Set();
  let m;
  const re = new RegExp(VAR_RE.source, 'g');
  while ((m = re.exec(text || ''))) set.add(m[1]);
  return [...set];
}
function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(new RegExp(VAR_RE.source, 'g'),
    (_, name) => (vars && Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : '{{' + name + '}}'));
}

// renderInlineMarkdown / renderMailBody / MD_TOKEN_RE 는 모두
// src/components/MailBodyRenderer.jsx 로 분리됨 (Snyk DOM-XSS taint
// break + img src 추가 encodeURI sanitizer). import 만 사용.

export default function AdminMailTemplates() {
  const [templates, setTemplates] = useState(() => ensureSeedTemplates());
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [activePreview, setActivePreview] = useState(null);

  useEffect(() => {
    const refresh = () => setTemplates(readTemplates());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return templates;
    return templates.filter((t) => t.category === filter);
  }, [templates, filter]);

  const upsert = (form) => {
    if (!form.name?.trim()) { siteAlert('템플릿 이름을 입력하세요.'); return; }
    if (!form.subject?.trim()) { siteAlert('메일 제목을 입력하세요.'); return; }
    const next = [...templates];
    const now = new Date().toISOString();
    if (form.id) {
      const i = next.findIndex((x) => x.id === form.id);
      if (i >= 0) next[i] = { ...next[i], ...form, updatedAt: now };
    } else {
      next.push({ ...form, id: nextId(next), createdAt: now, updatedAt: now });
    }
    setTemplates(next);
    saveTemplates(next);
    setEditing(null);
    setCreating(false);
  };

  const remove = async (id) => {
    const ok = await siteConfirm('이 템플릿을 삭제하시겠습니까?');
    if (!ok) return;
    const next = templates.filter((x) => x.id !== id);
    setTemplates(next);
    saveTemplates(next);
  };

  const duplicate = (id) => {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const copy = { ...tpl, id: nextId(templates), name: tpl.name + ' (복사본)', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const next = [...templates, copy];
    setTemplates(next);
    saveTemplates(next);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">메일 템플릿 라이브러리</h1>

          <GuideButton GuideComponent={MailTemplatesGuide} />

          <AdminHelp title="메일 템플릿 사용 안내" items={[
            '여기서 저장한 템플릿은 단체 메일 발송, 캠페인, 1:1 안내 메일 등에서 재사용됩니다.',
            '본문에 {{이름}} 같은 자리표시자(variable)를 넣으면 발송 시 수신자별로 자동 치환됩니다.',
            '템플릿 카테고리(일반/뉴스레터/이벤트/파트너/회신)는 검색·필터에만 쓰이고 발송 동작에는 영향 없습니다.',
            '실제 메일 발송은 RESEND_API_KEY 가 백엔드에 등록되어 있을 때 진행됩니다. 미등록 상태에서는 모든 발송이 Outbox 에 simulated 로 기록됩니다.',
            '"상담 자동회신"(/admin/mail) 과는 다른 페이지입니다 — 자동회신은 별도 단일 템플릿으로 운영됩니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 18px' }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>전체 {templates.length}</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
              <option value="">전체 카테고리</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm"
              onClick={() => downloadCSV(
                'daemu-mail-templates-' + new Date().toISOString().slice(0, 10) + '.csv',
                templates,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'name', label: '이름' },
                  { key: (t) => CATEGORIES.find((c) => c.value === t.category)?.label || t.category, label: '카테고리' },
                  { key: 'subject', label: '제목' },
                  { key: (t) => extractVariables(t.subject + ' ' + t.body).join(' | '), label: '변수' },
                  { key: 'updatedAt', label: '수정일' },
                ],
              )}>CSV 내보내기</button>
            <button type="button" className="btn" onClick={() => setCreating(true)}>+ 새 템플릿</button>
          </div>

          {!filtered.length ? (
            <div className="adm-doc-empty">
              <strong>저장된 템플릿이 없습니다</strong>
              상단 <em>+ 새 템플릿</em> 으로 첫 메일 템플릿을 만들어보세요.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {filtered.map((t) => {
                const vars = extractVariables(t.subject + ' ' + t.body);
                return (
                  <div key={t.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: '16px 20px' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span className="adm-doc-pill" style={{ borderColor: '#1f5e7c', color: '#1f5e7c', fontSize: 10 }}>
                            {CATEGORIES.find((c) => c.value === t.category)?.label || '일반'}
                          </span>
                          <strong style={{ fontSize: 14, color: '#231815' }}>{t.name}</strong>
                        </div>
                        <div style={{ fontSize: 12, color: '#5a534b', marginBottom: 4 }}>
                          <strong style={{ color: '#8c867d', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginRight: 6 }}>제목</strong>
                          {t.subject}
                        </div>
                        {vars.length > 0 && (
                          <div style={{ fontSize: 11, color: '#8c867d' }}>
                            <strong style={{ marginRight: 6 }}>변수:</strong>
                            {vars.map((v) => <code key={v} style={{ background: '#f6f4f0', padding: '2px 6px', marginRight: 4, fontSize: 10.5 }}>{`{{${v}}}`}</code>)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button type="button" className="adm-btn-sm" onClick={() => setActivePreview(t)}>미리보기</button>
                        <button type="button" className="adm-btn-sm" onClick={() => setEditing(t)}>수정</button>
                        <button type="button" className="adm-btn-sm" onClick={() => duplicate(t.id)}>복사</button>
                        <button type="button" className="adm-btn-sm danger" onClick={() => remove(t.id)}>삭제</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="admin-section-title" style={{ marginTop: 36 }}>단체 발송</h3>
          <BulkSendPanel templates={templates} />

          {(editing || creating) && (
            <TemplateEditor
              data={editing}
              onClose={() => { setEditing(null); setCreating(false); }}
              onSave={upsert}
            />
          )}
          {activePreview && (
            <TemplatePreviewModal template={activePreview} onClose={() => setActivePreview(null)} />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

// 메일 템플릿에서 자주 쓰이는 미리 정의된 변수 목록.
// 운영자가 이 chip 을 누르면 본문 커서 위치에 {{변수명}} 이 자동 삽입됩니다.
// 자동회신(/admin/mail) 의 변수 패널과 같은 사용성으로 통일.
//
// `group` 으로 분류해 chip 패널에서 시각적으로 그루핑됩니다 — 너무 많은
// 변수가 한 줄에 흩어지면 운영자가 찾기 어렵기 때문.
const COMMON_VARIABLES = [
  // 수신자 정보
  { name: '이름',       label: '수신자 이름',     group: '수신자' },
  { name: '이메일',     label: '수신자 이메일',   group: '수신자' },
  { name: '전화',       label: '연락처',          group: '수신자' },
  { name: '회사',       label: '회사/브랜드',     group: '수신자' },
  // 발주·배송
  { name: '발주번호',   label: '발주/계약 번호',  group: '발주' },
  { name: '접수일',     label: '접수 일자',       group: '발주' },
  { name: '출고예정일', label: '출고 예정일',     group: '발주' },
  { name: '합계금액',   label: '합계 금액',       group: '발주' },
  { name: '마감시간',   label: '발주 마감 시간',  group: '발주' },
  { name: '긴급연락처', label: '긴급 연락처',     group: '발주' },
  // 일정·미팅
  { name: '일시',       label: '미팅·이벤트 일시', group: '일정' },
  { name: '장소',       label: '미팅 장소',       group: '일정' },
  { name: '참석자',     label: '참석자',          group: '일정' },
  { name: '안건',       label: '미팅 안건',       group: '일정' },
  // 이벤트/공지
  { name: '이벤트명',   label: '이벤트/공지명',   group: '이벤트' },
  { name: '시작일',     label: '시작일',          group: '이벤트' },
  { name: '종료일',     label: '종료일',          group: '이벤트' },
  { name: '대상',       label: '대상',            group: '이벤트' },
  { name: '혜택',       label: '혜택/내용',       group: '이벤트' },
  // 운영 변동 (휴무·지연·중단 등)
  { name: '휴무명',     label: '휴무명 (예: 추석)', group: '운영변동' },
  { name: '재개일',     label: '운영 재개일',     group: '운영변동' },
  { name: '마지막출고일', label: '휴무 전 마지막 출고일', group: '운영변동' },
  { name: '첫출고일',   label: '재개 후 첫 출고일', group: '운영변동' },
  { name: '사전마감일', label: '사전 발주 마감일', group: '운영변동' },
  { name: '사유',       label: '중단/지연 사유',  group: '운영변동' },
  { name: '지연사유',   label: '배송 지연 사유',  group: '운영변동' },
  { name: '영향지역',   label: '영향 지역',       group: '운영변동' },
  { name: '영향상품',   label: '영향 상품',       group: '운영변동' },
  { name: '예상지연',   label: '예상 지연 기간',  group: '운영변동' },
  { name: '변경도착예정일', label: '변경된 도착 예정일', group: '운영변동' },
  { name: '복구예정',   label: '복구 예정 시점',  group: '운영변동' },
  { name: '재처리일',   label: '미처리분 재처리일', group: '운영변동' },
  // 링크
  { name: '상세링크',   label: '상세 페이지 URL', group: '링크' },
];

const VARIABLE_GROUPS = ['수신자', '발주', '일정', '이벤트', '운영변동', '링크'];

function TemplateEditor({ data, onClose, onSave }) {
  const [form, setForm] = useState({
    id: data?.id,
    name: data?.name || '',
    category: data?.category || 'general',
    subject: data?.subject || '',
    body: data?.body || '',
    active: data?.active !== false,
  });
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [activeField, setActiveField] = useState('body'); // 'subject' | 'body'
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const vars = extractVariables(form.subject + ' ' + form.body);

  // 활성 필드(제목/본문)의 커서 위치에 토큰 삽입.
  // 변수 chip 은 제목·본문 어디든 마지막으로 포커스된 곳에 들어가게 함.
  const insertAtCursor = (insertion, fieldOverride) => {
    const field = fieldOverride || activeField;
    const ta = field === 'subject' ? subjectRef.current : bodyRef.current;
    const key = field === 'subject' ? 'subject' : 'body';
    if (!ta) {
      setForm((f) => ({ ...f, [key]: (f[key] || '') + insertion }));
      return;
    }
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const value = ta.value;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const newValue = before + insertion + after;
    setForm((f) => ({ ...f, [key]: newValue }));
    setTimeout(() => {
      try {
        ta.focus();
        const pos = start + insertion.length;
        ta.setSelectionRange(pos, pos);
      } catch { /* ignore */ }
    }, 0);
  };

  const onInsertImage = async () => {
    if (!window.openMediaPicker) {
      siteAlert('미디어 라이브러리를 사용할 수 없습니다.');
      return;
    }
    const url = await window.openMediaPicker({ kind: 'image', allowUpload: true });
    if (!url) return;
    const safe = safeMediaUrl(url);
    if (!safe) {
      siteAlert('선택한 이미지 URL 이 안전하지 않아 삽입을 취소했습니다.');
      return;
    }
    insertAtCursor(`\n![](${String(safe)})\n`, 'body');
  };

  const onInsertLink = async () => {
    const raw = await sitePrompt('링크 URL 을 입력하세요 (https://...)', '', { placeholder: 'https://daemu.kr/page', required: true });
    if (!raw) return;
    const safe = validateOutboundUrl(raw);
    if (!safe) {
      siteAlert('허용되지 않은 URL 입니다 (http/https/mailto/tel 만 가능).');
      return;
    }
    const text = (await sitePrompt('링크 텍스트 (눌렀을 때 보일 글자)', '자세히 보기', { placeholder: '예: 자세히 보기' })) || '자세히 보기';
    insertAtCursor(`[${text}](${String(safe)})`);
  };

  // 클릭 가능한 이미지 — 이미지 + 링크를 하나의 마크다운 토큰으로 삽입.
  // 1) 미디어 라이브러리에서 이미지 선택 → 2) 클릭 시 이동할 URL 입력 →
  //    [![alt](img)](href) 형태로 본문에 삽입. 메일 클라이언트에서
  //    이미지를 클릭하면 그 URL 로 이동.
  const onInsertImageLink = async () => {
    if (!window.openMediaPicker) {
      siteAlert('미디어 라이브러리를 사용할 수 없습니다.');
      return;
    }
    const imgUrl = await window.openMediaPicker({ kind: 'image', allowUpload: true });
    if (!imgUrl) return;
    const safeImg = safeMediaUrl(imgUrl);
    if (!safeImg) {
      siteAlert('선택한 이미지 URL 이 안전하지 않아 삽입을 취소했습니다.');
      return;
    }
    const linkRaw = await sitePrompt('이미지를 클릭했을 때 이동할 URL', '', {
      placeholder: 'https://daemu.kr/event/2026-spring',
      required: true,
    });
    if (!linkRaw) return;
    const safeLink = validateOutboundUrl(linkRaw);
    if (!safeLink) {
      siteAlert('허용되지 않은 URL 입니다 (http/https/mailto/tel 만 가능).');
      return;
    }
    const alt = (await sitePrompt('이미지 설명(alt) — 안 보일 수도 있을 때 대체 텍스트', '', {
      placeholder: '예: 봄 이벤트 배너',
    })) || '';
    insertAtCursor(`\n[![${alt}](${String(safeImg)})](${String(safeLink)})\n`, 'body');
  };

  const onInsertCustomVariable = async () => {
    const name = await sitePrompt('변수 이름을 입력하세요 (예: 직책, 첨부파일명)', '', { placeholder: '한글·영문 모두 가능', required: true });
    if (!name) return;
    const clean = String(name).trim().replace(/[\s{}]/g, '');
    if (!clean) return;
    insertAtCursor(`{{${clean}}}`);
  };

  // 미리 정의된 변수 chip 클릭 — 마지막으로 포커스된 필드에 삽입.
  const onInsertCommonVariable = (varName) => {
    insertAtCursor(`{{${varName}}}`);
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>{data ? '템플릿 수정' : '새 메일 템플릿'}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(140px, 28%, 200px)', gap: 10 }}>
            <Field label="템플릿 이름">
              <input type="text" value={form.name} onChange={set('name')} placeholder="예: 봄맞이 신메뉴 안내" required />
            </Field>
            <Field label="카테고리">
              <select value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="메일 제목">
            <input ref={subjectRef} type="text" value={form.subject} onChange={set('subject')}
              onFocus={() => setActiveField('subject')}
              placeholder="예: [대무] {{이름}}님께 신메뉴 소식" required />
          </Field>

          {/* 변수 chip 패널 — 자동회신(/admin/mail) 과 같은 사용성.
              마지막으로 포커스된 필드(제목/본문)에 클릭한 변수가 들어감.
              그룹별로 시각 구분해 운영자가 빠르게 찾을 수 있게 정리. */}
          <div style={{ background: '#f6f4f0', border: '1px solid #e6e3dd', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>
              변수 (클릭하면 {activeField === 'subject' ? '제목' : '본문'} 의 커서 위치에 삽입됩니다)
            </div>
            {VARIABLE_GROUPS.map((groupName) => {
              const items = COMMON_VARIABLES.filter((v) => v.group === groupName);
              if (!items.length) return null;
              return (
                <div key={groupName} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {groupName}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {items.map((v) => (
                      <button key={v.name} type="button"
                        className="adm-mail-var-item"
                        onClick={() => onInsertCommonVariable(v.name)}
                        title={v.label}
                        style={{
                          display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
                          background: '#fff', border: '1px solid #d7d4cf', padding: '4px 10px',
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                          transition: 'all .15s ease',
                        }}>
                        <code style={{ background: 'transparent', fontSize: 11.5, color: '#1f5e7c' }}>{`{{${v.name}}}`}</code>
                        <span style={{ fontSize: 10.5, color: '#8c867d' }}>{v.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button type="button" className="adm-btn-sm" onClick={onInsertCustomVariable}
              style={{ marginTop: 4 }}>
              + 사용자 정의 변수
            </button>
            <div style={{ fontSize: 11, color: '#8c867d', marginTop: 8 }}>
              발송 시 수신자 데이터의 같은 이름 필드 값으로 자동 치환됩니다. (소스에 없는 변수는 위 단체 발송 패널에서 일괄 기본값 입력)
            </div>
          </div>

          <div>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 6, flexWrap: 'wrap', gap: 6,
            }}>
              <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>본문</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button type="button" className="adm-btn-sm" onClick={onInsertImage}>+ 이미지</button>
                <button type="button" className="adm-btn-sm" onClick={onInsertImageLink}>+ 클릭 가능한 이미지</button>
                <button type="button" className="adm-btn-sm" onClick={onInsertLink}>+ 텍스트 링크</button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#5a534b', marginLeft: 8 }}>
                  <input type="checkbox" checked={showLivePreview} onChange={(e) => setShowLivePreview(e.target.checked)} />
                  실시간 미리보기
                </label>
              </div>
            </div>
            <textarea ref={bodyRef} rows={14} value={form.body} onChange={set('body')}
              onFocus={() => setActiveField('body')}
              placeholder={'안녕하세요 {{이름}}님,\n\n대무가 새로 출시한 봄 메뉴를 소개드립니다.\n\n(상단 변수 chip 으로 {{이름}}, {{발주번호}} 등을 삽입할 수 있습니다.)\n\n위 + 이미지 삽입 버튼으로 미디어 라이브러리에서 사진을 추가하세요.\n\n대무 드림'}
              style={{ fontFamily: 'inherit', lineHeight: 1.7, width: '100%' }} />
            <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>
              · 이미지: 위 <strong>+ 이미지</strong> → 라이브러리에서 선택<br/>
              · 클릭 가능한 이미지(배너): 위 <strong>+ 클릭 가능한 이미지</strong> → 이미지 + 이동 URL<br/>
              · 텍스트 링크: 위 <strong>+ 텍스트 링크</strong> → URL/텍스트 입력<br/>
              · 변수: 위 변수 chip 클릭 또는 <strong>+ 사용자 정의 변수</strong>
            </div>
          </div>

          {showLivePreview && (
            <div>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>
                본문 미리보기 (변수는 자리표시자 그대로 표시)
              </div>
              <div style={{
                background: '#fff', border: '1px solid #d7d4cf', padding: 18,
                fontSize: 13.5, lineHeight: 1.85, color: '#2a2724',
                maxHeight: 360, overflowY: 'auto',
              }}>
                {form.body.trim()
                  ? renderMailBody(form.body)
                  : <span style={{ color: '#b9b5ae', fontStyle: 'italic' }}>(본문이 비어있습니다)</span>}
              </div>
            </div>
          )}

          {vars.length > 0 && (
            <div style={{ fontSize: 12, color: '#5a534b', background: '#fff8ec', padding: 10, borderLeft: '3px solid #c9a25a' }}>
              <strong style={{ marginRight: 6 }}>인식된 변수:</strong>
              {vars.map((v) => <code key={v} style={{ background: '#fff', padding: '2px 8px', marginRight: 4, fontSize: 11 }}>{`{{${v}}}`}</code>)}
              <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>발송 시 수신자 데이터에서 자동 치환됩니다.</div>
            </div>
          )}
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => onSave(form)}>저장</button>
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ template, onClose }) {
  const vars = extractVariables(template.subject + ' ' + template.body);
  const [sample, setSample] = useState(() => {
    const obj = {};
    vars.forEach((v) => { obj[v] = ''; });
    obj['이름'] = obj['이름'] || '홍길동';
    obj['name'] = obj['name'] || 'Hong Gildong';
    return obj;
  });
  const renderedSubject = applyVars(template.subject, sample);
  const renderedBodyText = applyVars(template.body, sample);

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>미리보기 — {template.name}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        {vars.length > 0 && (
          <div style={{ background: '#fff8ec', padding: 12, borderLeft: '3px solid #c9a25a', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>샘플 값 (수신자별로 치환될 자리)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {vars.map((v) => (
                <label key={v} style={{ fontSize: 12, color: '#5a534b' }}>
                  <span style={{ display: 'block', marginBottom: 2, fontFamily: 'monospace' }}>{`{{${v}}}`}</span>
                  <input type="text" value={sample[v] || ''}
                    onChange={(e) => setSample((s) => ({ ...s, [v]: e.target.value }))}
                    style={{ width: '100%' }} />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 메일 클라이언트와 비슷한 폭으로 frame 처리 — 실제 발송 시 대략 이렇게 보임 */}
        <div style={{
          background: '#f4f1ea', padding: 16, border: '1px solid #d7d4cf',
          borderRadius: 4,
        }}>
          <div style={{
            background: '#fff', border: '1px solid #e6e3dd',
            maxWidth: 640, margin: '0 auto', padding: '24px 28px',
            boxShadow: '0 1px 3px rgba(0,0,0,.04)',
          }}>
            <div style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>From</div>
            <div style={{ fontSize: 12, color: '#5a534b', marginBottom: 12 }}>대무 (DAEMU) &lt;noreply@daemu.kr&gt;</div>
            <div style={{ fontSize: 10, color: '#8c867d', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>제목</div>
            <h3 style={{ fontSize: 16, color: '#231815', margin: '0 0 18px', fontWeight: 600 }}>{renderedSubject}</h3>
            <div style={{ borderTop: '1px solid #e6e3dd', paddingTop: 16, fontSize: 13.5, color: '#2a2724', lineHeight: 1.85, wordBreak: 'keep-all' }}>
              {renderedBodyText.trim()
                ? renderMailBody(renderedBodyText)
                : <span style={{ color: '#b9b5ae', fontStyle: 'italic' }}>(본문이 비어있습니다)</span>}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#8c867d', marginTop: 10, textAlign: 'center' }}>
          실제 발송 시 수신자별 변수가 치환되며, 이미지·링크는 위와 같이 렌더링됩니다.
        </p>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// 통화 포맷 — 발주/문서의 합계금액을 한국 원화 표기로 자동 변환.
function formatKRW(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return n.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + '원';
}
// 날짜 포맷 — ISO/Date 객체를 YYYY-MM-DD 로.
function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  } catch { return String(value); }
}

// 데이터 소스별 레코드 → 템플릿 변수 매핑 정의.
// fieldMap 의 값은 string 또는 (record) => string 함수. 함수면 통화/날짜 포맷
// 등 가공된 결과를 변수로 사용한다.
const DATA_SOURCES = [
  {
    key: 'manual',
    label: '직접 입력',
    fetch: () => [],
    fieldMap: {},
  },
  {
    key: 'crm',
    label: 'CRM 고객',
    fetch: () => DB.get('crm') || [],
    fieldMap: {
      '이름': 'name',
      '이메일': 'email',
      '전화': 'phone',
      '회사': 'company',
    },
  },
  {
    key: 'partners',
    label: '파트너사',
    fetch: () => DB.get('partners') || [],
    fieldMap: {
      '이름': 'person',
      '이메일': 'email',
      '전화': 'phone',
      '회사': 'name',
    },
  },
  {
    key: 'inquiries',
    label: '문의자',
    fetch: () => DB.get('inquiries') || [],
    fieldMap: {
      '이름': 'name',
      '이메일': 'email',
      '전화': 'phone',
    },
  },
  {
    key: 'subscribers',
    label: '뉴스레터 구독자',
    fetch: () => DB.get('subscribers') || [],
    fieldMap: {
      '이름': 'name',
      '이메일': 'email',
    },
  },
  {
    // 발주 — 발주 행을 파트너 이메일로 연결해 발주번호/접수일/합계 등을
    // 자동 채운다. 배송 안내·재발주·발주 마감 안내 메일에 적합.
    key: 'orders',
    label: '발주 (파트너에게 전송)',
    fetch: () => {
      const orders = DB.get('orders') || [];
      const partners = DB.get('partners') || [];
      const partnerByName = Object.fromEntries(partners.map((p) => [String(p.name || '').trim(), p]));
      return orders.map((o) => {
        const p = partnerByName[String(o.partner || '').trim()] || {};
        const total = Number.isFinite(Number(o.amount))
          ? Number(o.amount)
          : Number(o.qty || 0) * Number(o.price || 0);
        return {
          id: o.id,
          email: p.email || '',
          person: p.person || o.partner,
          phone: p.phone || '',
          company: o.partner || p.name || '',
          order_no: '#' + String(o.id || '').slice(-6),
          order_date: o.date || o.created_at,
          due_date: o.due_date,
          product: o.product || o.title || '',
          qty: o.qty,
          price: o.price,
          total,
          status: o.status,
        };
      });
    },
    fieldMap: {
      '이름': 'person',
      '이메일': 'email',
      '전화': 'phone',
      '회사': 'company',
      '발주번호': 'order_no',
      '접수일': (r) => formatDate(r.order_date),
      '출고예정일': (r) => formatDate(r.due_date),
      '합계금액': (r) => formatKRW(r.total),
    },
  },
  {
    // 계약/PO 문서 — recipients 배열을 펼쳐 각 수신자에 대해 1행 생성.
    // 계약서·발주서 발송, 재발송 안내, 서명 독촉 등에 적합.
    key: 'documents',
    label: '계약/PO 문서 수신자',
    fetch: () => {
      const docs = DB.get('documents') || [];
      const rows = [];
      for (const d of docs) {
        const recipients = Array.isArray(d.recipients) ? d.recipients : [];
        const total = (d.variables && (d.variables.합계금액 || d.variables.amount)) || d.amount;
        for (const r of recipients) {
          if (!r || !r.email) continue;
          rows.push({
            id: String(d.id) + ':' + r.email,
            email: r.email,
            name: r.name || '',
            company: (d.variables && d.variables.고객사명) || d.company || '',
            doc_no: '#' + String(d.id || '').slice(-6),
            doc_title: d.title || '',
            doc_kind: d.kind === 'purchase_order' ? '발주서' : '계약서',
            sent_at: d.sent_at,
            total,
          });
        }
      }
      return rows;
    },
    fieldMap: {
      '이름': 'name',
      '이메일': 'email',
      '회사': 'company',
      '발주번호': 'doc_no',
      '접수일': (r) => formatDate(r.sent_at),
      '합계금액': (r) => formatKRW(r.total),
    },
  },
];

function getDataSource(key) {
  return DATA_SOURCES.find((s) => s.key === key) || DATA_SOURCES[0];
}

// "직접 입력" 모드에서 한 번에 분류된 이메일 그룹을 textarea 에 부어넣는
// 단축 버튼 정의. 어드민 사용자(admin_users 테이블) 는 별도 저장소라
// 절대 포함되지 않습니다.
const QUICK_ADD_GROUPS = [
  {
    key: 'crm_active', label: 'CRM 활성 고객', desc: 'lead·qualified·customer',
    fetch: () => (DB.get('crm') || [])
      .filter((r) => ['lead', 'qualified', 'customer'].includes(r.status))
      .map((r) => r.email).filter(Boolean),
  },
  {
    key: 'crm_customer', label: 'CRM 전환 고객만', desc: 'status=customer',
    fetch: () => (DB.get('crm') || [])
      .filter((r) => r.status === 'customer')
      .map((r) => r.email).filter(Boolean),
  },
  {
    key: 'partners_active', label: '활성 파트너', desc: 'active=true',
    fetch: () => (DB.get('partners') || [])
      .filter((r) => r.active !== false)
      .map((r) => r.email).filter(Boolean),
  },
  {
    key: 'subscribers', label: '뉴스레터 구독자', desc: 'status≠unsubscribed',
    fetch: () => (DB.get('subscribers') || [])
      .filter((r) => r.status !== 'unsubscribed')
      .map((r) => r.email).filter(Boolean),
  },
  {
    key: 'inquiries_replied', label: '답변완료 문의자', desc: 'status=답변완료',
    fetch: () => (DB.get('inquiries') || [])
      .filter((r) => r.status === '답변완료')
      .map((r) => r.email).filter(Boolean),
  },
  {
    key: 'inquiries_recent30', label: '최근 30일 문의자', desc: '접수일 30일 이내',
    fetch: () => {
      const cutoff = Date.now() - 30 * 86400 * 1000;
      return (DB.get('inquiries') || [])
        .filter((r) => {
          if (!r.date) return false;
          const t = new Date(r.date).getTime();
          return Number.isFinite(t) && t >= cutoff;
        })
        .map((r) => r.email).filter(Boolean);
    },
  },
];

// 한 레코드에 fieldMap 을 적용해 변수 dict 를 생성.
// fieldMap 의 값이 함수면 record 를 인자로 호출(통화·날짜 포맷 가공용).
// string 이면 record[key] 를 그대로 사용.
function recordToVars(record, fieldMap) {
  const vars = {};
  for (const [varName, mapper] of Object.entries(fieldMap)) {
    let v;
    if (typeof mapper === 'function') {
      try { v = mapper(record); } catch { v = ''; }
    } else {
      v = record?.[mapper];
    }
    if (v != null && v !== '') vars[varName] = String(v);
  }
  return vars;
}

function BulkSendPanel({ templates }) {
  const [templateId, setTemplateId] = useState('');
  const [sourceKey, setSourceKey] = useState('manual');
  const [manualRaw, setManualRaw] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [defaultVars, setDefaultVars] = useState({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const tpl = templates.find((t) => String(t.id) === String(templateId));
  const source = getDataSource(sourceKey);
  const sourceRecords = useMemo(() => {
    if (source.key === 'manual') return [];
    return source.fetch().filter((r) => r && r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(r.email)));
  }, [source]);

  // 소스 변경 시 selectedIds 를 모든 레코드로 reset (전체 선택이 기본).
  useEffect(() => {
    if (source.key === 'manual') {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sourceRecords.map((r) => r.id)));
    }
    setResult(null);
  // eslint-disable-next-line
  }, [sourceKey, sourceRecords.length]);

  // 템플릿 변경 시 — 매핑되지 않은 변수에 대해 기본값 placeholder 입력란 노출.
  const tplVars = useMemo(
    () => extractVariables((tpl?.subject || '') + ' ' + (tpl?.body || '')),
    [tpl],
  );
  const unmappedVars = useMemo(() => {
    const mappedNames = new Set(Object.keys(source.fieldMap || {}));
    return tplVars.filter((v) => !mappedNames.has(v));
  }, [tplVars, source]);

  // 최종 발송 대상 list (email + per-recipient vars).
  const recipients = useMemo(() => {
    if (source.key === 'manual') {
      return manualRaw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter((s) => s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
        .map((email) => ({ email, vars: { ...defaultVars } }));
    }
    return sourceRecords
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({
        email: String(r.email).trim(),
        vars: { ...defaultVars, ...recordToVars(r, source.fieldMap) },
      }));
  }, [source, sourceRecords, selectedIds, manualRaw, defaultVars]);

  const toggleAll = () => {
    if (selectedIds.size === sourceRecords.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sourceRecords.map((r) => r.id)));
  };
  const toggleOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const send = async () => {
    if (!tpl) { siteAlert('발송할 템플릿을 선택하세요.'); return; }
    if (!recipients.length) { siteAlert('발송 대상이 없습니다. 데이터 소스나 직접 입력란을 확인하세요.'); return; }
    const ok = await siteConfirm(`${recipients.length}명에게 "${tpl.name}" 템플릿으로 발송하시겠습니까?`);
    if (!ok) return;
    setSending(true);
    setResult(null);
    try {
      if (api.isConfigured()) {
        const r = await api.post('/api/admin/mail/send-bulk', {
          template: { subject: tpl.subject, body: tpl.body },
          recipients,
        });
        setResult({ ok: !!r.ok, sent: r.sent || 0, failed: r.failed || 0, error: r.error });
      } else {
        // simulated — 변수 치환된 본문을 outbox 에 1건씩 기록.
        for (const rec of recipients) {
          try {
            const log = JSON.parse(localStorage.getItem('daemu_outbox') || '[]');
            log.unshift({
              id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              ts: new Date().toISOString(),
              path: '/api/admin/mail/send-bulk',
              body: {
                to: rec.email,
                subject: applyVars(tpl.subject, rec.vars),
                body: applyVars(tpl.body, rec.vars),
              },
              status: 'simulated',
            });
            localStorage.setItem('daemu_outbox', JSON.stringify(log.slice(0, 200)));
          } catch { /* ignore */ }
        }
        window.dispatchEvent(new Event('daemu-db-change'));
        setResult({ ok: true, sent: recipients.length, failed: 0, simulated: true });
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSending(false);
    }
  };

  // 첫 발송 미리보기 — 변수 치환 결과 1명분.
  const firstPreview = useMemo(() => {
    if (!tpl || !recipients.length) return null;
    const r = recipients[0];
    return {
      to: r.email,
      subject: applyVars(tpl.subject, r.vars),
      body: applyVars(tpl.body, r.vars),
      vars: r.vars,
    };
  }, [tpl, recipients]);

  return (
    <div style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 20 }}>
      {!isEmailEnabled() && (
        <p style={{ fontSize: 12, color: '#b87333', margin: '0 0 12px', background: '#fff8ec', padding: '8px 12px', borderLeft: '3px solid #c9a25a' }}>
          백엔드 이메일이 미설정 상태입니다 — 발송은 Outbox 에 simulated 로만 기록됩니다.
          RESEND_API_KEY 등록 후 실제 발송이 활성화됩니다.
        </p>
      )}
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="템플릿 선택">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— 템플릿을 선택하세요 —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                [{CATEGORIES.find((c) => c.value === t.category)?.label || t.category}] {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="수신자 데이터 소스">
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            {DATA_SOURCES.map((s) => {
              const count = s.key === 'manual' ? null : (s.fetch() || []).length;
              return (
                <option key={s.key} value={s.key}>
                  {s.label}{count != null ? ` (${count}명 등록)` : ''}
                </option>
              );
            })}
          </select>
          <div style={{ fontSize: 11, color: '#8c867d', marginTop: 4 }}>
            {source.key === 'manual'
              ? '아래에 직접 이메일을 입력합니다. 변수는 모든 수신자에게 동일한 값으로 들어갑니다.'
              : `${source.label} 의 등록 정보에서 자동으로 가져옵니다 — 이름·이메일·전화·회사 등이 수신자별로 자동 치환됩니다.`}
          </div>
        </Field>

        {source.key === 'manual' ? (
          <div>
            {/* 분류별 일괄 추가 — 클릭 시 해당 그룹 이메일을 textarea 에 dedup
                해 부어넣음. 어드민 계정은 별도 저장소(admin_users)라 포함 안 됨. */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>
                분류별 일괄 추가
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {QUICK_ADD_GROUPS.map((g) => {
                  const count = g.fetch().filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).length;
                  return (
                    <button key={g.key} type="button" className="adm-btn-sm"
                      disabled={!count}
                      title={g.desc}
                      onClick={() => {
                        const emails = g.fetch().filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
                        if (!emails.length) {
                          siteAlert(`${g.label} 에 등록된 이메일이 없습니다.`);
                          return;
                        }
                        const existing = manualRaw
                          .split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
                        const seen = new Set(existing.map((e) => e.toLowerCase()));
                        const toAdd = emails.filter((e) => !seen.has(e.toLowerCase()));
                        const next = [...existing, ...toAdd].join('\n');
                        setManualRaw(next);
                        siteToast(`${g.label}: ${toAdd.length}명 추가${emails.length - toAdd.length ? ` (중복 ${emails.length - toAdd.length}명 제외)` : ''}`,
                          { tone: 'success' });
                      }}>
                      + {g.label}
                      <span style={{ marginLeft: 6, color: '#8c867d', fontSize: 10 }}>
                        {count}명
                      </span>
                    </button>
                  );
                })}
                {!!manualRaw.trim() && (
                  <button type="button" className="adm-btn-sm danger"
                    onClick={async () => {
                      if (!(await siteConfirm('직접 입력란을 비우시겠습니까?'))) return;
                      setManualRaw('');
                    }}>
                    초기화
                  </button>
                )}
              </div>
            </div>
            <Field label={`수신자 이메일 (한 줄에 하나, 또는 쉼표로 구분) — ${recipients.length}명 인식`}>
              <textarea rows={6} value={manualRaw} onChange={(e) => setManualRaw(e.target.value)}
                placeholder="customer1@example.com&#10;customer2@example.com&#10;...&#10;위 분류별 추가 버튼으로 한 번에 추가도 가능합니다." />
            </Field>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>
                대상 — {recipients.length}/{sourceRecords.length}명 선택됨
              </span>
              <button type="button" className="adm-btn-sm" onClick={toggleAll} disabled={!sourceRecords.length}>
                {selectedIds.size === sourceRecords.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            {!sourceRecords.length ? (
              <div style={{ background: '#f6f4f0', padding: 14, fontSize: 12, color: '#8c867d', border: '1px dashed #d7d4cf', textAlign: 'center' }}>
                {source.label} 에 등록된 사용 가능한 항목이 없습니다 (이메일 누락된 항목은 제외됩니다).
              </div>
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d7d4cf', background: '#fff' }}>
                {sourceRecords.map((r) => (
                  <label key={r.id} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '8px 12px', borderBottom: '1px solid #f0ede7',
                    fontSize: 12.5, cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleOne(r.id)} />
                    <span style={{ flex: 1, color: '#231815' }}>{r.name || r.person || '(이름 없음)'}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#5a534b' }}>{r.email}</span>
                    {r.company && <span style={{ fontSize: 11, color: '#8c867d' }}>· {r.company}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {tpl && unmappedVars.length > 0 && (
          <div style={{ background: '#fff8ec', borderLeft: '3px solid #c9a25a', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              아래 변수는 데이터 소스에 없습니다 — 모든 수신자에게 같은 값으로 들어갑니다
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {unmappedVars.map((v) => (
                <label key={v} style={{ fontSize: 12, color: '#5a534b' }}>
                  <span style={{ display: 'block', marginBottom: 2, fontFamily: 'monospace' }}>{`{{${v}}}`}</span>
                  <input type="text" value={defaultVars[v] || ''}
                    onChange={(e) => setDefaultVars((d) => ({ ...d, [v]: e.target.value }))}
                    style={{ width: '100%' }} placeholder={`예: ${v} 값`} />
                </label>
              ))}
            </div>
          </div>
        )}

        {firstPreview && (
          <div style={{ background: '#f6f4f0', padding: 14, fontSize: 12, color: '#5a534b', border: '1px solid #e6e3dd' }}>
            <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>발송 미리보기 (첫 1명)</div>
            <div style={{ marginBottom: 6 }}><strong>To:</strong> {firstPreview.to}</div>
            <div style={{ marginBottom: 6 }}><strong>제목:</strong> {firstPreview.subject}</div>
            <div style={{ background: '#fff', border: '1px solid #e6e3dd', padding: 10, fontSize: 12, lineHeight: 1.7, maxHeight: 200, overflowY: 'auto', wordBreak: 'keep-all' }}>
              {renderMailBody(firstPreview.body)}
            </div>
            {Object.keys(firstPreview.vars).length > 0 && (
              <div style={{ fontSize: 11, color: '#8c867d', marginTop: 6 }}>
                자동 적용된 변수: {Object.entries(firstPreview.vars).map(([k, v]) => `{{${k}}} = ${v}`).join(' · ')}
              </div>
            )}
          </div>
        )}

        <div className="adm-action-row" style={{ borderTop: 'none', paddingTop: 0 }}>
          <button type="button" className="btn" disabled={sending || !tpl || !recipients.length} onClick={send}>
            {sending ? '발송 중…' : `${recipients.length}명에게 발송`}
          </button>
        </div>
        {result && (
          <div style={{
            background: result.ok ? '#eef6ee' : '#fff0ec',
            border: '1px solid ' + (result.ok ? '#cfe5cf' : '#f0c4c0'),
            padding: '12px 16px', fontSize: 13, color: result.ok ? '#2e7d32' : '#c0392b',
          }}>
            {result.ok
              ? `발송 완료 — ${result.sent}명 성공${result.failed ? `, ${result.failed}명 실패` : ''}${result.simulated ? ' (시뮬레이션 모드)' : ''}`
              : `발송 실패 — ${result.error || '알 수 없는 오류'}`}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="adm-inline-field" style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
