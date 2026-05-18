/**
 * GymMaster → ActiveCampaign Sync
 *
 * Fetches all "Perf Core - Exercise Physiology Membership" members from
 * GymMaster and creates/updates them as contacts in ActiveCampaign,
 * subscribing each to the "Perf Core" list.
 *
 * Runs nightly via Netlify scheduled function AND on-demand via POST
 * from the dashboard sync button.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  GYMMASTER_API_KEY  — GymMaster → Settings → API
 *  AC_BASE_URL        — https://performotion.activehosted.com
 *  AC_API_KEY         — ActiveCampaign → Settings → Developer
 */

const GM_BASE         = 'https://performotion.gymmasteronline.com/portal/api';
const PERF_CORE_TYPE  = 'Perf Core - Exercise Physiology Membership';
const PERF_CORE_LIST  = 'Perf Core';
const BATCH_PAUSE_MS  = 120; // stay well inside AC rate limits

exports.handler = async (event) => {
  const gmKey  = process.env.GYMMASTER_API_KEY;
  const acBase = (process.env.AC_BASE_URL || '').replace(/\/$/, '');
  const acKey  = process.env.AC_API_KEY;

  if (!gmKey || !acBase || !acKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Missing env vars: GYMMASTER_API_KEY, AC_BASE_URL, AC_API_KEY' }),
    };
  }

  const acHeaders = { 'Api-Token': acKey, 'Content-Type': 'application/json' };

  try {
    // ── 1. FETCH ALL GYMMASTER MEMBERS (paginated) ────────────────────────────
    const allMembers = await fetchAllGmMembers(gmKey);

    // ── 2. FILTER TO PERF CORE ────────────────────────────────────────────────
    const perfCoreMembers = allMembers.filter(m => {
      const type = m.membershipType || m.membership || m.membershipname || m.membership_name || '';
      return type.trim() === PERF_CORE_TYPE;
    });

    if (!perfCoreMembers.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synced: 0, errors: 0, skipped: 0,
          message: `No members found with type "${PERF_CORE_TYPE}"`,
          listName: PERF_CORE_LIST,
          syncedAt: new Date().toISOString(),
        }),
      };
    }

    // ── 3. FIND "PERF CORE" LIST IN ACTIVECAMPAIGN ───────────────────────────
    const listsData = await acGet(acBase, '/api/3/lists?limit=100', acHeaders);
    const list = (listsData.lists || []).find(l =>
      l.name.toLowerCase().includes(PERF_CORE_LIST.toLowerCase())
    );

    if (!list) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: `No ActiveCampaign list found matching "${PERF_CORE_LIST}". Create it in AC first.`,
        }),
      };
    }

    const listId = String(list.id);

    // ── 4. SYNC EACH MEMBER TO ACTIVECAMPAIGN ─────────────────────────────────
    let synced  = 0;
    let skipped = 0;
    const errors = [];

    for (const member of perfCoreMembers) {
      try {
        const { firstName, lastName } = parseName(member);
        const email = (member.email || '').trim().toLowerCase();

        if (!email) { skipped++; continue; }

        // Create or update contact
        const syncRes = await acPost(acBase, '/api/3/contact/sync', {
          contact: {
            email,
            firstName,
            lastName,
            phone: member.phone || member.mobilePhone || member.mobile || '',
          },
        }, acHeaders);

        const contactId = syncRes?.contact?.id;
        if (!contactId) { skipped++; continue; }

        // Subscribe to Perf Core list
        await acPost(acBase, '/api/3/contactLists', {
          contactList: { list: listId, contact: contactId, status: 1 },
        }, acHeaders);

        synced++;
      } catch (err) {
        errors.push({ member: member.email || member.name || '?', error: err.message });
      }

      // Throttle to avoid AC rate limits
      await pause(BATCH_PAUSE_MS);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        synced,
        skipped,
        errors: errors.length,
        errorDetail: errors.slice(0, 10),
        total: perfCoreMembers.length,
        listId,
        listName: list.name,
        syncedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('sync-gymmaster-to-ac error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── GYMMASTER HELPERS ────────────────────────────────────────────────────────

async function fetchAllGmMembers(apiKey) {
  const all = [];
  let offset = 0;
  const limit = 200;

  for (;;) {
    const url = `${GM_BASE}/members?key=${encodeURIComponent(apiKey)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GymMaster /members returned ${res.status}`);
    const data = await res.json();

    const page = data.members || data || [];
    if (!Array.isArray(page) || !page.length) break;

    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  return all;
}

function parseName(member) {
  if (member.firstName || member.lastname) {
    return {
      firstName: member.firstName || member.firstname || '',
      lastName:  member.lastName  || member.lastname  || '',
    };
  }
  const full = (member.name || member.fullName || '').trim();
  const space = full.lastIndexOf(' ');
  return space > 0
    ? { firstName: full.slice(0, space), lastName: full.slice(space + 1) }
    : { firstName: full, lastName: '' };
}

// ─── ACTIVECAMPAIGN HELPERS ───────────────────────────────────────────────────

async function acGet(base, path, headers, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(base + path, { headers });
    if (res.status === 429) { await pause(1200 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`AC GET ${path} → ${res.status}`);
    return res.json();
  }
  throw new Error(`AC GET ${path} failed after ${retries} retries`);
}

async function acPost(base, path, body, headers, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 429) { await pause(1200 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`AC POST ${path} → ${res.status}`);
    return res.json();
  }
  throw new Error(`AC POST ${path} failed after ${retries} retries`);
}

function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
