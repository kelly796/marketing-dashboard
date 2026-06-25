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

const { handler: getData }    = require('./get-data');
const { handler: syncLeads }  = require('./sync-leads');

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
  } else {
    console.error('[auto-refresh] Refresh failed — get-data returned', result.statusCode, result.body);
  }

  // Sync any pending Meta leads to GHL (catches leads that failed auto-sync on receipt)
  try {
    const syncResult = await syncLeads({ httpMethod: 'POST', body: '{}' });
    const { synced = [], failed = [], skipped = [] } = JSON.parse(syncResult.body || '{}');
    if (synced.length || failed.length) {
      console.log(`[auto-refresh] Lead sync: ${synced.length} synced, ${failed.length} failed, ${skipped.length} skipped`);
    }
  } catch (err) {
    console.error('[auto-refresh] Lead sync error:', err.message);
  }

  if (result.statusCode !== 200) {
    return { statusCode: result.statusCode, body: result.body };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
