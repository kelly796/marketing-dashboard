/**
 * Fetch Go High Level Data
 *
 * Returns pipeline, contacts, and automation data.
 * Returns placeholder data when GHL_API_KEY is not set.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  GHL_API_KEY        — GHL Private Integration API key
 *                       GHL → Settings → Integrations → API Keys
 *  GHL_LOCATION_ID    — Your sub-account / location ID
 *                       GHL → Settings → Business Profile → Location ID
 *
 * ─── SETUP ───────────────────────────────────────────────────────
 *  1. GHL → Settings → Integrations → API Keys → Create
 *  2. Copy key → Netlify env vars as GHL_API_KEY
 *  3. Copy Location ID → Netlify env vars as GHL_LOCATION_ID
 *  4. Deploy — this function will switch from placeholder to live data
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

exports.handler = async () => {
  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  // ── PLACEHOLDER — no API key configured ──────────────────────────
  if (!apiKey || !locationId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeholder: true,
        pipeline: {
          totalContacts: null,
          totalValue:    null,
          stages: { 0: null, 1: null, 2: null, 3: null, 4: null },
        },
        recentContacts: [],
        message: 'Add GHL_API_KEY and GHL_LOCATION_ID to Netlify env vars to enable live data.',
      }),
    };
  }

  // ── LIVE DATA ─────────────────────────────────────────────────────
  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Version:       '2021-07-28',
      'Content-Type': 'application/json',
    };

    const [contactsRes, pipelinesRes] = await Promise.allSettled([
      fetch(`${GHL_BASE}/contacts/?locationId=${locationId}&limit=20&sortBy=dateAdded&sortOrder=desc`, { headers }),
      fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${locationId}`, { headers }),
    ]);

    // Parse contacts
    let recentContacts = [];
    if (contactsRes.status === 'fulfilled' && contactsRes.value.ok) {
      const data = await contactsRes.value.json();
      recentContacts = (data.contacts || []).slice(0, 10).map(c => ({
        id:      c.id,
        name:    `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown',
        source:  c.source || 'Unknown',
        stage:   c.tags?.[0] || 'New Lead',
        addedAt: c.dateAdded,
        email:   c.email,
        phone:   c.phone,
      }));
    }

    // Parse pipeline
    let pipeline = { totalContacts: recentContacts.length, totalValue: null, stages: {} };
    if (pipelinesRes.status === 'fulfilled' && pipelinesRes.value.ok) {
      const data = await pipelinesRes.value.json();
      const pipes = data.pipelines || [];
      if (pipes.length) {
        const stageCounts = {};
        pipes[0].stages?.forEach((s, i) => { stageCounts[i] = s.count || 0; });
        pipeline.stages = stageCounts;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeholder: false, pipeline, recentContacts }),
    };

  } catch (err) {
    console.error('fetch-ghl error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, placeholder: true }),
    };
  }
};
