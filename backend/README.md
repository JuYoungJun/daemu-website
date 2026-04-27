# DAEMU Backend — DEPRECATED (Express)

> **이 디렉터리는 보관용입니다.** 실제 운영 백엔드는 `backend-py/`(Python / FastAPI) 입니다.
> Render 배포도 Python 백엔드로 자동 전환됩니다 (`render.yaml` 참고).
> 새 기능을 이 디렉터리에 추가하지 마세요.

## 왜 보관되어 있나
- Python 포팅 직전 동작하던 기준점 (롤백·비교용)
- API 계약(`/api/upload`, `/api/email/send`, `/api/email/campaign`) 호환 여부 검증 시 참조

## 새 백엔드로 이동
- 코드: `backend-py/main.py`
- 셋업: `backend-py/README.md`
- 배포: `RENDER_SETUP.md`

다음 정리 작업 때 이 디렉터리는 `_backup-static-...` 으로 옮길 예정입니다.
