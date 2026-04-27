# Render 무료 백엔드 배포 — Python / FastAPI

`backend-py/`(FastAPI) 를 Render 무료 플랜에 배포합니다. 도메인 불필요.
구 `backend/`(Express)는 보관용으로만 두고 더 이상 사용하지 않습니다.

## 1. Render 가입
1. https://render.com → **Get Started for Free** (GitHub OAuth 로그인 권장)
2. 무료 플랜 선택 (신용카드 입력 안 받음)

## 2. Blueprint으로 한 번에 배포

저장소에 `render.yaml`(Python runtime)이 들어있어 Blueprint 모드로 자동 셋업됩니다.

1. 우상단 **+ New** → **Blueprint** 클릭
2. **Connect a repository**: `daemu-website` 검색·선택
3. **Apply** 클릭 → Render가 `render.yaml` 읽어서 `daemu-api` 서비스 자동 생성
4. **환경변수 입력** 화면에서:
   - `RESEND_API_KEY`: Resend 키 붙여넣기 (시크릿 — Blueprint에 평문으로 안 들어감)
   - 나머지 변수들은 자동 설정됨 (수정 불필요)
5. **Apply / Deploy** 클릭

빌드는 `pip install -r requirements.txt`, 실행은 `uvicorn main:app --host 0.0.0.0 --port $PORT` 로 자동 진행됩니다. 2~3분 걸립니다.

## 3. 헬스체크
```bash
curl https://daemu-api.onrender.com/api/health
# → {"ok":true,"runtime":"python-fastapi","resendConfigured":true, ...}
```

`runtime: python-fastapi` 가 보이면 Python 백엔드가 정상 가동 중입니다.

## 4. 기존 Render 서비스가 있다면

이전에 Node.js 버전으로 배포되어 있으면:
- 옵션 A (간편): 기존 서비스 삭제 → Blueprint 다시 적용 (URL 새로 받음)
- 옵션 B (URL 유지): Render Dashboard → daemu-api → **Settings**:
  - Runtime: `Python`
  - Build Command: `pip install -r requirements.txt`
  - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - Root Directory: `backend-py`
  - Environment에 `PYTHON_VERSION = 3.12.7` 추가
  - **Save Changes** → 자동 재배포

옵션 B가 GitHub Pages에 등록된 `VITE_API_BASE_URL` 을 그대로 쓸 수 있어 권장.

## 5. 무료 플랜 제약
- 15분 idle 후 sleep → 첫 호출 30~60초 콜드스타트 (이후 빠름)
- 750시간/월 무료
- 데모 시작 30초 전에 헬스체크 한 번 호출하면 깨워둘 수 있음
- **파일 시스템은 휘발성** — 업로드된 이미지는 재배포 시 삭제됨. 장기 보관 필요하면 S3/R2 연동 필요 (현재는 데모 시연 범위 내에서만 보관).

## 6. 환경 변수 변경 (도메인 발급 후)
도메인 인증 후 발신자 변경하려면:
- Render Dashboard → daemu-api → **Environment**
- `FROM_EMAIL` 값을 `DAEMU <noreply@yourdomain.com>` 로 수정
- 별도로 `PUBLIC_BASE_URL` 을 `https://api.yourdomain.com` 으로 설정하면 업로드 URL이 자기 도메인 기준으로 발급됨
- **Save Changes** → 자동 재배포

## 7. 로컬 개발

```bash
cd backend-py
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # RESEND_API_KEY 채워넣기
uvicorn main:app --reload --port 3000
```

## 8. 카페24로 이전 시 (장기 운영)
- `backend-py/` 를 카페24 Python 호스팅에 그대로 업로드
- `gunicorn` + `uvicorn.workers.UvicornWorker` 로 실행 (`gunicorn main:app -k uvicorn.workers.UvicornWorker -w 2`)
- Nginx 리버스 프록시 `/api` → `127.0.0.1:8000`
- Render 서비스 그때 삭제
