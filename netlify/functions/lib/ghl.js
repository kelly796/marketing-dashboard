/**
 * Shared GHL utilities used by receive-lead.js and sync-leads.js
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';

async function createGhlContact(lead, apiKey, locationId) {
  const [firstName, ...rest] = (lead.name || 'Unknown').split(' ');

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
      lastName: rest.join(' '),
      email:  lead.email  || '',
      phone:  lead.phone  || '',
      source: 'Meta Lead Ad',
      tags:   ['meta-lead-ad'],
    }),
  });

  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return data?.contact?.id || data?.id || null;
}

module.exports = { createGhlContact };
