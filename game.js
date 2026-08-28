(function () {
  "use strict";

  const TARGET_COUNT = 35;
  const SHADOW_COUNT = 10;
  const MINIMUM_PLAYERS = 21;
  const TABLES = [1, 2, 3, 4, 5];

  const roleCopy = {
    "MAJLIS BAYANGAN": { faction: "Majlis Bayangan", brief: "Blend in, complete your hidden operation and protect the Shadow Council.", power: "During KUDETA, secretly vote to silence one active Council member." },
    "PENYEKAT BAYANGAN": { faction: "Majlis Bayangan", brief: "You are the Shadow Council's specialist disruptor.", power: "Vote with the Shadows and, once per game, block one special power during KUDETA." },
    "AHLI MAJLIS": { faction: "Council", brief: "Observe every interaction and expose the infiltrators during KONSENSUS.", power: "Discuss openly and vote privately. Your judgement is your power." },
    "PENYIASAT MAJLIS": { faction: "Council", brief: "Gather intelligence without revealing your identity too early.", power: "Once per game, investigate whether one active participant belongs to Majlis Bayangan." },
    "PENGAWAL MAJLIS": { faction: "Council", brief: "Protect the Council while remaining hidden among its members.", power: "Once per game, protect one active participant from the KUDETA attack." },
    "PEMULIH MAJLIS": { faction: "Council", brief: "Return one silenced voice to the Council—but choose carefully.", power: "Once per game, restore one silenced participant during KUDETA." }
  };

  const shadowMissions = [
    { id: "shadow-photo-1", category: "Photography", instruction: "Initiate three group photos at three different tables and appear in every photo." },
    { id: "shadow-photo-2", category: "Photography", instruction: "Get two different groups to use the same hand gesture in a photo." },
    { id: "shadow-intel-1", category: "Intelligence", instruction: "Ask four people from different tables who they currently suspect." },
    { id: "shadow-intel-2", category: "Intelligence", instruction: "Convince three people to agree that KUDETA is the most dangerous phase." },
    { id: "shadow-message-1", category: "Messages", instruction: "Get three people to say “KONSENSUS” without saying the word first." },
    { id: "shadow-message-2", category: "Messages", instruction: "Recruit two messengers to deliver “The Council is watching” to two tables." },
    { id: "shadow-move-1", category: "Movement", instruction: "Convince two people from different tables to temporarily exchange seats." },
    { id: "shadow-move-2", category: "Movement", instruction: "Get three people to visit another table at your request, one at a time." },
    { id: "shadow-token-1", category: "Council Mark", instruction: "Collect four signatures from four tables on one slip of paper." },
    { id: "shadow-token-2", category: "Council Mark", instruction: "Start a harmless token chain through three people and have it returned to you." }
  ];

  const councilMissions = [
    { id: "c-photo-1", category: "Photography", instruction: "Join one group photo if invited.", clue: "Watch for someone repeatedly initiating photos across several tables." },
    { id: "c-photo-2", category: "Photography", instruction: "Ask one tablemate what pose would represent the Council.", clue: "A repeated hand gesture in unrelated photos may be coordinated." },
    { id: "c-photo-3", category: "Photography", instruction: "Compliment one group photo and ask who organized it.", clue: "The organizer—not the photographer—may matter." },
    { id: "c-photo-4", category: "Photography", instruction: "Take one normal table photo if everyone agrees.", clue: "One operation requires appearing in photographs at multiple tables." },
    { id: "c-photo-5", category: "Photography", instruction: "Suggest one harmless group pose to your own table.", clue: "Look for the same pose spreading between different groups." },
    { id: "c-intel-1", category: "Intelligence", instruction: "Ask one person what makes a player trustworthy.", clue: "Someone may be collecting suspicion from several tables." },
    { id: "c-intel-2", category: "Intelligence", instruction: "Share one observation without naming a suspect.", clue: "Repeated questions about suspects can be a hidden assignment." },
    { id: "c-intel-3", category: "Intelligence", instruction: "Ask a tablemate which phase sounds most exciting.", clue: "Listen for someone pushing people to agree KUDETA is most dangerous." },
    { id: "c-intel-4", category: "Intelligence", instruction: "Compare the three phase names with one person.", clue: "Agreement gathered from three people may be deliberate." },
    { id: "c-intel-5", category: "Intelligence", instruction: "Learn the name of one participant from another table.", clue: "One infiltrator needs information from four different tables." },
    { id: "c-message-1", category: "Messages", instruction: "Ask one participant what phase follows KUDETA.", clue: "Someone may be trying to make others say KONSENSUS first." },
    { id: "c-message-2", category: "Messages", instruction: "Repeat the three phase names once with your table.", clue: "Notice questions designed to trigger one exact word." },
    { id: "c-message-3", category: "Messages", instruction: "Deliver a friendly greeting to another table if asked.", clue: "A phrase may be travelling through recruited messengers." },
    { id: "c-message-4", category: "Messages", instruction: "Ask who has heard the phrase “The Council is watching.”", clue: "Two messengers may be carrying the same sentence." },
    { id: "c-message-5", category: "Messages", instruction: "Tell one person to enjoy the Council dinner.", clue: "Focus on who recruited the messenger, not who delivered the phrase." },
    { id: "c-move-1", category: "Movement", instruction: "Visit another table once for a short greeting.", clue: "Someone may be directing several individual table visits." },
    { id: "c-move-2", category: "Movement", instruction: "Ask one person why they chose their seat.", clue: "A temporary seat exchange may be a hidden objective." },
    { id: "c-move-3", category: "Movement", instruction: "Stand and stretch once during KULIAH.", clue: "Watch for movement requested by another participant." },
    { id: "c-move-4", category: "Movement", instruction: "Greet a participant who visits your table.", clue: "Three separate visits directed by one person may be connected." },
    { id: "c-move-5", category: "Movement", instruction: "Ask whether anyone has changed seats temporarily.", clue: "Two people from different tables may have been persuaded to swap." },
    { id: "c-token-1", category: "Council Mark", instruction: "Sign one harmless dinner keepsake if invited.", clue: "Someone may be collecting signatures across four tables." },
    { id: "c-token-2", category: "Council Mark", instruction: "Ask one person what a Council signature should look like.", clue: "One slip containing several table signatures may be evidence." },
    { id: "c-token-3", category: "Council Mark", instruction: "Pass a harmless token once if somebody requests it.", clue: "A token may be travelling through a three-person chain." },
    { id: "c-token-4", category: "Council Mark", instruction: "Notice who begins and ends any passing game.", clue: "The person who receives a returned token may have started the operation." },
    { id: "c-token-5", category: "Council Mark", instruction: "Draw a small diamond on your own note.", clue: "Track repeated collection behavior, not ordinary signatures by themselves." }
  ];

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const data = new Uint32Array(1);
      crypto.getRandomValues(data);
      const j = data[0] % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function allocateShadows(players) {
    const groups = TABLES.map((table) => ({ table, members: players.filter((player) => player.table === table), shadows: 0 })).filter((group) => group.members.length > 0);
    for (let index = 0; index < SHADOW_COUNT; index += 1) {
      const eligible = groups.filter((group) => group.shadows < Math.floor((group.members.length - 1) / 2)).sort((a, b) => a.shadows / a.members.length - b.shadows / b.members.length || b.members.length - a.members.length || a.table - b.table);
      if (!eligible[0]) return null;
      eligible[0].shadows += 1;
    }
    return groups;
  }

  function assignAllRoles(players) {
    const present = players.filter((player) => player.present);
    const allocations = allocateShadows(present);
    if (!allocations) return null;
    const shadowIds = new Set();
    allocations.forEach((group) => shuffle(group.members).slice(0, group.shadows).forEach((player) => shadowIds.add(player.id)));
    const blockerId = shuffle([...shadowIds])[0];
    const council = shuffle(present.filter((player) => !shadowIds.has(player.id)));
    const investigators = new Set(council.slice(0, 3).map((player) => player.id));
    const guards = new Set(council.slice(3, 6).map((player) => player.id));
    const restorerId = council[6] && council[6].id;
    const shadowAssignments = shuffle(shadowMissions);
    const councilAssignments = shuffle(councilMissions);
    let si = 0;
    let ci = 0;
    const assigned = players.map((player) => {
      if (!player.present) return { ...player, role: null, faction: null, mission: null, status: "ACTIVE", powerUsed: false, privateNotice: "" };
      let role = "AHLI MAJLIS";
      let faction = "COUNCIL";
      if (shadowIds.has(player.id)) { role = player.id === blockerId ? "PENYEKAT BAYANGAN" : "MAJLIS BAYANGAN"; faction = "SHADOW"; }
      else if (investigators.has(player.id)) role = "PENYIASAT MAJLIS";
      else if (guards.has(player.id)) role = "PENGAWAL MAJLIS";
      else if (player.id === restorerId) role = "PEMULIH MAJLIS";
      const mission = faction === "SHADOW" ? shadowAssignments[si++ % shadowAssignments.length] : councilAssignments[ci++ % councilAssignments.length];
      return { ...player, role, faction, mission, clueUnlocked: false, shadowTeam: null, status: "ACTIVE", powerUsed: false, privateNotice: "", revealed: false };
    });
    const team = assigned.filter((player) => player.faction === "SHADOW").map((player) => ({ id: player.id, name: player.name }));
    return assigned.map((player) => player.faction === "SHADOW" ? { ...player, shadowTeam: team.filter((member) => member.id !== player.id) } : player);
  }

  function evaluateWinner(players) {
    const active = players.filter((player) => player.present && player.status === "ACTIVE");
    const shadows = active.filter((player) => player.faction === "SHADOW").length;
    const council = active.filter((player) => player.faction === "COUNCIL").length;
    if (shadows === 0) return "COUNCIL";
    if (shadows >= council) return "SHADOW";
    return null;
  }

  function plurality(values) {
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ordered[0] || (ordered[1] && ordered[0][1] === ordered[1][1])) return null;
    return ordered[0][0];
  }

  function resolveNight(players, actions) {
    let next = players.map((player) => ({ ...player }));
    const activeById = new Map(next.filter((player) => player.present && player.status === "ACTIVE").map((player) => [player.id, player]));
    const blocker = next.find((player) => player.status === "ACTIVE" && player.role === "PENYEKAT BAYANGAN" && !player.powerUsed && actions[player.id] && actions[player.id].powerType === "BLOCK");
    const blockedId = blocker && actions[blocker.id].powerTarget && activeById.has(actions[blocker.id].powerTarget) ? actions[blocker.id].powerTarget : null;
    if (blocker && blockedId) next = next.map((player) => player.id === blocker.id ? { ...player, powerUsed: true } : player);
    const protectedIds = new Set();

    next.forEach((player) => {
      const action = actions[player.id];
      if (player.status !== "ACTIVE" || player.powerUsed || player.id === blockedId || !action || !action.powerTarget) return;
      const target = next.find((candidate) => candidate.id === action.powerTarget);
      if (player.role === "PENGAWAL MAJLIS" && action.powerType === "PROTECT" && target && target.status === "ACTIVE") { protectedIds.add(target.id); player.powerUsed = true; }
      if (player.role === "PENYIASAT MAJLIS" && action.powerType === "INVESTIGATE" && target && target.status === "ACTIVE") { player.privateNotice = `${target.name} is ${target.faction === "SHADOW" ? "MAJLIS BAYANGAN" : "NOT Majlis Bayangan"}.`; player.powerUsed = true; }
      if (player.role === "PEMULIH MAJLIS" && action.powerType === "RESTORE" && target && target.status === "SILENCED") { next = next.map((candidate) => candidate.id === target.id ? { ...candidate, status: "ACTIVE" } : candidate); player.powerUsed = true; }
    });

    const shadowIds = new Set(next.filter((player) => player.status === "ACTIVE" && player.faction === "SHADOW").map((player) => player.id));
    const councilIds = new Set(next.filter((player) => player.status === "ACTIVE" && player.faction === "COUNCIL").map((player) => player.id));
    const shadowVotes = Object.entries(actions).filter(([id, action]) => shadowIds.has(id) && action.shadowTarget && councilIds.has(action.shadowTarget)).map(([, action]) => action.shadowTarget);
    const targetId = plurality(shadowVotes);
    let result = "KUDETA ended with no successful silence.";
    if (targetId) {
      const target = next.find((player) => player.id === targetId);
      if (protectedIds.has(targetId)) result = "The KUDETA target was protected. No one was silenced.";
      else if (target) { next = next.map((player) => player.id === targetId ? { ...player, status: "SILENCED" } : player); result = `${target.name} was silenced during KUDETA.`; }
    }
    if (blockedId) {
      const blocked = next.find((player) => player.id === blockedId);
      if (blocked) result += ` One special action belonging to ${blocked.name} was blocked.`;
    }
    return { players: next, result, winner: evaluateWinner(next) };
  }

  function resolveConsensus(players, votes) {
    const activeIds = new Set(players.filter((player) => player.present && player.status === "ACTIVE").map((player) => player.id));
    const validVotes = Object.entries(votes).filter(([voter, target]) => activeIds.has(voter) && activeIds.has(target) && voter !== target).map(([, target]) => target);
    const targetId = plurality(validVotes);
    if (!targetId) return { players, result: "KONSENSUS ended in a tie. No one was silenced.", winner: evaluateWinner(players) };
    const target = players.find((player) => player.id === targetId);
    if (!target) return { players, result: "KONSENSUS ended without a valid target.", winner: evaluateWinner(players) };
    const next = players.map((player) => player.id === targetId ? { ...player, status: "SILENCED" } : player);
    return { players: next, result: `${target.name} was silenced by KONSENSUS.`, winner: evaluateWinner(next) };
  }

  function makePublicState(players, state) {
    const present = players.filter((player) => player.present);
    const active = present.filter((player) => player.status === "ACTIVE");
    return {
      ...state,
      targetCount: TARGET_COUNT,
      presentCount: present.length,
      shadowCount: active.filter((player) => player.faction === "SHADOW").length,
      councilCount: active.filter((player) => player.faction === "COUNCIL").length,
      roster: present.map(({ id, name, table, status, present: isPresent }) => ({ id, name, table, status, present: isPresent }))
    };
  }

  window.MBGame = { TARGET_COUNT, SHADOW_COUNT, MINIMUM_PLAYERS, TABLES, roleCopy, allocateShadows, assignAllRoles, evaluateWinner, resolveNight, resolveConsensus, makePublicState };
})();

