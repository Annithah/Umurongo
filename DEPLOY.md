# Deploying Umurongo

API and PostgreSQL on **Render**, web app on **Vercel**. Both have free plans.
Render's free PostgreSQL expires after 30 days, which is enough for a pitch, not for a pilot.

## 1. API and database on Render

1. Go to <https://dashboard.render.com>, choose **New > Blueprint** and pick this repository.
   Render reads `render.yaml` and proposes `umurongo-db` (PostgreSQL) and `umurongo-api` (web service).
2. Render generates `JWT_SECRET` and `SMS_WEBHOOK_SECRET`. Fill in the two values it asks for:
   - `CORS_ORIGIN`: leave `https://example.com` for now, you set the Vercel URL in step 3.
   - `PUBLIC_WEB_URL`: the same, for now.
3. Click **Apply**. The build runs `npm ci` and `prisma migrate deploy`. Wait for **Live**.
4. Open `https://<your-api>.onrender.com/api/health`. Expect `{"ok":true,"db":true,...}`.

Note: the pilot 1 migration clears the data of the earlier demo model (it could not be converted).
Load the demo data again after deploying (step 4).

Free Render services sleep after 15 minutes without traffic and take about a minute to wake up.
Open `/api/health` a few minutes before a demo.

## 2. Web app on Vercel

1. Go to <https://vercel.com/new> and import this repository.
2. **Root Directory**: the repository root (`vercel.json` sets the build).
3. **Environment variables**:
   - `VITE_API_URL` = `https://<your-api>.onrender.com`
   - `VITE_DEMO_MODE` = `true` (one-click demo accounts on the sign-in page; `false` for a real hospital)
4. **Deploy**. You get `https://<your-app>.vercel.app`.

## 3. Connect the two

In Render, `umurongo-api` > **Environment**, set both `CORS_ORIGIN` and `PUBLIC_WEB_URL` to the
Vercel URL (no trailing slash). `PUBLIC_WEB_URL` is used in the QR code and SMS links, so it must
be the address patients open. Save, and Render redeploys.

## 4. Load the demo data

The reset endpoint needs a hospital admin. After the first deploy, the database is empty, so seed it
once from your computer with the Render database URL (Render > `umurongo-db` > External URL):

```bash
DATABASE_URL="<external database URL>" npm run db:seed
```

Later resets: sign in as `admin@masaka.demo` and use **SMS messages > Reset demo**, or:

```bash
TOKEN=$(curl -s -X POST https://<api>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@masaka.demo","password":"demo1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -X POST https://<api>/api/dev/reset -H "Authorization: Bearer $TOKEN"
```

## 5. Check before the demo

| Open | Expect |
|---|---|
| `https://<app>/staff` | Sign-in page with the demo account buttons |
| `https://<app>/tv` | TV board. Click **Fungura ijwi · Turn on sound** once |
| A ticket link from reception | The patient page, in Kinyarwanda |

## Real SMS (later sprint)

Keep `SMS_MODE=simulate` until the provider account and sender ID are approved. Then set
`SMS_MODE=live`, `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY`, and in the
Africa's Talking dashboard point the delivery-report and incoming-message callbacks to:

```
https://<api>/api/sms/delivery?secret=<SMS_WEBHOOK_SECRET>
https://<api>/api/sms/inbound?secret=<SMS_WEBHOOK_SECRET>
```

## Background jobs

They run inside the API (`JOBS_ENABLED=true`): SMS outbox every 15 seconds, daily close every
minute, phone-number retention every hour. A PostgreSQL lock makes sure only one instance runs a job.
To run one from a hosted cron instead: `npm run job -- retention` (or `daily-close`, `sms-outbox`).

## Updating

Push to `main`: Render and Vercel redeploy. New migrations are applied by Render's build command.
