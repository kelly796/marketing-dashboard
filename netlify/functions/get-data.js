/**
 * Get Dashboard Data
 *
 * Called by the browser on every page load (after localStorage cache miss).
 * Calls all available data sources in parallel and returns a merged data object.
 * The browser falls back to MOCK for any key that is null/undefined here.
 *
 * Data sources wired up:
 *  ✅ ActiveCampaign (email lists, campaigns, automations)
 *  🔲 Meta Ads           — add AC_API_KEY to enable
 *  🔲 Instagram Graph    — add INSTAGRAM_TOKEN to enable
 *  🔲 YouTube Data API   — add YOUTUBE_API_KEY to enable
 *  🔲 Google Analytics 4 — add GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT to enable
 *  🔲 Google Search Console — add GSC_SITE_URL + GSC_SERVICE_ACCOUNT to enable
 *  🔲 Halaxy             — add HALAXY_API_KEY to enable
 */

// Import fetch functions as modules (Netlify bundles them together)
const { handler: fetchAC }        = require('./fetch-activecampaign');
const { handler: fetchGymMaster } = require('./fetch-gymmaster');

exports.handler = async (event) => {
  try {
    // Run all data fetches in parallel — each returns null if not configured
    const [acResult, gmResult] = await Promise.allSettled([
      fetchAC(event),
      fetchGymMaster(event),
      // Future integrations slot in here:
      // fetchMeta(event),
      // fetchInstagram(event),
      // fetchYouTube(event),
      // fetchGA4(event),
    ]);

    // Parse ActiveCampaign email data
    let email = null;
    if (acResult.status === 'fulfilled' && acResult.value.statusCode === 200) {
      try {
        email = JSON.parse(acResult.value.body);
      } catch (e) {
        console.warn('Failed to parse AC response:', e.message);
      }
    } else if (acResult.status === 'rejected') {
      console.warn('AC fetch failed:', acResult.reason);
    }

    // Parse GymMaster membership data
    let gymmaster = null;
    if (gmResult.status === 'fulfilled' && gmResult.value.statusCode === 200) {
      try {
        gymmaster = JSON.parse(gmResult.value.body);
      } catch (e) {
        console.warn('Failed to parse GymMaster response:', e.message);
      }
    } else if (gmResult.status === 'rejected') {
      console.warn('GymMaster fetch failed:', gmResult.reason);
    }

    // Return partial data — browser merges with MOCK for any null keys
    const data = {
      lastUpdated: new Date().toISOString(),
      dataSource: 'Live',
      // Only include keys where we have real data — browser falls back to MOCK otherwise
      ...(email     ? { email }     : {}),
      ...(gymmaster ? { gymmaster } : {}),
      // Future: instagramHQ, instagramOnline, facebook, youtube, meta, bookings, seo
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 30 minutes on CDN — refresh button bypasses via POST to update-dashboard
        'Cache-Control': 'public, max-age=1800, stale-while-revalidate=300',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('get-data error:', err);
    // Return 503 so the browser falls through to dashboard-data.json → MOCK
    return { statusCode: 503, body: JSON.stringify({ error: err.message }) };
  }
};
