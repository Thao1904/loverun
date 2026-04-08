# Love Running

Minimal mobile-first dashboard for a couple's shared Strava running goal.

## Features

- Daily couple dashboard in English with a Vietnamese toggle in the top-right corner.
- Shared heart progress based on the total kilometers run by both people today.
- Backend token exchange for two Strava connections: `you` and `partner`.
- Persistent shared goal, Strava app credentials, and Strava user tokens with Supabase support.
- Automatic Strava token refresh and live daily fetch for distance, average heart rate, calories, and heart-rate streams.
- Estimated steps based on cadence because Strava does not expose direct step totals in the public API.
- Locked "heartbeat song" area that unlocks after the shared goal is complete.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. For local dev, set `VITE_API_BASE_URL=http://localhost:8787`. For Render deployment, leave it empty so the frontend uses same-origin `/api`.
4. Start both frontend and backend with `npm run dev`.

## Persistent storage setup

### Supabase for shared goal, Strava app credentials, and Strava tokens

Create these tables in Supabase:

```sql
create table if not exists public.strava_app_credentials (
  athlete_key text primary key,
  client_id text not null,
  client_secret text not null,
  redirect_uri text not null,
  updated_at timestamptz default now()
);

create table if not exists public.strava_tokens (
  athlete_key text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  scope text,
  athlete_id bigint,
  athlete_firstname text,
  athlete_lastname text,
  athlete_profile text,
  updated_at timestamptz default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
```

Then set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STRAVA_APPS_TABLE=strava_app_credentials`
- `SUPABASE_STRAVA_TOKENS_TABLE=strava_tokens`
- `SUPABASE_SETTINGS_TABLE=app_settings`

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in frontend code.

## Deploy on Render

1. Push this repo to GitHub. It is already available at [Thao1904/loverun](https://github.com/Thao1904/loverun).
2. In Render, create a new Blueprint or Web Service from that repo.
3. Use the included [render.yaml](/Users/mee/Downloads/loverun/render.yaml) to create a Node web service on Render free.
4. Because shared goal, Strava app credentials, and tokens now live in Supabase, you can stay on Render free and do not need Render disk persistence.
5. Set these environment variables in Render:
   `APP_WEB_ORIGIN=https://your-service-name.onrender.com`
   plus the Supabase env vars above
6. After the first deploy, open `/dashboard`, save the Strava app credentials for `you` and/or `partner`, then connect those Strava accounts.

## Strava authorization notes

- In Strava API settings, use your Render domain as the callback domain.
- For each runner, save the exact redirect URI you want to use, for example `https://your-service-name.onrender.com/dashboard`, in the app's Strava credentials modal.
- Frontend initiates authorization on `/dashboard` using the saved `client_id` and `redirect_uri` for that runner and receives the returned `code` there.
- The frontend then posts `code` plus `state=you|partner` to the backend endpoint `/api/strava/exchange`.
- Backend exchanges and refreshes tokens using the stored Strava app credentials for that runner.
- Local backend stores fallback credentials/tokens in `./data/app-state.json` and `./data/strava-tokens.json` if Supabase is not configured.
- With Supabase configured, goal, credentials, and tokens persist independently of Render restarts.
- Suggested scopes for this dashboard: `read`, `profile:read_all`, `activity:read_all`.

## Live data behavior

- Backend fetches today's running activities from Strava using your configured timezone.
- Supported running types are `Run`, `TrailRun`, and `VirtualRun`.
- Calories and average heart rate are summed/weighted from today's activities.
- Heart-rate streams are collected from up to 3 recent runs today and used by the in-browser generated song.
- Steps are estimated from `average_cadence * 2 * moving_time / 60`.
- Shared goal is saved through `/api/goal`.
- If Supabase env vars are missing, the app falls back to local file storage.

## Main files

- Frontend dashboard: `/Users/mee/Downloads/loverun/src/App.tsx`
- Frontend API client: `/Users/mee/Downloads/loverun/src/api.ts`
- Local backend server: `/Users/mee/Downloads/loverun/server.mjs`
- Shared backend logic: `/Users/mee/Downloads/loverun/backend/core.mjs`
- Render blueprint: `/Users/mee/Downloads/loverun/render.yaml`
- Environment example: `/Users/mee/Downloads/loverun/.env.example`
