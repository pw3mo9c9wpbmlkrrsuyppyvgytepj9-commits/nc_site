(function () {
  const MODULE_KEYS = [
    { key: "moderation", label: "Moderation" },
    { key: "music", label: "Music" },
    { key: "welcome", label: "Welcome messages" },
    { key: "logging", label: "Event logging" },
  ];

  function flash(kind, text) {
    const el = document.getElementById("flashMount");
    if (!el) return;
    el.innerHTML =
      '<div class="flash ' +
      (kind === "ok" ? "ok" : "err") +
      '">' +
      escapeHtml(text) +
      "</div>";
    window.setTimeout(function () {
      el.innerHTML = "";
    }, 6000);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hexToInt(hex) {
    const h = String(hex || "").trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(h.replace("#", ""))) return 0x7b2ff2;
    const n = h.replace("#", "");
    return parseInt(n, 16);
  }

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}));
    const data = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      const err = new Error(data.error || r.statusText || "request_failed");
      err.status = r.status;
      err.details = data.details;
      throw err;
    }
    return data;
  }

  function ensureAuth() {
    return api("/dashboard/api/me").catch(function () {
      window.location.replace("/dashboard/");
    });
  }

  function renderGuildOptions(guilds) {
    const sel = document.getElementById("selGuild");
    sel.innerHTML = "";
    if (!guilds || !guilds.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No servers — set DISCORD_GUILD_IDS";
      sel.appendChild(o);
      return;
    }
    guilds.forEach(function (g) {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = g.error ? g.name : g.name || g.id;
      sel.appendChild(o);
    });
  }

  function renderChannelOptions(channels) {
    const sel = document.getElementById("selChannel");
    sel.innerHTML = "";
    (channels || []).forEach(function (c) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = "#" + (c.name || c.id);
      sel.appendChild(o);
    });
    if (!sel.options.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No text channels";
      sel.appendChild(o);
    }
  }

  async function loadChannels(guildId) {
    if (!guildId) return;
    const data = await api("/dashboard/api/guilds/" + encodeURIComponent(guildId) + "/channels");
    renderChannelOptions(data.channels || []);
  }

  function buildModuleToggles(modules) {
    const root = document.getElementById("moduleToggles");
    root.innerHTML = "";
    MODULE_KEYS.forEach(function (def) {
      const row = document.createElement("div");
      row.className = "toggle-item";
      row.innerHTML =
        "<div><strong>" +
        escapeHtml(def.label) +
        "</strong></div>" +
        '<label class="switch"><input type="checkbox" data-key="' +
        def.key +
        '"' +
        (modules[def.key] ? " checked" : "") +
        '><span class="slider"></span></label>';
      root.appendChild(row);
    });
  }

  function collectModules() {
    const out = {};
    MODULE_KEYS.forEach(function (def) {
      const inp = document.querySelector('input[data-key="' + def.key + '"]');
      out[def.key] = !!(inp && inp.checked);
    });
    return out;
  }

  function updateEmbedPreview() {
    const title = document.getElementById("embTitle").value || "Title";
    const desc = document.getElementById("embDesc").value || "Description";
    const footer = document.getElementById("embFooter").value;
    const col = document.getElementById("embColor").value || "#7b2ff2";
    const prev = document.getElementById("embPreview");
    document.getElementById("pvTitle").textContent = title;
    document.getElementById("pvDesc").textContent = desc;
    document.getElementById("pvFooter").textContent = footer ? "— " + footer : "";
    prev.style.borderLeftColor = col.match(/^#?[0-9a-fA-F]{6}$/) ? col : "#7b2ff2";
  }

  function collectEmbed() {
    const embed = {};
    const t = document.getElementById("embTitle").value.trim();
    const d = document.getElementById("embDesc").value.trim();
    const f = document.getElementById("embFooter").value.trim();
    const thumb = document.getElementById("embThumb").value.trim();
    if (t) embed.title = t;
    if (d) embed.description = d;
    if (f) embed.footer = { text: f };
    if (thumb) embed.thumbnail = { url: thumb };
    embed.color = hexToInt(document.getElementById("embColor").value);

    const fields = [];
    document.querySelectorAll(".emb-field-row").forEach(function (row) {
      const name = row.querySelector(".fld-name").value.trim();
      const val = row.querySelector(".fld-val").value.trim();
      const inline = row.querySelector(".fld-inline").checked;
      if (name || val) {
        fields.push({ name: name || "\u200b", value: val || "\u200b", inline: inline });
      }
    });
    if (fields.length) embed.fields = fields.slice(0, 25);
    return embed;
  }

  function addFieldRow() {
    const wrap = document.getElementById("embFields");
    const row = document.createElement("div");
    row.className = "emb-field-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 1fr auto";
    row.style.gap = "0.4rem";
    row.style.marginBottom = "0.4rem";
    row.innerHTML =
      '<input class="dash-input fld-name" type="text" placeholder="Field name">' +
      '<input class="dash-input fld-val" type="text" placeholder="Field value">' +
      '<label style="display:flex;align-items:center;gap:0.25rem;font-size:0.8rem;color:#9aa3b8;">' +
      '<input type="checkbox" class="fld-inline"> inline</label>';
    wrap.appendChild(row);
  }

  async function init() {
    await ensureAuth();

    const appData = await api("/dashboard/api/bot/application").catch(function (e) {
      return { application: null, _err: e };
    });
    const app = appData.application;
    const sum = document.getElementById("botSummary");
    if (app && app.name) {
      sum.textContent =
        "Application: " +
        app.name +
        (app.bot && app.bot.username ? " · Bot @" + app.bot.username : "") +
        ".";
    } else {
      sum.textContent =
        "Could not load application (check DISCORD_BOT_TOKEN and intents). " +
        (appData._err ? String(appData._err.message) : "");
    }

    const guildsRes = await api("/dashboard/api/guilds");
    const guilds = guildsRes.guilds || [];
    if (guildsRes.warning) {
      flash("err", guildsRes.warning);
    }
    renderGuildOptions(guilds);

    const stats = document.getElementById("guildStats");
    stats.innerHTML = "";
    guilds.forEach(function (g) {
      if (g.error) return;
      const pill = document.createElement("div");
      pill.className = "stat-pill";
      pill.textContent =
        (g.name || g.id) +
        (g.approximate_member_count != null
          ? " · ~" + g.approximate_member_count + " members"
          : "");
      stats.appendChild(pill);
    });

    const selGuild = document.getElementById("selGuild");
    selGuild.addEventListener("change", function () {
      loadChannels(selGuild.value);
    });
    if (selGuild.value) {
      await loadChannels(selGuild.value);
    }

    const modRes = await api("/dashboard/api/modules");
    buildModuleToggles(modRes.modules || {});

    document.getElementById("btnSaveModules").addEventListener("click", async function () {
      try {
        await api("/dashboard/api/modules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(collectModules()),
        });
        flash("ok", "Module settings saved.");
      } catch (e) {
        flash("err", "Save failed: " + e.message);
      }
    });

    document.getElementById("btnLogout").addEventListener("click", async function () {
      await api("/dashboard/api/logout", { method: "POST" });
      window.location.replace("/dashboard/");
    });

    document.getElementById("btnSendPlain").addEventListener("click", async function () {
      const channelId = document.getElementById("selChannel").value;
      const content = document.getElementById("msgContent").value;
      if (!channelId) {
        flash("err", "Pick a channel.");
        return;
      }
      if (!content.trim()) {
        flash("err", "Enter message text or use embed.");
        return;
      }
      try {
        await api("/dashboard/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: channelId, content: content }),
        });
        flash("ok", "Message sent.");
      } catch (e) {
        flash("err", "Send failed: " + e.message + (e.details ? " — " + JSON.stringify(e.details) : ""));
      }
    });

    ["embTitle", "embDesc", "embFooter", "embColor"].forEach(function (id) {
      const el = document.getElementById(id);
      el.addEventListener("input", updateEmbedPreview);
    });
    updateEmbedPreview();
    document.getElementById("btnAddField").addEventListener("click", addFieldRow);

    document.getElementById("btnSendEmbed").addEventListener("click", async function () {
      const channelId = document.getElementById("selChannel").value;
      const embed = collectEmbed();
      const extra = document.getElementById("embExtraContent").value.trim();
      if (!channelId) {
        flash("err", "Pick a channel.");
        return;
      }
      const hasEmbed =
        embed.title ||
        embed.description ||
        embed.footer ||
        embed.fields ||
        embed.thumbnail;
      if (!hasEmbed) {
        flash("err", "Fill at least part of the embed.");
        return;
      }
      try {
        await api("/dashboard/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId: channelId,
            content: extra || undefined,
            embeds: [embed],
          }),
        });
        flash("ok", "Embed sent.");
      } catch (e) {
        flash("err", "Send failed: " + e.message + (e.details ? " — " + JSON.stringify(e.details) : ""));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
