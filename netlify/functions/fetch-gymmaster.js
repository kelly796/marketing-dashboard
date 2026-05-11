/**
 * Fetch GymMaster Data
 *
 * Pulls membership data from the GymMaster portal API and returns a structured
 * gymmaster object matching the dashboard's data schema.
 *
 * ─── REQUIRED ENV VARS (Netlify → Site settings → Environment variables) ─────
 *  GYMMASTER_API_KEY   — API key from GymMaster → Settings → API
 *
 * ─── API BASE URL ────────────────────────────────────────────────────────────
 *  https://performotion.gymmasteronline.com/portal/api
 *
 * ─── DASHBOARD INTEGRATION NOTE ──────────────────────────────────────────────
 *  The Booking Blueprint at https://playful-kashata-9390c0.netlify.app is a
 *  separate Netlify site with no shared backend. Direct data flow between
 *  dashboards is NOT currently possible because:
 *   1. Each Netlify site has its own isolated function environment.
 *   2. There is no shared database or API bridge between the two sites.
 *
 *  Manual workaround options:
 *   A. Set GYMMASTER_API_KEY in THIS site's Netlify env vars and let this
 *      function fetch directly from GymMaster — same data, no bridge needed.
 *   B. Export GymMaster reports as CSV and import into this dashboard.
 *   C. Build a shared intermediary (e.g. a Netlify Edge Function or a
 *      dedicated API endpoint) that both dashboards call.
 *
 *  Option A is already implemented here. Once GYMMASTER_API_KEY is set in
 *  Netlify env vars, this function will return live data automatically.
 */

const GM_BASE = 'https://performotion.gymmasteronline.com/api';

exports.handler = async () => {
  const apiKey = process.env.GYMMASTER_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'GYMMASTER_API_KEY env var not set' }),
    };
  }

  try {
    // Members is the primary endpoint (confirmed valid). Revenue and checkins
    // are attempted but failures are swallowed — the function still returns
    // useful member data if those endpoints aren't available.
    const [membersData, revenueData, checkinData] = await Promise.all([
      gmGet('/members', apiKey),
      gmGet('/revenue',  apiKey).catch(() => []),
      gmGet('/checkins', apiKey).catch(() => []),
    ]);

    const now = Date.now();
    const d30 = now - 30 * 24 * 60 * 60 * 1000;
    const d60 = now - 60 * 24 * 60 * 60 * 1000;

    const allMembers = membersData.members || membersData || [];

    // ── MEMBER STATUS BUCKETS ─────────────────────────────────────────────────
    const activeMembers   = allMembers.filter(m => m.status === 'active' || m.memberStatus === 'Active');
    const holdMembers     = allMembers.filter(m => m.status === 'hold'   || m.memberStatus === 'Hold');
    const newMembers30d   = allMembers.filter(m => m.status === 'active' && new Date(m.joinDate || m.startDate).getTime() > d30);
    const churnedMembers  = allMembers.filter(m => (m.status === 'cancelled' || m.memberStatus === 'Cancelled') && new Date(m.endDate || m.cancelDate).getTime() > d30);

    // ── PREV PERIOD (30-60 days ago) ──────────────────────────────────────────
    const prevActive      = allMembers.filter(m => {
      const joined = new Date(m.joinDate || m.startDate).getTime();
      return joined < d30; // approximate: count those active before the window
    });
    const prevNewMembers  = allMembers.filter(m => {
      const joined = new Date(m.joinDate || m.startDate).getTime();
      return joined > d60 && joined <= d30;
    });
    const prevChurned     = allMembers.filter(m => {
      const ended = new Date(m.endDate || m.cancelDate).getTime();
      return ended > d60 && ended <= d30;
    });
    const prevHold        = holdMembers; // no prev period for holds — use current as approx

    // ── RETENTION RATE ────────────────────────────────────────────────────────
    const totalActive     = activeMembers.length;
    const totalChurned    = churnedMembers.length;
    const retentionRate   = totalActive + totalChurned > 0
      ? +((totalActive / (totalActive + totalChurned)) * 100).toFixed(1)
      : 100;
    const prevRetention   = prevActive.length + prevChurned.length > 0
      ? +((prevActive.length / (prevActive.length + prevChurned.length)) * 100).toFixed(1)
      : 100;

    // ── REVENUE ───────────────────────────────────────────────────────────────
    const revenueItems    = revenueData.revenue || revenueData || [];
    const revenue30d      = revenueItems
      .filter(r => new Date(r.date || r.createdAt).getTime() > d30)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const revenue60_30    = revenueItems
      .filter(r => { const t = new Date(r.date || r.createdAt).getTime(); return t > d60 && t <= d30; })
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    const overdueItems    = revenueItems.filter(r => r.status === 'overdue' || r.status === 'unpaid');
    const overdueRevenue  = overdueItems.reduce((s, r) => s + Number(r.amount || 0), 0);
    const overdueCount    = overdueItems.length;

    // ── RENEWALS THIS WEEK ────────────────────────────────────────────────────
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const renewalsThisWeek = revenueItems.filter(r =>
      (r.type === 'renewal' || r.description === 'Membership Renewal') &&
      new Date(r.date || r.createdAt).getTime() > d7
    ).length;

    // ── MEMBERSHIP TYPE BREAKDOWN ─────────────────────────────────────────────
    const COLOURS = ['#2ABFBF', '#1B2A4A', '#D4B896', '#94a3b8', '#10B981', '#f59e0b'];
    const typeCounts = {};
    for (const m of activeMembers) {
      const t = m.membershipType || m.membership || 'Other';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const membershipTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => ({
        name,
        count,
        pct: totalActive ? Math.round(count / totalActive * 100) : 0,
        colour: COLOURS[i % COLOURS.length],
      }));

    // ── AT-RISK MEMBERS (inactive 14+ days) ───────────────────────────────────
    const checkins        = checkinData.checkins || checkinData || [];
    const lastCheckinMap  = {};
    for (const c of checkins) {
      const memberId = String(c.memberId || c.member_id);
      const t = new Date(c.date || c.checkInTime).getTime();
      if (!lastCheckinMap[memberId] || t > lastCheckinMap[memberId]) {
        lastCheckinMap[memberId] = t;
      }
    }

    const atRiskList = activeMembers
      .map(m => {
        const lastSeen = lastCheckinMap[String(m.id || m.memberId)];
        const daysInactive = lastSeen ? Math.floor((now - lastSeen) / 86400000) : 999;
        return { m, daysInactive };
      })
      .filter(({ daysInactive }) => daysInactive >= 14)
      .sort((a, b) => b.daysInactive - a.daysInactive)
      .slice(0, 8)
      .map(({ m, daysInactive }) => ({
        name: [m.firstName || m.first_name, m.lastName || m.last_name].filter(Boolean).join(' ') || m.name || 'Unknown',
        daysInactive,
        membership: m.membershipType || m.membership || 'Member',
      }));

    // ── AVG MEMBER LIFETIME ───────────────────────────────────────────────────
    const membersWithDuration = allMembers.filter(m => m.joinDate || m.startDate);
    const avgMemberLifetime = membersWithDuration.length
      ? Math.round(
          membersWithDuration.reduce((s, m) => {
            const start = new Date(m.joinDate || m.startDate).getTime();
            const end   = m.endDate ? new Date(m.endDate).getTime() : now;
            return s + (end - start) / (30 * 24 * 60 * 60 * 1000);
          }, 0) / membersWithDuration.length
        )
      : 0;

    // ── 6-MONTH GROWTH TREND ──────────────────────────────────────────────────
    const growthTrend = Array.from({ length: 6 }, (_, i) => {
      const monthStart = new Date(now);
      monthStart.setMonth(monthStart.getMonth() - (5 - i));
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      return allMembers.filter(m => {
        const joined = new Date(m.joinDate || m.startDate).getTime();
        const left   = m.endDate ? new Date(m.endDate).getTime() : Infinity;
        return joined <= monthEnd.getTime() && left >= monthStart.getTime();
      }).length;
    });

    // ── CANCELLATION REASONS ──────────────────────────────────────────────────
    const reasonCounts = {};
    for (const m of churnedMembers) {
      const r = m.cancellationReason || m.cancelReason || 'Other';
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
    const totalCancellations = Object.values(reasonCounts).reduce((s, n) => s + n, 0) || 1;
    const cancellationReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason, count]) => ({ reason, pct: Math.round(count / totalCancellations * 100) }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeMembers:      totalActive,
        activeMembersPrev:  prevActive.length,
        membersOnHold:      holdMembers.length,
        membersOnHoldPrev:  prevHold.length,
        newMembers30d:      newMembers30d.length,
        newMembers30dPrev:  prevNewMembers.length,
        churnedMembers30d:  totalChurned,
        churnedMembers30dPrev: prevChurned.length,
        atRiskMembers:      atRiskList.length,
        avgMemberLifetime,
        retentionRate,
        retentionRatePrev:  prevRetention,
        membershipRevenue:  Math.round(revenue30d),
        membershipRevenuePrev: Math.round(revenue60_30),
        overdueRevenue:     Math.round(overdueRevenue),
        overdueCount,
        renewalsThisWeek,
        growthTrend,
        membershipTypes,
        cancellationReasons: cancellationReasons.length ? cancellationReasons : [{ reason: 'No data', pct: 100 }],
        atRiskList,
      }),
    };
  } catch (err) {
    console.error('fetch-gymmaster error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function gmGet(path, apiKey, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${GM_BASE}${path}?key=${encodeURIComponent(apiKey)}`);
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`GymMaster API ${path} returned ${res.status}`);
    return res.json();
  }
  throw new Error(`GymMaster API ${path} failed after ${retries} retries`);
}
