# Vendor register + DPA requirements (fiduciary liable for processors — contracts before launch)
# Add every vendor that touches personal data. No raw conversations to AI/analytics vendors.

| vendor | data received | country | role | contract status | notes |
|---|---|---|---|---|---|
| Cloud host (e.g., AWS Mumbai / GCP Mumbai) | logs, reports, hashed IDs | IN | Processor | ☐ DPA signed | India region pinned; 180d rotation |
| CDN/WAF (e.g., Cloudflare) | IP, timestamps, country header | varies | Processor | ☐ DPA + SCC where EU in scope | Provides `CF-IPCountry` for geo gating |
| RTC/STUN (e.g., Google STUN / own TURN) | connection metadata (no media stored) | varies | Processor | ☐ DPA | Prefer own TURN in India for V1 |
| Moderation (e.g., Hive / Rekognition / PhotoDNA) | reported snippets only on escalation | per vendor | Processor | ☐ DPA, no training reuse | `classify → metadata`, never bulk transcripts |
| Analytics | NONE by default | — | — | — | Do not add pixels without DPIA update + consent bump |
| Crash reporting | minimal diagnostics, no chat content | per vendor | Processor | ☐ DPA | Scrub IPs/PII before send |
| Payments (stores/processor) | billing receipts only | IN (RBI: payment data only in India) | Processor | ☐ DPA + PCI scope doc | E-commerce/consumer terms linked |
| Support desk | tickets users send | per vendor | Processor | ☐ DPA | 3y retention |

DPA must cover: subject matter/duration, data minimisation, India/EU transfer safeguards (SCCs/IDTA), sub-processors list, security (encryption, masking, access control, monitoring, backups), breach notice (support our 6h/72h clocks), audit rights, deletion on exit, no training on our data.
Publish the sub-processor list (Privacy §5) and update on change + 14d notice.
