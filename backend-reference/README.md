# DAEMU Backend Reference

프론트엔드는 모든 발송을 `POST /api/email/send` / `POST /api/email/campaign` 으로 위임합니다. 이 폴더는 그 백엔드를 어떻게 만들면 되는지에 대한 **레퍼런스 구현**입니다.

## 권장 스택

| 호스팅 | 비용 | 셋업 난이도 | 추천도 |
|---|---|---|---|
| **Cloudflare Workers** | 100k req/일 무료 | 5분 | ⭐⭐⭐ 가장 추천 |
| **Vercel Functions** | 100k inv/월 무료 | 10분 | ⭐⭐⭐ |
| **카페24 클라우드 + Node.js** | 클라우드 베이직 11k원/월 | 30분 | ⭐⭐ (호스팅이 카페24 강제 시) |
| **AWS Lambda + API Gateway** | 1M req/월 무료 | 1시간+ | ⭐ (대량 운영) |

## 권장 이메일 서비스

| 서비스 | 무료 | 특징 |
|---|---|---|
| **Resend** ⭐ | 3,000/월 | 가장 모던, React Email 지원, 깔끔한 API |
| **Brevo** | 300/일 영구 | 한국 보편, SMS+이메일+마케팅 통합 |
| **SendGrid** | 100/일 영구 | 글로벌 표준, 오래됨 |
| **MailerSend** | 3,000/월 | 한국 사용자 많음 |
| **AWS SES** | 200/일 + $0.10/1k | 대량 발송 시 가장 저렴 |

→ **Resend 추천**. 개발 친화적이고 무료 티어 넉넉함. 

---

## Cloudflare Workers + Resend 예시

가장 가성비 좋은 조합입니다. 무료, 글로벌 CDN edge에서 실행, 5분 셋업.

### 셋업

```bash
npm create cloudflare@latest daemu-api
cd daemu-api
npm install resend
```

### `src/index.ts`

```typescript
import { Resend } from 'resend';

interface Env {
  RESEND_API_KEY: string;
  ALLOWED_ORIGIN: string; // 예: "https://daemu.kr,http://localhost:8765"
}

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim());
    const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || '';

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowOrigin) });
    }

    const url = new URL(req.url);
    const resend = new Resend(env.RESEND_API_KEY);

    try {
      if (url.pathname === '/api/email/send' && req.method === 'POST') {
        const { to, toName, subject, body, replyTo } = await req.json();
        const result = await resend.emails.send({
          from: 'DAEMU <noreply@daemu.kr>', // 도메인 인증 필요
          to: [to],
          subject,
          text: body,
          replyTo
        });
        if (result.error) {
          return json({ ok: false, error: result.error.message }, 500, allowOrigin);
        }
        return json({ ok: true, id: result.data?.id }, 200, allowOrigin);
      }

      if (url.pathname === '/api/email/campaign' && req.method === 'POST') {
        const { recipients, subject, body, replyTo } = await req.json();
        let sent = 0, failed = 0;
        for (const r of recipients) {
          try {
            await resend.emails.send({
              from: 'DAEMU <noreply@daemu.kr>',
              to: [r.email],
              subject: applyVars(subject, { name: r.name }),
              text: applyVars(body, { name: r.name }),
              replyTo
            });
            sent++;
          } catch { failed++; }
        }
        return json({ ok: true, sent, failed }, 200, allowOrigin);
      }

      return json({ ok: false, error: 'not found' }, 404, allowOrigin);
    } catch (err: any) {
      return json({ ok: false, error: String(err?.message || err) }, 500, allowOrigin);
    }
  }
} satisfies ExportedHandler<Env>;

function json(data: any, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}
```

### 배포

```bash
# 환경변수 등록 (Cloudflare Dashboard에서도 가능)
wrangler secret put RESEND_API_KEY     # Resend API 키
wrangler secret put ALLOWED_ORIGIN     # https://daemu.kr,http://localhost:8765

# 배포
wrangler deploy
```

배포 후 받은 URL (예: `https://daemu-api.your-subdomain.workers.dev`)를 사이트 `.env`에 등록:

```env
VITE_API_BASE_URL=https://daemu-api.your-subdomain.workers.dev
```

`npm run build && npm run preview` → 이제 모든 발송이 실제 Resend로 나갑니다.

---

## Resend 설정

1. https://resend.com 가입 (무료)
2. **Domains → Add Domain** → 도메인 추가 (DNS 인증 — TXT/MX 레코드)
   - 도메인 없으면 `onboarding@resend.dev`를 from으로 사용 가능 (테스트 한정)
3. **API Keys → Create API Key** → "Sending access" 선택 → 키 복사
4. 위 Workers `RESEND_API_KEY`에 입력

---

## Vercel Functions 대안

`api/email/send.ts`:

```typescript
import { Resend } from 'resend';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const { to, toName, subject, body, replyTo } = await req.json();

  const resend = new Resend(process.env.RESEND_API_KEY!);
  const result = await resend.emails.send({
    from: 'DAEMU <noreply@daemu.kr>',
    to: [to], subject, text: body, replyTo
  });

  return Response.json({ ok: !result.error, id: result.data?.id, error: result.error?.message });
}
```

Vercel 환경변수에 `RESEND_API_KEY` 등록 후 `vercel deploy`.

`.env`:
```env
VITE_API_BASE_URL=https://daemu-api.vercel.app
```

---

## 카페24 클라우드 + Express 대안

카페24 호스팅이 강제 사항이라면:

```bash
# 카페24 클라우드 SSH 접속
sudo apt install nodejs npm
npm install express resend cors
```

`server.js`:

```javascript
import express from 'express';
import cors from 'cors';
import { Resend } from 'resend';

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({ origin: ['https://daemu.kr', 'http://localhost:8765'] }));
app.use(express.json({ limit: '5mb' }));

app.post('/api/email/send', async (req, res) => {
  const { to, subject, body, replyTo } = req.body;
  const result = await resend.emails.send({
    from: 'DAEMU <noreply@daemu.kr>',
    to: [to], subject, text: body, replyTo
  });
  res.json({ ok: !result.error, id: result.data?.id, error: result.error?.message });
});

app.post('/api/email/campaign', async (req, res) => {
  const { recipients, subject, body, replyTo } = req.body;
  let sent = 0, failed = 0;
  for (const r of recipients) {
    try {
      await resend.emails.send({ from:'DAEMU <noreply@daemu.kr>', to:[r.email], subject, text:body, replyTo });
      sent++;
    } catch { failed++; }
  }
  res.json({ ok: true, sent, failed });
});

app.listen(3000, () => console.log('API on :3000'));
```

Nginx 리버스 프록시:
```nginx
location /api/ {
  proxy_pass http://localhost:3000;
}
```

---

## 비용 시나리오

월 1,000명 고객 기준:

| 구성 | 월 비용 |
|---|---|
| Cloudflare Workers (무료) + Resend (3k 무료) | **$0** |
| Vercel (무료) + Resend (3k 무료) | **$0** |
| 카페24 클라우드 베이직 + Resend (무료) | **₩11,000** |
| Cloudflare + Resend Pro (50k 메일) | **$20 ≈ ₩28,000** |

**1만 건/월 미만은 $0 운영 가능합니다.**
