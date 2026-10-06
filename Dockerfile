# Tilo — production image (Node 20 slim, non-root, health-checked)
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
RUN useradd -m -u 10001 tilo && mkdir -p /app/data /app/logs && chown -R tilo:tilo /app
COPY --from=deps /app/node_modules ./node_modules
COPY server.js package.json ./
COPY lib ./lib
COPY public ./public
USER tilo
EXPOSE 3000
# Container must set APP_ORIGIN (or ALLOWED_ORIGINS) to its public HTTPS origin,
# plus TRUST_PROXY/TRUSTED_PROXY_IPS when behind a proxy, and ALLOWED_COUNTRY_CODES=IN for V1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
