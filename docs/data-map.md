# Tilo — data map (field → purpose → basis → processor → storage → retention → deletion)
# One row per field. DPDP purpose-limitation + minimisation evidence. Review quarterly.

| field | purpose | legal basis (IN / EU) | processor / recipient | storage (region) | retention | deletion mechanism |
|---|---|---|---|---|---|---|
| DOB input (raw) | 18+ eligibility check only | Consent + legal obligation (child protection) / Art.6(1)(c) | Browser → app server (validated, NOT persisted) | Memory only, India host | Session only, never written to disk | Discarded after verification; only age-range retained in log |
| age-range (18-24 / 25+) + attestation result | Prove gate was enforced | Legal obligation | App logs | logs/ict-*.log (India) | 180d rolling | Log rotation purge (`pruneOldLogs`) |
| consent decision + version + purposes | Prove DPDP/GDPR consent, honour withdrawal | Consent record | App data store | data/consents.jsonl (India) | 3y after withdrawal | DSR erasure queue (legal-hold exempt) |
| hashed IP (SHA256+salt) + session ID + timestamps + match events | Abuse prevention, rate limits, CERT-In logs, lawful correlation | Legitimate interest + legal obligation | App logs | logs/ict-*.log (India) | 180d rolling | Rotation purge; clocks synced to govt NTP |
| chat text in transit | Deliver the chat the user requested | Contract / consent | Ephemeral relay (memory) | Memory only | Not stored (blocked msgs: decision metadata only) | Never persisted |
| WebRTC offer/answer/ICE (bounded, validated) | Establish P2P media | Contract | Relayed to paired peer only | Memory only | Not stored | Discarded after relay |
| report (reason, ackId, session metadata, optional 500-char details) | Moderation, IT-Rules preservation, POCSO/NCMEC reporting | Legal obligation | Safety store + human reviewers + authorities where required | data/reports.jsonl + logs/safety-*.log (India) | 180d min, legal hold overrides | Hold-gated purge; see retention-schedule.md |
| grievance (category, description, contact) | IT-Rules/DPDP redressal (24h ack / 7d resolve / GAC 30d / 2h emergency) | Legal obligation | Grievance Officer (tiloappcomplaints@protonmail.com) | data/grievances.jsonl (India) | 3y | DSR-exempt audit trail, then purge |
| block (blockerHashed → blockedHashed) | Prevent rematch (both directions) | Legitimate interest (safety) | App memory + store | Memory + data/blocks.jsonl | Duration of ban + audit tail | Expire + purge |
| ban (hashedIp → strikes, until, reason) | Repeat-offender enforcement | Legal obligation + legitimate interest | App store | data/bans.json | Until expiry (default 24h×strikes; child-safety long hold) | Auto-expire (`pruneBans`) |
| DSR request (access/erasure) | DPDP/GDPR/CCPA rights | Legal obligation | Privacy contact | data/dsr.jsonl | 3y (proof of handling) | Audit retention, then purge |
| payment receipt (if monetised) | Tax/consumer proof | Legal obligation | Store/processor + accounts | Accounts (India; RBI: payment data only in India) | Per tax law (8+y typical) | Finance-gated purge |

Flow: `User → App (India region) → CDN/WAF → Realtime server → TURN/STUN (metadata only) → DB/logs (India) → moderation/human (DPA) → authorities (lawful only)`.
Every arrow answers: what / why / where / controller-vs-processor / how long / which contract (see vendor-dpas.md).
Never send raw conversations to analytics/AI vendors. Moderation is `realtime → classify → retain decision metadata`, not `record everything`.
