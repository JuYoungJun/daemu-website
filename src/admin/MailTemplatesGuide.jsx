// 메일 템플릿 라이브러리 사용 가이드 모달.
//
// 운영자(클라이언트)가 본 페이지를 처음 열어도 단독으로 활용할 수 있도록
// "이 페이지가 무엇이고, 어떤 순서로 쓰며, 데이터베이스가 어떻게 매칭되는지"
// 를 한 화면에서 설명합니다. 페이지 상단의 "사용 가이드" 버튼으로 열림.

export default function MailTemplatesGuide({ onClose }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide" style={{ maxWidth: 920 }}>
        <div className="adm-modal-head">
          <h2>메일 템플릿 라이브러리 — 사용 가이드</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div style={{ fontSize: 13.5, color: '#2a2724', lineHeight: 1.85, wordBreak: 'keep-all' }}>

          <Section title="이 페이지는 어떤 곳인가요?">
            <p>
              여러 개의 <strong>이메일 템플릿</strong>을 저장해 두고, 필요할 때 골라서 한 번에 다수에게 발송하는 페이지입니다.
              상담 자동회신(<code>/admin/mail</code>) 과는 다른 페이지로, 자동회신은 1개 템플릿만 두고 문의 접수 시 자동 발송되며,
              여기는 <strong>여러 개</strong>를 저장해 두고 사람이 직접 선택해 발송합니다.
            </p>
          </Section>

          <Section title="3단계 빠른 시작">
            <ol style={listStyle}>
              <li><strong>템플릿 만들기</strong> — 우상단 <em>+ 새 템플릿</em>. 또는 기본 시드 10종 중 골라 수정.</li>
              <li><strong>수신자 데이터 소스 선택</strong> — "단체 발송" 패널에서 CRM/파트너/문의자/구독자 중 선택, 또는 직접 입력.</li>
              <li><strong>발송</strong> — 미리보기 확인 후 "N명에게 발송" 클릭. 변수는 자동 치환.</li>
            </ol>
          </Section>

          <Section title="변수 시스템 — {{변수명}} 으로 개인화">
            <p>
              본문이나 제목에 <code>{`{{이름}}`}</code> 처럼 변수를 넣으면, 발송 시 수신자별 데이터로 자동 치환됩니다.
              예를 들어 <code>{`안녕하세요 {{이름}}님`}</code> 라고 적으면 홍길동 고객에게는 "안녕하세요 홍길동님",
              김철수 고객에게는 "안녕하세요 김철수님" 으로 발송됩니다.
            </p>
            <p>
              템플릿 편집 화면에서 <strong>변수 chip 패널</strong>이 자동으로 표시되며, 클릭하면 마지막으로 포커스된 필드(제목 또는 본문)에 자동 삽입됩니다.
              없는 변수가 필요하면 <em>+ 사용자 정의 변수</em> 로 추가할 수 있어요.
            </p>
            <p style={{ background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a', fontSize: 12.5 }}>
              <strong>변수 그룹</strong>: 수신자(이름·이메일·전화·회사) / 발주(발주번호·접수일·합계금액 등) /
              일정(일시·장소) / 이벤트(시작일·종료일·혜택) / 운영변동(휴무명·지연사유·재개일 등) / 링크(상세링크).
            </p>
          </Section>

          <Section title="데이터베이스 연동 — 어떻게 매칭되는지">
            <p>
              "수신자 데이터 소스" 를 선택하면 시스템이 해당 저장소에서 레코드를 가져와 <strong>변수에 자동 매핑</strong>합니다.
              아래 표가 매칭 관계입니다:
            </p>
            <div style={{ overflowX: 'auto', marginTop: 10, border: '1px solid #d7d4cf' }}>
              <table className="adm-guide-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 110 }}>데이터 소스</th>
                    <th style={{ minWidth: 150 }}>저장 위치</th>
                    <th>{`{{이름}}`}</th>
                    <th>{`{{이메일}}`}</th>
                    <th>{`{{전화}}`}</th>
                    <th>{`{{회사}}`}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>직접 입력</strong></td>
                    <td><span style={{ color: '#8c867d' }}>(textarea 입력)</span></td>
                    <td>—</td><td>입력값</td><td>—</td><td>—</td>
                  </tr>
                  <tr>
                    <td><strong>CRM 고객</strong></td>
                    <td><code>daemu_crm</code></td>
                    <td><code>name</code></td>
                    <td><code>email</code></td>
                    <td><code>phone</code></td>
                    <td><code>company</code></td>
                  </tr>
                  <tr>
                    <td><strong>파트너사</strong></td>
                    <td><code>daemu_partners</code></td>
                    <td><code>person</code></td>
                    <td><code>email</code></td>
                    <td><code>phone</code></td>
                    <td><code>name</code></td>
                  </tr>
                  <tr>
                    <td><strong>문의자</strong></td>
                    <td><code>daemu_inquiries</code></td>
                    <td><code>name</code></td>
                    <td><code>email</code></td>
                    <td><code>phone</code></td>
                    <td>—</td>
                  </tr>
                  <tr>
                    <td><strong>뉴스레터 구독자</strong></td>
                    <td><code>daemu_subscribers</code></td>
                    <td><code>name</code></td>
                    <td><code>email</code></td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11.5, color: '#8c867d', marginTop: 6 }}>
              읽는 법: 첫 번째 줄 — CRM 고객 발송 시 <code>{`{{이름}}`}</code> 자리에 각 고객의 <code>name</code> 필드 값이 자동으로 들어감. 매 수신자마다 다름.
            </p>
            <p style={{ marginTop: 12 }}>
              예) CRM 고객을 선택하면 <code>{`{{이름}}`}</code> 자리에 각 고객의 <strong>name</strong> 필드가 자동으로 들어갑니다.
              파트너사는 <code>person</code>(담당자) 이 이름이 되고, <code>name</code>(회사명) 이 회사가 됩니다.
            </p>
            <p style={{ background: '#eef6ee', padding: '10px 14px', borderLeft: '3px solid #2e7d32', fontSize: 12.5, marginTop: 10 }}>
              <strong>관리자 계정은 절대 포함되지 않습니다.</strong>
              관리자는 별도 저장소(<code>admin_users</code>) 에 있어서 위 5개 소스 어디에도 나타나지 않습니다.
            </p>
            <p style={{ background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a', fontSize: 12.5, marginTop: 10 }}>
              매핑되지 않는 변수(예: <code>{`{{발주번호}}`}</code>, <code>{`{{합계금액}}`}</code>) 는 발송 패널 하단에 "기본값 입력란"이 자동으로 등장합니다.
              여기에 한 번 입력한 값이 <strong>모든 수신자에게 동일하게</strong> 적용됩니다.
            </p>
          </Section>

          <Section title="분류별 일괄 추가 (직접 입력 모드)">
            <p>
              "직접 입력" 모드에서는 textarea 위에 6개 분류 버튼이 표시됩니다. 클릭 시 해당 그룹의 이메일이 한 번에 추가되며, 중복은 자동 제거됩니다:
            </p>
            <ul style={listStyle}>
              <li><strong>CRM 활성 고객</strong> — 진행 중 고객(lead·qualified·customer)</li>
              <li><strong>CRM 전환 고객만</strong> — 실제 거래로 이어진 고객</li>
              <li><strong>활성 파트너</strong> — 비활성화되지 않은 파트너</li>
              <li><strong>뉴스레터 구독자</strong> — 수신거부하지 않은 구독자</li>
              <li><strong>답변완료 문의자</strong> — 응대 끝낸 문의자</li>
              <li><strong>최근 30일 문의자</strong> — 최근 한 달 사이 문의 접수</li>
            </ul>
            <p>여러 그룹을 누적해서 추가할 수 있고, 추가된 인원수는 toast 알림으로 확인됩니다.</p>
          </Section>

          <Section title="이미지·링크 삽입">
            <p>본문 편집 영역 위에 <strong>+ 이미지 삽입</strong>, <strong>+ 링크 삽입</strong> 버튼이 있습니다.</p>
            <ul style={listStyle}>
              <li><strong>이미지</strong> — 미디어 라이브러리 픽커가 열림 → 라이브러리에서 선택 또는 신규 업로드 → 자동으로 <code>![](URL)</code> 삽입</li>
              <li><strong>링크</strong> — URL 입력 → 표시할 텍스트 입력 → <code>[자세히 보기](URL)</code> 삽입</li>
            </ul>
            <p>
              "실시간 미리보기" 토글을 켜두면 작성하면서 결과를 즉시 확인할 수 있습니다.
              발송 시 이미지·링크가 실제 메일에서도 동일하게 렌더링됩니다.
            </p>
          </Section>

          <Section title="운영 변동 대응 (휴무·지연·중단)">
            <p>
              발주 마감 / 공휴일 휴무 / 택배사 지연 / 시스템 점검 / 정상 재개 등 운영 변동 상황용 템플릿 5종이 기본 시드로 제공됩니다.
              필요한 시점에 골라서 변수만 채우고 발송하면 됩니다.
            </p>
            <p>
              예시 흐름 — <em>택배사 사정 — 배송 지연 안내</em>:
            </p>
            <ol style={listStyle}>
              <li>템플릿 선택</li>
              <li>발송 패널에서 매핑 안 된 변수의 기본값 입력 ({`{{지연사유}}`}, {`{{영향지역}}`}, {`{{변경도착예정일}}`} 등)</li>
              <li>수신자 데이터 소스 = 활성 파트너 / 또는 영향받은 발주자만 직접 입력</li>
              <li>미리보기 확인 → 발송</li>
            </ol>
          </Section>

          <Section title="시뮬레이션 vs 실제 발송">
            <p>
              백엔드의 <code>RESEND_API_KEY</code> 환경변수가 등록되지 않은 상태에서는 <strong>시뮬레이션 모드</strong>로 동작합니다.
              모든 발송은 Outbox(<code>/admin/outbox</code>) 에 <em>simulated</em> 상태로 기록만 되고 실제 메일은 나가지 않습니다.
            </p>
            <p>
              실제 운영에서 메일을 발송하려면:
            </p>
            <ol style={listStyle}>
              <li>Resend 가입 + API 키 발급 (<a href="https://resend.com/signup" target="_blank" rel="noopener noreferrer" style={{ color: '#1f5e7c' }}>resend.com</a>)</li>
              <li>도메인 verify (SPF/DKIM/DMARC TXT 레코드 등록)</li>
              <li>서버 환경변수 <code>RESEND_API_KEY</code> 등록</li>
              <li>발송 패널 상단 노란색 안내 박스가 사라지면 활성화 완료</li>
            </ol>
            <p style={{ fontSize: 12.5, color: '#8c867d' }}>
              자세한 절차는 별도 문서 <code>RESEND_INTEGRATION.md</code> 참고.
            </p>
          </Section>

          <Section title="자주 묻는 질문">
            <Faq q="템플릿을 잘못 만들었어요. 되돌릴 수 있나요?">
              직접 만든 템플릿은 <em>삭제</em> 또는 <em>수정</em> 가능. 시드 5+5종은 삭제해도 페이지 새로고침 시 자동 복원됩니다.
            </Faq>
            <Faq q="이메일 형식이 잘못된 항목은 어떻게 되나요?">
              발송 대상에서 자동 제외됩니다 (정규식 검증). 분류별 일괄 추가 시에도 잘못된 형식은 들어오지 않습니다.
            </Faq>
            <Faq q="100명 넘게 한 번에 보내도 되나요?">
              가능합니다. 백엔드가 100건씩 자동 chunk 분할해 Resend Batch API 로 발송합니다.
              개별 메일은 <strong>1:1 단건 발송</strong>이며 BCC 로 묶이지 않아 개인정보가 누출되지 않습니다.
            </Faq>
            <Faq q="발송 후 결과는 어디서 확인하나요?">
              <code>/admin/outbox</code> 페이지에서 누적 이력 확인. 실패 건은 <code>/admin/monitoring</code> 의 이슈 피드에서도 확인됩니다.
            </Faq>
            <Faq q="수신자가 메일을 안 받았다고 해요.">
              ① Outbox 에서 발송 상태 확인 (sent / failed / simulated) ② 실패 시 Monitoring 에서 사유 확인 ③ 시뮬레이션 모드면 RESEND_API_KEY 등록 후 재발송 ④ 도메인 SPF/DMARC 가 verify 되었는지 확인 (스팸함으로 분류된 가능성).
            </Faq>
          </Section>

        </div>

        <div className="adm-action-row">
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

const listStyle = {
  paddingLeft: 20,
  margin: '6px 0 12px',
  lineHeight: 2,
};

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 26, paddingBottom: 18, borderBottom: '1px solid #ece9e2' }}>
      <h3 style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontSize: 18, fontWeight: 500, margin: '0 0 10px',
        color: '#231815', letterSpacing: '-.005em',
      }}>{title}</h3>
      {children}
    </section>
  );
}

function Faq({ q, children }) {
  return (
    <details style={{ marginBottom: 8, padding: '8px 12px', background: '#f6f4f0', border: '1px solid #e6e3dd', borderRadius: 3 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#231815' }}>{q}</summary>
      <div style={{ marginTop: 6, fontSize: 12.5, color: '#5a534b' }}>{children}</div>
    </details>
  );
}
