---

# AI YouTube Thumbnail Generator

Embeddable **AI widget** that generates a more clickable YouTube thumbnail based on a public video.

The tool analyzes a video, generates a new thumbnail concept, and overlays optimized headline text designed for **higher CTR and modern YouTube style**.

Uses a **Cloudflare Worker** as a proxy for the **fal.ai image generation API**.

---

# Demo

Paste a YouTube video link → generate a new thumbnail concept instantly.

Features:

• AI-generated thumbnail
• automatic headline generation
• smart text placement
• YouTube-style preview card
• example video presets
• carousel of thumbnail ideas

---

# Repo structure

```
widget/
   thumbnail_widget_v2_carousel.html
   images (carousel examples)

worker/
   Cloudflare Worker proxy
   fal.ai queue API integration
```

---

# Features

### AI thumbnail generation

Generate a redesigned thumbnail using fal.ai image models.

### Smart headline overlay

If no custom text is provided the AI generates a short clickable headline.

### Text placement system

Supports:

• auto positioning
• top
• bottom

### Example video presets

Quick test buttons:

• Vlog
• Tech
• Tutorial
• Business
• Music

### Preview UI

Rendered inside a **YouTube-style card layout**.

### Idea carousel

Infinite scrolling gallery with example thumbnails.

---

# Requirements

Node.js 18+

Cloudflare account

fal.ai API key

---

# Worker setup

Install dependencies

```bash
cd worker
npm install
```

Set fal.ai key

```bash
wrangler secret put FAL_KEY
```

Run locally

```bash
wrangler dev
```

Deploy

```bash
wrangler deploy
```

---

# Widget setup

The widget is **pure HTML / CSS / JS** and can be embedded anywhere.

Works in:

• Webflow
• Tilda
• Framer
• WordPress
• static websites

Configure worker URL inside the widget:

```javascript
window.OC_THUMBNAIL_WORKER_BASE =
"https://your-worker-name.workers.dev";
```

---

# How it works

1️⃣ User pastes YouTube URL

2️⃣ Widget fetches video metadata via oEmbed

3️⃣ Worker sends request to fal.ai

4️⃣ AI generates new thumbnail

5️⃣ Widget overlays optimized text

6️⃣ Result is rendered in YouTube card preview

---

# Example workflow

```
Paste YouTube URL
↓
Analyze video
↓
Generate thumbnail
↓
Overlay headline
↓
Download / Copy / Open
```

---

# Deployment

Recommended deployment stack:

Frontend
→ GitHub Pages / Webflow / Static hosting

AI backend
→ Cloudflare Worker

Image generation
→ fal.ai

---

# Roadmap

Possible future improvements:

• multiple thumbnail variations
• AI text style generation
• face detection text placement
• CTR prediction model
• batch generation

---

# License

MIT License

---


