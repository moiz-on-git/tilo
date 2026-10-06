# Retention schedule (internal — exact numbers, env overrides)
# Public version: /legal/retention.html. This file is the engineering source of truth.

| data | default | env | basis | purge |
|---|---|---|---|---|
| Live media / relay text | no storage | — | minimisation | never written |
| Session ID / match state (memory) | socket lifetime | — | ops | on disconnect |
| ICT/security logs (hashed) | 180d rolling, India only | `ICT_LOG_DAYS=180` | CERT-In 2022 | `pruneOldLogs(logs/, 'ict-', 180)` daily + on write |
| Safety logs | 180d | `SAFETY_EVIDENCE_DAYS=180` | IT Rules + DSA/OSA audit | same, prefix `safety-` |
| Reports / moderation decisions | 180d | `REPORT_DAYS=180` | IT Rules removed-content preservation | hold-gated job (do NOT purge on legal hold) |
| Registration info post-cancellation | 180d | = report window | IT Rules | same |
| Legal-hold evidence | until release | — | court/order/counsel | manual release only, logged |
| Grievance/support | 3y | `GRIEVANCE_DAYS=1095` | consumer/tax audit | annual purge |
| Consent records | 3y post-withdrawal | `CONSENT_DAYS=1095` | proof of consent | same |
| Bans | expiry-based (24h×strikes; child-safety long hold) | `BAN_HOURS_DEFAULT=24`, `BAN_HOURS_CHILD_SAFETY=8760` | safety | `pruneBans()` on read |
| Payments | per tax law | finance-owned | RBI/tax | finance-gated |

Rules:
- Legal hold beats every timer. Holds are placed by counsel/child-safety lead, logged with reason + releaser.
- DSR erasure deletes non-exempt records and returns `recorded-legal-hold-applies` with the exempt categories listed.
- Server clocks sync to government NTP (deploy check: `chrony`/`ntpd` → `time.nplindia.org`/cloud NTP); retention windows are timestamped in UTC+IST audit logs.
- DPDP phased commencement: build for end-state now (full obligations + penalties from mid-May 2027); next internal milestone review 13 Nov 2026.
