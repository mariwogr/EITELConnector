FROM nginx:1.27-alpine

RUN apk add --no-cache bash gettext

WORKDIR /usr/share/nginx/html

COPY public/ ./
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-generate-config.sh

RUN chmod +x /docker-entrypoint.d/40-generate-config.sh
