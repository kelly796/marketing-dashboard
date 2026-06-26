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
 *
 * ─── ⚠️  TOKEN EXPIRY — ACTION REQUIRED EVERY ~55 DAYS ───────────────────────
 *  Long-lived Meta access tokens expire after 60 days. There is NO auto-refresh.
 *  When the token expires ALL Meta data (Instagram HQ, Instagram Online, Facebook
 *  Page, Meta Ads) will silently fail.
 *
 *  How to refresh:
 *   1. Go to Meta for Developers → Tools → Graph API Explorer
 *   2. Generate a new short-lived User Token with the required permissions above
 *   3. GET /api/exchange-token?short_lived_token=<new_short_token>
 *      (this calls exchange-token.js and returns a 60-day token)
 *   4. Update META_ACCESS_TOKEN in Netlify → Site configuration → Environment variables
 *   5. Trigger a new Netlify deploy so the function picks up the new value
 *
 *  Tip: set a recurring calendar reminder for every 50 days so you never miss it.
 */

const GRAPH   = 'https://graph.facebook.com/v21.0';
const WINDSOR = 'https://connectors.windsor.ai/all';

exports.handler = async () => {
  const token        = process.env.META_ACCESS_TOKEN;
  const adAccountId  = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  const hqPageId     = process.env.META_HQ_PAGE_ID;
  const onlinePageId = process.env.META_ONLINE_PAGE_ID;
  const windsorKey   = process.env.WINDSOR_API_KEY;

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
      hqPageId     ? metaGet(`/${hqPageId}`,     { fields: 'instagram_business_account,fan_count,name,access_token', access_token: token }) : null,
      onlinePageId ? metaGet(`/${onlinePageId}`,  { fields: 'instagram_business_account,fan_count,name', access_token: token }) : null,
    ]);

    const igHqId     = hqPageMeta?.instagram_business_account?.id     || null;
    const igOnlineId = onlinePageMeta?.instagram_business_account?.id || null;
    // Page access token required for page insights on New Pages Experience
    const pageToken  = hqPageMeta?.access_token || token;

    // ── STEP 2: Fetch all data in parallel ─────────────────────────────────────
    const [
      igHqAccount, igHqInsights7d, igHqInsights7dPrev, igHqInsights30d, igHqMedia, igHqAudience, igHqTotalViews7d, igHqTotalViewsPrev,
      igOnAccount, igOnInsights7d, igOnInsights7dPrev, igOnInsights30d, igOnMedia, igOnAudience, igOnTotalViews7d, igOnTotalViewsPrev,
      fbInsights, fbInsightsPrev, fbPosts,
      adInsights7d, adInsights7dPrev, adCampaigns, adAudienceBreakdown, adCreatives, adInsights30d, adPerAdBreakdown,
    ] = await Promise.all([

      // ── IG HQ ──────────────────────────────────────────────────────────────
      igHqId ? metaGet(`/${igHqId}`, { fields: 'followers_count,media_count,name', access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach,profile_views', period: 'day', since: since7,  until: now,    access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach',               period: 'day', since: since14, until: since7, access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'reach',               period: 'day', since: since30, until: now,    access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/media`,    { fields: 'id,caption,media_type,timestamp,like_count,comments_count', limit: 10, access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'age,gender', access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day', since: since7,  until: now,    access_token: token }).catch(() => null) : null,
      igHqId ? metaGet(`/${igHqId}/insights`, { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day', since: since14, until: since7, access_token: token }).catch(() => null) : null,

      // ── IG ONLINE ──────────────────────────────────────────────────────────
      igOnlineId ? metaGet(`/${igOnlineId}`, { fields: 'followers_count,media_count,name', access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach,profile_views', period: 'day', since: since7,  until: now,    access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach',               period: 'day', since: since14, until: since7, access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'reach',               period: 'day', since: since30, until: now,    access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/media`,    { fields: 'id,caption,media_type,timestamp,like_count,comments_count', limit: 10, access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: 'age,gender', access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day', since: since7,  until: now,    access_token: token }).catch(() => null) : null,
      igOnlineId ? metaGet(`/${igOnlineId}/insights`, { metric: 'views,total_interactions', metric_type: 'total_value', period: 'day', since: since14, until: since7, access_token: token }).catch(() => null) : null,

      // ── FACEBOOK PAGE ──────────────────────────────────────────────────────
      // Note: Page insights are not available for New Pages Experience via API.
      // We fetch posts directly instead.
      hqPageId ? metaGet(`/${hqPageId}/posts`, {
        fields: 'id,message,created_time,likes.summary(true),comments.summary(true)',
        since: since30,
        until: now,
        limit: 10,
        access_token: pageToken,
      }).catch(() => null) : null,
      null, // fbInsightsPrev — not used
      null, // fbPosts — merged into fbInsights slot above

      // ── META ADS ───────────────────────────────────────────────────────────
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,reach,actions,action_values,conversions',
        date_preset: 'last_7d',
        access_token: token,
      }).catch(() => null) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,reach,actions,action_values,conversions',
        time_range: JSON.stringify({ since: fmtDate(since14), until: fmtDate(since7) }),
        access_token: token,
      }).catch(() => null) : null,
      adAccountId ? metaGet(`/act_${adAccountId}/campaigns`, {
        fields: 'name,status,objective,insights.date_preset(last_7d){spend,impressions,clicks,ctr,actions,conversions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 10,
        access_token: token,
      }) : null,
      // Audience breakdown by age and gender
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,reach,actions,conversions',
        date_preset: 'last_7d',
        breakdowns: 'age,gender',
        access_token: token,
      }).catch(() => null) : null,
      // Creative performance — top ads with spend + leads
      adAccountId ? metaGet(`/act_${adAccountId}/ads`, {
        fields: 'name,status,creative{name,thumbnail_url},insights.date_preset(last_7d){spend,impressions,clicks,ctr,inline_link_click_ctr,reach,actions,conversions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 10,
        access_token: token,
      }).catch(() => null) : null,
      // Daily breakdown for spend + leads + impressions + clicks trend (30 days)
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,actions,conversions',
        date_preset: 'last_30d',
        time_increment: '1',
        access_token: token,
      }).catch(() => null) : null,
      // Per-ad age + gender breakdown
      adAccountId ? metaGet(`/act_${adAccountId}/insights`, {
        level: 'ad',
        fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,reach,actions,conversions',
        breakdowns: 'age,gender',
        date_preset: 'last_7d',
        access_token: token,
      }).catch(() => null) : null,
    ]);

    // Fetch per-post insights for IG HQ and Online (reach + saved per post)
    const [igHqPostInsights, igOnPostInsights, windsor7d, windsor30d, windsor14d] = await Promise.all([
      igHqMedia ? fetchPostInsights(igHqMedia.data   || [], token) : [],
      igOnMedia ? fetchPostInsights(igOnMedia.data   || [], token) : [],
      windsorKey ? windsorFetch(windsorKey, 'last_7d',  'date,account_name,reach,accounts_engaged').catch(() => null) : null,
      windsorKey ? windsorFetch(windsorKey, 'last_30d', 'date,account_name,reach,accounts_engaged').catch(() => null) : null,
      windsorKey ? windsorFetch(windsorKey, 'last_14d', 'date,account_name,reach,accounts_engaged').catch(() => null) : null,
    ]);

    const windsorHQ   = buildWindsorIG(windsor7d,  windsor30d, windsor14d, 'performotion_hq');
    const windsorOnline = buildWindsorIG(windsor7d, windsor30d, windsor14d, 'performotion_online');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instagramHQ:     mergeWindsor(buildIGData(igHqAccount, igHqInsights7d, igHqInsights7dPrev, igHqInsights30d, igHqMedia, igHqPostInsights, igHqAudience, igHqTotalViews7d, igHqTotalViewsPrev), windsorHQ),
        instagramOnline: mergeWindsor(buildIGData(igOnAccount, igOnInsights7d, igOnInsights7dPrev, igOnInsights30d, igOnMedia, igOnPostInsights, igOnAudience, igOnTotalViews7d, igOnTotalViewsPrev), windsorOnline),
        facebook:        buildFBData(fbInsights, fbInsightsPrev, hqPageMeta, fbPosts),
        meta:            buildMetaAdsData(adInsights7d, adInsights7dPrev, adCampaigns, adAudienceBreakdown, adCreatives, adInsights30d, adPerAdBreakdown),
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
          metric: 'reach,saved,views',
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
function buildIGData(account, insights7d, insights7dPrev, insights30d, media, postInsights, audienceInsights, totalViews7d, totalViewsPrev) {
  if (!account) return null;

  function sumMetric(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).reduce((s, v) => s + (Number(v.value) || 0), 0);
  }

  function dailyArray(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return (metric?.values || []).map(v => Number(v.value) || 0);
  }

  function totalValue(insightsResp, name) {
    const metric = (insightsResp?.data || []).find(m => m.name === name);
    return Number(metric?.total_value?.value || 0);
  }

  const reach7d          = sumMetric(insights7d,     'reach');
  const reach7dPrev      = sumMetric(insights7dPrev, 'reach');
  const impressions7d    = totalValue(totalViews7d,   'views');
  const impressionsPrev  = totalValue(totalViewsPrev,  'views');
  const reachTrend       = padTo30(dailyArray(insights30d, 'reach'));
  const impressionsTrend = reachTrend;

  const audienceDemographics = parseAudienceDemographics(audienceInsights);

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
        caption:       escapeHtml((post.caption || '').slice(0, 120)),
      type:          normalizeMediaType(post.media_type),
      date:          (post.timestamp || '').slice(0, 10),
      reach:         postReach,
      likes,
      comments,
      saves:         saved,
      pillar:        '',
      perfScore,
      gender:        audienceDemographics.gender,
      age:           audienceDemographics.age,
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
function buildFBData(postsResp, _unused1, pageAccount, _unused2) {
  if (!pageAccount) return null;

  const posts = (postsResp?.data || []).map(p => ({
    id:        p.id,
    message:   escapeHtml((p.message || '').substring(0, 120)),
    date:      p.created_time,
    likes:     Number(p.likes?.summary?.total_count || 0),
    comments:  Number(p.comments?.summary?.total_count || 0),
  }));

  return {
    fanCount:        Number(pageAccount?.fan_count || 0),
    followersCount:  Number(pageAccount?.followers_count || pageAccount?.fan_count || 0),
    posts30d:        posts.length,
    recentPosts:     posts,
    // Page view insights not available via API for New Pages Experience
    pageViews7d:     null,
    pageViewsPrev:   null,
    engagement7d:    null,
    reachTrend:      Array(30).fill(0),
  };
}

// ─── META ADS DATA BUILDER ────────────────────────────────────────────────────
function buildMetaAdsData(insights7d, insights7dPrev, campaignsData, audienceData, adsData, insights30d, perAdBreakdown) {
  if (!insights7d) return null;

  function getAction(actions, ...types) {
    return (actions || []).reduce((s, a) => {
      const t = a.action_type || '';
      const match = types.includes(t) || t === 'form_success' || t.startsWith('offsite_conversion.custom.');
      return match ? s + Number(a.value || 0) : s;
    }, 0);
  }

  // Meta's `conversions` field is more reliable than `actions` for custom conversions —
  // it matches what Ads Manager reports, whereas `actions` can undercount when attribution
  // settings differ across campaigns.
  function getConversions(convArr) {
    return (convArr || []).reduce((s, a) => s + Number(a.value || 0), 0);
  }

  const current       = insights7d?.data?.[0] || {};
  const spend7d       = +(Number(current.spend       || 0)).toFixed(2);
  const impressions7d = Number(current.impressions   || 0);
  const clicks7d      = Number(current.clicks        || 0);
  const ctr           = +(Number(current.ctr         || 0)).toFixed(2);

  const leadsFromInsights    = getAction(current.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead', 'onsite_conversion.lead_grouped');
  const leadsFromConversions = getConversions(current.conversions);
  const revenue     = getAction(current.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roas        = spend7d > 0 && revenue > 0 ? +(revenue / spend7d).toFixed(2) : 0;

  const prev            = insights7dPrev?.data?.[0] || {};
  const spendPrev       = +(Number(prev.spend || 0)).toFixed(2);
  const leadsPrevActions = getAction(prev.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead', 'onsite_conversion.lead_grouped')
                         + sumCustomConversions(prev.custom_conversions);
  const leadsPrevConv    = getConversions(prev.conversions);
  const leadsPrev        = Math.max(leadsPrevActions, leadsPrevConv);
  const costPerLeadPrev  = leadsPrev > 0 ? +(spendPrev / leadsPrev).toFixed(2) : 0;
  const revenuePrev     = getAction(prev.action_values, 'purchase', 'offsite_conversion.fb_pixel_purchase');
  const roasPrev        = spendPrev > 0 && revenuePrev > 0 ? +(revenuePrev / spendPrev).toFixed(2) : 0;

  // Audience breakdown — build early so we can derive leads7d from it.
  // Use the highest of all three sources: actions, conversions field, and age breakdown sum.
  const audienceBreakdown  = buildAudienceBreakdown(audienceData);
  const leadsFromBreakdown = audienceBreakdown.reduce((s, b) => s + (b.leads || 0), 0);
  const leads7d     = Math.max(leadsFromInsights, leadsFromConversions, leadsFromBreakdown);
  const costPerLead = leads7d > 0 ? +(spend7d / leads7d).toFixed(2) : 0;

  // Campaigns
  const campaigns = (campaignsData?.data || []).map(c => {
    const ci    = c.insights?.data?.[0] || {};
    const cSpend = +(Number(ci.spend || 0)).toFixed(2);
    const cLeadsAct  = getAction(ci.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead', 'onsite_conversion.lead_grouped');
    const cLeadsConv = getConversions(ci.conversions);
    const cLeads     = Math.max(cLeadsAct, cLeadsConv);
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

  // If campaign-level API returns 0 leads but the account total is > 0,
  // distribute leads7d across campaigns proportionally by spend.
  const totalCampaignLeads = campaigns.reduce((s, c) => s + c.leads, 0);
  if (totalCampaignLeads === 0 && leads7d > 0) {
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    if (totalSpend > 0) {
      let assigned = 0;
      campaigns.forEach((c, i) => {
        if (i < campaigns.length - 1) {
          const share = Math.round(leads7d * c.spend / totalSpend);
          c.leads = share;
          assigned += share;
        } else {
          c.leads = leads7d - assigned;
        }
        c.cpl = c.leads > 0 ? +(c.spend / c.leads).toFixed(2) : 0;
      });
    } else if (campaigns.length > 0) {
      campaigns[0].leads = leads7d;
      campaigns[0].cpl = campaigns[0].spend > 0 ? +(campaigns[0].spend / leads7d).toFixed(2) : 0;
    }
  }

  // Creative performance — top ads by spend, enriched with per-ad audience
  const creatives = buildCreatives(adsData, perAdBreakdown);

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
    spendTrend:       buildDailyTrend(insights30d, r => +(Number(r.spend || 0)).toFixed(2)),
    leadsTrend:       buildDailyTrend(insights30d, r => getConversions(r.conversions)),
    impressionsTrend: buildDailyTrend(insights30d, r => Number(r.impressions || 0)),
    clicksTrend:      buildDailyTrend(insights30d, r => Number(r.clicks || 0)),
    campaigns,
    creatives,
    audienceBreakdown,
  };
}

// ─── AUDIENCE BREAKDOWN BUILDER ───────────────────────────────────────────────
function buildAudienceBreakdown(audienceData) {
  const rows = audienceData?.data || [];
  if (!rows.length) return [];

  // Aggregate by age bucket (summing across genders)
  const ageBuckets = {};
  for (const row of rows) {
    const age = row.age || 'unknown';
    if (!ageBuckets[age]) ageBuckets[age] = { spend: 0, impressions: 0, clicks: 0, leads: 0 };
    ageBuckets[age].spend      += Number(row.spend       || 0);
    ageBuckets[age].impressions += Number(row.impressions || 0);
    ageBuckets[age].clicks     += Number(row.clicks      || 0);
    const rowLeads = (row.actions || []).reduce((s, a) => {
      const t = a.action_type || '';
      return (t === 'lead' || t === 'form_success' || t.startsWith('offsite_conversion.') || t === 'onsite_web_lead' || t === 'onsite_conversion.lead_grouped')
        ? s + Number(a.value || 0) : s;
    }, 0);
    ageBuckets[age].leads += rowLeads;
  }

  const totalSpend = Object.values(ageBuckets).reduce((s, b) => s + b.spend, 0);
  if (totalSpend === 0) return [];

  const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const result = AGE_ORDER
    .filter(a => ageBuckets[a])
    .map(age => {
      const b = ageBuckets[age];
      return {
        label:  age,
        spend:  +b.spend.toFixed(2),
        pct:    Math.round((b.spend / totalSpend) * 100),
        ctr:    b.impressions > 0 ? +((b.clicks / b.impressions) * 100).toFixed(2) : 0,
        leads:  b.leads,
        cpl:    b.leads > 0 ? +(b.spend / b.leads).toFixed(2) : 0,
      };
    });

  // Append unknown bucket if present
  if (ageBuckets['unknown'] && ageBuckets['unknown'].spend > 0) {
    const b = ageBuckets['unknown'];
    result.push({
      label:  'Other',
      spend:  +b.spend.toFixed(2),
      pct:    Math.round((b.spend / totalSpend) * 100),
      ctr:    b.impressions > 0 ? +((b.clicks / b.impressions) * 100).toFixed(2) : 0,
      leads:  b.leads,
      cpl:    b.leads > 0 ? +(b.spend / b.leads).toFixed(2) : 0,
    });
  }

  return result;
}

// ─── CREATIVE PERFORMANCE BUILDER ────────────────────────────────────────────
function buildCreatives(adsData, perAdBreakdown) {
  const ads = adsData?.data || [];
  if (!ads.length) return [];

  function getAct(actions, ...types) {
    return (actions || []).reduce((s, a) => {
      const t = a.action_type || '';
      const match = types.includes(t) || t === 'form_success' || t.startsWith('offsite_conversion.custom.');
      return match ? s + Number(a.value || 0) : s;
    }, 0);
  }

  // Group per-ad breakdown rows by ad_id → track spend, impressions, clicks, leads per age+gender
  const audienceByAdId = {};
  for (const row of (perAdBreakdown?.data || [])) {
    const id = row.ad_id;
    if (!id) continue;
    if (!audienceByAdId[id]) audienceByAdId[id] = { spend: 0, genderSpend: {}, genderReach: {}, ageData: {} };
    const s     = Number(row.spend       || 0);
    const impr  = Number(row.impressions || 0);
    const clks  = Number(row.clicks      || 0);
    const rch   = Number(row.reach       || 0);
    // Use the same broad offsite_conversion.* match as buildAudienceBreakdown so
    // custom conversions (e.g. form_success) are captured regardless of their exact action_type suffix.
    const leads = (row.actions || []).reduce((s, a) => {
      const t = a.action_type || '';
      return (t === 'lead' || t === 'form_success' || t.startsWith('offsite_conversion.') || t === 'onsite_web_lead' || t === 'onsite_conversion.lead_grouped')
        ? s + Number(a.value || 0) : s;
    }, 0);

    audienceByAdId[id].spend += s;

    const g = row.gender || 'unknown';
    audienceByAdId[id].genderSpend[g] = (audienceByAdId[id].genderSpend[g] || 0) + s;
    audienceByAdId[id].genderReach[g] = (audienceByAdId[id].genderReach[g] || 0) + rch;

    const a = row.age || 'unknown';
    if (!audienceByAdId[id].ageData[a]) audienceByAdId[id].ageData[a] = { spend: 0, impressions: 0, clicks: 0, leads: 0 };
    audienceByAdId[id].ageData[a].spend       += s;
    audienceByAdId[id].ageData[a].impressions += impr;
    audienceByAdId[id].ageData[a].clicks      += clks;
    audienceByAdId[id].ageData[a].leads       += leads;
  }

  function toGenderBuckets(spendMap, reachMap, spendTotal, n = 3) {
    if (!spendTotal) return [];
    const reachTotal = Object.values(reachMap || {}).reduce((s, v) => s + v, 0);
    return Object.entries(spendMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, spend]) => ({
        label,
        pct:      Math.round((spend / spendTotal) * 100),
        spendPct: Math.round((spend / spendTotal) * 100),
        reachPct: reachTotal > 0 ? Math.round(((reachMap[label] || 0) / reachTotal) * 100) : 0,
      }));
  }

  function toAgeBuckets(ageData, totalSpend) {
    if (!totalSpend) return [];
    const AGE_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    return AGE_ORDER
      .filter(a => ageData[a])
      .map(age => {
        const b = ageData[age];
        return {
          label:  age,
          spend:  +b.spend.toFixed(2),
          pct:    Math.round((b.spend / totalSpend) * 100),
          ctr:    b.impressions > 0 ? +((b.clicks / b.impressions) * 100).toFixed(2) : 0,
          leads:  b.leads,
          cpl:    b.leads > 0 ? +(b.spend / b.leads).toFixed(2) : 0,
        };
      });
  }

  return ads
    .map(ad => {
      const ins   = ad.insights?.data?.[0] || {};
      const spend = +(Number(ins.spend || 0)).toFixed(2);
      const brand = /online|coaching|rehab|network|classroom/i.test(ad.name) ? 'Online' : 'HQ';

      const aud      = audienceByAdId[ad.id] || null;
      const audTotal = aud?.spend || 0;
      const gender   = aud ? toGenderBuckets(aud.genderSpend, aud.genderReach, audTotal, 3) : [];
      const age      = aud ? toAgeBuckets(aud.ageData, audTotal) : [];

      // Use highest of: actions, conversions field, or per-ad age breakdown sum
      const leadsFromInsights  = getAct(ins.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead', 'onsite_conversion.lead_grouped');
      const leadsFromConvField = (ins.conversions || []).reduce((s, a) => s + Number(a.value || 0), 0);
      const leadsFromBreakdown = aud ? Object.values(aud.ageData).reduce((s, b) => s + (b.leads || 0), 0) : 0;
      const leads = Math.max(leadsFromInsights, leadsFromConvField, leadsFromBreakdown);
      const cpl   = leads > 0 ? +(spend / leads).toFixed(2) : 0;
      const ctr         = +(Number(ins.inline_link_click_ctr || ins.ctr || 0)).toFixed(2);
      const impressions = Number(ins.impressions || 0);
      const reach       = Number(ins.reach || 0);

      return { id: ad.id, name: ad.name, brand, spend, leads, cpl, ctr, impressions, reach, gender, age };
    })
    .filter(c => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8);
}

// ─── AUDIENCE DEMOGRAPHICS PARSER ────────────────────────────────────────────
function parseAudienceDemographics(insightsResp) {
  const metric = (insightsResp?.data || []).find(m => m.name === 'audience_gender_age');
  const value  = metric?.values?.[0]?.value || {};

  let female = 0, male = 0;
  const ageBuckets = {};
  for (const [key, count] of Object.entries(value)) {
    const [gender, age] = key.split('.');
    if (gender === 'F') female += count;
    else if (gender === 'M') male += count;
    if (age) ageBuckets[age] = (ageBuckets[age] || 0) + count;
  }
  const total = female + male;
  if (total === 0) return { gender: { female: 0, male: 0 }, age: [] };

  const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  return {
    gender: {
      female: Math.round(female / total * 100),
      male:   Math.round(male   / total * 100),
    },
    age: AGE_ORDER
      .filter(b => ageBuckets[b])
      .map(b => ({ b, pct: Math.round(ageBuckets[b] / total * 100) })),
  };
}

// ─── CUSTOM CONVERSION HELPER ────────────────────────────────────────────────
// Meta custom conversions (form_success etc.) come back in a separate
// custom_conversions array rather than actions — sum all of them as leads.
function sumCustomConversions(customConversions) {
  return (customConversions || []).reduce((s, c) => s + Number(c.value || 0), 0);
}

// ─── ARRAY HELPERS ────────────────────────────────────────────────────────────
function padTo30(arr) {
  if (arr.length >= 30) return arr.slice(arr.length - 30);
  return Array(30 - arr.length).fill(0).concat(arr);
}

function buildDailyTrend(dailyData, valueFn) {
  const rows = (dailyData?.data || []).slice().sort((a, b) => (a.date_start > b.date_start ? 1 : -1));
  return padTo30(rows.map(valueFn));
}

// ─── MEDIA TYPE NORMALIZER ────────────────────────────────────────────────────
function normalizeMediaType(mt) {
  const s = (mt || 'POST').toUpperCase();
  if (s.includes('CAROUSEL')) return 'carousel';
  if (s === 'VIDEO')          return 'reel';
  return 'post';
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

// ─── HTML ESCAPE ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function fmtDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// ─── WINDSOR.AI HELPERS ───────────────────────────────────────────────────────
async function windsorFetch(apiKey, datePreset, fields) {
  const url = `${WINDSOR}?api_key=${apiKey}&date_preset=${datePreset}&fields=${fields}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Windsor API ${res.status}`);
  return res.json();
}

function buildWindsorIG(data7d, data30d, data14d, accountName) {
  const rows7d  = (data7d?.data  || []).filter(r => r.account_name === accountName);
  const rows30d = (data30d?.data || []).filter(r => r.account_name === accountName);
  const rows14d = (data14d?.data || []).filter(r => r.account_name === accountName);
  if (!rows7d.length && !rows30d.length) return null;

  const reach7d      = rows7d.reduce((s, r)  => s + (Number(r.reach) || 0), 0);
  // Previous 7d = days 8-14 (14d total minus first 7d)
  const reach14d     = rows14d.reduce((s, r) => s + (Number(r.reach) || 0), 0);
  const reach7dPrev  = Math.max(0, reach14d - reach7d);
  const engaged7d    = rows7d.reduce((s, r)  => s + (Number(r.accounts_engaged) || 0), 0);
  const engRate      = reach7d > 0 ? +((engaged7d / reach7d) * 100).toFixed(2) : 0;

  // 30-day reach trend (fill to 30 points)
  const sortedDates = [...new Set(rows30d.map(r => r.date))].sort();
  const reachByDate = {};
  rows30d.forEach(r => { reachByDate[r.date] = (reachByDate[r.date] || 0) + (Number(r.reach) || 0); });
  const reachTrend = padTo30(sortedDates.map(d => reachByDate[d] || 0));

  return { reach7d, reach7dPrev, engagementRate: engRate, reachTrend, impressions7d: reach7d };
}

function mergeWindsor(igData, windsorData) {
  if (!igData) return windsorData ? { ...windsorData, followers: 0, posts: [], posts7d: 0 } : null;
  if (!windsorData) return igData;
  return {
    ...igData,
    reach7d:         windsorData.reach7d         ?? igData.reach7d,
    reach7dPrev:     windsorData.reach7dPrev     ?? igData.reach7dPrev,
    impressions7d:   windsorData.impressions7d   ?? igData.impressions7d,
    engagementRate:  windsorData.engagementRate  ?? igData.engagementRate,
    reachTrend:      windsorData.reachTrend?.some(v => v > 0) ? windsorData.reachTrend : igData.reachTrend,
  };
}
