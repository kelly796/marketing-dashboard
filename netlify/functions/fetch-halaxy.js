/**
 * Fetch Halaxy Appointment Data
 *
 * Pulls appointment and patient data from the Halaxy practice management API.
 * Returns bookings + halaxy objects matching the dashboard schema.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  HALAXY_API_KEY   — Halaxy → Settings → Integrations → API key
 *  HALAXY_BASE_URL  — your practice API base, e.g. "https://api.halaxy.com/v1"
 *                     (defaults to https://api.halaxy.com/v1 if not set)
 *
 * ─── SETUP ───────────────────────────────────────────────────────────────────
 *  1. Log in to Halaxy → Settings → Integrations → Generate API key
 *  2. Add HALAXY_API_KEY to Netlify environment variables
 *  3. If your Halaxy instance is on a custom subdomain, set HALAXY_BASE_URL
 *
 * ─── SCHEMA NOTES ────────────────────────────────────────────────────────────
 *  bookingLinkClicks and sources (booking source breakdown) are not available
 *  from the Halaxy API and are carried over from MOCK / previous data.
 *  apptTrend is built from the 30-day appointment list.
 */

exports.handler = async () => {
  const apiKey  = process.env.HALAXY_API_KEY;
  const baseUrl = (process.env.HALAXY_BASE_URL || 'https://api.halaxy.com/v1').replace(/\/$/, '');

  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'HALAXY_API_KEY must be set' }),
    };
  }

  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };

  try {
    const now    = new Date();
    const d30ago = daysAgo(now, 30);
    const d60ago = daysAgo(now, 60);
    const d31ago = daysAgo(now, 31);

    // ── FETCH APPOINTMENTS (current + prior 30-day window) ────────────────────
    const [curAppts, prevAppts] = await Promise.all([
      halaxyGet(`${baseUrl}/appointments`, headers, {
        start_date: fmtDate(d30ago),
        end_date:   fmtDate(now),
        limit:      500,
      }),
      halaxyGet(`${baseUrl}/appointments`, headers, {
        start_date: fmtDate(d60ago),
        end_date:   fmtDate(d31ago),
        limit:      500,
      }),
    ]);

    const curList  = asArray(curAppts);
    const prevList = asArray(prevAppts);

    // ── APPOINTMENT COUNTS ────────────────────────────────────────────────────
    const totalAppts     = curList.length;
    const totalApptsPrev = prevList.length;

    // Cancelled appointments
    const cancelled     = curList.filter(a => isCancelled(a)).length;
    const cancelledPrev = prevList.filter(a => isCancelled(a)).length;
    const completedCur  = totalAppts - cancelled;
    const completedPrev = totalApptsPrev - cancelledPrev;

    const cancellationRate     = totalAppts ? +(cancelled     / totalAppts     * 100).toFixed(1) : 0;
    const cancellationRatePrev = totalApptsPrev ? +(cancelledPrev / totalApptsPrev * 100).toFixed(1) : 0;

    // ── NEW vs RETURNING PATIENTS ─────────────────────────────────────────────
    // A patient is "new" if their first appointment is within the current window
    const patientFirstSeen = {};
    [...prevList, ...curList].forEach(a => {
      const pid  = patientId(a);
      const date = apptDate(a);
      if (pid && date && (!patientFirstSeen[pid] || date < patientFirstSeen[pid])) {
        patientFirstSeen[pid] = date;
      }
    });

    const curStart = d30ago.toISOString().slice(0, 10);
    const curPatients = new Set(curList.map(a => patientId(a)).filter(Boolean));
    let newPatients = 0;
    curPatients.forEach(pid => {
      if (patientFirstSeen[pid] >= curStart) newPatients++;
    });
    const returningPatients = curPatients.size - newPatients;

    const prevPatients = new Set(prevList.map(a => patientId(a)).filter(Boolean));
    const prevStart    = d60ago.toISOString().slice(0, 10);
    let newPatientsPrev = 0;
    prevPatients.forEach(pid => {
      if (patientFirstSeen[pid] >= prevStart && patientFirstSeen[pid] < curStart) newPatientsPrev++;
    });
    const returningPatientsPrev = prevPatients.size - newPatientsPrev;

    // ── APPOINTMENT TYPE BREAKDOWN ────────────────────────────────────────────
    const typeCounts = {};
    curList.filter(a => !isCancelled(a)).forEach(a => {
      const name = apptType(a);
      typeCounts[name] = (typeCounts[name] || 0) + 1;
    });
    const types = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // ── 30-DAY TREND (completed appts per day) ────────────────────────────────
    const trendMap = {};
    curList.filter(a => !isCancelled(a)).forEach(a => {
      const d = apptDate(a) || '';
      if (d) trendMap[d] = (trendMap[d] || 0) + 1;
    });
    const apptTrend = Array.from({ length: 30 }, (_, i) => {
      const d = fmtDate(new Date(now - (29 - i) * 86400000));
      return trendMap[d] || 0;
    });

    const bookings = {
      totalAppts:           completedCur,
      totalApptsPrev:       completedPrev,
      newPatients,
      newPatientsPrev,
      returningPatients,
      returningPatientsPrev,
      cancellationRate,
      cancellationRatePrev,
      bookingLinkClicks:    0, // not available from Halaxy API
      bookingLinkClicksPrev: 0,
      halaxyPatients:       newPatients,
      halaxyPatientsPrev:   newPatientsPrev,
      apptTrend,
      types: types.slice(0, 5),
      sources: [], // not available from Halaxy API
    };

    // halaxy key makes the badge go live
    const halaxy = { connected: true, totalAppts, newPatients };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookings, halaxy }),
    };
  } catch (err) {
    console.error('fetch-halaxy error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function halaxyGet(url, headers, params = {}, retries = 3) {
  const full = url + '?' + new URLSearchParams(params);
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(full, { headers });
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Halaxy GET ${url} → HTTP ${res.status}: ${err}`);
    }
    return res.json();
  }
  throw new Error(`Halaxy GET ${url} failed after ${retries} retries (rate limited)`);
}

function asArray(resp) {
  if (Array.isArray(resp)) return resp;
  // Common Halaxy response envelopes
  if (resp && Array.isArray(resp.data))         return resp.data;
  if (resp && Array.isArray(resp.appointments)) return resp.appointments;
  return [];
}

function isCancelled(appt) {
  const s = (appt.status || appt.appointment_status || '').toLowerCase();
  return s === 'cancelled' || s === 'canceled' || s === 'no_show' || s === 'no show';
}

function patientId(appt) {
  return appt.patient_id || appt.patientId || (appt.patient && appt.patient.id) || null;
}

function apptDate(appt) {
  const d = appt.appointment_date || appt.date || appt.start_time || appt.start || '';
  return d ? d.slice(0, 10) : null;
}

function apptType(appt) {
  return appt.appointment_type
    || appt.type
    || (appt.appointment_type_name)
    || 'Appointment';
}

function daysAgo(from, n) {
  return new Date(from - n * 86400000);
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
