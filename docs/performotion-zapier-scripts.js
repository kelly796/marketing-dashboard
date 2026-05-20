// PerforMotion — Zapier Code by Zapier Scripts
// Paste each block into the "Code by Zapier" step of the relevant Zap.
// All scripts use inputData.field_name — map your GymMaster/Halaxy fields
// to these variable names in the step before the code step.
// Required input variables are listed above each script.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 1 — Halaxy: Pay As You Go EP Booking → AC
// Input variables to map: full_name (or first_name + last_name), email
// Use this if Halaxy returns a combined name field
// ─────────────────────────────────────────────────────────────────────────────

const fullName = inputData.full_name || '';
const nameParts = fullName.trim().split(' ');
const firstName = nameParts[0] || inputData.first_name || '';
const lastName = nameParts.slice(1).join(' ') || inputData.last_name || '';
const email = (inputData.email || '').toLowerCase().trim();

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  tag: 'active-member',
  listId: '51'
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 2 — GymMaster: New EP Membership → AC
// Input variables to map: first_name, last_name, email
// No conditional logic needed — all EP members get the same tag and list
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  memberTag: 'Member - EP',
  passTag: 'Pass - 2 Week Gym',
  listId: '53'
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 3 — GymMaster: New Group Classes Membership → AC
// Input variables to map: first_name, last_name, email
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  memberTag: 'Member - Group Classes',
  listId: '52'
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 4 — GymMaster: New Base Membership → AC
// Input variables to map: first_name, last_name, email, membership_type
// REQUIRED — determines whether member gets Base or Base Plus tag
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();
const membershipType = (inputData.membership_type || '').trim();

const memberTag = membershipType.toLowerCase().includes('plus')
  ? 'Member - Base Plus'
  : 'Member - Base';

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  memberTag: memberTag,
  listId: '54'
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 5 — 10 Pack Class Pass Purchase → AC
// Input variables to map: first_name, last_name, email
// Calculates pass expiry 60 days from purchase date
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();

const expiryDate = new Date();
expiryDate.setDate(expiryDate.getDate() + 60);
const expiry = expiryDate.toISOString().split('T')[0]; // YYYY-MM-DD

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  passTag: 'Pass - 10 Pack Classes',
  expiryDate: expiry
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 6 — 1 Week Free Group Classes Pass → AC
// Input variables to map: first_name, last_name, email
// Calculates pass expiry 7 days from activation
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();

const expiryDate = new Date();
expiryDate.setDate(expiryDate.getDate() + 7);
const expiry = expiryDate.toISOString().split('T')[0]; // YYYY-MM-DD

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  passTag: 'Pass - Free Class Week',
  expiryDate: expiry
};


// ─────────────────────────────────────────────────────────────────────────────
// ZAP 7 — 2 Week Free Base Gym Pass → AC
// Input variables to map: first_name, last_name, email
// Calculates pass expiry 14 days from activation
// ─────────────────────────────────────────────────────────────────────────────

const firstName = (inputData.first_name || '').trim();
const lastName = (inputData.last_name || '').trim();
const email = (inputData.email || '').toLowerCase().trim();

const expiryDate = new Date();
expiryDate.setDate(expiryDate.getDate() + 14);
const expiry = expiryDate.toISOString().split('T')[0]; // YYYY-MM-DD

return {
  firstName: firstName,
  lastName: lastName,
  email: email,
  passTag: 'Pass - 2 Week Gym',
  expiryDate: expiry
};
