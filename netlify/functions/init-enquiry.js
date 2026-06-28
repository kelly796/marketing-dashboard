const { getStore } = require('@netlify/blobs');
const { randomBytes } = require('crypto');

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = randomBytes(32).toString('hex');

  try {
    const store = getStore('enquiry-tokens');
    await store.set(token, JSON.stringify({ issuedAt: Date.now(), used: false }));
  } catch (err) {
    console.error('Token store error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Service unavailable' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token }),
  };
};
