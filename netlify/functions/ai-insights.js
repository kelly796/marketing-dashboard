/**
 * AI Marketing Insights
 * POST /.netlify/functions/ai-insights
 * Body: current dashboard data object (D)
 * Returns: { insights: { topWin, watchOut, summary, insights[], actions[] } }
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 503, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch { /* use empty */ }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(data) }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: `Claude API ${res.status}: ${err.slice(0, 200)}` }) };
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let insights = {};
  try { insights = JSON.parse(jsonMatch?.[0] || '{}'); } catch { insights = { raw: text }; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ insights }),
  };
};

function buildPrompt(d) {
  const ig   = d.instagramHQ   || {};
  const igOn = d.instagramOnline || {};
  const yt   = d.youtube        || {};
  const ga4  = d.ga4            || {};
  const seo  = d.seo            || {};
  const em   = d.email          || {};
  const meta = d.meta           || {};

  return `You are a marketing analyst for PerforMotion, a fitness business in Australia with two brands: PerforMotion HQ (in-person gym) and PerforMotion Online (coaching). Analyse this week's data and provide sharp, specific insights.

INSTAGRAM HQ: reach ${ig.reach7d||0} (prev ${ig.reach7dPrev||0}), engagement ${ig.engagementRate||0}% (prev ${ig.engagementRatePrev||0}%), followers ${ig.followers||0}, posts ${ig.posts7d||0}
INSTAGRAM ONLINE: reach ${igOn.reach7d||0} (prev ${igOn.reach7dPrev||0}), engagement ${igOn.engagementRate||0}% (prev ${igOn.engagementRatePrev||0}%), followers ${igOn.followers||0}
YOUTUBE: subscribers ${yt.subscribers||0}, views 7d ${yt.views7d||0} (prev ${yt.viewsPrev||0}), engagement ${yt.engagementRate||0}%
WEBSITE: sessions ${ga4.sessions||0} (prev ${ga4.sessionsPrev||0}), users ${ga4.users||0}
SEO: clicks ${seo.clicks7d||0} (prev ${seo.clicksPrev||0}), top keyword: ${seo.keywords?.[0]?.keyword||'n/a'} at pos ${seo.keywords?.[0]?.position?.toFixed(1)||'?'}
EMAIL: ${em.totalContacts||0} total contacts
META ADS: spend $${meta.spend7d||0}, leads ${meta.leads7d||0}, CPL $${meta.costPerLead||0}, ROAS ${meta.roas||0}x

Respond with ONLY valid JSON, no commentary:
{
  "topWin": "single sentence about the best result with specific numbers",
  "watchOut": "single sentence about the biggest concern with specific numbers",
  "summary": "2-3 sentence overall weekly summary",
  "insights": ["insight with numbers", "insight with numbers", "insight with numbers"],
  "actions": ["specific action to take this week", "specific action", "specific action"]
}`;
}
