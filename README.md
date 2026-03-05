# AI YouTube Thumbnail Generator (Widget + Cloudflare Worker)

Embeddable widget (pure HTML/CSS/JS) that generates a YouTube thumbnail themed around a public YouTube video.
Uses a Cloudflare Worker as a proxy to fal.ai.

## Repo structure
- `widget/` — standalone embeddable widget (Webflow embed-friendly)
- `worker/` — Cloudflare Worker proxy (fal.ai queue API)

## Requirements
- Node.js 18+
- Cloudflare account + Wrangler
- fal.ai API key

## Worker setup

```bash
cd worker
npm i
