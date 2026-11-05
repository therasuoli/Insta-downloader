FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
