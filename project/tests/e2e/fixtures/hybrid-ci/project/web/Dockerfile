FROM nginx:1.28-alpine
RUN touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    && chown -R nginx:nginx /var/cache/nginx
COPY index.html /usr/share/nginx/html/index.html
USER 101:101
HEALTHCHECK --interval=2s --timeout=2s --retries=15 CMD ["wget", "-qO-", "http://127.0.0.1/"]
