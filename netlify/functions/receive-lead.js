/**
 * Receive Lead — Meta Lead Ads Webhook
 *
 * GET  — Meta webhook verification handshake
 * POST — Receives incoming lead, stores in Netlify Blobs
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  WEBHOOK_VERIFY_TOKEN  — Token set in Meta webhook config
 */

const { getStore } = require('@netlify/blobs');

const MAX_LEADS = 500;

async function getLeads(store) {
  try {
    const raw = await store.get('all-leads');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function parseMetaPayload(payload) {
  const lead = {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    name: '',
    email: '',
    phone: '',
    formId: '',
    adId: '',
    campaignId: '',
    ghlSynced: false,
    ghlContactId: null,
    syncError: null,
    raw: payload,
  };

  try {
    const change = payload.entry[0].changes[0].value;
    lead.formId     = change.form_id     || '';
    lead.adId       = change.ad_id       || '';
    lead.campaignId = change.campaign_id || '';

    for (const field of (change.field_data || [])) {
      const name = (field.name || '').toLowerCase();
      const val  = (field.values || [])[0] || '';
      if (name.includes('email'))                       lead.email = val;
      else if (name.includes('phone') || name.includes('mobile')) lead.phone = val;
      else if (name.includes('name'))                   lead.name  = val;
    }
  } catch { /* partial payload — keep defaults */ }

  return lead;
}

exports.handler = async (event) => {
  // ── GET: Meta webhook verification ────────────────────────────
  if (event.httpMethod === 'GET') {
    const p = event.queryStringParameters || {};
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'performotion_webhook_2026';
    if (p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === verifyToken) {
      return { statusCode: 200, body: p['hub.challenge'] };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── POST: receive lead ─────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const lead = parseMetaPayload(payload);

    try {
      const store  = getStore('leads-store');
      const leads  = await getLeads(store);
      leads.unshift(lead);
      if (leads.length > MAX_LEADS) leads.splice(MAX_LEADS);
      await store.set('all-leads', JSON.stringify(leads));
    } catch (err) {
      console.error('[receive-lead] Blobs write failed:', err.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true, leadId: lead.id }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
