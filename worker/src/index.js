export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- CORS ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- Helpers ---
    const json = (data, status = 200, extraHeaders = {}) =>
      new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
      });

    const bad = (message, details = null, status = 400) =>
      json({ ok: false, error: message, details }, status);
    const isYouTubeHost = (h) =>
  ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(h);

    const extractYouTubeId = (raw) => {
      try {
        const u = new URL(raw);
        if (!isYouTubeHost(u.hostname)) return null;

        // youtu.be/<id>
        if (u.hostname === "youtu.be") {
          const id = u.pathname.split("/").filter(Boolean)[0];
          return id || null;
        }

        // /watch?v=<id>
        const v = u.searchParams.get("v");
        if (v) return v;

        // /shorts/<id>
        const mShorts = u.pathname.match(/^\/shorts\/([^/]+)/);
        if (mShorts) return mShorts[1];

        // /embed/<id>
        const mEmbed = u.pathname.match(/^\/embed\/([^/]+)/);
        if (mEmbed) return mEmbed[1];

        return null;
      } catch {
        return null;
      }
    };

    const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        const FAL_KEY = env.FAL_KEY;
        // Full model path, used for submit + status + result in Queue API.
        // Example: "fal-ai/flux/dev/image-to-image"
        const FAL_MODEL = env.FAL_MODEL || "fal-ai/flux/dev/image-to-image";

        if (!FAL_KEY) {
          return bad("Missing FAL_KEY secret in Worker environment.", "Add it in Cloudflare Worker -> Settings -> Variables -> Secrets.");
        }
        if (!FAL_MODEL || typeof FAL_MODEL !== "string" || !FAL_MODEL.includes("/")) {
          return bad("Bad FAL_MODEL value.", { FAL_MODEL });
        }

        const falFetch = async (path, init = {}) => {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 25000);

            let r, text;
            try {
              r = await fetch(`https://queue.fal.run/${path}`, {
                ...init,
                signal: controller.signal,
                headers: {
                  "Authorization": `Key ${FAL_KEY}`,
                  "X-Fal-Key": FAL_KEY,
                  ...(init.headers || {}),
                },
              });
              text = await r.text();
            } catch (e) {
              clearTimeout(t);
              return { ok: false, status: 0, text: String(e), data: null };
            } finally {
              clearTimeout(t);
            }

            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch (_) {}

            return { ok: r.ok, status: r.status, text, data };
          };

          const classifyFalError = (resp) => {
            const msg =
              resp?.data?.detail ||
              resp?.data?.message ||
              (typeof resp?.data === "string" ? resp.data : null) ||
              resp?.text ||
              "";

            const s = resp?.status;

            if (s === 401) return { code: "FAL_INVALID_TOKEN", message: "fal.ai: invalid token", raw: msg };
            if (s === 403 && /Exhausted balance|locked/i.test(msg)) return { code: "FAL_NO_BALANCE", message: "fal.ai: баланс закончился (billing)", raw: msg };
            if (s === 429) return { code: "FAL_RATE_LIMIT", message: "fal.ai: rate limit, попробуй позже", raw: msg };
            if (s === 404) return { code: "FAL_NOT_FOUND", message: "fal.ai: модель/эндпоинт не найден", raw: msg };
            if (s >= 500) return { code: "FAL_UPSTREAM", message: "fal.ai: временная ошибка сервиса", raw: msg };

            return { code: "FAL_ERROR", message: "fal.ai: ошибка запроса", raw: msg };
          };

    // --- Routes ---
    if (url.pathname === "/" || url.pathname === "/api" || url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "oc-thumbnail-worker",
        model: FAL_MODEL,
        routes: {
          oembed: "GET  /api/oembed?url=YOUTUBE_URL",
          submit: "POST /api/generate",
          status: "GET  /api/status?id=REQUEST_ID  (or rid=...)",
          result: "GET  /api/result?id=REQUEST_ID  (or rid=...)",
        },
      });
    }

    // YouTube oEmbed (safe to call from browser)
    if (url.pathname === "/api/oembed" && request.method === "GET") {
      const yt = url.searchParams.get("url");
      if (!yt) return bad("Missing query param: url");

      const id = extractYouTubeId(yt);
      if (!id) {
        return bad("Not a YouTube URL or cannot extract video id.", { url: yt });
      }

      // Канонический URL — oEmbed любит его больше
      const canonical = `https://www.youtube.com/watch?v=${id}`;
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`;

      // 1) Try oEmbed
      try {
        const r = await fetch(oembedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
          },
        });

        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) {}

        if (r.ok && data) {
          return json({
            ok: true,
            source: "oembed",
            video_id: id,
            canonical_url: canonical,
            title: data.title ?? null,
            author_name: data.author_name ?? null,
            thumbnail_url: data.thumbnail_url ?? ytThumb(id),
            raw: data,
          });
        }
      } catch (_) {
        // ignore and fallback
      }

      // 2) Fallback (never fails)
      return json({
        ok: true,
        source: "fallback",
        video_id: id,
        canonical_url: canonical,
        title: null,
        author_name: null,
        thumbnail_url: ytThumb(id),
      });
}

    // Submit generation job
    if (url.pathname === "/api/generate" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return bad("Invalid JSON body.");
      }

      const {
        image_url,          // required
        prompt,             // required
        strength = 0.95,
        num_inference_steps = 40,
        guidance_scale = 3.5,
        output_format = "png",
        acceleration = "high",
        enable_safety_checker = true,
        seed,
      } = body || {};

      if (!image_url) return bad("Missing required field: image_url");
      if (!prompt) return bad("Missing required field: prompt");

      const input = {
        image_url,
        prompt,
        strength,
        num_inference_steps,
        guidance_scale,
        output_format,
        acceleration,
        enable_safety_checker,
        ...(seed !== undefined && seed !== null ? { seed } : {}),
      };

      // Queue API expects { input: { ... } }
      const payload = input;

      const submit = await falFetch(FAL_MODEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!submit.ok) {
        const info = classifyFalError(submit);
        return bad("fal submit failed", { ...info, status: submit.status, response: submit.data ?? submit.text }, 400);
      }

      const request_id = submit.data?.request_id;
      if (!request_id) {
        return bad("fal submit response missing request_id", submit.data);
      }

      return json({
        ok: true,
        request_id,
        status_url: submit.data?.status_url || submit.data?.status?.url || null,
        response_url: submit.data?.response_url || submit.data?.response?.url || null,
        cancel_url: submit.data?.cancel_url || submit.data?.cancel?.url || null,

        // fallback — оставим на всякий, но фронт будет использовать status_url если он есть
        fallback_status_url: `https://queue.fal.run/${FAL_MODEL}/requests/${request_id}/status`,
        fallback_response_url: `https://queue.fal.run/${FAL_MODEL}/requests/${request_id}`,
      });
    }

    // Status (optionally with logs)
    if (url.pathname === "/api/status" && request.method === "GET") {
      const statusUrl = url.searchParams.get("url");
      if (!statusUrl) return bad("Missing query param: url (status_url from /api/generate)");

      let u;
      try {
        u = new URL(statusUrl);
      } catch {
        return bad("Bad url param", { url: statusUrl });
      }

      if (u.hostname !== "queue.fal.run") {
        return bad("Only queue.fal.run status_url is allowed", { host: u.hostname });
      }

      const path = u.pathname.replace(/^\//, "") + (u.search || "");
      const st = await falFetch(path, { method: "GET" });

      if (!st.ok) {
        const info = classifyFalError(st);
        return bad("fal status failed", { ...info, status: st.status, response: st.data ?? st.text }, 502);
      }

      const payload = (st.data && typeof st.data === "object") ? st.data : { raw: st.text };
      return json({ ok: true, ...payload });
    }

    // Result
    if (url.pathname === "/api/result" && request.method === "GET") {
      const resultUrl = url.searchParams.get("url");
      if (!resultUrl) return bad("Missing query param: url (response_url from /api/generate)");

      let u;
      try {
        u = new URL(resultUrl);
      } catch {
        return bad("Bad url param", { url: resultUrl });
      }

      if (u.hostname !== "queue.fal.run") {
        return bad("Only queue.fal.run response_url is allowed", { host: u.hostname });
      }

      const path = u.pathname.replace(/^\//, "") + (u.search || "");
      const res = await falFetch(path, { method: "GET" });

      if (!res.ok) {
        const info = classifyFalError(res);
        return bad("fal result failed", { ...info, status: res.status, response: res.data ?? res.text }, 502);
      }

      const payload = (res.data && typeof res.data === "object") ? res.data : { raw: res.text };
      return json({ ok: true, ...payload });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};