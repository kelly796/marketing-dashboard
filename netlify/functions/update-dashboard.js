/**
 * Update Dashboard
 *
 * Called when the user clicks the Refresh button in the dashboard header.
 * Clears any server-side cache, fetches fresh data from all sources,
 * and returns the updated data so the browser can update localStorage.
 *
 * The browser calls: POST /.netlify/functions/update-dashboard
 * and on success, stores the result in localStorage and re-renders.
 */

const { handler: fetchAC }        = require('./fetch-activecampaign');
const { handler: fetchGymMaster } = require('./fetch-gymmaster');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const results = {};
  const errors  = [];

  // ── ACTIVECAMPAIGN ──────────────────────────────────────────────────────────
  try {
    const res = await fetchAC(event);
    if (res.statusCode === 200) {
      results.email = JSON.parse(res.body);
    } else {
      errors.push(`AC: ${res.body}`);
    }
  } catch (e) {
    errors.push(`AC: ${e.message}`);
  }

  // ── GYMMASTER ────────────────────────────────────────────────────────────────
  try {
    const res = await fetchGymMaster(event);
    if (res.statusCode === 200) {
      results.gymmaster = JSON.parse(res.body);
    } else {
      errors.push(`GymMaster: ${res.body}`);
    }
  } catch (e) {
    errors.push(`GymMaster: ${e.message}`);
  }

  // ── FUTURE INTEGRATIONS ─────────────────────────────────────────────────────
  // Uncomment and implement each fetch function as you add API keys:
  //
  // try {
  //   const res = await require('./fetch-meta').handler(event);
  //   if (res.statusCode === 200) results.meta = JSON.parse(res.body);
  // } catch (e) { errors.push(`Meta: ${e.message}`); }
  //
  // try {
  //   const res = await require('./fetch-ga4').handler(event);
  //   if (res.statusCode === 200) Object.assign(results, JSON.parse(res.body));
  // } catch (e) { errors.push(`GA4: ${e.message}`); }

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
