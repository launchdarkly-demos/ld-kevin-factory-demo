/*
 * Flight Deck render loop.
 *
 * Polls /api/state twice a second and draws the terminal on a canvas.
 * Passenger positions are interpolated between polls so movement reads
 * smoothly. Nothing here knows a flag key: colour comes from each passenger's
 * `path`, and the altitude tape lists whatever flags the server has seen.
 */

(() => {
  "use strict";

  const canvas = document.getElementById("terminal");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const PALETTE = {
    floor: "#121722",
    corridor: "#1a2130",
    corridorEdge: "#2a3447",
    wall: "#0d1017",
    gate: "#1f2a3d",
    gateEdge: "#3a4a66",
    text: "#c7cfdc",
    muted: "#7f899b",
    base: "#6f9bff",
    baseDim: "#4d6db5",
    treat: "#f5b942",
    stop: "#e2574c",
    ok: "#58c99a",
    warn: "#f5a623",
    desk: "#2b2334",
  };

  const el = {
    mode: document.getElementById("mode"),
    clock: document.getElementById("clock"),
    counters: document.getElementById("counters"),
    lamp: document.getElementById("lamp"),
    banner: document.getElementById("banner"),
    tape: document.getElementById("tape"),
    log: document.getElementById("log"),
    gaugeBoarding: document.getElementById("gauge-boarding"),
    gaugeMissed: document.getElementById("gauge-missed"),
    operate: document.getElementById("operate"),
    operateBody: document.getElementById("operate-body"),
  };

  let server = null;
  const sprites = new Map(); // id -> { x, y, tx, ty, ...fields }
  let lastPollAt = 0;

  const STATE_URL = new URL("api/state", window.location.href).toString();

  async function poll() {
    try {
      const res = await fetch(STATE_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      server = await res.json();
      lastPollAt = performance.now();
      if (server.ops && server.ops.launchError) {
        el.banner.hidden = false;
        el.banner.textContent = `This launch could not set up its repository and project: ${server.ops.launchError}. The deck runs without the pull-request beats.`;
      } else if (server.code && server.code.behind) {
        el.banner.hidden = false;
        const hint = (server.ops && server.ops.deployHint) || "Run scripts/deploy.sh";
        el.banner.textContent = `Deck is running old code (${server.code.commit.slice(0, 7)}); main is at ${server.code.originMain.slice(0, 7)}. ${hint}.`;
      } else {
        el.banner.hidden = true;
      }
      applyServer();
    } catch (err) {
      el.banner.hidden = false;
      el.banner.textContent = `The deck cannot reach its server (${err && err.message ? err.message : err}). Retrying.`;
    } finally {
      setTimeout(poll, 500);
    }
  }

  function applyServer() {
    const w = server.world;
    const seen = new Set();
    for (const p of w.passengers) {
      seen.add(p.id);
      const s = sprites.get(p.id);
      if (s) {
        s.fx = s.x;
        s.fy = s.y;
        s.tx = p.x;
        s.ty = p.y;
        s.t = 0;
        Object.assign(s, { stage: p.stage, path: p.path, missed: p.missed, lane: p.lane, bags: p.bags, rerouted: p.rerouted });
      } else {
        sprites.set(p.id, { ...p, fx: p.x, fy: p.y, tx: p.x, ty: p.y, x: p.x, y: p.y, t: 1, born: performance.now() });
      }
    }
    for (const id of sprites.keys()) if (!seen.has(id)) sprites.delete(id);

    el.mode.dataset.mode = server.mode;
    el.mode.textContent = server.mode === "live" ? (server.sdkReady ? "live" : "live, connecting") : "offline";
    const mins = Math.floor(w.simClock / 60);
    el.clock.textContent = `sim ${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")} · ${w.simSpeed}x`;
    el.counters.textContent = `boarded ${w.counters.boarded} · missed ${w.counters.missed} · departures ${w.counters.departures} · delays ${w.counters.delays}`;
    el.lamp.dataset.lamp = server.autopilot.lamp;
    el.lamp.textContent = server.autopilot.lamp;
    el.lamp.title = server.autopilot.detail;

    renderTape(server.flags);
    renderGauges(w.outcomes);
    renderLog(server.log);
    operate.sync(server.ops);
  }

  // -------------------------------------------------------------------------
  // Operate menu. Everything the demo's helper scripts did, fired from the page
  // through POST /api/ops/<action>. The server does the work and writes the
  // outcome to the flight log, so this only has to show state and buttons.
  // -------------------------------------------------------------------------

  const operate = (() => {
    const OPS_URL = (action) => new URL(`api/ops/${action}`, window.location.href).toString();
    let status = null;
    let error = null;
    let busy = null;
    let enabled = false;
    let tokenRequired = false;
    let refreshTimer = null;

    function token() {
      if (!tokenRequired) return "";
      let t = sessionStorage.getItem("flight-deck-ops-token");
      if (!t) {
        t = window.prompt("Operate PIN (the one chosen at launch, or FLIGHT_DECK_OPS_TOKEN on the server)") || "";
        if (t) sessionStorage.setItem("flight-deck-ops-token", t);
      }
      return t;
    }

    function headers(extra) {
      const h = { ...(extra || {}) };
      const t = token();
      if (t) h["X-Ops-Token"] = t;
      return h;
    }

    async function refresh() {
      if (!enabled || !el.operate.open) return;
      try {
        const res = await fetch(OPS_URL("status"), { cache: "no-store", headers: headers() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (res.status === 401) sessionStorage.removeItem("flight-deck-ops-token");
        status = data;
        error = null;
      } catch (err) {
        error = err && err.message ? err.message : String(err);
        if (/X-Ops-Token/.test(error)) sessionStorage.removeItem("flight-deck-ops-token");
      }
      render();
    }

    async function fire(action, body, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      busy = action;
      inFlight = true;
      render();
      try {
        const res = await fetch(OPS_URL(action), {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(body || {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        error = null;
      } catch (err) {
        error = err && err.message ? err.message : String(err);
      } finally {
        busy = null;
        inFlight = false;
        await refresh();
      }
    }

    let inFlight = false;

    /** Called on every poll: show the menu when the server has tokens, mirror a run started from another tab. */
    function sync(ops) {
      enabled = Boolean(ops && ops.enabled);
      tokenRequired = Boolean(ops && ops.tokenRequired);
      el.operate.hidden = !enabled;
      if (inFlight || !ops) return;
      if (ops.busy !== busy) {
        busy = ops.busy || null;
        render();
      }
    }

    function row(what, sub, buttons) {
      return `<div class="row"><span class="what">${what}${sub ? `<small>${sub}</small>` : ""}</span>${buttons}</div>`;
    }

    function btn(label, action, body, opts = {}) {
      const data = esc(JSON.stringify({ action, body: body || {}, confirm: opts.confirm || "" }));
      return `<button data-op='${data}' class="${opts.cls || ""}"${busy ? " disabled" : ""}>${esc(label)}</button>`;
    }

    function render() {
      if (!enabled) return;
      const parts = [];
      if (error) parts.push(`<p class="note error">${esc(error)}</p>`);
      if (busy) parts.push(`<p class="note">Running ${esc(busy)}…</p>`);
      if (!status) {
        parts.push('<p class="empty">Loading…</p>');
        el.operateBody.innerHTML = parts.join("");
        return;
      }
      const openBranches = new Set(status.prs.map((p) => p.branch));
      parts.push("<h3>Pull requests</h3>");
      parts.push(
        row(
          "Open a demo PR",
          `${esc(status.repo)} · main`,
          btn("PR 1 express lane", "open-pr", { which: 1 }, { cls: openBranches.has("express-boarding") ? "" : "primary" }) +
            btn("PR 2 upgrade offers", "open-pr", { which: 2 }, { cls: openBranches.has("gate-upgrade-offers") ? "" : "primary" }),
        ),
      );
      if (!status.prs.length) parts.push('<p class="empty">No open pull requests.</p>');
      for (const p of status.prs) {
        const ready = /ready to merge/.test(p.stage);
        const declined = /declined/.test(p.stage);
        const retry = /retry plan/.test(p.stage);
        const proposed = /approve/.test(p.stage);
        parts.push(
          row(
            `<a href="${esc(p.url)}" target="_blank" rel="noopener">#${p.number} ${esc(p.title)}</a>`,
            esc(p.stage),
            (declined ? btn("Refine", "comment", { pr: p.number, body: "@launchdarkly refine" }, { cls: "primary" }) : "") +
              (retry ? btn("Retry plan", "comment", { pr: p.number, body: "@launchdarkly plan" }, { cls: "primary" }) : "") +
              btn("Approve", "comment", { pr: p.number, body: "@launchdarkly approve" }, { cls: proposed ? "primary" : "" }) +
              btn("Merge", "merge", { pr: p.number }, { cls: ready ? "primary" : "", confirm: ready ? "" : `Merge #${p.number} before the plan is applied?` }),
          ),
        );
      }
      parts.push("<h3>Flags</h3>");
      if (status.flagsError) parts.push(`<p class="note error">${esc(status.flagsError)}</p>`);
      else if (!status.flags.length) parts.push(`<p class="empty">No flags in ${esc(status.project)} yet. The app creates one when a plan is approved.</p>`);
      for (const f of status.flags) {
        parts.push(
          row(
            esc(f.key),
            f.on ? `on in ${esc(status.environment)}` : `off in ${esc(status.environment)}`,
            f.on ? "" : btn("Turn on, serve baseline", "flag-on", { key: f.key }, { cls: "primary" }),
          ),
        );
      }
      parts.push("<h3>Deck</h3>");
      parts.push(row("Redeploy", "fetch main and restart on it", btn("Redeploy", "redeploy", {}, { confirm: "Restart the deck on the current main?" })));
      parts.push(
        row(
          "Reset the demo",
          "close PRs, delete branches and flags, main back to baseline, restart",
          btn("Reset", "reset", {}, { cls: "danger", confirm: `Reset ${status.repo} and delete every flag in ${status.project}?` }),
        ),
      );
      el.operateBody.innerHTML = parts.join("");
    }

    el.operateBody.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-op]");
      if (!b || b.disabled) return;
      const op = JSON.parse(b.dataset.op);
      fire(op.action, op.body, op.confirm);
    });
    el.operate.addEventListener("toggle", () => {
      clearInterval(refreshTimer);
      if (el.operate.open) {
        refresh();
        refreshTimer = setInterval(refresh, 15000);
      }
    });
    document.addEventListener("click", (ev) => {
      if (el.operate.open && !el.operate.contains(ev.target)) el.operate.open = false;
    });

    return { sync };
  })();

  function renderTape(flagList) {
    if (!flagList.length) {
      el.tape.innerHTML = '<p class="empty">No flags evaluated yet. The tape fills once a flag is wired.</p>';
      return;
    }
    el.tape.innerHTML = flagList
      .map(
        (f) => `<div class="flag${f.landed ? " landed" : ""}"><div class="key"><span>${esc(f.key)}</span><span class="pct">${f.share}%${f.landed ? " · landed" : ""}</span></div>` +
          `<div class="track"><div class="fill" style="width:${f.share}%"></div></div>` +
          `<div class="key" style="color:#5e6878;font-size:11px"><span>${f.trueCount} of ${f.total} passengers</span><span>peak ${f.peakShare}%</span></div></div>`,
      )
      .join("");
  }

  // Below this many passengers a gauge reads as noise, so it shows the count instead.
  const MIN_SAMPLE = 20;

  function renderGauges(o) {
    const b = o.baseline;
    const t = o.treatment;
    const fmtMin = (v) => `${(v / 60000).toFixed(1)} min`;
    const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;
    const maxMs = Math.max(b.avgBoardingMs || 0, t.avgBoardingMs || 0, 420000);
    setBar(el.gaugeBoarding, "base", b.avgBoardingMs, maxMs, fmtMin, b.boarded);
    setBar(el.gaugeBoarding, "treat", t.avgBoardingMs, maxMs, fmtMin, t.boarded, (v) => b.boarded >= MIN_SAMPLE && v > b.avgBoardingMs * 1.2);
    const maxRate = Math.max(b.missRate || 0, t.missRate || 0, 0.15);
    setBar(el.gaugeMissed, "base", b.missRate, maxRate, fmtPct, b.total);
    setBar(el.gaugeMissed, "treat", t.missRate, maxRate, fmtPct, t.total, (v) => b.total >= MIN_SAMPLE && v > b.missRate * 1.5 && v > 0.04);
  }

  function setBar(gauge, which, value, max, fmt, n, worseIf) {
    const fill = gauge.querySelector(`.fill.${which}`);
    const out = gauge.querySelector(`.value[data-k="${which}"]`);
    if (value === null || value === undefined || n === 0) {
      fill.style.width = "0%";
      out.textContent = "—";
      fill.classList.remove("bad");
      return;
    }
    if (n < MIN_SAMPLE) {
      fill.style.width = "0%";
      out.textContent = `n=${n}`;
      fill.classList.remove("bad");
      return;
    }
    fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
    out.textContent = fmt(value);
    fill.classList.toggle("bad", Boolean(worseIf && worseIf(value)));
  }

  function renderLog(entries) {
    const html = entries
      .slice()
      .reverse()
      .map((e) => `<li class="${esc(e.kind)}"><time>${fmtTime(e.at)}</time>${esc(e.text)}</li>`)
      .join("");
    if (el.log.innerHTML !== html) el.log.innerHTML = html;
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // ---- drawing ----------------------------------------------------------------

  function drawTerminal(L) {
    ctx.fillStyle = PALETTE.floor;
    ctx.fillRect(0, 0, W, H);

    // Landside corridor: spawn to junction.
    corridor(0, L.spawn.y - 34, L.junction.x + 30, 68);
    // Concourses.
    for (const c of ["A", "B"]) corridor(L.junction.x - 30, L.concourseY[c] - 34, W - L.junction.x + 30, 68);
    // Junction spine.
    corridor(L.junction.x - 30, L.concourseY.A - 34, 60, L.concourseY.B - L.concourseY.A + 68);
    // Corridor to the rebooking desk.
    corridor(L.junction.x - 30, L.concourseY.B, 60, L.desk.y - L.concourseY.B + 20);

    // Check-in and security.
    station(L.checkin.x, L.checkin.y, "CHECK-IN");
    station(L.security.x, L.security.y, "SECURITY");
    label("CONCOURSE A", L.junction.x + 40, L.concourseY.A - 24, PALETTE.muted, "left");
    label("CONCOURSE B", L.junction.x + 40, L.concourseY.B + 24, PALETTE.muted, "left");

    // Rebooking desk.
    ctx.fillStyle = PALETTE.desk;
    ctx.fillRect(L.desk.x - 34, L.desk.y - 10, 68, 18);
    label("REBOOKING", L.desk.x, L.desk.y + 16, PALETTE.muted, "center");
  }

  function corridor(x, y, w, h) {
    ctx.fillStyle = PALETTE.corridor;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.corridorEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function station(x, y, name) {
    ctx.fillStyle = PALETTE.gate;
    ctx.fillRect(x - 26, y - 46, 52, 12);
    ctx.strokeStyle = PALETTE.gateEdge;
    ctx.strokeRect(x - 26 + 0.5, y - 46 + 0.5, 51, 11);
    label(name, x, y - 52, PALETTE.muted, "center");
  }

  function label(text, x, y, color, align) {
    ctx.fillStyle = color;
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function drawGates(gates) {
    for (const g of gates) {
      const up = g.concourse === "A";
      const boxY = up ? g.y - 34 - 46 : g.y + 34;
      const half = 55;
      ctx.fillStyle = PALETTE.gate;
      ctx.fillRect(g.x - half, boxY, half * 2, 46);
      ctx.strokeStyle = PALETTE.gateEdge;
      ctx.strokeRect(g.x - half + 0.5, boxY + 0.5, half * 2 - 1, 45);

      // Door opening into the corridor.
      ctx.fillStyle = g.flight && g.flight.status === "boarding" ? PALETTE.ok : PALETTE.wall;
      ctx.fillRect(g.x - 10, up ? g.y - 34 - 3 : g.y + 34, 20, 3);

      const left = g.x - half + 8;
      const right = g.x + half - 8;
      label(g.id, left, boxY + 10, PALETTE.text, "left");
      const f = g.flight;
      if (!f) {
        label("OPEN", right, boxY + 10, PALETTE.muted, "right");
        continue;
      }
      label(f.code, right, boxY + 10, PALETTE.text, "right");
      if (f.delayed) {
        ctx.fillStyle = PALETTE.warn;
        ctx.fillRect(g.x - 24, boxY + 5, 30, 10);
        label("DELAY", g.x - 9, boxY + 10, "#1a1200", "center");
      }
      let status;
      let color = PALETTE.muted;
      if (f.status === "scheduled") status = `boards in ${fmtSim(f.boardingOpenIn)}`;
      else if (f.status === "boarding") {
        status = `door closes ${fmtSim(f.doorCloseIn)}`;
        color = PALETTE.ok;
      } else if (f.status === "closed") {
        status = "door closed";
        color = PALETTE.muted;
      } else status = "departed";
      label(status, left, boxY + 25, color, "left");

      // Boarding progress, leaving room on the right for a gate-change note.
      const barW = f.movedFrom ? 50 : right - left;
      if (f.status === "boarding") {
        const frac = 1 - f.doorCloseIn / f.window;
        ctx.fillStyle = "#0f131c";
        ctx.fillRect(left, boxY + 35, barW, 5);
        ctx.fillStyle = PALETTE.ok;
        ctx.fillRect(left, boxY + 35, barW * Math.max(0, Math.min(1, frac)), 5);
      }
      if (f.movedFrom) label(`from ${f.movedFrom}`, right, boxY + 38, PALETTE.warn, "right");
    }
  }

  function fmtSim(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m ? `${m}m${String(s).padStart(2, "0")}` : `${s}s`;
  }

  function drawPassengers(now) {
    for (const s of sprites.values()) {
      if (s.stage === "gone") continue;
      const r = 4.5;
      let color = s.path === "treatment" ? PALETTE.treat : PALETTE.base;
      if (s.stage === "boarding") color = s.path === "treatment" ? PALETTE.treat : PALETTE.baseDim;
      if (s.missed) {
        const blink = s.stage === "missed" && Math.floor(now / 160) % 2 === 0;
        color = blink ? "#ff8a80" : PALETTE.stop;
      }
      ctx.globalAlpha = s.stage === "boarding" ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (s.path === "treatment" && !s.missed && (s.stage === "toGate" || s.stage === "toSecurity")) {
        ctx.strokeStyle = "rgba(245,185,66,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 10, s.y);
        ctx.lineTo(s.x - 2, s.y);
        ctx.stroke();
      }
      if (s.bags > 0 && !s.missed) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(s.x - 1.5, s.y + 3, 3, 3);
      }
    }
  }

  function drawLegend() {
    const items = [
      [PALETTE.base, "baseline path"],
      [PALETTE.treat, "new path (a flag is on)"],
      [PALETTE.stop, "missed boarding"],
    ];
    let x = 20;
    const y = 22;
    for (const [color, text] of items) {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      label(text, x + 10, y, PALETTE.muted, "left");
      x += 10 + ctx.measureText(text).width + 24;
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const lerpRate = 1 / 0.5; // polls are 500 ms apart
    for (const s of sprites.values()) {
      s.t = Math.min(1, s.t + dt * lerpRate);
      s.x = s.fx + (s.tx - s.fx) * s.t;
      s.y = s.fy + (s.ty - s.fy) * s.t;
    }
    if (server) {
      drawTerminal(server.world.layout);
      drawGates(server.world.gates);
      drawPassengers(now);
      drawLegend();
    } else {
      ctx.fillStyle = PALETTE.floor;
      ctx.fillRect(0, 0, W, H);
      label("Waiting for the deck server…", W / 2, H / 2, PALETTE.muted, "center");
    }
    requestAnimationFrame(frame);
  }

  poll();
  requestAnimationFrame(frame);
})();
