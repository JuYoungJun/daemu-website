// 계약서 / 발주서 관리 — 템플릿 CRUD + 문서 생성·발송·서명 추적·PDF 출력.
//
// 책임 범위 (의도적 한계):
//   - 본 모듈은 문서 워크플로(작성·치환·발송·서명·PDF)에 한정합니다.
//   - 결제/대금 처리/PG 연동은 본 시스템에서 다루지 않습니다.
//   - 그러므로 amount 변수는 단순 표기이며, 실제 결제 청구나 청구서 처리와 연결되지 않습니다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { api } from '../lib/api.js';
import { Auth } from '../lib/auth.js';
import { DB } from '../lib/db.js';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm, sitePrompt } from '../lib/dialog.js';
import { extractTextFromPdf, fileToDataUrl } from '../lib/pdfExtract.js';
import {
  formatPhone, formatBizNo, formatCurrencyTyping, unformatNumber, normalizeEmail,
} from '../lib/inputFormat.js';

const KIND_LABEL = { contract: '계약서', purchase_order: '발주서' };
const STATUS_LABEL = {
  draft: '초안', sent: '발송됨', viewed: '열람됨',
  signed: '서명완료', canceled: '취소됨',
};
const STATUS_COLOR = {
  draft: '#6f6b68', sent: '#2e7d32', viewed: '#b87333',
  signed: '#1f5e7c', canceled: '#c0392b',
};

const VARIABLE_HINTS = [
  { key: 'clientName', label: '고객/회사명', group: 'client', placeholder: '예: (주)카페 이음' },
  { key: 'clientAddress', label: '고객 주소', group: 'client', placeholder: '예: 광주광역시 서구 ...' },
  { key: 'clientCEO', label: '고객 대표자', group: 'client', placeholder: '예: 홍길동' },
  { key: 'clientBizNo', label: '고객 사업자등록번호', group: 'client', placeholder: '예: 123-45-67890' },
  { key: 'projectName', label: '프로젝트명', group: 'project', placeholder: '예: 비클래시 인천점 메뉴 R&D' },
  { key: 'scope', label: '업무 범위 / 발주 항목', group: 'project', long: true, placeholder: '본 계약의 업무 내용을 항목별로 작성하세요.' },
  { key: 'amount', label: '금액 (표기용)', group: 'money', placeholder: '예: 50,000,000' },
  { key: 'amountWithTax', label: '부가세 포함 금액', group: 'money', placeholder: '예: 55,000,000' },
  { key: 'paymentTerms', label: '대금 지급 조건 (참고)', group: 'money', long: true, placeholder: '예: 계약 시 30%, 중간 40%, 잔금 30%' },
  { key: 'startDate', label: '시작일', group: 'schedule', placeholder: 'YYYY-MM-DD' },
  { key: 'endDate', label: '종료일', group: 'schedule', placeholder: 'YYYY-MM-DD' },
  { key: 'deliveryDate', label: '납품/완료일', group: 'schedule', placeholder: 'YYYY-MM-DD' },
  { key: 'today', label: '계약 체결일', group: 'schedule', placeholder: 'YYYY-MM-DD' },
  { key: 'warrantyPeriod', label: '하자보수 기간', group: 'schedule', placeholder: '예: 6개월' },
  { key: 'companyName', label: '공급/발주사명 (당사)', group: 'company', placeholder: '대무 (DAEMU)' },
  { key: 'companyAddress', label: '당사 주소', group: 'company', placeholder: '전라남도 나주시 황동 3길 8' },
  { key: 'companyCEO', label: '당사 대표자', group: 'company', placeholder: '대표자명' },
  { key: 'companyBizNo', label: '당사 사업자등록번호', group: 'company', placeholder: '예: 123-45-67890' },
  { key: 'managerName', label: '담당자', group: 'company', placeholder: '예: 김담당' },
  { key: 'managerEmail', label: '담당자 이메일', group: 'company', placeholder: 'daemu_office@naver.com' },
  { key: 'managerPhone', label: '담당자 연락처', group: 'company', placeholder: '061-335-1239' },
  { key: 'terms', label: '특약사항', group: 'misc', long: true, placeholder: '추가 특별 조항이나 합의사항을 작성하세요.' },
];

const VARIABLE_GROUPS = [
  { key: 'client',   label: '고객 정보',       desc: '계약/발주 상대방의 회사·대표자·연락 정보' },
  { key: 'project',  label: '프로젝트',        desc: '계약 대상 프로젝트와 업무 범위' },
  { key: 'money',    label: '금액·지급 조건',  desc: '계약 금액 및 지급 조건 (표기 전용 — 실 결제는 별도)' },
  { key: 'schedule', label: '일정',            desc: '계약 기간과 납품·체결 일정' },
  { key: 'company',  label: '당사 / 담당자',   desc: '대무(공급사) 기본 정보 — 한 번 채워두면 재사용 가능' },
  { key: 'misc',     label: '특약사항',        desc: '기타 합의 조항' },
];

// 변수 키별 입력 포맷 결정 — 변수 입력 폼 렌더링이 사용.
const MONEY_KEYS = new Set(['amount', 'amountWithTax']);
const PHONE_KEYS = new Set(['managerPhone', 'clientPhone']);
const DATE_KEYS = new Set(['startDate', 'endDate', 'deliveryDate', 'today']);
const BIZNO_KEYS = new Set(['clientBizNo', 'companyBizNo']);
const EMAIL_KEYS = new Set(['managerEmail', 'clientEmail']);

// 당사 정보 기본값 (대무 기본 정보) — 새 문서 생성 시 자동 prefill.
const COMPANY_DEFAULTS = {
  companyName: '대무 (DAEMU)',
  companyAddress: '전라남도 나주시 황동 3길 8',
  companyCEO: '',
  companyBizNo: '',
  managerName: '',
  managerEmail: 'daemu_office@naver.com',
  managerPhone: '061-335-1239',
  warrantyPeriod: '6개월',
  today: new Date().toISOString().slice(0, 10),
};

// 선택된 파트너 / CRM 데이터를 계약서 변수로 변환.
// 파트너에 추가 필드(주소·사업자번호 등)가 등록되어 있으면 그것까지 채우고,
// 없으면 비워둠. 빈 값은 변수 입력 폼에서 사용자가 직접 채울 수 있도록.
function partnerToVariables(p) {
  if (!p) return {};
  return {
    clientName:    p.name || p.company || '',
    clientCEO:     p.ceo || p.person || '',           // 대표자 또는 담당자
    clientAddress: p.addr || p.address || '',
    clientBizNo:   p.bizNo || p.bizno || p.businessNumber || '',
  };
}
function crmToVariables(c) {
  if (!c) return {};
  return {
    clientName:    c.company || c.name || '',
    clientCEO:     c.ceo || c.name || '',
    clientAddress: c.addr || c.address || '',
    clientBizNo:   c.bizNo || c.businessNumber || '',
    projectName:   c.projectName || c.summary || '',
  };
}
function orderToVariables(o, partnerLookup) {
  if (!o) return {};
  const partner = partnerLookup?.find?.((p) => p.id === o.partner_id || p.name === o.partner);
  const base = partner ? partnerToVariables(partner) : {};
  return {
    ...base,
    projectName:    o.title || o.product || '',
    amount:         o.amount ? String(o.amount) : (o.qty && o.price ? String(Number(o.qty) * Number(o.price)) : ''),
    deliveryDate:   o.due_date ? String(o.due_date).slice(0, 10) : '',
    scope:          o.note || o.product || '',
  };
}

// ----- 표준 템플릿 (Korean B2B + F&B 컨설팅 맥락) -----

const TEMPLATE_SERVICE_CONTRACT = `용역 계약서 (Service Agreement)

본 계약은 아래 당사자 간에 체결되며, "{{projectName}}" 프로젝트에 관한
용역 제공 및 그에 따른 권리·의무를 다음과 같이 정한다.

────────────────────────────────────────────
■ 갑 (의뢰인 / 고객)
  · 회사명: {{clientName}}
  · 주    소: {{clientAddress}}
  · 대 표 자: {{clientCEO}}
  · 사업자등록번호: {{clientBizNo}}

■ 을 (수임인 / 공급사)
  · 회사명: {{companyName}}
  · 주    소: {{companyAddress}}
  · 대 표 자: {{companyCEO}}
  · 사업자등록번호: {{companyBizNo}}
────────────────────────────────────────────

제 1 조 (계약 목적)
본 계약은 갑이 을에게 "{{projectName}}" 용역을 의뢰하고, 을이 이를 성실히
수행함으로써 갑의 사업 목적 달성에 기여함을 목적으로 한다.

제 2 조 (용역 범위)
{{scope}}

제 3 조 (계약 기간)
{{startDate}} 부터 {{endDate}} 까지로 하되, 양 당사자 합의에 따라 연장할 수 있다.

제 4 조 (계약 금액 — 표기)
계약 금액은 금 {{amount}} 원으로 표기하며, 부가가치세 포함 금액은 {{amountWithTax}} 원이다.
다만, 본 문서는 대금 수납·청구를 위한 시스템이 아니며, 실제 대금 정산은
별도 합의된 절차(세금계산서 발행 등)에 따라 진행된다.

제 5 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 6 조 (산출물의 인도)
을은 약정된 산출물을 {{deliveryDate}} 까지 갑에게 인도하며, 갑은 산출물 검수 후
30일 이내에 이의가 없을 경우 검수 완료된 것으로 본다.

제 7 조 (하자보수)
산출물의 하자에 대해 을은 인도일로부터 {{warrantyPeriod}} 동안 무상 보수의 의무를 진다.

제 8 조 (비밀유지)
양 당사자는 본 계약과 관련하여 알게 된 상대방의 영업비밀·기술정보·고객정보를
계약 종료 후 3년간 제3자에게 누설하거나 본 계약 목적 외로 사용해서는 아니 된다.

제 9 조 (지식재산권)
본 계약 수행 과정에서 도출된 산출물의 저작권 및 지식재산권은 잔금 지급 완료 시
갑에게 이전되며, 그 전까지는 을의 소유로 한다.

제 10 조 (계약 해지)
어느 일방이 본 계약상의 의무를 중대하게 위반하고 30일의 시정 통지에도 시정하지
아니할 경우, 상대방은 본 계약을 서면 통지로 해지할 수 있다.

제 11 조 (분쟁 해결)
본 계약과 관련된 분쟁은 양 당사자가 우선 협의하여 해결하며, 협의가 불성립할 경우
대한상사중재원의 중재 규칙에 따른다.

제 12 조 (특약사항)
{{terms}}

본 계약의 성립을 증명하기 위하여 본 계약서를 2부 작성하여 각 당사자가
서명·날인 후 각 1부씩 보관한다.

계약 체결일: {{today}}

담당자: {{managerName}} ({{managerEmail}} · {{managerPhone}})`;

const TEMPLATE_NDA = `비밀유지 계약서 (Non-Disclosure Agreement)

본 계약은 아래 당사자 간 "{{projectName}}" 검토·협의 과정에서 교환되는
비밀 정보의 보호에 관한 사항을 정한다.

당사자
  · 갑: {{clientName}} (대표자 {{clientCEO}})
  · 을: {{companyName}} (대표자 {{companyCEO}})

제 1 조 (비밀정보의 정의)
본 계약에서 "비밀정보"란 일방 당사자가 상대방에게 서면·구두·전자적 방법으로
공개한 모든 기술·영업·재무·고객 정보 중 비밀로 표시되었거나 그 성질상 비밀로
간주되어야 하는 정보를 말한다.

제 2 조 (비밀유지 의무)
양 당사자는 비밀정보를 본 계약 목적 외로 사용하지 아니하며, 사전 서면 동의 없이
제3자에게 누설하지 아니한다.

제 3 조 (유지 기간)
비밀유지 의무는 본 계약 체결일부터 {{warrantyPeriod}} 또는 {{endDate}}까지로 한다.

제 4 조 (반환 및 폐기)
계약 종료 또는 일방의 요청 시, 수령자는 보유 중인 비밀정보 일체를 즉시 반환하거나
검증 가능한 방법으로 폐기한다.

제 5 조 (특약사항)
{{terms}}

계약 체결일: {{today}}`;

const TEMPLATE_SUPPLY_CONTRACT = `공급 계약서 (Supply Agreement)

본 계약은 갑 {{clientName}} (이하 "발주처")이 을 {{companyName}} (이하 "공급사")
로부터 "{{projectName}}" 관련 물품·서비스를 공급받음에 있어 그 거래 조건을
다음과 같이 정한다.

제 1 조 (공급 품목)
{{scope}}

제 2 조 (공급 기간)
{{startDate}} ~ {{endDate}}, 정기 공급의 경우 자동 갱신 조항 적용 가능.

제 3 조 (납품 / 검수)
공급사는 약정된 일정({{deliveryDate}})에 따라 발주처가 지정한 장소로 납품하며,
발주처는 납품 후 7일 이내 검수를 완료한다.

제 4 조 (단가 및 정산 — 표기)
계약 단가는 별첨 명세서에 따르며, 누계 금액 표기 {{amount}} 원
(부가세 포함 {{amountWithTax}} 원). 실제 대금 정산 절차는 별도 합의에 따른다.

제 5 조 (품질 보증)
공급사는 납품 물품의 품질 불량에 대해 인도일로부터 {{warrantyPeriod}} 동안
무상 교환 또는 보수의 의무를 진다.

제 6 조 (특약사항)
{{terms}}

계약 체결일: {{today}}
당사 담당자: {{managerName}} ({{managerEmail}})`;

const TEMPLATE_PO = `발주서 (Purchase Order)

발 주 일: {{today}}
발주번호: PO-자동발급

발주처 (당사)
  · 회사명: {{companyName}}
  · 사업자등록번호: {{companyBizNo}}
  · 담당자: {{managerName}} ({{managerEmail}} · {{managerPhone}})

공급처
  · 회사명: {{clientName}}
  · 대표자: {{clientCEO}}
  · 사업자등록번호: {{clientBizNo}}
  · 주    소: {{clientAddress}}

────────────────────────────────────────────
프로젝트 : {{projectName}}
납    기 : {{deliveryDate}}
계약 기간: {{startDate}} ~ {{endDate}}

발주 항목 / 사양:
{{scope}}

총 금액 (표기): {{amount}} 원 (부가세 포함 {{amountWithTax}} 원)
※ 실제 대금 정산·세금계산서 발행은 별도 절차로 진행됩니다.

대금 지급 조건 (참고): {{paymentTerms}}
하자/품질 보증 기간: {{warrantyPeriod}}
────────────────────────────────────────────

특약사항:
{{terms}}

수령 확인 시 본 발주서 하단에 서명하여 회신해 주시기 바랍니다.

발주처 담당자: {{managerName}}`;

// 종류 → (라벨, 기본 템플릿) 매핑
const TEMPLATE_PRESETS = [
  { id: 'service-contract',  label: '용역 계약서 (표준)',  kind: 'contract',        body: TEMPLATE_SERVICE_CONTRACT },
  { id: 'supply-contract',   label: '공급 계약서 (표준)',  kind: 'contract',        body: TEMPLATE_SUPPLY_CONTRACT },
  { id: 'nda',               label: '비밀유지 계약서(NDA)',kind: 'contract',        body: TEMPLATE_NDA },
  { id: 'purchase-order',    label: '발주서 (표준)',       kind: 'purchase_order',  body: TEMPLATE_PO },
];

const DEFAULT_CONTRACT_TEMPLATE = TEMPLATE_SERVICE_CONTRACT;
const DEFAULT_PO_TEMPLATE = TEMPLATE_PO;

// 법적 효력 안내문 — 모든 계약/PO 화면에서 동일한 톤으로 노출.
const LEGAL_DISCLAIMER_LINES = [
  '법적 효력 안내 — 본 e-Sign은 데모/내부 결재용입니다.',
  '강한 법적 효력이 필요한 계약(공증·부동산·대출·행정 신고 등)은',
  'DocuSign·Adobe Sign·KICA 인증서 + 신원확인·감사이력·위변조 방지가 별도로 필요합니다.',
];

function isoNow() { return new Date().toISOString(); }

function localStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem('daemu_' + key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function localSet(key, val) {
  localStorage.setItem('daemu_' + key, JSON.stringify(val));
  window.dispatchEvent(new Event('daemu-db-change'));
}

function applyVars(text, vars) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

export default function AdminContracts() {
  const me = Auth.user();
  const isAdmin = me?.role === 'admin';
  const [tab, setTab] = useState('documents');
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // doc id for detail drawer

  const reload = async () => {
    setLoading(true); setError('');
    try {
      if (api.isConfigured()) {
        const [t, d] = await Promise.all([
          api.get('/api/document-templates'),
          api.get('/api/documents?page_size=200'),
        ]);
        setTemplates(t.ok ? (t.items || []) : []);
        setDocuments(d.ok ? (d.items || []) : []);
        if (!t.ok) setError(t.error || '템플릿을 불러올 수 없습니다.');
      } else {
        // Demo mode — localStorage
        setTemplates(localStore('document_templates', []));
        setDocuments(localStore('documents', []));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-line */ }, []);

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">계약서 / 발주서</h1>

          <AdminHelp title="계약서·발주서 사용 안내" items={[
            '1단계 — 템플릿 만들기: "템플릿" 탭에서 표준 계약서/발주서 양식을 등록하세요. {{변수}} 자리에 실제 값이 치환됩니다.',
            '2단계 — 문서 생성: "문서" 탭에서 템플릿을 고르고 변수값(고객명·프로젝트명·금액·기간 등)을 채워 최종 문서를 생성합니다.',
            '3단계 — 미리보기 → 발송: 문서를 열어 미리보기에서 확인 후 "발송"을 누르면 수신자에게 이메일이 나가며 서명 링크가 동봉됩니다.',
            '4단계 — 서명: 수신자가 서명 링크에서 캔버스 서명을 완료하면 상태가 자동으로 "서명완료"로 바뀝니다.',
            '준비된 표준 양식: 용역 계약서, 공급 계약서, 비밀유지 계약서(NDA), 발주서.',
            '본 시스템은 결제/대금 수납을 다루지 않습니다. 금액 변수는 명세 표기일 뿐 실제 청구·수납 처리와 연결되지 않습니다.',
          ]} />

          <LegalDisclaimer style={{ marginBottom: 22 }} />

          <div className="adm-tabs">
            <button type="button" className={tab === 'documents' ? 'is-active' : ''} onClick={() => setTab('documents')}>
              문서 <span style={{ color: '#b9b5ae', fontWeight: 400 }}>{documents.length}</span>
            </button>
            <button type="button" className={tab === 'templates' ? 'is-active' : ''} onClick={() => setTab('templates')}>
              템플릿 <span style={{ color: '#b9b5ae', fontWeight: 400 }}>{templates.length}</span>
            </button>
          </div>

          {error && <p style={{ color: '#c0392b', fontSize: 12, marginBottom: 14 }}>{error}</p>}

          {tab === 'templates' && (
            <TemplatesPane
              templates={templates}
              onChange={reload}
              isAdmin={isAdmin}
            />
          )}

          {tab === 'documents' && (
            <DocumentsPane
              documents={documents}
              templates={templates}
              onChange={reload}
              isAdmin={isAdmin}
              loading={loading}
              onOpen={(id) => setSelected(id)}
            />
          )}

          {selected && (
            <DocumentDrawer
              docId={selected}
              onClose={() => setSelected(null)}
              onChange={reload}
              templates={templates}
              isAdmin={isAdmin}
            />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

/* ─────────────── 템플릿 패널 ─────────────── */

function TemplatesPane({ templates, onChange, isAdmin }) {
  const [editing, setEditing] = useState(null);

  const startFromPreset = (preset) => setEditing({
    name: preset.label,
    kind: preset.kind,
    subject: preset.kind === 'contract'
      ? '[대무] ' + preset.label + ' — {{projectName}}'
      : '[대무] 발주서 — {{projectName}}',
    body: preset.body,
    variables: VARIABLE_HINTS.map((v) => v.key),
    active: true,
  });
  // openPdfUpload=true 면 에디터 진입 직후 PDF 업로드 단계가 자동 활성화됨.
  const startBlank = (kind, opts = {}) => setEditing({
    name: kind === 'contract' ? '새 계약서' : '새 발주서',
    kind,
    subject: kind === 'contract' ? '[대무] 계약서 — {{projectName}}' : '[대무] 발주서 — {{projectName}}',
    body: opts.openPdfUpload ? '' : (kind === 'contract' ? DEFAULT_CONTRACT_TEMPLATE : DEFAULT_PO_TEMPLATE),
    variables: VARIABLE_HINTS.map((v) => v.key),
    active: true,
    _autoOpenPdf: !!opts.openPdfUpload,
  });

  return (
    <div>
      {isAdmin && (
        <div style={{
          display: 'grid', gap: 10, marginBottom: 18,
          background: '#fff', border: '1px solid #d7d4cf', padding: 18,
        }}>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>
            새 템플릿 만들기
          </div>
          <p style={{ fontSize: 12.5, color: '#5a534b', margin: '0 0 4px', lineHeight: 1.7 }}>
            기존에 쓰던 PDF 양식을 올리면 자동으로 텍스트를 추출해 편집 가능한 템플릿으로 변환합니다.
            추출이 잘 안 되는 스캔본은 PDF 자체를 첨부해 그대로 사용할 수 있습니다.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" type="button" onClick={() => startBlank('contract', { openPdfUpload: true })}>
              + PDF 업로드 (계약서)
            </button>
            <button className="btn" type="button" onClick={() => startBlank('purchase_order', { openPdfUpload: true })}>
              + PDF 업로드 (발주서)
            </button>
            <span style={{ flex: 1 }} />
            <button className="adm-btn-sm" type="button" onClick={() => startBlank('contract')}>
              빈 계약서로 시작
            </button>
            <button className="adm-btn-sm" type="button" onClick={() => startBlank('purchase_order')}>
              빈 발주서로 시작
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#8c867d', lineHeight: 1.7 }}>
            기존에 시드된 표준 양식 11종(컨설팅 용역·공급·NDA·디자인·공간·OJT·이미지 동의서·발주서·시공·장비 등)은 자동으로 등록되어 있어 따로 만들 필요 없습니다.
            아래 목록에서 바로 사용·수정하세요.
          </div>
        </div>
      )}

      {!templates.length && <EmptyState text="등록된 템플릿이 없습니다. 위 버튼으로 PDF 업로드 또는 빈 템플릿으로 시작해 보세요." />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 14 }}>
        {templates.map((t) => (
          <div key={t.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <strong style={{ fontSize: 14 }}>{t.name}</strong>
              <span style={{ fontSize: 11, color: '#8c867d' }}>{KIND_LABEL[t.kind] || t.kind}</span>
            </div>
            <p style={{ fontSize: 12, color: '#6f6b68', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 84, overflow: 'hidden', position: 'relative' }}>
              {String(t.body || '').slice(0, 240)}{(t.body || '').length > 240 ? '…' : ''}
            </p>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(t.variables || []).slice(0, 6).map((v) => (
                <code key={v} style={{ fontSize: 10, background: '#f6f4f0', padding: '2px 6px', border: '1px solid #e6e3dd' }}>{v}</code>
              ))}
            </div>
            {isAdmin && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                <button type="button" className="adm-btn-sm" onClick={() => setEditing(t)}>수정</button>
                <button type="button" className="adm-btn-sm danger" onClick={async () => {
                  if (!(await siteConfirm('이 템플릿을 삭제할까요?'))) return;
                  if (api.isConfigured()) {
                    await api.del('/api/document-templates/' + t.id);
                  } else {
                    localSet('document_templates', localStore('document_templates', []).filter((x) => x.id !== t.id));
                  }
                  onChange();
                }}>삭제</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }) {
  const [t, setT] = useState({
    name: template.name || '', kind: template.kind || 'contract',
    subject: template.subject || '', body: template.body || '',
    variables: template.variables || [], active: template.active !== false,
    // PDF 업로드 시 채워짐 — 텍스트 추출 실패 시 fallback 으로 첨부 사용.
    pdfDataUrl: template.pdfDataUrl || '',
    pdfFilename: template.pdfFilename || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [pdfImporting, setPdfImporting] = useState(false);
  const [pdfImportProgress, setPdfImportProgress] = useState(null);
  const [pdfPreview, setPdfPreview] = useState(null); // { extracted, filename, dataUrl, pageInfo }
  const pdfFileInputRef = useRef(null);

  // "+ PDF 업로드" 버튼으로 진입한 경우 (_autoOpenPdf), 모달이 mount 되자마자
  // file picker 가 열리도록 자동 클릭. 사용자가 한 번만 클릭하면 PDF 선택
  // 단계로 바로 진입.
  useEffect(() => {
    if (template?._autoOpenPdf && pdfFileInputRef.current) {
      const t = setTimeout(() => {
        try { pdfFileInputRef.current.click(); } catch { /* ignore */ }
      }, 250);
      return () => clearTimeout(t);
    }
  }, [template]);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (api.isConfigured()) {
        const url = template.id ? '/api/document-templates/' + template.id : '/api/document-templates';
        const r = template.id ? await api.patch(url, t) : await api.post(url, t);
        if (!r.ok) { setErr(r.error || '저장 실패'); setSaving(false); return; }
      } else {
        const list = localStore('document_templates', []);
        if (template.id) {
          const idx = list.findIndex((x) => x.id === template.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...t, updated_at: isoNow() };
        } else {
          list.unshift({ id: Date.now(), ...t, created_at: isoNow(), updated_at: isoNow() });
        }
        localSet('document_templates', list);
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // PDF 업로드 → 텍스트 추출 → 미리보기 → 사용자 승인 후 본문에 적용.
  // 추출이 실패하면 PDF 자체를 dataURL 로 보관해 fallback 첨부 가능.
  const onPdfUpload = async (file) => {
    if (!file) return;
    if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      siteAlert('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      siteAlert('PDF 파일이 너무 큽니다 (최대 10MB).');
      return;
    }
    setPdfImporting(true);
    setPdfImportProgress({ current: 0, total: 1 });
    setErr('');

    let extracted = '';
    let extractionError = null;
    try {
      extracted = await extractTextFromPdf(file, {
        maxPages: 30,
        onProgress: (current, total) => setPdfImportProgress({ current, total }),
      });
    } catch (e) {
      extractionError = String(e?.message || e);
    }

    let dataUrl = '';
    try {
      dataUrl = await fileToDataUrl(file);
    } catch (e) {
      // dataUrl 도 실패하면 진짜 fallback 없음.
      console.error('[pdfExtract] dataUrl conversion failed:', e);
    }

    setPdfImporting(false);
    setPdfImportProgress(null);
    setPdfPreview({
      extracted: (extracted || '').trim(),
      extractionError,
      filename: file.name,
      dataUrl,
      sizeKb: Math.round(file.size / 1024),
    });
  };

  const applyExtractedText = () => {
    if (!pdfPreview) return;
    setT((prev) => ({
      ...prev,
      body: pdfPreview.extracted,
      pdfDataUrl: pdfPreview.dataUrl || '',
      pdfFilename: pdfPreview.filename || '',
    }));
    setPdfPreview(null);
  };

  const applyAsAttachment = () => {
    if (!pdfPreview) return;
    // 본문은 그대로 두고, pdfDataUrl 만 보관 — 발송 시 첨부/링크로 사용.
    setT((prev) => ({
      ...prev,
      pdfDataUrl: pdfPreview.dataUrl || '',
      pdfFilename: pdfPreview.filename || '',
      // 본문이 비어있으면 안내 메시지 자동 채움.
      body: prev.body && prev.body.trim()
        ? prev.body
        : `[첨부 PDF 사용 — 코드 변환 없이 ${pdfPreview.filename} 그대로 발송]\n\n` +
          `수신자에게는 PDF 파일이 첨부되어 발송됩니다.\n` +
          `필요한 변수가 있으면 본 안내문 아래에 추가로 작성하세요. 예: 안녕하세요 {{clientName}}님,`,
    }));
    setPdfPreview(null);
  };

  const removePdfFallback = () => {
    setT((prev) => ({ ...prev, pdfDataUrl: '', pdfFilename: '' }));
  };

  return (
    <Modal onClose={onClose} title={template.id ? '템플릿 수정' : '템플릿 등록'}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="이름">
          <input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </Field>
        <Field label="종류">
          <select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value })}>
            <option value="contract">계약서</option>
            <option value="purchase_order">발주서</option>
          </select>
        </Field>

        {/* 기존에 쓰던 PDF 양식을 가져와 본문 텍스트로 변환 또는 그대로 첨부.
            추출 실패 시 PDF 그대로 첨부하는 fallback 도 같이 제공. */}
        <div style={{ background: '#f6f4f0', border: '1px solid #e6e3dd', padding: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 8 }}>
            기존 PDF 에서 가져오기 (선택)
          </div>
          {!t.pdfFilename && !pdfImporting && (
            <label className="adm-btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              <input ref={pdfFileInputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                onChange={(e) => { onPdfUpload(e.target.files?.[0]); e.target.value = ''; }} />
              + PDF 양식 업로드 (≤10MB)
            </label>
          )}
          {pdfImporting && (
            <div style={{ fontSize: 12, color: '#5a4a2a' }}>
              PDF 분석 중…{pdfImportProgress ? ` (${pdfImportProgress.current}/${pdfImportProgress.total} 페이지)` : ''}
            </div>
          )}
          {t.pdfFilename && !pdfImporting && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#2a2724' }}>
                <strong>첨부 PDF:</strong> {t.pdfFilename}
              </span>
              <a href={t.pdfDataUrl} target="_blank" rel="noopener noreferrer" className="adm-btn-sm">PDF 보기</a>
              <label className="adm-btn-sm" style={{ cursor: 'pointer' }}>
                <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                  onChange={(e) => { onPdfUpload(e.target.files?.[0]); e.target.value = ''; }} />
                다른 PDF 로 교체
              </label>
              <button type="button" className="adm-btn-sm danger" onClick={removePdfFallback}>PDF 첨부 제거</button>
            </div>
          )}
          <p style={{ fontSize: 11, color: '#8c867d', marginTop: 8, marginBottom: 0, lineHeight: 1.7 }}>
            기존 양식 PDF 를 올리면 텍스트를 자동 추출해 본문 템플릿으로 변환합니다.
            추출이 잘 안 되거나 그대로 사용하고 싶으면 <strong>PDF 그대로 첨부</strong> 옵션도 선택할 수 있습니다.
            (변환은 client-side 로 진행되며 외부 서버에 업로드되지 않습니다.)
          </p>
        </div>

        <Field label="이메일 제목 (변수 사용 가능)">
          <input type="text" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} />
        </Field>
        <Field label="본문 (변수: {{key}} 형식)">
          <textarea value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} rows={14}
            style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </Field>
        <div style={{ fontSize: 12, color: '#6f6b68' }}>
          <strong style={{ color: '#2a2724', letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}>사용 가능한 변수</strong>{' '}
          (클릭해서 본문에 삽입)
          <div style={{ marginTop: 6 }}>
            {VARIABLE_HINTS.map((v) => (
              <button key={v.key} type="button" className="adm-var-chip"
                onClick={() => setT({ ...t, body: t.body + ' {{' + v.key + '}}' })}>
                {`{{${v.key}}}`} <span style={{ color: '#8c867d', marginLeft: 4 }}>{v.label}</span>
              </button>
            ))}
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} />
          사용 중 (체크 해제하면 문서 작성 화면에서 숨김)
        </label>
        {err && <p style={{ color: '#c0392b', fontSize: 12, margin: 0 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="adm-btn-sm" type="button" onClick={onClose}>취소</button>
          <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>

      {pdfPreview && (
        <PdfImportPreviewModal
          preview={pdfPreview}
          onUseExtracted={applyExtractedText}
          onUseAsAttachment={applyAsAttachment}
          onCancel={() => setPdfPreview(null)}
        />
      )}
    </Modal>
  );
}

// 변수 키별로 적절한 input type / 자동 포맷터를 선택해 렌더링.
//   - 금액: 천단위 콤마 표시, 저장은 숫자 문자열
//   - 전화: 010-1234-5678 자동 dash
//   - 날짜: native date picker
//   - 사업자번호: XXX-XX-XXXXX
//   - 이메일: 공백 제거 + blur 시 lowercase
//   - 그 외: 일반 텍스트
function FormattedVariableInput({ varKey, value, placeholder, onChange }) {
  const baseStyle = { width: '100%', padding: 8, border: '1px solid #d7d4cf', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };

  if (MONEY_KEYS.has(varKey)) {
    // 표시값은 천단위 콤마, 저장값은 숫자 문자열.
    return (
      <input type="text" inputMode="numeric"
        value={formatCurrencyTyping(value)}
        onChange={(e) => onChange(unformatNumber(e.target.value))}
        placeholder={placeholder || '예: 50,000,000'}
        style={baseStyle} />
    );
  }
  if (PHONE_KEYS.has(varKey)) {
    return (
      <input type="tel" inputMode="numeric" maxLength={13}
        value={value}
        onChange={(e) => onChange(formatPhone(e.target.value))}
        placeholder={placeholder || '010-1234-5678'}
        style={baseStyle} />
    );
  }
  if (DATE_KEYS.has(varKey)) {
    return (
      <input type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={baseStyle} />
    );
  }
  if (BIZNO_KEYS.has(varKey)) {
    return (
      <input type="text" inputMode="numeric" maxLength={12}
        value={value}
        onChange={(e) => onChange(formatBizNo(e.target.value))}
        placeholder={placeholder || '123-45-67890'}
        style={baseStyle} />
    );
  }
  if (EMAIL_KEYS.has(varKey)) {
    return (
      <input type="email" inputMode="email"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
        onBlur={(e) => onChange(normalizeEmail(e.target.value))}
        placeholder={placeholder || 'name@example.com'}
        style={baseStyle} />
    );
  }
  return (
    <input type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || ''}
      style={baseStyle} />
  );
}

function PdfImportPreviewModal({ preview, onUseExtracted, onUseAsAttachment, onCancel }) {
  const hasText = preview.extracted && preview.extracted.trim().length > 30;
  const charCount = preview.extracted ? preview.extracted.length : 0;
  const [tab, setTab] = useState(hasText ? 'converted' : 'pdf');

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="adm-modal-box is-wide" style={{ maxWidth: 1100 }}>
        <div className="adm-modal-head">
          <h2>PDF 가져오기 — {preview.filename} ({preview.sizeKb}KB)</h2>
          <button type="button" className="adm-modal-close" onClick={onCancel} aria-label="닫기">×</button>
        </div>

        {preview.extractionError && (
          <div style={{ background: '#fff0ec', border: '1px solid #f0c4c0', padding: '10px 14px', fontSize: 12.5, color: '#c0392b', marginBottom: 14 }}>
            <strong>텍스트 추출 실패:</strong> {preview.extractionError}<br/>
            아래 "PDF 그대로 첨부" 를 선택하시면 변환 없이 PDF 파일 자체를 사용합니다.
          </div>
        )}

        {/* 탭 — 변환된 텍스트 / 원본 PDF / 나란히 비교 */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e6e3dd', marginBottom: 14 }}>
          <TabBtn active={tab === 'converted'} onClick={() => setTab('converted')} disabled={!hasText}>
            변환 결과 ({charCount.toLocaleString('ko')}자)
          </TabBtn>
          <TabBtn active={tab === 'pdf'} onClick={() => setTab('pdf')} disabled={!preview.dataUrl}>
            원본 PDF
          </TabBtn>
          <TabBtn active={tab === 'compare'} onClick={() => setTab('compare')} disabled={!hasText || !preview.dataUrl}>
            나란히 비교
          </TabBtn>
        </div>

        {tab === 'converted' && hasText && (
          <ConvertedPaper extracted={preview.extracted} />
        )}

        {tab === 'pdf' && preview.dataUrl && (
          <PdfFrame src={preview.dataUrl} />
        )}

        {tab === 'compare' && hasText && preview.dataUrl && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="adm-pdf-compare">
            <div>
              <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>변환된 텍스트</div>
              <ConvertedPaper extracted={preview.extracted} compact />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 6 }}>원본 PDF</div>
              <PdfFrame src={preview.dataUrl} compact />
            </div>
          </div>
        )}

        {!hasText && (
          <div style={{ background: '#fff8ec', border: '1px solid #f0e3c4', padding: 14, fontSize: 13, color: '#5a4a2a', marginTop: 12 }}>
            텍스트 추출량이 거의 없습니다 (스캔 PDF 또는 이미지 기반). <strong>PDF 그대로 첨부</strong> 로 사용을 권장합니다.
          </div>
        )}

        <p style={{ fontSize: 11, color: '#8c867d', marginTop: 12 }}>
          위 미리보기를 보고 결정하세요 — 변환 결과가 깔끔하면 <strong>변환 결과 적용</strong> (편집·변수 가능), 그대로 PDF 를 쓰고 싶으면 <strong>PDF 그대로 첨부</strong>.
        </p>

        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onCancel}>취소</button>
          <button type="button" className="adm-btn-sm" onClick={onUseAsAttachment}>
            PDF 그대로 첨부
          </button>
          <button type="button" className="btn" onClick={onUseExtracted} disabled={!hasText}>
            변환 결과 적용 (본문 채움)
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        background: active ? '#fff' : 'transparent',
        border: '1px solid ' + (active ? '#d7d4cf' : 'transparent'),
        borderBottom: active ? '1px solid #fff' : '1px solid transparent',
        padding: '8px 16px',
        marginBottom: -1,
        fontSize: 12.5,
        fontWeight: active ? 600 : 400,
        color: disabled ? '#b9b5ae' : (active ? '#231815' : '#5a534b'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
      }}>
      {children}
    </button>
  );
}

// 변환 결과를 A4-style 흰 종이 미리보기로 — 조항 자동 강조.
function ConvertedPaper({ extracted, compact }) {
  const lines = String(extracted || '').split('\n');
  const truncated = extracted.length > 8000;
  const display = truncated ? extracted.slice(0, 8000) : extracted;
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #d7d4cf',
      maxHeight: compact ? 480 : 520,
      overflowY: 'auto',
      padding: compact ? '20px 22px' : '32px clamp(20px, 4vw, 48px)',
      fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
      fontSize: 13.5,
      lineHeight: 1.85,
      color: '#231815',
      wordBreak: 'keep-all',
    }}>
      {display.split('\n').map((line, i) => {
        const trimmed = line.trim();
        // 조항 헤더 강조 — 「제 N 조 (...)」
        if (/^제\s*\d+\s*(조|장)/.test(trimmed)) {
          return <h3 key={i} style={{
            fontSize: 14, fontWeight: 600, color: '#231815',
            margin: '14px 0 4px', borderBottom: '1px solid #e6e3dd',
            paddingBottom: 4,
          }}>{trimmed}</h3>;
        }
        // 큰 제목 (앞 3줄 안의 짧은 줄을 제목 후보로)
        if (i < 3 && trimmed.length > 0 && trimmed.length < 30 && !/[.:;]/.test(trimmed)) {
          return <h2 key={i} style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 22, fontWeight: 500, margin: '0 0 16px',
            color: '#231815',
          }}>{trimmed}</h2>;
        }
        if (!trimmed) return <div key={i} style={{ height: '0.7em' }} />;
        return <p key={i} style={{ margin: '0 0 6px' }}>{line}</p>;
      })}
      {truncated && (
        <p style={{ marginTop: 16, fontSize: 11, color: '#8c867d', textAlign: 'center', borderTop: '1px dashed #e6e3dd', paddingTop: 10 }}>
          ... (8,000자에서 잘림 — 적용 후 본문 편집기에서 전체 확인)
        </p>
      )}
    </div>
  );
}

// 원본 PDF iframe 미리보기 — 브라우저 native viewer 사용.
function PdfFrame({ src, compact }) {
  return (
    <div style={{ background: '#e5e1d8', padding: 8 }}>
      <iframe
        title="PDF 원본 미리보기"
        src={src}
        style={{
          width: '100%',
          height: compact ? 480 : 560,
          border: '1px solid #d7d4cf',
          background: '#fff',
        }}
      />
    </div>
  );
}

/* ─────────────── 문서 패널 ─────────────── */

function DocumentsPane({ documents, templates, onChange, isAdmin, loading, onOpen }) {
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return documents;
    return documents.filter((d) => d.status === filter);
  }, [documents, filter]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {isAdmin && <button className="btn" type="button" onClick={() => setCreating(true)}>+ 새 문서</button>}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff' }}>
          <option value="all">전체 상태</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#8c867d', marginLeft: 'auto' }}>{filtered.length}건</span>
        <button type="button" className="adm-btn-sm" disabled={!filtered.length}
          onClick={() => downloadCSV(
            'daemu-documents-' + new Date().toISOString().slice(0, 10) + '.csv',
            filtered,
            [
              { key: 'id', label: 'ID' },
              { key: (d) => KIND_LABEL[d.kind] || d.kind, label: '종류' },
              { key: (d) => STATUS_LABEL[d.status] || d.status, label: '상태' },
              { key: 'title', label: '제목' },
              { key: 'subject', label: '메일제목' },
              { key: (d) => (d.recipients || []).map((r) => `${r.name || ''} <${r.email || ''}>`).join('; '), label: '수신자' },
              { key: (d) => d.created_at ? new Date(d.created_at).toISOString() : '', label: '작성일' },
              { key: (d) => d.sent_at ? new Date(d.sent_at).toISOString() : '', label: '발송일' },
              { key: (d) => d.signed_at ? new Date(d.signed_at).toISOString() : '', label: '서명일' },
            ],
          )}>CSV 내보내기</button>
      </div>

      {loading && <p style={{ color: '#8c867d', fontSize: 12 }}>불러오는 중…</p>}

      {!filtered.length && !loading && (
        <div className="adm-doc-empty">
          <strong>문서가 없습니다</strong>
          상단 <em>+ 새 문서</em> 버튼으로 첫 계약서·발주서를 작성하세요.
        </div>
      )}

      <div className="adm-doc-grid">
        {filtered.map((d) => (
          <div key={d.id} className="adm-doc-row" onClick={() => onOpen(d.id)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span className="adm-doc-pill" data-status={d.status}>{STATUS_LABEL[d.status] || d.status}</span>
                <span style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.08em', textTransform: 'uppercase' }}>{KIND_LABEL[d.kind] || d.kind}</span>
              </div>
              <p className="adm-doc-row__title">{d.title}</p>
              <div className="adm-doc-row__meta">
                수신자 {(d.recipients || []).length}명 · {new Date(d.created_at).toLocaleString('ko')}
              </div>
            </div>
            <div style={{ fontSize: 18, color: '#b9b5ae', fontWeight: 300 }}>→</div>
          </div>
        ))}
      </div>

      {creating && (
        <DocumentEditor
          doc={null}
          templates={templates}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); onChange(); }}
        />
      )}
    </div>
  );
}

/* ─────────────── 문서 편집기 (생성/수정) ─────────────── */

function DocumentEditor({ doc, templates, onClose, onSaved }) {
  const [d, setD] = useState({
    template_id: doc?.template_id || (templates[0]?.id || null),
    kind: doc?.kind || (templates.find((x) => x.id === doc?.template_id)?.kind || 'contract'),
    title: doc?.title || '',
    subject: doc?.subject || '',
    body: doc?.body || '',
    variables: doc?.variables || {},
    recipients: doc?.recipients || [],
    crm_id: doc?.crm_id || null,
    partner_id: doc?.partner_id || null,
    order_id: doc?.order_id || null,
    work_id: doc?.work_id || null,
    render_from_template: !doc,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Sync template default body whenever the template selection changes.
  const tplActive = templates.filter((t) => t.active !== false);
  const currentTpl = templates.find((t) => t.id === d.template_id);

  useEffect(() => {
    if (!currentTpl || doc) return;
    setD((prev) => ({
      ...prev,
      kind: currentTpl.kind,
      subject: currentTpl.subject || prev.subject,
      body: currentTpl.body || prev.body,
    }));
  }, [d.template_id]); // eslint-disable-line

  const previewBody = applyVars(d.body, d.variables);
  const previewSubject = applyVars(d.subject, d.variables);

  // 본문/제목에서 실제로 사용된 {{변수}}만 추출 — 입력 폼에 그것만 노출.
  // VARIABLE_HINTS에 정의된 변수만 사용하고, 정의되지 않은 변수는 무시.
  const usedVarKeys = useMemo(() => {
    const text = [d.body, d.subject].filter(Boolean).join('\n');
    const found = new Set();
    const re = /\{\{\s*([\w-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
    return found;
  }, [d.body, d.subject]);
  // 사용 변수가 없는 그룹은 fieldset 자체를 숨김.
  const visibleGroups = useMemo(() => VARIABLE_GROUPS
    .map((g) => ({ ...g, items: VARIABLE_HINTS.filter((v) => v.group === g.key && usedVarKeys.has(v.key)) }))
    .filter((g) => g.items.length > 0), [usedVarKeys]);

  const setVar = (k, v) => setD({ ...d, variables: { ...d.variables, [k]: v } });
  const addRecipient = () => setD({ ...d, recipients: [...(d.recipients || []), { name: '', email: '', role: 'signer' }] });
  const updateRecipient = (i, k, v) => {
    const list = [...(d.recipients || [])];
    list[i] = { ...list[i], [k]: v };
    setD({ ...d, recipients: list });
  };
  const removeRecipient = (i) => {
    const list = [...(d.recipients || [])];
    list.splice(i, 1);
    setD({ ...d, recipients: list });
  };

  // CRM/Partners/Orders pickers — pulled from local DB for convenience.
  const crmList = DB.get('crm');
  const partnerList = DB.get('partners');
  const orderList = DB.get('orders');

  const save = async () => {
    if (!d.title.trim()) { setErr('제목을 입력하세요.'); return; }
    if (!(d.recipients || []).length) { setErr('수신자를 1명 이상 추가하세요.'); return; }
    setSaving(true); setErr('');
    const payload = { ...d };
    try {
      if (api.isConfigured()) {
        const r = doc ? await api.patch('/api/documents/' + doc.id, payload) : await api.post('/api/documents', payload);
        if (!r.ok) { setErr(r.error || '저장 실패'); setSaving(false); return; }
      } else {
        const list = localStore('documents', []);
        const renderedBody = payload.render_from_template ? applyVars(payload.body, payload.variables) : payload.body;
        const renderedSubject = payload.render_from_template ? applyVars(payload.subject, payload.variables) : payload.subject;
        if (doc) {
          const idx = list.findIndex((x) => x.id === doc.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...payload, body: renderedBody, subject: renderedSubject, updated_at: isoNow() };
        } else {
          list.unshift({
            id: Date.now(), ...payload, body: renderedBody, subject: renderedSubject,
            status: 'draft', sign_token: '', created_at: isoNow(), updated_at: isoNow(),
            history: [{ ts: isoNow(), action: 'created' }],
          });
        }
        localSet('documents', list);
      }
      onSaved();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={doc ? '문서 수정' : '새 문서 생성'} wide>
      <div className="adm-contract-edit-grid">
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="템플릿 선택">
            <select value={d.template_id || ''} onChange={(e) => setD({ ...d, template_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">(직접 작성 — 템플릿 없음)</option>
              {tplActive.map((t) => <option key={t.id} value={t.id}>{KIND_LABEL[t.kind]} · {t.name}</option>)}
            </select>
          </Field>
          <Field label="문서 제목">
            <input type="text" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="예: 비클래시 나주점 메뉴개발 용역계약서" />
          </Field>
          <Field label="이메일 제목">
            <input type="text" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
          </Field>
          <Field label="문서 본문 (변수 미치환 원본)">
            <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={14} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </Field>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 4px', flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: 0 }}>
                변수값 입력 — 이 템플릿이 사용하는 항목만
              </h4>
              <button type="button" className="adm-btn-sm" onClick={() => {
                // 당사 기본 정보 자동 prefill — 매번 입력 안 해도 되도록.
                setD((prev) => ({
                  ...prev,
                  variables: { ...COMPANY_DEFAULTS, ...prev.variables, today: COMPANY_DEFAULTS.today },
                }));
              }} title="대무(당사) 기본 정보를 자동으로 채웁니다.">
                당사 정보 자동 입력
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: '#8c867d', margin: '0 0 8px', lineHeight: 1.6 }}>
              현재 본문에서 <strong>{usedVarKeys.size}</strong>개 변수가 사용 중입니다.
              필요한 항목만 폼이 자동으로 표시되며, 다른 템플릿을 선택하면 그에 맞춰 자동 갱신됩니다.
            </p>
            {visibleGroups.length === 0 && (
              <p style={{ fontSize: 12, color: '#8c867d', padding: '14px 0' }}>
                선택한 템플릿이나 본문에서 사용하는 변수가 없습니다. 본문에 <code>{`{{변수}}`}</code> 형태로 자리표시자를 넣으면 여기에 입력 필드가 자동으로 나타납니다.
              </p>
            )}
            {visibleGroups.map((g) => {
              const items = g.items;
              return (
                <fieldset key={g.key} style={{
                  border: '1px solid #e6e3dd', padding: '12px 14px 10px', marginBottom: 10, background: '#fdfcfa',
                }}>
                  <legend style={{ padding: '0 8px', fontSize: 11.5, color: '#5a534b', letterSpacing: '.04em' }}>
                    <strong>{g.label}</strong> · <span style={{ color: '#8c867d' }}>{g.desc}</span>
                    <span style={{ marginLeft: 8, color: '#b9b5ae', fontSize: 10 }}>{items.length}개 항목</span>
                  </legend>
                  <div style={{ display: 'grid', gridTemplateColumns: items.some((x) => x.long) ? '1fr' : '1fr 1fr', gap: 8 }}>
                    {items.map((v) => (
                      <label key={v.key} style={{ display: 'block', gridColumn: v.long ? '1 / -1' : 'auto' }}>
                        <span style={{ fontSize: 11, color: '#6f6b68', display: 'block', marginBottom: 2 }}>
                          {v.label} <code style={{ color: '#b9b5ae', fontSize: 10 }}>{`{{${v.key}}}`}</code>
                        </span>
                        {v.long ? (
                          <textarea rows={3} value={d.variables[v.key] || ''}
                            onChange={(e) => setVar(v.key, e.target.value)}
                            placeholder={v.placeholder || ''}
                            style={{ width: '100%', padding: 8, border: '1px solid #d7d4cf', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
                        ) : (
                          <FormattedVariableInput
                            varKey={v.key}
                            value={d.variables[v.key] || ''}
                            placeholder={v.placeholder || ''}
                            onChange={(val) => setVar(v.key, val)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>

          <div>
            <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: '14px 0 8px' }}>수신자 (서명 대상)</h4>
            {(d.recipients || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input type="text" placeholder="이름" value={r.name} onChange={(e) => updateRecipient(i, 'name', e.target.value)}
                  style={{ flex: 1, padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }} />
                <input type="email" inputMode="email" placeholder="이메일" value={r.email}
                  onChange={(e) => updateRecipient(i, 'email', e.target.value.replace(/\s/g, ''))}
                  onBlur={(e) => updateRecipient(i, 'email', normalizeEmail(e.target.value))}
                  style={{ flex: 2, padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }} />
                <select value={r.role} onChange={(e) => updateRecipient(i, 'role', e.target.value)}
                  style={{ padding: 6, border: '1px solid #d7d4cf', fontSize: 13 }}>
                  <option value="signer">서명자</option>
                  <option value="cc">참조</option>
                </select>
                <button type="button" className="adm-btn-sm danger" onClick={() => removeRecipient(i)}>×</button>
              </div>
            ))}
            <button type="button" className="adm-btn-sm" onClick={addRecipient}>+ 수신자 추가</button>
          </div>

          <details open style={{ fontSize: 12, color: '#6f6b68' }}>
            <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 500 }}>📎 기존 데이터에서 자동 채우기 (CRM / 파트너 / 발주)</summary>
            <p style={{ fontSize: 11, color: '#8c867d', margin: '4px 0 8px' }}>
              선택한 항목의 회사명·대표자·주소·사업자번호 등 등록된 정보를 변수에 자동 채웁니다.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              <Field label="CRM 고객">
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={d.crm_id || ''} onChange={(e) => setD({ ...d, crm_id: e.target.value ? Number(e.target.value) : null })}
                    style={{ flex: 1 }}>
                    <option value="">(선택 없음)</option>
                    {crmList.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` / ${c.company}` : ''}</option>)}
                  </select>
                  <button type="button" className="adm-btn-sm" disabled={!d.crm_id}
                    onClick={() => {
                      const c = crmList.find((x) => x.id === d.crm_id);
                      if (c) setD((prev) => ({ ...prev, variables: { ...prev.variables, ...crmToVariables(c) } }));
                    }}
                    title="이 고객의 정보를 변수에 채웁니다.">불러오기</button>
                </div>
              </Field>
              <Field label="파트너">
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={d.partner_id || ''} onChange={(e) => setD({ ...d, partner_id: e.target.value ? Number(e.target.value) : null })}
                    style={{ flex: 1 }}>
                    <option value="">(선택 없음)</option>
                    {partnerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" className="adm-btn-sm" disabled={!d.partner_id}
                    onClick={() => {
                      const p = partnerList.find((x) => x.id === d.partner_id);
                      if (p) setD((prev) => ({ ...prev, variables: { ...prev.variables, ...partnerToVariables(p) } }));
                    }}
                    title="이 파트너의 회사명·연락처 등을 변수에 채웁니다.">불러오기</button>
                </div>
              </Field>
              <Field label="발주">
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={d.order_id || ''} onChange={(e) => setD({ ...d, order_id: e.target.value ? Number(e.target.value) : null })}
                    style={{ flex: 1 }}>
                    <option value="">(선택 없음)</option>
                    {orderList.map((o) => <option key={o.id} value={o.id}>#{String(o.id).slice(-6)} {o.partner}</option>)}
                  </select>
                  <button type="button" className="adm-btn-sm" disabled={!d.order_id}
                    onClick={() => {
                      const o = orderList.find((x) => x.id === d.order_id);
                      if (o) setD((prev) => ({ ...prev, variables: { ...prev.variables, ...orderToVariables(o, partnerList) } }));
                    }}
                    title="발주의 파트너·금액·납기를 변수에 채웁니다.">불러오기</button>
                </div>
              </Field>
            </div>
          </details>
        </div>

        <div>
          <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', margin: '0 0 8px' }}>
            미리보기 (A4 PDF 형식)
          </h4>
          <DocPaperPreview
            kind={d.kind}
            title={d.title || '(문서 제목)'}
            subject={previewSubject}
            body={previewBody || '(미리보기가 비어있습니다 — 본문/변수값을 입력하세요)'}
            recipients={d.recipients || []}
            status="draft"
            createdAt={null}
          />
          <LegalDisclaimer style={{ marginTop: 12 }} />
        </div>
      </div>

      {err && <p style={{ color: '#c0392b', fontSize: 12, margin: '12px 0 0' }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="adm-btn-sm" type="button" onClick={onClose}>취소</button>
        <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '저장 중…' : (doc ? '저장' : '문서 생성')}</button>
      </div>
    </Modal>
  );
}

/* ─────────────── 상세 드로어 ─────────────── */

function DocumentDrawer({ docId, onClose, onChange, templates, isAdmin }) {
  const [doc, setDoc] = useState(null);
  const [signatures, setSignatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    if (api.isConfigured()) {
      const r = await api.get('/api/documents/' + docId);
      if (r.ok) {
        setDoc(r.item);
        setSignatures(r.signatures || []);
      } else {
        setErr(r.error || '불러오기 실패');
      }
    } else {
      const list = localStore('documents', []);
      const found = list.find((x) => x.id === docId);
      setDoc(found || null);
      setSignatures([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, [docId]);

  const send = async () => {
    if (!(await siteConfirm('수신자에게 문서를 발송할까요?\n발송 후 서명 링크가 함께 전달됩니다.'))) return;
    if (api.isConfigured()) {
      const r = await api.post('/api/documents/' + docId + '/send', { sign_required: true, extra_message: '' });
      if (r.ok) {
        siteAlert('발송 결과 — 성공: ' + r.sent + ', 실패: ' + r.failed + '\n서명 URL: ' + (r.sign_url || '(없음)'));
        await load(); onChange();
      } else {
        siteAlert('발송 실패: ' + (r.error || ''));
      }
    } else {
      // Demo — mark as sent and create a fake token.
      const list = localStore('documents', []);
      const idx = list.findIndex((x) => x.id === docId);
      if (idx >= 0) {
        list[idx].status = 'sent';
        list[idx].sent_at = isoNow();
        list[idx].sign_token = 'demo-' + Math.random().toString(36).slice(2);
        list[idx].history = [...(list[idx].history || []), { ts: isoNow(), action: 'sent' }];
        localSet('documents', list);
        siteAlert('데모 모드 — 발송 시뮬레이션 완료. 서명 URL: ' + window.location.origin + '/sign/' + list[idx].sign_token);
        await load(); onChange();
      }
    }
  };

  const cancel = async () => {
    const reason = (await sitePrompt('취소 사유를 입력하세요 (선택):', '', { placeholder: '예: 클라이언트 요청' })) || '';
    if (api.isConfigured()) {
      const r = await api.post('/api/documents/' + docId + '/cancel', { reason });
      if (r.ok) { await load(); onChange(); }
      else siteAlert('취소 실패: ' + (r.error || ''));
    } else {
      const list = localStore('documents', []);
      const idx = list.findIndex((x) => x.id === docId);
      if (idx >= 0) {
        list[idx].status = 'canceled';
        list[idx].canceled_at = isoNow();
        list[idx].canceled_reason = reason;
        list[idx].history = [...(list[idx].history || []), { ts: isoNow(), action: 'canceled' }];
        localSet('documents', list);
        await load(); onChange();
      }
    }
  };

  const remove = async () => {
    if (!(await siteConfirm('이 문서를 삭제할까요? 복구할 수 없습니다.'))) return;
    if (api.isConfigured()) {
      await api.del('/api/documents/' + docId);
    } else {
      localSet('documents', localStore('documents', []).filter((x) => x.id !== docId));
    }
    onChange(); onClose();
  };

  const exportPdf = () => {
    // Snyk DOMXSS hardening: build the print window with document.createElement
    // + textContent only — no document.write, no innerHTML, no template-string
    // HTML. The window's print is triggered after onload.
    //
    // 사용 안내: 인쇄 다이얼로그에서 "대상" 또는 "프린터"를
    // **"PDF로 저장"** (또는 "Save as PDF")로 선택하면 실제 PDF 파일이
    // 다운로드됩니다. 한국어 OS는 보통 "PDF로 저장"이라고 표기됩니다.
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) { siteAlert('팝업 차단으로 PDF 창을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.'); return; }

    const wDoc = w.document;
    wDoc.documentElement.lang = 'ko';

    // <head>
    const head = wDoc.head || wDoc.getElementsByTagName('head')[0];
    while (head.firstChild) head.removeChild(head.firstChild);
    const meta = wDoc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.appendChild(meta);
    const titleEl = wDoc.createElement('title');
    titleEl.textContent = String(doc.title || '문서');
    head.appendChild(titleEl);
    const style = wDoc.createElement('style');
    // Static stylesheet — no user input goes in here.
    style.textContent = `
      @page { size: A4; margin: 22mm; }
      body { font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif; color:#231815; line-height:1.75; }
      h1 { font-size: 20px; border-bottom: 2px solid #231815; padding-bottom: 8px; }
      .meta { font-size: 11px; color: #8c867d; margin-bottom: 18px; letter-spacing:.04em }
      pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; }
      .sig { margin-top: 18px; padding-top: 14px; border-top: 1px solid #d7d4cf; font-size: 11px; color:#6f6b68; }
      .legal { margin-top: 28px; padding: 12px 14px; background:#fff8ec; border:1px solid #f0e3c4; font-size:11px; color:#5a4a2a; line-height:1.7 }
      .brand { text-align: right; font-size: 12px; color: #8c867d; margin-top: 28px; border-top: 1px solid #d7d4cf; padding-top: 10px; letter-spacing:.08em }
    `;
    head.appendChild(style);

    // <body>
    const body = wDoc.body;
    while (body.firstChild) body.removeChild(body.firstChild);

    const metaDiv = wDoc.createElement('div');
    metaDiv.className = 'meta';
    metaDiv.textContent = [
      KIND_LABEL[doc.kind] || '',
      STATUS_LABEL[doc.status] || '',
      doc.created_at ? new Date(doc.created_at).toLocaleString('ko') : '',
    ].filter(Boolean).join(' · ');
    body.appendChild(metaDiv);

    const h1 = wDoc.createElement('h1');
    h1.textContent = String(doc.title || '');
    body.appendChild(h1);

    const pre = wDoc.createElement('pre');
    pre.textContent = String(doc.body || '');
    body.appendChild(pre);

    for (const s of signatures) {
      const sig = wDoc.createElement('div');
      sig.className = 'sig';
      sig.textContent =
        `서명자: ${s.signer_name || ''} (${s.signer_email || ''}) · ` +
        (s.signed_at ? new Date(s.signed_at).toLocaleString('ko') : '');
      body.appendChild(sig);
    }

    // Legal note — kept consistent with the e-sign page.
    const legal = wDoc.createElement('div');
    legal.className = 'legal';
    legal.textContent =
      '본 e-Sign은 데모/내부 결재용 전자 서명입니다. 강한 법적 효력이 필요한 계약(공증·부동산·대출 등)은 ' +
      'DocuSign·Adobe Sign·KICA 인증서 + 신원확인·감사이력·위변조 방지 PDF가 별도로 필요합니다.';
    body.appendChild(legal);

    const brand = wDoc.createElement('div');
    brand.className = 'brand';
    brand.textContent = '대무 (DAEMU) · daemu_office@naver.com · 061-335-1239';
    body.appendChild(brand);

    // Trigger print after layout settles. Hooked via the parent window so we
    // never inject script text into the new window.
    setTimeout(() => {
      try { w.focus(); w.print(); } catch (e) { /* ignore */ }
    }, 300);
  };

  if (loading || !doc) {
    return <Modal onClose={onClose} title="불러오는 중…"><p>{err || '문서를 불러오고 있습니다.'}</p></Modal>;
  }

  if (editing) {
    return <DocumentEditor doc={doc} templates={templates} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); onChange(); }} />;
  }

  return (
    <Modal onClose={onClose} title={doc.title} wide>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="adm-doc-pill" data-status={doc.status}>{STATUS_LABEL[doc.status]}</span>
        <span style={{ fontSize: 11, color: '#8c867d', letterSpacing: '.06em', textTransform: 'uppercase' }}>{KIND_LABEL[doc.kind]}</span>
        <span style={{ fontSize: 11, color: '#b9b5ae' }}>· 작성 {new Date(doc.created_at).toLocaleString('ko')}</span>
      </div>

      <DocPaperPreview
        kind={doc.kind}
        title={doc.title}
        subject={doc.subject || ''}
        body={doc.body || ''}
        recipients={doc.recipients || []}
        status={doc.status}
        createdAt={doc.created_at}
        signatures={signatures}
      />

      {(doc.recipients || []).length > 0 && (
        <div style={{ marginBottom: 14, fontSize: 12, color: '#6f6b68' }}>
          <strong style={{ color: '#2a2724', letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 11 }}>수신자</strong>{' '}
          {(doc.recipients || []).map((r) => `${r.name || ''} <${r.email}>`).join(', ')}
        </div>
      )}

      {doc.sign_token && (
        <div className="adm-sign-link" style={{ marginBottom: 14 }}>
          
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block', marginBottom: 4, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5a4a2a' }}>서명 링크</strong>
            <code>{window.location.origin}/sign/{doc.sign_token}</code>
          </span>
          <button type="button" className="adm-btn-sm" onClick={() => {
            navigator.clipboard?.writeText(`${window.location.origin}/sign/${doc.sign_token}`);
          }}>복사</button>
        </div>
      )}

      {signatures.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>서명 기록</h4>
          {signatures.map((s) => (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 12, marginTop: 6, fontSize: 12 }}>
              <strong>{s.signer_name}</strong> · {s.signer_email} · {new Date(s.signed_at).toLocaleString('ko')}<br />
              IP {s.ip || '-'} · UA {(s.user_agent || '').slice(0, 80)}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <h4 style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d' }}>이력</h4>
        {(doc.history || []).map((h, i) => (
          <div key={i} style={{ fontSize: 12, color: '#6f6b68', padding: '4px 0' }}>
            {new Date(h.ts).toLocaleString('ko')} · <strong>{h.action}</strong>
            {h.by ? ` · ${h.by}` : ''}
            {h.detail ? ` · ${JSON.stringify(h.detail)}` : ''}
          </div>
        ))}
      </div>

      <LegalDisclaimer style={{ marginBottom: 14 }} />

      <div className="adm-action-row">
        {isAdmin && doc.status === 'draft' && (
          <button className="btn" type="button" onClick={send}>발송</button>
        )}
        {isAdmin && doc.status !== 'signed' && doc.status !== 'canceled' && (
          <button className="adm-btn-sm" type="button" onClick={() => setEditing(true)}>수정</button>
        )}
        <button className="adm-btn-sm" type="button" onClick={exportPdf}
          title="새 창에서 인쇄 다이얼로그를 열고, '대상'을 'PDF로 저장'으로 선택하면 PDF 파일이 다운로드됩니다.">
          PDF로 저장 / 인쇄
        </button>
        {isAdmin && doc.status !== 'canceled' && doc.status !== 'signed' && (
          <button className="adm-btn-sm danger" type="button" onClick={cancel}>취소 처리</button>
        )}
        {isAdmin && (
          <button className="adm-btn-sm danger" type="button" onClick={remove}>삭제</button>
        )}
      </div>
    </Modal>
  );
}

/* ─────────────── 공통 ─────────────── */

function Modal({ children, onClose, title, wide }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`adm-modal-box ${wide ? 'is-wide' : 'is-narrow'}`}>
        <div className="adm-modal-head">
          <h2>{title}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: '#8c867d', background: '#fff', border: '1px dashed #d7d4cf' }}>
      <p>{text}</p>
    </div>
  );
}

// A4 PDF 모양으로 문서 본문을 렌더링하는 페이퍼 미리보기.
// 실제 인쇄/PDF 출력 시 보일 모양과 거의 동일하게 표시되어, 운영자가
// "어떤 식으로 PDF가 나올지" 미리 확인할 수 있습니다.
// 본문을 paragraph 단위로 분해하면서, 「제 N 조 (...)」 같은 조항 헤더를
// 자동으로 강조 표시합니다. 발주서·계약서 모두 동일 패턴.
function renderPaperBody(text) {
  if (!text) return null;
  const lines = String(text).split(/\n/);
  const out = [];
  let buffer = [];
  const flush = (key) => {
    if (!buffer.length) return;
    out.push(<p key={`p-${key}`} className="adm-paper-para">{buffer.join('\n')}</p>);
    buffer = [];
  };
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // 조항 헤더 — 「제 N 조 (...)」 / 「제 N 장」 / 「[표준]」 등
    if (/^제\s*\d+\s*(조|장)/.test(trimmed)) {
      flush(idx);
      out.push(<h3 key={`h-${idx}`} className="adm-paper-clause">{trimmed}</h3>);
      return;
    }
    // 큰 섹션 구분선 (―, ─, ===)
    if (/^[─━=─]{3,}/.test(trimmed)) {
      flush(idx);
      out.push(<hr key={`hr-${idx}`} className="adm-paper-rule" />);
      return;
    }
    // 작은 섹션 라벨 — 「■ 갑 (의뢰인)」 같은 형태
    if (/^[■▣▪◆]/.test(trimmed)) {
      flush(idx);
      out.push(<h4 key={`h2-${idx}`} className="adm-paper-section">{trimmed}</h4>);
      return;
    }
    // 빈 줄 → buffer flush, 단락 break
    if (!trimmed) {
      flush(idx);
      return;
    }
    buffer.push(line);
  });
  flush('end');
  return out;
}

function DocPaperPreview({ kind, title, subject, body, recipients, status, createdAt, signatures }) {
  const draft = status === 'draft' || status === 'sent' || status === 'viewed';
  const wmText = status === 'draft' ? 'DRAFT' : (status === 'sent' || status === 'viewed') ? '발송본' : '';
  // 화면 미리보기용 줌 — 0=fit(컨테이너 폭에 맞춤), 1=실제 A4(210mm)
  // 'fit'이 기본. 인쇄·PDF 저장 시는 print CSS에서 무조건 1배 A4로 출력됨.
  const [zoom, setZoom] = useState('fit');
  const stageClass = 'adm-paper-stage adm-paper-stage--' + (zoom === 'fit' ? 'fit' : 'zoom');
  const sheetStyle = zoom === 'fit'
    ? undefined
    : { transform: `scale(${zoom})`, transformOrigin: 'top center' };
  return (
    <div className="adm-paper-frame">
      <div className="adm-paper-toolbar" role="toolbar" aria-label="미리보기 표시 옵션">
        <span className="adm-paper-toolbar-label">표시</span>
        <button type="button"
          className={'adm-paper-zoom-btn' + (zoom === 'fit' ? ' is-active' : '')}
          onClick={() => setZoom('fit')}>화면 맞춤</button>
        <button type="button"
          className={'adm-paper-zoom-btn' + (zoom === 0.75 ? ' is-active' : '')}
          onClick={() => setZoom(0.75)}>75%</button>
        <button type="button"
          className={'adm-paper-zoom-btn' + (zoom === 1 ? ' is-active' : '')}
          onClick={() => setZoom(1)}>100% (A4)</button>
        <button type="button"
          className={'adm-paper-zoom-btn' + (zoom === 1.25 ? ' is-active' : '')}
          onClick={() => setZoom(1.25)}>125%</button>
        <span className="adm-paper-toolbar-hint">PDF/인쇄는 항상 실제 A4 크기로 저장됩니다</span>
      </div>
    <div className={stageClass}>
      <div className={`adm-paper-sheet adm-paper-sheet--${kind}`} style={sheetStyle}>
        {draft && wmText && <div className="adm-paper-watermark">{wmText}</div>}
        <header className="adm-paper-head">
          <div className="adm-paper-brand">
            <strong>대무 (DAEMU)</strong>
            <span>BAKERY · CAFE BUSINESS PARTNER</span>
          </div>
          <div className="adm-paper-doctype">
            <span className="adm-paper-doctype-en">{kind === 'purchase_order' ? 'PURCHASE ORDER' : 'CONTRACT'}</span>
            <strong>{KIND_LABEL[kind] || kind}</strong>
          </div>
        </header>
        <div className="adm-paper-meta">
          {subject && <div className="adm-paper-subject">{subject}</div>}
          {createdAt && <div className="adm-paper-date">작성일 · {new Date(createdAt).toLocaleString('ko')}</div>}
        </div>
        <h1 className="adm-paper-title">{title}</h1>
        <div className="adm-paper-divider" />
        <div className="adm-paper-body adm-paper-body--rich">
          {renderPaperBody(body) || <p className="adm-paper-para" style={{ color: '#b9b5ae' }}>(본문 비어있음)</p>}
        </div>
        {(recipients || []).length > 0 && (
          <div className="adm-paper-recipients">
            <span>수신자 / 서명 대상</span>
            {(recipients || []).map((r, i) => (
              <div key={i} className="adm-paper-recipient-row">
                <strong>{r.name || '(이름 미지정)'}</strong>
                {r.email && <span className="adm-paper-email">{r.email}</span>}
                {r.role === 'cc' && <em className="adm-paper-role">참조</em>}
                {r.role === 'signer' && <em className="adm-paper-role adm-paper-role--signer">서명자</em>}
              </div>
            ))}
          </div>
        )}

        {/* 서명란 — 서명이 아직 없을 때도 박스를 보여주어 어디에 서명이 들어갈지 안내 */}
        <div className="adm-paper-signbox">
          <div className="adm-paper-signbox-cell">
            <div className="adm-paper-signbox-label">{kind === 'purchase_order' ? '발주처' : '갑'}</div>
            <div className="adm-paper-signbox-line" />
            <div className="adm-paper-signbox-name">서명 / 인</div>
          </div>
          <div className="adm-paper-signbox-cell">
            <div className="adm-paper-signbox-label">{kind === 'purchase_order' ? '공급처' : '을'}</div>
            <div className="adm-paper-signbox-line" />
            <div className="adm-paper-signbox-name">서명 / 인</div>
          </div>
        </div>

        {(signatures || []).length > 0 && (
          <div className="adm-paper-signatures">
            <h4>전자 서명 기록</h4>
            {signatures.map((s) => (
              <div key={s.id} className="adm-paper-sig">
                <strong>{s.signer_name}</strong> · {s.signer_email} · {s.signed_at ? new Date(s.signed_at).toLocaleString('ko') : ''}
                <span className="adm-paper-sig-meta">IP {s.ip || '-'}</span>
              </div>
            ))}
          </div>
        )}
        <footer className="adm-paper-foot">
          <div>대무 (DAEMU) · 전라남도 나주시 황동 3길 8</div>
          <div>daemu_office@naver.com · 061-335-1239</div>
        </footer>
      </div>
    </div>
    </div>
  );
}

// 본 컴포넌트는 모든 계약/PO 진입 지점에 동일한 톤으로 노출되어
// 운영자가 "이 e-Sign이 어디까지 효력을 가지는지" 한눈에 알도록 합니다.
function LegalDisclaimer({ style }) {
  return (
    <div role="note" style={{
      background: '#fff8ec',
      border: '1px solid #f0e3c4',
      borderLeft: '3px solid #c9a25a',
      padding: '14px 18px',
      fontSize: 12.5,
      lineHeight: 1.75,
      color: '#5a4a2a',
      borderRadius: 4,
      ...(style || {}),
    }}>
      {LEGAL_DISCLAIMER_LINES.map((line, i) => (
        <div key={i} style={{ fontWeight: i === 0 ? 600 : 400 }}>{line}</div>
      ))}
    </div>
  );
}
