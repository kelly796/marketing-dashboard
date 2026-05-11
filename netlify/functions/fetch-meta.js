/**
 * Fetch Meta (Facebook / Instagram / Meta Ads) Data
 *
 * Returns instagramHQ, instagramOnline, facebook, and meta objects
 * matching the dashboard schema expected by index.html.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  META_ACCESS_TOKEN    — Long-lived Page or System User access token
 *  META_AD_ACCOUNT_ID   — Ad account ID (with or without "act_" prefix)
 *  META_HQ_PAGE_ID      — Facebook Page ID for PerforMotion HQ
 *                         (also used to derive the HQ Instagram Business Account ID)
 *  META_ONLINE_PAGE_ID  — Facebook Page ID for PerforMotion Online
 *                         (also used to derive the Online Instagram Business Account ID)
 *
 * ─── TOKEN PERMISSIONS NEEDED ────────────────────────────────────────────────
 *  instagram_basic, instagram_manage_insights, pages_read_engagement,
 *  pages_show_list, ads_read, business_management
 */

const GRAPH = 'https://graph.facebook.com/v19.0';

exports.handler = async () => {
  const token       = process.env.META_ACCESS_TOKEN;
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  const hqPageId    = process.env.META_HQ_PAGE_ID;
  const onlinePageId = process.env.META_ONLINE_PAGE_ID;

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
    // ── STEP 1: Derive Instagram Business Account IDs from Page IDs ────────────
    const [hqPageMeta, onlinePageMeta] = await Promise.all([
      hqPageId     ? metaGet(`/${hqPageId}`,     { fields: 'instagram_business_account,fan_count,name', access_token: token }) : null,
      onlinePageId ? metaGet(`/${onlinePageId}`,  { fields: 'instagram_business_account,fan_count,name', access_token: token }) : null,
    ]);

    const igHqId     = hqPageMeta?.instagram_business_account?.id     || null;
    const igOnlineId = onlinePageMeta?.instagram_business_account?.id || null;

    // ── STEP 2: Fetch all data in parallel ─────────────────────────────────────
    const [
      igHqAccount, igHqInsights7d, igHqInsights7dPrev, igHqInsights30d, igHqMedia,
      igOnAccount, igOnInsights7d, igOnInsights7dPrev, igOnInsights30d, igOnMedia,
      fbInsights, fbInsightsPrev, fbPosts,
      adInsights7d, adInsights7dPrev, adCampaigns, adAudienceBreakdown, adCreatives,
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

      // ── FACEBOOK PAGE (use HQ page) ────────────────────────────────────────
      hqPageId ? metaGet(`/${hqPageId}/insights`, {
        metric: 'page_impressions_unique,page_impressions,page_engaged_users,page_fans',
        period: 'week',
        access_token: token,
      }) : null,
      hqPageId ? metaGet(`/${hqPageId}/insights`, {
        metric: 'page_impressions_unique,page_impressions,page_engaged_users',
        period: 'week',
        since: since14,
        until: since7,
        access_token: token,
      }) : null,
      hqPageId ? metaGet(`/${hqPageId}/posts`, {
        fields: 'id,created_time',
        since: since7,
        until: now,
        limit: 50,
        access_token: token,
      }) : null,

      // ── META ADS ───────────────────────────────────────────────────────────
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,reach,actions,action_values',
        date_preset: 'last_7d',
        access_token: token,
      }) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,reach,actions,action_values',
        time_range: JSON.stringify({ since: fmtDate(since14), until: fmtDate(since7) }),
        access_token: token,
      }) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/campaigns`, {
        fields: 'name,status,objective,insights.date_preset(last_7d){spend,impressions,clicks,ctr,actions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 10,
        access_token: token,
      }) : null,
      // Audience breakdown by age and gender
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,reach,actions',
        date_preset: 'last_7d',
        breakdowns: 'age,gender',
        access_token: token,
      }).catch(() => null) : null,
      // Creative performance — top ads with spend + leads
      adAccountId ? metaGet(`/act_${adAccountId}/ads`, {
        fields: 'name,status,creative{name,thumbnail_url},insights.date_preset(last_7d){spend,impressions,actions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 10,
        access_token: token,
      }).catch(() => null) : null,
    ]);

    // Fetch per-post insights for IG HQ and Online (reach + saved per post)
    const [igHqPostInsights, igOnPostInsights] = await Promise.all([
      igHqMedia ? fetchPostInsights(igHqMedia.data   || [], token) : [],
      igOnMedia ? fetchPostInsights(igOnMedia.data   || [], token) : [],
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instagramHQ:     buildIGData(igHqAccount,   igHqInsights7d,  igHqInsights7dPrev,  igHqInsights30d,  igHqMedia,  igHqPostInsights),
        instagramOnline: buildIGData(igOnAccount,   igOnInsights7d,  igOnInsights7dPrev,  igOnInsights30d,  igOnMedia,  igOnPostInsights),
        facebook:        buildFBData(fbInsights, fbInsightsPrev, hqPageMeta, fbPosts),
        meta:            buildMetaAdsData(adInsights7d, adInsights7dPrev, adCampaigns, adAudienceBreakdown, adCreatives),
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

  function sumMetric(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).reduce((s, v) => s + (Number(v.value) || 0), 0);
  }

  function dailyArray(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).map(v => Number(v.value) || 0);
  }

  const reach7d          = sumMetric(insights7d,     'reach');
  const reach7dPrev      = sumMetric(insights7dPrev, 'reach');
  const impressions7d    = sumMetric(insights7d,     'impressions');
  const impressionsPrev  = sumMetric(insights7dPrev, 'impressions');
  const reachTrend       = dailyArray(insights30d, 'reach');
  const impressionsTrend = dailyArray(insights30d, 'impressions');

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
      pillar:        '',
      perfScore,
      gender:        { female: 0, male: 0 },
      age:           [],
      bookingClicks: 0,
    };
  });

  const totalEngagements = posts.reduce((s, p) => s + p.likes + p.comments + p.saves, 0);
  const totalReach       = posts.reduce((s, p) => s + p.reach, 0);
  const engagementRate   = totalReach > 0 ? +((totalEngagements / totalReach) * 100).toFixed(2) : 0;
  const engagementRatePrev = reach7dPrev > 0
    ? +((totalEngagements / reach7dPrev) * 100).toFixed(2)
    : 0;
  const engagementTrend = reachTrend.map(r =>
    r > 0 ? +((totalEngagements / Math.max(reachTrend.reduce((a, b) => a + b, 0), 1)) * 100).toFixed(2) : 0
  );

  return {
    reach7d,
    reach7dPrev,
    engagementRate,
    engagementRatePrev,
    impressions7d,
    impressionsPrev,
    followers:     Number(account.followers_count || 0),
    followersPrev: 0,
    posts7d:       posts.length,
    stories7d:     0,
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
function buildFBData(insights, insightsPrev, pageAccount, postsResp) {
  if (!insights && !pageAccount) return null;

  function latestValue(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    const vals   = metric?.values || [];
    return Number(vals[vals.length - 1]?.value || 0);
  }

  const reach7d           = latestValue(insights, 'page_impressions_unique');
  const reach7dPrev       = latestValue(insightsPrev, 'page_impressions_unique');
  const impressions7d     = latestValue(insights, 'page_impressions');
  const impressionsPrev   = latestValue(insightsPrev, 'page_impressions');
  const engaged           = latestValue(insights, 'page_engaged_users');
  const engagedPrev       = latestValue(insightsPrev, 'page_engaged_users');
  const engagementRate    = reach7d > 0 ? +((engaged / reach7d) * 100).toFixed(2) : 0;
  const engagementRatePrev = reach7dPrev > 0 ? +((engagedPrev / reach7dPrev) * 100).toFixed(2) : 0;
  const posts7d           = (postsResp?.data || []).length;

  return {
    reach7d,
    reach7dPrev,
    engagementRate,
    engagementRatePrev,
    impressions7d,
    impressionsPrev,
    pageLikes:       Number(pageAccount?.fan_count || 0),
    pageLikesPrev:   0,
    posts7d,
    reachTrend:      [],
    engagementTrend: [],
  };
}

// ─── META ADS DATA BUILDER ────────────────────────────────────────────────────
function buildMetaAdsData(insights7d, insights7dPrev, campaignsData, audienceData, adsData) {
  if (!insights7d) return null;

  function getAction(actions, ...types) {
    return types.reduce((s, t) => {
      const found = (actions || []).find(a => a.action_type === t);
      return s + Number(found?.value || 0);
    }, 0);
  }

  const current       = insights7d?.data?.[0] || {};
  const spend7d       = +(Number(current.spend       || 0)).toFixed(2);
  const impressions7d = Number(current.impressions   || 0);
  const clicks7d      = Number(current.clicks        || 0);
  const ctr           = +(Number(current.ctr         || 0)).toFixed(2);

  const leads7d     = getAction(current.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
  const revenue     = getAction(current.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roas        = spend7d > 0 && revenue > 0 ? +(revenue / spend7d).toFixed(2) : 0;
  const costPerLead = leads7d > 0 ? +(spend7d / leads7d).toFixed(2) : 0;

  const prev            = insights7dPrev?.data?.[0] || {};
  const spendPrev       = +(Number(prev.spend || 0)).toFixed(2);
  const leadsPrev       = getAction(prev.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
  const costPerLeadPrev = leadsPrev > 0 ? +(spendPrev / leadsPrev).toFixed(2) : 0;
  const revenuePrev     = getAction(prev.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roasPrev        = spendPrev > 0 && revenuePrev > 0 ? +(revenuePrev / spendPrev).toFixed(2) : 0;

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

  // Audience breakdown — aggregate by age+gender bucket, express as percentages
  const audienceBreakdown = buildAudienceBreakdown(audienceData);

  // Creative performance — top ads by spend
  const creatives = buildCreatives(adsData);

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
    creatives,
    audienceBreakdown,
  };
}

// ─── AUDIENCE BREAKDOWN BUILDER ───────────────────────────────────────────────
function buildAudienceBreakdown(audienceData) {
  const rows = audienceData?.data || [];
  if (!rows.length) return [];

  // Sum spend per age+gender bucket
  const buckets = {};
  let total = 0;
  for (const row of rows) {
    const label = `${row.age} ${row.gender === 'male' ? 'M' : row.gender === 'female' ? 'F' : row.gender}`;
    const spend = Number(row.spend || 0);
    buckets[label] = (buckets[label] || 0) + spend;
    total += spend;
  }

  if (total === 0) return [];

  return Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, spend]) => ({
      label,
      pct: Math.round((spend / total) * 100),
    }));
}

// ─── CREATIVE PERFORMANCE BUILDER ────────────────────────────────────────────
function buildCreatives(adsData) {
  const ads = adsData?.data || [];
  if (!ads.length) return [];

  function getAction(actions, ...types) {
    return types.reduce((s, t) => {
      const found = (actions || []).find(a => a.action_type === t);
      return s + Number(found?.value || 0);
    }, 0);
  }

  return ads
    .map(ad => {
      const ins   = ad.insights?.data?.[0] || {};
      const spend = +(Number(ins.spend || 0)).toFixed(2);
      const leads = getAction(ins.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
      const cpl   = leads > 0 ? +(spend / leads).toFixed(2) : 0;
      const brand = /online|coaching|rehab|network|classroom/i.test(ad.name) ? 'Online' : 'HQ';

      return { name: ad.name, brand, spend, leads, cpl };
    })
    .filter(c => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────
async function metaGet(path, params = {}, retries = 3) {
  const qs  = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  const url = `${GRAPH}${path}?${qs}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url);

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

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function fmtDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
