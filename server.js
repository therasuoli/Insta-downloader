"use strict";

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";
const YTDLP_TIMEOUT_MS = 30_000;

// Hosts we accept as "Instagram post" links.
const IG_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
// Hosts Instagram serves media from. The proxy only fetches from these (SSRF guard).
const MEDIA_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: "4kb" }));
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please wait a minute." },
});
app.use("/api/", apiLimiter);

/** Validate and normalise an Instagram post URL. Returns a URL string or null. */
function parseInstagramUrl(input) {
  if (typeof input !== "string") return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!IG_HOSTS.has(url.hostname.toLowerCase())) return null;
  // Only post-like paths: /p/…, /reel/…, /reels/…, /tv/…, /<user>/p/…, /<user>/reel/…
  if (!/^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/[\w-]+/i.test(url.pathname)) return null;
  return `https://www.instagram.com${url.pathname}`;
}

function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return MEDIA_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

/** Run yt-dlp -J and resolve with the parsed JSON metadata. */
function fetchMetadata(url) {
  return new Promise((resolve, reject) => {
    const args = ["-J", "--no-warnings", "--no-playlist", "--skip-download", url];
    if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
    if (process.env.YTDLP_PROXY) args.push("--proxy", process.env.YTDLP_PROXY);

    const child = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Object.assign(new Error("Timed out while fetching the post."), { status: 504 }));
    }, YTDLP_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      const msg =
        e.code === "ENOENT"
          ? "yt-dlp is not installed on the server."
          : `Failed to start yt-dlp: ${e.message}`;
      reject(Object.assign(new Error(msg), { status: 500 }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const lower = err.toLowerCase();
        let msg = "Could not fetch this post. It may be private, deleted, or rate-limited.";
        if (lower.includes("login") || lower.includes("private")) {
          msg = "This post is private or requires login.";
        } else if (lower.includes("not found") || lower.includes("404")) {
          msg = "Post not found.";
        }
        return reject(Object.assign(new Error(msg), { status: 422 }));
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(Object.assign(new Error("Unexpected response from extractor."), { status: 502 }));
      }
    });
  });
}

/** Convert a yt-dlp entry into a simple item the frontend can render. */
function toItem(entry) {
  const formats = (entry.formats || []).filter((f) => f.url && isAllowedMediaUrl(f.url));
  const videoFormats = formats
    .filter((f) => f.vcodec && f.vcodec !== "none")
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));

  const isVideo = videoFormats.length > 0;
  const options = [];
  if (isVideo) {
    const seen = new Set();
    for (const f of videoFormats) {
      const label = f.height ? `${f.height}p` : f.format_note || "video";
      if (seen.has(label)) continue;
      seen.add(label);
      options.push({ label, ext: f.ext || "mp4", url: f.url });
    }
  } else if (entry.url && isAllowedMediaUrl(entry.url)) {
    options.push({ label: "Original", ext: entry.ext || "jpg", url: entry.url });
  } else {
    const thumbs = (entry.thumbnails || [])
      .filter((t) => t.url && isAllowedMediaUrl(t.url))
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    if (thumbs[0]) options.push({ label: "Original", ext: "jpg", url: thumbs[0].url });
  }

  return {
    id: entry.id,
    type: isVideo ? "video" : "image",
    title: (entry.title || entry.description || "").toString().slice(0, 140),
    uploader: entry.uploader || entry.channel || "",
    thumbnail:
      (entry.thumbnail && isAllowedMediaUrl(entry.thumbnail) && entry.thumbnail) ||
      (entry.thumbnails || []).map((t) => t.url).find(isAllowedMediaUrl) ||
      null,
    duration: entry.duration || null,
    options,
  };
}

app.post("/api/info", async (req, res) => {
  const url = parseInstagramUrl(req.body && req.body.url);
  if (!url) {
    return res.status(400).json({
      error: "Please paste a valid Instagram post, reel or IGTV link.",
    });
  }
  try {
    const meta = await fetchMetadata(url);
    const entries = Array.isArray(meta.entries) && meta.entries.length ? meta.entries : [meta];
    const items = entries.map(toItem).filter((i) => i.options.length > 0);
    if (!items.length) {
      return res.status(422).json({ error: "No downloadable media found in this post." });
    }
    res.json({ source: url, items });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Streams the media file through our server so the browser downloads it with a
// proper filename (cross-origin <a download> is ignored by browsers).
app.get("/api/download", async (req, res) => {
  const target = String(req.query.url || "");
  if (!isAllowedMediaUrl(target)) {
    return res.status(400).json({ error: "Invalid media URL." });
  }
  const ext = /^[a-z0-9]{2,5}$/i.test(String(req.query.ext || "")) ? req.query.ext : "mp4";
  const base = String(req.query.name || "instagram").replace(/[^\w.-]+/g, "_").slice(0, 60);

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ig-downloader)" },
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: "Upstream media request failed." });
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Content-Disposition", `attachment; filename="${base}.${ext}"`);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((r) => res.once("drain", r));
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: "Download failed." });
    else res.destroy();
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Instagram downloader running on http://localhost:${PORT}`));
}

module.exports = { app, parseInstagramUrl, isAllowedMediaUrl };
