/**
 * Fetch Google Analytics 4 Data
 * Uses GA4 Data API v1beta with service account JWT auth.
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY env var (JSON string).
 */
const { JWT } = require('google-auth-library');

const GA4_PROPERTY_ID = '358310850';
const GA4_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

async function getAccessToken() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var is not set');

    const key = JSON.parse(keyJson);
    const client = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: [SCOPE],
    });

    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token;
}

async function runReport(accessToken, requestBody) {
    const fetch = (await import('node-fetch')).default;
    const url = `${GA4_API_BASE}/properties/${GA4_PROPERTY_ID}:runReport`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GA4 API error ${res.status}: ${text}`);
    }

    return res.json();
}

exports.handler = async (event, context) => {
    try {
        const accessToken = await getAccessToken();

        const report = await runReport(accessToken, {
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            metrics: [
                { name: 'activeUsers' },
                { name: 'sessions' },
                { name: 'conversions' },
            ],
        });

        const row = report.rows?.[0]?.metricValues ?? [];
        const activeUsers = parseInt(row[0]?.value ?? '0', 10);
        const sessions = parseInt(row[1]?.value ?? '0', 10);
        const conversions = parseInt(row[2]?.value ?? '0', 10);
        const conversionRate = sessions > 0
            ? parseFloat(((conversions / sessions) * 100).toFixed(2))
            : 0;

        return {
            statusCode: 200,
            body: JSON.stringify({
                data: {
                    activeUsers,
                    sessions,
                    conversions,
                    conversionRate,
                    timestamp: new Date().toISOString(),
                },
            }),
        };
    } catch (error) {
        console.error('GA4 API Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Failed to fetch GA4 data' }),
        };
    }
};
