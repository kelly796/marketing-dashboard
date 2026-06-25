/**
 * Receive Lead — Meta Lead Ads Webhook
 *
 * GET  — Meta webhook verification handshake
 * POST — Receives incoming lead, stores in Netlify Blobs
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────
 *  WEBHOOK_VERIFY_TOKEN  — Token set in Meta webhook config
 *  META_APP_SECRET       — App secret from Meta developer console (for signature verification)
 */

const crypto    = require('crypto');
const { getStore } = require('@netlify/blobs');
const { createGhlContact } = require('./lib/ghl');

const MAX_LEADS = 500;

async function getLeads(store) {
  try {
    const raw = await store.get('all-leads');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function verifyMetaSignature(body, sigHeader, appSecret) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const received = sigHeader.slice(7); // strip 'sha256='
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
  // timingSafeEqual requires same-length buffers
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
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
      if (name.includes('email'))                              lead.email = val;
      else if (name.includes('phone') || name.includes('mobile')) lead.phone = val;
      else if (name.includes('name'))                          lead.name  = val;
    }
  } catch { /* partial payload — keep defaults */ }

  return lead;
}

exports.handler = async (event) => {
  // ── GET: Meta webhook verification ────────────────────────────
  if (event.httpMethod === 'GET') {
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) {
      console.error('[receive-lead] WEBHOOK_VERIFY_TOKEN not set');
      return { statusCode: 500, body: 'Server misconfiguration' };
    }
    const p = event.queryStringParameters || {};
    if (p['hub.mode'] === 'subscribe' && p['hub.verify_token'] === verifyToken) {
      return { statusCode: 200, body: p['hub.challenge'] };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── POST: receive lead ─────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    // Verify Meta signature if app secret is configured
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
      const sig = event.headers['x-hub-signature-256'] || '';
      if (!verifyMetaSignature(event.body || '', sig, appSecret)) {
        console.warn('[receive-lead] Signature verification failed');
        return { statusCode: 403, body: 'Invalid signature' };
      }
    } else {
      console.warn('[receive-lead] META_APP_SECRET not set — skipping signature check');
    }

    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const lead = parseMetaPayload(payload);

    try {
      const store = getStore('leads-store');
      const leads = await getLeads(store);

      // Deduplication — skip if same email or phone already exists
      if (lead.email || lead.phone) {
        const isDuplicate = leads.some(l =>
          (lead.email && l.email === lead.email) ||
          (lead.phone && l.phone === lead.phone)
        );
        if (isDuplicate) {
          console.log('[receive-lead] Duplicate lead, skipping:', lead.email || lead.phone);
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ received: true, duplicate: true }) };
        }
      }

      leads.unshift(lead);
      if (leads.length > MAX_LEADS) leads.splice(MAX_LEADS);
      await store.set('all-leads', JSON.stringify(leads));

      // Auto-sync to GHL immediately after storing
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (apiKey && locationId) {
        try {
          const contactId      = await createGhlContact(lead, apiKey, locationId);
          leads[0].ghlSynced    = true;
          leads[0].ghlContactId = contactId;
          console.log('[receive-lead] Auto-synced to GHL:', contactId);
        } catch (err) {
          leads[0].syncError = err.message;
          console.warn('[receive-lead] Auto-sync to GHL failed (will retry on schedule):', err.message);
        }
        await store.set('all-leads', JSON.stringify(leads));
      }
    } catch (err) {
      console.error('[receive-lead] Blobs write failed:', err.message);
      // Return 500 so Meta retries delivery
      return { statusCode: 500, body: JSON.stringify({ error: 'Storage write failed' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true, leadId: lead.id }),
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
