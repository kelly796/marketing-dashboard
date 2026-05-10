/**
 * Scheduled trigger — Friday 8am AEST (Thursday 22:00 UTC)
 * Calls the same handler as update-dashboard.js
 */
const { handler } = require('./update-dashboard');
exports.handler = handler;
