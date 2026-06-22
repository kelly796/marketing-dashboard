# Claude Code Brief — PerforMotion Marketing Dashboard Fix

## What This Project Is
A marketing dashboard at https://monumental-syrniki-3b33aa.netlify.app
GitHub repo: https://github.com/kelly796/marketing-dashboard
Local path: ~/marketing-dashboard

The dashboard is a single `index.html` with Netlify serverless functions in `netlify/functions/`.
It displays live Instagram, Facebook, Meta Ads, YouTube, ActiveCampaign, and SEO data.

---

## What We've Done So Far

### Netlify Environment Variables (already set on site ID: 1e5c7118-8333-4598-ab2d-f52506df749a)
- `META_AD_ACCOUNT_ID` = `866923722901513` (Performotion ad account)
- `META_HQ_PAGE_ID` = `877639932292270` (PerforMotion Facebook Page)
- `META_ACCESS_TOKEN` = set by user (long-lived token — may or may not be valid)
- Other vars set: AC_API_KEY, AC_BASE_URL, YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, GA4_PROPERTY_ID, GOOGLE_SERVICE_ACCOUNT_KEY, GSC_SITE_URL, WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD

### Instagram Account
- @performotion_hq — Instagram Business Account ID: `17841480701347186`
- Connected to Facebook Page ID: `877639932292270`
- 508 followers, 5.47% engagement rate (30d), ~31k reach (30d)

### Data File Created
We created `data/dashboard-data.json` with real pulled Instagram data (10 posts, reach, likes, saves, performance scores etc.) as a static fallback.

### Code Changes Made to index.html
1. Modified `loadData()` to load `data/dashboard-data.json` FIRST, then supplement any keys missing from the Netlify function response
2. Added a null-guard fix to `renderIGAnalytics()` for when `pillarPerformance` is empty

---

## Session: 22 June 2026

### Features Built
1. **GHL stage filter** (`index.html`) — Tapping a stage count in the pipeline grid filters the Recent Leads table below to show only contacts in that stage. Tap again or Clear to reset.
2. **Mobile responsive layout** (`index.html`) — Full mobile support: hamburger menu slides sidebar in as overlay, header and main go full-width, all grids collapse to 1–2 columns, tables scroll horizontally. Breakpoint: ≤768px.

### Security Fixes
3. **Meta webhook signature verification** (`netlify/functions/receive-lead.js`) — Verifies `X-Hub-Signature-256` header using `META_APP_SECRET`. Returns 500 on Blobs write failure so Meta retries. Removed hardcoded fallback verify token.
4. **Enquiry form rate limiting** (`netlify/functions/submit-enquiry.js`) — 5 submissions per IP per hour via Netlify Blobs. Returns 429 if exceeded. Fails open if Blobs unavailable.

### Pending Actions (owner)
- Add `META_APP_SECRET` to Netlify environment variables (Meta Developer Console → App → Settings → Basic → App secret) to activate webhook signature verification
- Enable Netlify site password (Netlify dashboard → Site configuration → Site protection) to protect `get-leads` and `sync-leads` endpoints which expose lead PII
- Verify `performotion.net` domain in Resend, then update `submit-enquiry.js` `from` address from `onboarding@resend.dev` to `no-reply@performotion.net`
- Move `enquiry.html` + `submit-enquiry.js` to their own project (currently lives in dashboard repo — noted for tomorrow)

---

## Current Problem
The dashboard is NOT showing real Instagram/Facebook data. Instead it either:
- Shows MOCK data (fake posts with names like "Why strength training matters after 40")
- Shows partially blank sections (missing posts table, blank reach chart)
- The incognito window is missing elements entirely

---

## What Claude Code Needs To Do

### 1. READ AND AUDIT THESE FILES FIRST
- `index.html` — focus on: `loadData()` function, `renderIGAnalytics()` function, `BUILDERS['hq-overview']`, the MOCK data object, and how `D` (live data) vs `MOCK` is used throughout
- `netlify/functions/fetch-meta.js` — the Meta/Instagram data fetcher
- `netlify/functions/get-data.js` — the aggregator called on page load
- `netlify/functions/update-dashboard.js` — called on Refresh button click
- `data/dashboard-data.json` — the static fallback data we created

### 2. VERIFY THE META/INSTAGRAM INTEGRATION
Check `fetch-meta.js` for:
- Is it correctly using `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_HQ_PAGE_ID` env vars?
- Is it correctly deriving the Instagram Business Account ID from the Facebook Page ID?
- Are the Graph API calls correct for Instagram insights, media, and Facebook page insights?
- Are there any API version issues (currently using v19.0 — check if endpoints are still valid)?
- Does the function handle missing/expired tokens gracefully without crashing?
- Does it return a proper JSON structure matching what `index.html` expects?

Check `get-data.js` for:
- Does it correctly call `fetch-meta.js` and spread the result keys (`instagramHQ`, `instagramOnline`, `facebook`, `meta`) into the response?
- Does it return a non-200 or empty body when Meta fails? (The dashboard needs a clear signal to fall back to `data/dashboard-data.json`)

### 3. VERIFY THE DASHBOARD DATA LOADING IN index.html
Check the `loadData()` function:
- Does it correctly try `data/dashboard-data.json` before falling back to MOCK?
- When the Netlify function returns 200 but with missing `instagramHQ`/`facebook`/`meta` keys, does it supplement from `data/dashboard-data.json`?
- Is the localStorage cache causing stale MOCK data to be served? Fix the cache key or invalidation logic if needed.

### 4. VERIFY renderIGAnalytics() AND ALL RENDER FUNCTIONS
- Does `renderIGAnalytics()` crash when `pillarPerformance` is `{}` (empty object)?
- Does it crash when `trendData.contentTypes` is `[]`?
- Does `BUILDERS['hq-overview']` crash anywhere when data comes from `data/dashboard-data.json` instead of MOCK?
- Check every place `best[1]`, `worst[1]`, or similar indexed access happens on potentially empty arrays

### 5. VERIFY data/dashboard-data.json SCHEMA
Check that the schema of `data/dashboard-data.json` exactly matches what the dashboard JavaScript expects:
- `instagramHQ.reachTrend` — must be exactly 30 elements to match `D30` labels array
- `instagramHQ.posts[].type` — must match the type strings used in `typeIcon()` ('reel', 'carousel', 'post')
- `facebook.reachTrend` — must be same length as `instagramHQ.reachTrend` for the combined chart
- All required keys must be present (check against MOCK object structure)

### 6. FIX EVERYTHING THAT'S BROKEN
After the audit:
1. Fix any bugs in `fetch-meta.js` that prevent it from fetching real data
2. Fix any bugs in `get-data.js` that prevent Meta data flowing through
3. Fix ALL crashes/errors in `index.html` render functions when real data is loaded
4. Ensure `data/dashboard-data.json` schema is 100% correct
5. Ensure `loadData()` reliably loads from `data/dashboard-data.json` as the fallback
6. Make the dashboard resilient — it should never crash or show blank sections; always fall back gracefully

### 7. TEST
After fixes:
- Verify `data/dashboard-data.json` loads correctly by checking all render paths with the real data schema
- Check for any JavaScript errors that would prevent charts or tables rendering
- Ensure the reach trend chart renders (check `D30` length vs `reachTrend` length)
- Ensure posts table renders with the real post data

### 8. COMMIT AND PUSH
Once all fixes are verified:
```bash
git add -A
git commit -m "Fix Meta/Instagram data loading and dashboard render bugs"
git push origin main
```

---

## Key Things To Know
- The dashboard uses Chart.js 4.4.0 for charts
- `D` is the live data object, `MOCK` is fallback — code uses pattern `(D.instagramHQ || MOCK.instagramHQ)`
- `DATA_SOURCE` is either 'Live', 'Cached', or 'Mock'
- `D30` is a 30-element array of date labels for charts — trend arrays MUST match this length
- localStorage key `LS_KEY` caches data for 4 hours — this can cause stale MOCK data to persist
- The Netlify function `get-data` aggregates all sources; if AC/YouTube work but Meta fails, it still returns 200 with partial data — the dashboard must handle this case
- `META_ONLINE_PAGE_ID` is NOT set yet (second Instagram account pending approval) — handle gracefully

---

## Success Criteria
The dashboard at https://monumental-syrniki-3b33aa.netlify.app should:
1. Show real @performotion_hq posts (e.g. "ONE WEEK TO GO UNTIL OUR OPEN DAY", "SUPPS WITH STEVE", powerlifting floor reel etc.)
2. Show real metrics: 508 followers, ~5.47% engagement, real reach/likes/saves per post
3. Show the Daily Reach Trend chart (not blank)
4. Show the Content by Pillar chart
5. NOT show any MOCK data posts (fake names like "Why strength training matters after 40")
6. Work in both normal browser and incognito window
