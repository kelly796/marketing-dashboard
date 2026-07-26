/**
 * Fetch Microsoft Clarity Data
 *
 * Returns session metrics, rage clicks, dead clicks, and scroll depth.
 * Returns placeholder data when CLARITY_API_KEY is not set.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  CLARITY_API_KEY    — API token from Clarity → Settings → Data Export
 *
 * ─── REAL API, confirmed live 2026-07-26 ─────────────────────────
 *  GET https://www.clarity.ms/export-data/api/v1/project-live-insights
 *  Docs: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 *  - No project ID in the URL — the token itself is project-scoped.
 *  - numOfDays only supports 1, 2, or 3 (last 24/48/72h) — no arbitrary date range.
 *  - HARD CAP: 10 requests/project/day. Do not call this more than once a day
 *    from any automation — the old code called an endpoint that doesn't exist
 *    at all (clarity.microsoft.com/api/v1/...), which is why this always 400'd
 *    regardless of credentials. Confirmed via a real call against the live key.
 *  - Response is an array of { metricName, information: [...] } blocks, not a
 *    single metrics object — shape below reflects the real payload.
 */

const BASE = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

export const handler = async () => {
  const apiKey = process.env.CLARITY_API_KEY;

  // ── PLACEHOLDER — no API key configured ──────────────────────────
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholder: true,
        message: 'Add CLARITY_API_KEY to Netlify env vars to enable live data.',
        metrics: null,
      }),
    };
  }

  // ── LIVE DATA ─────────────────────────────────────────────────────
  try {
    const res = await fetch(`${BASE}?numOfDays=3`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Clarity API error:', res.status, err);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeholder: false,
          error: `Clarity API returned ${res.status}`,
          metrics: null,
        }),
      };
    }

    const data = await res.json(); // array of { metricName, information: [...] }
    const byName = {};
    for (const block of data) byName[block.metricName] = block.information || [];
    const first = name => (byName[name] && byName[name][0]) || {};
    const num = v => (v === undefined || v === null ? null : Number(v));

    const traffic = first('Traffic');
    const metrics = {
      sessions:        num(traffic.totalSessionCount),
      botSessions:     num(traffic.totalBotSessionCount),
      pageViews:       null, // not exposed as a project-wide total by this API
      rageClicks:      num(first('RageClickCount').subTotal),
      deadClicks:      num(first('DeadClickCount').subTotal),
      excessiveScroll: num(first('ExcessiveScroll').subTotal),
      scrollDepth:     num(first('ScrollDepth').averageScrollDepth),
      engagementTime:  num(first('EngagementTime').activeTime),
    };

    // PopularPages is the one metric that's naturally per-page already.
    const topPages = (byName['PopularPages'] || []).slice(0, 5).map(p => ({
      url:         p.url || '—',
      sessions:    num(p.visitsCount) ?? 0,
      rageClicks:  null, // would need a second Url-dimensioned call — not worth the quota
      scrollDepth: null,
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=14400',
      },
      body: JSON.stringify({ placeholder: false, metrics, topPages }),
    };

  } catch (err) {
    console.error('fetch-clarity error:', err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, placeholder: true, metrics: null }),
    };
  }
};
