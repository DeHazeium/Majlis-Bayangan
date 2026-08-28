(function () {
  "use strict";

  const G = window.MBGame;
  const config = window.MB_FIREBASE_CONFIG || {};
  const firebaseConfigured = Boolean(
    config.apiKey && config.databaseURL && config.adminEmail &&
    !String(config.apiKey).startsWith("YOUR_") &&
    !String(config.databaseURL).startsWith("YOUR_") &&
    !String(config.adminEmail).startsWith("YOUR_")
  );
  const OVERSEER_NAME = config.overseerName || "F4nz2005";
  const STORAGE_KEY = "majlis-bayangan-vanilla-v1";
  const SESSION_KEY = "majlis-bayangan-firebase-session-v1";
  const EMPTY_RESULT = "The Council is awaiting its first decision.";

  const phaseCopy = {
    REGISTRATION: { eyebrow: "Council intake", title: "Registration is open", description: "Register your name and table, then wait for the Overseer to confirm attendance." },
    KULIAH: { eyebrow: "Normal session", title: "KULIAH is active", description: "Complete your instruction, observe the room and guard your identity." },
    KUDETA: { eyebrow: "Night protocol", title: "KUDETA has begun", description: "Hidden powers are active. Submit your action before the protocol closes." },
    KONSENSUS: { eyebrow: "Council hearing", title: "KONSENSUS is active", description: "Discuss aloud, then cast one private vote before time expires." }
  };

  const state = {
    players: [], publicRoster: [], attendanceLocked: false, rolesAssigned: false,
    phase: "REGISTRATION", round: 1, winner: null, phaseEndsAt: null,
    lastResult: EMPTY_RESULT, votes: {}, nightActions: {}, missionClaims: {},
    selectedPlayerId: "", revealedIds: new Set(), session: null,
    liveConnected: false, adminUnlocked: false, currentTab: "participant",
    voteTarget: "", shadowTarget: "", powerTarget: "", message: ""
  };

  const app = document.getElementById("app-content");
  const globalMessage = document.getElementById("global-message");
  const resetOne = document.getElementById("reset-confirm-one");
  const resetTwo = document.getElementById("reset-confirm-two");

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }

  function formatTimer(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function selectedPlayer() {
    return state.players.find((player) => player.id === state.selectedPlayerId) || state.players[0] || null;
  }

  function activeRoster() { return state.publicRoster.filter((player) => player.present && player.status === "ACTIVE"); }
  function silencedRoster() { return state.publicRoster.filter((player) => player.status === "SILENCED"); }
  function presentPlayers() { return state.players.filter((player) => player.present); }

  function setMessage(text) {
    state.message = text || "";
    globalMessage.textContent = state.message;
    globalMessage.hidden = !state.message;
  }

  function refreshLocalRoster() {
    state.publicRoster = state.players.filter((player) => player.present).map(({ id, name, table, status, present }) => ({ id, name, table, status, present }));
  }

  function saveLocal() {
    if (firebaseConfigured) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      players: state.players, attendanceLocked: state.attendanceLocked,
      rolesAssigned: state.rolesAssigned, phase: state.phase, round: state.round,
      winner: state.winner, phaseEndsAt: state.phaseEndsAt,
      lastResult: state.lastResult, votes: state.votes,
      nightActions: state.nightActions, missionClaims: state.missionClaims
    }));
  }

  function commit() {
    if (!firebaseConfigured) refreshLocalRoster();
    saveLocal();
    render();
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch { localStorage.removeItem(SESSION_KEY); return null; }
  }

  async function identityRequest(path, body) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(config.apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data.error && data.error.message) || "Firebase sign-in failed.");
    return data;
  }

  async function signInAnonymous() {
    const data = await identityRequest("accounts:signUp", { returnSecureToken: true });
    return saveSession({ idToken: data.idToken, refreshToken: data.refreshToken, localId: data.localId, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000 });
  }

  async function signInOverseer(password) {
    const data = await identityRequest("accounts:signInWithPassword", { email: config.adminEmail, password, returnSecureToken: true });
    return saveSession({ idToken: data.idToken, refreshToken: data.refreshToken, localId: data.localId, email: data.email, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000 });
  }

  function isOverseerSession(session) {
    return Boolean(session && session.email && session.email.toLowerCase() === String(config.adminEmail).toLowerCase());
  }

  async function freshSession(session) {
    if (session.expiresAt > Date.now() + 5 * 60 * 1000) return session;
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken })
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data.error && data.error.message) || "Firebase session expired.");
    Object.assign(session, { idToken: data.id_token, refreshToken: data.refresh_token, localId: data.user_id, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
    return saveSession(session);
  }

  async function dbRequest(path, method = "GET", value) {
    if (!state.session) throw new Error("Firebase session is not ready.");
    const active = await freshSession(state.session);
    const url = `${String(config.databaseURL).replace(/\/$/, "")}/${path.replace(/^\/+|\/+$/g, "")}.json?auth=${encodeURIComponent(active.idToken)}`;
    const response = await fetch(url, { method, headers: value === undefined ? undefined : { "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Firebase request failed (${response.status}).`);
    return data;
  }

  const dbGet = (path) => dbRequest(path);
  const dbPut = (path, value) => dbRequest(path, "PUT", value);

  function applyPublic(gamePublic) {
    state.attendanceLocked = Boolean(gamePublic && gamePublic.attendanceLocked);
    state.rolesAssigned = Boolean(gamePublic && gamePublic.rolesAssigned);
    state.phase = (gamePublic && gamePublic.phase) || "REGISTRATION";
    state.round = (gamePublic && gamePublic.round) || 1;
    state.winner = (gamePublic && gamePublic.winner) || null;
    state.phaseEndsAt = gamePublic ? gamePublic.phaseEndsAt || null : null;
    state.lastResult = (gamePublic && gamePublic.lastResult) || EMPTY_RESULT;
    state.publicRoster = (gamePublic && gamePublic.roster) || [];
  }

  async function syncLive() {
    if (!state.session) return;
    if (isOverseerSession(state.session)) {
      const game = await dbGet("games/current");
      state.players = Object.values((game && game.players) || {});
      applyPublic(game && game.public);
      state.votes = (game && game.votes) || {};
      state.nightActions = (game && game.nightActions) || {};
      state.missionClaims = (game && game.missionClaims) || {};
    } else {
      const uid = state.session.localId;
      const [gamePublic, player, vote, nightAction, missionClaim] = await Promise.all([
        dbGet("games/current/public"), dbGet(`games/current/players/${uid}`),
        dbGet(`games/current/votes/${uid}`), dbGet(`games/current/nightActions/${uid}`),
        dbGet(`games/current/missionClaims/${uid}`)
      ]);
      state.players = player ? [player] : [];
      if (player) state.selectedPlayerId = player.id;
      applyPublic(gamePublic);
      state.votes = vote ? { [uid]: vote } : {};
      state.nightActions = nightAction ? { [uid]: nightAction } : {};
      state.missionClaims = missionClaim ? { [uid]: true } : {};
    }
    state.liveConnected = true;
    render();
  }

  async function saveGame(options = {}) {
    const players = options.players ?? state.players;
    const attendanceLocked = options.attendanceLocked ?? state.attendanceLocked;
    const rolesAssigned = options.rolesAssigned ?? state.rolesAssigned;
    const phase = options.phase ?? state.phase;
    const round = options.round ?? state.round;
    const winner = options.winner === undefined ? state.winner : options.winner;
    const phaseEndsAt = options.phaseEndsAt === undefined ? state.phaseEndsAt : options.phaseEndsAt;
    const lastResult = options.lastResult ?? state.lastResult;
    const votes = options.votes ?? state.votes;
    const nightActions = options.nightActions ?? state.nightActions;
    const missionClaims = options.missionClaims ?? state.missionClaims;
    if (firebaseConfigured && state.session && isOverseerSession(state.session)) {
      const publicState = G.makePublicState(players, { attendanceLocked, rolesAssigned, phase, round, winner, phaseEndsAt, lastResult });
      await dbPut("games/current", {
        public: publicState,
        players: Object.fromEntries(players.map((player) => [player.id, player])),
        votes, nightActions, missionClaims
      });
    }
  }

  function card(title, description, body, kicker = "") {
    return `<article class="card"><header class="card-header">${kicker ? `<p class="section-kicker">${esc(kicker)}</p>` : ""}<h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ""}</header><div class="card-content">${body}</div></article>`;
  }

  function targetSelect(label, id, candidates, emptyText = "No eligible target") {
    if (!candidates.length) return `<div class="field-group"><label>${esc(label)}</label><div class="empty-state">${esc(emptyText)}</div></div>`;
    return `<div class="field-group"><label for="${esc(id)}">${esc(label)}</label><select id="${esc(id)}" data-target-select="${esc(id)}"><option value="">Choose participant</option>${candidates.map((candidate) => `<option value="${esc(candidate.id)}">${esc(candidate.name)} · Table ${candidate.table}</option>`).join("")}</select></div>`;
  }

  function renderHeader() {
    const now = Date.now();
    const clock = document.getElementById("phase-clock");
    const badge = document.getElementById("phase-badge");
    badge.textContent = state.winner ? "GAME OVER" : state.phase;
    if (state.phaseEndsAt && !state.winner) {
      const remaining = state.phaseEndsAt - now;
      clock.hidden = false;
      clock.textContent = formatTimer(remaining);
      clock.classList.toggle("urgent", remaining <= 30000);
    } else clock.hidden = true;

    const connection = document.getElementById("connection-state");
    connection.textContent = firebaseConfigured ? (state.liveConnected ? "LIVE" : "SYNCING") : "LOCAL SETUP";
    connection.classList.toggle("online", firebaseConfigured && state.liveConnected);

    const copy = phaseCopy[state.phase];
    document.getElementById("hero-eyebrow").textContent = state.winner ? `ROUND ${state.round} CONCLUDED` : `${copy.eyebrow.toUpperCase()} · ROUND ${state.round}`;
    document.getElementById("hero-title").textContent = state.winner ? "The final protocol is sealed" : copy.title;
    document.getElementById("hero-description").textContent = state.winner ? state.lastResult : copy.description;
    ["KULIAH", "KUDETA", "KONSENSUS"].forEach((phase) => document.getElementById(`step-${phase}`).classList.toggle("active", state.phase === phase && !state.winner));

    const banner = document.getElementById("winner-banner");
    if (state.winner) {
      banner.hidden = false;
      banner.className = `winner-banner ${state.winner === "COUNCIL" ? "council" : ""}`;
      banner.innerHTML = `<p>FINAL VERDICT</p><h2>${state.winner === "SHADOW" ? "MAJLIS BAYANGAN WINS" : "THE COUNCIL WINS"}</h2><span>${state.winner === "SHADOW" ? "The Shadows now equal or outnumber the remaining Council." : "Every member of Majlis Bayangan has been silenced."}</span>`;
    } else banner.hidden = true;
  }

  function registrationCard(player) {
    const disabled = state.attendanceLocked || Boolean(player);
    const tableOptions = G.TABLES.map((number) => `<option value="${number}">Table ${number}</option>`).join("");
    const silenced = silencedRoster();
    return card("Enter the Council", "One phone registers one participant. Your classified data stays private.", `
      <form id="registration-form" class="form-stack">
        <div class="field-group"><label for="participant-name">Full name</label><input id="participant-name" name="name" placeholder="e.g. Muhammad Irfan" ${disabled ? "disabled" : ""} required /></div>
        <div class="field-group"><label for="participant-table">Table</label><select id="participant-table" name="table" ${disabled ? "disabled" : ""} required><option value="">Choose table</option>${tableOptions}</select></div>
        <button class="button" ${disabled ? "disabled" : ""}>Register</button>
      </form>
      ${silenced.length ? `<div class="public-silenced"><strong>SILENCED</strong>${silenced.map((item) => `<span class="badge silenced-badge">${esc(item.name)}</span>`).join("")}</div>` : ""}
    `, "Participant access");
  }

  function roleCard(player) {
    if (!player) return card("Your Council status", "This phone only receives its own classified record.", `<div class="empty-state">Register your name to join the Council.</div>`, "Private identity");
    const switcher = !firebaseConfigured ? `<div class="field-group"><label>Local participant</label><select data-target-select="player-switch">${state.players.slice().sort((a, b) => a.table - b.table || a.name.localeCompare(b.name)).map((item) => `<option value="${esc(item.id)}" ${item.id === player.id ? "selected" : ""}>${esc(item.name)} · Table ${item.table}</option>`).join("")}</select></div>` : "";
    if (!player.present) return card("Your Council status", "Attendance must be confirmed before roles are released.", `${switcher}<div class="status-state"><span class="status-orb"></span><div><strong>Attendance pending</strong><p>The Overseer has not confirmed ${esc(player.name)} yet.</p></div></div>`, "Private identity");
    if (!state.rolesAssigned) return card("Your Council status", "Your attendance is confirmed.", `${switcher}<div class="status-state confirmed"><span class="status-orb"></span><div><strong>Attendance confirmed</strong><p>Wait for the Overseer to randomize all roles.</p></div></div>`, "Private identity");
    if (!state.revealedIds.has(player.id)) return card("Your Council status", "Keep the screen private while revealing your identity.", `${switcher}<div class="role-back"><span class="diamond-mark"><span>MB</span></span><p>CLASSIFIED IDENTITY</p><h3>${esc(player.name)}</h3><span>Table ${player.table}</span><button class="button danger" data-action="reveal-role">Reveal my role</button></div>`, "Private identity");
    const info = G.roleCopy[player.role];
    return card("Your Council status", "Your classified identity and speciality.", `${switcher}<div class="role-reveal ${player.faction === "SHADOW" ? "shadow" : ""}"><div class="role-heading"><div><p class="section-kicker">YOUR CLASSIFIED ROLE</p><h3>${esc(player.role)}</h3></div><span class="badge ${player.status === "SILENCED" ? "silenced-badge" : ""}">${esc(player.status)}</span></div><span class="badge">${esc(info.faction)}</span><p>${esc(info.brief)}</p><div class="power-box"><span>Speciality</span>${esc(info.power)}</div>${player.shadowTeam ? `<div class="team-box"><span>Your Shadow Council</span>${player.shadowTeam.map((member) => esc(member.name)).join(" · ")}</div>` : ""}${player.privateNotice ? `<div class="private-notice"><span>Private intelligence</span>${esc(player.privateNotice)}</div>` : ""}</div>`, "Private identity");
  }

  function missionCard(player) {
    if (!player || !player.present || !state.rolesAssigned || !state.revealedIds.has(player.id) || !player.mission) return "";
    const completed = Boolean(state.missionClaims[player.id]);
    const clue = player.mission.clue && (completed || player.clueUnlocked || state.winner) ? `<div class="clue-box"><span>Council clue</span>${esc(player.mission.clue)}</div>` : "";
    const action = !completed && state.phase === "KULIAH" && player.status === "ACTIVE" && !state.winner ? `<button class="button" data-action="complete-mission">Mark mission complete</button>` : "";
    return card(player.mission.category, "Complete naturally during KULIAH. Never pressure anyone or touch personal belongings.", `<p class="mission-text">${esc(player.mission.instruction)}</p>${action}${completed ? `<span class="mission-complete">MISSION RECORDED</span>` : ""}${clue}`, "ARAHAN KULIAH");
  }

  function actionCard(player) {
    if (!player || !player.present || !state.rolesAssigned || !state.revealedIds.has(player.id) || state.winner) return "";
    if (player.status === "SILENCED") return card("You have been silenced", "Your voice has been revoked.", `<p>You may observe, but cannot vote, use powers or discuss suspicions unless Pemulih Majlis restores you.</p>`, "VOICE REVOKED");
    const active = activeRoster().filter((candidate) => candidate.id !== player.id);
    if (state.phase === "KONSENSUS") {
      const currentVote = state.publicRoster.find((candidate) => candidate.id === state.votes[player.id]);
      return card("Cast KONSENSUS vote", "Discussion is public. Your final vote remains private.", `<div class="control-stack">${targetSelect("Silence one participant", "vote-target", active)}${currentVote ? `<span class="sealed-state">Current sealed vote: ${esc(currentVote.name)}</span>` : ""}<button class="button" data-action="submit-vote">Seal my vote</button></div>`, "PRIVATE BALLOT");
    }
    if (state.phase !== "KUDETA") return "";
    const teamIds = new Set((player.shadowTeam || []).map((member) => member.id));
    const shadowCandidates = active.filter((candidate) => !teamIds.has(candidate.id));
    const restored = silencedRoster().filter((candidate) => candidate.id !== player.id);
    let controls = "";
    if (player.faction === "SHADOW") controls += targetSelect("Shadow silence vote", "shadow-target", shadowCandidates);
    if (player.role === "PENYEKAT BAYANGAN" && !player.powerUsed) controls += targetSelect("Optional one-time block", "power-target", shadowCandidates);
    if (player.role === "PENYIASAT MAJLIS" && !player.powerUsed) controls += targetSelect("Investigate once", "power-target", active);
    if (player.role === "PENGAWAL MAJLIS" && !player.powerUsed) controls += targetSelect("Protect once", "power-target", active);
    if (player.role === "PEMULIH MAJLIS" && !player.powerUsed) controls += targetSelect("Restore once", "power-target", restored, "No silenced participant available");
    if (player.faction === "COUNCIL" && (player.role === "AHLI MAJLIS" || player.powerUsed)) controls = `<div class="empty-state">You have no available KUDETA power. Stay silent and observe.</div>`;
    return card("Submit KUDETA order", "Your submission may be changed until the Overseer resolves the phase.", `<div class="control-stack">${controls}${state.nightActions[player.id] ? `<span class="sealed-state">✓ KUDETA order submitted</span>` : ""}<button class="button danger" data-action="submit-night">Seal KUDETA action</button></div>`, "NIGHT ACTION");
  }

  function renderParticipant() {
    const player = selectedPlayer();
    return `<div class="panel-grid"><div>${registrationCard(player)}</div><div class="participant-stack">${roleCard(player)}${missionCard(player)}${actionCard(player)}</div></div>`;
  }

  function metric(label, value, note) {
    return `<article class="card metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
  }

  function renderBalance() {
    return G.TABLES.map((table) => {
      const members = state.players.filter((player) => player.table === table);
      const present = members.filter((player) => player.present);
      const active = present.filter((player) => player.status === "ACTIVE");
      const shadows = active.filter((player) => player.faction === "SHADOW").length;
      const dots = Array.from({ length: Math.max(present.length, 7) }, (_, index) => `<i class="dot ${state.rolesAssigned && index < shadows ? "shadow" : index < active.length ? "loyal" : index < present.length ? "silenced" : ""}"></i>`).join("");
      return `<div class="balance-row"><div><strong>Table ${table}</strong><span>${active.length}/${present.length} active</span></div><div class="dots">${dots}</div><span class="badge">${state.rolesAssigned ? `${shadows} active Shadow${shadows === 1 ? "" : "s"}` : `${members.length} registered`}</span></div>`;
    }).join("");
  }

  function renderRoster() {
    if (!state.players.length) return `<div class="empty-state">No participants registered yet.</div>`;
    const rows = state.players.slice().sort((a, b) => a.table - b.table || a.name.localeCompare(b.name)).map((player) => `<tr><td><input type="checkbox" data-attendance="${esc(player.id)}" ${player.present ? "checked" : ""} ${state.attendanceLocked ? "disabled" : ""} /></td><td>${esc(player.name)}</td><td>Table ${player.table}</td><td><span class="badge ${player.status === "SILENCED" ? "silenced-badge" : ""}">${player.present ? esc(player.status) : "PENDING"}</span></td><td>${esc(player.role || "Not assigned")}</td><td>${player.powerUsed ? "Used" : player.role && !["AHLI MAJLIS", "MAJLIS BAYANGAN"].includes(player.role) ? "Ready" : "—"}</td></tr>`).join("");
    return `<div class="table-scroll"><table><thead><tr><th>Present</th><th>Name</th><th>Table</th><th>Status</th><th>Role</th><th>Power</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderAdminControls() {
    const present = presentPlayers();
    let controls = "";
    if (!state.rolesAssigned) {
      controls = `<div><div class="row" style="justify-content:space-between"><span>Confirmed attendance</span><strong>${present.length}/${G.TARGET_COUNT}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, present.length / G.TARGET_COUNT * 100)}%"></div></div></div><div class="button-row"><button class="button secondary" data-action="mark-all" ${state.attendanceLocked || !state.players.length ? "disabled" : ""}>Mark all present</button><button class="button" data-action="lock-attendance" ${state.attendanceLocked || present.length < G.MINIMUM_PLAYERS ? "disabled" : ""}>Lock attendance</button></div><button class="button danger" data-action="assign-roles" ${!state.attendanceLocked ? "disabled" : ""}>Randomize all roles</button>`;
    } else if (!state.winner) {
      controls = `<div class="phase-summary"><span>CURRENT PROTOCOL</span><strong>${state.phase}</strong>${state.phaseEndsAt ? `<b>${formatTimer(state.phaseEndsAt - Date.now())}</b>` : ""}</div><div class="phase-buttons"><button class="button ${state.phase === "KULIAH" ? "" : "secondary"}" data-phase="KULIAH">Start KULIAH</button><button class="button ${state.phase === "KUDETA" ? "danger" : "secondary"}" data-phase="KUDETA">Start KUDETA · 3 min</button><button class="button ${state.phase === "KONSENSUS" ? "" : "secondary"}" data-phase="KONSENSUS">Start KONSENSUS · 5 min</button></div>${state.phase === "KUDETA" ? `<button class="button danger" data-action="resolve-night">Resolve KUDETA · ${Object.keys(state.nightActions).length} submitted</button>` : ""}${state.phase === "KONSENSUS" ? `<button class="button danger" data-action="resolve-vote">Close voting · ${Object.keys(state.votes).length} submitted</button>` : ""}`;
    }
    return `<div class="control-stack">${controls}<div class="result-box"><span>Latest public result</span>${esc(state.lastResult)}</div>${!firebaseConfigured && !state.rolesAssigned ? `<button class="button secondary" data-action="load-demo">Load 35 demo participants</button>` : ""}<div class="danger-zone"><div><strong>Reset complete game</strong><p>Deletes attendance, roles, missions, votes, actions, silences and results.</p></div><button class="button danger" data-action="open-reset">Reset game</button></div></div>`;
  }

  function renderOverseer() {
    if (!state.adminUnlocked) {
      return `<div class="overseer-layout">${card("Overseer sign-in", "Only the Overseer may resolve actions, silence players or reset the game.", `<form id="admin-login-form" class="form-stack"><div class="field-group"><label for="overseer-id">Overseer ID</label><input id="overseer-id" name="id" autocomplete="username" required /></div><div class="field-group"><label for="overseer-password">Password</label><input id="overseer-password" name="password" type="password" autocomplete="current-password" required /></div><button class="button">Unlock Overseer controls</button></form><p style="color:#817a70;font-size:12px">The ID identifies you; Firebase verifies the private password.</p>`, "Restricted control")}</div>`;
    }
    const activeShadows = state.players.filter((player) => player.present && player.status === "ACTIVE" && player.faction === "SHADOW").length;
    const activeCouncil = state.players.filter((player) => player.present && player.status === "ACTIVE" && player.faction === "COUNCIL").length;
    return `<div class="overseer-layout"><section class="metric-grid">${metric("Present", presentPlayers().length, `Expected around ${G.TARGET_COUNT}`)}${metric("Active Shadows", state.rolesAssigned ? activeShadows : "—", "Win at equality")}${metric("Active Council", state.rolesAssigned ? activeCouncil : "—", "Remove every Shadow")}${metric("Silenced", silencedRoster().length, `Round ${state.round}`)}</section><section class="dashboard-grid">${card("Protocol command", "Only controls in this panel advance or resolve the game.", renderAdminControls(), `Overseer control · ${OVERSEER_NAME}`)}${card("Table status", "Roles are visible here only to the Overseer.", `<div class="table-balance-list">${renderBalance()}</div>`, "Live balance")}</section>${card("Full game roster", "Attendance, roles and power availability.", renderRoster(), "Council registry")}</div>`;
  }

  function render() {
    renderHeader();
    document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.currentTab));
    app.innerHTML = state.currentTab === "participant" ? renderParticipant() : renderOverseer();
    setMessage(state.message);
    const values = { "vote-target": state.voteTarget, "shadow-target": state.shadowTarget, "power-target": state.powerTarget };
    Object.entries(values).forEach(([id, value]) => { const element = document.getElementById(id); if (element && value) element.value = value; });
  }

  async function registerParticipant(form) {
    if (state.attendanceLocked) return setMessage("Registration has been locked by the Overseer.");
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const table = Number(data.get("table"));
    if (!name || !table) return;
    if (state.publicRoster.some((player) => player.name.toLowerCase() === name.toLowerCase() && player.table === table)) return setMessage("That name is already registered at this table.");
    const id = firebaseConfigured && state.session ? state.session.localId : makeId();
    const player = { id, name, table, present: false, revealed: false, status: "ACTIVE" };
    try {
      if (firebaseConfigured) {
        if (!state.session || isOverseerSession(state.session)) throw new Error("Participant connection is not ready. Refresh the page.");
        await dbPut(`games/current/players/${id}`, player);
      }
      state.players = firebaseConfigured ? [player] : [...state.players, player];
      state.selectedPlayerId = id;
      setMessage("Registration received. Awaiting attendance confirmation.");
      commit();
    } catch (error) { setMessage(error.message || "Registration failed."); }
  }

  async function loginAdmin(form) {
    const data = new FormData(form);
    const id = String(data.get("id") || "").trim();
    const password = String(data.get("password") || "");
    if (id !== OVERSEER_NAME) return setMessage("Overseer ID is not recognized.");
    try {
      if (firebaseConfigured) {
        state.session = await signInOverseer(password);
        if (!isOverseerSession(state.session)) throw new Error("This account is not the configured Overseer.");
        await syncLive();
      } else if (!password) throw new Error("Enter any temporary password for local setup mode.");
      state.adminUnlocked = true;
      setMessage(`Overseer access granted to ${OVERSEER_NAME}.`);
      render();
    } catch (error) { setMessage(String(error.message || "Overseer login failed.").replaceAll("_", " ")); }
  }

  async function updateAttendance(id, present) {
    state.players = state.players.map((player) => player.id === id ? { ...player, present } : player);
    commit();
    try { await saveGame({ players: state.players }); } catch { setMessage("Could not save attendance to Firebase."); }
  }

  async function markAllPresent() {
    state.players = state.players.map((player) => ({ ...player, present: true }));
    commit();
    try { await saveGame({ players: state.players }); } catch { setMessage("Could not save attendance to Firebase."); }
  }

  async function lockAttendance() {
    const present = presentPlayers();
    if (present.length < G.MINIMUM_PLAYERS) return setMessage(`Confirm at least ${G.MINIMUM_PLAYERS} attendees first.`);
    if (!G.allocateShadows(present)) return setMessage("These table sizes cannot hold 10 Shadows while keeping a Council majority.");
    state.attendanceLocked = true;
    setMessage(`Attendance locked at ${present.length}. Every attendee enters the same fair draw.`);
    commit();
    try { await saveGame({ attendanceLocked: true }); } catch { setMessage("Firebase did not save the attendance lock."); }
  }

  async function assignRoles() {
    if (!confirm("Assign all roles, missions and Shadow teammates now?")) return;
    const players = G.assignAllRoles(state.players);
    if (!players) return setMessage("Role assignment could not preserve a Council majority at every table.");
    Object.assign(state, { players, rolesAssigned: true, phase: "KULIAH", round: 1, winner: null, phaseEndsAt: null, lastResult: "Roles assigned. KULIAH Round 1 has begun.", votes: {}, nightActions: {}, missionClaims: {} });
    setMessage(`Roles assigned: 10 Shadows and ${presentPlayers().length - G.SHADOW_COUNT} Council members.`);
    commit();
    try { await saveGame({ players, rolesAssigned: true, phase: "KULIAH", round: 1, winner: null, phaseEndsAt: null, lastResult: state.lastResult, votes: {}, nightActions: {}, missionClaims: {} }); } catch { setMessage("Firebase did not save the role assignment."); }
  }

  async function startPhase(phase) {
    if (state.winner) return;
    const phaseEndsAt = phase === "KUDETA" ? Date.now() + 180000 : phase === "KONSENSUS" ? Date.now() + 300000 : null;
    if (phase === "KONSENSUS") state.players = state.players.map((player) => player.mission && player.mission.clue ? { ...player, clueUnlocked: true } : player);
    state.phase = phase;
    state.phaseEndsAt = phaseEndsAt;
    state.voteTarget = "";
    state.shadowTarget = "";
    state.powerTarget = "";
    if (phase === "KUDETA") state.nightActions = {};
    if (phase === "KONSENSUS") state.votes = {};
    setMessage(`${phase} is now active${phaseEndsAt ? " with a live timer" : ""}.`);
    commit();
    try { await saveGame({ players: state.players, phase, phaseEndsAt, votes: state.votes, nightActions: state.nightActions }); } catch { setMessage("Firebase did not save the phase change."); }
  }

  async function completeMission() {
    const player = selectedPlayer();
    if (!player || state.phase !== "KULIAH" || player.status !== "ACTIVE") return;
    state.missionClaims[player.id] = true;
    commit();
    try { if (firebaseConfigured) await dbPut(`games/current/missionClaims/${player.id}`, true); setMessage("Mission completion recorded."); }
    catch { setMessage("Mission was not saved. Try again."); }
  }

  async function submitVote() {
    const player = selectedPlayer();
    if (!player || !state.voteTarget || state.phase !== "KONSENSUS" || player.status !== "ACTIVE") return setMessage("Choose a vote target first.");
    state.votes[player.id] = state.voteTarget;
    commit();
    try { if (firebaseConfigured) await dbPut(`games/current/votes/${player.id}`, state.voteTarget); setMessage("Your KONSENSUS vote is sealed."); }
    catch { setMessage("Vote was not saved. Try again."); }
  }

  async function submitNight() {
    const player = selectedPlayer();
    if (!player || state.phase !== "KUDETA" || player.status !== "ACTIVE") return;
    const action = {};
    if (player.faction === "SHADOW") {
      if (!state.shadowTarget) return setMessage("Choose a KUDETA target first.");
      action.shadowTarget = state.shadowTarget;
    }
    if (!player.powerUsed && player.role === "PENYEKAT BAYANGAN" && state.powerTarget) { action.powerType = "BLOCK"; action.powerTarget = state.powerTarget; }
    if (!player.powerUsed && player.role === "PENYIASAT MAJLIS") { if (!state.powerTarget) return setMessage("Choose someone to investigate."); action.powerType = "INVESTIGATE"; action.powerTarget = state.powerTarget; }
    if (!player.powerUsed && player.role === "PENGAWAL MAJLIS") { if (!state.powerTarget) return setMessage("Choose someone to protect."); action.powerType = "PROTECT"; action.powerTarget = state.powerTarget; }
    if (!player.powerUsed && player.role === "PEMULIH MAJLIS") { if (!state.powerTarget) return setMessage("Choose someone to restore."); action.powerType = "RESTORE"; action.powerTarget = state.powerTarget; }
    if (!Object.keys(action).length) return setMessage("Your role has no available KUDETA action.");
    state.nightActions[player.id] = action;
    commit();
    try { if (firebaseConfigured) await dbPut(`games/current/nightActions/${player.id}`, action); setMessage("Your KUDETA action is sealed."); }
    catch { setMessage("Action was not saved. Try again."); }
  }

  async function resolveKudeta() {
    const outcome = G.resolveNight(state.players, state.nightActions);
    const phase = outcome.winner ? "KUDETA" : "KONSENSUS";
    const phaseEndsAt = outcome.winner ? null : Date.now() + 300000;
    const players = outcome.winner ? outcome.players : outcome.players.map((player) => player.mission && player.mission.clue ? { ...player, clueUnlocked: true } : player);
    Object.assign(state, { players, winner: outcome.winner, lastResult: outcome.result, phase, phaseEndsAt, nightActions: {}, votes: {} });
    commit();
    try { await saveGame({ players, winner: outcome.winner, lastResult: outcome.result, phase, phaseEndsAt, nightActions: {}, votes: {} }); } catch { setMessage("Firebase did not save the KUDETA result."); }
  }

  async function resolveVote() {
    const outcome = G.resolveConsensus(state.players, state.votes);
    const round = outcome.winner ? state.round : state.round + 1;
    const phase = outcome.winner ? "KONSENSUS" : "KULIAH";
    Object.assign(state, { players: outcome.players, winner: outcome.winner, lastResult: outcome.result, round, phase, phaseEndsAt: null, votes: {} });
    commit();
    try { await saveGame({ players: outcome.players, winner: outcome.winner, lastResult: outcome.result, round, phase, phaseEndsAt: null, votes: {} }); } catch { setMessage("Firebase did not save the KONSENSUS result."); }
  }

  function loadDemo() {
    state.players = G.TABLES.flatMap((table) => Array.from({ length: 7 }, (_, index) => ({ id: makeId(), name: `Participant ${String((table - 1) * 7 + index + 1).padStart(2, "0")}`, table, present: false, revealed: false, status: "ACTIVE" })));
    Object.assign(state, { attendanceLocked: false, rolesAssigned: false, phase: "REGISTRATION", round: 1, winner: null, phaseEndsAt: null, lastResult: EMPTY_RESULT, votes: {}, nightActions: {}, missionClaims: {}, selectedPlayerId: state.players[0].id });
    setMessage("35 demo participants loaded.");
    commit();
  }

  async function permanentReset() {
    Object.assign(state, { players: [], publicRoster: [], attendanceLocked: false, rolesAssigned: false, phase: "REGISTRATION", round: 1, winner: null, phaseEndsAt: null, lastResult: EMPTY_RESULT, votes: {}, nightActions: {}, missionClaims: {}, selectedPlayerId: "", revealedIds: new Set(), voteTarget: "", shadowTarget: "", powerTarget: "" });
    setMessage("The entire game has been reset. Registration is open again.");
    commit();
    try { await saveGame({ players: [], attendanceLocked: false, rolesAssigned: false, phase: "REGISTRATION", round: 1, winner: null, phaseEndsAt: null, lastResult: EMPTY_RESULT, votes: {}, nightActions: {}, missionClaims: {} }); }
    catch { setMessage("The local game reset, but Firebase did not update."); }
  }

  document.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) { state.currentTab = tab.dataset.tab; render(); return; }
    const phase = event.target.closest("[data-phase]");
    if (phase) { await startPhase(phase.dataset.phase); return; }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "reveal-role") { const player = selectedPlayer(); if (player) state.revealedIds.add(player.id); render(); }
    if (action === "complete-mission") await completeMission();
    if (action === "submit-vote") await submitVote();
    if (action === "submit-night") await submitNight();
    if (action === "mark-all") await markAllPresent();
    if (action === "lock-attendance") await lockAttendance();
    if (action === "assign-roles") await assignRoles();
    if (action === "resolve-night") await resolveKudeta();
    if (action === "resolve-vote") await resolveVote();
    if (action === "load-demo") loadDemo();
    if (action === "open-reset") resetOne.showModal();
  });

  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.target.id === "registration-form") await registerParticipant(event.target);
    if (event.target.id === "admin-login-form") await loginAdmin(event.target);
  });

  document.addEventListener("change", async (event) => {
    if (event.target.dataset.attendance) await updateAttendance(event.target.dataset.attendance, event.target.checked);
    if (event.target.dataset.targetSelect === "player-switch") { state.selectedPlayerId = event.target.value; state.voteTarget = ""; state.shadowTarget = ""; state.powerTarget = ""; render(); }
    if (event.target.dataset.targetSelect === "vote-target") state.voteTarget = event.target.value;
    if (event.target.dataset.targetSelect === "shadow-target") state.shadowTarget = event.target.value;
    if (event.target.dataset.targetSelect === "power-target") state.powerTarget = event.target.value;
  });

  document.getElementById("continue-reset").addEventListener("click", () => setTimeout(() => resetTwo.showModal(), 50));
  document.getElementById("permanent-reset").addEventListener("click", () => permanentReset());

  async function initialize() {
    if (!firebaseConfigured) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved) Object.assign(state, saved);
      } catch { localStorage.removeItem(STORAGE_KEY); }
      refreshLocalRoster();
      render();
      return;
    }
    try {
      let session = readSession();
      if (!session || isOverseerSession(session)) { localStorage.removeItem(SESSION_KEY); session = await signInAnonymous(); }
      state.session = session;
      await syncLive();
    } catch (error) {
      state.liveConnected = false;
      setMessage(error.message || "Could not connect to Firebase.");
      render();
    }
  }

  setInterval(() => renderHeader(), 1000);
  setInterval(() => { if (firebaseConfigured && state.session) syncLive().catch(() => { state.liveConnected = false; renderHeader(); }); }, 3000);
  initialize();
})();
