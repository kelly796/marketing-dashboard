/**
 * Auto Refresh — Netlify Scheduled Function
 *
 * Runs every 4 hours. Forces a live fetch from all data sources and
 * writes the result to Netlify Blobs so the dashboard always has
 * fresh data on load without waiting for API calls.
 *
 * Schedule is set in netlify.toml:
 *   [functions."auto-refresh"]
 *   schedule = "@every 4h"
 */

const { handler: getData } = require('./get-data');

exports.handler = async () => {
  console.log('[auto-refresh] Starting scheduled cache refresh at', new Date().toISOString());

  const result = await getData({ _bypassBlobs: true, queryStringParameters: { _bypass_blobs: '1' } });

  if (result.statusCode === 200) {
    const data = JSON.parse(result.body);
    const sources = [
      data.meta        ? 'Meta'    : null,
      data.ga4         ? 'GA4'     : null,
      data.seo         ? 'GSC'     : null,
      data.instagramHQ ? 'Insta'   : null,
      data.ghl         ? 'GHL'     : null,
    ].filter(Boolean).join(', ');

    console.log(`[auto-refresh] Cache refreshed. Sources: ${sources || 'none'}. lastUpdated: ${data.lastUpdated}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, sources }) };
  }

  console.error('[auto-refresh] Refresh failed — get-data returned', result.statusCode, result.body);
  return { statusCode: result.statusCode, body: result.body };
};
