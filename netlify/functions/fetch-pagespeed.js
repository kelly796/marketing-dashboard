exports.handler = async function (event, context) {
  const url = 'https://performotion.com.au';
  const categories = 'category=performance';

  function gradeScore(score) {
    if (score >= 90) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Poor';
  }

  function extractMetrics(data) {
    const score = Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
    const audits = data.lighthouseResult?.audits ?? {};
    return {
      score,
      fcp: audits['first-contentful-paint']?.displayValue ?? 'N/A',
      lcp: audits['largest-contentful-paint']?.displayValue ?? 'N/A',
      tbt: audits['total-blocking-time']?.displayValue ?? 'N/A',
      cls: audits['cumulative-layout-shift']?.displayValue ?? 'N/A',
      si: audits['speed-index']?.displayValue ?? 'N/A',
      grade: gradeScore(score),
    };
  }

  try {
    const baseUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&${categories}`;

    const [mobileRes, desktopRes] = await Promise.all([
      fetch(`${baseUrl}&strategy=mobile`),
      fetch(`${baseUrl}&strategy=desktop`),
    ]);

    if (!mobileRes.ok) {
      throw new Error(`PageSpeed mobile request failed: ${mobileRes.status} ${mobileRes.statusText}`);
    }
    if (!desktopRes.ok) {
      throw new Error(`PageSpeed desktop request failed: ${desktopRes.status} ${desktopRes.statusText}`);
    }

    const [mobileData, desktopData] = await Promise.all([
      mobileRes.json(),
      desktopRes.json(),
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mobile: extractMetrics(mobileData),
        desktop: extractMetrics(desktopData),
      }),
    };
  } catch (err) {
    console.error('fetch-pagespeed error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
