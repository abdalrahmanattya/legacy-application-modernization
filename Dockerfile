# Node 24.19.0 Alpine; refresh the digest deliberately with the Node 24 release.
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019

ENV NODE_ENV=production \
    ENVIRONMENT=container \
    DATABASE_SSL_CA_PATH=/app/certs/global-bundle.pem \
    ORDER_DB_PATH=/data/orders.sqlite \
    PORT=3000
WORKDIR /app
ARG RDS_CA_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit && npm cache clean --force
COPY app ./app
COPY scripts ./scripts
COPY migrations ./migrations
RUN mkdir -p /app/certs \
    && wget -qO /app/certs/global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && echo "${RDS_CA_SHA256}  /app/certs/global-bundle.pem" | sha256sum -c - \
    && chmod 0444 /app/certs/global-bundle.pem
# npm is build-time tooling only; remove the globally bundled npm tree from
# the runtime image so its transitive CLI dependencies are not shipped.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "app/baseline/server.js"]
