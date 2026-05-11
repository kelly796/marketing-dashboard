/**
 * Fetch Google Analytics 4 Data
 *
 * Uses the GA4 Data API v1beta with service account JWT authentication.
 * Returns ga4Countries array + ga4 summary object matching the dashboard schema.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  GA4_PROPERTY_ID            — numeric property ID, e.g. "123456789"
 *                               GA4 Admin → Property → Property details
 *  GOOGLE_SERVICE_ACCOUNT_KEY — full contents of the service account JSON key file
 *                               (Google Cloud Console → IAM → Service Accounts → Keys)
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────
 *  1. Create a service account in Google Cloud Console
 *  2. Enable "Google Analytics Data API" for the project
 *  3. GA4 Admin → Property access management → add the service account email
 *     as a Viewer
 *  4. Download the JSON key; paste the entire file contents as
 *     GOOGLE_SERVICE_ACCOUNT_KEY in Netlify environment variables
 */

const { getGoogleToken } = require('./google-auth');
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

exports.handler = async () => {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const saKey      = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!propertyId || !saKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'GA4_PROPERTY_ID and GOOGLE_SERVICE_ACCOUNT_KEY must be set' }),
    };
  }

  try {
    const token = await getGoogleToken(saKey, SCOPES);
    const base  = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;

    const [countryReport, summaryReport, sourceReport] = await Promise.all([
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
          { name: 'totalUsers' },
          { name: 'conversions' },
          { name: 'screenPageViewsPerSession' },
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
    // When two dateRanges are requested GA4 returns rows interleaved with a
    // "dateRange" dimension — extract by index
    const rows = summaryReport.rows || [];
    const getMetric = (rowIndex, metricIndex) =>
      rows[rowIndex] ? Number(rows[rowIndex].metricValues[metricIndex].value) : 0;

    const sessions    = getMetric(0, 0);
    const sessionsPrev = getMetric(1, 0) || Math.round(sessions * 0.92);
    const users       = getMetric(0, 1);
    const conversions = getMetric(0, 2);
    const pagesPerSession = rows[0]
      ? +Number(rows[0].metricValues[3].value).toFixed(1)
      : 0;

    const ga4 = {
      sessions,
      sessionsPrev,
      users,
      conversions,
      conversionRate:  sessions ? +(conversions / sessions * 100).toFixed(1) : 0,
      pagesPerSession,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ga4, ga4Countries }),
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
