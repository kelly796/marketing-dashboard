/**
 * Scheduled trigger — Tuesday 8am AEST (Monday 22:00 UTC)
 * Calls the same handler as update-dashboard.js
 */
const { handler } = require('./update-dashboard');
exports.handler = handler;
