# DPIA + child-safety risk assessment (pre-launch, keep on file; review before EU/UK/US/AU/BR)
# Omegle-style = high-risk processing: strangers × minors risk × live audio/video × behavioural anti-abuse × IP/location signals.

## Necessity & proportionality
- Purpose: ephemeral 18+ random chat. Data minimised to hashed network signals + age-range + safety decisions. No recordings, no directory, no ads.
- Less-intrusive alternatives rejected: raw-IP storage (rejected — hashed), permanent transcripts (rejected), third-party analytics (rejected), self-declared checkbox age (rejected — DOB + server check).

## Risks → mitigations
| risk | level before | mitigation (shipped) | residual |
|---|---|---|---|
| Minor accesses adult anonymous chat | Critical | DOB gate server-enforced, underage disconnect + logged, 18+ everywhere in copy, no parental-consent path (refuse) | High — requires ongoing age-assurance upgrade (ID/facial estimation) before video scale |
| Grooming / CSAM / sextortion live | Critical | Critical-signal text screen + instant disconnect + hold + NCMEC/POCSO escalation, human review, hash-matching readiness | High — live video needs frame-level nudity detection before open video launch; recommend text-only V1 |
| Harassment / threats / doxxing | High | High-tier filters (PII/link/sexual/threat), one-tap report/block, strikes + bans, 2h emergency SLA | Medium |
| Mass scraping / bots / ban evasion | High | Handshake quotas, per-IP socket caps, event windows, block-graph rematch prevention | Medium |
| Cross-border over-collection | High | India-region hosting, SCC/IDTA-ready DPAs, 180d rotation, geo allow-list (451 for uncleared regions) | Medium |
| App-store rejection (Apple random-chat ban; Play age-restriction) | High | Web + Android first, iOS only if redesigned; Play Child Safety Standards + contact point completed | Medium-High |

## Decision
- **V1: text-only, 18+, India allow-list, human moderation on every critical hit.** Video only after frame moderation + age-assurance upgrade + counsel sign-off.
- Re-run this DPIA before EU (GDPR Art.35), UK (Age Appropriate Design Code + OSA risk assessments), US state launches, AU (16-minimum analysis), BR (LGPD best-interests test).
