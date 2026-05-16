/**
 * AI SEO Audit
 * POST /.netlify/functions/ai-seo
 * Body: { seo, ga4TopPages, ga4 }
 * Returns: { audit: { score, summary, quickWins[], opportunities[], contentGaps[] } }
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
      max_tokens: 1500,
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
  let audit = {};
  try { audit = JSON.parse(jsonMatch?.[0] || '{}'); } catch { audit = { raw: text }; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audit }),
  };
};

function buildPrompt(data) {
  const seo      = data.seo            || {};
  const topPages = (data.ga4TopPages   || []).slice(0, 10);
  const ga4      = data.ga4            || {};

  const pagesStr = topPages
    .map(p => `- ${p.page || p.path || p.pagePath}: ${p.sessions || p.screenPageViews || 0} sessions`)
    .join('\n');

  const kwStr = (seo.keywords || []).slice(0, 15)
    .map(k => `- "${k.keyword}": ${k.clicks} clicks, ${k.impressions} impressions, pos ${Number(k.position || 0).toFixed(1)}, CTR ${Number(k.ctr || 0).toFixed(1)}%`)
    .join('\n');

  return `You are an SEO consultant for PerforMotion, a fitness studio and online coaching business in Australia (performotion.com.au).

TOP PAGES (last 7 days):
${pagesStr || 'No page data available'}

TOP KEYWORDS:
${kwStr || 'No keyword data available'}

OVERALL: ${seo.clicks7d||0} clicks this week (prev ${seo.clicksPrev||0}), ${ga4.sessions||0} sessions

Provide a practical SEO audit. Respond with ONLY valid JSON:
{
  "score": 65,
  "summary": "2-3 sentence SEO health overview with specific observations",
  "quickWins": [
    { "title": "Action title", "description": "What to do and why — be specific to the actual data" }
  ],
  "opportunities": [
    { "title": "Opportunity title", "keyword": "target keyword", "description": "Strategic opportunity based on current ranking positions" }
  ],
  "contentGaps": [
    { "topic": "Content topic", "keyword": "primary keyword", "intent": "informational" }
  ]
}

Include 3 quickWins, 3 opportunities, and 3 contentGaps. Score should be 0-100 based on the data quality and performance.`;
}
