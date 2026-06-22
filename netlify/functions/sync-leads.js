/**
 * Sync Leads to GHL — pushes pending Meta leads into GoHighLevel as contacts
 *
 * POST body: {} to sync all pending, or { leadId: 'id' } for one lead.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  GHL_API_KEY       — Private Integration Token (pit-xxxx)
 *  GHL_LOCATION_ID   — Sub-account / location ID
 */

const { getStore } = require('@netlify/blobs');

const GHL_BASE = 'https://services.leadconnectorhq.com';

async function getLeads(store) {
  try {
    const raw = await store.get('all-leads');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function createGhlContact(lead, apiKey, locationId) {
  const [firstName, ...rest] = (lead.name || 'Unknown').split(' ');
  const lastName = rest.join(' ');

  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      Version:        '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId,
      firstName,
      lastName,
      email:  lead.email  || '',
      phone:  lead.phone  || '',
      source: 'Meta Lead Ad',
      tags:   ['meta-lead-ad'],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data?.contact?.id || data?.id || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey     = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GHL_API_KEY or GHL_LOCATION_ID not configured' }),
    };
  }

  let targetId = null;
  try {
    const body = JSON.parse(event.body || '{}');
    targetId = body.leadId || null;
  } catch { /* sync all */ }

  const store  = getStore('leads-store');
  const leads  = await getLeads(store);
  const results = { synced: [], failed: [], skipped: [] };

  for (const lead of leads) {
    if (targetId && lead.id !== targetId) continue;
    if (lead.ghlSynced) { results.skipped.push(lead.id); continue; }

    try {
      const contactId    = await createGhlContact(lead, apiKey, locationId);
      lead.ghlSynced     = true;
      lead.ghlContactId  = contactId;
      lead.syncError     = null;
      results.synced.push(lead.id);
    } catch (err) {
      lead.syncError = err.message;
      results.failed.push(lead.id);
    }
  }

  try {
    await store.set('all-leads', JSON.stringify(leads));
  } catch (err) {
    console.error('[sync-leads] Blobs write failed:', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};
