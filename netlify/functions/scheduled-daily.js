/**
 * Scheduled trigger — every day at 08:00 AEST (22:00 UTC previous day)
 * Refreshes all API data and caches it for the dashboard.
 */
const { handler } = require('./update-dashboard');
exports.handler = handler;
