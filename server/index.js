/**
 * NexaCore site + protected /dashboard (Discord OAuth + bot API).
 * Run from repo root: cd server && npm install && npm start
 * Env: see env.example
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const { createPublicDatabaseRouter } = require("../Database/routes");

const SITE_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const MODULES_PATH = path.join(DATA_DIR, "modules.json");
const MODULES_DEFAULT = path.join(DATA_DIR, "modules.default.json");

/** Only this Discord user ID may use the dashboard (string compare). */
const ALLOWED_USER_ID = "1092489655888379915";

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

function getRedirectUri() {
  const u = process.env.DISCORD_REDIRECT_URI;
  if (!u) {
    throw new Error("DISCORD_REDIRECT_URI is required");
  }
  return u;
}

function ensureModulesFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODULES_PATH)) {
    const def = fs.readFileSync(MODULES_DEFAULT, "utf8");
    fs.writeFileSync(MODULES_PATH, def, "utf8");
  }
}

function readModules() {
  ensureModulesFile();
  try {
    return JSON.parse(fs.readFileSync(MODULES_PATH, "utf8"));
  } catch {
    return JSON.parse(fs.readFileSync(MODULES_DEFAULT, "utf8"));
  }
}

function writeModules(obj) {
  ensureModulesFile();
  fs.writeFileSync(MODULES_PATH, JSON.stringify(obj, null, 2), "utf8");
}

async function discordApi(method, route, { bot = false, body, query } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token && bot) {
    throw new Error("DISCORD_BOT_TOKEN missing");
  }
  let url = `https://discord.com/api/v10${route}`;
  if (query) {
    const q = new URLSearchParams(query);
    url += `?${q.toString()}`;
  }
  const headers = {};
  if (bot) {
    headers.Authorization = `Bot ${token}`;
  }
  const opts = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`Discord API ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function requireOwnerSession(req, res, next) {
  if (!req.session || req.session.discordUserId !== ALLOWED_USER_ID) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

function guildIdsFromEnv() {
  const raw = process.env.DISCORD_GUILD_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function publicOAuthBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function oauthPublicState() {
  return crypto.randomBytes(24).toString("hex");
}

function googleRedirectUri(req) {
  return process.env.OAUTH_GOOGLE_REDIRECT_URI || `${publicOAuthBaseUrl(req)}/auth/callback/google`;
}

function githubRedirectUri(req) {
  return process.env.OAUTH_GITHUB_REDIRECT_URI || `${publicOAuthBaseUrl(req)}/auth/callback/github`;
}

function microsoftRedirectUri(req) {
  return process.env.OAUTH_MICROSOFT_REDIRECT_URI || `${publicOAuthBaseUrl(req)}/auth/callback/microsoft`;
}

function parseDatabaseKeyConfig() {
  const raw = process.env.DB_API_KEYS;
  if (!raw || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === "object" && item.key)
      .map((item) => ({
        name: String(item.name || "unnamed-key"),
        key: String(item.key),
        containers: Array.isArray(item.containers)
          ? item.containers.map((c) => String(c))
          : [],
      }));
  } catch {
    return [];
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

/** Confirms the Node server (not static-only hosting) is running — used by login.html */
app.get("/api/health", (req, res) => {
  res.type("json").send(JSON.stringify({ ok: true, service: "nexacore-server" }));
});
app.use(
  "/api/public-db",
  createPublicDatabaseRouter(express, {
    apiKeys: parseDatabaseKeyConfig(),
    requireApiKey: process.env.DB_REQUIRE_API_KEY !== "false",
  })
);

app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, "data", "sessions"),
      ttl: 7 * 24 * 60 * 60,
      retries: 0,
    }),
    name: "nexacore.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function publicSiteOAuthRedirect(provider, req, res) {
  const state = oauthPublicState();
  req.session.oauthPublicState = state;
  const base = publicOAuthBaseUrl(req);
  switch (provider) {
    case "discord": {
      const id = process.env.OAUTH_DISCORD_CLIENT_ID;
      const uri = process.env.OAUTH_DISCORD_REDIRECT_URI;
      if (!id || !uri) {
        return res.redirect(`/login.html?notice=configure&provider=discord`);
      }
      const p = new URLSearchParams({
        client_id: id,
        redirect_uri: uri,
        response_type: "code",
        scope: "identify email",
        state,
      });
      return res.redirect(`https://discord.com/api/oauth2/authorize?${p.toString()}`);
    }
    case "google": {
      const id = process.env.OAUTH_GOOGLE_CLIENT_ID;
      const uri = googleRedirectUri(req);
      if (!id) {
        return res.redirect(`/login.html?notice=configure&provider=google`);
      }
      const p = new URLSearchParams({
        client_id: id,
        redirect_uri: uri,
        response_type: "code",
        scope: "openid email profile",
        access_type: "online",
        state,
      });
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`);
    }
    case "github": {
      const id = process.env.OAUTH_GITHUB_CLIENT_ID;
      const uri = githubRedirectUri(req);
      if (!id) {
        return res.redirect(`/login.html?notice=configure&provider=github`);
      }
      const p = new URLSearchParams({
        client_id: id,
        redirect_uri: uri,
        scope: "user:email",
        state,
      });
      return res.redirect(`https://github.com/login/oauth/authorize?${p.toString()}`);
    }
    case "microsoft": {
      const id = process.env.OAUTH_MICROSOFT_CLIENT_ID;
      const uri = microsoftRedirectUri(req);
      if (!id) {
        return res.redirect(`/login.html?notice=configure&provider=microsoft`);
      }
      const p = new URLSearchParams({
        client_id: id,
        response_type: "code",
        redirect_uri: uri,
        scope: "openid profile email https://graph.microsoft.com/User.Read",
        response_mode: "query",
        state,
      });
      return res.redirect(
        `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${p.toString()}`
      );
    }
    default:
      return res.redirect("/login.html");
  }
}

app.get("/auth/:provider", (req, res) => {
  const p = String(req.params.provider || "").toLowerCase();
  if (!["discord", "google", "github", "microsoft"].includes(p)) {
    return res.redirect("/login.html");
  }
  return publicSiteOAuthRedirect(p, req, res);
});

/** Public site OAuth callbacks (login.html) — exchange code, set req.session.siteUser */
app.get("/auth/callback/:provider", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!["discord", "google", "github", "microsoft"].includes(provider)) {
    return res.redirect("/login.html");
  }
  const q = req.query || {};
  if (q.error) {
    return res.redirect(
      `/login.html?error=access_denied&provider=${encodeURIComponent(provider)}`
    );
  }
  const code = q.code;
  const state = q.state;
  if (!code || typeof code !== "string") {
    return res.redirect(`/login.html?error=missing_code&provider=${encodeURIComponent(provider)}`);
  }
  if (!state || state !== req.session.oauthPublicState) {
    return res.redirect(`/login.html?error=bad_state&provider=${encodeURIComponent(provider)}`);
  }
  delete req.session.oauthPublicState;

  try {
    switch (provider) {
      case "discord": {
        const clientId = process.env.OAUTH_DISCORD_CLIENT_ID;
        const clientSecret = process.env.OAUTH_DISCORD_CLIENT_SECRET;
        const redirectUri = process.env.OAUTH_DISCORD_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
          return res.redirect(`/login.html?notice=configure&provider=discord`);
        }
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        });
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const tokenJson = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenJson.access_token) {
          return res.redirect(`/login.html?error=token&provider=discord`);
        }
        const userRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const user = await userRes.json().catch(() => null);
        if (!userRes.ok || !user || !user.id) {
          return res.redirect(`/login.html?error=userinfo&provider=discord`);
        }
        const avatarUrl =
          user.avatar != null
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : null;
        req.session.siteUser = {
          provider: "discord",
          id: String(user.id),
          email: user.email || null,
          name: user.global_name || user.username || null,
          avatar: avatarUrl,
        };
        break;
      }
      case "google": {
        const clientId = process.env.OAUTH_GOOGLE_CLIENT_ID;
        const clientSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET;
        const redirectUri = googleRedirectUri(req);
        if (!clientId || !clientSecret) {
          return res.redirect(`/login.html?notice=configure&provider=google`);
        }
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        });
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const tokenJson = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenJson.access_token) {
          return res.redirect(`/login.html?error=token&provider=google`);
        }
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const user = await userRes.json().catch(() => null);
        if (!userRes.ok || !user || !user.id) {
          return res.redirect(`/login.html?error=userinfo&provider=google`);
        }
        req.session.siteUser = {
          provider: "google",
          id: String(user.id),
          email: user.email || null,
          name: user.name || null,
          avatar: user.picture || null,
        };
        break;
      }
      case "github": {
        const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
        const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;
        const redirectUri = githubRedirectUri(req);
        if (!clientId || !clientSecret) {
          return res.redirect(`/login.html?notice=configure&provider=github`);
        }
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        });
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        const tokenJson = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenJson.access_token) {
          return res.redirect(`/login.html?error=token&provider=github`);
        }
        const accessToken = tokenJson.access_token;
        const userRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        });
        const user = await userRes.json().catch(() => null);
        if (!userRes.ok || !user || user.id == null) {
          return res.redirect(`/login.html?error=userinfo&provider=github`);
        }
        let email = user.email || null;
        if (!email) {
          const emRes = await fetch("https://api.github.com/user/emails", {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
            },
          });
          const emails = await emRes.json().catch(() => []);
          const primary = Array.isArray(emails)
            ? emails.find((e) => e && e.primary) || emails[0]
            : null;
          email = primary && primary.email ? primary.email : null;
        }
        req.session.siteUser = {
          provider: "github",
          id: String(user.id),
          email,
          name: user.name || user.login || null,
          avatar: user.avatar_url || null,
        };
        break;
      }
      case "microsoft": {
        const clientId = process.env.OAUTH_MICROSOFT_CLIENT_ID;
        const clientSecret = process.env.OAUTH_MICROSOFT_CLIENT_SECRET;
        const redirectUri = microsoftRedirectUri(req);
        if (!clientId || !clientSecret) {
          return res.redirect(`/login.html?notice=configure&provider=microsoft`);
        }
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        });
        const tokenRes = await fetch(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          }
        );
        const tokenJson = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenJson.access_token) {
          return res.redirect(`/login.html?error=token&provider=microsoft`);
        }
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const user = await userRes.json().catch(() => null);
        if (!userRes.ok || !user || !user.id) {
          return res.redirect(`/login.html?error=userinfo&provider=microsoft`);
        }
        const email = user.mail || user.userPrincipalName || null;
        const name = user.displayName || user.givenName || email || null;
        req.session.siteUser = {
          provider: "microsoft",
          id: String(user.id),
          email,
          name,
          avatar: null,
        };
        break;
      }
      default:
        return res.redirect("/login.html");
    }
  } catch {
    return res.redirect(`/login.html?error=server&provider=${encodeURIComponent(provider)}`);
  }

  return res.redirect("/index.html?signedIn=1");
});

app.get("/api/site/auth/me", (req, res) => {
  const u = req.session && req.session.siteUser;
  if (!u) {
    return res.json({ ok: true, signedIn: false });
  }
  return res.json({ ok: true, signedIn: true, user: u });
});

app.post("/api/site/auth/logout", (req, res) => {
  delete req.session.siteUser;
  res.json({ ok: true });
});

// --- OAuth ---
app.get("/dashboard/auth/discord", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send("Server missing DISCORD_CLIENT_ID");
  }
  let redirectUri;
  try {
    redirectUri = getRedirectUri();
  } catch (e) {
    return res.status(500).send(String(e.message));
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get("/dashboard/auth/callback", async (req, res) => {
  const err = req.query.error;
  const code = req.query.code;
  if (err || !code) {
    return res.redirect("/dashboard/unauthorized.html");
  }
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send("OAuth not configured");
  }
  let redirectUri;
  try {
    redirectUri = getRedirectUri();
  } catch (e) {
    return res.status(500).send(String(e.message));
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: redirectUri,
  });

  let tokenRes;
  try {
    tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return res.redirect("/dashboard/unauthorized.html");
  }
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    return res.redirect("/dashboard/unauthorized.html");
  }

  let userRes;
  try {
    userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
  } catch {
    return res.redirect("/dashboard/unauthorized.html");
  }
  const user = await userRes.json().catch(() => null);
  if (!userRes.ok || !user || !user.id) {
    return res.redirect("/dashboard/unauthorized.html");
  }

  if (String(user.id) !== ALLOWED_USER_ID) {
    req.session.destroy(() => {});
    return res.redirect("/dashboard/unauthorized.html");
  }

  req.session.discordUserId = String(user.id);
  req.session.discordUsername = user.username || "";
  return res.redirect("/dashboard/app.html");
});

// --- API (owner only) ---
app.get("/dashboard/api/me", (req, res) => {
  if (!req.session || req.session.discordUserId !== ALLOWED_USER_ID) {
    return res.status(401).json({ ok: false });
  }
  return res.json({
    ok: true,
    userId: req.session.discordUserId,
    username: req.session.discordUsername || "",
  });
});

app.post("/dashboard/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/dashboard/api/bot/application", requireOwnerSession, async (req, res) => {
  try {
    const appInfo = await discordApi("GET", "/oauth2/applications/@me", { bot: true });
    return res.json({ ok: true, application: appInfo });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message), details: e.body });
  }
});

app.get("/dashboard/api/guilds", requireOwnerSession, async (req, res) => {
  const ids = guildIdsFromEnv();
  if (!ids.length) {
    return res.json({ ok: true, guilds: [], warning: "Set DISCORD_GUILD_IDS in server/.env" });
  }
  const guilds = [];
  for (const id of ids) {
    try {
      const g = await discordApi("GET", `/guilds/${id}`, {
        bot: true,
        query: { with_counts: "true" },
      });
      guilds.push({
        id: g.id,
        name: g.name,
        approximate_member_count: g.approximate_member_count,
        approximate_presence_count: g.approximate_presence_count,
      });
    } catch {
      guilds.push({ id, name: "(unreachable — check bot is in server)", error: true });
    }
  }
  return res.json({ ok: true, guilds });
});

app.get("/dashboard/api/guilds/:guildId/channels", requireOwnerSession, async (req, res) => {
  const guildId = req.params.guildId;
  const allowed = new Set(guildIdsFromEnv());
  if (!allowed.has(guildId)) {
    return res.status(403).json({ ok: false, error: "guild_not_allowed" });
  }
  try {
    const channels = await discordApi("GET", `/guilds/${guildId}/channels`, { bot: true });
    const textLike = (channels || []).filter((c) => [0, 5, 15, 16].includes(c.type));
    textLike.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return res.json({
      ok: true,
      channels: textLike.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parent_id: c.parent_id,
      })),
    });
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      error: String(e.message),
      details: e.body,
    });
  }
});

app.post("/dashboard/api/messages/send", requireOwnerSession, async (req, res) => {
  const { channelId, content, embeds } = req.body || {};
  if (!channelId || typeof channelId !== "string") {
    return res.status(400).json({ ok: false, error: "channelId_required" });
  }
  const guildIds = guildIdsFromEnv();
  let channelGuildId = null;
  try {
    const ch = await discordApi("GET", `/channels/${channelId}`, { bot: true });
    channelGuildId = ch.guild_id || null;
  } catch (e) {
    return res.status(400).json({ ok: false, error: "channel_lookup_failed", details: e.body });
  }
  if (!channelGuildId || !guildIds.includes(channelGuildId)) {
    return res.status(403).json({ ok: false, error: "channel_not_in_allowed_guilds" });
  }

  const payload = {};
  if (content !== undefined && content !== null && String(content).length) {
    payload.content = String(content);
  }
  if (embeds && Array.isArray(embeds) && embeds.length) {
    payload.embeds = embeds.slice(0, 10);
  }
  if (!payload.content && !payload.embeds) {
    return res.status(400).json({ ok: false, error: "content_or_embeds_required" });
  }

  try {
    const msg = await discordApi("POST", `/channels/${channelId}/messages`, {
      bot: true,
      body: payload,
    });
    return res.json({ ok: true, message: { id: msg.id } });
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      error: String(e.message),
      details: e.body,
    });
  }
});

app.get("/dashboard/api/modules", requireOwnerSession, (req, res) => {
  try {
    return res.json({ ok: true, modules: readModules() });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.post("/dashboard/api/modules", requireOwnerSession, (req, res) => {
  const m = req.body;
  if (!m || typeof m !== "object") {
    return res.status(400).json({ ok: false });
  }
  const allowedKeys = ["moderation", "music", "welcome", "logging"];
  const next = {};
  for (const k of allowedKeys) {
    next[k] = Boolean(m[k]);
  }
  writeModules(next);
  return res.json({ ok: true, modules: next });
});

app.get("/dashboard", (req, res) => {
  res.redirect(301, "/dashboard/");
});

// Static site (dashboard is not linked from main pages)
app.use(
  "/dashboard",
  express.static(path.join(SITE_ROOT, "dashboard"), { index: "index.html" })
);
app.use(express.static(SITE_ROOT, { index: "index.html" }));

app.use((req, res) => {
  res.status(404).send("Not found");
});

ensureModulesFile();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`NexaCore server listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `\nPort ${PORT} is already in use (another NexaCore server or app is running).\n` +
        `Fix: stop the other process, or set PORT=3001 (or another port) in server/.env\n` +
        `Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F\n`
    );
    process.exit(1);
  }
  throw err;
});
