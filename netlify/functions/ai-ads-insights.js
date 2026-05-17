exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
    };
  }

  try {
    const { meta } = JSON.parse(event.body || '{}');

    const campaigns = (meta?.campaigns || [])
      .map(
        (c) =>
          `  - ${c.name} [${c.status ?? 'unknown'}${c.brand ? ` | ${c.brand}` : ''}]: spend $${Number(c.spend ?? 0).toFixed(2)}, leads ${c.leads ?? 0}, CPL $${Number(c.cpl ?? 0).toFixed(2)}, CTR ${Number(c.ctr ?? 0).toFixed(2)}%`
      )
      .join('\n');

    const prompt = `You are a Meta Ads strategist for PerforMotion, a fitness business (HQ = Brisbane EP clinic targeting 40+, Online = powerlifting coaching). Analyse these campaigns and return ONLY valid JSON — no markdown, no explanation.

CAMPAIGN DATA:
${campaigns || '  No campaign data available'}

TOTALS:
- Total spend (7 days): $${Number(meta?.spend7d ?? 0).toFixed(2)}
- Total leads (7 days): ${meta?.leads7d ?? 0}
- ROAS: ${meta?.roas ?? 'N/A'}

Return ONLY this JSON structure with 3 improvements:
{
  "generatedAt": "${new Date().toISOString()}",
  "campaigns": [
    {
      "name": "campaign name",
      "action": "scale|pause|adjust|hold",
      "reason": "specific reason with numbers",
      "priority": "high|medium|low",
      "budgetChange": "+20%|-50%|none"
    }
  ],
  "topOpportunity": "single sentence — biggest growth lever right now",
  "biggestRisk": "single sentence — what could go wrong or is already wrong",
  "improvements": [
    "Specific advertising improvement suggestion with data rationale"
  ]
}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errText}`);
    }

    const result = await res.json();
    const text = result.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('No JSON found in Claude response');
    }
    const insights = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insights }),
    };
  } catch (err) {
    console.error('ai-ads-insights error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
