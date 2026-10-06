# Tilo — 18+ anonymous ephemeral chat (text + video)

Compliance-first build: DPDP 2023 + DPDP Rules 2025, IT Act + Intermediary Rules 2021,
CERT-In 2022, POCSO/BNS, with GDPR/DSA, UK OSA, COPPA/NCMEC, AU, BR hooks.
See `COMPLIANCE.md` (launch gate + Tier A/B/C), `docs/` (data map, DPIA, playbooks),
`public/legal/` (10 published policies), `.env.example` (all compliance config).

Quick start: copy `.env.example` to `.env`, set `APP_ORIGIN`, and keep
`ALLOWED_COUNTRY_CODES=IN` for India-only V1. Single inbox for all regions:
**tiloappcomplaints@protonmail.com** (subjects `[SUPPORT] [PRIVACY] [GRIEVANCE] [CHILD-SAFETY] [LAW-ENFORCEMENT]`).
Legal pages live at
`/legal/{privacy,terms,community-guidelines,child-safety,moderation,reporting-appeals,grievance,law-enforcement,retention,cookies}.html`.
APIs: `POST /api/age-attest|/api/consent|/api/report|/api/grievance|/api/block|/api/data-delete`,
`GET /api/data-export|/api/compliance/status|/api/transparency|/health`.

## Deploy (ready)

**Docker (recommended):**
```bash
docker build -t tilo .
docker run -d --name tilo --restart unless-stopped -p 3000:3000 \
  -e NODE_ENV=production -e PORT=3000 \
  -e APP_ORIGIN=https://chat.yourdomain.com \
  -e TRUST_PROXY=1 -e TRUSTED_PROXY_IPS=172.17.0.0/16 \
  -e ALLOWED_COUNTRY_CODES=IN \
  -v tilo-data:/app/data -v tilo-logs:/app/logs \
  tilo
curl https://chat.yourdomain.com/health
```

**VPS + Nginx + HTTPS:** point DNS at the VPS, terminate TLS in Nginx
(Certbot), proxy to `127.0.0.1:3000` with the `X-Forwarded-For $remote_addr`
pattern below, run `node server.js` under systemd/PM2 with the `.env` from
`.env.example`. Pin hosting + `data/`/`logs/` to an **India region** (CERT-In
180d logs stay in India), NTP-sync the host (NIC/NPL), and forward
`CF-IPCountry`/`X-Country-Code` from your CDN for geo gating.

**Render/Railway/Fly:** set env from `.env.example` in the dashboard
(`APP_ORIGIN` = public HTTPS URL, `TRUST_PROXY=1`, proxy IPs from provider,
`ALLOWED_COUNTRY_CODES=IN`), persistent disk for `/app/data` + `/app/logs`,
health check `GET /health`. Non-allow-listed countries get HTTP 451 by design.

## Reverse proxy deployment

Only enable proxy forwarding when the Node server is reachable exclusively through
known reverse proxies. Set `TRUST_PROXY=1` and set `TRUSTED_PROXY_IPS` to a
comma-separated allowlist of their source IPs or CIDRs (for example,
`127.0.0.1,::1`). The server refuses to start with `TRUST_PROXY=1` without this
allowlist.

The proxy must discard a request's incoming `X-Forwarded-For` value and write one
canonical client IP instead of appending to it. For an Nginx proxy that directly
receives client traffic:

```nginx
location / {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_pass http://127.0.0.1:3000;
}
```

If a load balancer or CDN sits in front of Nginx, configure Nginx to trust that
upstream before using its forwarded client address. Do not expose the Node server
directly to the internet when proxy forwarding is enabled.
