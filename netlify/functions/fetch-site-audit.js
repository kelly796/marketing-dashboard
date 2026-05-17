/**
 * Crawls performotion.com.au and returns technical SEO data per page.
 * Fetches from Netlify's servers so no CORS issues.
 */

const SITE_URL = (process.env.GSC_SITE_URL || 'https://performotion.com.au').replace(/\/$/, '');

const PATHS = ['', '/services', '/exercise-physiology', '/online-coaching', '/about', '/contact'];

exports.handler = async () => {
  try {
    const results = await Promise.allSettled(
      PATHS.map(path => {
        const url = SITE_URL + path;
        return fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
        })
          .then(r => {
            if (r.status === 404) return null;
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
          .then(html => html ? { url, ...auditPage(url, html) } : null)
          .catch(err => ({ url, error: err.message }));
      })
    );

    const pages = results
      .map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message })
      .filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, auditedAt: new Date().toISOString() }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function auditPage(url, html) {
  const tag  = (re, i = 1) => { const m = html.match(re); return m ? (m[i] || '').trim() : null; };
  const tags = (re) => [...html.matchAll(re)].map(m => (m[1] || '').replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  const title     = tag(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDesc  = tag(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || tag(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const h1s       = tags(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const h2s       = tags(/<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 8);
  const h3s       = tags(/<h3[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 6);
  const canonical = tag(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || tag(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const robots    = tag(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle   = tag(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc    = tag(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const schemaScripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const hasSchema     = schemaScripts.length > 0;
  const schemaTypes   = schemaScripts.flatMap(m => {
    try {
      const obj = JSON.parse(m[1]);
      const items = Array.isArray(obj) ? obj : [obj];
      return items.map(o => o['@type']).filter(Boolean);
    } catch { return []; }
  });

  const imgTotal    = (html.match(/<img\b/gi) || []).length;
  const imgNoAlt    = (html.match(/<img(?![^>]*\balt\s*=)[^>]*>/gi) || []).length;
  const imgEmptyAlt = (html.match(/<img[^>]+alt=["']\s*["'][^>]*>/gi) || []).length;

  const internalLinks = (html.match(/href=["']\/[^"'#? ][^"']*/gi) || []).length;
  const externalLinks = (html.match(/href=["']https?:\/\/(?!performotion)[^"']*/gi) || []).length;
  const wordCount     = Math.round(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length / 1.5);

  const issues = [];
  if (!title) issues.push({ severity: 'critical', text: 'Missing <title> tag' });
  else if (title.length < 30) issues.push({ severity: 'warning', text: `Title too short: ${title.length} chars (aim 50–60)` });
  else if (title.length > 65) issues.push({ severity: 'warning', text: `Title too long: ${title.length} chars (will truncate in Google)` });

  if (!metaDesc) issues.push({ severity: 'critical', text: 'Missing meta description' });
  else if (metaDesc.length < 100) issues.push({ severity: 'warning', text: `Meta description short: ${metaDesc.length} chars` });
  else if (metaDesc.length > 165) issues.push({ severity: 'warning', text: `Meta description too long: ${metaDesc.length} chars` });

  if (!h1s.length) issues.push({ severity: 'critical', text: 'Missing H1 tag' });
  if (h1s.length > 1) issues.push({ severity: 'warning', text: `Multiple H1s (${h1s.length}) — use only one` });

  const altIssues = imgNoAlt + imgEmptyAlt;
  if (altIssues > 0) issues.push({ severity: 'warning', text: `${altIssues} image(s) missing alt text` });

  if (!hasSchema) issues.push({ severity: 'opportunity', text: 'No schema markup — add LocalBusiness or MedicalBusiness JSON-LD' });
  if (!canonical) issues.push({ severity: 'info', text: 'No canonical tag found' });
  if (!ogTitle) issues.push({ severity: 'info', text: 'No Open Graph tags — add for social sharing previews' });

  return {
    title,
    titleLength: title?.length || 0,
    metaDescription: metaDesc,
    metaDescLength: metaDesc?.length || 0,
    h1: h1s[0] || null,
    h1Count: h1s.length,
    h2s,
    h3s,
    canonical,
    robots,
    hasSchema,
    schemaTypes,
    openGraph: { title: ogTitle, description: ogDesc },
    images: { total: imgTotal, missingAlt: altIssues },
    links: { internal: internalLinks, external: externalLinks },
    wordCountEstimate: wordCount,
    issues,
  };
}
