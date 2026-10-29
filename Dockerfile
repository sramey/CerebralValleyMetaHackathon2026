# Single-container production image (ADR 0014): one Node process serves the built client and the
# WebSocket on $PORT. Put HTTPS (a platform proxy) in front; the client uses wss:// automatically.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 TRUST_PROXY=1 DATA_DIR=data
# data/ holds saved share-link worlds and the day's spend counters: mount a volume here to keep them.
RUN mkdir -p data logs public/art/gen && chown -R node:node data logs public/art/gen
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
