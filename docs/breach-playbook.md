# Breach playbook (DPDP + GDPR 72h + CERT-In 6h — one page for the on-call)
1. **Confirm:** is it a personal-data breach (hashed IPs linkable? reports/grievances exposed?) or a safety incident (CSAM exposure)? Both clocks may run.
2. **Contain:** rotate secrets/salts only if compromise proven (note: rotating IP salt breaks ban correlation — counsel must approve); block vector; snapshot `logs/` + `data/` (read-only copy).
3. **Classify:** High/Critical → commander + counsel + child-safety lead (if minors possibly involved).
4. **Notify:**
   - CERT-In ≤6h (breach/leak-type incidents).
   - Data Protection Board + affected users per DPDP timelines (describe: what, how many, consequences, mitigation, contact).
   - EU/UK in scope → authority ≤72h after awareness (unless unlikely risk); users without undue delay if high risk.
   - California: AG/consumer notice per thresholds. Document everything for `GET /api/transparency`.
5. **Do NOT:** pay ransom without counsel, delete logs, or promise “untraceable/zero-data” publicly — the architecture retains hashed safety logs by design.
6. **Close:** post-mortem, DPIA update, filter/log fix, red-team retest, user notice archive.
