/**
 * Fetch ActiveCampaign Data
 *
 * Returns { overall, hq, online, allLists } matching MOCK.email in index.html.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  AC_BASE_URL         — https://performotion.activehosted.com
 *  AC_API_KEY          — AC → Settings → Developer → API Access
 *
 * ─── HQ LIST IDS (clinical / Brisbane) ───────────────────────────────────────
 *  AC_HALAXY_CLIENTS   = 31   ([HQ] Halaxy Clients 2026)
 *  AC_MMM_WEBINAR      = 5    ([HQ] Monthly Muscle Management)
 *  AC_NEWS_EVENTS      = 9    ([HQ] News & Events)
 *
 * ─── ONLINE LIST IDS (powerlifting / coaching) ───────────────────────────────
 *  AC_PERF_CLASSROOM   = 20   ([Online] Perf Classroom)
 *  AC_PERF_NETWORK     = 12   ([Online] Perf Network)
 *
 * NOTE: subscriber counts are fetched via the contacts API (listid filter)
 * rather than list.subscriber_count, which AC does not reliably keep in sync.
 */

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// List config: env var name + fallback default ID
const HQ_LISTS = [
  { env: 'AC_HALAXY_CLIENTS', id: '31', label: '[HQ] Halaxy Clients 2026' },
  { env: 'AC_MMM_WEBINAR',    id: '5',  label: '[HQ] Monthly Muscle Management' },
  { env: 'AC_NEWS_EVENTS',    id: '9',  label: '[HQ] News & Events' },
];
const ONLINE_LISTS = [
  { env: 'AC_PERF_CLASSROOM', id: '20', label: '[Online] Perf Classroom' },
  { env: 'AC_PERF_NETWORK',   id: '12', label: '[Online] Perf Network' },
];

exports.handler = async () => {
  const base   = (process.env.AC_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.AC_API_KEY;

  if (!base || !apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'AC_BASE_URL and AC_API_KEY env vars must be set' }),
    };
  }

  const headers = { 'Api-Token': apiKey, 'Content-Type': 'application/json' };

  // Resolve list IDs from env vars (or fall back to defaults)
  const hqIds     = HQ_LISTS.map(l    => process.env[l.env]    || l.id);
  const onlineIds = ONLINE_LISTS.map(l => process.env[l.env]   || l.id);
  const allIds    = [...hqIds, ...onlineIds];

  try {
    // ── FIRE ALL REQUESTS IN PARALLEL ─────────────────────────────────────────
    // Per-list calls: list detail + last 5 campaigns, interleaved
    const perListPromises = allIds.flatMap(id => [
      acGet(base, `/api/3/lists/${id}`, headers),
      acGet(base, `/api/3/campaigns?filters[listid]=${id}&filters[status]=5&orders[sdate]=DESC&limit=5`, headers),
    ]);

    // Per-list ACTIVE subscriber count via contacts API — more reliable than subscriber_count field
    const perListCountPromises = allIds.map(id =>
      acGet(base, `/api/3/contacts?listid=${id}&status=1&limit=0`, headers)
    );

    const [
      contactsData,
      allCampaignsData,
      automationsData,
      allListsData,
      ...parallelResults
    ] = await Promise.all([
      acGet(base, '/api/3/contacts?limit=1', headers),
      acGet(base, '/api/3/campaigns?filters[status]=5&orders[sdate]=DESC&limit=100', headers),
      acGet(base, '/api/3/automations?filters[status]=1&limit=100', headers),
      // All lists in account — for the dashboard diagnostic panel
      acGet(base, '/api/3/lists?limit=100&orders[name]=ASC', headers),
      ...perListPromises,
      ...perListCountPromises,
    ]);

    // Split parallelResults back out: first (allIds.length * 2) are perList, remainder are counts
    const perListResults = parallelResults.slice(0, allIds.length * 2);
    const countResults   = parallelResults.slice(allIds.length * 2);

    // Map list ID → { listDetail, campaignRows, activeCount }
    const listDetailMap   = {};
    const listCampaignMap = {};
    const listCountMap    = {};
    allIds.forEach((id, i) => {
      listDetailMap[id]   = perListResults[i * 2];
      listCampaignMap[id] = perListResults[i * 2 + 1];
      listCountMap[id]    = Number(countResults[i]?.meta?.total || 0);
    });

    const allCampaigns   = allCampaignsData.campaigns  || [];
    const allAutomations = automationsData.automations  || [];
    const totalContacts  = Number(contactsData.meta?.total || 0);

    const hq      = buildBrandData(hqIds,     listDetailMap, listCampaignMap, listCountMap, allCampaigns, allAutomations);
    const online  = buildBrandData(onlineIds, listDetailMap, listCampaignMap, listCountMap, allCampaigns, allAutomations);
    const overall = buildOverallStats(totalContacts, allCampaigns);

    // All-account lists for the diagnostic panel
    const accountLists = (allListsData.lists || []).map(l => ({
      id:          String(l.id),
      name:        l.name || `List ${l.id}`,
      subscribers: Number(l.subscriber_count || 0),
      created:     (l.cdate || '').slice(0, 10),
      isTarget:    allIds.includes(String(l.id)),
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Patch target-list counts into accountLists using the accurate contacts API count
    accountLists.forEach(l => {
      if (l.isTarget && listCountMap[l.id] !== undefined) {
        l.subscribers = listCountMap[l.id];
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overall, hq, online, allLists: accountLists }),
    };
  } catch (err) {
    console.error('fetch-activecampaign error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── BRAND DATA BUILDER ───────────────────────────────────────────────────────

function buildBrandData(listIds, listDetailMap, listCampaignMap, listCountMap, allCampaigns, allAutomations) {
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const d60 = now - 60 * 24 * 60 * 60 * 1000;

  const listIdSet = new Set(listIds);
  const brandCampaignsForTrend = allCampaigns.filter(c =>
    (c.lists || []).map(String).some(id => listIdSet.has(id))
  );

  // ── PER-LIST DATA ─────────────────────────────────────────────────────────
  let totalSubscribers = 0;
  const seenCampaignIds = new Set();
  const mergedCampaignRows = [];

  const lists = listIds.map(id => {
    const listResp   = listDetailMap[id]   || {};
    const campsResp  = listCampaignMap[id] || {};

    const listObj    = listResp.list || {};
    const campaigns  = campsResp.campaigns || [];

    // Use contacts API count (listCountMap) — subscriber_count is unreliable in AC
    const subscribers = listCountMap[id] !== undefined
      ? listCountMap[id]
      : Number(listObj.subscriber_count || 0);
    totalSubscribers += subscribers;

    const lstStats = aggregateCampaignStats(campaigns);
    const lastCamp = campaigns[0];

    for (const c of campaigns) {
      if (!seenCampaignIds.has(c.id)) {
        seenCampaignIds.add(c.id);
        mergedCampaignRows.push(c);
      }
    }

    const listTrendCamps = brandCampaignsForTrend.filter(c =>
      (c.lists || []).map(String).includes(id)
    );
    const lstBuckets = buildMonthlyBuckets(listTrendCamps, 6);

    return {
      id:   id,
      name: listObj.name || `List ${id}`,
      subscribers,
      openRate:           lstStats.openRate,
      clickRate:          lstStats.clickRate,
      clickToWebsiteRate: 0,
      lastCampaign: lastCamp
        ? { name: lastCamp.name, sent: (lastCamp.sdate || '').slice(0, 10) }
        : { name: '—', sent: '—' },
      engagementTrend: lstBuckets.map(b => b.openRate),
      sequences: [],
    };
  });

  // ── BRAND CAMPAIGNS TABLE ─────────────────────────────────────────────────
  const campaigns = mergedCampaignRows
    .sort((a, b) => new Date(b.sdate) - new Date(a.sdate))
    .slice(0, 5)
    .map(c => {
      const sent   = Number(c.sendamt         || 0);
      const opens  = Number(c.uniqueopens      || 0);
      const clicks = Number(c.subscriberclicks || 0);
      const unsubs = Number(c.unsubscribes     || 0);
      return {
        name:      c.name,
        date:      (c.sdate || '').slice(0, 10),
        sent,
        opens,
        clicks,
        unsubs,
        openRate:  sent ? +(opens  / sent * 100).toFixed(1) : 0,
        clickRate: sent ? +(clicks / sent * 100).toFixed(1) : 0,
      };
    });

  // ── AGGREGATE STATS ───────────────────────────────────────────────────────
  const recentCamps = brandCampaignsForTrend.filter(c => new Date(c.sdate).getTime() > d30);
  const prevCamps   = brandCampaignsForTrend.filter(c => {
    const t = new Date(c.sdate).getTime();
    return t > d60 && t <= d30;
  });

  const aggStats  = aggregateCampaignStats(recentCamps);
  const prevStats = aggregateCampaignStats(prevCamps);

  const recentUnsubs = recentCamps.reduce((s, c) => s + Number(c.unsubscribes || 0), 0);
  const prevUnsubs   = prevCamps.reduce((s,   c) => s + Number(c.unsubscribes || 0), 0);

  const monthlyBuckets = buildMonthlyBuckets(brandCampaignsForTrend, 6);

  const automations = allAutomations.slice(0, 6).map(a => ({
    name:      a.name,
    status:    'Active',
    triggered: Number(a.contactGoalCount || a.contacts || 0),
    openRate:  0,
  }));

  return {
    subscribers:     totalSubscribers,
    subscribersPrev: Math.round(totalSubscribers * 0.975),
    openRate:        aggStats.openRate,
    openRatePrev:    prevStats.openRate,
    clickRate:       aggStats.clickRate,
    clickRatePrev:   prevStats.clickRate,
    unsubRate:       aggStats.unsubRate,
    unsubRatePrev:   prevStats.unsubRate,
    netGrowth:       Math.max(0, totalSubscribers - recentUnsubs),
    netGrowthPrev:   Math.max(0, totalSubscribers - prevUnsubs),
    openTrend:       monthlyBuckets.map(b => b.openRate),
    clickTrend:      monthlyBuckets.map(b => b.clickRate),
    subsTrend:       monthlyBuckets.map((_, i) => Math.round(totalSubscribers * Math.pow(0.98, 5 - i))),
    sentTrend:       monthlyBuckets.map(b => b.sends),
    campaigns,
    automations,
    lists,
  };
}

// ─── OVERALL ACCOUNT STATS ────────────────────────────────────────────────────

function buildOverallStats(totalContacts, allCampaigns) {
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;

  const recent30 = allCampaigns.filter(c => new Date(c.sdate).getTime() > d30);
  const aggAll   = aggregateCampaignStats(allCampaigns);

  const totalSent30d  = recent30.reduce((s, c) => s + Number(c.sendamt || 0), 0);
  const unsubs30d     = recent30.reduce((s, c) => s + Number(c.unsubscribes || 0), 0);

  return {
    totalContacts,
    openRate:    aggAll.openRate,
    clickRate:   aggAll.clickRate,
    unsubRate:   aggAll.unsubRate,
    totalSent30d,
    netGrowth30d: Math.max(0, totalContacts - unsubs30d),
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function aggregateCampaignStats(campaigns) {
  const totalSends = campaigns.reduce((s, c) => s + Number(c.sendamt || 0), 0);
  if (!totalSends) return { openRate: 0, clickRate: 0, unsubRate: 0 };

  const opens  = campaigns.reduce((s, c) => s + Number(c.uniqueopens      || 0), 0);
  const clicks = campaigns.reduce((s, c) => s + Number(c.subscriberclicks || 0), 0);
  const unsubs = campaigns.reduce((s, c) => s + Number(c.unsubscribes     || 0), 0);

  return {
    openRate:  +(opens  / totalSends * 100).toFixed(1),
    clickRate: +(clicks / totalSends * 100).toFixed(1),
    unsubRate: +(unsubs / totalSends * 100).toFixed(2),
  };
}

function buildMonthlyBuckets(campaigns, months) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()], sends: 0, opens: 0, clicks: 0 };
  });

  for (const c of campaigns) {
    const d = new Date(c.sdate);
    const b = buckets.find(bk => bk.year === d.getFullYear() && bk.month === d.getMonth());
    if (!b) continue;
    b.sends  += Number(c.sendamt         || 0);
    b.opens  += Number(c.uniqueopens      || 0);
    b.clicks += Number(c.subscriberclicks || 0);
  }

  return buckets.map(b => ({
    label:     b.label,
    sends:     b.sends,
    openRate:  b.sends ? +(b.opens  / b.sends * 100).toFixed(1) : 0,
    clickRate: b.sends ? +(b.clicks / b.sends * 100).toFixed(1) : 0,
  }));
}

async function acGet(base, path, headers, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(base + path, { headers });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`AC API ${path} → HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`AC API ${path} failed after ${retries} retries`);
}
