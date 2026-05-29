/**
 * Fetch Jotform Submissions
 * Pulls submissions from PerforMotion Inquiry Form (EP ad) — form ID 261407779537065
 *
 * REQUIRED ENV VAR (Netlify → Site settings → Environment variables):
 *   JOTFORM_API_KEY  — Jotform → My Account → API → Create Key
 */

const FORM_ID = '261407779537065';
const JOTFORM_API = 'https://api.jotform.com';

exports.handler = async () => {
  const apiKey = process.env.JOTFORM_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'JOTFORM_API_KEY env var not set', submissions: [] }),
    };
  }

  try {
    const url = `${JOTFORM_API}/form/${FORM_ID}/submissions?apiKey=${apiKey}&limit=100&orderby=created_at&direction=DESC`;
    const res = await fetch(url);
    const json = await res.json();

    if (!res.ok || json.responseCode !== 200) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: json.message || 'Jotform API error', submissions: [] }),
      };
    }

    const submissions = (json.content || []).map(sub => {
      // Map Jotform answer fields to our schema
      const answers = sub.answers || {};
      let name = '', phone = '', email = '', reason = '';

      Object.values(answers).forEach(a => {
        const label = (a.name || a.text || '').toLowerCase();
        const val = a.answer || '';
        if (!val) return;
        if (label.includes('name') || label.includes('full')) name = typeof val === 'object' ? (val.first||'') + ' ' + (val.last||'') : val;
        if (label.includes('phone') || label.includes('mobile')) phone = val;
        if (label.includes('email')) email = val;
        if (label.includes('reason') || label.includes('message') || label.includes('goal') || label.includes('help') || label.includes('issue') || label.includes('concern')) reason = val;
      });

      return {
        id: sub.id,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        reason: reason.trim(),
        date: sub.created_at ? new Date(sub.created_at).toLocaleDateString('en-AU') : '',
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, submissions: [] }),
    };
  }
};
