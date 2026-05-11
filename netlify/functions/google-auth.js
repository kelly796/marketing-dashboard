/**
 * Google Service Account JWT Auth Helper
 *
 * Exchanges a service account JSON key for a short-lived OAuth2 access token.
 * Works with Node.js 18+ built-in crypto — no external packages needed.
 *
 * Usage:
 *   const { getGoogleToken } = require('./google-auth');
 *   const token = await getGoogleToken(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, [
 *     'https://www.googleapis.com/auth/analytics.readonly',
 *   ]);
 */

const crypto = require('crypto');

async function getGoogleToken(serviceAccountJson, scopes) {
  const sa = typeof serviceAccountJson === 'string'
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: scopes.join(' '),
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

module.exports = { getGoogleToken };
