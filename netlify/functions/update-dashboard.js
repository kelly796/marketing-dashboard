/**
 * Update Dashboard
 *
 * Called when the user clicks the Refresh button in the dashboard header.
 * Fetches fresh data from all sources and returns it so the browser can
 * update localStorage and re-render.
 *
 * The browser calls: POST /.netlify/functions/update-dashboard
 */

const { handler: fetchAC }        = require('./fetch-activecampaign');
const { handler: fetchGymMaster } = require('./fetch-gymmaster');
const { handler: fetchMeta }      = require('./fetch-meta');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const results = {};
  const errors  = [];

  // Run all fetches in parallel
  const [acRes, gmRes, metaRes] = await Promise.allSettled([
    fetchAC(event),
    fetchGymMaster(event),
    fetchMeta(event),
  ]);

  // ── ACTIVECAMPAIGN ──────────────────────────────────────────────────────────
  if (acRes.status === 'fulfilled' && acRes.value.statusCode === 200) {
    try { results.email = JSON.parse(acRes.value.body); }
    catch (e) { errors.push(`AC parse: ${e.message}`); }
  } else {
    errors.push(`AC: ${acRes.reason?.message || acRes.value?.body || 'unknown error'}`);
  }

  // ── GYMMASTER ────────────────────────────────────────────────────────────────
  if (gmRes.status === 'fulfilled' && gmRes.value.statusCode === 200) {
    try { results.gymmaster = JSON.parse(gmRes.value.body); }
    catch (e) { errors.push(`GymMaster parse: ${e.message}`); }
  } else {
    errors.push(`GymMaster: ${gmRes.reason?.message || gmRes.value?.body || 'unknown error'}`);
  }

  // ── META / INSTAGRAM / FACEBOOK ─────────────────────────────────────────────
  if (metaRes.status === 'fulfilled' && metaRes.value.statusCode === 200) {
    try {
      const metaData = JSON.parse(metaRes.value.body);
      // Spread instagramHQ, instagramOnline, facebook, meta as top-level keys
      if (metaData.instagramHQ)     results.instagramHQ     = metaData.instagramHQ;
      if (metaData.instagramOnline) results.instagramOnline = metaData.instagramOnline;
      if (metaData.facebook)        results.facebook        = metaData.facebook;
      if (metaData.meta)            results.meta            = metaData.meta;
    } catch (e) { errors.push(`Meta parse: ${e.message}`); }
  } else {
    errors.push(`Meta: ${metaRes.reason?.message || metaRes.value?.body || 'unknown error'}`);
  }

  const data = {
    lastUpdated: new Date().toISOString(),
    dataSource:  Object.keys(results).length ? 'Live' : 'Mock',
    ...results,
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      updated: Object.keys(results),
      errors:  errors.length ? errors : undefined,
      data,
    }),
  };
};
