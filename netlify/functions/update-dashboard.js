/**
 * Update Dashboard
 *
 * Called when the user clicks the Refresh button in the dashboard header.
 * Fetches fresh data from all sources in parallel and returns the merged result
 * so the browser can update localStorage and re-render.
 *
 * The browser calls: POST /.netlify/functions/update-dashboard
 */

const { handler: fetchAC }      = require('./fetch-activecampaign');
const { handler: fetchMeta }    = require('./fetch-meta');
const { handler: fetchYouTube } = require('./fetch-youtube');
const { handler: fetchGA4 }     = require('./fetch-ga4');
const { handler: fetchGSC }     = require('./fetch-gsc');

exports.handler = async (event) => {
  // Allow scheduled invocations (no httpMethod) and direct POST calls
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const results = {};
  const errors  = [];

  const [acRes, metaRes, ytRes, ga4Res, gscRes] = await Promise.allSettled([
    fetchAC(event),
    fetchMeta(event),
    fetchYouTube(event),
    fetchGA4(event),
    fetchGSC(event),
  ]);

  function absorb(result, label, apply) {
    if (result.status === 'fulfilled' && result.value.statusCode === 200) {
      try { apply(JSON.parse(result.value.body)); }
      catch (e) { errors.push(`${label} parse: ${e.message}`); }
    } else {
      const msg = result.reason?.message || result.value?.body || 'unknown error';
      errors.push(`${label}: ${msg}`);
    }
  }

  absorb(acRes,   'ActiveCampaign', d => { results.email = d; });
  absorb(metaRes, 'Meta',           d => {
    if (d.instagramHQ)     results.instagramHQ     = d.instagramHQ;
    if (d.instagramOnline) results.instagramOnline = d.instagramOnline;
    if (d.facebook)        results.facebook        = d.facebook;
    if (d.meta)            results.meta            = d.meta;
  });
  absorb(ytRes,   'YouTube', d => { if (d.subscribers) results.youtube = d; });
  absorb(ga4Res,  'GA4',     d => {
    if (d.ga4)          results.ga4          = d.ga4;
    if (d.ga4Countries) results.ga4Countries = d.ga4Countries;
    if (d.ga4TopPages)  results.ga4TopPages  = d.ga4TopPages;
  });
  absorb(gscRes,  'GSC', d => { if (d.seo) results.seo = d.seo; });

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
