/**
 * Get Leads — returns all stored Meta Lead Ads webhook leads
 *
 * Called by the dashboard's Leads tab on load and on manual refresh.
 */

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore('leads-store');
    const raw   = await store.get('all-leads');
    const leads = raw ? JSON.parse(raw) : [];

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(leads),
    };
  } catch (err) {
    console.error('[get-leads] error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
