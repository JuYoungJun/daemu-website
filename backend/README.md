# DAEMU Backend (local)

Express + Resend. Frontend의 `/api/email/send`, `/api/email/campaign` 호출을 받아 실제 메일을 발송합니다.

## 셋업

```bash
cd backend
npm install
```

`.env` 파일이 자동 생성되어 있습니다 (Resend 키 포함). 새로 받은 키로 변경하려면 `.env` 편집.

## 실행

```bash
npm start          # 한 번만 실행
npm run dev        # 코드 수정 시 자동 재시작 (--watch)
```

서버는 `http://localhost:3000` 에서 listen.

상태 확인:
```bash
curl http://localhost:3000/api/health
```

## 프론트엔드와 연결

루트 `.env`에 다음 한 줄:
```
VITE_API_BASE_URL=http://localhost:3000
```

프론트엔드 재빌드:
```bash
cd ..
npm run build && npm run preview
```

이제 Contact 폼 / 어드민 자동회신 / 캠페인 / 계약서 발송 모두 실제 Resend로 나갑니다.

## 발신자(From) 주의사항

Resend는 **도메인 인증 전에는** `onboarding@resend.dev` 발신만 허용하고, 수신자도 **계정에 등록된 본인 이메일로만** 보낼 수 있습니다 (보안용 샌드박스).

운영 시:
1. Resend 대시보드 → Domains → Add Domain → 본인 도메인 추가
2. DNS 레코드(TXT/MX) 등록
3. 인증 완료되면 `.env`의 `FROM_EMAIL`을 `DAEMU <noreply@daemu.kr>` 같이 변경
4. 이후엔 임의 수신자에게 발송 가능

## 향후 배포

운영 환경에선 이 코드를 그대로 다음 중 한 곳에 배포:
- **Cloudflare Workers** (5분, 무료) — `backend-reference/README.md` 참고
- **Vercel Functions** (10분, 무료)
- **카페24 클라우드 + Nginx 리버스 프록시** (호스팅 강제 시)

배포 후 프론트엔드 `.env`의 `VITE_API_BASE_URL`만 운영 URL로 변경.
