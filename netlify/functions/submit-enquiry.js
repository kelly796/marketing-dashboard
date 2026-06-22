/**
 * PerforMotion — Online Client Enquiry form handler
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  RESEND_API_KEY — from resend.com dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TO_ADDRESSES = ['kelly@performotion.net'];

const NAVY  = '#1B2B5E';
const TEAL  = '#67A7AC';
const LIGHT = '#f8f9fc';
const MUTED = '#666666';
const BORDER = '#e1e5ee';

function row(label, value) {
  if (!value) return '';
  return `
    <tr>
      <td style="padding:8px 16px;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;width:40%">${label}</td>
      <td style="padding:8px 16px;font-size:13px;color:#1a1a1a;vertical-align:top">${value.replace(/\n/g, '<br>')}</td>
    </tr>`;
}

function section(title, rows) {
  return `
    <tr>
      <td colspan="2" style="padding:20px 16px 4px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${TEAL};border-top:1px solid ${BORDER}">${title}</td>
    </tr>
    ${rows}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const phone = (data.phone || '').trim();
  const email = (data.email || '').trim();

  if (!phone || !email || !email.includes('@')) {
    return { statusCode: 422, headers, body: JSON.stringify({ success: false, error: 'Missing required fields' }) };
  }

  const c = (v) => String(v || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();

  const firstName   = c(data.first_name);
  const lastName    = c(data.last_name);
  const instagram   = c(data.instagram);
  const service     = c(data.service);
  const state       = c(data.state);
  const country     = c(data.country);
  const goals       = c(data.goals);
  const coaching    = c(data.coaching);
  const competition = c(data.competition);
  const weightClass = c(data.weight_class);
  const squat       = c(data.squat);
  const bench       = c(data.bench);
  const deadlift    = c(data.deadlift);
  const total       = c(data.total);
  const days        = c(data.days_training);
  const injury      = c(data.injury);
  const epInterest  = c(data.ep_interest);
  const whyPerf     = c(data.why_perf);
  const coachPref1  = c(data.coach_pref1);
  const coachPref2  = c(data.coach_pref2);
  const whyCoaches  = c(data.why_coaches);
  const whyFit      = c(data.why_fit);
  const questions   = c(data.questions);
  const howHeard    = c(data.how_heard);

  const name     = [firstName, lastName].filter(Boolean).join(' ') || email;
  const location = [state, country].filter(Boolean).join(', ');
  const lifts    = [squat && `Squat ${squat}`, bench && `Bench ${bench}`, deadlift && `Deadlift ${deadlift}`, total && `Total ${total}`].filter(Boolean).join(' / ');
  const submitted = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:${LIGHT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
  <tr>
    <td style="background:${NAVY};padding:24px 28px;border-radius:10px 10px 0 0">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${TEAL}">PerforMotion Online</p>
      <h1 style="margin:0;font-size:20px;color:#ffffff;font-weight:700">New Client Enquiry</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#B7C5D2">${name} &middot; ${submitted} AEST</p>
    </td>
  </tr>

  <tr>
    <td style="background:#ffffff;border:1px solid ${BORDER};border-top:none;border-radius:0 0 10px 10px;padding:8px 0 16px">
      <table width="100%" cellpadding="0" cellspacing="0">

        ${section('Contact details',
          row('Name', name) +
          row('Phone', `<a href="tel:${phone}" style="color:${TEAL}">${phone}</a>`) +
          row('Email', `<a href="mailto:${email}" style="color:${TEAL}">${email}</a>`) +
          row('Instagram', instagram) +
          row('Service interest', service)
        )}

        ${section('Training information',
          row('Location', location) +
          row('Goals', goals) +
          row('Currently coached', coaching) +
          row('Upcoming competition', competition) +
          row('Weight class', weightClass) +
          row('Lifts', lifts) +
          row('Days/week', days) +
          row('Previous injury', injury) +
          row('EP interest', epInterest) +
          row('Why PerforMotion', whyPerf)
        )}

        ${section('Coach selection',
          row('1st preference', coachPref1) +
          row('2nd preference', coachPref2) +
          row('Why these coaches', whyCoaches) +
          row('Why they\'d work well', whyFit) +
          row('Questions / comments', questions) +
          row('How they heard about us', howHeard)
        )}

      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 0 0;text-align:center;font-size:12px;color:#aaaaaa">
      Submitted via performotion.net/online-coaching-application
    </td>
  </tr>
</table>

</body></html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'PerforMotion Enquiry <onboarding@resend.dev>',
        to: TO_ADDRESSES,
        reply_to: email,
        subject: `New Online Client Enquiry — ${name}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Mail failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Mail error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Mail failed' }) };
  }
};
