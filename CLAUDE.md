# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

PerforMotion marketing dashboard — a single-page app (`index.html`) backed by Netlify serverless functions. It displays live Meta Ads, Instagram, Facebook, Google Analytics, Google Search Console, Microsoft Clarity, Go High Level CRM, and PageSpeed data for the PerforMotion fitness coaching business.

Live site: https://monumental-syrniki-3b33aa.netlify.app  
Netlify site ID: `1e5c7118-8333-4598-ab2d-f52506df749a`

## No Build Step

```
# Deploy is just a git push — Netlify picks it up automatically
git push origin main
```

There is no build, bundler, or test suite. Node 18 (`.nvmrc`). Functions are bundled by esbuild at deploy time via Netlify.

## Repository Structure

```
index.html                      # Entire dashboard — HTML + CSS + JS (~3,800 lines)
netlify/functions/              # Serverless functions (Node 18, CommonJS)
netlify.toml                    # Build config + redirect rules
data/dashboard-data.json        # Static fallback data (real IG posts, used when API fails)
data/maxx-report.json           # Static Maxx Report content
enquiry.html                    # Online coaching application form (pending move to own repo)
docs/                           # Design system docs, email sequences, Zapier scripts
.claude/commands/               # Custom Claude Code slash commands
```

## Netlify Functions

API calls are proxied: `/api/foo` → `/.netlify/functions/foo` (see `netlify.toml` redirects).

| Function | Purpose |
|---|---|
| `get-data.js` | **Main aggregator** — called on page load. Checks Netlify Blobs cache (4hr TTL) first, otherwise runs all fetchers in parallel |
| `update-dashboard.js` | Called on Refresh button click — bypasses Blobs cache (`_bypass_blobs=1`) |
| `auto-refresh.js` | Scheduled every 4 hours to pre-warm the Blobs cache |
| `fetch-meta.js` | Meta Ads + Instagram + Facebook Graph API |
| `fetch-ga4.js` | Google Analytics 4 (service account auth) |
| `fetch-wordpress-analytics.js` | Independent Analytics WP plugin — GA4 fallback |
| `fetch-gsc.js` | Google Search Console |
| `fetch-ghl.js` | Go High Level CRM pipeline |
| `fetch-clarity.js` | Microsoft Clarity heatmaps/sessions |
| `fetch-pagespeed.js` | Google PageSpeed Insights |
| `receive-lead.js` | Meta Lead Ads webhook receiver (verifies `X-Hub-Signature-256`) |
| `sync-leads.js` | Push pending leads from Blobs → GHL contacts |
| `get-leads.js` | Read stored Meta leads from Blobs |
| `submit-enquiry.js` | Online coaching application email handler (Resend, rate-limited) |
| `maxx-report.js` | Serves `data/maxx-report.json` |

Netlify Blobs stores:
- `dashboard-cache` — server-side 4hr data cache
- `leads-store` — Meta Lead Ads received via webhook
- `enquiry-ratelimit` — per-IP rate limiting for enquiry form

## index.html Architecture

All dashboard code lives in one file. Key sections (search by comment header):

**Data flow:**
1. `loadData(force=false)` — checks localStorage cache (4hr TTL via `CACHE_KEY`/`CACHE_TTL`), then fetches `/.netlify/functions/get-data`. On success, `dashData` is set and `renderAll()` is called.
2. `renderAll()` — dispatches to all per-page render functions. `dashData.dataSource === 'Mock'` shows the mock banner.
3. `ghlData` is fetched separately in parallel with the main data request (GHL is not in `get-data` due to response time).

**Global state:**
- `dashData` — live data object from API
- `ghlData` — GHL CRM data (fetched separately)
- `charts` — `{ [canvasId]: Chart }` registry; always call `destroyChart(id)` before rebuilding a chart

**Tab navigation:** `navigate(pageName, el)` shows/hides `.tab-page` divs and updates sidebar `.nav-item` active state. Tab names: `overview`, `meta`, `campaigns`, `ad-performance`, `website`, `seo`, `instagram`, `facebook`, `ghl`.

**Design tokens:** All colours/spacing are CSS custom properties on `:root`. Key vars: `--navy`, `--teal`, `--bg`, `--surface`, `--surface2`, `--surface3`, `--border`, `--text`, `--text-muted`, `--success`, `--warning`, `--danger`. Fonts: `--fhead` (Syne), `--fmono` (JetBrains Mono), `--fbody` (Inter).

**Chart utilities:**
- `buildProjectionChart(canvasId, labels, data, type, daysForward)` — wraps Chart.js with linear regression projection
- `destroyChart(key)` — must be called before re-creating a chart on the same canvas
- `D30` — 30-element array of date labels (last 30 days) used for reach/trend charts

**Formatting helpers:** `fmtCurrency(n)`, `fmtNum(n)`, `fmtPct(n)`, `trendArrow(cur, prev)`

**Revenue Forecaster** (`renderForecaster()`, `FC_KEY = 'pm_forecaster_v1'`):
- Editable service tiers (name, price, mix %) stored in localStorage
- `calcBlendedPrice(tiers)` computes weighted average client value
- `loadFCConfig()` migrates old format and appends missing default tiers

**Mobile:** Breakpoint ≤768px. Sidebar is off-canvas (`translateX`) with `toggleSidebar()` / `closeSidebar()`. `.hamburger` button in header.

## Required Environment Variables (set in Netlify dashboard)

```
META_ACCESS_TOKEN        # Long-lived Meta Graph API token
META_AD_ACCOUNT_ID       # e.g. 866923722901513
META_HQ_PAGE_ID          # PerforMotion HQ Facebook Page ID
META_APP_SECRET          # For webhook signature verification
WEBHOOK_VERIFY_TOKEN     # For Meta webhook GET handshake
GHL_API_KEY              # GoHighLevel private integration token
GHL_LOCATION_ID          # GHL sub-account ID
GA4_PROPERTY_ID
GOOGLE_CLIENT_EMAIL      # Service account for GA4 + GSC
GOOGLE_PRIVATE_KEY
GSC_SITE_URL
CLARITY_API_KEY
CLARITY_PROJECT_ID
AC_API_KEY
AC_BASE_URL
YOUTUBE_API_KEY
YOUTUBE_CHANNEL_ID
RESEND_API_KEY           # For enquiry form emails
WP_SITE_URL
WP_USERNAME
WP_APP_PASSWORD
```

## Development Workflow

- Edit `index.html` or `netlify/functions/*.js`
- `git push origin main` → Netlify deploys automatically
- Functions use CommonJS (`require`/`exports.handler`), not ESM
- `@netlify/blobs` is the only runtime dependency (external to esbuild per `netlify.toml`)
- The dashboard branch for Claude Code is `claude/terminal-setup-guidance-ewb1uw`
