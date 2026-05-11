/**
 * Fetch Google Search Console Data
 *
 * Uses the Search Console API v3 with service account JWT authentication.
 * Returns a seo object matching MOCK.seo in index.html.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  GSC_SITE_URL               — verified site URL exactly as it appears in GSC,
 *                               e.g. "https://performotion.net/" (trailing slash matters)
 *  GOOGLE_SERVICE_ACCOUNT_KEY — same service account JSON used for GA4
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────
 *  1. In Google Search Console → Settings → Users and permissions →
 *     Add user → paste the service account email → Owner or Full
 *  2. The same GOOGLE_SERVICE_ACCOUNT_KEY used for GA4 works here
 *
 * ─── KEYWORD BRAND TAGGING ───────────────────────────────────────────────────
 *  GSC does not know your brand structure. Keywords are tagged HQ/Online/Both
 *  by matching against the BRAND_KEYWORDS map below — extend as needed.
 */

const { getGoogleToken } = require('./google-auth');
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

// Keywords containing these strings → tagged to that brand
const BRAND_KEYWORDS = {
  HQ: [
    'brisbane', 'teneriffe', 'newstead', 'physiotherap', 'pilates',
    'pelvic', 'womens health', 'exercise physiologist', 'rehabilitation',
    'group class', 'lgbtqi', 'neuro', 'postnatal',
  ],
  Online: [
    'online', 'powerlifting', 'strength coach', 'remote coaching',
    'strength program',
  ],
};

exports.handler = async () => {
  const siteUrl = process.env.GSC_SITE_URL;
  const saKey   = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!siteUrl || !saKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'GSC_SITE_URL and GOOGLE_SERVICE_ACCOUNT_KEY must be set' }),
    };
  }

  try {
    const token     = await getGoogleToken(saKey, SCOPES);
    const encodedUrl = encodeURIComponent(siteUrl);
    const apiBase   = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchAnalytics/query`;

    const today      = fmtDate(new Date());
    const d30ago     = fmtDate(daysAgo(30));
    const d60ago     = fmtDate(daysAgo(60));
    const d31ago     = fmtDate(daysAgo(31));
    const d90ago     = fmtDate(daysAgo(90));

    const [keywordReport, prevReport, dateReport] = await Promise.all([
      // Current 30-day keyword positions
      gscQuery(apiBase, token, {
        startDate:    d30ago,
        endDate:      today,
        dimensions:   ['query'],
        rowLimit:     50,
        dataState:    'final',
      }),
      // Prior 30-day window for position comparison
      gscQuery(apiBase, token, {
        startDate:    d60ago,
        endDate:      d31ago,
        dimensions:   ['query'],
        rowLimit:     50,
        dataState:    'final',
      }),
      // Daily data for the last 30 days (rank trend buckets)
      gscQuery(apiBase, token, {
        startDate:    d30ago,
        endDate:      today,
        dimensions:   ['date', 'query'],
        rowLimit:     5000,
        dataState:    'final',
      }),
    ]);

    // ── KEYWORD TABLE ─────────────────────────────────────────────────────────
    // Build a map of query → prev position for comparison
    const prevPositionMap = {};
    for (const row of (prevReport.rows || [])) {
      prevPositionMap[row.keys[0]] = Math.round(row.position);
    }

    const keywords = (keywordReport.rows || []).map(row => {
      const kw      = row.keys[0];
      const current = Math.round(row.position);
      const prev    = prevPositionMap[kw] || current;
      return {
        keyword:  kw,
        brand:    tagBrand(kw),
        current,
        previous: prev,
        volume:   row.impressions, // GSC impressions used as volume proxy
      };
    });

    // ── RANK TREND (last 30 days) ─────────────────────────────────────────────
    // Group daily rows into position buckets and build 30-point trend arrays
    const dateMap = {};
    for (const row of (dateReport.rows || [])) {
      const date = row.keys[0];
      const pos  = row.position;
      if (!dateMap[date]) dateMap[date] = [];
      dateMap[date].push(pos);
    }

    const sortedDates = Object.keys(dateMap).sort();
    const labels  = sortedDates;
    const buckets = {
      pos1_3:   sortedDates.map(d => dateMap[d].filter(p => p <= 3).length),
      pos4_10:  sortedDates.map(d => dateMap[d].filter(p => p > 3  && p <= 10).length),
      pos11_20: sortedDates.map(d => dateMap[d].filter(p => p > 10 && p <= 20).length),
      pos21_50: sortedDates.map(d => dateMap[d].filter(p => p > 20 && p <= 50).length),
      pos50plus: sortedDates.map(d => dateMap[d].filter(p => p > 50).length),
    };

    const seo = {
      connectionNote: `Google Search Console connected. Data covers ${d30ago} – ${today}.`,
      rankTrend30: { labels, ...buckets },
      keywords,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seo }),
    };
  } catch (err) {
    console.error('fetch-gsc error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function tagBrand(keyword) {
  const kw = keyword.toLowerCase();
  const isHQ     = BRAND_KEYWORDS.HQ.some(t     => kw.includes(t));
  const isOnline = BRAND_KEYWORDS.Online.some(t => kw.includes(t));
  if (isHQ && isOnline) return 'Both';
  if (isHQ)     return 'HQ';
  if (isOnline) return 'Online';
  return 'HQ'; // default
}

async function gscQuery(url, token, body) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC query → HTTP ${res.status}: ${err}`);
  }
  return res.json();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
