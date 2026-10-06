# Tilo launch compliance — gate, per-country matrix, team, store strategy
# Guidance, not legal advice. Researched Oct 2026 (see sources in docs/). Counsel must sign each Tier before launch.
# Single contact for ALL regions: tiloappcomplaints@protonmail.com — subjects [SUPPORT] [PRIVACY] [GRIEVANCE] [CHILD-SAFETY] [LAW-ENFORCEMENT]

## Launch gate (all must be ✅ tested, not just published)
- [ ] Privacy / Terms / Guidelines / Child Safety / Moderation / Reporting&Appeals / Grievance / Law-Enforcement / Retention / Cookies published + linked in footer
- [ ] Grievance Officer published (`GRIEVANCE_NAME`, tiloappcomplaints@protonmail.com, India) + in-app Privacy contact
- [ ] DOB 18+ gate server-enforced (`attest-age` + `/api/age-attest` tested; underage refused + logged)
- [ ] Itemised consent + one-tap withdraw (`/api/consent`, version `CONSENT_VERSION`)
- [ ] Report (11 reasons) + Block + Next/Leave one-tap; ackIds + SLAs (24h ack / 7d resolve / GAC 30d / 36h illegal / 2h emergency / 3h govt takedown / 48h NCII)
- [ ] Text safety screen (critical→disconnect+hold+authority path; high→block+warn+strike) tested with red-team phrases
- [ ] Evidence hold 180d + ICT logs 180d India + NTP (NIC/NPL) sync verified
- [ ] DSR export/delete (`/api/data-export`, `/api/data-delete`) tested; DPDP 90-day rights workflow documented
- [ ] Vendor DPAs signed; sub-processor list published; no raw chat to AI/analytics
- [ ] CERT-In 6h (`incident@cert-in.org.in` / 1800-11-4949) + breach playbook drilled (DPDP Board+users 72h track; GDPR 72h)
- [ ] DPIA + child-safety assessment filed (`docs/dpia.md`)
- [ ] Geo allow-list set (`ALLOWED_COUNTRY_CODES=IN` for V1); uncleared regions get 451
- [ ] Transparency endpoint (`/api/transparency`) + monthly-report template ready
- [ ] Pentest + abuse red-team passed; rate limits verified (`npm test`)
- [ ] Play Child Safety declaration + contact point; iOS strategy confirmed (see below)
- [ ] Brand cleared as Tilo; run trademark clearance on "Tilo" before store submission

## Per-country matrix (researched Oct 2026 — verify with counsel at launch)
| region | status | law / gate | what Tilo does about it |
|---|---|---|---|
| IN (India) | Tier A — launch | DPDP Act 2023 + Rules notified 13/14-Nov-2025; phased: Board now, consent-managers Nov-2026, substantive duties ~13-May-2027; IT Rules 2021 as amended Feb-2026 (ack 24h / resolve 7d / GAC 30d / illegal 36h / nudity 2h / govt 3h); CERT-In 6h + 180d logs + NTP; POCSO mandatory reporting; RBI payment-data-in-India | Shipped: DOB 18+ gate, itemised consent, 180d India logs, report/block, grievance SLA, POCSO→authorities path |
| EU/EEA | Tier B — blocked until ready | GDPR (consent/basis, 72h breach, DPIA Art.35, Art.27 EU representative) + DSA (Art.16 notice-action, Art.22 trusted flaggers, Art.28 minors protection; Jul-2025 minors guidelines + age-verification blueprint) | Needs: EU representative, DPIA sign-off, SCCs, DSA transparency + trusted-flagger intake, age-verification upgrade. Keep out of allow-list until done |
| UK | Tier B — blocked | UK GDPR + Age Appropriate Design Code + Online Safety Act: children's + illegal-content risk assessments, HEAA (highly effective age assurance — checkbox/DOB self-declaration and debit-card checks are NOT enough), swift removal, Ofcom enforcement | Needs: HEAA vendor (photo-ID/open-banking grade), risk assessments, UK representative. DOB gate alone fails UK — stay geo-blocked |
| US | Tier B — blocked | COPPA (<13, verifiable parental consent), FTC NGL precedent (Jul-2024: $5M, under-18 ban for anonymous messaging, neutral age gate), state age-verification laws, 18 USC §2258A NCMEC CyberTipline duty, TAKE IT DOWN Act (FTC enforcing from May-2026, 48h NCII removal), BIPA for face age-estimation, CCPA/CPRA rights | Needs: state-by-state matrix, NCMEC reporting integration, 48h NCII lane, neutral age gate audit, biometric consent for face estimation |
| AU | Tier B — blocked | Online Safety Act + eSafety; social-media minimum age 16 from 10-Dec-2025 (up to ~$49.5M penalties; 4.7M accounts removed Dec-2025); messaging/voice/video-calling exclusions exist but random-stranger chat is assessed case-by-case and eSafety monitors migration to alternative apps | Needs: 16+ (18+ here exceeds it, good) + eligibility proof acceptable to eSafety + counsel opinion that random video-chat is/isn't age-restricted; stay blocked until written opinion |
| BR | Tier B — blocked | LGPD (best-interests of child/adolescent, specific+highlighted parental consent for children ≤11) + ANPD Res.19/2024 transfers (SCCs/BCRs; EU↔BR adequacy Jan-2026) + breach ~3 business days; ANPD fined TikTok BRL153.7M (Aug-2026) over children's data | Needs: LGPD DPIA, ANPD SCCs, DPO, 3-day breach lane, age-verification effectiveness proof |
| Other | Tier C — blocked | Local law varies; store rules may independently bar the category | Default-deny via allow-list (451 + Terms notice) |

## Product posture (V1 sane default)
18+ only · anonymous-to-others · no profiles/directory · no default recording · strong report/block · sexual-content prohibition · minimal analytics · short-lived sessions · hashed 180d safety logs · human moderation · India-first · web first, Android after Play clearance, iOS only if redesigned.

## App stores (category is hostile — plan distribution first)
- **Apple (6-Feb-2026 clarification, §1.2 UGC):** random/anonymous chat "does not belong on the App Store and may be removed without notice". Pure-Omegle iOS = very high rejection risk.
- **Google Play (26-Aug-2026, developer verification 30-Sep-2026):** anonymous/random chat = age-restricted + Child Safety Standards self-certifications (published CSAE ban, CSAM→NCMEC/regional reporting) + Play Console minor-blocking + Families Policy (no targeting children).

## Minimum team
1 India tech/privacy lawyer · 1 child-safety/moderation specialist · 1 security engineer/firm · 1 Trust & Safety owner (+ local counsel per Tier-B region). Sole inbox triages via subject tags until hires land.

## Env (see .env.example)
Single inbox: `SUPPORT/GRIEVANCE/DPO/CHILD_SAFETY/LAW_ENFORCEMENT = tiloappcomplaints@protonmail.com` · `CONSENT_VERSION` · `ALLOWED/BLOCKED_COUNTRY_CODES` · `ICT/SAFETY/REPORT_DAYS` · `DATA/LOG_DIR` · `LOG_IP_SALT`
