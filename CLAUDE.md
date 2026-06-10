# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PerforMotion Marketing Dashboard — a live marketing analytics dashboard for a fitness studio. Deployed at https://monumental-syrniki-3b33aa.netlify.app (Netlify site ID: `1e5c7118-8333-4598-ab2d-f52506df749a`). GitHub repo: `kelly796/marketing-dashboard`.

The dashboard aggregates real-time data from Instagram, Facebook, Meta Ads, YouTube, ActiveCampaign, Google Analytics 4, and Google Search Console.

## Commands

```bash
npm run dev      # Serve locally on port 4321 (static file server, no transpilation)
npm run build    # No-op — no build step required
```

There are no lint or test commands. This is a vanilla JS/HTML project with no framework, no transpiler, and no bundler. Changes to `index.html` or `netlify/functions/` are live immediately on save.

To test Netlify functions locally, use the Netlify CLI (`netlify dev`), which is not in `package.json` but can be run via `npx netlify dev`.

## Architecture

### Single-file SPA + Serverless Backend

The entire frontend is `index.html` (~5700 lines of vanilla JS + inline CSS). There is no framework, no build step, and no separate JS files for the client. All API calls go through Netlify serverless functions in `netlify/functions/`.

```
index.html (client)
  └─ loadData() on DOMContentLoaded
       ├─ 1. Load ./data/dashboard-data.json (static fallback, loaded first)
       ├─ 2. Check localStorage cache (pm_dash_data_v2, 4-hour TTL)
       ├─ 3. Fetch /.netlify/functions/get-data (live aggregator)
       └─ 4. Fall back to MOCK object (inline in index.html)

netlify/functions/
  ├─ get-data.js           — main aggregator called on page load
  ├─ update-dashboard.js   — called by the Refresh button
  ├─ fetch-meta.js         — Instagram, Facebook, Meta Ads (Graph API v19.0)
  ├─ fetch-activecampaign.js
  ├─ fetch-youtube.js
  ├─ fetch-ga4.js
  ├─ fetch-gsc.js
  └─ ai-*.js               — Claude AI analysis endpoints
```

API routes are proxied: `/api/*` → `/.netlify/functions/:splat` (see `netlify.toml`).

### Key Global State (in index.html)

| Variable | Purpose |
|---|---|
| `D` | Live data object (null until loaded) |
| `MOCK` | Inline fallback data object |
| `DATA_SOURCE` | `'Live'`, `'Cached'`, or `'Mock'` |
| `BUILDERS` | Map of tab name → render function |
| `BUILT` | Tracks which tabs have been rendered (lazy-load) |
| `CHARTS` | Chart.js instances keyed by canvas ID |
| `D30` | 30-element array of date labels — all trend arrays must match this length |

### Tab System

Tabs are lazy-rendered: `BUILDERS['tab-name']()` runs once on first visit and sets `BUILT['tab-name'] = true`. Subsequent tab switches skip the builder. Tab names: `overview`, `content`, `hq-overview`, `website`, `activecampaign`, `leads`, `meta-ads`, `ad-build`, `goals`, `brand-strategy`.

### Data Fallback Chain & Cache

The `loadData()` function tries sources in order:
1. `./data/dashboard-data.json` — static fallback pre-loaded into memory
2. `localStorage` (`pm_dash_data_v2`) — 4-hour TTL; skipped if `isStaleMockCache()` returns true (detects cached MOCK by checking `dataSource === 'Mock'` or post IDs starting with `hq_p`)
3. `/.netlify/functions/get-data` — live API; on success, result is merged with static fallback to fill any missing keys
4. `MOCK` — hardcoded fallback of last resort

All render functions must use the fallback pattern:
```javascript
const d = D || MOCK;
const ig = d.instagramHQ || MOCK.instagramHQ;
```

### Data Schema Critical Constraints

- `instagramHQ.reachTrend`, `engagementTrend`, `impressionsTrend` must each be **exactly 30 elements** to align with `D30` labels
- `instagramHQ.posts[].type` must be `'reel'`, `'carousel'`, or `'post'` (enforced by `normaliseDashboardData()`)
- `normaliseDashboardData()` pads short trend arrays and validates post types — always runs on loaded data
- `pillarPerformance` can be `{}` (empty object) — `renderIGAnalytics()` must guard against this

### Instagram Account IDs

- `@performotion_hq` — Instagram Business Account ID: `17841480701347186`, Facebook Page ID: `877639932292270`
- `@performotion_online` — `META_ONLINE_PAGE_ID` not yet set; handle its absence gracefully

## Environment Variables

Set in Netlify site settings (not in `.env` files). Never commit values.

| Variable | Notes |
|---|---|
| `META_ACCESS_TOKEN` | Long-lived token, expires every ~60 days — **no auto-refresh** |
| `META_AD_ACCOUNT_ID` | `866923722901513` |
| `META_HQ_PAGE_ID` | `877639932292270` |
| `META_ONLINE_PAGE_ID` | Not yet set — functions must handle its absence |
| `AC_API_KEY`, `AC_BASE_URL` | ActiveCampaign |
| `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` | YouTube |
| `GA4_PROPERTY_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` | GA4 service account key is base64-encoded JSON |
| `GSC_SITE_URL` | Google Search Console |
| `WP_SITE_URL`, `WP_USERNAME`, `WP_APP_PASSWORD` | WordPress fallback for GA4 |
| `WINDSOR_API_KEY` | Optional enhanced Instagram analytics |
| `JOTFORM_API_KEY` | Lead form submissions |

## Design System

CSS custom properties defined in `index.html`:
- `--navy: #1B2A4A`, `--teal: #2ABFBF`, `--sand: #D4B896`, `--white: #FFFFFF`, `--grey: #F4F6F8`
- Font: Nunito Sans (Google Fonts CDN)
- Charts: Chart.js 4.4.0 (CDN)

## Custom Claude Skills

Three slash commands in `.claude/commands/`:
- `/marketing-insights` — fetches live data and generates a cross-channel report
- `/content-brief` — fetches live data and generates social content ideas based on top performers
- `/seo-audit` — fetches live data and runs a keyword/SEO health audit

All three hit `/.netlify/functions/get-data` directly and work with real live data.

## Deployment

Push to `main` triggers a Netlify deploy. The `sync-gymmaster-to-ac` function runs on a cron schedule (`0 18 * * *` — daily at 6 PM). The `fetch-site-audit` function has a 26s timeout; `sync-gymmaster-to-ac` has a 60s timeout.
