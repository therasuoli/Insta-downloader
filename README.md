# IG Saver — Instagram Downloader

A small self-hosted web app that downloads **public** Instagram videos, reels, IGTV and photos (including carousels). Paste a link, pick a quality, download.

- **Backend:** Node.js + Express, using [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) as the extractor
- **Frontend:** plain HTML/CSS/JS (no build step), responsive, dark-mode aware
- **Safety:** strict URL validation, media proxy restricted to Instagram CDN hosts (SSRF guard), rate limiting, Helmet CSP

## Requirements

- Node.js 18+
- `yt-dlp` available on `PATH` (`pip install -U yt-dlp`)

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Or with Docker:

```bash
docker build -t ig-saver .
docker run -p 3000:3000 ig-saver
```

## Configuration (env vars)

| Variable | Description |
| --- | --- |
| `PORT` | Server port (default `3000`) |
| `YTDLP_BIN` | Path to the `yt-dlp` binary (default `yt-dlp`) |
| `YTDLP_COOKIES` | Path to a cookies.txt file — often needed because Instagram rate-limits anonymous requests |
| `YTDLP_PROXY` | Proxy URL passed to yt-dlp (e.g. `http://user:pass@host:port`) |

## API

- `POST /api/info` — body `{ "url": "https://www.instagram.com/reel/XXXX/" }` → `{ items: [{ type, title, uploader, thumbnail, options: [{ label, ext, url }] }] }`
- `GET /api/download?url=<cdn-url>&ext=mp4&name=file` — streams the media as an attachment

## Notes

- Instagram frequently changes its internals and blocks anonymous scraping. Keep `yt-dlp` updated, and supply cookies/proxy if you see "rate-limited" errors.
- Only public posts work. Private content is not accessible.
- Downloading is for personal use or with the creator's permission. Respect copyright and Instagram's Terms of Use. This project is not affiliated with Instagram/Meta.

## License

MIT
