/**
 * Scheduled trigger — Monday 9am AEST (Sunday 23:00 UTC)
 * Calls the same handler as update-dashboard.js
 */
const { handler } = require('./update-dashboard');
exports.handler = handler;
