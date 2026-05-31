/**
 * Google Service Account JWT Auth Helper
 *
 * Exchanges a service account key for a short-lived OAuth2 access token.
 * Works with Node.js 18+ built-in crypto — no external packages needed.
 *
 * Usage:
 *   const { getGoogleToken } = require('./google-auth');
 *   const token = await getGoogleToken(
 *     process.env.GOOGLE_CLIENT_EMAIL,
 *     process.env.GOOGLE_PRIVATE_KEY,
 *     ['https://www.googleapis.com/auth/analytics.readonly'],
 *   );
 */

const crypto = require('crypto');

async function getGoogleToken(clientEmail, privateKey, scopes) {
  const now = Math.floor(Date.now() / 1000);

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   clientEmail,
    scope: scopes.join(' '),
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey, 'base64url');

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

async function getOAuthToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

module.exports = { getGoogleToken, getOAuthToken };
