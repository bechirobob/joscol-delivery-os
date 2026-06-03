# Render Free + Supabase Free production handoff

## Current status

The app can run locally with `JOSCOL_STORAGE_ADAPTER=json-file` and is prepared for Render + Supabase with `JOSCOL_STORAGE_ADAPTER=postgres`. No provider secrets are stored in the repo.

## Supabase setup

1. Create a Supabase project on the free plan.
2. Open SQL Editor and apply:
   - `supabase/migrations/20260603_joscol_delivery_os.sql`
3. In Project Settings, copy values directly into Render environment variables:
   - `JOSCOL_SUPABASE_URL` = project API URL
   - `JOSCOL_SUPABASE_SERVICE_ROLE_KEY` = service-role key
4. Keep row-level security enabled. Do not add anon public policies for JOSCOL operational tables; the Node server uses the service role server-side only.

## Render setup

Use `render.yaml` or create a Web Service manually:

- Runtime: Node
- Plan: Free
- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm run start`
- Health path: `/api/health`
- Node: `22`
- Required env:
  - `NODE_ENV=production`
  - `NODE_VERSION=22`
  - `HOST=0.0.0.0`
  - `PORT=10000`
  - `JOSCOL_STORAGE_ADAPTER=postgres`
  - `JOSCOL_SESSION_SECRET=<strong random secret>`
  - `JOSCOL_SUPABASE_URL=<from Supabase>`
  - `JOSCOL_SUPABASE_SERVICE_ROLE_KEY=<from Supabase>`
  - `JOSCOL_DISABLE_DEMO_LOGIN=true`
  - `JOSCOL_ALLOW_HEADER_AUTH=false`
  - `JOSCOL_ALLOW_PRODUCTION_RESET=false`
  - `JOSCOL_ALLOW_PRODUCTION_EXPORT=false`
  - `JOSCOL_DISPATCH_EMAIL`, `JOSCOL_DISPATCH_PASSWORD_SHA256`
  - `JOSCOL_RIDER_EMAIL`, `JOSCOL_RIDER_PASSWORD_SHA256`
  - `JOSCOL_OPS_EMAIL`, `JOSCOL_OPS_PASSWORD_SHA256`

Generate role password hashes locally without printing passwords into docs:

```bash
node -e "const {createHash}=require('node:crypto'); const p=process.argv[1]; if(!p) process.exit(1); console.log(createHash('sha256').update(p).digest('hex'))" 'temporary-password-here'
```

Paste only the hash into Render. Rotate review passwords before real customer data.

## Local JSON fallback warning

`JOSCOL_STORAGE_ADAPTER=json-file` is for local review or a single-node service with a persistent mounted volume via `JOSCOL_STATE_FILE`. Render Free filesystem is ephemeral, so production Render should use Supabase/Postgres.

## Optional notification/payment env seams

These are server-side placeholders today. Core order persistence never blocks on missing notification/payment providers.

- Email: `JOSCOL_RESEND_API_KEY`, `JOSCOL_NOTIFY_EMAIL_TO`
- WhatsApp: `JOSCOL_WHATSAPP_TOKEN`, `JOSCOL_WHATSAPP_PHONE_NUMBER_ID`
- SMS: `JOSCOL_SMS_PROVIDER`, `JOSCOL_SMS_API_KEY`
- Paystack: `JOSCOL_PAYSTACK_SECRET_KEY`, `JOSCOL_PUBLIC_URL`

Until provider credentials are configured and smoke-tested, `/api/health` reports them as skipped and `/api/payments/checkout` refuses to pretend live charges are enabled.

## Post-deploy verification

After Render deploy is live:

```bash
export JOSCOL_BASE_URL=https://your-render-service.onrender.com
curl -fsS "$JOSCOL_BASE_URL/api/health"
npm run smoke:auth
npm run smoke:roles
npm run smoke:gps
```

Then browser-check `/`, staff login, customer order creation, tracking, rider GPS controls, and console errors.
