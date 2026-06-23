/**
 * Fetch Microsoft Clarity Data
 *
 * Returns session metrics, rage clicks, dead clicks, and scroll depth.
 * Returns placeholder data when CLARITY_API_KEY is not set.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  CLARITY_API_KEY    — API token from Clarity → Settings → Access tokens
 *  CLARITY_PROJECT_ID — Project ID from the Clarity URL (x0ihxl738b)
 *
 * ─── SETUP ───────────────────────────────────────────────────────
 *  1. clarity.microsoft.com → your project → Settings → Access tokens
 *  2. Generate token → copy → Netlify env as CLARITY_API_KEY
 *  3. Set CLARITY_PROJECT_ID = x0ihxl738b
 *  4. Deploy — this function switches from placeholder to live data
 */

const BASE = 'https://clarity.microsoft.com/api/v1';

exports.handler = async () => {
  const apiKey    = process.env.CLARITY_API_KEY;
  const projectId = process.env.CLARITY_PROJECT_ID;

  if (!projectId) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CLARITY_PROJECT_ID not set' }),
    };
  }

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
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Date range — last 7 days
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    const fmt = d => d.toISOString().split('T')[0];

    // Fetch project metrics
    const metricsRes = await fetch(
      `${BASE}/projects/${projectId}/metrics?startDate=${fmt(startDate)}&endDate=${fmt(endDate)}`,
      { headers }
    );

    if (!metricsRes.ok) {
      const err = await metricsRes.text();
      console.error('Clarity metrics error:', metricsRes.status, err);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeholder: false,
          error: `Clarity API returned ${metricsRes.status}`,
          metrics: null,
        }),
      };
    }

    const data = await metricsRes.json();

    // Normalise the response — Clarity API shape varies by version
    const m = data?.metrics || data?.data || data || {};

    const metrics = {
      sessions:        m.sessionCount  ?? m.sessions        ?? null,
      pageViews:       m.pageViewCount ?? m.pageViews        ?? null,
      rageClicks:      m.rageClickCount ?? m.rageClicks      ?? null,
      deadClicks:      m.deadClickCount ?? m.deadClicks      ?? null,
      excessiveScroll: m.excessiveScrollCount ?? m.excessiveScroll ?? null,
      scrollDepth:     m.avgScrollDepth ?? m.scrollDepth     ?? null,
      engagementTime:  m.avgEngagementTime ?? m.engagementTime ?? null,
      botSessions:     m.botSessionCount ?? null,
    };

    // Top pages by rage clicks (if available)
    const topPages = (data?.topPages || data?.pages || []).slice(0, 5).map(p => ({
      url:        p.url || p.page || '—',
      sessions:   p.sessionCount ?? p.sessions ?? 0,
      rageClicks: p.rageClickCount ?? p.rageClicks ?? 0,
      scrollDepth: p.avgScrollDepth ?? p.scrollDepth ?? null,
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
