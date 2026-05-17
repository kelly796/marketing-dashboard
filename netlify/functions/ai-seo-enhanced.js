/**
 * AI SEO + AEO Enhanced Analysis
 * POST /.netlify/functions/ai-seo-enhanced
 * Body: { seo, ga4TopPages, ga4, speed, siteAudit }
 */

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  try {
    const { seo, ga4TopPages, ga4, speed, siteAudit } = JSON.parse(event.body || '{}');

    // ── GSC KEYWORDS ─────────────────────────────────────────────────────────
    const topKeywords = (seo?.keywords || []).slice(0, 20).map(k =>
      `  "${k.keyword || k.query}": pos ${Number(k.position ?? 0).toFixed(1)}, ${k.clicks ?? 0} clicks, ${k.impressions ?? 0} impressions, CTR ${Number(k.ctr ?? 0).toFixed(1)}%`
    ).join('\n');

    // ── GA4 PAGES ─────────────────────────────────────────────────────────────
    const topPages = (ga4TopPages || []).slice(0, 10).map(p =>
      `  ${p.page || p.path || 'unknown'}: ${p.sessions ?? p.pageviews ?? 0} sessions`
    ).join('\n');

    // ── SPEED ─────────────────────────────────────────────────────────────────
    const spd = speed || {};
    const speedSection = spd.mobile ? `
PAGESPEED:
  Mobile:  ${spd.mobile.score}/100 (${spd.mobile.grade}) | LCP ${spd.mobile.lcp} | FCP ${spd.mobile.fcp} | TBT ${spd.mobile.tbt} | CLS ${spd.mobile.cls}
  Desktop: ${spd.desktop?.score}/100 (${spd.desktop?.grade}) | LCP ${spd.desktop?.lcp} | FCP ${spd.desktop?.fcp}` : '  PageSpeed data not available';

    // ── SITE AUDIT ────────────────────────────────────────────────────────────
    const goodPages = (siteAudit?.pages || []).filter(p => !p.error);
    const siteAuditSection = goodPages.length ? `
LIVE SITE CRAWL — what's actually on performotion.com.au:
${goodPages.map(p => `
  URL: ${p.url}
  Title (${p.titleLength} chars): "${p.title}"
  Meta description (${p.metaDescLength} chars): "${p.metaDescription}"
  H1: "${p.h1}"
  H2s: ${p.h2s?.join(' | ') || 'none found'}
  Schema: ${p.hasSchema ? 'YES — types: ' + p.schemaTypes?.join(', ') : 'MISSING'}
  Images missing alt: ${p.images?.missingAlt ?? 0} of ${p.images?.total ?? 0}
  Internal links: ${p.links?.internal ?? 0} | External: ${p.links?.external ?? 0}
  Word count estimate: ${p.wordCountEstimate}
  Open Graph: ${p.openGraph?.title ? 'present' : 'missing'}
  Issues: ${p.issues?.map(i => `[${i.severity}] ${i.text}`).join('; ') || 'none'}
`).join('')}` : '  Site crawl not available';

    const prompt = `You are an expert SEO and AEO (Answer Engine Optimisation) strategist for performotion.com.au — an exercise physiology clinic in Brisbane targeting 40+ adults (HQ brand), plus an online powerlifting coaching brand.

You have three data sources. Cross-reference them to find REAL gaps and opportunities — don't give generic advice.

${speedSection}

TOP KEYWORDS from Google Search Console:
${topKeywords || '  No keyword data'}

TOP PAGES from GA4 (traffic):
${topPages || '  No page data'}

GSC overview: ${seo?.clicks7d ?? 'N/A'} clicks this week (prev ${seo?.clicksPrev ?? 'N/A'}), ${ga4?.sessions ?? 'N/A'} GA4 sessions
${siteAuditSection}

Instructions:
- seoFixes: issues found DIRECTLY on the crawled pages (e.g. "Homepage title missing primary keyword 'exercise physiologist brisbane'"). Be page-specific.
- comparison: match top GSC keywords against page titles/H1s. Flag exact keyword gaps. Include position and whether the keyword appears in title, H1, or H2.
- aeo: how to get cited in ChatGPT, Perplexity, and Google AI Overviews given this specific content.
- blogIdeas: based on keyword gaps and what the site is missing — title should be something that can answer a question AI search tools get asked.
- ctaImprovements: based on page structure from the crawl.
- internalLinks: specific links missing between crawled pages.
- speedFixes: based on actual PageSpeed scores.

Return ONLY valid JSON, no markdown:
{
  "seoFixes": [
    { "priority": "high|medium|low", "title": "...", "page": "which URL", "action": "exact thing to change", "impact": "expected outcome" }
  ],
  "comparison": [
    { "keyword": "...", "position": 12, "clicks": 45, "inTitle": false, "inH1": false, "inH2": false, "gap": "one sentence gap description", "fix": "exact text to add/change" }
  ],
  "aeo": [
    { "type": "schema|faq|eeat|content|links", "title": "...", "description": "specific action with page names", "aiEngine": "ChatGPT|Perplexity|AI Overviews|all" }
  ],
  "blogIdeas": [
    { "title": "...", "keyword": "...", "intent": "informational|commercial", "aiSearchPotential": true, "notes": "..." }
  ],
  "ctaImprovements": [
    { "page": "...", "issue": "...", "suggestion": "exact CTA text and where to place it" }
  ],
  "internalLinks": [
    { "from": "...", "to": "...", "anchorText": "...", "reason": "..." }
  ],
  "speedFixes": [
    { "title": "...", "description": "...", "effort": "easy|medium|hard" }
  ]
}

Include 3-4 items per section. Be specific to THIS site's actual data.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);

    const result = await res.json();
    const text = result.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');
    const analysis = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    };
  } catch (err) {
    console.error('ai-seo-enhanced error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
