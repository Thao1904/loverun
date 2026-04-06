# Love Running

Minimal mobile-first dashboard for a couple's shared Strava running goal.

## Features

- Daily couple dashboard in English with a Vietnamese toggle in the top-right corner.
- Shared heart progress based on the total kilometers run by both people today.
- Backend token exchange for two Strava connections: `you` and `partner`.
- Persistent shared goal backend with filesystem storage locally and Vercel Blob support in deployment.
- Automatic Strava token refresh and live daily fetch for distance, average heart rate, calories, and heart-rate streams.
- Estimated steps based on cadence because Strava does not expose direct step totals in the public API.
- Locked "heartbeat song" area that unlocks after the shared goal is complete.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `VITE_STRAVA_CLIENT_ID`.
4. Set `STRAVA_CLIENT_SECRET`.
5. Set `VITE_STRAVA_REDIRECT_URI` to your dashboard URL, for example `http://localhost:5173/dashboard`.
6. For local dev, set `VITE_API_BASE_URL=http://localhost:8787`. For Vercel deployment, leave it empty so the frontend uses same-origin `/api`.
7. Start both frontend and backend with `npm run dev`.

## Strava authorization notes

- In Strava API settings, use your dashboard domain as the callback domain.
- Keep the redirect URI on the dashboard, for example `https://yourdomain.com/dashboard`.
- If you deploy on Vercel, the included `vercel.json` rewrite keeps `/dashboard` routed to the SPA.
- Frontend initiates authorization on `/dashboard` and receives the returned `code` there.
- The frontend then posts `code` plus `state=you|partner` to the backend endpoint `/api/strava/exchange`.
- Local backend stores refresh/access tokens in `./data/strava-tokens.json`.
- If `BLOB_READ_WRITE_TOKEN` is set, the backend stores tokens and shared goal in Vercel Blob instead of local files.
- Suggested scopes for this dashboard: `read`, `profile:read_all`, `activity:read_all`.

## Live data behavior

- Backend fetches today's running activities from Strava using your configured timezone.
- Supported running types are `Run`, `TrailRun`, and `VirtualRun`.
- Calories and average heart rate are summed/weighted from today's activities.
- Heart-rate streams are collected from up to 3 recent runs today and used by the in-browser generated song.
- Steps are estimated from `average_cadence * 2 * moving_time / 60`.
- Shared goal is saved through `/api/goal`.

## Main files

- Frontend dashboard: `/Users/mee/Downloads/loverun/src/App.tsx`
- Frontend API client: `/Users/mee/Downloads/loverun/src/api.ts`
- Local backend server: `/Users/mee/Downloads/loverun/server.mjs`
- Shared backend logic: `/Users/mee/Downloads/loverun/backend/core.mjs`
- Vercel API routes: `/Users/mee/Downloads/loverun/api`
- Environment example: `/Users/mee/Downloads/loverun/.env.example`

# loverun
