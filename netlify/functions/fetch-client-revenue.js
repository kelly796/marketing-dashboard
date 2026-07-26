import { withLambda } from '@netlify/aws-lambda-compat';
/**
 * Fetch real Client Revenue data from GymMaster (Exercise Physiology
 * memberships: Perf Core / Perf Plus / Perf Prime).
 *
 * ─── CREDENTIAL LIVES IN NETLIFY BLOBS, NOT AN ENV VAR ───────────
 * Confirmed 2026-07-26: this site's Netlify Functions already sit at 3657
 * bytes of combined env vars (mostly GOOGLE_PRIVATE_KEY's 1624-byte PEM
 * key). Netlify Functions run on AWS Lambda, which has a hard 4KB total
 * env-var ceiling per function — adding literally any new env var (tested
 * with two different single vars, both failed identically) pushed every
 * function's build over that limit with a generic "exit code 2" error and
 * no descriptive message. Storing this credential in Netlify Blobs (store
 * `app-secrets`, key `gymmaster-api-key`) sidesteps the limit entirely —
 * Blobs aren't subject to the Lambda env-var size cap. Set once via
 * `netlify blobs:set app-secrets gymmaster-api-key <key>`. If any FUTURE
 * function needs a new credential, use this same pattern — don't add
 * another env var to this site without first checking total payload size.
 *
 * ─── REAL, KNOWN LIMITATIONS (2026-07-26) ────────────────────────
 * 1. Senior vs Junior EP-practitioner level is a Kelly-side rostering
 *    distinction, not tracked anywhere in GymMaster. This returns one
 *    combined count/revenue per tier — the dashboard puts it on the
 *    "Senior" row and leaves "Junior" at 0. Kelly can manually split it
 *    if she wants the distinction reflected.
 * 2. totalClients/totalRevenue (used for LTV) are computed only from
 *    CURRENTLY ACTIVE members' lifetime billing — a member who already
 *    churned isn't in GymMaster's "Current Members" report at all, so
 *    their historical spend isn't counted here. This under-states true
 *    lifetime LTV; it does NOT over-state it. Real fix would need a
 *    historical/all-members report GymMaster doesn't expose the same way.
 * 3. PAYG (non-member Halaxy session clients) is NOT covered by this
 *    function — GymMaster has no concept of a PAYG client at all, and
 *    Halaxy has no clean "active" definition equivalent to a membership
 *    status. Stays manual for now.
 * 4. "Lost this month" (churn) isn't computed — would need a stored prior
 *    snapshot to diff against, which doesn't exist yet.
 */

function digits(s) { return (s || '').replace(/\D/g, ''); }
function last9(s) { return digits(s).slice(-9); }

async function gymmasterRequest(apiKey, path) {
  const res = await fetch(`https://performotion.gymmasteronline.com/portal/api/v1${path}${path.includes('?') ? '&' : '?'}api_key=${apiKey}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (data.error) throw new Error('GymMaster API error: ' + data.error);
  return data.result;
}

async function gymmasterReportRequest(apiKey, body) {
  const res = await fetch('https://performotion.gymmasteronline.com/api/v2/report/standard_report', {
    method: 'POST',
    headers: { 'X-GM-API-KEY': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error('GymMaster Report API error: ' + JSON.stringify(data.error));
  return data.result;
}

// Which EP tier(s) a GymMaster membership-type string belongs to. A member
// can carry a combo string like "Perf Base + Perf Core - Exercise Physiology
// Membership" — match by substring, a member can count toward more than one
// tier if they hold more than one EP add-on.
function tiersFor(membershipType) {
  if (!membershipType || !/exercise physiology/i.test(membershipType)) return [];
  const tiers = [];
  if (/perf core/i.test(membershipType)) tiers.push('Perf Core');
  if (/perf plus/i.test(membershipType)) tiers.push('Perf Plus');
  if (/prime/i.test(membershipType)) tiers.push('Perf Prime');
  return tiers;
}

import { getStore } from '@netlify/blobs';

export const handler = async () => {
  let apiKey = process.env.GYMMASTER_API_KEY; // local-dev convenience only
  if (!apiKey) {
    try {
      apiKey = await getStore('app-secrets').get('gymmaster-api-key');
    } catch (e) {
      console.error('Blobs read failed:', e.message);
    }
  }

  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholder: true,
        message: 'GymMaster credential not readable — this site\'s Netlify Blobs isn\'t auto-configuring context ("environment has not been configured"), a pre-existing bug that also silently breaks get-data.js\'s whole 4-hour cache (confirmed 2026-07-26). Needs that fixed first, not just this function.',
        tiers: null,
      }),
    };
  }

  try {
    const members = await gymmasterRequest(apiKey, '/members');
    const activeMembers = members.filter(m => m.isprospect === false && m.status === 'Current');

    // report_id 1 needs start_date/end_date (confirmed via a real test call —
    // a wide range returns ~1379 historical rows with duplicate member IDs;
    // start_date === end_date === today gives one clean row per currently
    // active member, no combo/duplicate handling needed).
    const today = new Date().toISOString().slice(0, 10);
    const membershipReport = await gymmasterReportRequest(apiKey, {
      report_id: 1,
      start_date: today,
      end_date: today,
      required_columns: ['Member ID', 'Membership Type Name'],
    });
    const typeByMemberId = new Map();
    for (const row of membershipReport) {
      if (row['Member ID'] != null) typeByMemberId.set(row['Member ID'], row['Membership Type Name']);
    }

    const allSales = await gymmasterReportRequest(apiKey, {
      report_id: 14,
      start_date: '2015-01-01',
      end_date: new Date().toISOString().slice(0, 10),
      required_columns: ['Member ID', 'Sale Date', 'Sale Type', 'Sale Description'],
    });
    const billedByMemberId = new Map();
    for (const row of allSales) {
      const id = row['Member ID'];
      if (id == null) continue;
      billedByMemberId.set(id, (billedByMemberId.get(id) || 0) + (row['sorted_Sale Amount (Incl Tax)'] || 0));
    }

    const tierData = { 'Perf Core': { clients: 0, revenue: 0 }, 'Perf Plus': { clients: 0, revenue: 0 }, 'Perf Prime': { clients: 0, revenue: 0 } };

    for (const m of activeMembers) {
      const membershipType = typeByMemberId.get(m.id);
      const tiers = tiersFor(membershipType);
      if (!tiers.length) continue;
      const billed = Math.round((billedByMemberId.get(m.id) || 0) * 100) / 100;
      for (const tier of tiers) {
        tierData[tier].clients += 1;
        tierData[tier].revenue += billed;
      }
    }

    for (const t of Object.keys(tierData)) tierData[t].revenue = Math.round(tierData[t].revenue * 100) / 100;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeholder: false, syncedAt: new Date().toISOString(), tiers: tierData }),
    };

  } catch (err) {
    console.error('fetch-client-revenue error:', err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, placeholder: true, tiers: null }),
    };
  }
};

export default withLambda(handler);
