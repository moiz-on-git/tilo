/**
 * Tilo compliance core — India-first (DPDP 2023 + DPDP Rules 2025, IT Act 2000,
 * IT Intermediary Rules 2021, CERT-In 2022, POCSO/BNS) with GDPR/DSA, UK OSA,
 * US (COPPA/NCMEC), AU, BR hooks.
 *
 * Design principle: anonymous to OTHER USERS, identifiable to PLATFORM only via
 * minimal hashed technical signals, retained on a defined schedule, disclosable
 * only under lawful request. No default recording. Ephemeral media.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(ROOT, 'logs');

for (const dir of [DATA_DIR, LOG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Config (all overridable via env; see .env.example)
// ---------------------------------------------------------------------------
const config = {
  // Legal identity — MUST be set in production. Shown in Privacy Policy/Terms.
  companyName: process.env.COMPANY_NAME || 'Tilo',
  companyAddress: process.env.COMPANY_ADDRESS || 'India',
  supportEmail: process.env.SUPPORT_EMAIL || 'tiloappcomplaints@protonmail.com',
  grievanceName: process.env.GRIEVANCE_NAME || 'Grievance Officer — Tilo',
  grievanceEmail: process.env.GRIEVANCE_EMAIL || 'tiloappcomplaints@protonmail.com',
  dpoEmail: process.env.DPO_EMAIL || 'tiloappcomplaints@protonmail.com',
  childSafetyEmail: process.env.CHILD_SAFETY_EMAIL || 'tiloappcomplaints@protonmail.com',
  lawEnforcementEmail: process.env.LAW_ENFORCEMENT_EMAIL || 'tiloappcomplaints@protonmail.com',
  consentVersion: process.env.CONSENT_VERSION || '2026-10-06-v1',
  // Geo allow/block lists: comma-separated ISO-3166 alpha-2, e.g. "IN" or "PK,CN".
  // Recommended posture: Tier A allow-list (launch only where counsel cleared you).
  allowedCountries: parseCountryList(process.env.ALLOWED_COUNTRY_CODES),
  blockedCountries: parseCountryList(process.env.BLOCKED_COUNTRY_CODES),
  // Retention (days). Defaults encode the legal matrix in docs/retention-schedule.md.
  ictLogDays: intEnv('ICT_LOG_DAYS', 180), // CERT-In: 180d rolling, in India
  safetyEvidenceDays: intEnv('SAFETY_EVIDENCE_DAYS', 180), // IT Rules removed-content preservation
  reportDays: intEnv('REPORT_DAYS', 180),
  grievanceDays: intEnv('GRIEVANCE_DAYS', 1095), // consumer/tax audit trail
  consentDays: intEnv('CONSENT_DAYS', 1095),
  banHoursChildSafety: intEnv('BAN_HOURS_CHILD_SAFETY', 8760), // critical: long hold + human review
  banHoursDefault: intEnv('BAN_HOURS_DEFAULT', 24),
  // Age gate: hard 18+ only. No parental-consent flow in V1 — minors are refused.
  minAge: 18,
};

function intEnv(name, fallback) {
  const v = Number.parseInt(process.env[name], 10);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

function parseCountryList(value) {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s)),
  );
}

// ---------------------------------------------------------------------------
// Hashed identity: never store raw IPs in app data. Salt persisted so hashes
// are stable across restarts (needed for ban + lawful-request correlation).
// ---------------------------------------------------------------------------
let salt = process.env.LOG_IP_SALT || '';
const SALT_FILE = path.join(DATA_DIR, '.ip-salt');
try {
  if (!salt && fs.existsSync(SALT_FILE)) {
    salt = fs.readFileSync(SALT_FILE, 'utf8').trim();
  }
  if (!salt) {
    salt = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(SALT_FILE, salt, { mode: 0o600 });
    } catch {
      /* best effort */
    }
  }
} catch {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
}

function hashIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Append-only JSONL stores with in-memory index + 180d-style pruning.
// Files live under data/ (portable) — deploy India region hosts for DPDP/CERT-In.
// ---------------------------------------------------------------------------
function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJson(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    /* best effort — never crash chat over persistence */
  }
}

const FILES = {
  reports: path.join(DATA_DIR, 'reports.jsonl'),
  grievances: path.join(DATA_DIR, 'grievances.jsonl'),
  consents: path.join(DATA_DIR, 'consents.jsonl'),
  bans: path.join(DATA_DIR, 'bans.json'),
  dsr: path.join(DATA_DIR, 'dsr.jsonl'),
  blocks: path.join(DATA_DIR, 'blocks.jsonl'),
};

function appendJsonl(file, obj) {
  try {
    fs.appendFileSync(file, `${JSON.stringify({ ...obj, loggedAt: new Date().toISOString() })}\n`);
  } catch {
    /* best effort */
  }
}
function readJsonl(file, max = 5000) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .slice(-max)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Bans: { hashedIp: { until, reason, strikes, updatedAt } }
let bans = loadJson(FILES.bans, {});
function persistBans() {
  saveJson(FILES.bans, bans);
}
function pruneBans(now = Date.now()) {
  let changed = false;
  for (const [k, v] of Object.entries(bans)) {
    if (v.until && v.until < now) {
      delete bans[k];
      changed = true;
    }
  }
  if (changed) persistBans();
}
function isBanned(hashedIp) {
  if (!hashedIp || hashedIp === 'unknown') return null;
  pruneBans();
  const b = bans[hashedIp];
  if (b && b.until > Date.now()) return b;
  return null;
}
function addStrike(hashedIp, reason, critical) {
  if (!hashedIp || hashedIp === 'unknown') return null;
  pruneBans();
  const prev = bans[hashedIp] || { strikes: 0 };
  const strikes = (prev.strikes || 0) + 1;
  const hours = critical ? config.banHoursChildSafety : config.banHoursDefault * strikes;
  const entry = {
    strikes,
    reason,
    critical: !!critical,
    until: Date.now() + hours * 3600 * 1000,
    updatedAt: new Date().toISOString(),
  };
  bans[hashedIp] = entry;
  persistBans();
  return entry;
}

// ---------------------------------------------------------------------------
// Logging: ICT logs (CERT-In 180d, India) + safety/moderation audit trail.
// Log metadata only — never message content, never media.
// ---------------------------------------------------------------------------
function ictLog(event, fields = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `ict-${day}.log`);
  appendJsonl(file, { event, ...fields });
  pruneOldLogs(LOG_DIR, 'ict-', config.ictLogDays);
}
function safetyLog(event, fields = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `safety-${day}.log`);
  appendJsonl(file, { event, ...fields });
  pruneOldLogs(LOG_DIR, 'safety-', config.safetyEvidenceDays);
}
function pruneOldLogs(dir, prefix, keepDays) {
  try {
    const cutoff = Date.now() - keepDays * 86400 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const m = name.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      const t = Date.parse(`${m[1]}T00:00:00Z`);
      if (Number.isFinite(t) && t < cutoff) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Age assurance: 18+ only, neutral gate. Server validates DOB — checkbox alone
// is NOT accepted (DPDP child = <18; COPPA <13; FTC NGL precedent bans <18 for
// anonymous messaging; Google Play Aug-2026 + Apple Feb-2026 restrict this category).
// ---------------------------------------------------------------------------
function ageFromDob(dobStr, now = new Date()) {
  if (typeof dobStr !== 'string') return null;
  const m = dobStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > now.getFullYear() || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dob = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dob.getTime())) return null;
  // Guard against overflow dates like 2026-02-31 rolling into March.
  if (dob.getUTCFullYear() !== y || dob.getUTCMonth() !== mo - 1 || dob.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  const hadBirthday =
    now.getUTCMonth() + 1 > mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}
function verifyAgeAttestation({ dob, confirm18 }) {
  if (confirm18 !== true) return { ok: false, code: 'confirm-required' };
  const age = ageFromDob(dob);
  if (age === null) return { ok: false, code: 'invalid-dob' };
  if (age < config.minAge) return { ok: false, code: 'underage', age };
  return { ok: true, ageRange: age >= 25 ? '25+' : '18-24' };
}

// ---------------------------------------------------------------------------
// Text safety filter (DPDP/IT Rules due diligence + DSA/OSA illegal-content duty).
// Tiers: critical (child-safety / CSAM-grooming / sextortion) → block + hold +
// instant disconnect; high (sexual explicit, threats, hate, PII, scam links) →
// block + warn; spam → throttle. No content is stored — only decision metadata.
// ---------------------------------------------------------------------------
const CRITICAL_PATTERNS = [
  /\b(8|9|1[0-7])\s?(yo|y\.o|year old girl|year old boy)\b/i,
  /\b(school\s?girl|school\s?boy|minor\s?(girl|boy)|underage)\b/i,
  /\b(send\s?(me\s?)?(nude|naked)\s?(pic|pics|photo|video)s?)\b/i,
  /\b(pic\s?of\s?(yourself|you)\s?(naked|nude|without\s?clothes))\b/i,
  /\b(meet\s?(me\s?)?(alone|in\s?secret|after\s?school)|don'?t\s?tell\s?(your\s?)?(mom|dad|parents))\b/i,
  /\b(cum\s?(on\scam|for\sme)|strip\s?(for\sme|on\s?cam)|take\s?(it|clothes)\s?off)\b/i,
  /\b(i'?ll\s?(leak|post|share)\s?(it|your\s?(pic|video|nudes?))|pay\s?me\s?or\s?i'?ll)\b/i, // sextortion
  /\b(child\s?(porn|abuse)|cp\s?(trade|share|sell))\b/i,
];

const HIGH_PATTERNS = [
  /\b(fuck(ing)?|shit|bitch|whore|slut|cunt|dick|pussy|boobs?|horny|blowjob|handjob|orgasm|masturbat\w*|porn\w*|xxx|sex\s?(chat|video|call|now)|nude|naked)\b/i,
  /\b(kill\s?(yourself|u|you)|i\s?will\s?(kill|hurt|rape|stab|shoot)\s?you|rape\s?threat|death\s?threat)\b/i,
  /\b(hate\s?(you\s?)?(muslim|hindu|christian|jew|gay|trans|dalit)|go\s?back\s?to\s?(pakistan|china))\b/i,
  /\b(otp|one[ -]?time\s?password|cvv|card\s?number|bank\s?(account|details)|upi\s?id\s?\S+@\S+|password\s?(is|:))\b/i,
  /\b(loan\s?offer|double\s?your\s?money|crypto\s?giveaway|send\s?\d+\s?(usdt|inr|btc)|free\s?recharge\s?click)\b/i,
  /(https?:\/\/[^\s]{4,}|www\.[^\s]{4,}|t\.me\/\S+|whatsapp\.(com|me)\/\S+|instagram\.com\/\S+)/i,
  /\b(\+?91[\s-]?\d{5}[\s-]?\d{5}|\b\d{10}\b)\b/, // Indian phone numbers
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // emails
];

function classifyText(text) {
  if (typeof text !== 'string' || !text.trim()) return { verdict: 'empty' };
  const t = text.trim();
  for (const re of CRITICAL_PATTERNS) {
    if (re.test(t)) return { verdict: 'block-critical', category: 'child-safety', signal: re.source.slice(0, 48) };
  }
  // Ordered high-risk checks so the category reflects the actual signal.
  if (/\b(otp|one[ -]?time\s?password|cvv|card\s?number|bank\s?(account|details)|upi\s?id\s?\S+@\S+|password\s?(is|:))\b/i.test(t)) {
    return { verdict: 'block-high', category: 'pii-credentials', signal: 'credentials' };
  }
  if (/\b(\+?91[\s-]?\d{5}[\s-]?\d{5}|\b\d{10}\b)\b/.test(t) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) {
    return { verdict: 'block-high', category: 'pii-contact', signal: 'phone-or-email' };
  }
  if (/\b(fuck(ing)?|shit|bitch|whore|slut|cunt|dick|pussy|boobs?|horny|blowjob|handjob|orgasm|masturbat\w*|porn\w*|xxx|sex\s?(chat|video|call|now)|nude|naked)\b/i.test(t)) {
    return { verdict: 'block-high', category: 'sexual-explicit', signal: 'sexual-explicit' };
  }
  if (/\b(kill\s?(yourself|u|you)|i\s?will\s?(kill|hurt|rape|stab|shoot)\s?you|rape\s?threat|death\s?threat)\b/i.test(t)) {
    return { verdict: 'block-high', category: 'threat', signal: 'threat' };
  }
  if (/\b(hate\s?(you\s?)?(muslim|hindu|christian|jew|gay|trans|dalit)|go\s?back\s?to\s?(pakistan|china))\b/i.test(t)) {
    return { verdict: 'block-high', category: 'hate-harassment', signal: 'hate' };
  }
  if (/\b(loan\s?offer|double\s?your\s?money|crypto\s?giveaway|send\s?\d+\s?(usdt|inr|btc)|free\s?recharge\s?click)\b/i.test(t)) {
    return { verdict: 'block-high', category: 'scam', signal: 'scam' };
  }
  if (/(https?:\/\/[^\s]{4,}|www\.[^\s]{4,}|t\.me\/\S+|whatsapp\.(com|me)\/\S+|instagram\.com\/\S+)/i.test(t)) {
    return { verdict: 'block-high', category: 'offplatform-link', signal: 'external-link' };
  }
  return { verdict: 'allow' };
}

// ---------------------------------------------------------------------------
// Report / grievance taxonomy (IT Rules: 24h ack, 7d resolution; emergency
// 2h removal for nudity/private-area/impersonation complaints; DPDP ~90d rights).
// ---------------------------------------------------------------------------
const REPORT_REASONS = new Set([
  'child-safety', // grooming, CSAM, sextortion, minor present — highest priority
  'nudity-sexual',
  'harassment',
  'threat',
  'scam-fraud',
  'privacy-violation',
  'impersonation',
  'illegal-content',
  'spam',
  'other',
  'emergency', // imminent harm — treated as child-safety priority
]);
const EMERGENCY_REASONS = new Set(['child-safety', 'emergency', 'threat']);

function fileReport({ hashedIp, reason, details, sessionId, mode }) {
  const cleanReason = REPORT_REASONS.has(reason) ? reason : 'other';
  const ackId = newId('RPT');
  const rec = {
    ackId,
    hashedIp,
    reason: cleanReason,
    emergency: EMERGENCY_REASONS.has(cleanReason),
    details: typeof details === 'string' ? details.slice(0, 500) : '',
    sessionId: sessionId || null,
    mode: mode || null,
    sla:
      cleanReason === 'nudity-sexual' || cleanReason === 'impersonation'
        ? '2h-emergency-removal'
        : 'ack-24h_resolve-7d_36h-illegal-content',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  appendJsonl(FILES.reports, rec);
  safetyLog('report-filed', {
    ackId,
    hashedIp,
    reason: rec.reason,
    emergency: rec.emergency,
    sessionId,
  });
  return rec;
}

function fileGrievance({ hashedIp, category, description, contact }) {
  const ackId = newId('GRV');
  const rec = {
    ackId,
    hashedIp,
    category: typeof category === 'string' ? category.slice(0, 80) : 'other',
    description: typeof description === 'string' ? description.slice(0, 2000) : '',
    contact: typeof contact === 'string' ? contact.slice(0, 160) : '',
    sla: 'ack-24h_resolve-7d_GAC-appeal-30d',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  appendJsonl(FILES.grievances, rec);
  safetyLog('grievance-filed', { ackId, hashedIp, category: rec.category });
  return rec;
}

// ---------------------------------------------------------------------------
// Geo gating: Tier A/B/C launch model. If ALLOWED_* set → allow-list mode.
// Else BLOCKED_* denies listed countries. Country comes from proxy/CDN header
// (Cloudflare CF-IPCountry / X-Country-Code). Absent header → allow + log.
// ---------------------------------------------------------------------------
function countryFromHeaders(headers = {}) {
  const raw =
    headers['cf-ipcountry'] || headers['x-country-code'] || headers['x-vercel-ip-country'] || '';
  const c = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}
function geoDecision(headers) {
  const country = countryFromHeaders(headers);
  if (config.allowedCountries.size > 0) {
    if (!country) return { allowed: true, mode: 'allowlist-no-signal' };
    if (config.allowedCountries.has(country)) return { allowed: true, country };
    return { allowed: false, country, mode: 'not-in-allowlist' };
  }
  if (country && config.blockedCountries.has(country)) {
    return { allowed: false, country, mode: 'blocklisted' };
  }
  return { allowed: true, country };
}

// ---------------------------------------------------------------------------
// Transparency counters (SSMI monthly report / DSA transparency template).
// ---------------------------------------------------------------------------
function transparencySummary() {
  const reports = readJsonl(FILES.reports, 20000);
  const grievances = readJsonl(FILES.grievances, 20000);
  const byReason = {};
  let emergency = 0;
  for (const r of reports) {
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    if (r.emergency) emergency += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    reports: { total: reports.length, byReason, emergency },
    grievances: { total: grievances.length },
    bansActive: Object.keys(bans).length,
    sla: {
      reportAck: '24h',
      reportResolve: '7d (36h illegal-content removals; GAC appeal 30d)',
      emergencyRemoval: '2h (nudity/private-area/impersonation)',
      govtTakedown: '3h (IT Rules Feb-2026 amendment)',
      grievance: 'ack-24h_resolve-7d',
      certInIncident: '6h',
    },
    contacts: {
      grievance: config.grievanceEmail,
      dpo: config.dpoEmail,
      childSafety: config.childSafetyEmail,
      lawEnforcement: config.lawEnforcementEmail,
    },
  };
}

module.exports = {
  config,
  FILES,
  DATA_DIR,
  LOG_DIR,
  hashIp,
  newId,
  appendJsonl,
  readJsonl,
  bans,
  isBanned,
  addStrike,
  ictLog,
  safetyLog,
  ageFromDob,
  verifyAgeAttestation,
  classifyText,
  REPORT_REASONS,
  EMERGENCY_REASONS,
  fileReport,
  fileGrievance,
  countryFromHeaders,
  geoDecision,
  transparencySummary,
};
