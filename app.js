(function () {
  "use strict";

  /* =========================================================================
   *  MAJLIS BAYANGAN — app.js
   *  UI, Firebase Auth (REST), Realtime Database (REST), and game flow wiring.
   *  Depends on: firebase-config.js (window.MB_FIREBASE_CONFIG)
   *              game.js            (window.MBGame)
   * ========================================================================= */

  const CFG = window.MB_FIREBASE_CONFIG || {};
  const MBGame = window.MBGame;
  const AUTH_KEY = "mb_auth_session";
  const LOCAL_DB_KEY = "mb_local_db";
  const DEMO_NAMES = [
    "Amirul", "Nadia", "Farhan", "Iris", "Haziq", "Sofea", "Danial", "Alya",
    "Rizman", "Cassy", "Iman", "Zul", "Aina", "Firdaus", "Bella", "Hakim",
    "Mira", "Syafiq", "Diana", "Rafiq", "Elle", "Naufal", "Tasha", "Idris",
    "Wanie", "Kamal", "Sarah", "Yusri", "Farah", "Boon", "Cheryl", "Adam",
    "Liyana", "Jasper", "Qistina"
  ];

  const isPlaceholder = (v) => !v || /YOUR_|paste-the/i.test(String(v));
  const LOCAL_MODE = isPlaceholder(CFG.apiKey) || isPlaceholder(CFG.databaseURL);

  const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";
  const TOKEN_BASE = "https://securetoken.googleapis.com/v1";

  /* -------------------------------------------------------------------- */
  /*  Tiny state container                                                */
  /* -------------------------------------------------------------------- */
  const state = {
    tab: "participant",
    session: null,        // { uid, idToken, refreshToken, expiresAt, kind: 'participant' | 'overseer', email? }
    connection: "offline", // offline | connecting | online
    remote: { public: null, myPlayer: null, roster: [] },
    overseer: { data: null },
    pollHandle: null,
    message: null,
    loginBusy: false
  };

  /* -------------------------------------------------------------------- */
  /*  DOM handles                                                         */
  /* -------------------------------------------------------------------- */
  const el = {
    phaseBadge: document.getElementById("phase-badge"),
    phaseClock: document.getElementById("phase-clock"),
    connectionState: document.getElementById("connection-state"),
    winnerBanner: document.getElementById("winner-banner"),
    heroEyebrow: document.getElementById("hero-eyebrow"),
    heroTitle: document.getElementById("hero-title"),
    heroDescription: document.getElementById("hero-description"),
    globalMessage: document.getElementById("global-message"),
    appContent: document.getElementById("app-content"),
    modeButtons: Array.from(document.querySelectorAll(".mode-button")),
    resetOne: document.getElementById("reset-confirm-one"),
    resetTwo: document.getElementById("reset-confirm-two"),
    continueReset: document.getElementById("continue-reset"),
    permanentReset: document.getElementById("permanent-reset")
  };

  function showMessage(text, tone) {
    state.message = text ? { text, tone: tone || "info" } : null;
    if (!text) { el.globalMessage.hidden = true; return; }
    el.globalMessage.hidden = false;
    el.globalMessage.textContent = text;
    el.globalMessage.style.borderLeftColor = tone === "error" ? "#c4442e" : "#b78d3f";
  }

  /* =========================================================================
   *  LOCAL MODE — an in-memory / localStorage stand-in for Firebase
   * ========================================================================= */
  const LocalDB = (function () {
    function blank() {
      return {
        public: { phase: "REGISTRATION", targetCount: MBGame.TARGET_COUNT, presentCount: 0, shadowCount: 0, councilCount: 0, roster: [], result: "", winner: null, roundNumber: 1, timerEnd: null },
        players: {},
        votes: {},
        nightActions: {},
        missionClaims: {}
      };
    }
    function load() {
      try {
        const raw = localStorage.getItem(LOCAL_DB_KEY);
        if (raw) return JSON.parse(raw);
      } catch (err) { /* ignore corrupt local state */ }
      return blank();
    }
    let data = load();
    function persist() { localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(data)); }
    function get() { return data; }
    function set(next) { data = next; persist(); }
    function reset() { data = blank(); persist(); }
    return { get, set, reset };
  })();

  function localUid(seed) {
    return "local-" + seed.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* =========================================================================
   *  FIREBASE AUTH — Identity Toolkit REST
   * ========================================================================= */
  async function identityRequest(path, body) {
    const res = await fetch(`${IDENTITY_BASE}/${path}?key=${encodeURIComponent(CFG.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "Authentication failed.");
    return data;
  }

  function saveSession(session) {
    state.session = session;
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  }
  function clearSession() {
    state.session = null;
    localStorage.removeItem(AUTH_KEY);
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) state.session = JSON.parse(raw);
    } catch (err) { state.session = null; }
  }

  async function refreshSessionIfNeeded() {
    if (LOCAL_MODE || !state.session) return;
    if (Date.now() < state.session.expiresAt - 60000) return;
    const res = await fetch(`${TOKEN_BASE}/token?key=${encodeURIComponent(CFG.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(state.session.refreshToken)}`
    });
    const data = await res.json();
    if (!res.ok) { clearSession(); return; }
    saveSession({
      ...state.session,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in) * 1000
    });
  }

  async function registerAsParticipant() {
    if (LOCAL_MODE) {
      const uid = localUid(Date.now());
      saveSession({ uid, idToken: "local", refreshToken: "local", expiresAt: Date.now() + 3600000, kind: "participant" });
      return uid;
    }
    const data = await identityRequest("accounts:signUp", { returnSecureToken: true });
    saveSession({
      uid: data.localId,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn) * 1000,
      kind: "participant"
    });
    return data.localId;
  }

  async function signInOverseer(email, password) {
    if (LOCAL_MODE) {
      if (email !== (CFG.overseerName || "F4nz2005") || !password) throw new Error("Enter the Overseer name and a temporary password.");
      saveSession({ uid: "overseer-local", idToken: "local", refreshToken: "local", expiresAt: Date.now() + 3600000, kind: "overseer", email });
      return;
    }
    const data = await identityRequest("accounts:signInWithPassword", { email, password, returnSecureToken: true });
    saveSession({
      uid: data.localId,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn) * 1000,
      kind: "overseer",
      email: data.email
    });
  }

  /* =========================================================================
   *  REALTIME DATABASE — REST helpers
   * ========================================================================= */
  async function dbCall(method, path, body) {
    if (LOCAL_MODE) return localDbCall(method, path, body);
    await refreshSessionIfNeeded();
    const token = state.session ? state.session.idToken : null;
    const url = `${CFG.databaseURL}/${path}.json${token ? `?auth=${encodeURIComponent(token)}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody && errBody.error) || `Database ${method} failed (${res.status}).`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
  const dbGet = (path) => dbCall("GET", path);
  const dbPut = (path, body) => dbCall("PUT", path, body);
  const dbPatch = (path, body) => dbCall("PATCH", path, body);
  const dbDelete = (path) => dbCall("DELETE", path);

  function getAtPath(root, path) {
    return path.split("/").filter(Boolean).reduce((node, key) => (node == null ? null : node[key]), root);
  }
  function setAtPath(root, path, value) {
    const keys = path.split("/").filter(Boolean);
    if (!keys.length) return value === null ? {} : value;
    let cursor = root;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        if (value === null) delete cursor[key];
        else cursor[key] = value;
      } else {
        if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
        cursor = cursor[key];
      }
    });
    return root;
  }

  async function localDbCall(method, path, body) {
    const root = LocalDB.get();
    if (method === "GET") return JSON.parse(JSON.stringify(getAtPath(root, path)));
    if (method === "DELETE") { setAtPath(root, path, null); LocalDB.set(root); return null; }
    if (method === "PUT") { setAtPath(root, path, JSON.parse(JSON.stringify(body))); LocalDB.set(root); return body; }
    if (method === "PATCH") {
      const target = path ? getAtPath(root, path) : root;
      const merged = typeof target === "object" && target !== null ? target : {};
      Object.entries(body || {}).forEach(([key, value]) => { merged[key] = value; });
      setAtPath(root, path, merged);
      LocalDB.set(root);
      return merged;
    }
    return null;
  }

  /* =========================================================================
   *  CONNECTION / POLLING
   * ========================================================================= */
  function setConnection(status) {
    state.connection = status;
    el.connectionState.classList.toggle("online", status === "online");
    el.connectionState.textContent = LOCAL_MODE ? "LOCAL SETUP" : (status === "online" ? "LIVE · ONLINE" : status === "connecting" ? "CONNECTING…" : "OFFLINE");
  }

  async function pollOnce() {
    try {
      if (state.session && state.session.kind === "overseer") {
        const full = await dbGet("games/current");
        state.overseer.data = full || { public: {}, players: {}, votes: {}, nightActions: {}, missionClaims: {} };
        state.remote.public = state.overseer.data.public || null;
      } else if (state.session && state.session.kind === "participant") {
        const [pub, mine] = await Promise.all([
          dbGet("games/current/public"),
          dbGet(`games/current/players/${state.session.uid}`)
        ]);
        state.remote.public = pub || null;
        state.remote.myPlayer = mine || null;
      } else {
        state.remote.public = await dbGet("games/current/public");
      }
      setConnection("online");
    } catch (err) {
      setConnection("offline");
    }
    renderAll();
  }

  function startPolling() {
    stopPolling();
    setConnection("connecting");
    pollOnce();
    state.pollHandle = setInterval(pollOnce, 2500);
  }
  function stopPolling() {
    if (state.pollHandle) clearInterval(state.pollHandle);
    state.pollHandle = null;
  }

  /* =========================================================================
   *  PHASE HEADER / HERO / PROTOCOL LINE
   * ========================================================================= */
  const PHASE_LABEL = {
    REGISTRATION: "REGISTRATION",
    KULIAH: "KULIAH",
    KUDETA: "KUDETA",
    KUDETA_RESOLVED: "KUDETA · RESOLVED",
    KONSENSUS: "KONSENSUS",
    KONSENSUS_RESOLVED: "KONSENSUS · RESOLVED",
    ENDED: "GAME ENDED"
  };

  function tickClock() {
    const pub = state.remote.public;
    if (!pub || !pub.timerEnd || !["KUDETA", "KONSENSUS"].includes(pub.phase)) {
      el.phaseClock.hidden = true;
      return;
    }
    const remainingMs = pub.timerEnd - Date.now();
    const remaining = Math.max(0, Math.floor(remainingMs / 1000));
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    el.phaseClock.hidden = false;
    el.phaseClock.textContent = `${mm}:${ss}`;
    el.phaseClock.classList.toggle("urgent", remaining <= 30);
  }

  function renderHeader() {
    const pub = state.remote.public;
    const phase = (pub && pub.phase) || "REGISTRATION";
    el.phaseBadge.textContent = PHASE_LABEL[phase] || phase;

    ["KULIAH", "KUDETA", "KONSENSUS"].forEach((step) => {
      const stepEl = document.getElementById(`step-${step}`);
      if (!stepEl) return;
      const activeMap = { KULIAH: ["KULIAH"], KUDETA: ["KUDETA", "KUDETA_RESOLVED"], KONSENSUS: ["KONSENSUS", "KONSENSUS_RESOLVED"] };
      stepEl.classList.toggle("active", activeMap[step].includes(phase));
    });

    if (pub && pub.winner) {
      el.winnerBanner.hidden = false;
      el.winnerBanner.classList.toggle("council", pub.winner === "COUNCIL");
      el.winnerBanner.innerHTML = `
        <p>PROTOKOL KUDETA — RESULT</p>
        <h2>${pub.winner === "COUNCIL" ? "The Council Prevails" : "Majlis Bayangan Prevails"}</h2>
        <span>${pub.result || ""}</span>`;
    } else {
      el.winnerBanner.hidden = true;
    }

    const heroMap = {
      REGISTRATION: ["COUNCIL INTAKE", "Registration is open", "Register your name and where you are seated, then wait for the Overseer to confirm attendance."],
      KULIAH: ["QUIET OPERATIONS", "KULIAH is underway", "Blend in, work your mission, and watch the room closely."],
      KUDETA: ["THE COUNCIL SLEEPS", "KUDETA is live", "Special roles are acting. Shadows are choosing their target."],
      KUDETA_RESOLVED: ["RESULT ANNOUNCED", "KUDETA has resolved", "Await the Overseer to open KONSENSUS."],
      KONSENSUS: ["OPEN DELIBERATION", "KONSENSUS is live", "Discuss aloud, then cast your private vote."],
      KONSENSUS_RESOLVED: ["RESULT ANNOUNCED", "KONSENSUS has resolved", "Await the Overseer for the next move."],
      ENDED: ["PROTOKOL KUDETA", "The game has ended", "Thank you for playing Majlis Bayangan."]
    };
    const [eyebrow, title, desc] = heroMap[phase] || heroMap.REGISTRATION;
    el.heroEyebrow.textContent = eyebrow;
    el.heroTitle.textContent = title;
    el.heroDescription.textContent = desc;

    tickClock();
  }

  /* =========================================================================
   *  PARTICIPANT VIEW
   * ========================================================================= */
  function participantRegistrationForm(errorText) {
    return `
      <div class="panel-grid" style="grid-template-columns:1fr;max-width:560px;margin-inline:auto;">
        <div class="card">
          <div class="card-header">
            <p class="section-kicker">STEP 1 OF 1</p>
            <h2>Register for Majlis Bayangan</h2>
            <p>Your name and table are visible to the Council. Your role stays private until roles are drawn.</p>
          </div>
          <div class="card-content">
            <form id="register-form" class="form-stack">
              <div class="field-group">
                <label for="reg-name">Full name</label>
                <input id="reg-name" name="name" maxlength="80" required placeholder="e.g. Amirul Hakim" />
              </div>
              <div class="field-group">
                <label for="reg-table">Table number</label>
                <select id="reg-table" name="table" required>
                  ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">Table ${n}</option>`).join("")}
                </select>
              </div>
              ${errorText ? `<p class="inline-message">${errorText}</p>` : ""}
              <button class="button button-large" type="submit">Register</button>
              <p class="form-footnote">Registration locks in your name and table. The Overseer confirms attendance before roles are drawn.</p>
            </form>
          </div>
        </div>
      </div>`;
  }

  function participantWaitingState(player) {
    return `
      <div class="panel-grid" style="grid-template-columns:1fr;max-width:560px;margin-inline:auto;">
        <div class="card">
          <div class="card-content">
            <div class="status-state ${player.present ? "confirmed" : ""}">
              <span class="status-orb" aria-hidden="true"></span>
              <div>
                <strong>${player.present ? "Attendance confirmed" : "Waiting for the Overseer"}</strong>
                <p>${player.present ? "You're locked in. Roles are drawn once the Overseer randomizes the game." : `Hi ${escapeHtml(player.name)}, your registration is saved for Table ${player.table}. Sit tight while the Overseer confirms attendance.`}</p>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function roleRevealedMarkup(player) {
    const copy = (MBGame.roleCopy && MBGame.roleCopy[player.role]) || {};
    const isShadow = player.faction === "SHADOW";
    const missionDone = !!state.myMissionClaimed;
    return `
      <div class="role-reveal ${isShadow ? "shadow" : ""}">
        <div class="role-heading">
          <div>
            <span class="badge">${copy.faction || player.faction}</span>
            <h3>${escapeHtml(player.role)}</h3>
          </div>
          <span class="badge">TABLE ${escapeHtml(String(player.table != null ? player.table : ""))}</span>
        </div>
        <p>${escapeHtml(copy.brief || "")}</p>
        <div class="power-box"><span>SPECIAL ABILITY</span>${escapeHtml(copy.power || "")}</div>
        ${isShadow && player.shadowTeam && player.shadowTeam.length ? `
          <div class="team-box"><span>SHADOW TEAM</span>${player.shadowTeam.map((m) => escapeHtml(m.name)).join(", ")}</div>` : ""}
        ${player.mission ? `
          <div class="power-box"><span>${escapeHtml(player.mission.category || "MISSION")}</span>
            <p class="mission-text">${escapeHtml(player.mission.instruction)}</p>
            ${missionDone
              ? `<span class="mission-complete">Mission marked complete</span>`
              : `<button class="button" id="mission-complete-btn" type="button">Mark mission complete</button>`}
          </div>` : ""}
        ${!isShadow && player.mission && player.mission.clue && (missionDone || (state.remote.public && ["KONSENSUS", "KONSENSUS_RESOLVED"].includes(state.remote.public.phase))) ? `
          <div class="clue-box"><span>PRIVATE CLUE</span>${escapeHtml(player.mission.clue)}</div>` : ""}
        ${player.privateNotice ? `<div class="private-notice"><span>INVESTIGATION RESULT</span>${escapeHtml(player.privateNotice)}</div>` : ""}
        ${player.status === "SILENCED" ? `<div class="power-box silenced-card"><span class="silenced-badge">STATUS</span>You have been silenced. You may not speak, vote, or use powers this round.</div>` : ""}
      </div>`;
  }

  function powerActionForm(player, phase) {
    if (phase !== "KUDETA" || player.status !== "ACTIVE") return "";
    const roster = (state.remote.public && state.remote.public.roster) || [];
    const targets = roster.filter((p) => p.id !== player.id && p.status === "ACTIVE");
    const options = (extra) => `<option value="">Select a participant…</option>` + targets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · Table ${p.table != null ? p.table : "?"}</option>`).join("");

    if (player.faction === "SHADOW") {
      return `
        <div class="card" style="margin-top:20px;">
          <div class="card-header"><h3>KUDETA — Shadow Vote</h3><p>Choose who Majlis Bayangan should silence tonight.</p></div>
          <div class="card-content">
            <form id="night-form" class="form-stack" data-role="SHADOW">
              <div class="field-group">
                <label>Silence target</label>
                <select name="shadowTarget">${options()}</select>
              </div>
              ${player.role === "PENYEKAT BAYANGAN" && !player.powerUsed ? `
                <div class="field-group">
                  <label>Block a special power (optional, once per game)</label>
                  <select name="powerTarget">${options()}</select>
                </div>` : ""}
              <button class="button" type="submit">Submit</button>
            </form>
          </div>
        </div>`;
    }

    const powerMap = {
      "PENYIASAT MAJLIS": { type: "INVESTIGATE", label: "Investigate a participant" },
      "PENGAWAL MAJLIS": { type: "PROTECT", label: "Protect a participant" },
      "PEMULIH MAJLIS": { type: "RESTORE", label: "Restore a silenced participant" }
    };
    const power = powerMap[player.role];
    if (!power || player.powerUsed) return "";
    const restoreTargets = power.type === "RESTORE" ? roster.filter((p) => p.status === "SILENCED") : targets;
    return `
      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3>KUDETA — ${power.label}</h3><p>This power may be used once per game.</p></div>
        <div class="card-content">
          <form id="night-form" class="form-stack" data-role="${player.role}">
            <div class="field-group">
              <label>Target</label>
              <select name="powerTarget">
                <option value="">Select a participant…</option>
                ${restoreTargets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · Table ${p.table != null ? p.table : "?"}</option>`).join("")}
              </select>
            </div>
            <input type="hidden" name="powerType" value="${power.type}" />
            <button class="button" type="submit">Submit</button>
          </form>
        </div>
      </div>`;
  }

  function consensusVoteForm(player, phase) {
    if (phase !== "KONSENSUS" || player.status !== "ACTIVE") return "";
    const roster = (state.remote.public && state.remote.public.roster) || [];
    const targets = roster.filter((p) => p.id !== player.id && p.status === "ACTIVE");
    return `
      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3>KONSENSUS — Cast your vote</h3><p>Vote for who you believe belongs to Majlis Bayangan.</p></div>
        <div class="card-content">
          <form id="vote-form" class="form-stack">
            <div class="field-group">
              <label>Vote to silence</label>
              <select name="target">
                <option value="">Select a participant…</option>
                ${targets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · Table ${p.table != null ? p.table : "?"}</option>`).join("")}
              </select>
            </div>
            <button class="button" type="submit">Submit vote</button>
          </form>
        </div>
      </div>`;
  }

  function publicRosterCard() {
    const pub = state.remote.public;
    if (!pub) return "";
    const roster = pub.roster || [];
    const silenced = roster.filter((p) => p.status === "SILENCED");
    return `
      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3>Room status</h3><p>${roster.length} present · ${pub.presentCount || roster.length} confirmed</p></div>
        <div class="card-content">
          <div class="metric-grid">
            <div class="metric card"><span>PRESENT</span><strong>${pub.presentCount || 0}</strong></div>
            <div class="metric card"><span>SHADOWS ACTIVE</span><strong>—</strong><small>hidden</small></div>
            <div class="metric card"><span>COUNCIL ACTIVE</span><strong>—</strong><small>hidden</small></div>
            <div class="metric card"><span>ROUND</span><strong>${pub.roundNumber || 1}</strong></div>
          </div>
          ${silenced.length ? `
            <div class="public-silenced">
              <strong>SILENCED</strong>
              ${silenced.map((p) => `<span class="badge silenced-badge">${escapeHtml(p.name)}</span>`).join("")}
            </div>` : ""}
          ${pub.result ? `<div class="result-box"><span>LAST RESULT</span>${escapeHtml(pub.result)}</div>` : ""}
        </div>
      </div>`;
  }

  function renderParticipant() {
    if (!state.session || state.session.kind !== "participant") {
      el.appContent.innerHTML = participantRegistrationForm();
      wireRegistrationForm();
      return;
    }
    const player = state.remote.myPlayer;
    if (!player) {
      el.appContent.innerHTML = `<div class="empty-state">Loading your registration…</div>`;
      return;
    }
    const phase = (state.remote.public && state.remote.public.phase) || "REGISTRATION";
    if (!player.present || !player.role) {
      el.appContent.innerHTML = participantWaitingState(player) + publicRosterCard();
      return;
    }

    el.appContent.innerHTML = `
      <div class="panel-grid" style="grid-template-columns:1fr;max-width:640px;margin-inline:auto;">
        <div id="role-zone"></div>
        ${powerActionForm(player, phase)}
        ${consensusVoteForm(player, phase)}
        ${publicRosterCard()}
      </div>`;

    const zone = document.getElementById("role-zone");
    if (state.roleRevealed) {
      zone.innerHTML = roleRevealedMarkup(player);
      wireMissionButton(player);
    } else {
      zone.innerHTML = `
        <div class="role-back">
          <p>YOUR ROLE IS SEALED</p>
          <h3>${escapeHtml(player.name)}</h3>
          <button class="button button-large" id="reveal-role-btn" type="button">Reveal my role</button>
        </div>`;
      document.getElementById("reveal-role-btn").addEventListener("click", () => { state.roleRevealed = true; renderAll(); });
    }
    wireNightForm(player);
    wireVoteForm(player);
  }

  function wireMissionButton(player) {
    const btn = document.getElementById("mission-complete-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await dbPut(`games/current/missionClaims/${state.session.uid}`, true);
        state.myMissionClaimed = true;
        showMessage("Mission marked complete.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
        btn.disabled = false;
      }
    });
  }

  function wireNightForm(player) {
    const form = document.getElementById("night-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const payload = {};
      if (fd.get("shadowTarget")) payload.shadowTarget = fd.get("shadowTarget");
      if (fd.get("powerTarget")) payload.powerTarget = fd.get("powerTarget");
      if (fd.get("powerType")) payload.powerType = fd.get("powerType");
      if (!Object.keys(payload).length) { showMessage("Choose a target first.", "error"); return; }
      try {
        await dbPut(`games/current/nightActions/${state.session.uid}`, payload);
        showMessage("KUDETA action submitted. You may change it until the Overseer resolves.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  }

  function wireVoteForm(player) {
    const form = document.getElementById("vote-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const target = new FormData(form).get("target");
      if (!target) { showMessage("Choose someone to vote for first.", "error"); return; }
      try {
        await dbPut(`games/current/votes/${state.session.uid}`, target);
        showMessage("Vote submitted. You may change it while voting is open.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  }

  function wireRegistrationForm() {
    const form = document.getElementById("register-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const table = Number(fd.get("table"));
      if (!name) { showMessage("Please enter your name.", "error"); return; }
      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      try {
        const uid = await registerAsParticipant();
        await dbPut(`games/current/players/${uid}`, {
          id: uid, name, table, origin: table, present: false, revealed: false
        });
        showMessage(`Welcome, ${name}. Your registration is saved.`, "info");
        startPolling();
        renderAll();
      } catch (err) {
        showMessage(err.message, "error");
        submitBtn.disabled = false;
      }
    });
  }

  /* =========================================================================
   *  OVERSEER VIEW
   * ========================================================================= */
  function overseerLoginForm(errorText) {
    return `
      <div class="overseer-gate">
        <div class="card">
          <div class="card-content">
            <div class="login-seal">
              <span class="diamond-mark diamond-login" aria-hidden="true"><span>MB</span></span>
              <div>
                <span>ACCESS RESTRICTED</span>
                <strong>Overseer Login</strong>
                <small>Only the Overseer may confirm attendance and control the game.</small>
              </div>
            </div>
            <form id="overseer-login-form" class="login-form form-stack">
              <div class="field-group">
                <label for="ov-email">${LOCAL_MODE ? "Overseer name" : "Overseer email"}</label>
                <input id="ov-email" name="email" required placeholder="${LOCAL_MODE ? "F4nz2005" : "overseer@example.com"}" ${LOCAL_MODE ? `value="${escapeHtml(CFG.overseerName || "F4nz2005")}"` : ""} />
              </div>
              <div class="field-group">
                <label for="ov-password">Password</label>
                <div class="password-control">
                  <input id="ov-password" name="password" type="password" required placeholder="${LOCAL_MODE ? "any temporary password" : "Password"}" />
                  <button type="button" class="password-toggle" id="toggle-password">SHOW</button>
                </div>
              </div>
              ${errorText ? `<p class="inline-message">${escapeHtml(errorText)}</p>` : ""}
              <button class="button button-large" type="submit" ${state.loginBusy ? "disabled" : ""}>${state.loginBusy ? "Signing in…" : "Sign in"}</button>
            </form>
            <div class="security-note">
              <span>NOTE</span>
              <p>The Overseer password lives only in Firebase Authentication. It is never stored in any file in this project.</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  function wireOverseerLogin() {
    const form = document.getElementById("overseer-login-form");
    if (!form) return;
    const toggle = document.getElementById("toggle-password");
    const pwd = document.getElementById("ov-password");
    toggle.addEventListener("click", () => {
      pwd.type = pwd.type === "password" ? "text" : "password";
      toggle.textContent = pwd.type === "password" ? "SHOW" : "HIDE";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      state.loginBusy = true;
      renderAll();
      try {
        await signInOverseer(String(fd.get("email") || "").trim(), String(fd.get("password") || ""));
        state.loginBusy = false;
        startPolling();
      } catch (err) {
        state.loginBusy = false;
        state.overseerError = err.message;
        renderAll();
      }
    });
  }

  function overseerDashboard() {
    const data = state.overseer.data || { public: {}, players: {}, votes: {}, nightActions: {}, missionClaims: {} };
    const pub = data.public || {};
    const players = Object.values(data.players || {});
    const present = players.filter((p) => p.present);
    const votesCount = Object.keys(data.votes || {}).length;
    const nightCount = Object.keys(data.nightActions || {}).length;
    const phase = pub.phase || "REGISTRATION";

    return `
      <div class="overseer-layout">
        <div class="dashboard-grid">
          <div class="card">
            <div class="card-header"><h3>Overview</h3><p>Live counts across the room.</p></div>
            <div class="card-content">
              <div class="metric-grid">
                <div class="metric card"><span>REGISTERED</span><strong>${players.length}</strong></div>
                <div class="metric card"><span>CONFIRMED</span><strong>${present.length}</strong></div>
                <div class="metric card"><span>SUBMISSIONS</span><strong>${phase === "KUDETA" ? nightCount : votesCount}</strong></div>
                <div class="metric card"><span>ROUND</span><strong>${pub.roundNumber || 1}</strong></div>
              </div>
              <div class="phase-summary" style="margin-top:16px;">
                <span>CURRENT PHASE</span>
                <strong>${PHASE_LABEL[phase] || phase}</strong>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Controls</h3><p>Move the game forward.</p></div>
            <div class="card-content control-stack">
              ${LOCAL_MODE && !players.length ? `<button class="button" id="load-demo-btn" type="button">Load 35 demo participants</button>` : ""}
              <button class="button" id="confirm-attendance-btn" type="button" ${!players.length ? "disabled" : ""}>Confirm all registered as present</button>
              <button class="button randomize-button" id="randomize-btn" type="button" ${present.length < MBGame.MINIMUM_PLAYERS ? "disabled" : ""}>Randomize roles (${present.length}/${MBGame.MINIMUM_PLAYERS}+ needed)</button>
              <div class="phase-buttons">
                <button class="button secondary" id="start-kuliah-btn" type="button" ${!players.some((p) => p.role) ? "disabled" : ""}>Start KULIAH</button>
                <button class="button secondary" id="start-kudeta-btn" type="button" ${!players.some((p) => p.role) ? "disabled" : ""}>Start KUDETA (3:00)</button>
                <button class="button" id="resolve-kudeta-btn" type="button" ${phase !== "KUDETA" ? "disabled" : ""}>Resolve KUDETA</button>
              </div>
              <div class="phase-buttons">
                <button class="button secondary" id="start-konsensus-btn" type="button" ${phase !== "KUDETA_RESOLVED" ? "disabled" : ""}>Start KONSENSUS (5:00)</button>
                <button class="button" id="resolve-konsensus-btn" type="button" ${phase !== "KONSENSUS" ? "disabled" : ""}>Resolve KONSENSUS</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:20px;">
          <div class="card-header"><h3>Roster</h3><p>Tap a row's checkbox to mark attendance before randomizing.</p></div>
          <div class="card-content">
            <div class="table-scroll">
              <table>
                <thead><tr><th>Present</th><th>Name</th><th>Table</th><th>Status</th><th>Role</th><th>Power used</th></tr></thead>
                <tbody>
                  ${players.length ? players.map((p) => `
                    <tr>
                      <td><input type="checkbox" data-uid="${p.id}" class="present-toggle" ${p.present ? "checked" : ""} /></td>
                      <td>${escapeHtml(p.name)}</td>
                      <td>${escapeHtml(String(p.table != null ? p.table : "—"))}</td>
                      <td>${escapeHtml(p.status || "—")}</td>
                      <td>${escapeHtml(p.role || "—")}</td>
                      <td>${p.powerUsed ? "Yes" : "No"}</td>
                    </tr>`).join("") : `<tr><td colspan="6">No registrations yet.</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:20px;">
          <div class="card-content">
            <div class="danger-zone">
              <div>
                <strong>Reset the game</strong>
                <p>Removes registrations, roles, missions, votes, and results. Cannot be undone.</p>
              </div>
              <button class="button danger" id="reset-open-btn" type="button">Reset everything</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderOverseer() {
    if (!state.session || state.session.kind !== "overseer") {
      el.appContent.innerHTML = overseerLoginForm(state.overseerError);
      state.overseerError = null;
      wireOverseerLogin();
      return;
    }
    if (!state.overseer.data) {
      el.appContent.innerHTML = `<div class="empty-state">Loading Overseer dashboard…</div>`;
      return;
    }
    el.appContent.innerHTML = overseerDashboard();
    wireOverseerControls();
  }

  function wireOverseerControls() {
    const byId = (id) => document.getElementById(id);

    const loadDemo = byId("load-demo-btn");
    if (loadDemo) loadDemo.addEventListener("click", async () => {
      loadDemo.disabled = true;
      const players = {};
      DEMO_NAMES.forEach((name, i) => {
        const uid = localUid(i);
        players[uid] = { id: uid, name, table: (i % 5) + 1, origin: (i % 5) + 1, present: false, revealed: false, status: "ACTIVE" };
      });
      await dbPatch("games/current/players", players);
      showMessage("Loaded 35 demo participants.", "info");
      await pollOnce();
    });

    const confirmBtn = byId("confirm-attendance-btn");
    if (confirmBtn) confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      const players = state.overseer.data.players || {};
      await dbPatch("games/current/players", flattenUpdates(players, "present", true));
      showMessage("Attendance confirmed for all registered participants.", "info");
      await pollOnce();
    });

    document.querySelectorAll(".present-toggle").forEach((box) => {
      box.addEventListener("change", async () => {
        const uid = box.getAttribute("data-uid");
        await dbPut(`games/current/players/${uid}/present`, box.checked);
        await pollOnce();
      });
    });

    const randomizeBtn = byId("randomize-btn");
    if (randomizeBtn) randomizeBtn.addEventListener("click", async () => {
      randomizeBtn.disabled = true;
      try {
        const players = Object.values(state.overseer.data.players || {});
        const assigned = MBGame.assignAllRoles(players);
        if (!assigned) { showMessage("Not enough present participants to assign Shadow roles.", "error"); randomizeBtn.disabled = false; return; }
        const updates = {};
        assigned.forEach((p) => { updates[p.id] = p; });
        await dbPatch("games/current/players", updates);
        const publicState = MBGame.makePublicState(assigned, { phase: "KULIAH", result: "", winner: null, roundNumber: 1, timerEnd: null });
        await dbPut("games/current/public", publicState);
        showMessage("Roles randomized. KULIAH has begun.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
        randomizeBtn.disabled = false;
      }
    });

    const startKuliah = byId("start-kuliah-btn");
    if (startKuliah) startKuliah.addEventListener("click", async () => {
      await dbPatch("games/current/public", { phase: "KULIAH", timerEnd: null });
      await pollOnce();
    });

    const startKudeta = byId("start-kudeta-btn");
    if (startKudeta) startKudeta.addEventListener("click", async () => {
      await dbDelete("games/current/nightActions");
      await dbPatch("games/current/public", { phase: "KUDETA", timerEnd: Date.now() + 3 * 60000 });
      await pollOnce();
    });

    const resolveKudeta = byId("resolve-kudeta-btn");
    if (resolveKudeta) resolveKudeta.addEventListener("click", async () => {
      resolveKudeta.disabled = true;
      try {
        const players = Object.values(state.overseer.data.players || {});
        const actions = state.overseer.data.nightActions || {};
        const outcome = MBGame.resolveNight(players, actions);
        const updates = {};
        outcome.players.forEach((p) => { updates[p.id] = p; });
        await dbPatch("games/current/players", updates);
        const publicState = MBGame.makePublicState(outcome.players, {
          ...state.overseer.data.public,
          phase: outcome.winner ? "ENDED" : "KUDETA_RESOLVED",
          result: outcome.result,
          winner: outcome.winner,
          timerEnd: null
        });
        await dbPut("games/current/public", publicState);
        showMessage("KUDETA resolved.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
      }
      resolveKudeta.disabled = false;
    });

    const startKonsensus = byId("start-konsensus-btn");
    if (startKonsensus) startKonsensus.addEventListener("click", async () => {
      await dbDelete("games/current/votes");
      await dbPatch("games/current/public", { phase: "KONSENSUS", timerEnd: Date.now() + 5 * 60000 });
      await pollOnce();
    });

    const resolveKonsensus = byId("resolve-konsensus-btn");
    if (resolveKonsensus) resolveKonsensus.addEventListener("click", async () => {
      resolveKonsensus.disabled = true;
      try {
        const players = Object.values(state.overseer.data.players || {});
        const votes = state.overseer.data.votes || {};
        const outcome = MBGame.resolveConsensus(players, votes);
        const updates = {};
        outcome.players.forEach((p) => { updates[p.id] = p; });
        await dbPatch("games/current/players", updates);
        const nextRound = (state.overseer.data.public.roundNumber || 1) + 1;
        const publicState = MBGame.makePublicState(outcome.players, {
          ...state.overseer.data.public,
          phase: outcome.winner ? "ENDED" : "KULIAH",
          result: outcome.result,
          winner: outcome.winner,
          roundNumber: outcome.winner ? state.overseer.data.public.roundNumber : nextRound,
          timerEnd: null
        });
        await dbPut("games/current/public", publicState);
        showMessage("KONSENSUS resolved.", "info");
        await pollOnce();
      } catch (err) {
        showMessage(err.message, "error");
      }
      resolveKonsensus.disabled = false;
    });

    const resetOpen = byId("reset-open-btn");
    if (resetOpen) resetOpen.addEventListener("click", () => el.resetOne.showModal());
  }

  function flattenUpdates(players, field, value) {
    const updates = {};
    Object.keys(players).forEach((uid) => { updates[uid] = { ...players[uid], [field]: value }; });
    return updates;
  }

  /* =========================================================================
   *  RESET DIALOG WIRING (dialogs already exist in index.html)
   * ========================================================================= */
  el.continueReset.addEventListener("click", (event) => {
    event.preventDefault();
    el.resetOne.close();
    el.resetTwo.showModal();
  });
  el.permanentReset.addEventListener("click", async (event) => {
    event.preventDefault();
    el.resetTwo.close();
    try {
      if (LOCAL_MODE) LocalDB.reset();
      else await dbDelete("games/current");
      showMessage("The game has been reset.", "info");
      await pollOnce();
    } catch (err) {
      showMessage(err.message, "error");
    }
  });

  /* =========================================================================
   *  TAB SWITCHING / TOP-LEVEL RENDER
   * ========================================================================= */
  el.modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.getAttribute("data-tab");
      el.modeButtons.forEach((b) => b.classList.toggle("active", b === btn));
      state.roleRevealed = false;
      renderAll();
    });
  });

  function renderAll() {
    renderHeader();
    if (state.tab === "overseer") renderOverseer();
    else renderParticipant();
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  /* =========================================================================
   *  BOOT
   * ========================================================================= */
  function boot() {
    if (!MBGame) { showMessage("game.js failed to load. Check the file is present next to app.js.", "error"); return; }
    loadSession();
    setInterval(tickClock, 1000);
    if (state.session) {
      state.tab = state.session.kind === "overseer" ? "overseer" : "participant";
      el.modeButtons.forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === state.tab));
      startPolling();
    } else {
      setConnection(LOCAL_MODE ? "online" : "connecting");
      pollOnce();
    }
    renderAll();
  }

  boot();
})();
