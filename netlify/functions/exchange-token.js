/**
 * Exchange a Meta short-lived token for a long-lived token (60 days).
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  META_APP_SECRET  — Meta app secret from Meta for Developers → App Settings → Basic
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *  GET /api/exchange-token?short_lived_token=<token>
 *
 * ─── RETURNS ─────────────────────────────────────────────────────────────────
 *  { access_token, token_type, expires_in }
 */

const CLIENT_ID = process.env.META_APP_ID || '1548741106832255';
const GRAPH     = 'https://graph.facebook.com/v21.0';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://monumental-syrniki-3b33aa.netlify.app',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'META_APP_SECRET env var not set' }),
    };
  }

  const shortLivedToken = (event.queryStringParameters || {}).short_lived_token;
  if (!shortLivedToken) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required parameter: short_lived_token' }),
    };
  }

  try {
    const url = `${GRAPH}/oauth/access_token`
      + `?grant_type=fb_exchange_token`
      + `&client_id=${CLIENT_ID}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

    const res  = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.error) {
      const msg = data.error?.message || `Meta API returned HTTP ${res.status}`;
      console.error('exchange-token error:', msg);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: msg }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_token: data.access_token,
        token_type:   data.token_type,
        expires_in:   data.expires_in,
      }),
    };
  } catch (err) {
    console.error('exchange-token exception:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
