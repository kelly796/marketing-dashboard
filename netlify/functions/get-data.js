/**
 * Get Dashboard Data
 *
 * Called by the browser on every page load (after localStorage cache miss).
 * Calls all data sources in parallel and returns a merged object.
 * The browser falls back to MOCK for any key that is null/undefined.
 *
 * Data sources:
 *  ✅ ActiveCampaign         — AC_BASE_URL + AC_API_KEY
 *  ✅ Meta / Instagram       — META_ACCESS_TOKEN + META_AD_ACCOUNT_ID + META_HQ_PAGE_ID + META_ONLINE_PAGE_ID
 *  ✅ YouTube                — YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID
 *  ✅ WordPress / Ind. Analytics — WP_SITE_URL + WP_USERNAME + WP_APP_PASSWORD
 *  ✅ Google Search Console  — GSC_SITE_URL + GOOGLE_SERVICE_ACCOUNT_KEY
 */

const { handler: fetchAC }      = require('./fetch-activecampaign');
const { handler: fetchMeta }    = require('./fetch-meta');
const { handler: fetchYouTube } = require('./fetch-youtube');
const { handler: fetchWPAnalytics } = require('./fetch-wordpress-analytics');
const { handler: fetchGSC }     = require('./fetch-gsc');

exports.handler = async (event) => {
  try {
    const [acRes, metaRes, ytRes, wpRes, gscRes] = await Promise.allSettled([
      fetchAC(event),
      fetchMeta(event),
      fetchYouTube(event),
      fetchWPAnalytics(event),
      fetchGSC(event),
    ]);

    const email    = parse(acRes,   'ActiveCampaign');
    const metaData = parse(metaRes, 'Meta');
    const ytData   = parse(ytRes,   'YouTube');
    const wpData   = parse(wpRes,   'WPAnalytics');
    const gscData  = parse(gscRes,  'GSC');

    // Meta returns multiple keys
    const metaKeys = metaData ? {
      ...(metaData.instagramHQ     ? { instagramHQ:     metaData.instagramHQ }     : {}),
      ...(metaData.instagramOnline ? { instagramOnline: metaData.instagramOnline } : {}),
      ...(metaData.facebook        ? { facebook:        metaData.facebook }        : {}),
      ...(metaData.meta            ? { meta:            metaData.meta }            : {}),
    } : {};

    // WordPress analytics returns wpAnalytics key
    const wpKeys = wpData && wpData.wpAnalytics ? {
      ga4: normaliseWPAnalytics(wpData.wpAnalytics),
      ...(wpData.wpAnalytics.topPages?.length ? { ga4TopPages: wpData.wpAnalytics.topPages } : {}),
    } : {};

    const data = {
      lastUpdated: new Date().toISOString(),
      dataSource:  'Live',
      ...(email                        ? { email }          : {}),
      ...metaKeys,
      ...(ytData && ytData.subscribers ? { youtube: ytData } : {}),
      ...wpKeys,
      ...(gscData ? { seo: gscData.seo } : {}),
    };

    const hasAnyData = email || metaData || ytData || wpData || gscData;
    if (!hasAnyData) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'No API credentials configured' }),
      };
    }

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

// Map Independent Analytics response shape → the ga4 schema the dashboard expects
// so the frontend continues to work without changes.
function normaliseWPAnalytics(wp) {
  const views    = Number(wp.views30d    || 0);
  const viewsPrev = Number(wp.views30dPrev || 0);
  const visitors = Number(wp.visitors30d || 0);

  return {
    sessions:        views,
    sessionsPrev:    viewsPrev,
    users:           visitors,
    activeUsers:     visitors,
    conversions:     0,
    conversionRate:  0,
    pagesPerSession: 0,
    viewsTrend:      wp.viewsTrend      || [],
    visitorsTrend:   wp.visitorsTrend   || [],
    topPages:        wp.topPages        || [],
    topReferrers:    wp.topReferrers    || [],
    deviceBreakdown: wp.deviceBreakdown || [],
    dataSource:      'Independent Analytics',
    period:          wp.period          || {},
  };
}
