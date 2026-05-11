/**
 * Fetch Meta (Facebook / Instagram / Meta Ads) Data
 *
 * Returns instagramHQ, instagramOnline, facebook, and meta objects
 * matching the dashboard schema expected by index.html.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  META_ACCESS_TOKEN   — Long-lived Page or System User access token
 *  META_AD_ACCOUNT_ID  — Ad account ID (with or without "act_" prefix)
 *  META_IG_HQ_ID       — Instagram Business Account ID for the HQ account
 *  META_IG_ONLINE_ID   — Instagram Business Account ID for the Online account
 *  META_FB_PAGE_ID     — Facebook Page ID
 *
 * ─── TOKEN PERMISSIONS NEEDED ────────────────────────────────────────────────
 *  instagram_basic, instagram_manage_insights, pages_read_engagement,
 *  pages_show_list, ads_read, business_management
 *
 * ─── HOW TO GET A LONG-LIVED TOKEN (60 days) ─────────────────────────────────
 *  1. Create a Meta App at developers.facebook.com
 *  2. Add Instagram Graph API + Marketing API products
 *  3. Generate a short-lived User Access Token with the permissions above
 *  4. Exchange it:
 *     GET https://graph.facebook.com/oauth/access_token
 *       ?grant_type=fb_exchange_token
 *       &client_id={APP_ID}
 *       &client_secret={APP_SECRET}
 *       &fb_exchange_token={SHORT_TOKEN}
 *  5. For non-expiring tokens use a System User from Meta Business Manager
 *
 * ─── HOW TO FIND YOUR ACCOUNT IDs ────────────────────────────────────────────
 *  • Instagram Business Account ID:
 *    GET https://graph.facebook.com/v19.0/me/accounts (lists pages + IG accounts)
 *  • Ad Account ID: Meta Business Manager → Accounts → Ad Accounts
 *  • Facebook Page ID: facebook.com/YourPage → About → Page transparency
 *
 * ─── FIELDS NOTES ────────────────────────────────────────────────────────────
 *  • pillar, bookingClicks — require manual tagging; returned as defaults
 *  • gender/age demographics — require a separate Audience Insights call;
 *    returned as empty arrays (not worth the extra API quota)
 *  • stories7d — requires /{ig-id}/stories endpoint (separate call omitted)
 *  • Prev-period comparisons — single extra 7d-ago insights call per account
 */

const GRAPH = 'https://graph.facebook.com/v19.0';

exports.handler = async () => {
  const token       = process.env.META_ACCESS_TOKEN;
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  const igHqId      = process.env.META_IG_HQ_ID;
  const igOnlineId  = process.env.META_IG_ONLINE_ID;
  const fbPageId    = process.env.META_FB_PAGE_ID;

  if (!token) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'META_ACCESS_TOKEN env var not set' }),
    };
  }

  // Unix timestamps
  const now     = Math.floor(Date.now() / 1000);
  const day     = 86400;
  const since7  = now - 7  * day;
  const since14 = now - 14 * day;
  const since30 = now - 30 * day;

  try {
    const [
      igHqAccount, igHqInsights7d, igHqInsights7dPrev, igHqInsights30d, igHqMedia,
      igOnAccount, igOnInsights7d, igOnInsights7dPrev, igOnInsights30d, igOnMedia,
      fbInsights, fbAccount,
      adInsights7d, adInsights7dPrev, adCampaigns,
    ] = await Promise.all([

      // ── IG HQ ──────────────────────────────────────────────────────────────
      igHqId ? metaGet(`/${igHqId}`, { fields: 'followers_count,media_count,name', access_token: token }) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach,impressions,profile_views', period: 'day', since: since7,  until: now,    access_token: token }) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach,impressions',              period: 'day', since: since14, until: since7, access_token: token }) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach,impressions',              period: 'day', since: since30, until: now,    access_token: token }) : null,
      igHqId ? metaGet(`/${igHqId}/media`,    { fields: 'id,caption,media_type,timestamp,like_count,comments_count', limit: 5, access_token: token }) : null,

      // ── IG ONLINE ──────────────────────────────────────────────────────────
      igOnlineId ? metaGet(`/${igOnlineId}`, { fields: 'followers_count,media_count,name', access_token: token }) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach,impressions,profile_views', period: 'day', since: since7,  until: now,    access_token: token }) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach,impressions',              period: 'day', since: since14, until: since7, access_token: token }) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach,impressions',              period: 'day', since: since30, until: now,    access_token: token }) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/media`,    { fields: 'id,caption,media_type,timestamp,like_count,comments_count', limit: 5, access_token: token }) : null,

      // ── FACEBOOK PAGE ──────────────────────────────────────────────────────
      fbPageId ? metaGet(`/${fbPageId}/insights`, {
        metric: 'page_impressions_unique,page_impressions,page_engaged_users',
        period: 'week',
        access_token: token,
      }) : null,
      fbPageId ? metaGet(`/${fbPageId}`, { fields: 'fan_count,name', access_token: token }) : null,

      // ── META ADS ───────────────────────────────────────────────────────────
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,reach,actions,action_values',
        date_preset: 'last_7d',
        access_token: token,
      }) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,actions,action_values',
        since: since14, until: since7,
        access_token: token,
      }) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/campaigns`, {
        fields: 'name,status,objective,insights.date_preset(last_7d){spend,impressions,clicks,ctr,actions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 10,
        access_token: token,
      }) : null,
    ]);

    // Fetch per-post insights for IG HQ and Online (reach + saved per post)
    const [igHqPostInsights, igOnPostInsights] = await Promise.all([
      igHqMedia    ? fetchPostInsights(igHqMedia.data   || [], token) : [],
      igOnMedia    ? fetchPostInsights(igOnMedia.data   || [], token) : [],
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instagramHQ:     buildIGData(igHqAccount,   igHqInsights7d,  igHqInsights7dPrev,  igHqInsights30d,  igHqMedia,  igHqPostInsights),
        instagramOnline: buildIGData(igOnAccount,   igOnInsights7d,  igOnInsights7dPrev,  igOnInsights30d,  igOnMedia,  igOnPostInsights),
        facebook:        buildFBData(fbInsights, fbAccount),
        meta:            buildMetaAdsData(adInsights7d, adInsights7dPrev, adCampaigns),
      }),
    };
  } catch (err) {
    console.error('fetch-meta error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── PER-POST INSIGHTS ────────────────────────────────────────────────────────
async function fetchPostInsights(posts, token) {
  return Promise.all(
    posts.map(async post => {
      try {
        const data = await metaGet(`/${post.id}/insights`, {
          metric: 'reach,saved,impressions',
          access_token: token,
        });
        const map = {};
        (data.data || []).forEach(m => { map[m.name] = Number(m.values?.[0]?.value || 0); });
        return map;
      } catch {
        return {};
      }
    })
  );
}

// ─── INSTAGRAM DATA BUILDER ───────────────────────────────────────────────────
function buildIGData(account, insights7d, insights7dPrev, insights30d, media, postInsights) {
  if (!account) return null;

  // Sum a metric across its daily values
  function sumMetric(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).reduce((s, v) => s + (Number(v.value) || 0), 0);
  }

  // Build a 30-day daily array for a metric
  function dailyArray(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).map(v => Number(v.value) || 0);
  }

  const reach7d        = sumMetric(insights7d,     'reach');
  const reach7dPrev    = sumMetric(insights7dPrev, 'reach');
  const impressions7d  = sumMetric(insights7d,     'impressions');
  const impressionsPrev = sumMetric(insights7dPrev, 'impressions');
  const reachTrend     = dailyArray(insights30d, 'reach');
  const impressionsTrend = dailyArray(insights30d, 'impressions');

  // Build post list
  const posts = (media?.data || []).map((post, i) => {
    const pi       = postInsights[i] || {};
    const likes    = Number(post.like_count    || 0);
    const comments = Number(post.comments_count || 0);
    const saved    = Number(pi.saved           || 0);
    const postReach = Number(pi.reach          || 0);
    const engagements = likes + comments + saved;
    const perfScore   = postReach > 0 ? +((engagements / postReach) * 100).toFixed(1) : 0;

    return {
      id:            post.id,
      caption:       (post.caption || '').slice(0, 120),
      type:          (post.media_type || 'POST').toLowerCase().replace('image', 'post'),
      date:          (post.timestamp || '').slice(0, 10),
      reach:         postReach,
      likes,
      comments,
      saves:         saved,
      pillar:        '',   // requires manual tagging
      perfScore,
      gender:        { female: 0, male: 0 },
      age:           [],
      bookingClicks: 0,    // tracked via ac-wordpress-sync webhook
    };
  });

  // Engagement rate: total engagements / total reach across posts
  const totalEngagements = posts.reduce((s, p) => s + p.likes + p.comments + p.saves, 0);
  const totalReach       = posts.reduce((s, p) => s + p.reach, 0);
  const engagementRate   = totalReach > 0 ? +((totalEngagements / totalReach) * 100).toFixed(2) : 0;

  // Prev engagement rate estimated from prev reach (no prev post detail available)
  const engagementRatePrev = reach7dPrev > 0
    ? +((totalEngagements / reach7dPrev) * 100).toFixed(2)
    : 0;
  const engagementTrend = reachTrend.map(r =>
    r > 0 ? +((totalEngagements / reachTrend.reduce((a, b) => a + b, 1)) * 100).toFixed(2) : 0
  );

  return {
    reach7d,
    reach7dPrev,
    engagementRate,
    engagementRatePrev,
    impressions7d,
    impressionsPrev,
    followers:     Number(account.followers_count || 0),
    followersPrev: 0,  // would need a historical followers call
    posts7d:       posts.length,
    stories7d:     0,  // requires /{ig-id}/stories endpoint
    reachTrend,
    engagementTrend,
    impressionsTrend,
    pillars:       {},
    posts,
    pillarPerformance: {},
    trendData:     { contentTypes: [], demographicClickthrough: [], metaAudienceOverlap: '' },
  };
}

// ─── FACEBOOK PAGE DATA BUILDER ───────────────────────────────────────────────
function buildFBData(insights, account) {
  if (!insights && !account) return null;

  function latestValue(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    const vals   = metric?.values || [];
    return Number(vals[vals.length - 1]?.value || 0);
  }

  const reach7d       = latestValue(insights, 'page_impressions_unique');
  const impressions7d = latestValue(insights, 'page_impressions');
  const engaged       = latestValue(insights, 'page_engaged_users');
  const engagementRate = reach7d > 0 ? +((engaged / reach7d) * 100).toFixed(2) : 0;

  return {
    reach7d,
    reach7dPrev:     0,
    engagementRate,
    engagementRatePrev: 0,
    impressions7d,
    impressionsPrev: 0,
    pageLikes:       Number(account?.fan_count || 0),
    pageLikesPrev:   0,
    posts7d:         0,
    reachTrend:      [],
    engagementTrend: [],
  };
}

// ─── META ADS DATA BUILDER ────────────────────────────────────────────────────
function buildMetaAdsData(insights7d, insights7dPrev, campaignsData) {
  if (!insights7d) return null;

  function getAction(actions, ...types) {
    return types.reduce((s, t) => {
      const found = (actions || []).find(a => a.action_type === t);
      return s + Number(found?.value || 0);
    }, 0);
  }

  const current      = insights7d?.data?.[0] || {};
  const spend7d      = +(Number(current.spend       || 0)).toFixed(2);
  const impressions7d = Number(current.impressions  || 0);
  const clicks7d     = Number(current.clicks        || 0);
  const ctr          = +(Number(current.ctr         || 0)).toFixed(2);

  // Leads: try standard lead action types
  const leads7d    = getAction(current.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
  const revenue    = getAction(current.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roas       = spend7d > 0 && revenue > 0 ? +(revenue / spend7d).toFixed(2) : 0;
  const costPerLead = leads7d > 0 ? +(spend7d / leads7d).toFixed(2) : 0;

  // Previous 7-day period
  const prev           = insights7dPrev?.data?.[0] || {};
  const spendPrev      = +(Number(prev.spend || 0)).toFixed(2);
  const leadsPrev      = getAction(prev.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
  const costPerLeadPrev = leadsPrev > 0 ? +(spendPrev / leadsPrev).toFixed(2) : 0;
  const revenuePrev    = getAction(prev.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roasPrev       = spendPrev > 0 && revenuePrev > 0 ? +(revenuePrev / spendPrev).toFixed(2) : 0;

  // Campaigns
  const campaigns = (campaignsData?.data || []).map(c => {
    const ci    = c.insights?.data?.[0] || {};
    const cSpend = +(Number(ci.spend || 0)).toFixed(2);
    const cLeads = getAction(ci.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
    const cCpl   = cLeads > 0 ? +(cSpend / cLeads).toFixed(2) : 0;
    const brand  = /online|coaching|rehab|network|classroom/i.test(c.name) ? 'Online' : 'HQ';

    return {
      name:        c.name,
      brand,
      status:      c.status === 'ACTIVE' ? 'Active' : 'Paused',
      spend:       cSpend,
      leads:       cLeads,
      cpl:         cCpl,
      impressions: Number(ci.impressions || 0),
      ctr:         +(Number(ci.ctr || 0)).toFixed(2),
    };
  });

  return {
    spend7d,
    spendPrev,
    leads7d,
    leadsPrev,
    costPerLead,
    costPerLeadPrev,
    roas,
    roasPrev,
    impressions7d,
    impressionsPrev: Number(prev.impressions || 0),
    clicks7d,
    clicksPrev:  Number(prev.clicks || 0),
    ctr,
    ctrPrev:     +(Number(prev.ctr || 0)).toFixed(2),
    spendTrend:  [],
    leadsTrend:  [],
    campaigns,
    creatives:   [],
    audienceBreakdown: [],
  };
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────
async function metaGet(path, params = {}, retries = 3) {
  const qs  = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  const url = `${GRAPH}${path}?${qs}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url);

    // Meta rate limits return 400 with code 32 or 17 — retry with backoff
    if (res.status === 429 || res.status === 400) {
      const body = await res.json().catch(() => ({}));
      const code = body?.error?.code;
      if (code === 32 || code === 17 || res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`Meta API ${path} → ${body?.error?.message || `HTTP ${res.status}`}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API ${path} → HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }
  throw new Error(`Meta API ${path} failed after ${retries} retries`);
}
