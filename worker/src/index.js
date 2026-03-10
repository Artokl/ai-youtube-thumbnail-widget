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
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
          ...extraHeaders,
        },
      });

    const bad = (message, details = null, status = 400) =>
      json({ ok: false, error: message, details }, status);

    const isYouTubeHost = (h) =>
      ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(h);

    const extractYouTubeId = (raw) => {
      try {
        const u = new URL(raw);
        if (!isYouTubeHost(u.hostname)) return null;

        if (u.hostname === "youtu.be") {
          const id = u.pathname.split("/").filter(Boolean)[0];
          return id || null;
        }

        const v = u.searchParams.get("v");
        if (v) return v;

        const mShorts = u.pathname.match(/^\/shorts\/([^/]+)/);
        if (mShorts) return mShorts[1];

        const mEmbed = u.pathname.match(/^\/embed\/([^/]+)/);
        if (mEmbed) return mEmbed[1];

        return null;
      } catch {
        return null;
      }
    };

    const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    const FAL_KEY = env.FAL_KEY;
    const FAL_MODEL = env.FAL_MODEL || "fal-ai/bytedance/seedream/v4.5/edit";

    const FAL_LLM_PATH =
      env.FAL_LLM_PATH || "openrouter/router/openai/v1/chat/completions";

    const FAL_LLM_MODEL =
      env.FAL_LLM_MODEL || "meta-llama/llama-3.1-8b-instruct";

    if (!FAL_KEY) {
      return bad(
        "Missing FAL_KEY secret in Worker environment.",
        "Add it as a secret."
      );
    }

    if (!FAL_MODEL || typeof FAL_MODEL !== "string" || !FAL_MODEL.includes("/")) {
      return bad("Bad FAL_MODEL value.", { FAL_MODEL });
    }

    const cleanOneLine = (s, max = 240) => {
      if (!s || typeof s !== "string") return "";
      return s.replace(/\s+/g, " ").trim().slice(0, max);
    };

    const clipWords = (text, maxWords = 4) => {
      return String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, maxWords)
        .join(" ");
    };

    const safeJsonParse = (text) => {
      try {
        return JSON.parse(text);
      } catch (_) {}

      const m = String(text || "").match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch (_) {}
      }

      return null;
    };

    const heuristicHeadline = (videoTitle = "") => {
      const t = cleanOneLine(videoTitle, 200)
        .replace(/\[[^\]]*\]|\([^\)]*\)/g, " ")
        .replace(/[|•·]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!t) return "WATCH THIS";

      const words = t.split(" ").filter(Boolean);
      const stop = new Set(["the", "a", "an", "how", "why", "my", "this", "that", "i", "we"]);
      let picked = words.slice(0, 6).filter(w => !stop.has(w.toLowerCase()));
      if (!picked.length) picked = words.slice(0, 4);

      let headline = picked.slice(0, 4).join(" ").trim();
      if (headline.length > 28) headline = clipWords(headline, 3);
      if (!headline) headline = "WATCH THIS";

      return headline.toUpperCase();
    };

    const detectTopicHints = (videoTitle = "", userPrompt = "", channelName = "") => {
      const t = `${videoTitle} ${userPrompt} ${channelName}`.toLowerCase();

      if (/(car|race|racing|lap|drift|nissan|bmw|jdm|track|f1|formula|speed|turbo|nightdrive|night drive)/i.test(t)) {
        return {
          style: "cinematic",
          accent_color: "#ffb25c",
          accent_color_2: "#ffffff",
          text_layout: "top-center",
          plate: "none",
        };
      }

      if (/(music|song|official audio|clip|phonk|synth|beat|album|remix|dj|night)/i.test(t)) {
        return {
          style: "cinematic",
          accent_color: "#ffd36a",
          accent_color_2: "#ffffff",
          text_layout: "top-center",
          plate: "none",
        };
      }

      if (/(gaming|game|fps|ranked|warzone|fortnite|cs2|valorant|boss|elden|minecraft|gta|stream)/i.test(t)) {
        return {
          style: "gaming",
          accent_color: "#63e7ff",
          accent_color_2: "#ffffff",
          text_layout: "top-left",
          plate: "soft",
        };
      }

      if (/(business|money|startup|saas|agency|income|marketing|sales|finance|entrepreneur)/i.test(t)) {
        return {
          style: "bold",
          accent_color: "#ffffff",
          accent_color_2: "#b8c8ff",
          text_layout: "left-center",
          plate: "soft",
        };
      }

      if (/(tutorial|guide|how to|explained|learn|course|tips|mistakes)/i.test(t)) {
        return {
          style: "minimal",
          accent_color: "#ffffff",
          accent_color_2: "#e9f1ff",
          text_layout: "top-left",
          plate: "soft",
        };
      }

      return {
        style: "dramatic",
        accent_color: "#ffd36a",
        accent_color_2: "#ffffff",
        text_layout: "top-center",
        plate: "none",
      };
    };

    const normalizeArtDirection = (raw = {}, fallback = {}) => {
      const allowedLayouts = new Set([
        "top-left",
        "top-center",
        "top-right",
        "left-center",
        "center",
        "right-center",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ]);

      const allowedStyles = new Set([
        "dramatic",
        "bold",
        "minimal",
        "gaming",
        "cinematic",
      ]);

      const allowedPlate = new Set(["none", "soft", "strong"]);
      const allowedCase = new Set(["uppercase", "title", "original"]);

      const hex = (v, fb) => {
        const s = String(v || "").trim();
        return /^#([0-9a-fA-F]{6})$/.test(s) ? s : fb;
      };

      const num = (v, fb, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fb;
        return Math.max(min, Math.min(max, n));
      };

      return {
        text_layout: allowedLayouts.has(raw.text_layout) ? raw.text_layout : fallback.text_layout,
        font_style: allowedStyles.has(raw.font_style) ? raw.font_style : fallback.font_style,
        accent_color: hex(raw.accent_color, fallback.accent_color),
        accent_color_2: hex(raw.accent_color_2, fallback.accent_color_2),
        text_case: allowedCase.has(raw.text_case) ? raw.text_case : fallback.text_case,
        plate: allowedPlate.has(raw.plate) ? raw.plate : fallback.plate,
        stroke_strength: num(raw.stroke_strength, fallback.stroke_strength, 0, 1),
        shadow_strength: num(raw.shadow_strength, fallback.shadow_strength, 0, 1),
        tracking: num(raw.tracking, fallback.tracking, 0, 0.12),
        max_width_ratio: num(raw.max_width_ratio, fallback.max_width_ratio, 0.28, 0.8),
        focus_priority: cleanOneLine(raw.focus_priority || fallback.focus_priority || "keep_subject_clear", 80),
        avoid_zones: Array.isArray(raw.avoid_zones)
          ? raw.avoid_zones.map(x => cleanOneLine(String(x), 32)).filter(Boolean).slice(0, 6)
          : (fallback.avoid_zones || ["subject_center"]),
        font_weight: Math.round(num(raw.font_weight, fallback.font_weight, 500, 950)),
      };
    };

    const buildLlmSystemPrompt = () => {
      return [
        "You are an expert YouTube thumbnail strategist and visual art director.",
        "Return ONLY valid JSON.",
        "",
        "Required exact JSON shape:",
        `{
  "headline":"...",
  "visual_angle":"...",
  "style":"dramatic|bold|minimal|gaming|cinematic",
  "placement":"top|bottom|left|right|center",
  "art_direction":{
    "text_layout":"top-left|top-center|top-right|left-center|center|right-center|bottom-left|bottom-center|bottom-right",
    "font_style":"dramatic|bold|minimal|gaming|cinematic",
    "accent_color":"#RRGGBB",
    "accent_color_2":"#RRGGBB",
    "text_case":"uppercase|title|original",
    "plate":"none|soft|strong",
    "stroke_strength":0.0,
    "shadow_strength":0.0,
    "tracking":0.0,
    "max_width_ratio":0.0,
    "focus_priority":"...",
    "avoid_zones":["..."],
    "font_weight":900
  }
}`,
        "",
        "headline rules:",
        "- 2 to 4 words preferred",
        "- maximum 28 characters if possible",
        "- must be punchy, clickworthy, readable",
        "- must NOT copy the original title verbatim",
        "- no quotes, emojis, hashtags, or clutter",
        "- should feel custom to the video/topic",
        "",
        "visual_angle rules:",
        "- one short sentence",
        "- describe the visual mood and composition for an image generator",
        "- no text rendering instructions",
        "",
        "art_direction rules:",
        "- choose a typography direction that feels custom to the specific content",
        "- choose colors that fit likely image mood",
        "- avoid covering the main subject",
        "- prefer premium cinematic or creator-grade typography, not generic meme text",
        "- use plate:none unless strong readability reason exists",
        "- avoid boring centered black-banner layouts",
        "- for automotive/music/cinematic content prefer stylish premium typography",
        "- prefer integrated composition over artificial graphic panels",
        "",
        "Important:",
        "- respond with only JSON",
        "- do not explain anything",
      ].join("\n");
    };

    const falFetch = async (path, init = {}) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30000);

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
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {}

      return { ok: r.ok, status: r.status, text, data };
    };

    const falLlmFetch = async (payload) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 25000);

      let r, text;
      try {
        r = await fetch(`https://fal.run/${FAL_LLM_PATH}`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Key ${FAL_KEY}`,
            "X-Fal-Key": FAL_KEY,
          },
          body: JSON.stringify(payload),
        });
        text = await r.text();
      } catch (e) {
        clearTimeout(t);
        return { ok: false, status: 0, text: String(e), data: null };
      } finally {
        clearTimeout(t);
      }

      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {}

      return { ok: r.ok, status: r.status, text, data };
    };

    const classifyFalError = (resp) => {
      const msg =
        resp?.data?.detail ||
        resp?.data?.error?.message ||
        resp?.data?.message ||
        (typeof resp?.data === "string" ? resp.data : null) ||
        resp?.text ||
        "";

      const s = resp?.status;

      if (s === 401) {
        return { code: "FAL_INVALID_TOKEN", message: "fal.ai: invalid token", raw: msg };
      }
      if (s === 403 && /Exhausted balance|locked/i.test(msg)) {
        return { code: "FAL_NO_BALANCE", message: "fal.ai: balance exhausted", raw: msg };
      }
      if (s === 429) {
        return { code: "FAL_RATE_LIMIT", message: "fal.ai: rate limit", raw: msg };
      }
      if (s === 404) {
        return { code: "FAL_NOT_FOUND", message: "fal.ai: model/endpoint not found", raw: msg };
      }
      if (s >= 500) {
        return { code: "FAL_UPSTREAM", message: "fal.ai: upstream service error", raw: msg };
      }

      return { code: "FAL_ERROR", message: "fal.ai: request error", raw: msg };
    };

    const generateTextPlan = async ({
      videoTitle = "",
      channelName = "",
      userPrompt = "",
      customText = "",
    }) => {
      const safeVideoTitle = cleanOneLine(videoTitle, 240);
      const safeChannelName = cleanOneLine(channelName, 120);
      const safeUserPrompt = cleanOneLine(userPrompt, 320);
      const safeCustomText = cleanOneLine(customText, 120);

      const hinted = detectTopicHints(safeVideoTitle, safeUserPrompt, safeChannelName);

      const fallbackArtDirection = {
        text_layout: hinted.text_layout,
        font_style: hinted.style,
        accent_color: hinted.accent_color,
        accent_color_2: hinted.accent_color_2,
        text_case: "uppercase",
        plate: hinted.plate,
        stroke_strength: hinted.style === "minimal" ? 0.25 : 0.72,
        shadow_strength: hinted.style === "minimal" ? 0.18 : 0.42,
        tracking: hinted.style === "cinematic" ? 0.035 : 0.015,
        max_width_ratio: hinted.text_layout.includes("center") ? 0.62 : 0.42,
        focus_priority: "keep_subject_clear",
        avoid_zones: ["subject_center", "faces", "main_object"],
        font_weight: hinted.style === "minimal" ? 800 : 900,
      };

      if (safeCustomText) {
        return {
          source: "custom_text",
          headline: safeCustomText.toUpperCase(),
          visual_angle:
            safeUserPrompt ||
            "High-contrast premium YouTube thumbnail with strong subject separation, cinematic depth, and natural negative space integrated into the scene.",
          style: hinted.style,
          placement: hinted.text_layout.startsWith("top")
            ? "top"
            : hinted.text_layout.startsWith("bottom")
            ? "bottom"
            : hinted.text_layout.startsWith("left")
            ? "left"
            : hinted.text_layout.startsWith("right")
            ? "right"
            : "center",
          art_direction: fallbackArtDirection,
        };
      }

      const userContent = [
        `Video title: ${safeVideoTitle || "Unknown"}`,
        `Channel: ${safeChannelName || "Unknown"}`,
        `Extra user instructions: ${safeUserPrompt || "None"}`,
        "",
        "Generate thumbnail headline plus art direction.",
        "The result must feel custom to this specific content, not generic.",
      ].join("\n");

      const llmResp = await falLlmFetch({
        model: FAL_LLM_MODEL,
        temperature: 0.85,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildLlmSystemPrompt() },
          { role: "user", content: userContent },
        ],
      });

      if (!llmResp.ok) {
        return {
          source: "fallback_after_llm_error",
          headline: heuristicHeadline(safeVideoTitle),
          visual_angle:
            safeUserPrompt ||
            "Premium cinematic YouTube thumbnail with strong focal subject, dynamic composition, dramatic lighting, cleaner background separation, and natural negative space for later text overlay.",
          style: hinted.style,
          placement: fallbackArtDirection.text_layout.startsWith("top")
            ? "top"
            : fallbackArtDirection.text_layout.startsWith("bottom")
            ? "bottom"
            : fallbackArtDirection.text_layout.startsWith("left")
            ? "left"
            : fallbackArtDirection.text_layout.startsWith("right")
            ? "right"
            : "center",
          art_direction: fallbackArtDirection,
          llm_error: llmResp.data ?? llmResp.text,
        };
      }

      const rawContent =
        llmResp?.data?.choices?.[0]?.message?.content ||
        llmResp?.data?.output_text ||
        llmResp?.data?.output ||
        "";

      const parsed = safeJsonParse(rawContent) || {};

      let headline = cleanOneLine(parsed.headline || "", 60);
      let visualAngle = cleanOneLine(parsed.visual_angle || "", 220);
      let style = cleanOneLine(parsed.style || "", 24).toLowerCase();
      let placement = cleanOneLine(parsed.placement || "", 16).toLowerCase();

      if (!headline) headline = heuristicHeadline(safeVideoTitle);
      if (!visualAngle) {
        visualAngle =
          safeUserPrompt ||
          "Premium cinematic YouTube thumbnail with strong focal subject, dynamic composition, dramatic lighting, cleaner background separation, and natural negative space for later text overlay.";
      }

      if (!["dramatic", "bold", "minimal", "gaming", "cinematic"].includes(style)) {
        style = hinted.style;
      }

      if (!["top", "bottom", "left", "right", "center"].includes(placement)) {
        placement = fallbackArtDirection.text_layout.startsWith("top")
          ? "top"
          : fallbackArtDirection.text_layout.startsWith("bottom")
          ? "bottom"
          : fallbackArtDirection.text_layout.startsWith("left")
          ? "left"
          : fallbackArtDirection.text_layout.startsWith("right")
          ? "right"
          : "center";
      }

      headline = clipWords(headline, 4).toUpperCase();

      const artDirection = normalizeArtDirection(parsed.art_direction || {}, fallbackArtDirection);

      return {
        source: "fal_openrouter_llm",
        headline,
        visual_angle: visualAngle,
        style,
        placement,
        art_direction: artDirection,
        usage: llmResp?.data?.usage || null,
      };
    };

    const buildThumbnailEditPrompt = ({
      userPrompt = "",
      videoTitle = "",
      channelName = "",
      headline = "",
      visualAngle = "",
      style = "",
      placement = "",
      artDirection = {},
      customText = "",
    }) => {
      const safeUserPrompt = cleanOneLine(userPrompt, 400);
      const safeVideoTitle = cleanOneLine(videoTitle, 240);
      const safeChannelName = cleanOneLine(channelName, 120);
      const safeHeadline = cleanOneLine(headline, 60);
      const safeVisualAngle = cleanOneLine(visualAngle, 220);
      const safeStyle = cleanOneLine(style, 24);
      const safePlacement = cleanOneLine(placement, 16);
      const safeCustomText = cleanOneLine(customText, 120);

      const layout = cleanOneLine(artDirection?.text_layout || "", 32);
      const focusPriority = cleanOneLine(artDirection?.focus_priority || "keep_subject_clear", 80);

      const topicLine = safeVideoTitle
        ? `Video topic/title: "${safeVideoTitle}".`
        : safeUserPrompt
        ? `Video topic from user instructions: "${safeUserPrompt}".`
        : `Create a highly clickable thumbnail matching the source image context.`;

      const overlayIntent = safeCustomText || safeHeadline
        ? `The image will later receive overlay text: "${safeCustomText || safeHeadline}". Compose with natural negative space that feels built into the scene, not artificially added.`
        : `Do not include any text or typography in the image.`;

      return [
        `Transform the provided source thumbnail into a premium, modern, high-converting YouTube thumbnail while preserving recognizability of the core subject/topic.`,

        topicLine,
        safeChannelName ? `Channel context: "${safeChannelName}".` : "",
        safeVisualAngle ? `Visual angle: ${safeVisualAngle}` : "",
        safeStyle ? `Overall thumbnail mood/style: ${safeStyle}.` : "",
        layout ? `Preferred composition balance for future text overlay: ${layout}.` : "",
        safePlacement ? `General text-side preference: ${safePlacement}.` : "",
        `Priority: ${focusPriority}.`,

        `Design direction: premium creator-economy thumbnail, sharp focal subject, dramatic but clean composition, strong click-through appeal, polished lighting, commercial-grade finish, readable at small size.`,

        `Make it feel designed by an art director, not a template: richer lighting, stronger subject isolation, better depth, better contrast, more visual hierarchy, and more intentional composition.`,

        `Important composition rule: create NATURAL negative space inside the scene where later overlay text can sit comfortably.`,
        `That negative space must feel cinematic and integrated into the image.`,
        `Do NOT create a banner, strip, panel, box, title card, black bar, dark rectangle, empty billboard, empty header, or any artificial text container.`,
        `Do NOT create a plain black top area or a plain black bottom area.`,
        `Do NOT flatten half the image into an empty text zone.`,

        `The main subject must remain visually dominant and attractive.`,
        `The background should support the subject, not compete with it.`,
        `If negative space is needed, achieve it through framing, blur, lighting falloff, atmospheric depth, sky, road, wall, smoke, bokeh, shadow, or composition — not through a graphic banner.`,

        `Use 16:9 thumbnail composition.`,
        `Keep the subject large and visually clear.`,
        `Avoid clutter, tiny details, muddy textures, low-contrast scenes, or generic stock-looking results.`,

        'CRITICAL:',
        'The output image must contain ZERO text.',
        'Do not render any letters, words, captions, titles, subtitles, logos, signage, labels, or typographic shapes.',
        'Do not include fake text or stylized letter-like forms.',
        'The final image must be completely text-free because typography will be added later in the frontend.',

        `Remove all existing text, captions, subtitles, UI labels, logos, badges, embedded typography, and any letter-like shapes from the source thumbnail, and do not generate any new text in the result.`,

        overlayIntent,

        safeUserPrompt ? `Additional user intent: "${safeUserPrompt}".` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    };

    // --- Routes ---
    if (url.pathname === "/" || url.pathname === "/api" || url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "oc-thumbnail-worker",
        model: FAL_MODEL,
        llm_model: FAL_LLM_MODEL,
        llm_path: FAL_LLM_PATH,
        routes: {
          oembed: "GET  /api/oembed?url=YOUTUBE_URL",
          submit: "POST /api/generate",
          status: "GET  /api/status?url=STATUS_URL",
          result: "GET  /api/result?url=RESPONSE_URL",
        },
      });
    }

    // YouTube oEmbed
    if (url.pathname === "/api/oembed" && request.method === "GET") {
      const yt = url.searchParams.get("url");
      if (!yt) return bad("Missing query param: url");

      const id = extractYouTubeId(yt);
      if (!id) {
        return bad("Not a YouTube URL or cannot extract video id.", { url: yt });
      }

      const canonical = `https://www.youtube.com/watch?v=${id}`;
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`;

      try {
        const r = await fetch(oembedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
          },
        });

        const text = await r.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {}

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
      } catch (_) {}

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

    // Generate
    if (url.pathname === "/api/generate" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return bad("Invalid JSON body.");
      }

      const {
        image_url,
        prompt = "",
        video_title = "",
        channel_name = "",
        custom_text = "",
        image_size = "landscape_16_9",
        num_images = 1,
        max_images = 1,
        enable_safety_checker = true,
        seed,
      } = body || {};

      if (!image_url) return bad("Missing required field: image_url");

      const textPlan = await generateTextPlan({
        videoTitle: video_title,
        channelName: channel_name,
        userPrompt: prompt,
        customText: custom_text,
      });

      const finalPrompt = buildThumbnailEditPrompt({
        userPrompt: prompt,
        videoTitle: video_title,
        channelName: channel_name,
        headline: textPlan.headline,
        visualAngle: textPlan.visual_angle,
        style: textPlan.style,
        placement: textPlan.placement,
        artDirection: textPlan.art_direction,
        customText: custom_text,
      });

      const input = {
        prompt: finalPrompt,
        image_urls: [image_url],
        image_size,
        num_images,
        max_images,
        enable_safety_checker,
        ...(seed !== undefined && seed !== null ? { seed } : {}),
      };

      const submit = await falFetch(FAL_MODEL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!submit.ok) {
        const info = classifyFalError(submit);
        return bad(
          "fal submit failed",
          {
            ...info,
            status: submit.status,
            response: submit.data ?? submit.text,
            sent_model: FAL_MODEL,
            sent_input: input,
            headline: textPlan.headline,
            visual_angle: textPlan.visual_angle,
            style: textPlan.style,
            placement: textPlan.placement,
            art_direction: textPlan.art_direction,
          },
          400
        );
      }

      const request_id = submit.data?.request_id;
      if (!request_id) {
        return bad("fal submit response missing request_id", submit.data);
      }

      return json({
        ok: true,
        request_id,
        model: FAL_MODEL,
        llm_model: FAL_LLM_MODEL,
        llm_path: FAL_LLM_PATH,
        headline: textPlan.headline,
        visual_angle: textPlan.visual_angle,
        style: textPlan.style,
        placement: textPlan.placement,
        art_direction: textPlan.art_direction,
        text_source: textPlan.source,
        llm_usage: textPlan.usage || null,
        prompt_used: finalPrompt,
        status_url: submit.data?.status_url || submit.data?.status?.url || null,
        response_url: submit.data?.response_url || submit.data?.response?.url || null,
        cancel_url: submit.data?.cancel_url || submit.data?.cancel?.url || null,
        fallback_status_url: `https://queue.fal.run/${FAL_MODEL}/requests/${request_id}/status`,
        fallback_response_url: `https://queue.fal.run/${FAL_MODEL}/requests/${request_id}`,
      });
    }

    // Status
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

      const payload =
        st.data && typeof st.data === "object"
          ? st.data
          : { raw: st.text };

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

      const payload =
        res.data && typeof res.data === "object"
          ? res.data
          : { raw: res.text };

      return json({ ok: true, ...payload });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};