const express = require('express');
const http = require('http');
const net = require('node:net');
const path = require('path');
const helmet = require('helmet');
const proxyaddr = require('proxy-addr');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const compliance = require('./lib/compliance');

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const trustProxy = process.env.TRUST_PROXY === '1';
// Identifies this Node process in logs + /health so split-brain deploys
// (two Render instances serving the same URL) are visible immediately.
const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const STARTED_AT = Date.now();

function parseTrustedProxyRanges(value) {
  if (typeof value !== 'string') return [];
  const out = [];
  for (const entry of value.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // Shorthand for hosted platforms (Render/Railway/Fly): their edge proxy
    // reaches Node from a private/internal address that is not static, so the
    // peer IP must be trusted for X-Forwarded-For to be honoured. Without this
    // every client collapses to the same proxy IP (shared rate-limit buckets,
    // shared hashed identity, global block/ban poisoning) and matching breaks.
    // Use TRUSTED_PROXY_IPS=private (or list the private CIDRs explicitly).
    if (trimmed.toLowerCase() === 'private') {
      out.push(
        '127.0.0.1', '::1',
        '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
        'fc00::/7', 'fe80::/10',
      );
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

const trustedProxyRanges = parseTrustedProxyRanges(process.env.TRUSTED_PROXY_IPS);
if (trustProxy && trustedProxyRanges.length === 0) {
  throw new Error('Set TRUSTED_PROXY_IPS to the IP address or CIDR of each trusted proxy when TRUST_PROXY=1.');
}

let isTrustedProxy = () => false;
if (trustProxy) {
  try {
    const compiledTrustedProxyRanges = proxyaddr.compile(trustedProxyRanges);
    isTrustedProxy = (address) => compiledTrustedProxyRanges(address);
  } catch {
    throw new Error('TRUSTED_PROXY_IPS must contain only valid IP addresses, CIDRs, or proxy-addr ranges.');
  }
}

function parseOrigins(value) {
  if (!value) return new Set();

  const origins = new Set();
  for (const entry of value.split(',')) {
    try {
      const origin = new URL(entry.trim());
      if ((origin.protocol === 'http:' || origin.protocol === 'https:') &&
          !origin.username && !origin.password &&
          origin.pathname === '/' && !origin.search && !origin.hash) {
        origins.add(origin.origin);
      }
    } catch {
      // Invalid entries are deliberately ignored; production checks below fail closed.
    }
  }
  return origins;
}

// Set APP_ORIGIN to the public site origin, for example https://chat.example.com.
// Multiple comma-separated origins can be provided through ALLOWED_ORIGINS.
const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN);
if (isProduction && allowedOrigins.size === 0) {
  throw new Error('Set APP_ORIGIN (or ALLOWED_ORIGINS) to the public HTTPS origin before starting in production.');
}
if (isProduction && [...allowedOrigins].some((origin) => !origin.startsWith('https://'))) {
  throw new Error('Production origins must use HTTPS.');
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const normalized = new URL(origin).origin;
    return allowedOrigins.has(normalized) || (!isProduction && isLocalDevelopmentOrigin(normalized));
  } catch {
    return false;
  }
}

const app = express();
// Trust forwarding headers only when the TCP peer is an explicitly configured proxy.
app.set('trust proxy', isTrustedProxy);

// ---------- Security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

// This app exposes no JSON API. Avoid parsing request bodies that are never used.
if (isProduction && process.env.FORCE_HTTPS !== 'false') {
  app.use((req, res, next) => {
    if (req.secure) return next();
    const publicOrigin = [...allowedOrigins][0];
    return res.redirect(308, `${publicOrigin}${req.originalUrl}`);
  });
}

// HTTP rate limit: 120 req / 15min per IP
const httpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, slow down.',
});
app.use(httpLimiter);

// ---------- Compliance: geo gating (Tier A/B/C launch model) ----------
// Set ALLOWED_COUNTRY_CODES="IN" for India-only launch, or
// BLOCKED_COUNTRY_CODES for jurisdictions not yet cleared by counsel.
// Country signal is expected from CDN/proxy headers (CF-IPCountry etc.).
app.use((req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/api/compliance')) return next();
  const decision = compliance.geoDecision(req.headers || {});
  if (!decision.allowed) {
    compliance.safetyLog('geo-blocked', {
      hashedIp: compliance.hashIp(clientIpFromSocket(req)),
      country: decision.country,
      path: req.path,
    });
    return res.status(451).type('html').send(
      '<h1>451 — Unavailable in your region</h1>' +
      '<p>Tilo is launched in stages by jurisdiction (see Terms &amp; Privacy Policy). ' +
      'Your region is not enabled yet.</p>',
    );
  }
  return next();
});

function clientIpFromSocket(req) {
  try {
    const peer = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : 'unknown';
    return peer;
  } catch {
    return 'unknown';
  }
}

// JSON bodies ONLY for /api/* — the chat itself stays ephemeral with no stored bodies.
app.use('/api', express.json({ limit: '16kb' }));

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, slow down.',
});
app.use('/api', apiLimiter);

// ---------- Compliance APIs ----------
// RTC config: STUN always, TURN when configured (required for mobile-carrier
// symmetric NAT where STUN-only video never connects even after matching).
// Set TURN_URLS="turn:turn.example.com:3478", TURN_USERNAME, TURN_CREDENTIAL.
function rtcIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = String(process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length > 0) {
    const entry = { urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls };
    if (process.env.TURN_USERNAME) entry.username = String(process.env.TURN_USERNAME).slice(0, 128);
    if (process.env.TURN_CREDENTIAL) entry.credential = String(process.env.TURN_CREDENTIAL).slice(0, 256);
    servers.push(entry);
  }
  return servers;
}

app.get('/api/rtc-config', (req, res) => res.json({ ok: true, iceServers: rtcIceServers() }));
// Itemised consent (DPDP notice + GDPR lawful-basis record). Stores decision
// metadata only — no chat content, no media.
app.post('/api/age-attest', (req, res) => {
  const { dob, confirm18 } = req.body || {};
  const result = compliance.verifyAgeAttestation({ dob, confirm18 });
  const ip = clientIp(req);
  compliance.ictLog('age-attestation', {
    hashedIp: compliance.hashIp(ip),
    ok: result.ok,
    code: result.code || 'ok',
    ageRange: result.ageRange || null,
  });
  if (!result.ok) {
    const status = result.code === 'underage' ? 403 : 400;
    return res.status(status).json({
      ok: false,
      code: result.code,
      message:
        result.code === 'underage'
          ? 'Tilo is 18+ only. Access refused and this attempt was logged for child-safety audit.'
          : 'Valid date of birth (YYYY-MM-DD) and explicit 18+ confirmation are required.',
    });
  }
  return res.json({ ok: true, ageRange: result.ageRange, consentVersion: compliance.config.consentVersion });
});

app.post('/api/consent', (req, res) => {
  const { consent, purposes } = req.body || {};
  if (typeof consent !== 'boolean') return res.status(400).json({ ok: false, code: 'consent-required' });
  const ip = clientIp(req);
  const rec = {
    id: compliance.newId('CON'),
    hashedIp: compliance.hashIp(ip),
    consent,
    purposes: Array.isArray(purposes) ? purposes.slice(0, 20).map(String).slice(0, 20) : [],
    version: compliance.config.consentVersion,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  compliance.appendJsonl(compliance.FILES.consents, rec);
  compliance.ictLog('consent-decision', { hashedIp: rec.hashedIp, consent, version: rec.version });
  return res.json({ ok: true, id: rec.id, version: rec.version });
});

// Structured safety report (DSA notice-and-action + IT Rules grievance track).
app.post('/api/report', (req, res) => {
  const { reason, details, sessionId, mode } = req.body || {};
  if (reason && ![...compliance.REPORT_REASONS].includes(reason)) {
    return res.status(400).json({ ok: false, code: 'invalid-reason', valid: [...compliance.REPORT_REASONS] });
  }
  const ip = clientIp(req);
  const rec = compliance.fileReport({
    hashedIp: compliance.hashIp(ip),
    reason: reason || 'other',
    details: typeof details === 'string' ? details : '',
    sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 80) : null,
    mode: mode === 'text' || mode === 'video' ? mode : null,
  });
  if (rec.emergency) {
    const ban = compliance.addStrike(rec.hashedIp, `report:${rec.reason}`, true);
    compliance.safetyLog('emergency-hold', { ackId: rec.ackId, banUntil: ban ? ban.until : null });
  }
  return res.json({ ok: true, ackId: rec.ackId, emergency: rec.emergency, sla: rec.sla });
});

app.post('/api/block', (req, res) => {
  const ip = clientIp(req);
  compliance.appendJsonl(compliance.FILES.blocks, {
    id: compliance.newId('BLK'),
    hashedIp: compliance.hashIp(ip),
    peerRef: typeof req.body?.peerRef === 'string' ? req.body.peerRef.slice(0, 80) : null,
    createdAt: new Date().toISOString(),
  });
  return res.json({ ok: true });
});

// Grievance intake (IT Rules Feb-2026: ack 24h, resolve 7d, GAC appeal 30d; emergency 2h; govt takedown 3h).
app.post('/api/grievance', (req, res) => {
  const { category, description, contact } = req.body || {};
  if (!description || String(description).trim().length < 10) {
    return res.status(400).json({ ok: false, code: 'description-too-short' });
  }
  const ip = clientIp(req);
  const rec = compliance.fileGrievance({
    hashedIp: compliance.hashIp(ip),
    category: typeof category === 'string' ? category : 'other',
    description: String(description),
    contact: typeof contact === 'string' ? contact : '',
  });
  return res.json({
    ok: true,
    ackId: rec.ackId,
    sla: rec.sla,
    officer: compliance.config.grievanceName,
    email: compliance.config.grievanceEmail,
  });
});

// Data-subject rights (DPDP/GDPR/CCPA): access + erasure request.
app.get('/api/data-export', (req, res) => {
  const ip = clientIp(req);
  const hashedIp = compliance.hashIp(ip);
  const reports = compliance.readJsonl(compliance.FILES.reports).filter((r) => r.hashedIp === hashedIp);
  const consents = compliance.readJsonl(compliance.FILES.consents).filter((r) => r.hashedIp === hashedIp);
  const grievances = compliance.readJsonl(compliance.FILES.grievances).filter((r) => r.hashedIp === hashedIp);
  return res.json({
    ok: true,
    hashedRef: hashedIp,
    retentionNote:
      'Live media is never stored. Security logs roll every 180 days (CERT-In). Safety evidence is held 180 days where required by IT Rules; legal holds override erasure.',
    data: { reports, consents, grievances },
  });
});

app.post('/api/data-delete', (req, res) => {
  const ip = clientIp(req);
  const hashedIp = compliance.hashIp(ip);
  const rec = {
    id: compliance.newId('DSR'),
    hashedIp,
    type: 'erasure',
    status: 'recorded-legal-hold-applies',
    note: 'Non-essential records queued for deletion. Safety/legal-hold evidence (180d) and tax records are retained per law.',
    createdAt: new Date().toISOString(),
  };
  compliance.appendJsonl(compliance.FILES.dsr, rec);
  compliance.ictLog('dsr-erasure-request', { hashedIp });
  return res.json({ ok: true, id: rec.id, status: rec.status });
});

// Launch-gate + transparency (SSMI monthly report / DSA transparency template).
app.get('/api/compliance/status', (req, res) => {
  const c = compliance.config;
  return res.json({
    ok: true,
    product: 'tilo-18plus-anonymous-ephemeral',
    ageGate: 'dob-18plus-server-enforced',
    mediaStorage: 'none-by-default-webrtc-p2p',
    ictLogs: `${c.ictLogDays}d-rolling`,
    safetyEvidence: `${c.safetyEvidenceDays}d`,
    grievance: { name: c.grievanceName, email: c.grievanceEmail, sla: 'ack-24h_resolve-7d_GAC-30d_emergency-2h_govt-3h' },
    dpo: c.dpoEmail,
    childSafety: c.childSafetyEmail,
    lawEnforcement: c.lawEnforcementEmail,
    consentVersion: c.consentVersion,
    geo: {
      allowlist: [...c.allowedCountries],
      blocklist: [...c.blockedCountries],
    },
  });
});

app.get('/api/transparency', (req, res) => res.json({ ok: true, ...compliance.transparencySummary() }));

// Static
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/health', (req, res) => res.json({
  ok: true,
  online: onlineCount,
  waiting: waitingQueue.length,
  paired: partners.size / 2,
  instanceId: INSTANCE_ID,
  uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
  // If two devices report different instanceIds (refresh /health on each),
  // the load balancer is splitting them across instances and in-memory
  // matching can never pair them: scale to 1 instance or add a Redis adapter.
  singleInstanceRequired: true,
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);

function readBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

const MAX_SOCKETS_PER_IP = readBoundedInteger(process.env.MAX_SOCKETS_PER_IP, 8, 1, 50);
const MAX_WAITING_USERS = readBoundedInteger(process.env.MAX_WAITING_USERS, 5000, 100, 50000);
const MAX_HANDSHAKES_PER_MINUTE = readBoundedInteger(process.env.MAX_HANDSHAKES_PER_MINUTE, 30, 5, 300);
const socketCountsByIp = new Map();
const handshakeWindowsByIp = new Map();

function canonicalIp(value) {
  if (typeof value !== 'string') return null;

  const ip = value.trim();
  if (!ip || ip.includes(',')) return null;

  // Normalize IPv4-mapped socket addresses so the same peer cannot use two
  // representations for distinct limit keys.
  const mappedIpv4Prefix = '::ffff:';
  if (ip.toLowerCase().startsWith(mappedIpv4Prefix)) {
    const ipv4 = ip.slice(mappedIpv4Prefix.length);
    if (net.isIP(ipv4) === 4) return ipv4;
  }

  return net.isIP(ip) ? ip.toLowerCase() : null;
}

function clientIp(req) {
  const peerIp = canonicalIp(req.socket?.remoteAddress) || 'unknown';

  // The reverse proxy must replace X-Forwarded-For with exactly one canonical
  // client address. A comma-delimited header means it was appended to or sent
  // by a client, so it is deliberately ignored rather than partially parsed.
  if (peerIp === 'unknown' || !isTrustedProxy(peerIp)) return peerIp;

  return canonicalIp(req.headers?.['x-forwarded-for']) || peerIp;
}

function allowHandshake(req) {
  if (!isAllowedOrigin(req.headers.origin)) return false;

  // Engine.IO invokes allowRequest for the initial request. Keep this guard scoped
  // to handshakes so normal long-polling traffic is not accidentally throttled.
  const requestUrl = new URL(req.url, 'http://engine.local');
  if (requestUrl.searchParams.has('sid')) return true;

  const ip = clientIp(req);
  const now = Date.now();
  const entry = handshakeWindowsByIp.get(ip);
  if (!entry || now - entry.startedAt >= 60_000) {
    if (!entry && handshakeWindowsByIp.size >= 10_000) {
      for (const [trackedIp, trackedEntry] of handshakeWindowsByIp) {
        if (now - trackedEntry.startedAt >= 60_000) handshakeWindowsByIp.delete(trackedIp);
      }
      if (handshakeWindowsByIp.size >= 10_000) return false;
    }
    handshakeWindowsByIp.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_HANDSHAKES_PER_MINUTE;
}

const io = new Server(server, {
  // CORS headers do not restrict WebSocket upgrades. allowRequest below enforces
  // a browser origin allowlist for every Engine.IO handshake.
  allowRequest: (req, callback) => callback(null, allowHandshake(req)),
  maxHttpBufferSize: 16 * 1024,
  connectionStateRecovery: false,
});

// Bound slow HTTP connections while preserving Socket.IO long-polling and upgrades.
server.headersTimeout = 15_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 5_000;

// ---------- Matching state ----------
let onlineCount = 0;
let waitingQueue = []; // [{id, mode}]
let partners = new Map(); // socketId -> partnerId
const waitingTimers = new Map();
// blockerHashedIp -> Set(blockedHashedIp): one-tap Block prevents rematch.
const blockGraph = new Map();
function recordBlock(blockerHashed, blockedHashed) {
  if (!blockerHashed || !blockedHashed || blockerHashed === 'unknown') return;
  // Same-hash pairs happen for same-household NAT (mobile + PC on one WiFi)
  // and for misconfigured proxies where every client shares the proxy IP.
  // Recording a self-edge would deadlock ALL future matches globally, so skip it.
  if (blockerHashed === blockedHashed) return;
  if (!blockGraph.has(blockerHashed)) blockGraph.set(blockerHashed, new Set());
  blockGraph.get(blockerHashed).add(blockedHashed);
  compliance.appendJsonl(compliance.FILES.blocks, { blockerHashed, blockedHashed });
}
function isBlockedPair(aHashed, bHashed) {
  if (!aHashed || !bHashed || aHashed === 'unknown' || bHashed === 'unknown') return false;
  // Same household / same egress IP must always be allowed to match (this is
  // exactly the "phone + laptop on one WiFi" test). Never self-block.
  if (aHashed === bHashed) return false;
  return (blockGraph.get(aHashed)?.has(bHashed) || blockGraph.get(bHashed)?.has(aHashed)) ?? false;
}

function getPartner(socketId) {
  return partners.get(socketId);
}

function pair(a, b, meta = {}) {
  partners.set(a, b);
  partners.set(b, a);
  // remove both from queue if present
  removeFromQueue(a);
  removeFromQueue(b);
  const { callerId = a, peerModeForA = null, peerModeForB = null, crossMode = false } = meta;
  const calleeId = callerId === a ? b : a;
  const callerPeerMode = callerId === a ? peerModeForA : peerModeForB;
  const calleePeerMode = callerId === a ? peerModeForB : peerModeForA;
  console.log(`[match:${INSTANCE_ID}] paired ${a.slice(0, 6)}<->${b.slice(0, 6)} caller=${callerId.slice(0, 6)} crossMode=${crossMode} waiting=${waitingQueue.length} paired=${partners.size / 2}`);
  io.to(callerId).emit('matched', { role: 'caller', peerMode: callerPeerMode, crossMode });
  io.to(calleeId).emit('matched', { role: 'callee', peerMode: calleePeerMode, crossMode });
  broadcastCount();
}

function unpair(socketId, notifyPartner = true) {
  const p = partners.get(socketId);
  if (p) {
    partners.delete(socketId);
    partners.delete(p);
    if (notifyPartner) {
      io.to(p).emit('partner-left');
    }
  }
}

function removeFromQueue(socketId) {
  waitingQueue = waitingQueue.filter(x => x.id !== socketId);
  const timer = waitingTimers.get(socketId);
  if (timer) clearTimeout(timer);
  waitingTimers.delete(socketId);
}

function enqueue(socket, mode) {
  removeFromQueue(socket.id);
  if (waitingQueue.length >= MAX_WAITING_USERS) {
    socket.emit('server-busy');
    return false;
  }

  waitingQueue.push({ id: socket.id, mode });
  socket.emit('waiting');
  // Tell the client its queue position so "stuck on waiting" is debuggable
  // from the browser console and Render logs (instanceId pins the process).
  socket.emit('queue-status', { position: waitingQueue.length, instanceId: INSTANCE_ID });
  console.log(`[match:${INSTANCE_ID}] enqueue ${socket.id.slice(0, 6)} mode=${mode} waiting=${waitingQueue.length} online=${onlineCount}`);
  const timer = setTimeout(() => {
    waitingTimers.delete(socket.id);
    if (!partners.has(socket.id) && waitingQueue.some(waiter => waiter.id === socket.id)) {
      socket.emit('still-waiting');
    }
  }, 30_000);
  timer.unref?.();
  waitingTimers.set(socket.id, timer);
  return true;
}

function isCompatibleMode(waiterMode, newcomerMode) {
  return waiterMode === newcomerMode || waiterMode === 'any' || newcomerMode === 'any';
}

function tryPairCandidates(waiterId, waiterMode, newcomerId, newcomerMode) {
  const meSock = io.sockets.sockets.get(newcomerId);
  const otherSock = io.sockets.sockets.get(waiterId);
  if (!otherSock || !meSock) {
    removeFromQueue(waiterId);
    return false;
  }
  const meHashed = meSock.data?.hashedIp || null;
  const otherHashed = otherSock.data?.hashedIp || null;
  if (meHashed && otherHashed && isBlockedPair(meHashed, otherHashed)) return false;
  const crossMode = waiterMode !== newcomerMode && waiterMode !== 'any' && newcomerMode !== 'any';
  // When modes differ, the video side creates the WebRTC offer so the text
  // side (which never initiates) can still answer. Text chat works either way.
  let callerId = waiterId;
  if (crossMode) {
    if (waiterMode === 'video' && newcomerMode === 'text') callerId = waiterId;
    else if (waiterMode === 'text' && newcomerMode === 'video') callerId = newcomerId;
  }
  pair(waiterId, newcomerId, {
    callerId,
    peerModeForA: newcomerMode, // peer mode as seen by waiter (a)
    peerModeForB: waiterMode, // peer mode as seen by newcomer (b)
    crossMode,
  });
  return true;
}

function tryMatch(newcomerId, mode) {
  // Pass 1: prefer same-mode (or 'any') so video-video stays video.
  // Pass 2: cross-mode fallback (video<->text) so two users are never stuck
  // on "searching for stranger" just because their tabs selected different modes.
  for (let idx = 0; idx < waitingQueue.length; idx += 1) {
    const w = waitingQueue[idx];
    if (w.id === newcomerId) continue;
    if (!isCompatibleMode(w.mode, mode)) continue;
    if (tryPairCandidates(w.id, w.mode, newcomerId, mode)) return true;
  }
  for (let idx = 0; idx < waitingQueue.length; idx += 1) {
    const w = waitingQueue[idx];
    if (w.id === newcomerId) continue;
    if (isCompatibleMode(w.mode, mode)) continue; // already tried
    if (tryPairCandidates(w.id, w.mode, newcomerId, mode)) return true;
  }
  return false;
}

function broadcastCount() {
  io.emit('online-count', { count: onlineCount });
}

function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 500);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isValidDescription(description, type) {
  return isPlainObject(description) && description.type === type &&
    typeof description.sdp === 'string' && Buffer.byteLength(description.sdp, 'utf8') <= 8 * 1024;
}

function isValidCandidate(candidate) {
  return isPlainObject(candidate) && typeof candidate.candidate === 'string' &&
    Buffer.byteLength(candidate.candidate, 'utf8') <= 2048 &&
    (candidate.sdpMid === undefined || candidate.sdpMid === null || typeof candidate.sdpMid === 'string') &&
    (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length <= 128) &&
    (candidate.sdpMLineIndex === undefined || candidate.sdpMLineIndex === null || Number.isInteger(candidate.sdpMLineIndex)) &&
    (!Number.isInteger(candidate.sdpMLineIndex) ||
      (candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex <= 255)) &&
    (candidate.usernameFragment === undefined ||
      (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256));
}

io.on('connection', (socket) => {
  const ip = clientIp(socket.request);
  const hashedIp = compliance.hashIp(ip);
  let peerIp = 'unknown';
  try {
    peerIp = String(socket.request?.socket?.remoteAddress || 'unknown');
  } catch { /* ignore */ }
  // Visibility for Render debugging: peerIp is the TCP peer (Render router),
  // ip is the derived client IP (X-Forwarded-For when the proxy is trusted).
  // If every connection logs the same ip, TRUSTED_PROXY_IPS is wrong and all
  // users share rate-limit buckets + hashed identity.
  console.log(`[net:${INSTANCE_ID}] connect ${socket.id.slice(0, 6)} peer=${peerIp} client=${ip} trustedProxy=${trustProxy}`);
  const banned = compliance.isBanned(hashedIp);
  if (banned) {
    socket.emit('banned', { until: banned.until, reason: banned.reason });
    compliance.safetyLog('banned-connection-refused', { hashedIp, reason: banned.reason });
    socket.disconnect(true);
    return;
  }
  const activeSockets = socketCountsByIp.get(ip) || 0;
  if (activeSockets >= MAX_SOCKETS_PER_IP) {
    socket.emit('connection-limit');
    socket.disconnect(true);
    return;
  }
  socketCountsByIp.set(ip, activeSockets + 1);
  socket.data.clientIp = ip;
  socket.data.hashedIp = hashedIp;
  socket.data.sessionId = compliance.newId('SES');
  socket.data.ageVerified = false;
  socket.data.ageRange = null;

  onlineCount++;
  broadcastCount();
  compliance.ictLog('socket-connect', { hashedIp, sessionId: socket.data.sessionId });

  // Each connection owns its own quota state, so it is released automatically
  // when the socket closes rather than accumulating attacker-controlled keys.
  const eventWindows = new Map();
  function withinEventLimit(event, max, windowMs) {
    const now = Date.now();
    const entry = eventWindows.get(event);
    if (!entry || now - entry.startedAt >= windowMs) {
      eventWindows.set(event, { startedAt: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  }

  function requireAge() {
    if (socket.data.ageVerified) return true;
    socket.emit('age-required', { message: '18+ age verification is required before matching.' });
    return false;
  }

  // 18+ age attestation — server-enforced. Checkbox alone is rejected.
  socket.on('attest-age', (data = {}) => {
    if (!withinEventLimit('attest-age', 5, 60_000)) {
      socket.emit('rate-limited');
      return;
    }
    const result = compliance.verifyAgeAttestation({
      dob: typeof data?.dob === 'string' ? data.dob : null,
      confirm18: data?.confirm18 === true,
    });
    compliance.ictLog('age-attestation-socket', {
      hashedIp,
      sessionId: socket.data.sessionId,
      ok: result.ok,
      code: result.code || 'ok',
    });
    if (!result.ok) {
      socket.emit('age-denied', {
        code: result.code,
        message:
          result.code === 'underage'
            ? 'Tilo is 18+ only. Access refused.'
            : 'Enter a valid date of birth (YYYY-MM-DD) and confirm you are 18+.',
      });
      if (result.code === 'underage') {
        compliance.safetyLog('underage-access-refused', { hashedIp, sessionId: socket.data.sessionId });
        compliance.addStrike(hashedIp, 'underage-attestation', false);
        socket.disconnect(true);
      }
      return;
    }
    socket.data.ageVerified = true;
    socket.data.ageRange = result.ageRange;
    socket.emit('age-ok', { ageRange: result.ageRange });
  });

  socket.on('find-partner', (data = {}) => {
    if (!withinEventLimit('find-partner', 5, 10_000)) {
      socket.emit('rate-limited');
      return;
    }
    if (!requireAge()) {
      console.log(`[match:${INSTANCE_ID}] find-partner rejected (age-required) ${socket.id.slice(0, 6)}`);
      return;
    }

    let mode = 'video';
    if (data && (data.mode === 'text' || data.mode === 'video')) mode = data.mode;

    // already paired? ignore
    if (partners.has(socket.id)) return;
    // already queued? update mode
    removeFromQueue(socket.id);

    console.log(`[match:${INSTANCE_ID}] find-partner ${socket.id.slice(0, 6)} mode=${mode} waitingBefore=${waitingQueue.length}`);
    const matched = tryMatch(socket.id, mode);
    if (!matched) enqueue(socket, mode);
    compliance.ictLog('find-partner', { hashedIp, sessionId: socket.data.sessionId, mode });
  });

  socket.on('leave', () => {
    if (!withinEventLimit('leave', 5, 10_000)) return;
    removeFromQueue(socket.id);
    unpair(socket.id, true);
    broadcastCount();
  });

  socket.on('next', (data = {}) => {
    if (!withinEventLimit('next', 5, 10_000)) {
      socket.emit('rate-limited');
      return;
    }
    if (!requireAge()) return;
    unpair(socket.id, true);
    removeFromQueue(socket.id);
    let mode = 'video';
    if (data && (data.mode === 'text' || data.mode === 'video')) mode = data.mode;
    const matched = tryMatch(socket.id, mode);
    if (!matched) enqueue(socket, mode);
  });

  socket.on('message', (data = {}) => {
    if (!withinEventLimit('message', 20, 10_000)) return;
    const partnerId = getPartner(socket.id);
    if (!partnerId) return;

    const text = sanitizeText(data?.text);
    if (!text) return;
    // Automated safety screen BEFORE relay (IT Rules "reasonable efforts",
    // DSA/OSA illegal-content duties). Decision metadata only — no content stored.
    const verdict = compliance.classifyText(text);
    if (verdict.verdict === 'block-critical') {
      const rec = compliance.fileReport({
        hashedIp,
        reason: 'child-safety',
        details: 'auto-flag: critical safety signal in text (metadata only, content not stored)',
        sessionId: socket.data.sessionId,
        mode: null,
      });
      const ban = compliance.addStrike(hashedIp, 'critical-text-signal', true);
      compliance.safetyLog('message-blocked-critical', {
        hashedIp,
        sessionId: socket.data.sessionId,
        category: verdict.category,
        ackId: rec.ackId,
      });
      socket.emit('message-blocked', {
        category: verdict.category,
        message: 'This message was blocked for safety. The chat was ended and the incident logged.',
        ackId: rec.ackId,
      });
      const partnerSock = io.sockets.sockets.get(partnerId);
      unpair(socket.id, true);
      removeFromQueue(socket.id);
      if (partnerSock) removeFromQueue(partnerId);
      socket.emit('partner-left');
      void ban;
      return;
    }
    if (verdict.verdict === 'block-high') {
      compliance.safetyLog('message-blocked-high', {
        hashedIp,
        sessionId: socket.data.sessionId,
        category: verdict.category,
      });
      if (verdict.category === 'sexual-explicit' || verdict.category === 'threat' || verdict.category === 'hate-harassment' || verdict.category === 'scam') {
        compliance.addStrike(hashedIp, `high-text-signal:${verdict.category}`, false);
      }
      socket.emit('message-blocked', {
        category: verdict.category,
        message:
          verdict.category === 'pii-contact' || verdict.category === 'pii-credentials'
            ? 'Blocked: never share phone numbers, emails, OTPs, bank or password details with strangers.'
            : verdict.category === 'offplatform-link'
              ? 'Blocked: sharing external contact links is not allowed (scam/grooming prevention).'
              : 'Blocked: this message violates Community Guidelines and was not sent.',
      });
      return;
    }
    // relay as opaque string; client escapes HTML
    io.to(partnerId).emit('message', { text, at: Date.now() });
    // echo ack not needed; sender renders locally
  });

  socket.on('typing', (data = {}) => {
    if (!withinEventLimit('typing', 15, 10_000)) return;
    const partnerId = getPartner(socket.id);
    if (!partnerId) return;
    io.to(partnerId).emit('typing', { isTyping: !!data?.isTyping });
  });

  // WebRTC signaling - only relay known, bounded browser data to a paired user.
  socket.on('webrtc-offer', (data) => {
    const p = getPartner(socket.id);
    if (!p || !data || !data.offer) return;
    if (!withinEventLimit('webrtc-signal', 30, 60_000) || !isValidDescription(data.offer, 'offer')) return;
    io.to(p).emit('webrtc-offer', { offer: data.offer });
  });

  socket.on('webrtc-answer', (data) => {
    const p = getPartner(socket.id);
    if (!p || !data || !data.answer) return;
    if (!withinEventLimit('webrtc-signal', 30, 60_000) || !isValidDescription(data.answer, 'answer')) return;
    io.to(p).emit('webrtc-answer', { answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    const p = getPartner(socket.id);
    if (!p || !data || !data.candidate) return;
    if (!withinEventLimit('webrtc-signal', 30, 60_000) || !isValidCandidate(data.candidate)) return;
    io.to(p).emit('ice-candidate', { candidate: data.candidate });
  });

  // One-tap Report with reason (DSA notice-and-action). Auto-attaches session
  // metadata, preserves 180d evidence hold, disconnects immediately.
  socket.on('report', (data = {}) => {
    if (!withinEventLimit('report', 3, 60_000)) return;
    const reason = typeof data?.reason === 'string' ? data.reason : 'other';
    const details = typeof data?.details === 'string' ? data.details : '';
    const partnerId = getPartner(socket.id);
    const partnerSock = partnerId ? io.sockets.sockets.get(partnerId) : null;
    const offenderHashed = partnerSock?.data?.hashedIp || null;
    const rec = compliance.fileReport({
      hashedIp,
      reason: [...compliance.REPORT_REASONS].includes(reason) ? reason : 'other',
      details,
      sessionId: socket.data.sessionId,
      mode: null,
    });
    // Strike the OFFENDER (not the reporter) for critical categories.
    if (offenderHashed && (rec.emergency || rec.reason === 'nudity-sexual' || rec.reason === 'harassment')) {
      compliance.addStrike(offenderHashed, `reported:${rec.reason}`, rec.emergency);
    }
    compliance.safetyLog('report-socket', {
      ackId: rec.ackId,
      reporter: hashedIp,
      offender: offenderHashed,
      reason: rec.reason,
      emergency: rec.emergency,
    });
    unpair(socket.id, true);
    removeFromQueue(socket.id);
    if (partnerId) removeFromQueue(partnerId);
    socket.emit('reported-ack', { ackId: rec.ackId, emergency: rec.emergency, sla: rec.sla });
  });

  // One-tap Block: prevents future rematch with this stranger (device/IP-hashed).
  socket.on('block', () => {
    if (!withinEventLimit('block', 5, 60_000)) return;
    const partnerId = getPartner(socket.id);
    const partnerSock = partnerId ? io.sockets.sockets.get(partnerId) : null;
    if (partnerSock?.data?.hashedIp) {
      recordBlock(hashedIp, partnerSock.data.hashedIp);
    }
    compliance.safetyLog('block', { hashedIp, sessionId: socket.data.sessionId });
    unpair(socket.id, true);
    removeFromQueue(socket.id);
    if (partnerId) removeFromQueue(partnerId);
    socket.emit('blocked-ack');
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    removeFromQueue(socket.id);
    unpair(socket.id, true);
    const socketCount = socketCountsByIp.get(socket.data.clientIp) || 0;
    if (socketCount <= 1) socketCountsByIp.delete(socket.data.clientIp);
    else socketCountsByIp.set(socket.data.clientIp, socketCount - 1);
    compliance.ictLog('socket-disconnect', { hashedIp, sessionId: socket.data.sessionId });
    broadcastCount();
  });
});

if (require.main === module) {
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    const c = compliance.config;
    console.log(`Tilo running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (${isProduction ? 'production' : 'development'}) instance=${INSTANCE_ID}`);
    console.log(`Contact: ${c.supportEmail} | consent ${c.consentVersion} | allowlist [${[...c.allowedCountries]}] blocklist [${[...c.blockedCountries]}] | ICT ${c.ictLogDays}d India`);
    console.log(`Proxy: TRUST_PROXY=${trustProxy ? '1' : '0'} TRUSTED_PROXY_IPS=${trustedProxyRanges.join(' ') || '(none)'}`);
    if (isProduction && !trustProxy) {
      console.log('WARN: behind Render/Railway/Fly you must set TRUST_PROXY=1 + TRUSTED_PROXY_IPS=private, or all clients share one IP and matching/rate-limits break.');
    }
    console.log(`Matching: in-memory queue (SINGLE INSTANCE REQUIRED). Scale to 1 instance on Render or matches split across processes. TURN=${String(process.env.TURN_URLS || '').trim() ? 'configured' : 'stun-only'}`);
  });
  const shutdown = (signal) => {
    console.log(`${signal} received — closing server (no new connections, sockets drain)...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, server, io, compliance, INSTANCE_ID };
