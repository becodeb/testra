# Imagen de la aplicación completa: Astro sobre Node más el servidor de
# WebSockets de las tomas en vivo. Reemplaza al Worker de Cloudflare y al proxy
# Caddy que Coolify publicaba antes.
#
# Se usa la variante slim (Debian) y no alpine porque sharp —el optimizador de
# imágenes que Astro necesita al construir— tiene binarios más confiables
# contra glibc que contra musl.

FROM node:22.12-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22.12-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# `dist/server` y `dist/client` los produce Astro; `dist/ws-upgrade.mjs` es el
# bundle aparte del upgrade de WebSocket (ver src/server/ws-upgrade.ts).
COPY --from=build /app/dist ./dist
# Las migraciones viajan en la imagen: `npm start` las aplica antes de escuchar.
COPY --from=build /app/drizzle ./drizzle
COPY server.mjs ./server.mjs
COPY scripts/migrate.mjs ./scripts/migrate.mjs

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
