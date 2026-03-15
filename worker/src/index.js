export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

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
      ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(
        h
      );

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

    const cleanOneLine = (s, max = 240) => {
      if (s === null || s === undefined) return "";
      return String(s).replace(/\s+/g, " ").trim().slice(0, max);
    };

    const cleanMultiLine = (s, max = 7000) => {
      if (s === null || s === undefined) return "";
      return String(s)
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max);
    };

    const clipWords = (text, maxWords = 5) =>
      String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, maxWords)
        .join(" ");

    const uniqueStrings = (arr, max = 20) => {
      if (!Array.isArray(arr)) return [];
      const seen = new Set();
      const out = [];
      for (const item of arr) {
        const s = cleanOneLine(item, 100);
        const k = s.toLowerCase();
        if (!s || seen.has(k)) continue;
        seen.add(k);
        out.push(s);
        if (out.length >= max) break;
      }
      return out;
    };

    const safeJsonParse = (text) => {
      try {
        return JSON.parse(text);
      } catch (_) {}

      const fenced = String(text || "").match(/```json\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1]);
        } catch (_) {}
      }

      const m = String(text || "").match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch (_) {}
      }

      return null;
    };

    const parseChatContent = (respData) => {
      return (
        respData?.choices?.[0]?.message?.content ||
        respData?.output_text ||
        respData?.output?.[0]?.content?.[0]?.text ||
        respData?.data?.choices?.[0]?.message?.content ||
        ""
      );
    };

    const FAL_KEY = env.FAL_KEY;
    const FAL_MODEL = env.FAL_MODEL || "fal-ai/nano-banana-2/edit";

    const OVERCHAT_API_URL =
      env.OVERCHAT_API_URL || "https://api.overchat.ai/v1/chat/completions";
    const OVERCHAT_MODEL = env.OVERCHAT_MODEL || "gpt-5.2-nano";
    const OVERCHAT_PERSONA_ID =
      env.OVERCHAT_PERSONA_ID || "free-chat-gpt-landing";
    const OVERCHAT_APP_VERSION = env.OVERCHAT_APP_VERSION || "1.0.44";
    const OVERCHAT_DEVICE_UUID =
      env.OVERCHAT_DEVICE_UUID || "oc-thumbnail-worker";
    const OVERCHAT_MAX_TOKENS = Number(env.OVERCHAT_MAX_TOKENS || 3400);

    if (!FAL_KEY) {
      return bad(
        "Missing FAL_KEY secret in Worker environment.",
        "Add it as a secret."
      );
    }

    if (!FAL_MODEL || typeof FAL_MODEL !== "string" || !FAL_MODEL.includes("/")) {
      return bad("Bad FAL_MODEL value.", { FAL_MODEL });
    }

    const THUMBNAIL_ARCHETYPE_PLAYBOOK = {
      comparison: {
        use_when:
          "two options, products, prices, before-vs-after, cars, winner-loser framing, expensive-vs-cheap",
        composition:
          "split-screen or left-vs-right structure, obvious contrast, central comparison tension, referee reaction optional",
        text_patterns: [
          "X VS Y",
          "$1 VS $10K",
          "CHEAP VS LUXURY",
          "WHICH WINS?",
          "REAL DIFFERENCE",
        ],
        colors:
          "strong contrast between sides, yellow-black-red, warm vs cool, gold vs dark",
        emotion: "decision tension, competition, surprise, superiority",
      },
      reaction: {
        use_when:
          "person reacts emotionally to something surprising, scary, impressive, huge, weird, dangerous, intense",
        composition:
          "huge expressive face foreground, object/event behind, reaction dominates frame",
        text_patterns: [
          "NO WAY",
          "THIS WAS INSANE",
          "TOO CLOSE",
          "I REGRET THIS",
          "WHAT?!",
        ],
        colors:
          "high-contrast face lighting, vivid background separation, expressive energy",
        emotion: "shock, fear, disbelief, awe",
      },
      object_focus: {
        use_when:
          "one dominant object, product, device, car, animal, artifact, food, result, centerpiece",
        composition:
          "oversized object dominates frame, clean support background, optional smaller human reaction",
        text_patterns: [
          "LOOK AT THIS",
          "THE REAL ONE",
          "UNBELIEVABLE",
          "THIS THING",
          "NEXT LEVEL",
        ],
        colors:
          "premium highlight colors, glossy contrast, subject-lit environment",
        emotion: "desire, curiosity, awe",
      },
      before_after: {
        use_when:
          "transformation, upgrade, glow-up, fix, repair, makeover, huge result",
        composition:
          "clear before-vs-after split, transformation obvious at first glance",
        text_patterns: [
          "BEFORE VS AFTER",
          "NIGHT AND DAY",
          "HUGE DIFFERENCE",
          "THIS ACTUALLY WORKED",
          "WHAT A CHANGE",
        ],
        colors:
          "dull before side, vivid after side, transformation via lighting and saturation",
        emotion: "satisfaction, payoff, surprise",
      },
      mystery: {
        use_when:
          "unknown phenomenon, weird topic, hidden truth, secret, strange object, unexplained thing",
        composition:
          "obscured or highlighted subject, spotlight, hidden element, tension, arrows/glow only if tasteful",
        text_patterns: [
          "WHAT IS THIS?",
          "THE REAL TRUTH",
          "NOBODY KNEW",
          "THIS MAKES NO SENSE",
          "HIDDEN SECRET",
        ],
        colors: "dark contrast, neon highlight, secrecy cues, spotlight",
        emotion: "curiosity, intrigue, confusion",
      },
      challenge: {
        use_when:
          "attempt, endurance, survival, first time, impossible task, pressure, competition",
        composition:
          "subject under pressure, visible stakes, urgency, challenge setup",
        text_patterns: [
          "HARDEST YET",
          "CAN I SURVIVE?",
          "I HAD TO TRY",
          "THIS WAS A MISTAKE",
          "NO TURNING BACK",
        ],
        colors: "energetic reds, yellows, urgency, warning contrast",
        emotion: "stakes, adrenaline, pressure",
      },
      cinematic: {
        use_when:
          "music, atmosphere, travel, night drive, mood, premium dramatic visual storytelling",
        composition:
          "hero framing, strong mood, stylish negative space, premium poster-like but clickable",
        text_patterns: [
          "UNREAL VIBES",
          "PURE CINEMA",
          "AFTER MIDNIGHT",
          "DREAM VIEW",
          "THIS FEELS UNREAL",
        ],
        colors:
          "controlled cinematic palette, blue-orange, neon glow, dramatic highlights",
        emotion: "awe, mood, prestige, obsession",
      },
    };

    const DESIGN_PACKS = {
      clean_bold: {
        look: "clean bold youtube typography, but not boring by default, readable and premium",
        colors: "white, black, subtle accent",
        use_when: "general high-CTR thumbnails",
      },
      danger_red: {
        look: "aggressive red-black-white thumbnail styling, urgent and dramatic",
        colors: "red, black, white",
        use_when: "warning, challenge, mistakes, danger, drama",
      },
      luxury_gold: {
        look: "premium gold-white-black luxury thumbnail styling",
        colors: "gold, white, black",
        use_when: "money, expensive items, premium products, status",
      },
      neon_gaming: {
        look: "neon cyan-magenta high-energy styling with electric glow",
        colors: "cyan, magenta, black, white",
        use_when: "gaming, tech, cyber, night drive, high energy",
      },
      cinematic_blue: {
        look: "cinematic blue-orange contrast, dramatic gradients, premium depth",
        colors: "blue, orange, white, dark navy",
        use_when: "cars, music, atmosphere, travel, cinematic mood",
      },
      tabloid_yellow: {
        look: "bold tabloid-style yellow-black-red text, loud and attention-grabbing",
        colors: "yellow, black, red, white",
        use_when: "comparison, price contrast, loud curiosity",
      },
      tech_hud: {
        look: "futuristic tech interface style with glowing UI accents and sharp digital highlights",
        colors: "cyan, deep blue, white, black",
        use_when: "tech, gadgets, futuristic topics",
      },
      comic_impact: {
        look: "oversized comic-book impact typography with exaggerated shadows and playful aggression",
        colors: "white, red, blue, yellow, black",
        use_when: "fun, challenge, reaction, entertainment",
      },
    };

    const TEXT_PRESETS = {
      impact_white: {
        description:
          "huge bold white letters, thick black outline, heavy shadow, premium readability",
      },
      tabloid_yellow_red: {
        description:
          "yellow tabloid headline with black outline, one accent word in red, loud youtube packaging",
      },
      luxury_gold: {
        description:
          "metallic gold gradient letters, dark outline, rich premium status typography",
      },
      neon_racing: {
        description:
          "italic racing typography, yellow or white core with red outline, energetic motion feel",
      },
      cinematic_orange: {
        description:
          "cinematic orange-white gradient headline, strong outline, polished dramatic glow",
      },
      danger_red: {
        description:
          "red and white high-alert typography with thick black outline and urgency",
      },
      comic_burst: {
        description:
          "comic-book explosive headline, oversized shadow, playful aggressive energy",
      },
      tech_hud_cyan: {
        description:
          "futuristic cyan glowing typography with sharp digital contrast",
      },
    };

    const LAYOUT_TEMPLATES = {
      hero_top:
        "one dominant subject below, headline across top, strong negative space behind headline",
      top_right_stack:
        "large subject on left or center-left, stacked headline top-right, two lines max, clear right-side negative space",
      top_left_stack:
        "large subject on right or center-right, stacked headline top-left, two lines max, clear left-side negative space",
      split_vs:
        "clear left-vs-right split, comparison visible instantly, headline top center, optional VS energy",
      center_stack:
        "dominant subject center, stacked headline above or around it, dramatic but contained",
      bottom_banner:
        "dominant subject above, strong readable banner style headline near bottom without covering key subject",
      corner_badge:
        "main subject dominates, short hook at top plus optional corner badge",
    };

    const maxWordsByArchetype = {
      comparison: 4,
      reaction: 3,
      object_focus: 3,
      before_after: 4,
      mystery: 4,
      challenge: 4,
      cinematic: 3,
    };

    const maxWordsByLanguage = {
      ru: 3,
      uk: 3,
      be: 3,
      bg: 3,
      sr: 3,
      mk: 3,
      en: 4,
      de: 3,
      fr: 3,
      es: 3,
      it: 3,
      pt: 3,
    };

    const mapImageSizeToAspectRatio = (value) => {
      const v = String(value || "").trim().toLowerCase();
      if (!v) return "16:9";
      if (v === "landscape_16_9") return "16:9";
      if (v === "portrait_9_16") return "9:16";
      if (v === "square" || v === "1:1") return "1:1";
      if (/^\d+:\d+$/.test(v)) return v;
      if (v === "4:3") return "4:3";
      if (v === "3:4") return "3:4";
      if (v === "21:9") return "21:9";
      return "16:9";
    };

    const falFetch = async (path, init = {}) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 50000);

      let r, text;
      try {
        r = await fetch(`https://queue.fal.run/${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Key ${FAL_KEY}`,
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

    const overchatFetch = async (payload) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 35000);

      let r, text;
      try {
        r = await fetch(OVERCHAT_API_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "*/*",
            "X-Device-Platform": "web",
            "X-Device-Language": "en-US",
            "X-Device-Uuid": OVERCHAT_DEVICE_UUID,
            "X-Device-Version": OVERCHAT_APP_VERSION,
            Origin: "https://overchat.ai",
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
        return {
          code: "FAL_INVALID_TOKEN",
          message: "fal.ai: invalid token",
          raw: msg,
        };
      }
      if (s === 403 && /Exhausted balance|locked/i.test(msg)) {
        return {
          code: "FAL_NO_BALANCE",
          message: "fal.ai: balance exhausted",
          raw: msg,
        };
      }
      if (s === 429) {
        return { code: "FAL_RATE_LIMIT", message: "fal.ai: rate limit", raw: msg };
      }
      if (s === 404) {
        return {
          code: "FAL_NOT_FOUND",
          message: "fal.ai: model/endpoint not found",
          raw: msg,
        };
      }
      if (s >= 500) {
        return {
          code: "FAL_UPSTREAM",
          message: "fal.ai: upstream service error",
          raw: msg,
        };
      }

      return { code: "FAL_ERROR", message: "fal.ai: request error", raw: msg };
    };

    const classifyOverchatError = (resp) => {
      const msg =
        resp?.data?.error ||
        resp?.data?.message ||
        resp?.data?.details ||
        resp?.text ||
        "overchat request failed";

      if (resp?.status === 403) {
        return {
          code: "OVERCHAT_FORBIDDEN",
          message: "overchat access forbidden",
          raw: msg,
        };
      }
      if (resp?.status === 429) {
        return {
          code: "OVERCHAT_RATE_LIMIT",
          message: "overchat rate limit",
          raw: msg,
        };
      }
      if (resp?.status >= 500) {
        return {
          code: "OVERCHAT_UPSTREAM",
          message: "overchat upstream error",
          raw: msg,
        };
      }
      return {
        code: "OVERCHAT_ERROR",
        message: "overchat request error",
        raw: msg,
      };
    };

    const normalizeVideoContext = (body = {}) => {
      const youtube_url = cleanOneLine(
        body.youtube_url || body.video_url || body.url || "",
        500
      );
      const video_title = cleanOneLine(body.video_title || body.title || "", 320);
      const channel_name = cleanOneLine(
        body.channel_name || body.author_name || body.channel || "",
        180
      );
      const video_description = cleanMultiLine(
        body.video_description || body.description || "",
        3200
      );
      const transcript = cleanMultiLine(
        body.transcript || body.transcript_summary || "",
        3600
      );
      const comments_summary = cleanMultiLine(
        body.comments_summary || "",
        1800
      );
      const topic_keywords = uniqueStrings(
        body.topic_keywords || body.keywords || body.tags || [],
        24
      );
      const audience = cleanOneLine(body.audience || "", 180);
      const language = cleanOneLine(body.language || "", 80).toLowerCase();
      const additional_instructions = cleanMultiLine(
        body.additional_instructions || body.additionalInstructions || "",
        1800
      );
      const custom_text = cleanOneLine(
        body.custom_text || body.customText || body.thumbnail_text || "",
        120
      );
      const user_prompt = cleanMultiLine(
        body.prompt || body.user_prompt || "",
        1500
      );
      const category = cleanOneLine(body.category || "", 120);
      const published_at = cleanOneLine(
        body.published_at || body.publishedAt || "",
        80
      );
      const video_topic = cleanOneLine(body.video_topic || body.topic || "", 220);
      const emotional_angle = cleanOneLine(
        body.emotional_angle || body.angle || "",
        180
      );
      const image_url = cleanOneLine(
        body.image_url || body.thumbnail_url || "",
        1000
      );

      return {
        youtube_url,
        video_title,
        channel_name,
        video_description,
        transcript,
        comments_summary,
        topic_keywords,
        audience,
        language,
        additional_instructions,
        custom_text,
        user_prompt,
        category,
        published_at,
        video_topic,
        emotional_angle,
        image_url,
      };
    };

    const isMostlyCyrillic = (...parts) => {
      const s = parts.filter(Boolean).join(" ");
      return /[а-яёіїєґў]/i.test(s);
    };

    const normalizeLooseText = (s) =>
      String(s || "")
        .toUpperCase()
        .replace(/[“”"«»'`]/g, "")
        .replace(/[.,!?;:()[\]{}]/g, " ")
        .replace(/[-–—]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const tokenizeLoose = (s) =>
      normalizeLooseText(s)
        .split(" ")
        .map((x) => x.trim())
        .filter(Boolean);

    const uniqueOrdered = (arr) => {
      const seen = new Set();
      const out = [];
      for (const v of arr) {
        const k = String(v).toLowerCase();
        if (!v || seen.has(k)) continue;
        seen.add(k);
        out.push(v);
      }
      return out;
    };

    const getHeadlineMaxWords = (context, archetype) => {
      const langMax = maxWordsByLanguage[context.language] || 4;
      const archetypeMax = maxWordsByArchetype[archetype] || 4;
      const cyrillicPenalty = isMostlyCyrillic(
        context.video_title,
        context.custom_text,
        context.additional_instructions
      )
        ? 3
        : 99;
      return Math.min(langMax, archetypeMax, cyrillicPenalty);
    };

    const detectTopicHints = ({
      videoTitle = "",
      prompt = "",
      channelName = "",
      description = "",
      transcript = "",
      topicKeywords = [],
    }) => {
      const t = [
        videoTitle,
        prompt,
        channelName,
        description,
        transcript,
        ...(topicKeywords || []),
      ]
        .join(" ")
        .toLowerCase();

      if (
        /(car|race|racing|lap|drift|nissan|bmw|jdm|track|f1|formula|speed|turbo|nightdrive|night drive|supercar|engine|golf|stinger|m340i|skeler)/i.test(
          t
        )
      ) {
        return {
          visualMood: "aggressive cinematic automotive drama",
          colors:
            "electric blues, deep blacks, neon purple, orange accents, metallic reflections",
          composition:
            "big car subject, motion, speed energy, dramatic angle, neon city or track environment",
          clickbaitAngle: "speed, obsession, cyber mood, power",
        };
      }

      if (
        /(money|business|startup|saas|agency|income|marketing|sales|finance|entrepreneur|million|profit|make money|expensive|luxury)/i.test(
          t
        )
      ) {
        return {
          visualMood: "high-status premium business drama",
          colors: "gold, white, black, deep blue",
          composition:
            "clear focal subject, premium contrast, one dominant value metaphor",
          clickbaitAngle: "money, status, shocking difference, hidden edge",
        };
      }

      if (
        /(gaming|game|fps|ranked|warzone|fortnite|cs2|valorant|boss|elden|minecraft|gta|stream)/i.test(
          t
        )
      ) {
        return {
          visualMood: "hyper-energetic gaming thumbnail",
          colors: "electric cyan, magenta, red accents, sharp contrast",
          composition:
            "large subject, explosive effects, readable silhouette",
          clickbaitAngle: "insane moment, impossible result, ultimate trick",
        };
      }

      if (
        /(tutorial|guide|how to|explained|learn|course|tips|mistakes|workflow|step by step|test|review|intel|gpu|tech)/i.test(
          t
        )
      ) {
        return {
          visualMood: "clear but high-CTR educational tech drama",
          colors:
            "cyan glow, white highlights, dark contrast, premium tech accents",
          composition:
            "one dominant idea visualized simply with strong hierarchy",
          clickbaitAngle: "secret, truth, test, mistake, reveal",
        };
      }

      if (
        /(music|song|official audio|clip|phonk|synth|beat|album|remix|dj|night|daft punk|get lucky)/i.test(
          t
        )
      ) {
        return {
          visualMood: "moody stylish music-video energy",
          colors: "gold, orange, neon purple, blue glow, glossy dark contrast",
          composition:
            "atmospheric cinematic framing with iconic focal point",
          clickbaitAngle: "mood, icon, obsession, legendary vibe",
        };
      }

      if (
        /(travel|switzerland|alps|mountain|flight|flying|drone|nature|relaxing|sicily|italy|island|volcano)/i.test(
          t
        )
      ) {
        return {
          visualMood: "epic scenic travel awe",
          colors: "sky blue, warm sunlight, lava orange, lush greens, crisp whites",
          composition:
            "huge vista, emotional foreground, premium wide scenic depth",
          clickbaitAngle: "awe, danger, dream view, paradise, unreal beauty",
        };
      }

      return {
        visualMood: "high-contrast clickbait creator thumbnail",
        colors:
          "bright saturated accents, clean highlights, deep blacks",
        composition:
          "large clear subject, dramatic depth, intentional negative space",
        clickbaitAngle: "curiosity, urgency, shock, reveal",
      };
    };

    const detectThumbnailArchetype = ({
      videoTitle = "",
      prompt = "",
      description = "",
      transcript = "",
      emotionalAngle = "",
      topicKeywords = [],
    }) => {
      const t = [
        videoTitle,
        prompt,
        description,
        transcript,
        emotionalAngle,
        ...(topicKeywords || []),
      ]
        .join(" ")
        .toLowerCase();

      if (
        /(vs|versus|comparison|compare|best|worst|ranked|tier list|which is better|cheap vs|expensive vs|\$1 vs|\$10k)/i.test(
          t
        )
      ) {
        return "comparison";
      }

      if (
        /(before and after|before after|transform|transformation|changed|results|glow up|upgrade)/i.test(
          t
        )
      ) {
        return "before_after";
      }

      if (
        /(challenge|24 hours|last to|first time|survive|attempt|tried|can i|i tried)/i.test(
          t
        )
      ) {
        return "challenge";
      }

      if (
        /(mystery|secret|hidden|unknown|strange|weird|unexplained|truth|what is this|правда|миф)/i.test(
          t
        )
      ) {
        return "mystery";
      }

      if (
        /(cinematic|music video|atmosphere|story|film|moody|night drive|official audio|relaxing music|flight|travel|sicily|volcano|italy)/i.test(
          t
        )
      ) {
        return "cinematic";
      }

      if (
        /(product|object|device|car|phone|setup|item|tool|feature|animal|burger|school|gpu|cpu|intel|turbo|turbine|helmet|steak)/i.test(
          t
        )
      ) {
        return "object_focus";
      }

      return "reaction";
    };

    const detectHookType = ({
      videoTitle = "",
      description = "",
      transcript = "",
      topicKeywords = [],
      emotionalAngle = "",
    }) => {
      const t = [
        videoTitle,
        description,
        transcript,
        emotionalAngle,
        ...(topicKeywords || []),
      ]
        .join(" ")
        .toLowerCase();

      if (/(vs|versus|cheap|expensive|difference|compare)/i.test(t))
        return "comparison";
      if (/(secret|truth|hidden|what is this|unknown|mystery)/i.test(t))
        return "mystery";
      if (/(danger|mistake|warning|too close|survive|regret|volcano|eruption)/i.test(t))
        return "danger";
      if (/(upgrade|before|after|worked|transformation|change)/i.test(t))
        return "transformation";
      if (/(money|luxury|premium|expensive|rich|million)/i.test(t))
        return "status";
      if (/(beautiful|cinematic|dream|vibe|music|night drive|relaxing|travel|sicily)/i.test(t))
        return "awe";
      if (/(test|review|proof|result|real)/i.test(t))
        return "proof";
      return "shock";
    };

    const chooseTextPresetFallback = (designPack, context = {}, archetype = "") => {
      const t = `${context.video_title} ${context.video_topic} ${context.emotional_angle}`.toLowerCase();

      if (/luxury_gold/.test(designPack)) return "luxury_gold";
      if (/tabloid_yellow/.test(designPack)) return "tabloid_yellow_red";
      if (/danger_red/.test(designPack)) return "danger_red";
      if (/tech_hud/.test(designPack)) return "tech_hud_cyan";
      if (/comic_impact/.test(designPack)) return "comic_burst";
      if (/neon_gaming/.test(designPack)) return "neon_racing";
      if (/cinematic_blue/.test(designPack)) return "cinematic_orange";

      if (/(car|night drive|skeler|music)/i.test(t)) return "neon_racing";
      if (archetype === "comparison") return "tabloid_yellow_red";
      if (archetype === "challenge") return "danger_red";
      return "impact_white";
    };

    const splitHeadlineLines = (headline = "", maxLines = 2) => {
      const words = String(headline || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      if (!words.length) return [];
      if (words.length <= 2 || maxLines <= 1) return [words.join(" ")];
      if (words.length === 3) return [words.slice(0, 1).join(" "), words.slice(1).join(" ")];
      return [
        words.slice(0, Math.ceil(words.length / 2)).join(" "),
        words.slice(Math.ceil(words.length / 2)).join(" "),
      ];
    };

    const heuristicThumbnailText = ({
      customText = "",
      videoTitle = "",
      archetype = "reaction",
      hookType = "shock",
      context = {},
    }) => {
      const maxWords = getHeadlineMaxWords(context, archetype);
      const explicit = cleanOneLine(customText, 80);

      if (explicit) return clipWords(explicit, maxWords).toUpperCase();

      const t = cleanOneLine(videoTitle, 240).toLowerCase();
      const cyr = isMostlyCyrillic(videoTitle, customText);

      if (/(night drive|skeler)/i.test(t)) return "NIGHT DRIVE";
      if (/(daft punk|get lucky)/i.test(t)) return "LEGENDARY VIBE";
      if (/(switzerland|alps|flight|flying)/i.test(t)) return "SWISS DREAM";
      if (/(steak|burger|\$1|\$10k|10,000)/i.test(t)) return "$1 VS $10K";
      if (/(turbo|turbine)/i.test(t)) return "THE REAL TRUTH";
      if (/(gpu|intel|cpu)/i.test(t)) return "REAL RESULTS";
      if (/(school|schools)/i.test(t)) return cyr ? "ЭТО МЕСТО" : "THIS PLACE";
      if (/(animal|zoo)/i.test(t)) return cyr ? "НЕ МОЖЕТ БЫТЬ" : "NO WAY";
      if (/(sicily|sicilia|сицилия|etna|etna)/i.test(t))
        return cyr ? "ОПАСНАЯ СИЦИЛИЯ" : "DANGEROUS SICILY";

      if (hookType === "comparison") return cyr ? "РЕАЛЬНАЯ РАЗНИЦА" : "REAL DIFFERENCE";
      if (hookType === "mystery") return cyr ? "ЧТО ЭТО?" : "WHAT IS THIS";
      if (hookType === "danger") return cyr ? "СЛИШКОМ ОПАСНО" : "TOO CLOSE";
      if (hookType === "transformation") return cyr ? "ДЕНЬ И НОЧЬ" : "NIGHT AND DAY";
      if (hookType === "status") return cyr ? "ОНО ТОГО СТОИТ?" : "WORTH IT?";
      if (hookType === "awe") return cyr ? "НЕРЕАЛЬНЫЙ ВИД" : "UNREAL VIBES";
      if (hookType === "proof") return cyr ? "РЕАЛЬНЫЙ ТЕСТ" : "THE REAL TEST";

      const titleWords = cleanOneLine(videoTitle, 220)
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, maxWords);

      if (titleWords.length) return titleWords.join(" ").toUpperCase();

      return cyr ? "ЧТО ЭТО" : "WAIT WHAT";
    };

    const chooseDesignPackFallback = (context, archetype) => {
      const t = `${context.video_title} ${context.video_topic} ${context.emotional_angle}`.toLowerCase();

      if (/(money|luxury|expensive|premium|rich|steak)/i.test(t)) return "luxury_gold";
      if (/(gaming)/i.test(t)) return "neon_gaming";
      if (/(tech|gpu|cpu|intel|futuristic)/i.test(t)) return "tech_hud";
      if (/(danger|mistake|warning|challenge|eruption|volcano)/i.test(t)) return "danger_red";
      if (/(car|cinematic|music|night|skeler|daft punk|travel|flight|switzerland|sicily|italy)/i.test(t)) return "cinematic_blue";
      if (archetype === "comparison") return "tabloid_yellow";
      if (archetype === "reaction") return "comic_impact";
      return "clean_bold";
    };

    const chooseLayoutTemplateFallback = (context, archetype) => {
      const t = `${context.video_title} ${context.video_topic} ${context.emotional_angle}`.toLowerCase();

      if (archetype === "comparison") return "split_vs";
      if (archetype === "reaction") return "top_right_stack";
      if (archetype === "before_after") return "split_vs";
      if (archetype === "challenge") return "center_stack";
      if (/(car|night drive|music|travel|sicily|volcano)/i.test(t)) return "top_right_stack";
      return "hero_top";
    };

    const chooseReserveZoneFallback = (layoutTemplate) => {
      if (layoutTemplate === "top_right_stack") return "top_right_30_percent";
      if (layoutTemplate === "top_left_stack") return "top_left_30_percent";
      if (layoutTemplate === "split_vs") return "top_25_percent";
      if (layoutTemplate === "hero_top") return "top_30_percent";
      if (layoutTemplate === "center_stack") return "top_28_percent";
      if (layoutTemplate === "bottom_banner") return "bottom_22_percent";
      return "top_30_percent";
    };

    const chooseTextPlacementFallback = (layoutTemplate) => {
      if (layoutTemplate === "top_right_stack") return "upper_right";
      if (layoutTemplate === "top_left_stack") return "upper_left";
      if (layoutTemplate === "split_vs") return "top_center";
      if (layoutTemplate === "hero_top") return "top_center";
      if (layoutTemplate === "center_stack") return "top_center";
      if (layoutTemplate === "bottom_banner") return "bottom_center";
      return "top_center";
    };

    const chooseSaferShortHeadline = (original, context = {}) => {
      const text = normalizeLooseText(original);
      const words = tokenizeLoose(text);
      const cyr = isMostlyCyrillic(text, context.video_title, context.custom_text);
      const variants = [];

      if (!words.length) return null;

      if (words.length >= 2) variants.push(words.slice(-2).join(" "));
      if (words.length >= 2) variants.push(words.slice(0, 2).join(" "));
      if (words.length >= 3) variants.push([words[0], words[words.length - 1]].join(" "));

      const joinedContext = `${context.video_title} ${context.video_topic} ${context.emotional_angle}`.toUpperCase();

      if (cyr) {
        if (/СИЦИЛ/.test(joinedContext)) variants.push("ОПАСНАЯ СИЦИЛИЯ");
        if (/ОСТРОВ/.test(text)) variants.push("ОПАСНЫЙ ОСТРОВ");
        if (/САМЫЙ ОПАСНЫЙ/.test(text)) variants.push("САМАЯ ОПАСНАЯ");
        if (/ЭТНА|ВУЛКАН/.test(joinedContext)) variants.push("ОСТРОВ ОГНЯ");
        variants.push("ЭТО МЕСТО");
      } else {
        if (/SICIL/.test(joinedContext)) variants.push("DANGEROUS SICILY");
        if (/ISLAND/.test(text)) variants.push("DANGEROUS ISLAND");
        variants.push("THIS PLACE");
      }

      return uniqueOrdered(
        variants
          .map((v) => clipWords(cleanOneLine(v, 60), cyr ? 3 : 3).toUpperCase())
          .filter(Boolean)
      )[0] || null;
    };

    const buildShorterHeadlineCandidatesWithLLM = async (headline, context) => {
      const cyr = isMostlyCyrillic(headline, context.video_title, context.custom_text);
      const payload = {
        chatId: `thumb-shorten-${crypto.randomUUID()}`,
        model: OVERCHAT_MODEL,
        personaId: OVERCHAT_PERSONA_ID,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: 400,
        stream: false,
        temperature: 0.4,
        top_p: 0.9,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "system",
            content: [
              "You rewrite thumbnail text into shorter, more robust poster-style hooks for image generation.",
              "Return valid JSON only.",
              "Rules:",
              "- Keep meaning and emotional angle.",
              "- Use very short hook phrases, not full sentences.",
              "- Avoid prepositions and fragile grammatical constructions when possible.",
              cyr
                ? "- For Russian/Cyrillic text, prefer 2 to 3 words maximum."
                : "- Prefer 2 to 3 words maximum.",
              "- Make variants robust even if one small word might disappear visually.",
              `Return JSON: {"variants":["VARIANT 1","VARIANT 2","VARIANT 3"]}`,
            ].join("\n"),
          },
          {
            id: crypto.randomUUID(),
            role: "user",
            content: [
              `Original headline: ${headline}`,
              `Video title: ${context.video_title}`,
              `Topic: ${context.video_topic}`,
              `Emotional angle: ${context.emotional_angle}`,
            ].join("\n"),
          },
        ],
      };

      const resp = await overchatFetch(payload);
      if (!resp.ok) return [];

      const parsed = safeJsonParse(parseChatContent(resp.data)) || {};
      return uniqueOrdered(
        Array.isArray(parsed.variants)
          ? parsed.variants.map((x) => cleanOneLine(x, 60).toUpperCase()).filter(Boolean)
          : []
      );
    };

    const buildOverchatSystemPrompt = () => {
      return [
        "You are an elite YouTube thumbnail strategist, click-through-rate copywriter, and viral thumbnail art director.",
        "Your job is to create thumbnail strategy output for a generative image model.",
        "",
        "Your strategy must optimize for:",
        "- YouTube homepage CTR",
        "- mobile readability",
        "- strong emotional clarity",
        "- strong composition safety",
        "- visually interesting typography",
        "- non-generic headline copy",
        "- robust text that survives image generation errors",
        "",
        "You must choose the best thumbnail archetype from:",
        "- comparison",
        "- reaction",
        "- object_focus",
        "- before_after",
        "- mystery",
        "- challenge",
        "- cinematic",
        "",
        "You must also choose the best design pack from:",
        "- clean_bold",
        "- danger_red",
        "- luxury_gold",
        "- neon_gaming",
        "- cinematic_blue",
        "- tabloid_yellow",
        "- tech_hud",
        "- comic_impact",
        "",
        "You must also choose the best text preset from:",
        "- impact_white",
        "- tabloid_yellow_red",
        "- luxury_gold",
        "- neon_racing",
        "- cinematic_orange",
        "- danger_red",
        "- comic_burst",
        "- tech_hud_cyan",
        "",
        "You must also choose the best layout template from:",
        "- hero_top",
        "- top_right_stack",
        "- top_left_stack",
        "- split_vs",
        "- center_stack",
        "- bottom_banner",
        "- corner_badge",
        "",
        "Rules for headline copy:",
        "- generate 10 thumbnail text ideas internally, but output only the best 5",
        "- the headline must be stronger than the original title",
        "- do NOT simply chop the video title unless it is clearly optimal",
        "- the headline should feel like real thumbnail copy, not metadata",
        "- usually 2 to 4 words",
        "- maximum 2 lines",
        "- prefer short poster-style hook phrases, not full grammatical sentences",
        "- avoid function words and prepositions when possible",
        "- if one missing word would break the phrase, rewrite it into a more robust hook",
        "- for Russian/Cyrillic, prefer 2 to 3 strong words maximum",
        "- it should maximize curiosity, tension, contrast, novelty, status, reward, danger, awe, or proof",
        "- if the topic is music, travel, cinematic mood, or atmosphere, use emotional hooks, not literal title fragments",
        "",
        "Rules for typography:",
        "- do NOT default to plain white text unless clearly the best option",
        "- choose a visually interesting text treatment",
        "- prefer accent colors, gradients, boxed labels, italic motion, premium outline, explosive comic treatment, tabloid treatment, or luxury treatment depending on the topic",
        "- make one or two words visually dominant when appropriate",
        "",
        "Rules for composition:",
        "- keep all important subjects fully inside frame",
        "- keep headline fully inside frame",
        "- leave safe margins on all sides",
        "- avoid text touching the top or right edge",
        "- leave the bottom-right area relatively cleaner for the YouTube timestamp",
        "- keep text readable with strong negative space behind it",
        "- concepts must feel like real thumbnails, not screenshots",
        "",
        "Return ONLY valid JSON in this exact shape:",
        `{
  "thumbnail_archetype": "comparison|reaction|object_focus|before_after|mystery|challenge|cinematic",
  "design_pack": "clean_bold|danger_red|luxury_gold|neon_gaming|cinematic_blue|tabloid_yellow|tech_hud|comic_impact",
  "hook_type": "shock|mystery|comparison|status|danger|reward|awe|proof|transformation",
  "headline": "short main text",
  "subheadline": "optional short secondary text",
  "best_text": "same or similar to headline",
  "text_options": ["option 1", "option 2", "option 3", "option 4", "option 5"],
  "layout_template": "hero_top|top_right_stack|top_left_stack|split_vs|center_stack|bottom_banner|corner_badge",
  "text_preset": "impact_white|tabloid_yellow_red|luxury_gold|neon_racing|cinematic_orange|danger_red|comic_burst|tech_hud_cyan",
  "text_placement": "top_left|top_center|top_right|upper_left|upper_right|center_top|bottom_center",
  "reserve_zone": "top_25_percent|top_28_percent|top_30_percent|top_35_percent|top_right_30_percent|top_left_30_percent|bottom_22_percent",
  "safe_margin": "8_percent",
  "accent_words": ["word1", "word2"],
  "headline_lines": ["LINE 1", "LINE 2"],
  "concept_options": [
    {
      "label": "short name",
      "scene_concept": "scene description",
      "composition": "composition description"
    },
    {
      "label": "short name",
      "scene_concept": "scene description",
      "composition": "composition description"
    },
    {
      "label": "short name",
      "scene_concept": "scene description",
      "composition": "composition description"
    }
  ],
  "visual_mood": "overall mood",
  "color_strategy": "overall color strategy",
  "text_style": "detailed typography direction",
  "subject_scale": "large but fully inside frame",
  "avoid": ["thing 1", "thing 2", "thing 3"]
}`,
        "",
        "Return JSON only.",
      ].join("\n");
    };

    const buildOverchatUserPrompt = (context) => {
      const {
        youtube_url = "",
        video_title = "",
        channel_name = "",
        video_description = "",
        transcript = "",
        comments_summary = "",
        topic_keywords = [],
        audience = "",
        language = "",
        additional_instructions = "",
        custom_text = "",
        user_prompt = "",
        category = "",
        video_topic = "",
        emotional_angle = "",
      } = context || {};

      const archetypeGuide = Object.entries(THUMBNAIL_ARCHETYPE_PLAYBOOK)
        .map(([name, cfg]) => {
          return [
            `ARCHETYPE: ${name}`,
            `use_when: ${cfg.use_when}`,
            `composition: ${cfg.composition}`,
            `text_patterns: ${cfg.text_patterns.join(", ")}`,
            `colors: ${cfg.colors}`,
            `emotion: ${cfg.emotion}`,
          ].join("\n");
        })
        .join("\n\n");

      const designGuide = Object.entries(DESIGN_PACKS)
        .map(([name, cfg]) => {
          return [
            `DESIGN_PACK: ${name}`,
            `look: ${cfg.look}`,
            `colors: ${cfg.colors}`,
            `use_when: ${cfg.use_when}`,
          ].join("\n");
        })
        .join("\n\n");

      const textPresetGuide = Object.entries(TEXT_PRESETS)
        .map(([name, cfg]) => {
          return `TEXT_PRESET: ${name}\ndescription: ${cfg.description}`;
        })
        .join("\n\n");

      const layoutGuide = Object.entries(LAYOUT_TEMPLATES)
        .map(([name, desc]) => {
          return `LAYOUT_TEMPLATE: ${name}\ndescription: ${desc}`;
        })
        .join("\n\n");

      return [
        "Create a viral YouTube thumbnail strategy for this video.",
        "",
        `Highest priority user instructions: ${cleanMultiLine(additional_instructions, 1000) || "None"}`,
        `Explicit user text request: ${cleanOneLine(custom_text, 120) || "None"}`,
        `Extra user request: ${cleanMultiLine(user_prompt, 900) || "None"}`,
        "",
        `Video title: ${cleanOneLine(video_title, 320) || "Unknown"}`,
        `Channel: ${cleanOneLine(channel_name, 180) || "Unknown"}`,
        `Topic: ${cleanOneLine(video_topic, 220) || "Unknown"}`,
        `Category: ${cleanOneLine(category, 120) || "Unknown"}`,
        `Audience: ${cleanOneLine(audience, 180) || "Unknown"}`,
        `Language: ${cleanOneLine(language, 80) || "Unknown"}`,
        `Emotional angle: ${cleanOneLine(emotional_angle, 180) || "Unknown"}`,
        `Keywords: ${uniqueStrings(topic_keywords, 20).join(", ") || "None"}`,
        `YouTube URL: ${cleanOneLine(youtube_url, 400) || "Unknown"}`,
        "",
        "Video description:",
        cleanMultiLine(video_description, 1800) || "None",
        "",
        "Transcript:",
        cleanMultiLine(transcript, 2400) || "None",
        "",
        "Comments summary:",
        cleanMultiLine(comments_summary, 1000) || "None",
        "",
        "ARCHETYPE PLAYBOOK:",
        archetypeGuide,
        "",
        "DESIGN PACK PLAYBOOK:",
        designGuide,
        "",
        "TEXT PRESET PLAYBOOK:",
        textPresetGuide,
        "",
        "LAYOUT TEMPLATE PLAYBOOK:",
        layoutGuide,
        "",
        "Important:",
        "- this must become a bright, polished, viral thumbnail",
        "- not a screenshot",
        "- not documentary style",
        "- stronger than the raw frame",
        "- suitable for YouTube homepage CTR",
        "- the headline should be hook-based, not just a chopped title",
        "- all important subjects and text must stay fully inside frame",
        "- do not put important text in the bottom-right timestamp zone",
        "- choose a typography treatment with real visual flavor",
        "- prefer headline phrases that still make sense even if one weak word is lost",
      ].join("\n");
    };

    const normalizeThumbnailStrategy = (raw = {}, context = {}) => {
      const archetypes = new Set([
        "comparison",
        "reaction",
        "object_focus",
        "before_after",
        "mystery",
        "challenge",
        "cinematic",
      ]);

      const designPacks = new Set([
        "clean_bold",
        "danger_red",
        "luxury_gold",
        "neon_gaming",
        "cinematic_blue",
        "tabloid_yellow",
        "tech_hud",
        "comic_impact",
      ]);

      const textPresets = new Set([
        "impact_white",
        "tabloid_yellow_red",
        "luxury_gold",
        "neon_racing",
        "cinematic_orange",
        "danger_red",
        "comic_burst",
        "tech_hud_cyan",
      ]);

      const layoutTemplates = new Set([
        "hero_top",
        "top_right_stack",
        "top_left_stack",
        "split_vs",
        "center_stack",
        "bottom_banner",
        "corner_badge",
      ]);

      const placements = new Set([
        "top_left",
        "top_center",
        "top_right",
        "upper_left",
        "upper_right",
        "center_top",
        "bottom_center",
      ]);

      const reserveZones = new Set([
        "top_25_percent",
        "top_28_percent",
        "top_30_percent",
        "top_35_percent",
        "top_right_30_percent",
        "top_left_30_percent",
        "bottom_22_percent",
      ]);

      const hookTypes = new Set([
        "shock",
        "mystery",
        "comparison",
        "status",
        "danger",
        "reward",
        "awe",
        "proof",
        "transformation",
      ]);

      const cleanConcept = (x = {}) => ({
        label: cleanOneLine(x.label || "concept", 40),
        scene_concept: cleanOneLine(x.scene_concept || "", 260),
        composition: cleanOneLine(x.composition || "", 240),
      });

      const archetype = archetypes.has(raw.thumbnail_archetype)
        ? raw.thumbnail_archetype
        : detectThumbnailArchetype({
            videoTitle: context.video_title,
            prompt: `${context.user_prompt} ${context.additional_instructions}`,
            description: context.video_description,
            transcript: context.transcript,
            emotionalAngle: context.emotional_angle,
            topicKeywords: context.topic_keywords,
          });

      const hookType = hookTypes.has(raw.hook_type)
        ? raw.hook_type
        : detectHookType({
            videoTitle: context.video_title,
            description: context.video_description,
            transcript: context.transcript,
            emotionalAngle: context.emotional_angle,
            topicKeywords: context.topic_keywords,
          });

      const maxWords = getHeadlineMaxWords(context, archetype);

      const textOptions = Array.isArray(raw.text_options)
        ? raw.text_options
            .map((x) => clipWords(cleanOneLine(x, 60), maxWords))
            .filter(Boolean)
            .slice(0, 5)
        : [];

      const conceptOptions = Array.isArray(raw.concept_options)
        ? raw.concept_options
            .map(cleanConcept)
            .filter((x) => x.scene_concept)
            .slice(0, 3)
        : [];

      const bestText = clipWords(
        cleanOneLine(
          raw.headline || raw.best_text || textOptions[0] || "",
          60
        ),
        maxWords
      ).toUpperCase();

      const designPack = designPacks.has(raw.design_pack)
        ? raw.design_pack
        : chooseDesignPackFallback(context, archetype);

      const layoutTemplate = layoutTemplates.has(raw.layout_template)
        ? raw.layout_template
        : chooseLayoutTemplateFallback(context, archetype);

      const textPreset = textPresets.has(raw.text_preset)
        ? raw.text_preset
        : chooseTextPresetFallback(designPack, context, archetype);

      const reserveZone = reserveZones.has(raw.reserve_zone)
        ? raw.reserve_zone
        : chooseReserveZoneFallback(layoutTemplate);

      const textPlacement = placements.has(raw.text_placement)
        ? raw.text_placement
        : chooseTextPlacementFallback(layoutTemplate);

      let headlineLines = Array.isArray(raw.headline_lines)
        ? raw.headline_lines
            .map((x) => cleanOneLine(x, 30).toUpperCase())
            .filter(Boolean)
            .slice(0, 2)
        : [];

      if (!headlineLines.length && bestText) {
        headlineLines = splitHeadlineLines(bestText, 2);
      }

      return {
        thumbnail_archetype: archetype,
        design_pack: designPack,
        hook_type: hookType,
        headline: bestText,
        subheadline: clipWords(cleanOneLine(raw.subheadline || "", 30), 3).toUpperCase(),
        best_text: bestText,
        text_options: textOptions.length
          ? textOptions.map((x) => x.toUpperCase())
          : bestText
          ? [bestText]
          : [],
        layout_template: layoutTemplate,
        text_preset: textPreset,
        text_placement: textPlacement,
        reserve_zone: reserveZone,
        safe_margin: cleanOneLine(raw.safe_margin || "8_percent", 20) || "8_percent",
        accent_words: uniqueStrings(raw.accent_words || [], 3).map((x) =>
          cleanOneLine(x, 20).toUpperCase()
        ),
        headline_lines: headlineLines,
        concept_options: conceptOptions,
        visual_mood: cleanOneLine(raw.visual_mood || "", 180),
        color_strategy: cleanOneLine(raw.color_strategy || "", 180),
        text_style: cleanOneLine(raw.text_style || "", 220),
        subject_scale: cleanOneLine(
          raw.subject_scale || "large but fully inside frame",
          80
        ),
        avoid: uniqueStrings(raw.avoid || [], 12),
      };
    };

    const chooseBestConcept = (strategy, context) => {
      const concepts = Array.isArray(strategy?.concept_options)
        ? strategy.concept_options
        : [];

      if (!concepts.length) {
        return {
          label: "hero",
          scene_concept:
            "large expressive subject in foreground, topic-specific redesigned background, dramatic contrast, strong viral YouTube packaging",
          composition:
            "huge focal subject, strong hierarchy, safe margins, clear negative space for headline, premium clickbait framing",
        };
      }

      const title = `${context.video_title} ${context.video_topic} ${context.emotional_angle}`.toLowerCase();
      const archetype = strategy.thumbnail_archetype;
      const layoutTemplate = strategy.layout_template || "";
      const reserveZone = strategy.reserve_zone || "";

      const scoreConcept = (c) => {
        let score = 0;
        const text = `${c.label} ${c.scene_concept} ${c.composition}`.toLowerCase();

        if (archetype === "comparison" && /(split|left|right|versus|vs|contrast)/i.test(text)) score += 5;
        if (archetype === "reaction" && /(face|reaction|expression|surprise|shock)/i.test(text)) score += 5;
        if (archetype === "object_focus" && /(object|product|item|oversized|dominant)/i.test(text)) score += 5;
        if (archetype === "before_after" && /(before|after|split|transform)/i.test(text)) score += 5;
        if (archetype === "mystery" && /(hidden|unknown|mystery|strange|secret)/i.test(text)) score += 5;
        if (archetype === "challenge" && /(challenge|risk|pressure|stakes|survive)/i.test(text)) score += 5;
        if (archetype === "cinematic" && /(cinematic|atmosphere|dramatic|moody|hero|night|vista|travel|volcano)/i.test(text)) score += 5;

        if (layoutTemplate === "split_vs" && /(split|left|right|two sides|versus)/i.test(text)) score += 3;
        if (layoutTemplate === "top_right_stack" && /(left subject|space on right|negative space|top-right)/i.test(text)) score += 3;
        if (layoutTemplate === "top_left_stack" && /(right subject|space on left|negative space|top-left)/i.test(text)) score += 3;
        if (/top_right_30_percent|top_left_30_percent|top_30_percent|top_25_percent/.test(reserveZone) && /(space|negative space|clean top|headline area)/i.test(text)) score += 2;

        if (/(zoo|animal)/i.test(title) && /(animal|zoo|wild|creature)/i.test(text)) score += 5;
        if (/(school|schools)/i.test(title) && /(school|building|campus|students)/i.test(text)) score += 5;
        if (/(burger|food|cheap|expensive|steak)/i.test(title) && /(burger|food|cheap|expensive|split|steak)/i.test(text)) score += 5;
        if (/(music|audio|song|official audio|daft punk)/i.test(title) && /(stage|neon|performance|artist|helmet|music|sun|band)/i.test(text)) score += 5;
        if (/(gpu|intel|cpu|tech|test|review)/i.test(title) && /(chip|benchmark|lab|tech|device|processor)/i.test(text)) score += 4;
        if (/(turbo|turbine)/i.test(title) && /(turbo|turbine|engine|mechanical|truth|myth)/i.test(text)) score += 4;
        if (/(golf|bmw|kia|mercedes|wey|night drive|skeler)/i.test(title) && /(car|track|race|city|neon|night)/i.test(text)) score += 5;
        if (/(switzerland|flight|flying|alps|sicily|volcano|italy)/i.test(title) && /(mountain|vista|alps|flight|sky|landscape|island|volcano|city)/i.test(text)) score += 5;

        if (/(large|huge|dominant|foreground|clear subject)/i.test(text)) score += 2;
        if (/(safe margins|inside frame|negative space|fully visible)/i.test(text)) score += 3;
        if (/(bright|contrast|viral|thumbnail)/i.test(text)) score += 1;

        return score;
      };

      return [...concepts].sort((a, b) => scoreConcept(b) - scoreConcept(a))[0];
    };

    const buildNanoBananaPrompt = ({
      context,
      strategy,
      concept,
      text,
    }) => {
      const hints = detectTopicHints({
        videoTitle: context.video_title,
        prompt: `${context.user_prompt} ${context.additional_instructions}`,
        channelName: context.channel_name,
        description: context.video_description,
        transcript: context.transcript,
        topicKeywords: context.topic_keywords,
      });

      const pack = DESIGN_PACKS[strategy.design_pack] || DESIGN_PACKS.clean_bold;
      const preset =
        TEXT_PRESETS[strategy.text_preset] || TEXT_PRESETS.impact_white;
      const layoutDescription =
        LAYOUT_TEMPLATES[strategy.layout_template] ||
        LAYOUT_TEMPLATES.hero_top;

      const headline = cleanOneLine(strategy.headline || text, 60).toUpperCase();
      const subheadline = cleanOneLine(strategy.subheadline || "", 30).toUpperCase();
      const headlineLines =
        Array.isArray(strategy.headline_lines) && strategy.headline_lines.length
          ? strategy.headline_lines.join(" | ")
          : splitHeadlineLines(headline, 2).join(" | ");

      return [
        "Create a NEW highly clickable YouTube thumbnail from the provided source image.",
        "This must look like a polished viral thumbnail, not a screenshot.",
        "Do NOT preserve the literal original frame composition if it hurts CTR.",
        "Redesign the scene into a stronger thumbnail composition.",
        "Leave at least 8% safe margin from image borders.",
        "Do not crop the face or main subject.",
        "Keep headline away from edges.",
        "",
        `Thumbnail archetype: ${strategy.thumbnail_archetype}.`,
        `Hook type: ${strategy.hook_type}.`,
        `Design pack: ${strategy.design_pack}.`,
        `Design pack look: ${pack.look}.`,
        `Design pack colors: ${pack.colors}.`,
        `Layout template: ${strategy.layout_template}.`,
        `Layout intent: ${layoutDescription}.`,
        `Text preset: ${strategy.text_preset}.`,
        `Text preset description: ${preset.description}.`,
        `Text placement: ${strategy.text_placement}.`,
        `Reserved text zone: ${strategy.reserve_zone}.`,
        `Safe margin: ${strategy.safe_margin}.`,
        "",
        `Video topic/title: ${cleanOneLine(context.video_title, 260) || "Unknown"}.`,
        context.channel_name
          ? `Channel context: ${cleanOneLine(context.channel_name, 140)}.`
          : "",
        context.video_topic
          ? `Topic summary: ${cleanOneLine(context.video_topic, 220)}.`
          : "",
        context.emotional_angle
          ? `Emotional angle: ${cleanOneLine(context.emotional_angle, 180)}.`
          : "",
        "",
        `Scene concept: ${concept.scene_concept}.`,
        `Composition: ${concept.composition}.`,
        `Visual mood: ${strategy.visual_mood || hints.visualMood}.`,
        `Color strategy: ${strategy.color_strategy || hints.colors}.`,
        `Typography direction: ${strategy.text_style || preset.description}.`,
        `Subject scale: ${strategy.subject_scale || "large but fully inside frame"}.`,
        "",
        "CRITICAL RULES:",
        "- This is a thumbnail image, not a screenshot of YouTube.",
        "- Do NOT include any video player UI.",
        "- Do NOT include duration timestamps like 12:45.",
        "- Do NOT include play buttons or progress bars.",
        "- Do NOT simulate YouTube interface elements.",
        "- The image must look like a clean standalone thumbnail graphic.",
        "",
        "CRITICAL COMPOSITION RULES:",
        "- Keep all important elements fully inside frame.",
        "- Do not crop the face, main object, car, food, or headline by image borders.",
        "- Leave generous breathing room near the top edge and right edge.",
        "- Keep the full headline clearly visible inside the canvas.",
        "- Leave the bottom-right corner relatively cleaner for the YouTube timestamp.",
        "- Main subject must feel large and dominant, but still fully contained inside frame.",
        "- Leave enough negative space behind the headline for maximum readability.",
        "- Avoid chaotic overlap between headline and subject unless it looks intentional and premium.",
        "- Avoid cramped framing.",
        "",
        "CRITICAL TEXT RULES:",
        `- Render this exact main headline exactly once: "${headline}".`,
        subheadline
          ? `- You may render this short secondary subheadline only if it improves composition: "${subheadline}".`
          : "- Do not add any subtitle unless it clearly improves composition.",
        `- Preferred headline line breaks: ${headlineLines}.`,
        "- Do not change the spelling.",
        "- Do not add extra words.",
        "- Do not repeat the text.",
        "- Do not add random letters, fake UI, captions, labels, subtitles, logos, or watermark text.",
        "- Keep the headline to 1 or 2 lines maximum.",
        "- The headline must be fully legible at mobile size.",
        "- Use a premium, stylized, high-CTR typography treatment.",
        "- Do NOT default to boring plain white text unless absolutely necessary.",
        "- Prefer color contrast, gradients, accent words, italic motion, tabloid treatment, comic burst energy, or luxury styling when appropriate.",
        strategy.accent_words?.length
          ? `- Make these words visually dominant if appropriate: ${strategy.accent_words.join(", ")}.`
          : "",
        "",
        "VISUAL GOAL:",
        "- The final image should feel expensive, dramatic, and instantly clickable on the YouTube homepage.",
        "- Use stronger visual packaging than the original frame.",
        "- Emphasize the topic visually, not only through text.",
        "",
        "Avoid:",
        ...(strategy.avoid || []).map((x) => `- ${x}`),
        "- plain boring default white text",
        "- cropped headline",
        "- text touching the edges",
        "- cropped subject",
        "- weak contrast",
        "- tiny unreadable typography",
        "- messy composition",
        "- screenshot feel",
        "- literal unchanged frame layout",
        "- YouTube UI elements",
        "- timestamp overlays",
        "- duration badges like 12:45",
        "- play buttons",
        "- progress bars",
        "- video player interface",
        "- subscribe buttons",
        "- channel watermarks",
        "- fake UI elements",
        "",
        context.additional_instructions
          ? `Highest priority user instructions: ${cleanMultiLine(
              context.additional_instructions,
              1200
            )}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    };

    const generateThumbnailPlan = async (context) => {
      const payload = {
        chatId: `thumb-${crypto.randomUUID()}`,
        model: OVERCHAT_MODEL,
        personaId: OVERCHAT_PERSONA_ID,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: OVERCHAT_MAX_TOKENS,
        stream: false,
        temperature: 0.95,
        top_p: 0.95,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "system",
            content: buildOverchatSystemPrompt(),
          },
          {
            id: crypto.randomUUID(),
            role: "user",
            content: buildOverchatUserPrompt(context),
          },
        ],
      };

      const chatResp = await overchatFetch(payload);

      const fallbackArchetype = detectThumbnailArchetype({
        videoTitle: context.video_title,
        prompt: `${context.user_prompt} ${context.additional_instructions}`,
        description: context.video_description,
        transcript: context.transcript,
        emotionalAngle: context.emotional_angle,
        topicKeywords: context.topic_keywords,
      });

      const fallbackHookType = detectHookType({
        videoTitle: context.video_title,
        description: context.video_description,
        transcript: context.transcript,
        emotionalAngle: context.emotional_angle,
        topicKeywords: context.topic_keywords,
      });

      const fallbackText = heuristicThumbnailText({
        customText: context.custom_text,
        videoTitle: context.video_title,
        archetype: fallbackArchetype,
        hookType: fallbackHookType,
        context,
      });

      const fallbackDesignPack = chooseDesignPackFallback(
        context,
        fallbackArchetype
      );
      const fallbackLayoutTemplate = chooseLayoutTemplateFallback(
        context,
        fallbackArchetype
      );
      const fallbackTextPreset = chooseTextPresetFallback(
        fallbackDesignPack,
        context,
        fallbackArchetype
      );

      const fallbackStrategy = {
        thumbnail_archetype: fallbackArchetype,
        design_pack: fallbackDesignPack,
        hook_type: fallbackHookType,
        headline: fallbackText,
        subheadline: "",
        best_text: fallbackText,
        text_options: [fallbackText],
        layout_template: fallbackLayoutTemplate,
        text_preset: fallbackTextPreset,
        text_placement: chooseTextPlacementFallback(fallbackLayoutTemplate),
        reserve_zone: chooseReserveZoneFallback(fallbackLayoutTemplate),
        safe_margin: "8_percent",
        accent_words: splitHeadlineLines(fallbackText, 2)
          .flatMap((x) => x.split(/\s+/))
          .filter(Boolean)
          .slice(-1),
        headline_lines: splitHeadlineLines(fallbackText, 2),
        concept_options: [
          {
            label: "hero",
            scene_concept:
              "large expressive subject in foreground, topic-specific redesigned background, dramatic contrast, strong viral YouTube packaging",
            composition:
              "huge focal subject, strong hierarchy, safe margins, clear negative space for headline, premium clickbait framing",
          },
          {
            label: "clean contrast",
            scene_concept:
              "dominant subject with brighter redesigned background and strong separation for headline",
            composition:
              "clear subject, reserved top headline area, all major elements fully visible inside frame",
          },
          {
            label: "premium click",
            scene_concept:
              "high-contrast polished thumbnail composition with emotional focal point and custom visual packaging",
            composition:
              "strong mobile readability, safe margins, controlled overlap, strong text visibility",
          },
        ],
        visual_mood: "bright, high-contrast, viral youtube thumbnail",
        color_strategy: "saturated accents, deep blacks, bright highlights",
        text_style:
          TEXT_PRESETS[fallbackTextPreset]?.description ||
          "huge bold text with strong outline and dramatic shadow",
        subject_scale: "large but fully inside frame",
        avoid: [
          "raw screenshot feel",
          "weak contrast",
          "small unreadable text",
          "cropped headline",
          "text touching edges",
        ],
      };

      let strategy = fallbackStrategy;
      let llm_error = null;
      let raw_model_response = null;

      if (chatResp.ok) {
        const rawContent = parseChatContent(chatResp.data);
        const parsed = safeJsonParse(rawContent) || {};
        raw_model_response = parsed;
        strategy = normalizeThumbnailStrategy(parsed, context);

        if (!strategy.best_text) {
          strategy.best_text = fallbackText;
          strategy.headline = fallbackText;
        }

        if (!strategy.text_options.length) {
          strategy.text_options = [strategy.best_text];
        }

        if (!strategy.concept_options.length) {
          strategy.concept_options = fallbackStrategy.concept_options;
        }

        if (!strategy.design_pack) {
          strategy.design_pack = fallbackDesignPack;
        }

        if (!strategy.layout_template) {
          strategy.layout_template = fallbackLayoutTemplate;
        }

        if (!strategy.text_preset) {
          strategy.text_preset = fallbackTextPreset;
        }

        if (!strategy.reserve_zone) {
          strategy.reserve_zone = chooseReserveZoneFallback(strategy.layout_template);
        }

        if (!strategy.text_placement) {
          strategy.text_placement = chooseTextPlacementFallback(strategy.layout_template);
        }

        if (!strategy.headline_lines?.length) {
          strategy.headline_lines = splitHeadlineLines(strategy.headline, 2);
        }
      } else {
        llm_error = {
          ...classifyOverchatError(chatResp),
          status: chatResp.status,
          response: chatResp.data ?? chatResp.text,
        };
      }

      if (context.custom_text) {
        const maxWords = getHeadlineMaxWords(
          context,
          strategy.thumbnail_archetype
        );
        const forced = clipWords(context.custom_text, maxWords).toUpperCase();
        strategy.headline = forced;
        strategy.best_text = forced;
        strategy.headline_lines = splitHeadlineLines(forced, 2);
        strategy.text_options = [
          forced,
          ...strategy.text_options.filter((x) => x !== forced),
        ].slice(0, 5);
      }

      const bestConcept = chooseBestConcept(strategy, context);
      const bestText = strategy.best_text || fallbackText;

      const prompts = [
        buildNanoBananaPrompt({
          context,
          strategy,
          concept: bestConcept,
          text: bestText,
        }),
        buildNanoBananaPrompt({
          context,
          strategy,
          concept: strategy.concept_options[1] || bestConcept,
          text: strategy.text_options[1] || bestText,
        }),
        buildNanoBananaPrompt({
          context,
          strategy,
          concept: strategy.concept_options[2] || bestConcept,
          text: strategy.text_options[2] || bestText,
        }),
      ];

      return {
        ok: true,
        source: chatResp.ok ? "overchat_chat" : "fallback_after_overchat_error",
        strategy,
        best_prompt: prompts[0],
        image_prompts: prompts,
        usage: chatResp?.data?.usage || null,
        llm_error,
        raw_model_response,
      };
    };

    const buildRerollStrategy = (plan, newHeadline, context) => {
      const old = plan.strategy || {};
      const maxWords = getHeadlineMaxWords(context, old.thumbnail_archetype || "reaction");
      const headline = clipWords(cleanOneLine(newHeadline, 60), maxWords).toUpperCase();

      return {
        ...old,
        headline,
        best_text: headline,
        text_options: uniqueOrdered([
          headline,
          ...(old.text_options || []),
        ]).slice(0, 5),
        headline_lines: splitHeadlineLines(headline, 2),
        accent_words: splitHeadlineLines(headline, 2)
          .flatMap((x) => x.split(/\s+/))
          .filter(Boolean)
          .slice(-1),
      };
    };

    const scoreImageCandidate = (url, plan, context, idx = 0) => {
      let score = 0;
      const archetype = plan?.strategy?.thumbnail_archetype || "";
      const designPack = plan?.strategy?.design_pack || "";
      const textPreset = plan?.strategy?.text_preset || "";
      const layoutTemplate = plan?.strategy?.layout_template || "";
      const title = `${context.video_title} ${context.video_topic}`.toLowerCase();

      if (plan?.strategy?.best_text) score += 5;
      if (plan?.strategy?.headline) score += 3;
      if (plan?.strategy?.concept_options?.length) score += 4;
      if (plan?.strategy?.visual_mood) score += 2;
      if (plan?.strategy?.color_strategy) score += 2;
      if (plan?.strategy?.reserve_zone) score += 2;
      if (plan?.strategy?.safe_margin) score += 1;

      if (archetype === "comparison") score += 4;
      if (archetype === "reaction") score += 2;
      if (archetype === "object_focus") score += 2;
      if (archetype === "cinematic") score += 3;
      if (designPack && designPack !== "clean_bold") score += 2;
      if (textPreset && textPreset !== "impact_white") score += 3;
      if (layoutTemplate === "split_vs") score += 2;

      if (/(zoo|animal)/i.test(title) && archetype === "reaction") score += 2;
      if (/(school|schools)/i.test(title) && archetype === "object_focus") score += 2;
      if (/(burger|cheap|expensive|steak)/i.test(title) && archetype === "comparison") score += 4;
      if (/(gpu|intel|cpu|tech)/i.test(title) && /tech_hud|neon_gaming/.test(designPack)) score += 3;
      if (/(turbo|turbine)/i.test(title) && archetype === "mystery") score += 2;
      if (/(golf|bmw|kia|mercedes|skeler|night drive)/i.test(title) && /cinematic_blue|neon_gaming/.test(designPack)) score += 4;
      if (/(music|daft punk|get lucky)/i.test(title) && /cinematic_blue|luxury_gold/.test(designPack)) score += 4;
      if (/(switzerland|flight|alps|sicily|italy|volcano)/i.test(title) && archetype === "cinematic") score += 3;

      score += Math.max(0, 2 - idx);

      return score;
    };

    const evaluateThumbnailVision = async (imageUrl, plan, context) => {
      const expected = plan?.strategy?.headline || plan?.strategy?.best_text || "";
      const alternatives = uniqueOrdered(
        [
          expected,
          ...(plan?.strategy?.text_options || []),
          chooseSaferShortHeadline(expected, context),
        ].filter(Boolean)
      );

      const payload = {
        chatId: `thumb-judge-${crypto.randomUUID()}`,
        model: OVERCHAT_MODEL,
        personaId: OVERCHAT_PERSONA_ID,
        frequency_penalty: 0,
        presence_penalty: 0,
        max_tokens: 700,
        stream: false,
        temperature: 0.1,
        top_p: 0.8,
        messages: [
          {
            id: crypto.randomUUID(),
            role: "system",
            content: [
              "You are a strict YouTube thumbnail QA judge.",
              "Evaluate the attached thumbnail image.",
              "You must check:",
              "1. What text is actually visible.",
              "2. Whether the full intended headline is present.",
              "3. Whether words are missing.",
              "4. Whether letters look garbled or malformed.",
              "5. Whether text is cut off by image edges.",
              "6. Whether the main subject is cut off.",
              "7. Whether fake YouTube UI exists, including timestamp badges.",
              "8. Whether the composition looks balanced.",
              "Be strict about visible text quality.",
              "Return only valid JSON.",
              `Return JSON in this exact shape:
{
  "score": 0,
  "detected_text": "",
  "text_readable": false,
  "text_fully_present": false,
  "missing_words": [],
  "extra_words": [],
  "has_garbled_letters": false,
  "text_cut_off": false,
  "subject_cut_off": false,
  "has_fake_ui": false,
  "acceptable_shortened_variant": false,
  "notes": ""
}`,
            ].join("\n"),
          },
          {
            id: crypto.randomUUID(),
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `Video title: ${context.video_title}`,
                  `Expected headline: ${expected}`,
                  `Acceptable shorter variants: ${alternatives.join(" | ") || "None"}`,
                  `Language: ${context.language || "unknown"}`,
                ].join("\n"),
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
      };

      const r = await overchatFetch(payload);
      if (!r.ok) {
        return {
          score: 5,
          detected_text: "",
          text_readable: false,
          text_fully_present: false,
          missing_words: [],
          extra_words: [],
          has_garbled_letters: false,
          text_cut_off: false,
          subject_cut_off: false,
          has_fake_ui: false,
          acceptable_shortened_variant: false,
          notes: "judge_failed",
        };
      }

      const parsed = safeJsonParse(parseChatContent(r.data)) || {};
      return {
        score: Number(parsed.score || 0),
        detected_text: cleanOneLine(parsed.detected_text || "", 120),
        text_readable: !!parsed.text_readable,
        text_fully_present: !!parsed.text_fully_present,
        missing_words: uniqueStrings(parsed.missing_words || [], 10).map((x) =>
          cleanOneLine(x, 30).toUpperCase()
        ),
        extra_words: uniqueStrings(parsed.extra_words || [], 10).map((x) =>
          cleanOneLine(x, 30).toUpperCase()
        ),
        has_garbled_letters: !!parsed.has_garbled_letters,
        text_cut_off: !!parsed.text_cut_off,
        subject_cut_off: !!parsed.subject_cut_off,
        has_fake_ui: !!parsed.has_fake_ui,
        acceptable_shortened_variant: !!parsed.acceptable_shortened_variant,
        notes: cleanOneLine(parsed.notes || "", 240),
      };
    };

    const computeJudgePenalty = (judge) => {
      let penalty = 0;
      if (!judge?.text_readable) penalty += 12;
      if (!judge?.text_fully_present) penalty += 20;
      if (judge?.missing_words?.length) penalty += judge.missing_words.length * 8;
      if (judge?.has_garbled_letters) penalty += 14;
      if (judge?.text_cut_off) penalty += 12;
      if (judge?.subject_cut_off) penalty += 8;
      if (judge?.has_fake_ui) penalty += 10;
      if (judge?.acceptable_shortened_variant) penalty -= 8;
      return penalty;
    };

    const shouldRerollFromEvaluated = (evaluated) => {
      if (!evaluated?.length) return true;
      const best = [...evaluated].sort((a, b) => b.score - a.score)[0];
      if (!best) return true;

      const j = best.vision || {};
      if (j.text_fully_present && j.text_readable && !j.has_garbled_letters && !j.text_cut_off) {
        return false;
      }

      if (
        j.acceptable_shortened_variant &&
        j.text_readable &&
        !j.has_garbled_letters &&
        !j.text_cut_off
      ) {
        return false;
      }

      return true;
    };

    const makeSaferHeadlineVariants = async (headline, context = {}) => {
      const heuristic = [];
      const safer = chooseSaferShortHeadline(headline, context);
      if (safer) heuristic.push(safer);

      const words = tokenizeLoose(headline);
      if (words.length >= 2) heuristic.push(words.slice(-2).join(" "));
      if (words.length >= 2) heuristic.push(words.slice(0, 2).join(" "));

      const llmVariants = await buildShorterHeadlineCandidatesWithLLM(headline, context);

      return uniqueOrdered(
        [
          ...llmVariants,
          ...heuristic.map((x) => cleanOneLine(x, 60).toUpperCase()),
        ].filter(Boolean)
      ).slice(0, 3);
    };

    const submitFalGeneration = async ({
      prompts,
      context,
      aspect_ratio,
      enable_safety_checker,
      seed,
    }) => {
      const submitResults = [];

      for (let i = 0; i < prompts.length; i++) {
        const input = {
          prompt: prompts[i],
          image_urls: [context.image_url],
          aspect_ratio,
          num_images: 1,
          max_images: 1,
          enable_safety_checker,
          ...(seed !== undefined && seed !== null
            ? { seed: Number(seed) + i }
            : {}),
        };

        const submit = await falFetch(FAL_MODEL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!submit.ok) {
          const info = classifyFalError(submit);
          throw new Error(
            JSON.stringify({
              error: "fal submit failed",
              details: {
                ...info,
                status: submit.status,
                response: submit.data ?? submit.text,
                sent_model: FAL_MODEL,
                sent_input: input,
              },
            })
          );
        }

        const request_id = submit.data?.request_id;
        if (!request_id) {
          throw new Error(
            JSON.stringify({
              error: "fal submit response missing request_id",
              details: submit.data,
            })
          );
        }

        submitResults.push({
          request_id,
          prompt: prompts[i],
          status_url: submit.data?.status_url || submit.data?.status?.url || null,
          response_url:
            submit.data?.response_url || submit.data?.response?.url || null,
          cancel_url: submit.data?.cancel_url || submit.data?.cancel?.url || null,
          idx: i,
        });
      }

      const pollOne = async (item) => {
        const statusUrl = item.status_url;
        const responseUrl = item.response_url;
        if (!statusUrl || !responseUrl) {
          return { ok: false, error: "Missing status_url or response_url", item };
        }

        const t0 = Date.now();
        const timeoutMs = 120000;

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 1200));

          let u;
          try {
            u = new URL(statusUrl);
          } catch {
            return { ok: false, error: "Bad status url", item };
          }

          const statusPath = u.pathname.replace(/^\//, "") + (u.search || "");
          const st = await falFetch(statusPath, { method: "GET" });

          if (!st.ok) {
            return {
              ok: false,
              error: "fal status failed",
              details: classifyFalError(st),
              item,
            };
          }

          const s = String(st?.data?.status || st?.data?.state || "").toLowerCase();

          if (s.includes("complete") || s.includes("succeed")) {
            let ru;
            try {
              ru = new URL(responseUrl);
            } catch {
              return { ok: false, error: "Bad result url", item };
            }

            const resultPath = ru.pathname.replace(/^\//, "") + (ru.search || "");
            const res = await falFetch(resultPath, { method: "GET" });

            if (!res.ok) {
              return {
                ok: false,
                error: "fal result failed",
                details: classifyFalError(res),
                item,
              };
            }

            const payload = res.data && typeof res.data === "object" ? res.data : {};
            const imageUrl =
              payload?.images?.[0]?.url ||
              payload?.output?.images?.[0]?.url ||
              payload?.image?.url ||
              payload?.image_url ||
              null;

            if (!imageUrl) {
              return { ok: false, error: "No image URL in result", payload, item };
            }

            return {
              ok: true,
              image_url: imageUrl,
              payload,
              item,
            };
          }

          if (s.includes("fail") || s.includes("error")) {
            return { ok: false, error: "generation failed", status: st.data, item };
          }

          if (Date.now() - t0 > timeoutMs) {
            return { ok: false, error: "timeout", item };
          }
        }
      };

      const settled = [];
      for (const item of submitResults) {
        settled.push(await pollOne(item));
      }

      return settled;
    };

    const evaluateCandidates = async ({ successful, plan, context }) => {
      const evaluated = [];

      for (const item of successful) {
        const baseScore = scoreImageCandidate(
          item.image_url,
          plan,
          context,
          item.item.idx
        );

        const vision = await evaluateThumbnailVision(
          item.image_url,
          plan,
          context
        );

        const finalScore =
          baseScore +
          (Number(vision?.score || 0) * 2) -
          computeJudgePenalty(vision);

        evaluated.push({
          ...item,
          baseScore,
          vision,
          score: finalScore,
        });
      }

      return evaluated.sort((a, b) => b.score - a.score);
    };

    if (
      url.pathname === "/" ||
      url.pathname === "/api" ||
      url.pathname === "/api/health"
    ) {
      return json({
        ok: true,
        service: "oc-thumbnail-worker",
        model: FAL_MODEL,
        overchat_api_url: OVERCHAT_API_URL,
        overchat_model: OVERCHAT_MODEL,
        overchat_persona_id: OVERCHAT_PERSONA_ID,
        routes: {
          oembed: "GET  /api/oembed?url=YOUTUBE_URL",
          chat_prompt: "POST /api/chat-prompt",
          submit: "POST /api/generate",
          status: "GET  /api/status?url=STATUS_URL",
          result: "GET  /api/result?url=RESPONSE_URL",
        },
      });
    }

    if (url.pathname === "/api/oembed" && request.method === "GET") {
      const yt = url.searchParams.get("url");
      if (!yt) return bad("Missing query param: url");

      const id = extractYouTubeId(yt);
      if (!id) {
        return bad("Not a YouTube URL or cannot extract video id.", { url: yt });
      }

      const canonical = `https://www.youtube.com/watch?v=${id}`;
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        canonical
      )}`;

      try {
        const r = await fetch(oembedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json,text/plain,*/*",
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

    if (url.pathname === "/api/chat-prompt" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return bad("Invalid JSON body.");
      }

      const context = normalizeVideoContext(body || {});
      const plan = await generateThumbnailPlan(context);

      return json({
        ok: true,
        source: plan.source,
        video_context: context,
        strategy: plan.strategy,
        image_prompts: plan.image_prompts,
        best_prompt: plan.best_prompt,
        llm_usage: plan.usage || null,
        llm_error: plan.llm_error || null,
        raw_model_response: plan.raw_model_response || null,
      });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return bad("Invalid JSON body.");
      }

      const context = normalizeVideoContext(body || {});
      const {
        image_size = "landscape_16_9",
        aspect_ratio: bodyAspectRatio,
        enable_safety_checker = true,
        seed,
      } = body || {};

      if (!context.image_url) {
        return bad("Missing required field: image_url");
      }

      const aspect_ratio = bodyAspectRatio || mapImageSizeToAspectRatio(image_size);

      const plan = await generateThumbnailPlan(context);
      const initialPrompts =
        Array.isArray(plan.image_prompts) && plan.image_prompts.length
          ? plan.image_prompts
          : [plan.best_prompt];

      let settled;
      try {
        settled = await submitFalGeneration({
          prompts: initialPrompts,
          context,
          aspect_ratio,
          enable_safety_checker,
          seed,
        });
      } catch (e) {
        let parsedErr = null;
        try {
          parsedErr = JSON.parse(String(e.message || ""));
        } catch {}
        return bad(
          parsedErr?.error || "fal submit failed",
          {
            ...(parsedErr?.details || null),
            strategy: plan.strategy,
            prompt_source: plan.source,
            llm_error: plan.llm_error || null,
          },
          400
        );
      }

      const successful = settled.filter((x) => x.ok && x.image_url);

      if (!successful.length) {
        return bad("All generation attempts failed", { attempts: settled }, 500);
      }

      let ranked = await evaluateCandidates({
        successful,
        plan,
        context,
      });

      let reroll = null;
      let selected = ranked[0];

      if (shouldRerollFromEvaluated(ranked)) {
        const originalHeadline = plan.strategy?.headline || plan.strategy?.best_text || "";
        const saferVariants = await makeSaferHeadlineVariants(originalHeadline, context);

        if (saferVariants.length) {
          const rerollHeadline = saferVariants[0];
          const rerollStrategy = buildRerollStrategy(plan, rerollHeadline, context);
          const rerollConcept = chooseBestConcept(rerollStrategy, context);

          const rerollPrompts = [
            buildNanoBananaPrompt({
              context,
              strategy: rerollStrategy,
              concept: rerollConcept,
              text: rerollStrategy.best_text,
            }),
            buildNanoBananaPrompt({
              context,
              strategy: rerollStrategy,
              concept: rerollStrategy.concept_options?.[1] || rerollConcept,
              text: saferVariants[1] || rerollStrategy.best_text,
            }),
          ];

          let rerollSettled = [];
          try {
            rerollSettled = await submitFalGeneration({
              prompts: rerollPrompts,
              context,
              aspect_ratio,
              enable_safety_checker,
              seed: seed !== undefined && seed !== null ? Number(seed) + 1000 : undefined,
            });
          } catch (_) {}

          const rerollSuccessful = rerollSettled.filter((x) => x.ok && x.image_url);

          if (rerollSuccessful.length) {
            const rerollPlan = {
              ...plan,
              strategy: rerollStrategy,
              image_prompts: rerollPrompts,
              best_prompt: rerollPrompts[0],
            };

            const rerollRanked = await evaluateCandidates({
              successful: rerollSuccessful,
              plan: rerollPlan,
              context,
            });

            const rerollBest = rerollRanked[0];
            reroll = {
              used: true,
              original_headline: originalHeadline,
              reroll_headline: rerollHeadline,
              candidate_headlines: saferVariants,
              ranked: rerollRanked.map((x) => ({
                image_url: x.image_url,
                score: x.score,
                baseScore: x.baseScore,
                vision: x.vision,
              })),
            };

            if (rerollBest && rerollBest.score > (selected?.score ?? -Infinity)) {
              selected = {
                ...rerollBest,
                reroll_plan: rerollPlan,
              };
            }
          } else {
            reroll = {
              used: true,
              original_headline: originalHeadline,
              reroll_headline: rerollHeadline,
              candidate_headlines: saferVariants,
              ranked: [],
            };
          }
        }
      }

      const finalPlan = selected?.reroll_plan || plan;

      return json({
        ok: true,
        model: FAL_MODEL,
        overchat_model: OVERCHAT_MODEL,
        overchat_persona_id: OVERCHAT_PERSONA_ID,
        prompt_source: finalPlan.source,
        strategy: finalPlan.strategy,
        best_prompt: selected?.item?.prompt || finalPlan.best_prompt,
        llm_usage: plan.usage || null,
        llm_error: plan.llm_error || null,
        request_id: selected?.item?.request_id || null,
        image_url: selected?.image_url || null,
        images: selected?.image_url ? [{ url: selected.image_url }] : [],
        vision: selected?.vision || null,
        debug: {
          aspect_ratio,
          attempts_total: initialPrompts.length,
          attempts_successful: successful.length,
          initial_ranked: ranked.map((x) => ({
            image_url: x.image_url,
            score: x.score,
            baseScore: x.baseScore,
            vision: x.vision,
          })),
          reroll,
          selected_score: selected?.score ?? null,
        },
      });
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({
        ok: true,
        status: "completed",
        note: "Synchronous best-of-multiple generation flow is now used in /api/generate",
      });
    }

    if (url.pathname === "/api/result" && request.method === "GET") {
      return json({
        ok: true,
        note: "Use image_url directly from /api/generate response",
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
