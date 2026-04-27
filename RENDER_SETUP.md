# Render 무료 백엔드 배포 — 5분 가이드

영구 URL을 받기 위해 Render.com 무료 플랜에 백엔드를 올립니다. 도메인 불필요.

## 1. Render 가입
1. https://render.com → **Get Started for Free** (GitHub OAuth 로그인 권장 — 한 번만 클릭하면 끝)
2. 무료 플랜 선택 (신용카드 입력 안 받음)

## 2. Blueprint으로 한 번에 배포

저장소에 `render.yaml`이 이미 있으니 Blueprint 모드로 자동 셋업됩니다.

1. 우상단 **+ New** → **Blueprint** 클릭
2. **Connect a repository**: `daemu-website` 검색·선택 (처음이면 GitHub 권한 승인)
3. **Apply** 클릭 → Render가 `render.yaml` 읽어서 `daemu-api` 서비스 자동 생성
4. **환경변수 입력** 화면에서:
   - `RESEND_API_KEY`: 받으신 새 Resend 키 붙여넣기
   - 나머지 변수들은 자동 설정됨 (수정 불필요)
5. **Apply / Deploy** 클릭

빌드 → 배포까지 2~3분 걸립니다. 진행 상황은 **Logs** 탭에서 실시간 확인.

## 3. 배포 URL 확인
완료되면 상단에 URL 표시됨, 예시:
```
https://daemu-api.onrender.com
```

또는 본인 이름 들어간 URL (예: `daemu-api-juyoung.onrender.com`).

## 4. 헬스체크
```bash
curl https://daemu-api.onrender.com/api/health
# → {"ok":true,"resendConfigured":true,"from":"DAEMU <onboarding@resend.dev>","allowedOrigins":[...]}
```

이 응답 확인되면 정상.

## 5. 저에게 보내실 것
배포된 URL 1개:
```
https://daemu-api.onrender.com  (실제 받으신 URL)
```

받으면 제가:
- GitHub repo Variables에 `VITE_API_BASE_URL` 등록
- demo 브랜치 자동 재배포 → Pages가 백엔드와 통신
- 검증 (Contact 폼 → 본인 메일함 도착)

## 6. 무료 플랜 제약 (참고)
- 15분 idle 후 sleep 모드 → 첫 호출 30초 콜드스타트 (이후 빠름)
- 750시간/월 무료 (한 인스턴스 24/7 가동에 충분)
- 데모 시작 30초 전에 헬스체크 한 번 호출하면 깨워둘 수 있음

## 7. 환경 변수 변경 (나중에)
도메인 인증 후 발신자 변경하려면:
- Render Dashboard → daemu-api → **Environment** 탭
- `FROM_EMAIL` 값을 `DAEMU <noreply@yourdomain.com>` 로 수정
- **Save Changes** → 자동 재배포

## 8. 카페24로 이전 시 (장기 운영)
프론트+백엔드를 카페24 클라우드 베이직에 올릴 예정이시라 했으니, 그때:
- backend/server.js를 카페24 Node.js 환경에서 PM2로 실행
- Nginx 리버스 프록시로 /api → :3000
- 또는 백엔드 코드를 PHP/기타로 포팅 (카페24 호스팅 종류에 따라)
- Render 서비스는 그때 삭제

자세한 셋업 가이드는 클라이언트 확정 후 도와드리겠습니다.
