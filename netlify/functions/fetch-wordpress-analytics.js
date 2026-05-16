/**
 * Fetch Independent Analytics Data from WordPress
 *
 * Calls the custom REST endpoint registered by performotion-analytics.php
 * (located in /wp-content/mu-plugins/ on the WordPress site).
 * Returns structured analytics data that replaces GA4 on the dashboard.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *  WP_SITE_URL     — https://www.performotion.net
 *  WP_USERNAME     — WordPress username (must have manage_options capability)
 *  WP_APP_PASSWORD — Application Password from WP User Profile → App Passwords
 *
 * ─── SETUP CHECKLIST ─────────────────────────────────────────────────────────
 *  1. Upload wordpress-plugin/performotion-analytics.php to
 *     /wp-content/mu-plugins/performotion-analytics.php on your WP host
 *  2. Confirm all three env vars above are set in Netlify
 *  3. Test the endpoint manually while logged into WP:
 *     https://www.performotion.net/wp-json/performotion/v1/analytics
 */

exports.handler = async () => {
  const siteUrl     = (process.env.WP_SITE_URL || '').replace(/\/$/, '');
  const username    = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;

  if (!siteUrl || !username || !appPassword) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'WP_SITE_URL, WP_USERNAME and WP_APP_PASSWORD must all be set' }),
    };
  }

  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

  try {
    const res = await fetch(`${siteUrl}/wp-json/performotion/v1/analytics`, {
      headers: {
        Authorization:  `Basic ${credentials}`,
        Accept:         'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 401) {
      throw new Error('WordPress authentication failed — check WP_USERNAME and WP_APP_PASSWORD');
    }
    if (res.status === 404) {
      throw new Error('WordPress analytics endpoint not found — confirm performotion-analytics.php is in /wp-content/mu-plugins/');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`WordPress analytics → HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    // Validate we got real IAWP data back
    if (data.code && data.message) {
      throw new Error(`WordPress REST error: ${data.message}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wpAnalytics: data }),
    };
  } catch (err) {
    console.error('fetch-wordpress-analytics error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
