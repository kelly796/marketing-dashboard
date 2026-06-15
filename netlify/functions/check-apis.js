/**
 * API Diagnostics — GET /.netlify/functions/check-apis
 *
 * Tests each configured API and returns per-source status + error details.
 * Used to debug why a data source shows "Not connected" on the dashboard.
 */

const { getGoogleToken, getOAuthToken } = require('./google-auth');

exports.handler = async () => {
  const results = {};

  await Promise.all([
    checkMeta(results),
    checkGA4(results),
    checkGSC(results),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(results, null, 2),
  };
};

// ── META / INSTAGRAM ──────────────────────────────────────────────────────────
async function checkMeta(out) {
  const token     = process.env.META_ACCESS_TOKEN;
  const hqPageId  = process.env.META_HQ_PAGE_ID;
  const onPageId  = process.env.META_ONLINE_PAGE_ID;
  const adAcctId  = process.env.META_AD_ACCOUNT_ID;

  if (!token) { out.meta = { ok: false, error: 'META_ACCESS_TOKEN not set' }; return; }

  try {
    // Validate token
    const me = await metaGet('/me', { fields: 'id,name', access_token: token });
    const igHqId = hqPageId
      ? (await metaGet(`/${hqPageId}`, { fields: 'instagram_business_account,name', access_token: token }))
          ?.instagram_business_account?.id
      : null;
    const igOnId = onPageId
      ? (await metaGet(`/${onPageId}`,  { fields: 'instagram_business_account,name', access_token: token }).catch(() => null))
          ?.instagram_business_account?.id
      : null;

    out.meta = {
      ok: true,
      tokenUser:         me.name || me.id,
      hqPageId:          hqPageId  || 'NOT SET',
      igHqAccountId:     igHqId    || 'not found — check META_HQ_PAGE_ID',
      onlinePageId:      onPageId  || 'NOT SET — add META_ONLINE_PAGE_ID to connect @performotion_online',
      igOnlineAccountId: igOnId    || (onPageId ? 'not found — check META_ONLINE_PAGE_ID' : 'not set'),
      adAccountId:       adAcctId  || 'NOT SET',
    };
  } catch (e) {
    out.meta = { ok: false, error: e.message };
  }
}

// ── GOOGLE ANALYTICS 4 ────────────────────────────────────────────────────────
async function checkGA4(out) {
  const propertyId  = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey  = process.env.GOOGLE_PRIVATE_KEY;

  if (!propertyId)  { out.ga4 = { ok: false, error: 'GA4_PROPERTY_ID not set' }; return; }
  if (!clientEmail) { out.ga4 = { ok: false, error: 'GOOGLE_CLIENT_EMAIL not set' }; return; }

  try {
    const token = await getGoogleToken(clientEmail, privateKey, ['https://www.googleapis.com/auth/analytics.readonly']);
    const res   = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics:    [{ name: 'sessions' }],
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GA4 API ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    out.ga4 = {
      ok:             true,
      propertyId,
      serviceAccount: clientEmail,
      sessions7d:     data.rows?.[0]?.metricValues?.[0]?.value || '0',
    };
  } catch (e) {
    out.ga4 = { ok: false, error: e.message };
  }
}

// ── GOOGLE SEARCH CONSOLE ────────────────────────────────────────────────────
async function checkGSC(out) {
  const siteUrl      = process.env.GSC_SITE_URL;
  const clientId     = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  const refreshToken = process.env.GSC_REFRESH_TOKEN;
  const gscClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const gscPrivateKey  = process.env.GOOGLE_PRIVATE_KEY;

  if (!siteUrl) { out.gsc = { ok: false, error: 'GSC_SITE_URL not set' }; return; }
  if (!clientId && !gscClientEmail) { out.gsc = { ok: false, error: 'GSC_CLIENT_ID or GOOGLE_CLIENT_EMAIL not set' }; return; }

  try {
    const token = (clientId && clientSecret && refreshToken)
      ? await getOAuthToken(clientId, clientSecret, refreshToken)
      : await getGoogleToken(gscClientEmail, gscPrivateKey, ['https://www.googleapis.com/auth/webmasters.readonly']);
    const encodedUrl = encodeURIComponent(siteUrl);
    const res        = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
          endDate:   new Date().toISOString().slice(0, 10),
          rowLimit:  1,
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GSC API ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    out.gsc = {
      ok:      true,
      siteUrl,
      clicks7d: data.rows?.[0]?.clicks || 0,
    };
  } catch (e) {
    out.gsc = { ok: false, error: e.message };
  }
}

// ── HTTP HELPERS ──────────────────────────────────────────────────────────────
async function metaGet(path, params) {
  const qs  = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
  const res = await fetch(`https://graph.facebook.com/v19.0${path}?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Meta API HTTP ${res.status}`);
  }
  return res.json();
}

