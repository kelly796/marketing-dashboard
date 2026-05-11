/**
 * Get Dashboard Data
 *
 * Called by the browser on every page load (after localStorage cache miss).
 * Calls all data sources in parallel and returns a merged object.
 * The browser falls back to MOCK for any key that is null/undefined.
 *
 * Data sources:
 *  ✅ ActiveCampaign    — AC_BASE_URL + AC_API_KEY
 *  ✅ GymMaster         — GYMMASTER_API_KEY
 *  ✅ Meta / Instagram  — META_ACCESS_TOKEN + META_AD_ACCOUNT_ID + META_IG_*_ID + META_FB_PAGE_ID
 *  ✅ YouTube           — YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID
 *  ✅ Google Analytics 4 — GA4_PROPERTY_ID + GOOGLE_SERVICE_ACCOUNT_KEY
 *  ✅ Google Search Console — GSC_SITE_URL + GOOGLE_SERVICE_ACCOUNT_KEY
 *  ✅ Halaxy            — HALAXY_API_KEY
 */

const { handler: fetchAC }       = require('./fetch-activecampaign');
const { handler: fetchGymMaster } = require('./fetch-gymmaster');
const { handler: fetchMeta }      = require('./fetch-meta');
const { handler: fetchYouTube }   = require('./fetch-youtube');
const { handler: fetchGA4 }       = require('./fetch-ga4');
const { handler: fetchGSC }       = require('./fetch-gsc');
const { handler: fetchHalaxy }    = require('./fetch-halaxy');

exports.handler = async (event) => {
  try {
    const [acRes, gmRes, metaRes, ytRes, ga4Res, gscRes, halaxyRes] = await Promise.allSettled([
      fetchAC(event),
      fetchGymMaster(event),
      fetchMeta(event),
      fetchYouTube(event),
      fetchGA4(event),
      fetchGSC(event),
      fetchHalaxy(event),
    ]);

    const email     = parse(acRes,     'ActiveCampaign');
    const gymmaster = parse(gmRes,     'GymMaster');
    const metaData  = parse(metaRes,   'Meta');
    const ytData    = parse(ytRes,     'YouTube');
    const ga4Data   = parse(ga4Res,    'GA4');
    const gscData   = parse(gscRes,    'GSC');
    const halaxyData = parse(halaxyRes, 'Halaxy');

    // Meta returns multiple keys
    const metaKeys = metaData ? {
      ...(metaData.instagramHQ     ? { instagramHQ:     metaData.instagramHQ }     : {}),
      ...(metaData.instagramOnline ? { instagramOnline: metaData.instagramOnline } : {}),
      ...(metaData.facebook        ? { facebook:        metaData.facebook }        : {}),
      ...(metaData.meta            ? { meta:            metaData.meta }            : {}),
    } : {};

    // GA4 returns ga4 + ga4Countries as separate keys
    const ga4Keys = ga4Data ? {
      ...(ga4Data.ga4         ? { ga4:         ga4Data.ga4 }         : {}),
      ...(ga4Data.ga4Countries ? { ga4Countries: ga4Data.ga4Countries } : {}),
    } : {};

    // Halaxy returns bookings + halaxy
    const halaxyKeys = halaxyData ? {
      ...(halaxyData.bookings ? { bookings: halaxyData.bookings } : {}),
      ...(halaxyData.halaxy   ? { halaxy:   halaxyData.halaxy }   : {}),
    } : {};

    const data = {
      lastUpdated: new Date().toISOString(),
      dataSource:  'Live',
      ...(email                         ? { email }                         : {}),
      ...(gymmaster                     ? { gymmaster }                     : {}),
      ...metaKeys,
      ...(ytData && ytData.subscribers  ? { youtube: ytData }               : {}),
      ...ga4Keys,
      ...gscData  ? { seo: gscData.seo } : {},
      ...halaxyKeys,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=1800, stale-while-revalidate=300',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('get-data error:', err);
    return { statusCode: 503, body: JSON.stringify({ error: err.message }) };
  }
};

function parse(result, label) {
  if (result.status === 'fulfilled' && result.value.statusCode === 200) {
    try { return JSON.parse(result.value.body); } catch (e) {
      console.warn(`Failed to parse ${label} response:`, e.message);
    }
  } else if (result.status === 'rejected') {
    console.warn(`${label} fetch failed:`, result.reason);
  } else {
    console.warn(`${label} returned ${result.value?.statusCode}:`, result.value?.body);
  }
  return null;
}
