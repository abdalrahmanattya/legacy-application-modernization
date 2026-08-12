# Node 24.19.0 Bookworm slim; refresh the digest deliberately with the Node 24 release.
FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

ENV NODE_ENV=production \
    ENVIRONMENT=container \
    ORDER_DB_PATH=/data/orders.sqlite \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit && npm cache clean --force
COPY app ./app
COPY scripts/baseline ./scripts/baseline
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "app/baseline/server.js"]
