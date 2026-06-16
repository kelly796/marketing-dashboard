/**
 * Maxx — Daily Keep / Kill / Scale Report
 *
 * Fetches live Meta Ads data and calls Claude to produce Maxx's daily
 * decision report. The frontend caches the result for 24 hours in
 * localStorage so Claude is only called once per day.
 *
 * Required env vars:
 *   META_ACCESS_TOKEN
 *   META_AD_ACCOUNT_ID
 *   ANTHROPIC_API_KEY
 */

const GRAPH = 'https://graph.facebook.com/v19.0';

exports.handler = async () => {
  const token       = process.env.META_ACCESS_TOKEN;
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  const apiKey      = process.env.ANTHROPIC_API_KEY;

  if (!token || !adAccountId) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Meta env vars not set' }) };
  }
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
  }

  try {
    // ── Fetch account totals + per-ad performance in parallel ──────────────────
    const [totalsRes, adsRes] = await Promise.all([
      metaGet(`/act_${adAccountId}/insights`, {
        fields: 'spend,impressions,clicks,ctr,actions,action_values',
        date_preset: 'last_7d',
        access_token: token,
      }),
      metaGet(`/act_${adAccountId}/ads`, {
        fields: 'id,name,status,insights.date_preset(last_7d){spend,impressions,clicks,ctr,actions}',
        effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
        limit: 15,
        access_token: token,
      }),
    ]);

    const totRow  = totalsRes?.data?.[0] || {};
    const spend7d = +(Number(totRow.spend || 0)).toFixed(2);
    const leads7d = getAction(totRow.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
    const ctr7d   = +(Number(totRow.ctr || 0)).toFixed(2);
    const cpl7d   = leads7d > 0 ? +(spend7d / leads7d).toFixed(2) : 0;

    const ads = (adsRes?.data || [])
      .map(ad => {
        const ins    = ad.insights?.data?.[0] || {};
        const spend  = +(Number(ins.spend || 0)).toFixed(2);
        const leads  = getAction(ins.actions, 'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead');
        const ctr    = +(Number(ins.ctr || 0)).toFixed(2);
        const clicks = Number(ins.clicks || 0);
        const impr   = Number(ins.impressions || 0);
        const cpl    = leads > 0 ? +(spend / leads).toFixed(2) : 0;
        return { id: ad.id, name: ad.name, status: ad.status, spend, leads, ctr, clicks, impr, cpl };
      })
      .filter(a => a.spend > 0 || a.status === 'ACTIVE')
      .sort((a, b) => b.spend - a.spend);

    const adLines = ads.length
      ? ads.map(a =>
          `  - "${a.name}" [${a.status}]: spend $${a.spend}, impressions ${a.impr}, clicks ${a.clicks}, CTR ${a.ctr}%, leads ${a.leads}, CPL ${a.cpl > 0 ? '$' + a.cpl : 'none yet'}`
        ).join('\n')
      : '  No active ads with spend found';

    const today = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'full', timeStyle: 'short' });

    const prompt = `You are Maxx, PerforMotion's Meta media buyer AI. PerforMotion HQ is a Brisbane Exercise Physiology clinic targeting 40+ adults with chronic pain and fatigue. Goal: booked initial consultations via Meta lead form ads. CPL target is $120. Today in Brisbane: ${today}.

LIVE AD PERFORMANCE — last 7 days:
${adLines}

ACCOUNT TOTALS — last 7 days:
- Total spend: $${spend7d}
- Total leads: ${leads7d}
- Avg CTR: ${ctr7d}%
- Avg CPL: ${cpl7d > 0 ? '$' + cpl7d : 'none yet — in learning phase'}

Decision rules:
- SCALE: CPL ≤ $120 AND CTR ≥ 5% — increase daily budget 20-30%
- KEEP: CPL $120-180 OR CTR 3-5% — hold spend, gather data
- WATCH: CTR < 3% OR fewer than 3 days data OR no leads yet — flag and monitor
- KILL: CPL > $180 AND CTR < 2% — pause immediately and reallocate budget
- If no spend data: WATCH

Return ONLY valid JSON — no markdown, no code fences, no explanation. Use exactly this structure:
{
  "generatedAt": "${new Date().toISOString()}",
  "summary": "2-3 sentence overview of account health and what matters most today",
  "topInsight": "single most actionable insight right now",
  "decisions": [
    {
      "ad": "exact ad name",
      "decision": "SCALE|KEEP|WATCH|KILL",
      "reason": "specific reason referencing the actual numbers",
      "metrics": { "spend": 0.00, "ctr": 0.00, "leads": 0, "cpl": 0.00 }
    }
  ],
  "nextAction": "one concrete action with a specific day/timeframe",
  "accountHealth": {
    "score": 7,
    "notes": "brief 1-2 sentence health summary"
  }
}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          apiKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API ${res.status}: ${errText}`);
    }

    const result = await res.json();
    const text   = result.content?.[0]?.text ?? '';
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');

    const report = JSON.parse(match[0]);

    // Backfill real metrics into each decision from live data
    report.decisions = (report.decisions || []).map(d => {
      const ad = ads.find(a =>
        a.name.toLowerCase().includes((d.ad || '').toLowerCase().split(' ')[0]) ||
        (d.ad || '').toLowerCase().includes(a.name.toLowerCase().split(' ')[0])
      );
      if (ad) d.metrics = { spend: ad.spend, ctr: ad.ctr, leads: ad.leads, cpl: ad.cpl };
      return d;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
      body: JSON.stringify(report),
    };

  } catch (err) {
    console.error('maxx-report error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function getAction(actions, ...types) {
  return types.reduce((s, t) => {
    const found = (actions || []).find(a => a.action_type === t);
    return s + Number(found?.value || 0);
  }, 0);
}

async function metaGet(path, params = {}, retries = 2) {
  const qs  = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  const url = `${GRAPH}${path}?${qs}`;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * (i + 1))); continue; }
    if (!res.ok) { const t = await res.text(); throw new Error(`Meta API ${path} → ${t}`); }
    return res.json();
  }
  throw new Error(`Meta API ${path} failed after ${retries} retries`);
}
