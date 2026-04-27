# DAEMU Backend (Python / FastAPI)

Replaces the temporary Node.js (Express) backend with a production-style Python service.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/health`         | Service status + config snapshot |
| POST   | `/api/upload`         | base64 image upload → public URL |
| POST   | `/api/email/send`     | Single email via Resend |
| POST   | `/api/email/campaign` | Bulk send with 250ms throttle |
| GET    | `/uploads/{name}`     | Static serve (7-day cache) |

API contract is identical to the Express version, so the frontend (`src/lib/api.js`) needs zero changes.

## Local run

```bash
cd backend-py
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit .env with your Resend key
uvicorn main:app --reload --port 3000
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## Render deploy

The repo `render.yaml` is set to Python runtime. Connect the repo as a Render Blueprint, set `RESEND_API_KEY` as a secret env var in the dashboard.

```yaml
runtime: python
buildCommand: pip install -r requirements.txt
startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Security notes (demo posture)

- Filename sanitization + path-traversal guard
- 8MB upload cap, base64 validation
- CORS strict to `ALLOWED_ORIGINS`
- `from` / `reply_to` controlled server-side (clients can't spoof sender)
- Attachments capped at 12 per request
- No persistent DB — uploads write to local FS (Render free tier filesystem is ephemeral; for production use S3/R2)
- No auth on these endpoints — they assume the demo gate at `/admin` is sufficient. Add API keys before scaling beyond demo.
