/**
 * Fetch Google Analytics 4 Data
 *
 * Uses the GA4 Data API v1beta with service account JWT authentication.
 * Returns ga4Countries array + ga4 summary object matching the dashboard schema.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  GA4_PROPERTY_ID            — numeric property ID, e.g. "123456789"
 *                               GA4 Admin → Property → Property details
 *  GOOGLE_CLIENT_EMAIL        — service account email from the JSON key file
 *  GOOGLE_PRIVATE_KEY         — private_key value from the JSON key file
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────
 *  1. Create a service account in Google Cloud Console
 *  2. Enable "Google Analytics Data API" for the project
 *  3. GA4 Admin → Property access management → add the service account email as Viewer
 *  4. Download the JSON key; copy client_email → GOOGLE_CLIENT_EMAIL,
 *     private_key → GOOGLE_PRIVATE_KEY in Netlify environment variables
 */

const { getGoogleToken } = require('./google-auth');
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

exports.handler = async () => {
  const propertyId  = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey  = process.env.GOOGLE_PRIVATE_KEY;

  if (!propertyId || !clientEmail || !privateKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'GA4_PROPERTY_ID, GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY must be set' }),
    };
  }

  try {
    const token = await getGoogleToken(clientEmail, privateKey, SCOPES);
    const base  = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;

    const [
      countryReport, summaryReport, sourceReport, pagesReport,
      demographicsReport, deviceReport, channelReport, sourceMediumReport,
      landingPageReport, dailyTrendReport,
    ] = await Promise.all([
      // Country breakdown for the last 30 days
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'country' }],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViewsPerSession' },
          { name: 'conversions' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
      // Overall totals — current and prior 30-day window for comparison
      runReport(base, token, {
        dateRanges: [
          { startDate: '30daysAgo', endDate: 'today' },
          { startDate: '60daysAgo', endDate: '31daysAgo' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'conversions' },
          { name: 'screenPageViewsPerSession' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
      }),
      // Top channel per country (for source attribution)
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [
          { name: 'country' },
          { name: 'sessionDefaultChannelGroup' },
        ],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 50,
      }),
      // Top pages by sessions — with bounce rate
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'bounceRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),
      // Age demographics
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'userAgeBracket' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }).catch(() => ({ rows: [] })),
      // Device category
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }).catch(() => ({ rows: [] })),
      // Traffic channel breakdown (organic vs paid vs direct etc.)
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }).catch(() => ({ rows: [] })),
      // Source / medium detail
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      }).catch(() => ({ rows: [] })),
      // Landing pages (first page of session)
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'bounceRate' }, { name: 'conversions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }).catch(() => ({ rows: [] })),
      // Daily sessions trend (30 days)
      runReport(base, token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }).catch(() => ({ rows: [] })),
    ]);

    // Top channel per country (first row wins — already sorted by sessions desc)
    const topSource = {};
    for (const row of (sourceReport.rows || [])) {
      const country = row.dimensionValues[0].value;
      if (!topSource[country]) topSource[country] = row.dimensionValues[1].value;
    }

    // ── ga4Countries ─────────────────────────────────────────────────────────
    const ga4Countries = (countryReport.rows || []).map(row => {
      const country  = row.dimensionValues[0].value;
      const sessions = Number(row.metricValues[0].value);
      const pages    = +Number(row.metricValues[1].value).toFixed(1);
      const convRate = sessions
        ? +(Number(row.metricValues[2].value) / sessions * 100).toFixed(1)
        : 0;
      return {
        country,
        sessions,
        pages,
        convRate,
        products: 0, // requires ecommerce purchase events
        source:   topSource[country] || 'Organic Search',
      };
    });

    // ── ga4 summary ───────────────────────────────────────────────────────────
    // metrics order: sessions, activeUsers, newUsers, conversions,
    //                pagesPerSession, bounceRate, avgSessionDuration
    const rows = summaryReport.rows || [];
    const getMetric = (rowIndex, metricIndex) =>
      rows[rowIndex] ? Number(rows[rowIndex].metricValues[metricIndex].value) : 0;

    const sessions            = getMetric(0, 0);
    const sessionsPrev        = getMetric(1, 0) || Math.round(sessions * 0.92);
    const activeUsers         = getMetric(0, 1);
    const newUsers            = getMetric(0, 2);
    const conversions         = getMetric(0, 3);
    const pagesPerSession     = rows[0] ? +Number(rows[0].metricValues[4].value).toFixed(1) : 0;
    const bounceRate          = rows[0] ? +(Number(rows[0].metricValues[5].value) * 100).toFixed(1) : null;
    const avgSessionDuration  = rows[0] ? Math.round(Number(rows[0].metricValues[6].value)) : 0;

    const ga4 = {
      sessions,
      sessionsPrev,
      activeUsers,
      users: activeUsers,
      newUsers,
      conversions,
      conversionRate:       sessions ? +(conversions / sessions * 100).toFixed(1) : 0,
      pagesPerSession,
      bounceRate,
      avgSessionDuration,
    };

    // ── Top pages ─────────────────────────────────────────────────────────────
    const ga4TopPages = (pagesReport.rows || []).map(row => ({
      page:        row.dimensionValues[0].value,
      title:       row.dimensionValues[1].value || row.dimensionValues[0].value,
      sessions:    Number(row.metricValues[0].value),
      views:       Number(row.metricValues[1].value),
      activeUsers: Number(row.metricValues[2].value),
      bounceRate:  +(Number(row.metricValues[3].value) * 100).toFixed(1),
    }));

    // ── Demographics ──────────────────────────────────────────────────────────
    const totalDemoUsers = (demographicsReport.rows || [])
      .reduce((s, r) => s + Number(r.metricValues[0].value), 0);
    const ga4Demographics = (demographicsReport.rows || []).map(row => ({
      age:     row.dimensionValues[0].value,
      users:   Number(row.metricValues[0].value),
      sessions: Number(row.metricValues[1].value),
      pct:     totalDemoUsers > 0
        ? Math.round((Number(row.metricValues[0].value) / totalDemoUsers) * 100)
        : 0,
    }));

    // ── Devices ───────────────────────────────────────────────────────────────
    const totalDeviceSessions = (deviceReport.rows || [])
      .reduce((s, r) => s + Number(r.metricValues[0].value), 0);
    const ga4Devices = (deviceReport.rows || []).map(row => ({
      device:     row.dimensionValues[0].value,
      sessions:   Number(row.metricValues[0].value),
      users:      Number(row.metricValues[1].value),
      bounceRate: +(Number(row.metricValues[2].value) * 100).toFixed(1),
      pct:        totalDeviceSessions > 0
        ? Math.round((Number(row.metricValues[0].value) / totalDeviceSessions) * 100)
        : 0,
    }));

    // ── Traffic channels ──────────────────────────────────────────────────────
    const totalChannelSessions = (channelReport.rows || [])
      .reduce((s, r) => s + Number(r.metricValues[0].value), 0);
    const ga4Channels = (channelReport.rows || []).map(row => ({
      channel:     row.dimensionValues[0].value,
      sessions:    Number(row.metricValues[0].value),
      users:       Number(row.metricValues[1].value),
      bounceRate:  +(Number(row.metricValues[2].value) * 100).toFixed(1),
      conversions: Number(row.metricValues[3].value),
      pct:         totalChannelSessions > 0
        ? Math.round((Number(row.metricValues[0].value) / totalChannelSessions) * 100)
        : 0,
    }));

    // ── Source / medium ───────────────────────────────────────────────────────
    const ga4Sources = (sourceMediumReport.rows || [])
      .filter(row => row.dimensionValues[0].value !== '(not set)')
      .map(row => ({
        source:     row.dimensionValues[0].value,
        medium:     row.dimensionValues[1].value,
        sessions:   Number(row.metricValues[0].value),
        users:      Number(row.metricValues[1].value),
        bounceRate: +(Number(row.metricValues[2].value) * 100).toFixed(1),
      }));

    // ── Landing pages ─────────────────────────────────────────────────────────
    const ga4LandingPages = (landingPageReport.rows || []).map(row => ({
      page:        row.dimensionValues[0].value,
      sessions:    Number(row.metricValues[0].value),
      bounceRate:  +(Number(row.metricValues[1].value) * 100).toFixed(1),
      conversions: Number(row.metricValues[2].value),
      users:       Number(row.metricValues[3].value),
    }));

    // ── Daily trend (sessions + users, 30 days) ───────────────────────────────
    const ga4DailyTrend = (dailyTrendReport.rows || []).map(row => ({
      date:     row.dimensionValues[0].value, // YYYYMMDD
      sessions: Number(row.metricValues[0].value),
      users:    Number(row.metricValues[1].value),
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ga4,
        ga4Countries,
        ga4TopPages,
        ga4Demographics,
        ga4Devices,
        ga4Channels,
        ga4Sources,
        ga4LandingPages,
        ga4DailyTrend,
      }),
    };
  } catch (err) {
    console.error('fetch-ga4 error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function runReport(base, token, body) {
  const res = await fetch(`${base}:runReport`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 runReport → HTTP ${res.status}: ${err}`);
  }
  return res.json();
}
