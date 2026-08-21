FROM caddy:2-alpine

RUN printf '%s\n' \
  ':80 {' \
  '  encode zstd gzip' \
  '  reverse_proxy https://testra.testra-becode.workers.dev {' \
  '    header_up Host testra.testra-becode.workers.dev' \
  '    header_up X-Forwarded-Host {host}' \
  '    header_up X-Forwarded-Proto https' \
  '  }' \
  '}' > /etc/caddy/Caddyfile

EXPOSE 80
