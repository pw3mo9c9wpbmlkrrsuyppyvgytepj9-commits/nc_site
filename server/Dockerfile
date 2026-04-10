FROM node:20-alpine
WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server ./
COPY Database /Database
COPY dashboard /dashboard
COPY css /css
COPY js /js
COPY assets /assets
COPY *.html /app/

EXPOSE 3001
CMD ["node", "index.js"]