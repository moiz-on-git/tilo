# Law-enforcement playbook (internal — verify, minimise, log)
1. **Receive** at tiloappcomplaints@protonmail.com subject `[LAW-ENFORCEMENT]` only. Check sender domain, badge/case ID, legal basis (§69 direction / court order / MLAT / emergency facts).
2. **Validate** with counsel before any disclosure. Reject fishing (no bulk, no “all users in X city”).
3. **Scope:** hashed metadata + report/moderation records in retention only. State explicitly what does NOT exist (no transcripts/recordings by default).
4. **Hold:** place legal hold (no purge) on matching records; log hold reason/expiry/releaser.
5. **Produce:** minimal set, encrypted transfer, receipt logged. Notify user unless barred (gag / POCSO sensitivity / NCMEC secrecy).
6. **SLAs (IT Rules Feb-2026):** emergency (imminent harm/ongoing exploitation) immediate; govt/court takedown 3h; illegal-content removals 36h; IT-Rules complaint categories (nudity/impersonation) 2h.
7. Log every step to `logs/safety-*` + transparency counters (no personal data in transparency aggregates).
