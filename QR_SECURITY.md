# QR 코드 보안 — 위변조 방지 + 추적 안전성

UTM 빌더의 QR 코드는 마케팅 캠페인 추적용 URL 을 인쇄·SNS 공유용 이미지로
변환하는 기능입니다. 본 문서는 그 QR 의 **위변조 방지·암호화·추적
안전성** 설계 원칙과 구현 단계를 정의합니다.

## 1. 위협 모델 (어떤 공격을 막아야 하나)

| 위협 | 시나리오 | 방어 |
|---|---|---|
| **URL 위변조** | 인쇄된 QR 위에 다른 QR 스티커를 덧붙여 사용자를 피싱 사이트로 유도 | 우리 도메인의 short link 만 사용 + DMARC + 브랜드 가시화 |
| **파라미터 변조** | 스캐너가 utm_* 를 임의로 바꿔 통계 오염 | HMAC 서명 검증 — 변조된 값이면 무효 처리 |
| **재사용 / 무한 클릭** | 만료된 캠페인 URL 을 누군가 계속 사용 | `expires_at` 만료 + click_count 한도 |
| **수신자 식별** | URL 에 메일 주소 등 PII 가 들어가는 경우 | URL 에 PII 절대 포함 금지 — 익명 short id 만 |
| **피싱 redirect** | 우리 short link 가 임의 외부 URL 로 redirect 되도록 누군가 바꿈 | target_url 은 작성자 본인만 수정 가능 + audit log |

## 2. 추천 아키텍처: 서명된 short link + 서버 redirect

QR 에는 URL 을 직접 인코딩하지 않고, **우리 도메인의 short link** 를
인코딩합니다. 클라이언트가 그 link 를 따라가면 서버가 서명 검증 후
실제 URL 로 redirect.

```
[QR 인코딩 값]                        [서버 처리]                   [최종 도착]
https://daemu.kr/r/8ZkP4a              GET /api/r/8ZkP4a            https://daemu.kr/event/spring
                          ───────▶    1. shortId 로 ShortLink 조회
                                      2. expires_at 검증
                                      3. HMAC 서명 검증
                                      4. click_count++ 로깅
                                      5. 302 → target_url
```

QR 자체는 단순 short URL 만 담아 사람이 봐도 무엇인지 모릅니다. 이상한
target_url 로 누군가 바꾸려면 인증된 어드민 권한 + 서버 데이터 변경이
필요. 단순 이미지 위 스티커 공격은 **우리 도메인이 아닌 URL** 을 가리켜
사용자가 도메인 mismatch 로 인지 가능.

## 3. 데이터 모델 (백엔드)

```python
class ShortLink(Base):
    __tablename__ = "short_links"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    short_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    target_url: Mapped[str] = mapped_column(Text)
    sig: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256(target_url + short_id, server_secret)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    click_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int] = mapped_column(ForeignKey("admin_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    label: Mapped[str] = mapped_column(String(120), default="")  # UI 라벨
```

**short_id 생성**: `secrets.token_urlsafe(8)` — 약 12자, ~70bit 엔트로피.
충돌 검사 + 재시도. 추측 가능성 사실상 0.

**HMAC 서명**: 서버 시크릿(`SHORT_LINK_HMAC_SECRET` env, 32+ bytes
random) 으로 `target_url + short_id` 를 SHA-256 HMAC. DB 가 직접 유출되어도
서명 위조 불가. 서명 검증 실패 시 자동 revoke + alert.

## 4. 클라이언트 흐름 (UTM 빌더)

1. 운영자가 UTM URL 생성 + "QR 만들기" 클릭
2. POST `/api/short-links` `{ target_url, label, expires_at?, max_clicks? }`
3. 서버 응답 `{ short_id, signed_url: "https://daemu.kr/r/8ZkP4a", expires_at }`
4. **signed_url 만** QR 에 인코딩 — target_url 은 인코딩하지 않음
5. 다운로드 PNG/SVG 에 caption 으로 "scan to: daemu.kr/r/8ZkP4a" 표시

## 5. 추가 안전 장치

- **HTTPS 전용** — `/r/{shortId}` 는 HTTP 접근 차단 (HSTS)
- **Referrer-Policy: no-referrer-when-downgrade** — referrer leak 방지
- **rate limit** — IP 당 분당 60회 redirect (botnet 우회 차단)
- **클릭 로그 PII-free** — IP 는 hash, UA 는 family 단위로만 저장
- **revoke 기능** — 어드민에서 즉시 무효화 (revoked_at 채워지면 410 Gone)
- **만료 후 redirect 금지** — expires_at 초과 시 410 Gone + 안내 페이지
- **target_url 화이트리스트** — http(s) + 우리 도메인 외부도 OK 이지만 `javascript:`, `data:`, `file:` 차단 (validateOutboundUrl 재사용)
- **brand 표시** — QR 스캔 후 redirect 시 1초간 "DAEMU 로 이동 중" 인터스티셜 표시 (피싱 인지 가시화)

## 6. 어드민 UI

- `/admin/utm-builder` 의 QR 패널에서:
  - "QR 만들기" 버튼 → backend 호출 → short_id 생성 + QR 표시
  - "QR 다운로드 (PNG/SVG)" — 인쇄용 자료
  - "만료일 / 최대 클릭 수" 옵션
  - 생성된 short link 의 click_count, last_click_at 실시간 확인
  - "비활성화" 버튼 — 즉시 revoke

## 7. 운영 모니터링

`/admin/monitoring` 에 새 카드:
- `Short link 통계` — 생성·활성·만료·revoke 수
- `의심 클릭` — 동일 IP 가 분당 5회+ → 의심
- `Click 추이` — 일자별 그래프

## 8. 구현 단계 (현재 상태 → 목표)

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | UTM 빌더 자체 (URL 조립) | ✅ 구현 완료 (`/admin/utm-builder`) |
| 1 | 단순 QR 생성 (URL 직접 인코딩) | 🔄 본 패치에서 lib/qrCode.js 까지 도입 |
| 2 | ShortLink 모델 + `/api/short-links` POST | ⏳ 본 문서 기반으로 백엔드 구현 |
| 3 | `/api/r/{short_id}` 서버 redirect + 서명 검증 | ⏳ |
| 4 | QR 패널을 short link 발급 + 검증된 URL 인코딩으로 전환 | ⏳ |
| 5 | 클릭 통계 + revoke + 모니터링 통합 | ⏳ |

**현 단계의 보안 등급**: ⚠️ Stage 1. URL 직접 인코딩 — 위변조에 취약하나 PII 없으므로 영향 제한적. Stage 2+ 도입 전까지는 인쇄 캠페인용으로만 제한적 사용 권장.

## 9. 환경변수 추가 (Stage 2 이후)

```
SHORT_LINK_HMAC_SECRET=<32+ bytes random base64>   # HMAC 서명 키
SHORT_LINK_BASE=https://daemu.kr/r/                  # short link prefix (도메인 확보 후)
SHORT_LINK_DEFAULT_TTL_DAYS=90                       # 기본 만료 기간
```

도메인이 확정되면 위 env 값을 채우고 Render dashboard 또는 Cafe24 VPS
`/etc/daemu-api.env` 에 등록.
