/**
 * Fetch ActiveCampaign Data
 *
 * Returns { overall, hq, online, allLists }.
 *
 * List detection is fully automatic — no hardcoded IDs, no env vars.
 * Lists are classified by name prefix:
 *   [HQ]     → PerforMotion HQ brand
 *   [Online] → PerforMotion Online brand
 *
 * Any list created in AC with one of those prefixes is picked up
 * automatically on the next dashboard Refresh.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  AC_BASE_URL  — https://performotion.activehosted.com
 *  AC_API_KEY   — AC → Settings → Developer → API Access
 */

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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

  try {
    // ── PHASE 1: fetch all lists + total contact count in parallel ─────────────
    const [allListsData, contactsData] = await Promise.all([
      acGet(base, '/api/3/lists?limit=100&orders[name]=ASC', headers),
      acGet(base, '/api/3/contacts?limit=1', headers),
    ]);

    const allACLists    = allListsData.lists || [];
    const totalContacts = Number(contactsData.meta?.total || 0);

    // Track every list in the account — no filtering, no config needed.
    // Brand is read from the list name if it contains [HQ] or [Online].
    // Lists without a prefix appear in the combined view and All Account Lists.
    const trackedIds = allACLists.map(l => String(l.id));
    const hqIds      = allACLists.filter(l => /\[HQ\]/i.test(l.name)).map(l => String(l.id));
    const onlineIds  = allACLists.filter(l => /\[Online\]/i.test(l.name)).map(l => String(l.id));
    // Lists with no brand prefix — still tracked, surfaced in combined/all views
    const otherIds   = trackedIds.filter(id => !hqIds.includes(id) && !onlineIds.includes(id));

    // Build name lookup from the lists we already have
    const listNameMap = {};
    allACLists.forEach(l => { listNameMap[String(l.id)] = l.name; });

    // ── PHASE 2: per-list campaigns + subscriber counts + account-wide data ────
    const perListCampPromises  = trackedIds.map(id =>
      acGet(base, `/api/3/campaigns?filters[listid]=${id}&filters[status]=5&orders[sdate]=DESC&limit=5`, headers)
    );
    const perListCountPromises = trackedIds.map(id =>
      acGet(base, `/api/3/contacts?listid=${id}&status=1&limit=0`, headers)
    );

    const [allCampaignsData, automationsData, ...parallelResults] = await Promise.all([
      acGet(base, '/api/3/campaigns?filters[status]=5&orders[sdate]=DESC&limit=100', headers),
      acGet(base, '/api/3/automations?filters[status]=1&limit=100', headers),
      ...perListCampPromises,
      ...perListCountPromises,
    ]);

    // Split results
    const campResults  = parallelResults.slice(0, trackedIds.length);
    const countResults = parallelResults.slice(trackedIds.length);

    const listCampaignMap = {};
    const listCountMap    = {};
    trackedIds.forEach((id, i) => {
      listCampaignMap[id] = campResults[i];
      listCountMap[id]    = Number(countResults[i]?.meta?.total || 0);
    });

    const allCampaigns   = allCampaignsData.campaigns  || [];
    const allAutomations = automationsData.automations  || [];

    const hq      = buildBrandData(hqIds,     listNameMap, listCampaignMap, listCountMap, allCampaigns, allAutomations);
    const online  = buildBrandData(onlineIds, listNameMap, listCampaignMap, listCountMap, allCampaigns, allAutomations);
    const other   = buildBrandData(otherIds,  listNameMap, listCampaignMap, listCountMap, allCampaigns, allAutomations);
    const overall = buildOverallStats(totalContacts, allCampaigns);

    // All-account list index for the diagnostic panel
    const accountLists = allACLists.map(l => {
      const id = String(l.id);
      return {
        id,
        name:        l.name,
        subscribers: trackedIds.includes(id) ? (listCountMap[id] || 0) : Number(l.subscriber_count || 0),
        created:     (l.cdate || '').slice(0, 10),
        isTarget:    trackedIds.includes(id),
        brand:       hqIds.includes(id) ? 'HQ' : onlineIds.includes(id) ? 'Online' : null,
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overall, hq, online, other, allLists: accountLists }),
    };
  } catch (err) {
    console.error('fetch-activecampaign error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── BRAND DATA BUILDER ───────────────────────────────────────────────────────

function buildBrandData(listIds, listNameMap, listCampaignMap, listCountMap, allCampaigns, allAutomations) {
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const d60 = now - 60 * 24 * 60 * 60 * 1000;

  const listIdSet = new Set(listIds);
  const brandCampaignsForTrend = allCampaigns.filter(c =>
    (c.lists || []).map(String).some(id => listIdSet.has(id))
  );

  let totalSubscribers = 0;
  const seenCampaignIds = new Set();
  const mergedCampaignRows = [];

  const lists = listIds.map(id => {
    const campsResp  = listCampaignMap[id] || {};
    const campaigns  = campsResp.campaigns || [];
    const subscribers = listCountMap[id] !== undefined ? listCountMap[id] : 0;
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
      id,
      name: listNameMap[id] || `List ${id}`,
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
        sent, opens, clicks, unsubs,
        openRate:  sent ? +(opens  / sent * 100).toFixed(1) : 0,
        clickRate: sent ? +(clicks / sent * 100).toFixed(1) : 0,
      };
    });

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

  const recent30    = allCampaigns.filter(c => new Date(c.sdate).getTime() > d30);
  const aggAll      = aggregateCampaignStats(allCampaigns);
  const totalSent30d = recent30.reduce((s, c) => s + Number(c.sendamt || 0), 0);
  const unsubs30d    = recent30.reduce((s, c) => s + Number(c.unsubscribes || 0), 0);

  return {
    totalContacts,
    openRate:     aggAll.openRate,
    clickRate:    aggAll.clickRate,
    unsubRate:    aggAll.unsubRate,
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
