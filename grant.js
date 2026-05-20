const { execSync } = require('child_process');

const token = execSync('gcloud auth application-default print-access-token').toString().trim();
const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

(async () => {
  const site = encodeURIComponent('https://www.performotion.net/');
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`;

  const today = new Date().toISOString().slice(0, 10);
  const d7ago = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

  console.log('Querying:', url);
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ startDate: d7ago, endDate: today, rowLimit: 1 }),
  });
  console.log('Status:', r.status);
  console.log(await r.text());
})();
