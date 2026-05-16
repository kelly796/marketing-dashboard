/**
 * AI Content Ideas
 * POST /.netlify/functions/ai-content
 * Body: { instagramHQ, instagramOnline, brand: 'HQ'|'Online' }
 * Returns: { ideas: [{ format, hook, caption, why }] }
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
  let ideas = {};
  try { ideas = JSON.parse(jsonMatch?.[0] || '{}'); } catch { ideas = { raw: text }; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ideas }),
  };
};

function buildPrompt(data) {
  const brand  = data.brand || 'HQ';
  const ig     = brand === 'Online' ? (data.instagramOnline || {}) : (data.instagramHQ || {});
  const posts  = (ig.posts || []).slice(0, 10);

  const topPosts = posts
    .sort((a, b) => (b.perfScore || 0) - (a.perfScore || 0))
    .slice(0, 5)
    .map(p => `- Type: ${p.type}, Score: ${p.perfScore}%, Reach: ${p.reach}, Caption: "${(p.caption || '').slice(0, 80)}"`)
    .join('\n');

  const ageBreakdown = (posts[0]?.age || []).map(a => `${a.b}: ${a.pct}%`).join(', ');
  const gender = posts[0]?.gender || {};
  const followers = ig.followers || 0;
  const engRate = ig.engagementRate || 0;

  const brandDesc = brand === 'Online'
    ? 'PerforMotion Online — online coaching and fitness programs, remote clients, educational content'
    : 'PerforMotion HQ — in-person gym and physio studio in Australia, local community focus';

  return `You are a social media strategist for ${brandDesc}.

ACCOUNT: ${followers} followers, ${engRate}% engagement rate this week

TOP PERFORMING POSTS (by performance score):
${topPosts || 'No post data yet — generate ideas suitable for a fitness studio'}

AUDIENCE: ${ageBreakdown || 'unknown age'}, ${gender.female || 0}% female, ${gender.male || 0}% male

Generate 5 content ideas that build on what's working. Use Australian English. Respond with ONLY valid JSON:
{
  "ideas": [
    {
      "format": "reel",
      "hook": "Opening line or visual description (1 sentence)",
      "caption": "Full Instagram caption with 3-5 hashtags (150-200 chars)",
      "why": "Why this will perform well based on the account data (1 sentence)"
    }
  ]
}

Format must be one of: reel, carousel, post`;
}
