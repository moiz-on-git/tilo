# Incident response plan (CERT-In 6h + DPDP/GDPR breach duties)
# Owner: security engineer + Trust & Safety. Test quarterly (tabletop + live drill).

## Severity matrix
| level | examples | response |
|---|---|---|
| Low | single spam account | auto-throttle, log |
| Medium | automated abuse wave | rate-limit tighten, review, transparency count |
| High | account takeover pattern, PII leak (hashed logs exposed) | incident commander, isolate, preserve, CERT-In assess |
| Critical | large personal-data exposure, mass session/IP leak, CSAM exposure, breach of safety logs | CERT-In ≤6h, Board + affected users per DPDP, GDPR 72h authority notice where in scope, NCMEC/authorities for CSAE |

## 6-hour CERT-In clock (cyber incidents incl. breach/leak)
1. **0–30m:** detect → declare → page incident commander, freeze deploys, snapshot logs (no deletion).
2. **30m–2h:** scope (what hashed data? how many? which region?), contain (revoke keys, block vectors), preserve evidence.
3. **2–6h:** file CERT-In report (format per directions), sync clocks/NTP evidence, notify cloud vendor.
4. **≤72h / DPDP timelines:** notify Data Protection Board + affected users with facts, risks, mitigations, contacts. EU in scope → supervisory authority ≤72h unless unlikely risk.
5. Post-mortem ≤7d: root cause, retention/log gaps, filter misses, red-team update. Feed transparency report.

## Contacts (configure via env)
- Grievance: `GRIEVANCE_EMAIL` · DPO: `DPO_EMAIL` · Child safety: `CHILD_SAFETY_EMAIL` · Law enforcement: `LAW_ENFORCEMENT_EMAIL`
- CERT-In: per published reporting channel (verify current before launch) · NCMEC CyberTipline (US-apparent CSAM) · Local police / POCSO route (India)

## Evidence rules
- Never view CSAM beyond need-to-know; hash-match, preserve, report — do not download/share internally.
- Keep ICT logs 180d in India; do not purge during an incident (legal hold).
- Every action timestamped (NTP-synced) and appended to `logs/safety-*` + incident file.
