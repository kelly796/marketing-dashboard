# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Serve locally at http://localhost:4321
npm run build     # No-op (echoes "No build step required")
```

No test suite or linter is configured. Node 18+ is required (see `.nvmrc`).

Netlify functions are deployed automatically on push. To test functions locally, use Netlify CLI (`netlify dev`), which also requires the environment variables listed below.

## Architecture

This is a **single-file SPA** (`index.html`, ~2400 lines) backed by **Netlify serverless functions** (`netlify/functions/`). There is no build step — the HTML file is served directly.

### Frontend (`index.html`)

- **Data object:** `D` holds live data; `MOCK` is the hardcoded fallback. Code throughout uses `(D.instagramHQ || MOCK.instagramHQ)` pattern.
- **`DATA_SOURCE`** is set to `'Live'`, `'Cached'`, or `'Mock'` to reflect which data is shown.
- **Cache:** `localStorage` key `pm_hub_v4` with 4-hour TTL. Clear this key to force a fresh fetch.
- **`loadData(force=false)`** — main entry point. Checks cache, then calls `/.netlify/functions/get-data`, then supplements missing keys from `data/dashboard-data.json`, then falls back to `MOCK`.
- **`renderAll()`** — re-renders every section after data changes.
- **Charts:** Chart.js 4.4.0; all instances stored in `charts` object. `.destroy()` must be called before re-rendering a chart.
- **`D30`** — 30-element date label array used as the x-axis for all trend charts. Any `reachTrend` or similar array fed into these charts **must be exactly 30 elements**.
- **Design tokens:** CSS custom properties; dark navy/teal theme.

### Netlify Functions (`netlify/functions/`)

`get-data.js` is the aggregator — it calls all data sources in parallel and merges results into a single JSON response. It always returns HTTP 200, even on partial failure, so the frontend must handle missing keys gracefully.

Key functions:

| Function | Role |
|---|---|
| `get-data.js` | Aggregator — calls all sources, returns merged `{ instagramHQ, instagramOnline, facebook, meta, ga4, seo, clarity, ghl, … }` |
| `fetch-meta.js` | Meta Graph API v19.0 — derives Instagram Business Account ID from FB Page ID, fetches insights + media + ads |
| `fetch-ga4.js` | Google Analytics 4 via service account JWT |
| `fetch-gsc.js` | Google Search Console keywords |
| `fetch-clarity.js` | Microsoft Clarity analytics |
| `fetch-ghl.js` | Go High Level pipeline + contacts |
| `update-dashboard.js` | POST endpoint — same as `get-data.js` but called by the Refresh button |
| `maxx-report.js` | Generates AI marketing insights via Claude API |
| `exchange-token.js` | Converts short-lived Meta token → 60-day long-lived token |
| `check-apis.js` | Health check — tests each API connection individually |
| `ai-*.js` (5 files) | Claude-powered content generation (SEO, ads, email, insights) |
| `google-auth.js` | Shared JWT helper for GA4 + GSC |

### Static Fallback Data

`data/dashboard-data.json` contains real PerforMotion Instagram data (10 posts) and is loaded as the first fallback when Netlify functions return incomplete data. Its schema must match the `MOCK` object structure in `index.html`. Critical constraints:
- `instagramHQ.reachTrend` — must be exactly 30 elements
- `instagramHQ.posts[].type` — must be `'reel'`, `'carousel'`, or `'post'`
- `facebook.reachTrend` — must be the same length as `instagramHQ.reachTrend`

### Environment Variables (set in Netlify)

Meta: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_HQ_PAGE_ID`, `META_ONLINE_PAGE_ID` (not yet set — handle gracefully)  
Google: `GA4_PROPERTY_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GSC_SITE_URL`  
Other: `CLARITY_API_KEY`, `CLARITY_PROJECT_ID`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `AC_API_KEY`, `AC_BASE_URL`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `WP_SITE_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`

`META_ACCESS_TOKEN` is a long-lived token (60-day expiry) that requires manual refresh via `meta-auth.html` + `exchange-token.js`.

## Custom Claude Code Commands

Three slash commands are defined in `.claude/commands/`:

- `/content-brief` — fetches live Instagram data, generates 3 content ideas each for HQ + Online accounts
- `/marketing-insights` — fetches full dashboard data, analyses all channels, produces a weekly report with wins, concerns, and 5 recommended actions
- `/seo-audit` — fetches SEO + GA4 data, scores health 0–100, identifies quick wins and strategic opportunities

## Deployment

Deployed on Netlify (site ID `1e5c7118-8333-4598-ab2d-f52506df749a`). `netlify.toml` configures:
- All `/api/*` requests rewrite to `/.netlify/functions/:splat`
- `fetch-site-audit` and `ai-seo-enhanced` have 26-second function timeouts (default is 10s)
- Node 18, esbuild bundler for functions

Pushes to `main` trigger an automatic deploy.
