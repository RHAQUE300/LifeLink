const ALLOWED_ORIGIN = "https://rhaque300.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Vary": "Origin"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function verifyUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token || token.length > 10000) return null;

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase configuration missing");
  }

  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_PUBLISHABLE_KEY,
        "Authorization": `Bearer ${token}`
      },
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id ? user : null;
}

function availableModels(env) {
  return {
    groq: !!env.GROQ_API_KEY,
    gemini: !!env.GEMINI_API_KEY,
    openai: !!env.OPENAI_API_KEY,
    anthropic: !!env.ANTHROPIC_API_KEY
  };
}

function extractGeminiText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();

  const steps = Array.isArray(data.steps) ? data.steps : [];
  return steps
    .filter(step => step.type === "model_output")
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(item => item.type === "text")
    .map(item => item.text || "")
    .join("")
    .trim();
}

async function readProviderResponse(response, provider) {
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `HTTP ${response.status}`;
    console.error(provider + " error:", response.status, String(detail).slice(0, 500));
    throw new Error(provider + " request failed (" + response.status + ")");
  }
  return data;
}

async function askGroq(messages, env) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages,
        max_tokens: 2048,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await readProviderResponse(response, "Groq");
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("Groq returned no text");
  return reply;
}

async function askGemini(messages, env) {
  const conversation = messages.map(m => {
    const role =
      m.role === "system" ? "System" :
      m.role === "assistant" ? "Assistant" : "User";
    return `${role}: ${m.content}`;
  }).join("\n\n");

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input: conversation,
        store: false
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await readProviderResponse(response, "Gemini");
  const reply = extractGeminiText(data);
  if (!reply) throw new Error("Gemini returned no text");
  return reply;
}

async function askOpenAI(messages, env) {
  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 2048
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await readProviderResponse(response, "OpenAI");
  const content = data.choices?.[0]?.message?.content;
  const reply = Array.isArray(content)
    ? content.map(part => part.text || "").join("").trim()
    : String(content || "").trim();
  if (!reply) throw new Error("OpenAI returned no text");
  return reply;
}

async function askAnthropic(messages, env) {
  const system = messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");
  const conversation = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }));

  const response = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system,
        messages: conversation
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await readProviderResponse(response, "Anthropic");
  const reply = (data.content || [])
    .filter(part => part.type === "text")
    .map(part => part.text || "")
    .join("")
    .trim();
  if (!reply) throw new Error("Anthropic returned no text");
  return reply;
}

const PROVIDERS = {
  groq: askGroq,
  gemini: askGemini,
  openai: askOpenAI,
  anthropic: askAnthropic
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Google OAuth connection routes. Refresh tokens remain in Workers KV and are
    // keyed by the verified Supabase user ID, never by a browser-supplied account ID.
    const googleRoute = ["/api/google/connect", "/api/google/status", "/api/google/disconnect"].includes(url.pathname);
    if (googleRoute) {
      if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
      const expectedMethod = url.pathname === "/api/google/status" ? "GET" : "POST";
      if (request.method !== expectedMethod) return json({ error: "Method not allowed" }, 405);
      if (!env.GOOGLE_TOKENS) return json({ error: "Google token storage is not configured" }, 500);

      const user = await verifyUser(request, env);
      if (!user) return json({ error: "Authentication required" }, 401);
      const key = "google:" + user.id;

      if (url.pathname === "/api/google/status") {
        const saved = await env.GOOGLE_TOKENS.get(key, "json");
        return json({
          connected: !!(saved && saved.refresh_token),
          email: saved?.email || null,
          scopes: saved?.scope || ""
        });
      }

      if (request.headers.get("X-Requested-With") !== "XMLHttpRequest") {
        return json({ error: "Invalid request" }, 400);
      }

      if (url.pathname === "/api/google/disconnect") {
        const saved = await env.GOOGLE_TOKENS.get(key, "json");
        if (saved?.refresh_token) {
          try {
            await fetch("https://oauth2.googleapis.com/revoke", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: saved.refresh_token }),
              signal: AbortSignal.timeout(10000)
            });
          } catch (error) {
            console.error("Google token revocation request failed:", error.message);
          }
        }
        await env.GOOGLE_TOKENS.delete(key);
        return json({ connected: false });
      }

      // Trim accidental whitespace copied into Cloudflare variables/secrets.
      const googleClientId = typeof env.GOOGLE_CLIENT_ID === "string" ? env.GOOGLE_CLIENT_ID.trim() : "";
      const googleClientSecret = typeof env.GOOGLE_CLIENT_SECRET === "string" ? env.GOOGLE_CLIENT_SECRET.trim() : "";
      if (!googleClientId || !googleClientSecret) {
        return json({ error: "Google OAuth is not configured on the server" }, 500);
      }
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 12000) return json({ error: "Request too large" }, 413);
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "Invalid JSON" }, 400); }
      if (typeof body.code !== "string" || !body.code || body.code.length > 4096) {
        return json({ error: "Invalid authorization code" }, 400);
      }

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: body.code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: ALLOWED_ORIGIN,
          grant_type: "authorization_code"
        }),
        signal: AbortSignal.timeout(15000)
      });
      let tokens = {};
      try { tokens = await tokenResponse.json(); } catch {}
      if (!tokenResponse.ok || !tokens.access_token) {
        const googleError = typeof tokens.error === "string" ? tokens.error : "unknown error";
        const googleDescription = typeof tokens.error_description === "string" ? tokens.error_description.slice(0, 240) : "";
        console.error("Google authorization-code exchange failed:", tokenResponse.status, googleError, googleDescription);
        return json({
          error: "Google authorization failed: " + googleError + (googleDescription ? " — " + googleDescription : "")
        }, 400);
      }

      const existing = await env.GOOGLE_TOKENS.get(key, "json");
      const refreshToken = tokens.refresh_token || existing?.refresh_token;
      if (!refreshToken) {
        return json({ error: "Google did not provide a refresh token. Disconnect LifeLink from your Google Account permissions, then try again." }, 400);
      }

      let googleEmail = existing?.email || null;
      try {
        const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: "Bearer " + tokens.access_token },
          signal: AbortSignal.timeout(10000)
        });
        if (profileResponse.ok) {
          const profile = await profileResponse.json();
          if (typeof profile.email === "string") googleEmail = profile.email;
        }
      } catch (error) {
        console.error("Google profile lookup failed:", error.message);
      }

      await env.GOOGLE_TOKENS.put(key, JSON.stringify({
        refresh_token: refreshToken,
        email: googleEmail,
        scope: tokens.scope || existing?.scope || "",
        connected_at: new Date().toISOString()
      }));
      return json({ connected: true, email: googleEmail });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({ service: "LifeLink API", status: "online" });
    }

    if (url.pathname !== "/api/chat" && url.pathname !== "/api/models") {
      return json({ error: "Not found" }, 404);
    }

    if (
      (url.pathname === "/api/models" && request.method !== "GET") ||
      (url.pathname === "/api/chat" && request.method !== "POST")
    ) {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const user = await verifyUser(request, env);
      if (!user) return json({ error: "Authentication required" }, 401);

      // The authenticated model-status endpoint never exposes secret values.
      if (url.pathname === "/api/models") {
        return json({ models: availableModels(env) });
      }

      // Per-user rate limit: 10 chat requests per 60 seconds.
      if (!env.MY_RATE_LIMITER) {
        console.error("Rate limiter binding missing");
        return json({ error: "Rate limiter is not configured" }, 500);
      }

      const { success } = await env.MY_RATE_LIMITER.limit({ key: user.id });
      if (!success) {
        return json({
          error: "Rate limit exceeded. Please try again in one minute."
        }, 429);
      }

      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 100000) {
        return json({ error: "Request too large" }, 413);
      }

      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > 100000) {
        return json({ error: "Request too large" }, 413);
      }

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (
        !Array.isArray(body.messages) ||
        body.messages.length < 1 ||
        body.messages.length > 20
      ) {
        return json({ error: "Invalid messages" }, 400);
      }

      const messages = [];
      for (const message of body.messages) {
        if (
          !message ||
          !["system", "user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" ||
          message.content.length > 8000
        ) {
          return json({ error: "Invalid message format" }, 400);
        }
        messages.push({
          role: message.role,
          content: message.content
        });
      }

      if (!messages.some(m => m.role === "user")) {
        return json({ error: "A user message is required" }, 400);
      }

      if (messages.reduce((n, m) => n + m.content.length, 0) > 30000) {
        return json({ error: "Conversation too long" }, 400);
      }

      const requested = String(body.model || "auto").toLowerCase();
      if (!["auto", "groq", "gemini", "openai", "anthropic"].includes(requested)) {
        return json({ error: "Unknown model selection" }, 400);
      }

      const available = availableModels(env);
      if (requested !== "auto" && !available[requested]) {
        return json({
          error: "This model is not connected yet.",
          code: "MODEL_NOT_CONNECTED",
          model: requested
        }, 409);
      }

      // The selected provider is tried first. If it fails, try other connected
      // providers before allowing the frontend's LifeLink fallback to respond.
      const order = requested === "auto"
        ? ["groq", "gemini", "openai", "anthropic"]
        : [requested, "groq", "gemini", "openai", "anthropic"].filter(
            (name, index, list) => list.indexOf(name) === index
          );

      const failures = [];
      for (const provider of order) {
        if (!available[provider]) continue;
        try {
          const reply = await PROVIDERS[provider](messages, env);
          return json({ reply, provider, requested });
        } catch (error) {
          failures.push(provider);
          console.error(provider + " unavailable:", error.message);
        }
      }

      return json({
        error: "All connected AI models are temporarily unavailable. LifeLink will use its fallback assistant.",
        code: "AI_MODELS_UNAVAILABLE",
        attempted: failures
      }, 503);

    } catch (error) {
      console.error("LifeLink API error:", error.message);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
