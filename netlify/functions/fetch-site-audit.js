/**
 * Crawls performotion.com.au via sitemap.xml to discover all published pages,
 * then audits each one for technical SEO issues.
 */

const SITE_URL = (process.env.GSC_SITE_URL || 'https://performotion.com.au').replace(/\/$/, '');
const MAX_PAGES = 40; // cap to avoid Netlify 10s timeout
const FETCH_CONCURRENCY = 6;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml',
};

exports.handler = async () => {
  try {
    // ── 1. DISCOVER PAGES FROM SITEMAP ──────────────────────────────────────
    const urls = await discoverUrls();

    // ── 2. AUDIT PAGES IN BATCHES ────────────────────────────────────────────
    const pages = [];
    for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
      const batch = urls.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(url => auditUrl(url)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) pages.push(r.value);
      }
    }

    // ── 3. SUMMARY ────────────────────────────────────────────────────────────
    const summary = buildSummary(pages);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, summary, auditedAt: new Date().toISOString() }),
    };
  } catch (err) {
    console.error('fetch-site-audit error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── URL DISCOVERY ─────────────────────────────────────────────────────────────

async function discoverUrls() {
  // Try sitemap index first, then main sitemap, then fallback to homepage links
  const candidates = [
    `${SITE_URL}/sitemap_index.xml`,
    `${SITE_URL}/sitemap.xml`,
    `${SITE_URL}/wp-sitemap.xml`,
  ];

  for (const sitemapUrl of candidates) {
    const urls = await parseSitemap(sitemapUrl);
    if (urls.length) return urls.slice(0, MAX_PAGES);
  }

  // Fallback: crawl homepage and collect internal links
  return await discoverFromHomepage();
}

async function parseSitemap(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) return [];
    const xml = await res.text();

    // Sitemap index — contains links to child sitemaps
    if (xml.includes('<sitemapindex')) {
      const childUrls = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
        .map(m => m[1].trim())
        .filter(u => !u.includes('sitemap-image') && !u.includes('sitemap-video'));

      const childResults = await Promise.allSettled(
        childUrls.slice(0, 5).map(u => parseSitemap(u))
      );
      return childResults
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .filter(onlyPageUrls);
    }

    // Regular sitemap — extract <loc> entries
    return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      .map(m => m[1].trim())
      .filter(onlyPageUrls);

  } catch {
    return [];
  }
}

async function discoverFromHomepage() {
  try {
    const res = await fetch(SITE_URL, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) return [SITE_URL];
    const html = await res.text();
    const links = [...html.matchAll(/href=["'](https?:\/\/performotion\.com\.au[^"'#?]*)/gi)]
      .map(m => m[1].replace(/\/$/, ''))
      .filter((u, i, a) => a.indexOf(u) === i)
      .filter(onlyPageUrls);
    return [SITE_URL, ...links].slice(0, MAX_PAGES);
  } catch {
    return [SITE_URL];
  }
}

function onlyPageUrls(url) {
  // Skip feeds, admin, media, pagination, and non-html resources
  return (
    url.startsWith(SITE_URL) &&
    !url.match(/\.(xml|xsl|css|js|jpg|jpeg|png|gif|svg|webp|pdf|zip|woff|woff2|ttf)(\?|$)/i) &&
    !url.includes('/wp-admin') &&
    !url.includes('/wp-login') &&
    !url.includes('/wp-json') &&
    !url.includes('/feed') &&
    !url.includes('?') &&
    !url.match(/\/page\/\d+/)
  );
}

// ── PAGE AUDIT ────────────────────────────────────────────────────────────────

async function auditUrl(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const html = await res.text();
    return { url, ...auditPage(url, html) };
  } catch (err) {
    return { url, error: err.message };
  }
}

function auditPage(url, html) {
  const tag  = (re, i = 1) => { const m = html.match(re); return m ? (m[i] || '').trim() : null; };
  const tags = (re) => [...html.matchAll(re)].map(m => (m[1] || '').replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  const title     = tag(/<title[^>]*>([^<]+)<\/title>/i);
  const metaDesc  = tag(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*?)["']/i)
    || tag(/<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']description["']/i);
  const h1s       = tags(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const h2s       = tags(/<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 8);
  const canonical = tag(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || tag(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const robots    = tag(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle   = tag(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc    = tag(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const schemaScripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const hasSchema     = schemaScripts.length > 0;
  const schemaTypes   = schemaScripts.flatMap(m => {
    try {
      const obj   = JSON.parse(m[1]);
      const items = Array.isArray(obj) ? obj : [obj];
      return items.map(o => o['@type']).filter(Boolean);
    } catch { return []; }
  });

  const imgTotal    = (html.match(/<img\b/gi) || []).length;
  const imgNoAlt    = (html.match(/<img(?![^>]*\balt\s*=)[^>]*>/gi) || []).length;
  const imgEmptyAlt = (html.match(/<img[^>]+alt=["']\s*["'][^>]*>/gi) || []).length;
  const altIssues   = imgNoAlt + imgEmptyAlt;

  const internalLinks = (html.match(/href=["']\/[^"'#? ][^"']*/gi) || []).length;
  const externalLinks = (html.match(/href=["']https?:\/\/(?!performotion)[^"']*/gi) || []).length;
  const wordCount     = Math.round(html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length / 1.4);

  const issues = [];
  if (!title) issues.push({ severity: 'critical', text: 'Missing <title> tag' });
  else if (title.length < 30) issues.push({ severity: 'warning', text: `Title too short (${title.length} chars — aim 50–60)` });
  else if (title.length > 65) issues.push({ severity: 'warning', text: `Title too long (${title.length} chars — will truncate)` });

  if (!metaDesc) issues.push({ severity: 'critical', text: 'Missing meta description' });
  else if (metaDesc.length < 100) issues.push({ severity: 'warning', text: `Meta description short (${metaDesc.length} chars)` });
  else if (metaDesc.length > 165) issues.push({ severity: 'warning', text: `Meta description too long (${metaDesc.length} chars)` });

  if (!h1s.length) issues.push({ severity: 'critical', text: 'Missing H1' });
  if (h1s.length > 1) issues.push({ severity: 'warning', text: `Multiple H1s (${h1s.length})` });
  if (altIssues > 0) issues.push({ severity: 'warning', text: `${altIssues} image(s) missing alt text` });
  if (!hasSchema) issues.push({ severity: 'opportunity', text: 'No schema markup' });
  if (!canonical) issues.push({ severity: 'info', text: 'No canonical tag' });
  if (!ogTitle) issues.push({ severity: 'info', text: 'No Open Graph tags' });

  return {
    title,
    titleLength:    title?.length || 0,
    metaDescription: metaDesc,
    metaDescLength: metaDesc?.length || 0,
    h1:    h1s[0] || null,
    h1Count: h1s.length,
    h2s,
    canonical,
    robots,
    hasSchema,
    schemaTypes,
    openGraph: { title: ogTitle, description: ogDesc },
    images: { total: imgTotal, missingAlt: altIssues },
    links:  { internal: internalLinks, external: externalLinks },
    wordCountEstimate: wordCount,
    issues,
  };
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────

function buildSummary(pages) {
  const good = pages.filter(p => !p.error);
  return {
    totalCrawled:      good.length,
    missingTitle:      good.filter(p => !p.title).length,
    missingMeta:       good.filter(p => !p.metaDescription).length,
    missingH1:         good.filter(p => !p.h1).length,
    missingSchema:     good.filter(p => !p.hasSchema).length,
    missingAltImages:  good.reduce((s, p) => s + (p.images?.missingAlt || 0), 0),
    criticalIssues:    good.reduce((s, p) => s + p.issues.filter(i => i.severity === 'critical').length, 0),
    warnings:          good.reduce((s, p) => s + p.issues.filter(i => i.severity === 'warning').length, 0),
  };
}
