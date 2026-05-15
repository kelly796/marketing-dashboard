/**
 * ActiveCampaign + WordPress Sync Function
 *
 * Receives ActiveCampaign webhook events and:
 *  1. Tracks email link clicks landing on performotion.net
 *  2. Fires a GA4 Measurement Protocol hit (source=email, UTM params from campaign)
 *  3. Posts click data to WordPress via REST API so per-list CTR is visible in the dashboard
 *
 * ─── ACTIVECAMPAIGN WEBHOOK SETUP ────────────────────────────────────────────
 * 1. In ActiveCampaign: Settings → Integrations → Webhooks → Add Webhook
 * 2. Webhook URL:
 *      https://<your-netlify-domain>.netlify.app/.netlify/functions/ac-wordpress-sync
 * 3. Events to enable:
 *      ✅ Email link clicked
 *      ✅ Opens (optional — for open-rate reconciliation)
 *      ✅ Unsubscribes
 * 4. Authentication: set a secret token in AC → copy the same value into
 *    Netlify environment variable AC_WEBHOOK_TOKEN
 * 5. Save and use "Send test" to verify the endpoint returns 200.
 *
 * ─── REQUIRED ENVIRONMENT VARIABLES (Netlify → Site settings → Env vars) ────
 *  AC_WEBHOOK_TOKEN    — shared secret set in ActiveCampaign webhook config
 *  GA4_MEASUREMENT_ID  — e.g. G-XXXXXXXXXX
 *  GA4_API_SECRET      — from GA4 Admin → Data Streams → Measurement Protocol API secrets
 *  WP_SITE_URL         — e.g. https://performotion.net
 *  WP_USERNAME         — WordPress user with edit_posts capability
 *  WP_APP_PASSWORD     — Application password from WP User Profile → Application Passwords
 *
 * ─── WORDPRESS SETUP ─────────────────────────────────────────────────────────
 * 1. In WordPress, create a custom post type or use the REST API custom endpoint.
 *    The simplest approach (no plugin needed):
 *      a. Add a small mu-plugin or functions.php snippet to register a
 *         custom REST route: POST /wp-json/performotion/v1/email-click
 *      b. That route saves the payload to a custom DB table or post meta.
 *    See the WordPress snippet at the bottom of this file.
 * 2. Create an Application Password for the WP user:
 *    Users → Profile → Application Passwords → Add new → copy the password.
 * 3. Add WP_USERNAME and WP_APP_PASSWORD to Netlify env vars.
 */

const crypto = require('crypto');

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify the request is from ActiveCampaign using HMAC-SHA256
  const signature = event.headers['x-ac-signature'] || event.headers['x-webhook-token'] || '';
  const secret    = process.env.AC_WEBHOOK_TOKEN || '';
  if (!verifySignature(event.body, signature, secret)) {
    console.warn('Webhook signature mismatch — request rejected');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try {
    // ActiveCampaign sends form-encoded or JSON depending on webhook version
    payload = event.headers['content-type']?.includes('application/json')
      ? JSON.parse(event.body)
      : Object.fromEntries(new URLSearchParams(event.body));
  } catch (err) {
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const eventType = payload.type || payload['type[0]'] || '';

  try {
    if (eventType === 'click' || eventType === 'link_click') {
      await handleClick(payload);
    } else if (eventType === 'open') {
      // Opens are logged for reconciliation but not forwarded to GA4
      console.log(`Open: contact ${payload.contact_email} / campaign ${payload.campaign_id}`);
    } else if (eventType === 'unsubscribe') {
      console.log(`Unsubscribe: ${payload.contact_email} from list ${payload.list_name}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, type: eventType }) };
  } catch (err) {
    console.error('Handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── CLICK HANDLER ───────────────────────────────────────────────────────────
async function handleClick(payload) {
  const clickedUrl = payload.url || payload['url[0]'] || '';

  // Only process clicks that land on performotion.net
  if (!clickedUrl.includes('performotion.net')) {
    console.log(`Ignored click to external URL: ${clickedUrl}`);
    return;
  }

  const click = {
    contactEmail:  payload.contact_email  || payload['contact[email]']  || '',
    contactId:     payload.contact_id     || payload['contact[id]']     || '',
    campaignId:    payload.campaign_id    || payload['campaign[id]']    || '',
    campaignName:  payload.campaign_name  || payload['campaign[name]']  || 'email',
    listId:        payload.list_id        || payload['list[id]']        || '',
    listName:      payload.list_name      || payload['list[name]']      || '',
    clickedUrl,
    timestamp:     new Date().toISOString(),
  };

  // Run GA4 and WordPress writes in parallel — don't let one failure block the other
  const [ga4Result, wpResult] = await Promise.allSettled([
    sendGA4Event(click),
    postToWordPress(click),
  ]);

  if (ga4Result.status === 'rejected') console.error('GA4 error:', ga4Result.reason);
  if (wpResult.status  === 'rejected') console.error('WP error:',  wpResult.reason);

  console.log(`Click tracked: ${click.contactEmail} → ${click.clickedUrl} [campaign: ${click.campaignName}]`);
}

// ─── GA4 MEASUREMENT PROTOCOL ────────────────────────────────────────────────
async function sendGA4Event(click) {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret     = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    console.warn('GA4 env vars not set — skipping GA4 event');
    return;
  }

  // Use a stable client_id derived from the contact ID so sessions stitch correctly
  const clientId = click.contactId
    ? `ac_${click.contactId}`
    : `ac_anon_${Date.now()}`;

  // Build UTM-equivalent params via campaign params
  const body = JSON.stringify({
    client_id: clientId,
    timestamp_micros: Date.now() * 1000,
    events: [{
      name: 'email_click_to_website',
      params: {
        // Traffic source attribution
        source:   'email',
        medium:   'newsletter',
        campaign: slugify(click.campaignName),
        content:  slugify(click.listName),
        // Event-specific data
        campaign_id:   click.campaignId,
        list_id:       click.listId,
        list_name:     click.listName,
        clicked_url:   click.clickedUrl,
        // Page context
        page_location: click.clickedUrl,
        engagement_time_msec: 1,
      },
    }],
  });

  const res = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
  );

  // GA4 MP returns 204 on success — no body
  if (res.status !== 204 && res.status !== 200) {
    const text = await res.text();
    throw new Error(`GA4 returned ${res.status}: ${text}`);
  }
}

// ─── WORDPRESS REST API ───────────────────────────────────────────────────────
// Stores click data in WP so the dashboard can query it per-list and per-campaign.
// Requires the custom REST endpoint described in the WordPress setup notes above.
async function postToWordPress(click) {
  const siteUrl     = process.env.WP_SITE_URL;
  const username    = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;

  if (!siteUrl || !username || !appPassword) {
    console.warn('WordPress env vars not set — skipping WP write');
    return;
  }

  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

  const res = await fetch(`${siteUrl}/wp-json/performotion/v1/email-click`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body: JSON.stringify({
      contact_email:  click.contactEmail,
      campaign_id:    click.campaignId,
      campaign_name:  click.campaignName,
      list_id:        click.listId,
      list_name:      click.listName,
      clicked_url:    click.clickedUrl,
      timestamp:      click.timestamp,
      utm_source:     'email',
      utm_medium:     'newsletter',
      utm_campaign:   slugify(click.campaignName),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WordPress returned ${res.status}: ${text}`);
  }
}

// ─── SIGNATURE VERIFICATION ───────────────────────────────────────────────────
// Supports both plain-token comparison (older AC webhooks) and HMAC-SHA256
function verifySignature(body, signature, secret) {
  if (!secret) {
    console.error('SECURITY: AC_WEBHOOK_TOKEN is not configured. All webhook requests are being rejected. Set this env var in Netlify immediately.');
    return false;
  }
  // Plain token match (AC v1 webhooks)
  if (signature === secret) return true;
  // HMAC-SHA256 (AC v2 webhooks)
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/*
 * ─── WORDPRESS MU-PLUGIN SNIPPET ─────────────────────────────────────────────
 * Add this to /wp-content/mu-plugins/performotion-email-tracking.php
 * (create the mu-plugins folder if it doesn't exist)
 *
 * <?php
 * add_action('rest_api_init', function () {
 *   register_rest_route('performotion/v1', '/email-click', [
 *     'methods'             => 'POST',
 *     'callback'            => 'performotion_save_email_click',
 *     'permission_callback' => function () {
 *       return current_user_can('edit_posts');
 *     },
 *   ]);
 * });
 *
 * function performotion_save_email_click(WP_REST_Request $request) {
 *   global $wpdb;
 *   $table = $wpdb->prefix . 'email_clicks';
 *
 *   // Create table on first use
 *   if ($wpdb->get_var("SHOW TABLES LIKE '$table'") !== $table) {
 *     $wpdb->query("CREATE TABLE $table (
 *       id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 *       contact_email VARCHAR(255),
 *       campaign_id   VARCHAR(64),
 *       campaign_name VARCHAR(255),
 *       list_id       VARCHAR(64),
 *       list_name     VARCHAR(255),
 *       clicked_url   TEXT,
 *       utm_campaign  VARCHAR(255),
 *       created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
 *     ) DEFAULT CHARSET=utf8mb4");
 *   }
 *
 *   $data = $request->get_json_params();
 *   $wpdb->insert($table, [
 *     'contact_email' => sanitize_email($data['contact_email'] ?? ''),
 *     'campaign_id'   => sanitize_text_field($data['campaign_id'] ?? ''),
 *     'campaign_name' => sanitize_text_field($data['campaign_name'] ?? ''),
 *     'list_id'       => sanitize_text_field($data['list_id'] ?? ''),
 *     'list_name'     => sanitize_text_field($data['list_name'] ?? ''),
 *     'clicked_url'   => esc_url_raw($data['clicked_url'] ?? ''),
 *     'utm_campaign'  => sanitize_text_field($data['utm_campaign'] ?? ''),
 *   ]);
 *
 *   // Return per-list CTR so dashboard can consume it
 *   $stats = $wpdb->get_results($wpdb->prepare(
 *     "SELECT list_id, list_name, COUNT(*) as website_clicks FROM $table
 *      WHERE list_id = %s GROUP BY list_id",
 *     $data['list_id'] ?? ''
 *   ));
 *
 *   return rest_ensure_response(['saved' => true, 'stats' => $stats]);
 * }
 */
