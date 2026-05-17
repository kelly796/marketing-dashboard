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
    const { seo, ga4TopPages, ga4, speed } = JSON.parse(event.body || '{}');

    const topPages = (ga4TopPages || [])
      .slice(0, 10)
      .map((p) => `  - ${p.page || p.path || 'unknown'}: ${p.sessions ?? p.pageviews ?? 0} sessions`)
      .join('\n');

    const topKeywords = (seo?.keywords || [])
      .slice(0, 20)
      .map(
        (k) =>
          `  - "${k.keyword || k.query}": ${k.clicks ?? 0} clicks, ${k.impressions ?? 0} impressions, pos ${Number(k.position ?? 0).toFixed(1)}, CTR ${Number(k.ctr ?? 0).toFixed(1)}%`
      )
      .join('\n');

    const mobileScore = speed?.mobile?.score ?? 'N/A';
    const desktopScore = speed?.desktop?.score ?? 'N/A';
    const mobileLcp = speed?.mobile?.lcp ?? 'N/A';
    const desktopLcp = speed?.desktop?.lcp ?? 'N/A';
    const mobileFcp = speed?.mobile?.fcp ?? 'N/A';
    const desktopFcp = speed?.desktop?.fcp ?? 'N/A';
    const mobileTbt = speed?.mobile?.tbt ?? 'N/A';
    const mobileCls = speed?.mobile?.cls ?? 'N/A';
    const mobileGrade = speed?.mobile?.grade ?? 'N/A';
    const desktopGrade = speed?.desktop?.grade ?? 'N/A';

    const prompt = `You are an SEO and AEO (Answer Engine Optimisation) specialist. Analyse this data for performotion.com.au and return ONLY valid JSON — no markdown, no explanation.

SITE: performotion.com.au
- Exercise physiology clinic in Brisbane (HQ) targeting 40+ adults with chronic conditions
- Online powerlifting coaching brand

TRAFFIC OVERVIEW:
- GSC clicks (7 days): ${seo?.clicks7d ?? 'N/A'}
- GA4 sessions: ${ga4?.sessions ?? 'N/A'}

TOP PAGES (GA4):
${topPages || '  No page data available'}

TOP KEYWORDS (Google Search Console):
${topKeywords || '  No keyword data available'}

PAGESPEED:
- Mobile score: ${mobileScore}/100 (${mobileGrade}) | LCP: ${mobileLcp} | FCP: ${mobileFcp} | TBT: ${mobileTbt} | CLS: ${mobileCls}
- Desktop score: ${desktopScore}/100 (${desktopGrade}) | LCP: ${desktopLcp} | FCP: ${desktopFcp}

Return ONLY this JSON structure with 3-4 items per section:
{
  "seoFixes": [
    { "priority": "high|medium|low", "title": "...", "action": "What specifically to do", "impact": "Expected result" }
  ],
  "aeo": [
    { "type": "schema|faq|eeat|content|links", "title": "...", "description": "Specific recommendation for AI search visibility (ChatGPT, Perplexity, Google AI Overviews)" }
  ],
  "blogIdeas": [
    { "title": "Blog post title", "keyword": "primary keyword", "intent": "informational|commercial", "aiSearchPotential": true, "notes": "Why this will get AI search traffic" }
  ],
  "ctaImprovements": [
    { "page": "page path or name", "issue": "what's wrong with current CTA", "suggestion": "specific CTA text and placement" }
  ],
  "internalLinks": [
    { "from": "source page", "to": "destination page", "anchorText": "suggested anchor text", "reason": "why this link matters" }
  ],
  "speedFixes": [
    { "title": "...", "description": "...", "effort": "easy|medium|hard" }
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
        max_tokens: 2000,
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
    const analysis = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    };
  } catch (err) {
    console.error('ai-seo-enhanced error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
