/**
 * Get Dashboard Data
 *
 * Called by the browser on every page load (after localStorage cache miss).
 * Calls all data sources in parallel and returns a merged object.
 * The browser falls back to MOCK for any key that is null/undefined.
 *
 * Data sources:
 *  ✅ Meta / Instagram       — META_ACCESS_TOKEN + META_AD_ACCOUNT_ID + META_HQ_PAGE_ID + META_ONLINE_PAGE_ID
 *  ✅ Google Analytics 4     — GA4_PROPERTY_ID + GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY (preferred)
 *  ✅ WordPress / Ind. Analytics — WP_SITE_URL + WP_USERNAME + WP_APP_PASSWORD (fallback if GA4 fails)
 *  ✅ Google Search Console  — GSC_SITE_URL + GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY
 *  ✅ Microsoft Clarity      — CLARITY_API_KEY + CLARITY_PROJECT_ID
 *  ✅ Go High Level          — GHL_API_KEY + GHL_LOCATION_ID
 */

const { handler: fetchMeta }        = require('./fetch-meta');
const { handler: fetchGA4 }         = require('./fetch-ga4');
const { handler: fetchWPAnalytics } = require('./fetch-wordpress-analytics');
const { handler: fetchGSC }         = require('./fetch-gsc');
const { handler: fetchClarity }     = require('./fetch-clarity');
const { handler: fetchGHL }         = require('./fetch-ghl');

exports.handler = async (event) => {
  try {
    const [metaRes, ga4Res, wpRes, gscRes, clarityRes, ghlRes] = await Promise.allSettled([
      fetchMeta(event),
      fetchGA4(event),
      fetchWPAnalytics(event),
      fetchGSC(event),
      fetchClarity(event),
      fetchGHL(event),
    ]);

    const metaData    = parse(metaRes,    'Meta');
    const ga4Data     = parse(ga4Res,     'GA4');
    const wpData      = parse(wpRes,      'WPAnalytics');
    const gscData     = parse(gscRes,     'GSC');
    const clarityData = parse(clarityRes, 'Clarity');
    const ghlData     = parse(ghlRes,     'GHL');

    // Meta returns multiple keys
    const metaKeys = metaData ? {
      ...(metaData.instagramHQ     ? { instagramHQ:     metaData.instagramHQ }     : {}),
      ...(metaData.instagramOnline ? { instagramOnline: metaData.instagramOnline } : {}),
      ...(metaData.facebook        ? { facebook:        metaData.facebook }        : {}),
      ...(metaData.meta            ? { meta:            metaData.meta }            : {}),
    } : {};

    // GA4 preferred; WP analytics is the fallback when GA4 credentials fail
    const analyticsKeys = ga4Data ? {
      ...(ga4Data.ga4              ? { ga4:              ga4Data.ga4 }              : {}),
      ...(ga4Data.ga4Countries     ? { ga4Countries:     ga4Data.ga4Countries }     : {}),
      ...(ga4Data.ga4TopPages      ? { ga4TopPages:      ga4Data.ga4TopPages }      : {}),
      ...(ga4Data.ga4Demographics  ? { ga4Demographics:  ga4Data.ga4Demographics }  : {}),
      ...(ga4Data.ga4Devices       ? { ga4Devices:       ga4Data.ga4Devices }       : {}),
      ...(ga4Data.ga4Channels      ? { ga4Channels:      ga4Data.ga4Channels }      : {}),
      ...(ga4Data.ga4Sources       ? { ga4Sources:       ga4Data.ga4Sources }       : {}),
      ...(ga4Data.ga4LandingPages  ? { ga4LandingPages:  ga4Data.ga4LandingPages }  : {}),
      ...(ga4Data.ga4DailyTrend    ? { ga4DailyTrend:    ga4Data.ga4DailyTrend }    : {}),
    } : (wpData && wpData.wpAnalytics ? {
      ga4: normaliseWPAnalytics(wpData.wpAnalytics),
      ...(wpData.wpAnalytics.topPages?.length ? { ga4TopPages: wpData.wpAnalytics.topPages } : {}),
    } : {});

    const data = {
      lastUpdated: new Date().toISOString(),
      dataSource:  'Live',
      ...metaKeys,
      ...analyticsKeys,
      ...(gscData     ? { seo:     gscData.seo } : {}),
      ...(clarityData ? { clarity: clarityData } : {}),
      ...(ghlData     ? { ghl:     ghlData }     : {}),
    };

    const hasAnyData = metaData || ga4Data || wpData || gscData || clarityData || ghlData;
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
