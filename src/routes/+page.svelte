<script>
  import { onMount, onDestroy } from "svelte";
  import { io } from "socket.io-client";
  import {
    collection,
    limit,
    onSnapshot,
    orderBy,
    query,
  } from "firebase/firestore";
  import { getIdToken } from "firebase/auth";
  import {
    applyMove,
    cloneState,
    createState,
    deserializeState,
    getLegalBoards,
    serializeState,
    replayStateFromMoves,
    validateMove,
  } from "$lib/game.js";
  import { chooseBotMove } from "$lib/ai.js";
  import { db } from "$lib/firebase.js";
  import {
    signInEmail,
    signInGoogle,
    signOutUser,
    signUpEmail,
    subscribeAuth,
  } from "$lib/auth.js";
  import { getRankFromRating } from "$lib/ranking.js";

  const BOT_NAME = "Atlas";
  const STORAGE_KEY = "uttt-settings-v1";
  const HISTORY_KEY = "uttt-history-v1";
  const SCORE_KEY = "uttt-scoreboard-v1";
  const TOKEN_KEY = "uttt-token-v1";
  const SAVED_GAME_KEY = "uttt-saved-game-v1";
  const MODE_KEY = "uttt-mode-v1";
  const LAST_LOCAL_MODE_KEY = "uttt-last-local-mode-v1";

  let mode = $state("local");
  let screen = $state("menu");
  let menuOpen = $state(true);
  let menuPanel = $state("main");
  let theme = $state("dark");
  let soundEnabled = $state(true);
  let botDifficulty = $state("medium");
  let turnTimeMs = $state(25000);
  let playerNames = $state({ X: "Player 1", O: "Player 2" });
  let myName = $state("Player");
  // svelte-ignore state_referenced_locally
  let localState = $state(createState({ players: playerNames, turnTimeMs }));
  let multiplayerPlaceholder = $state(
    createState({ players: playerNames, turnTimeMs }),
  );
  let onlineRoom = $state(null);
  let mySymbol = $state("X");
  let spectator = $state(false);
  let queueStatus = $state({ queued: false, position: 0, tier: "" });
  let pendingDrawFrom = $state(null);
  let rematchVotes = $state([]);
  let connectionStatus = $state("offline");
  let reconnectToken = $state("");
  let toastList = $state([]);
  let matchHistory = $state([]);
  let scoreboard = $state({ X: 0, O: 0, draws: 0 });
  let now = $state(Date.now());
  let past = $state([]);
  let future = $state([]);
  let replay = $state({ open: false, match: null, index: 0, playing: false });
  let exportText = $state("");
  let socialCode = $state("");
  let hoverCell = $state(null);
  let kbdIndex = $state(40);
  let sidebarOpen = $state(false);
  let confirmSwitch = $state({ open: false, nextMode: null });
  let rulesOpen = $state(false);
  let authModal = $state({ open: false, mode: "signin" });
  let authForm = $state({ email: "", password: "", displayName: "" });
  let authUser = $state(null);
  let profile = $state(null);
  let leaderboard = $state([]);
  let pendingCompetitiveStart = $state(false);
  let lastMode = $state("local");
  let lastLocalMode = $state("local");
  let hydrated = $state(false);
  let botThinking = false;
  let socket = null;
  let replayTimer = null;
  let lastWinner = $state(null);
  let winModal = $state({ open: false, winner: null });

  const WIN_LINE_MAP = {
    "0,1,2": "row-0",
    "3,4,5": "row-1",
    "6,7,8": "row-2",
    "0,3,6": "col-0",
    "1,4,7": "col-1",
    "2,5,8": "col-2",
    "0,4,8": "diag-1",
    "2,4,6": "diag-2",
  };

  let effectiveNames = $derived.by(() =>
    mode === "bot" ? { ...playerNames, O: BOT_NAME } : { ...playerNames },
  );
  let displayNames = $derived.by(() => {
    if (
      (mode === "social" || mode === "competitive") &&
      currentState?.players
    ) {
      return currentState.players;
    }
    return effectiveNames;
  });
  let currentState = $derived.by(() => {
    if (mode === "social" || mode === "competitive") {
      return onlineRoom?.state ?? multiplayerPlaceholder;
    }
    return localState;
  });
  let legalBoards = $derived.by(() => getLegalBoards(currentState));
  let timeLeft = $derived.by(() =>
    Math.max(0, Math.ceil((currentState.turnEndsAt - now) / 1000)),
  );
  let kbdFocus = $derived.by(() => {
    const row = Math.floor(kbdIndex / 9);
    const col = kbdIndex % 9;
    const board = Math.floor(row / 3) * 3 + Math.floor(col / 3);
    const cell = (row % 3) * 3 + (col % 3);
    return { board, cell };
  });
  let statusLine = $derived.by(() => {
    if (currentState.winner === "D") return "Draw";
    if (currentState.winner) {
      return `${currentState.players?.[currentState.winner] ?? "Player"} wins`;
    }
    return `${currentState.players?.[currentState.currentPlayer] ?? "Player"}'s turn`;
  });
  let forcedLabel = $derived.by(() => {
    if (currentState.forcedBoard === null) return "Any board";
    return `Board ${currentState.forcedBoard + 1}`;
  });
  let replayState = $derived.by(() => {
    if (!replay.open || !replay.match) return null;
    const base = createState({
      players: replay.match.players ?? { X: "X", O: "O" },
      turnTimeMs: replay.match.turnTimeMs ?? turnTimeMs,
    });
    return replayStateFromMoves(
      replay.match.moves.slice(0, replay.index),
      base,
    );
  });
  let timerPct = $derived.by(() => {
    const total = currentState.turnTimeMs / 1000;
    return total > 0 ? (timeLeft / total) * 100 : 0;
  });
  let hasUnfinishedMatch = $derived.by(() => {
    const localUnfinished = localState?.moves?.length > 0 && !localState.winner;
    const onlineUnfinished =
      onlineRoom?.state?.moves?.length > 0 && !onlineRoom.state.winner;
    return !!(localUnfinished || onlineUnfinished);
  });
  let currentRank = $derived.by(() =>
    profile
      ? getRankFromRating(profile.rating ?? 1000)
      : getRankFromRating(1000),
  );

  function notify(message, tone = "info") {
    const id = `${Date.now()}-${Math.random()}`;
    toastList = [...toastList, { id, message, tone }];
    setTimeout(() => {
      toastList = toastList.filter((toast) => toast.id !== id);
    }, 3200);
  }

  function playSound(type) {
    if (!soundEnabled || typeof window === "undefined") return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = type === "win" ? 660 : type === "error" ? 160 : 320;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  }

  function saveSettings() {
    if (typeof localStorage === "undefined") return;
    const data = {
      theme,
      soundEnabled,
      botDifficulty,
      turnTimeMs,
      playerNames,
      myName,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadSettings() {
    if (typeof localStorage === "undefined") return;
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      theme = parsed.theme ?? theme;
      soundEnabled = parsed.soundEnabled ?? soundEnabled;
      botDifficulty = parsed.botDifficulty ?? botDifficulty;
      turnTimeMs = parsed.turnTimeMs ?? turnTimeMs;
      playerNames = parsed.playerNames ?? playerNames;
      myName = parsed.myName ?? myName;
    } catch {
      /* ignore */
    }
  }

  function persistHistory() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(matchHistory));
  }

  function loadHistory() {
    if (typeof localStorage === "undefined") return;
    const data = localStorage.getItem(HISTORY_KEY);
    if (!data) return;
    try {
      matchHistory = JSON.parse(data);
    } catch {
      matchHistory = [];
    }
  }

  function persistScoreboard() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SCORE_KEY, JSON.stringify(scoreboard));
  }

  function loadScoreboard() {
    if (typeof localStorage === "undefined") return;
    const data = localStorage.getItem(SCORE_KEY);
    if (!data) return;
    try {
      scoreboard = JSON.parse(data);
    } catch {
      /* ignore */
    }
  }

  function saveLocalGame() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      SAVED_GAME_KEY,
      serializeState(cloneState(localState)),
    );
  }

  function loadLocalGame() {
    if (typeof localStorage === "undefined") return;
    const data = localStorage.getItem(SAVED_GAME_KEY);
    if (!data) return;
    try {
      const parsed = deserializeState(data);
      localState = parsed;
    } catch {
      /* ignore */
    }
  }

  function resetLocalGame({ keepHistory = false } = {}) {
    localState = createState({ players: effectiveNames, turnTimeMs });
    if (!keepHistory) {
      past = [];
      future = [];
    }
    replay.playing = false;
    replay.index = 0;
    saveLocalGame();
  }

  function updatePlayerNames() {
    localState.players = { ...effectiveNames };
    localState.turnTimeMs = turnTimeMs;
    localState.updatedAt = Date.now();
    multiplayerPlaceholder.players = { ...playerNames };
    multiplayerPlaceholder.turnTimeMs = turnTimeMs;
    multiplayerPlaceholder.updatedAt = Date.now();
  }

  function getWinLineClass(winLine) {
    if (!winLine) return "";
    return WIN_LINE_MAP[winLine.join(",")] ?? "";
  }

  function closeWinModal() {
    winModal = { ...winModal, open: false };
  }

  function setMode(nextMode) {
    mode = nextMode;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_KEY, nextMode);
    }
    if (nextMode === "social" || nextMode === "competitive") {
      multiplayerPlaceholder.mode = nextMode;
    }
    if (nextMode === "local" || nextMode === "bot") {
      lastLocalMode = nextMode;
      if (typeof localStorage !== "undefined")
        localStorage.setItem(LAST_LOCAL_MODE_KEY, nextMode);
    }
  }

  function openMenu() {
    menuOpen = true;
    screen = "menu";
    menuPanel = "main";
    sidebarOpen = false;
  }

  function resumeGame() {
    if (onlineRoom?.state?.mode) {
      setMode(onlineRoom.state.mode);
    } else if (localState?.moves?.length > 0) {
      setMode(lastLocalMode);
    }
    menuOpen = false;
    screen = "game";
  }

  function requestModeSwitch(nextMode) {
    if (hasUnfinishedMatch && nextMode !== mode) {
      confirmSwitch = { open: true, nextMode };
      return;
    }
    startMode(nextMode);
  }

  function confirmModeSwitch() {
    if (!confirmSwitch.nextMode) {
      confirmSwitch = { open: false, nextMode: null };
      return;
    }
    startMode(confirmSwitch.nextMode);
    confirmSwitch = { open: false, nextMode: null };
  }

  function startMode(nextMode) {
    if (mode === "competitive") leaveCompetitiveQueue();
    if (mode === "social" || mode === "competitive") onlineRoom = null;
    if (nextMode !== "competitive")
      queueStatus = { queued: false, position: 0, tier: "" };
    setMode(nextMode);
    menuOpen = false;
    screen = "game";
    pendingDrawFrom = null;
    rematchVotes = [];
    spectator = false;
    if (nextMode === "local" || nextMode === "bot") {
      onlineRoom = null;
      resetLocalGame();
      return;
    }
    if (nextMode === "social") {
      onlineRoom = null;
      socialCode = "";
      sidebarOpen = true;
      return;
    }
    if (nextMode === "competitive") {
      if (!authUser) {
        authModal = { ...authModal, open: true };
        pendingCompetitiveStart = true;
        menuOpen = true;
        screen = "menu";
        return;
      }
      joinCompetitiveQueue();
      sidebarOpen = true;
    }
  }

  function openRules() {
    rulesOpen = true;
    screen = "rules";
  }

  function closeRules() {
    rulesOpen = false;
    screen = menuOpen ? "menu" : "game";
  }

  async function handleEmailSignIn() {
    try {
      await signInEmail(authForm.email, authForm.password);
      closeAuthModal();
      authForm = { ...authForm, password: "" };
    } catch {
      notify("Sign-in failed", "error");
    }
  }

  async function handleEmailSignUp() {
    try {
      await signUpEmail(
        authForm.email,
        authForm.password,
        authForm.displayName,
      );
      closeAuthModal();
      authForm = { ...authForm, password: "" };
    } catch {
      notify("Sign-up failed", "error");
    }
  }

  async function handleGoogleSignIn() {
    try {
      await signInGoogle();
      closeAuthModal();
    } catch {
      notify("Google sign-in failed", "error");
    }
  }

  function closeAuthModal() {
    authModal = { ...authModal, open: false };
    pendingCompetitiveStart = false;
  }

  async function handleSignOut() {
    await signOutUser();
    profile = null;
    authUser = null;
  }

  function recordMatch(state, reason = "ended") {
    const entry = {
      id: state.id,
      mode: state.mode ?? mode,
      winner: state.winner ?? "D",
      reason,
      players: { ...state.players },
      moves: state.moves,
      createdAt: state.createdAt,
      endedAt: Date.now(),
      turnTimeMs: state.turnTimeMs,
    };
    matchHistory = [entry, ...matchHistory].slice(0, 30);
    persistHistory();
  }

  function updateLocalScore(winner) {
    if (winner === "D" || !winner) {
      scoreboard = { ...scoreboard, draws: scoreboard.draws + 1 };
    } else if (winner === "X") {
      scoreboard = { ...scoreboard, X: scoreboard.X + 1 };
    } else {
      scoreboard = { ...scoreboard, O: scoreboard.O + 1 };
    }
    persistScoreboard();
  }

  function applyLocalMove(board, cell) {
    const error = validateMove(
      localState,
      { board, cell },
      localState.currentPlayer,
    );
    if (error) {
      notify(error, "error");
      playSound("error");
      return;
    }
    past = [...past, cloneState(localState)];
    future = [];
    const result = applyMove(
      localState,
      { board, cell },
      { player: localState.currentPlayer },
    );
    if (result.ok) {
      playSound("move");
      if (localState.winner) {
        playSound("win");
        recordMatch(localState, localState.status);
        updateLocalScore(localState.winner);
      } else if (mode === "bot" && localState.currentPlayer === "O") {
        queueBotMove();
      }
      saveLocalGame();
    }
  }

  function queueBotMove() {
    if (botThinking) return;
    botThinking = true;
    setTimeout(() => {
      const move = chooseBotMove(cloneState(localState), botDifficulty);
      if (move) applyLocalMove(move.board, move.cell);
      botThinking = false;
    }, 420);
  }

  function handleCellClick(board, cell) {
    if (mode === "social" || mode === "competitive") {
      if (!onlineRoom || spectator) return;
      if (currentState.currentPlayer !== mySymbol) return;
      if (!socket) return;
      socket.emit("makeMove", { roomId: onlineRoom.id, board, cell });
      return;
    }
    applyLocalMove(board, cell);
  }

  async function joinCompetitiveQueue() {
    if (!authUser) {
      authModal = { ...authModal, open: true };
      pendingCompetitiveStart = true;
      return;
    }
    ensureSocket();
    setMode("competitive");
    menuOpen = false;
    screen = "game";
    const idToken = await getIdToken(authUser);
    socket?.emit("joinCompetitiveQueue", { idToken });
  }

  function leaveCompetitiveQueue() {
    socket?.emit("leaveCompetitiveQueue");
  }

  function createSocialRoom() {
    ensureSocket();
    setMode("social");
    menuOpen = false;
    screen = "game";
    socket?.emit("createSocialRoom");
  }

  function joinSocialRoom() {
    if (!socialCode.trim()) return;
    ensureSocket();
    setMode("social");
    menuOpen = false;
    screen = "game";
    socket?.emit("joinSocialRoom", { code: socialCode.trim().toUpperCase() });
  }

  function spectateSocialRoom() {
    if (!socialCode.trim()) return;
    spectator = true;
    ensureSocket();
    setMode("social");
    menuOpen = false;
    screen = "game";
    socket?.emit("spectateSocialRoom", {
      code: socialCode.trim().toUpperCase(),
    });
  }

  function offerDraw() {
    if (!onlineRoom) return;
    socket?.emit("offerDraw", { roomId: onlineRoom.id });
  }

  function respondDraw(accept) {
    if (!onlineRoom) return;
    socket?.emit("respondDraw", { roomId: onlineRoom.id, accept });
    pendingDrawFrom = null;
  }

  function requestRematch() {
    if (!onlineRoom) return;
    socket?.emit("requestRematch", { roomId: onlineRoom.id });
  }

  function copyRoomCode(code) {
    if (!code) return;
    if (navigator?.clipboard) navigator.clipboard.writeText(code);
    notify("Room code copied");
  }

  function exportGameState() {
    exportText = serializeState(cloneState(currentState));
    if (navigator?.clipboard) navigator.clipboard.writeText(exportText);
    notify("Game state copied");
  }

  function importGameState() {
    if (mode === "social" || mode === "competitive") {
      notify("Cannot import into multiplayer match", "error");
      return;
    }
    try {
      const parsed = deserializeState(exportText);
      localState = parsed;
      past = [];
      future = [];
      saveLocalGame();
      notify("Game state loaded");
    } catch {
      notify("Invalid state JSON", "error");
    }
  }

  function undoMove() {
    if (mode !== "local" || past.length === 0) return;
    const prev = past[past.length - 1];
    past = past.slice(0, -1);
    future = [cloneState(localState), ...future];
    localState = prev;
    playSound("move");
    saveLocalGame();
  }

  function redoMove() {
    if (mode !== "local" || future.length === 0) return;
    const next = future[0];
    future = future.slice(1);
    past = [...past, cloneState(localState)];
    localState = next;
    playSound("move");
    saveLocalGame();
  }

  function openReplay(match) {
    if (!match?.moves?.length) {
      notify("Replay unavailable", "error");
      return;
    }
    replay = { open: true, match, index: 0, playing: false };
  }

  function closeReplay() {
    replay = { open: false, match: null, index: 0, playing: false };
  }

  function toggleReplayPlay() {
    if (!replay.match) return;
    replay.playing = !replay.playing;
    if (replay.playing) {
      replayTimer = setInterval(() => {
        replay.index = Math.min(replay.match.moves.length, replay.index + 1);
        if (replay.index >= replay.match.moves.length) {
          replay.playing = false;
          clearInterval(replayTimer);
        }
      }, 650);
    } else {
      clearInterval(replayTimer);
    }
  }

  function handleKeydown(event) {
    if (
      ![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        " ",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    let row = Math.floor(kbdIndex / 9);
    let col = kbdIndex % 9;
    if (event.key === "ArrowUp") row = (row + 8) % 9;
    if (event.key === "ArrowDown") row = (row + 1) % 9;
    if (event.key === "ArrowLeft") col = (col + 8) % 9;
    if (event.key === "ArrowRight") col = (col + 1) % 9;
    if (event.key === "Enter" || event.key === " ") {
      const { board, cell } = kbdFocus;
      handleCellClick(board, cell);
      return;
    }
    kbdIndex = row * 9 + col;
  }

  function isLegalCell(boardIndex, cellIndex) {
    if (currentState.winner) return false;
    if (
      (mode === "social" || mode === "competitive") &&
      currentState.currentPlayer !== mySymbol
    )
      return false;
    const error = validateMove(
      currentState,
      { board: boardIndex, cell: cellIndex },
      currentState.currentPlayer,
    );
    return !error;
  }

  function ensureSocket() {
    if (socket) return;
    socket = io({ path: "/socket.io" });
    connectionStatus = "connecting";
    socket.on("connect", () => {
      connectionStatus = "online";
      socket.emit("hello", { name: myName, token: reconnectToken });
    });
    socket.on("disconnect", () => {
      connectionStatus = "offline";
      queueStatus = { queued: false, position: 0, tier: "" };
    });
    socket.on("helloAck", ({ token }) => {
      reconnectToken = token;
      if (typeof localStorage !== "undefined")
        localStorage.setItem(TOKEN_KEY, token);
    });
    socket.on("queueStatus", (payload) => {
      queueStatus = payload;
    });
    socket.on("socialRoomCreated", ({ room, symbol, code }) => {
      onlineRoom = room;
      mySymbol = symbol;
      spectator = false;
      setMode("social");
      socialCode = code ?? room?.code ?? "";
      pendingDrawFrom = null;
      notify("Room created");
      menuOpen = false;
      screen = "game";
    });
    socket.on("socialRoomJoined", ({ room, symbol }) => {
      onlineRoom = room;
      mySymbol = symbol;
      spectator = false;
      setMode("social");
      pendingDrawFrom = null;
      notify("Joined room");
      menuOpen = false;
      screen = "game";
    });
    socket.on("competitiveMatchFound", ({ room, symbol }) => {
      onlineRoom = room;
      mySymbol = symbol;
      spectator = false;
      setMode("competitive");
      pendingDrawFrom = null;
      notify("Match found");
      menuOpen = false;
      screen = "game";
    });
    socket.on("spectatorJoined", ({ room }) => {
      onlineRoom = room;
      spectator = true;
      notify("Spectating");
      menuOpen = false;
      screen = "game";
    });
    socket.on("reconnected", ({ room, symbol }) => {
      onlineRoom = room;
      mySymbol = symbol;
      if (room?.state?.mode) setMode(room.state.mode);
      notify("Reconnected");
    });
    socket.on("stateUpdate", ({ room, reason }) => {
      const previousWinner = onlineRoom?.state?.winner;
      onlineRoom = room;
      if (room.state.winner && room.state.winner !== previousWinner) {
        recordMatch(room.state, reason);
      }
    });
    socket.on("moveError", ({ message }) => {
      notify(message, "error");
      playSound("error");
    });
    socket.on("errorMessage", ({ message }) => {
      notify(message, "error");
    });
    socket.on("drawOffered", ({ from }) => {
      pendingDrawFrom = from;
      notify("Draw offered");
    });
    socket.on("drawDeclined", () => {
      pendingDrawFrom = null;
      notify("Draw declined");
    });
    socket.on("rematchVote", ({ from }) => {
      rematchVotes = [...new Set([...rematchVotes, from])];
    });
    socket.on("rematchStart", ({ room }) => {
      onlineRoom = room;
      rematchVotes = [];
      pendingDrawFrom = null;
      notify("Rematch started");
    });
    socket.on("ratingUpdate", (payload) => {
      const entry = payload?.[mySymbol];
      if (entry) {
        profile = profile
          ? { ...profile, rating: entry.rating, rank: entry.rank }
          : profile;
        notify(
          `Rating ${entry.delta >= 0 ? "+" : ""}${entry.delta} (${entry.rank})`,
          "success",
        );
      }
    });
  }

  $effect(() => {
    if (mode !== "social" && mode !== "competitive") return;
    ensureSocket();
  });
  $effect(() => {
    updatePlayerNames();
    saveSettings();
  });
  $effect(() => {
    if (typeof document !== "undefined") document.body.dataset.theme = theme;
  });
  $effect(() => {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(TOKEN_KEY, reconnectToken);
  });
  $effect(() => {
    if (mode !== "social" && mode !== "competitive") saveLocalGame();
  });
  $effect(() => {
    if (!hydrated) return;
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode !== "social" && mode !== "competitive") resetLocalGame();
  });

  $effect(() => {
    if (replay.open) return;
    const winner = currentState.winner;
    if (!winner) {
      lastWinner = null;
      return;
    }
    if (winner === lastWinner) return;
    lastWinner = winner;
    winModal = { open: true, winner };
  });

  onMount(() => {
    loadSettings();
    loadHistory();
    loadScoreboard();
    loadLocalGame();
    if (typeof localStorage !== "undefined") {
      reconnectToken = localStorage.getItem(TOKEN_KEY) ?? reconnectToken;
      const savedMode = localStorage.getItem(MODE_KEY);
      const savedLocalMode = localStorage.getItem(LAST_LOCAL_MODE_KEY);
      if (savedMode) mode = savedMode === "online" ? "social" : savedMode;
      if (savedLocalMode) lastLocalMode = savedLocalMode;
    }
    lastMode = mode;
    hydrated = true;
    screen = "menu";
    menuOpen = true;
    const interval = setInterval(() => {
      now = Date.now();
    }, 250);
    const unsubAuth = subscribeAuth((user, userProfile) => {
      authUser = user;
      profile = userProfile;
      if (pendingCompetitiveStart && authUser) {
        pendingCompetitiveStart = false;
        joinCompetitiveQueue();
      }
    });
    let unsubLeaderboard = null;
    if (db) {
      const usersQuery = query(
        collection(db, "users"),
        orderBy("rating", "desc"),
        limit(20),
      );
      unsubLeaderboard = onSnapshot(usersQuery, (snapshot) => {
        leaderboard = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
      });
    } else {
      leaderboard = [];
    }
    return () => {
      clearInterval(interval);
      unsubAuth?.();
      unsubLeaderboard?.();
    };
  });

  onDestroy(() => {
    if (replayTimer) clearInterval(replayTimer);
  });
</script>

<div class="app" data-theme={theme} data-screen={screen}>
  <!-- Ambient background particles -->
  <div class="ambient" aria-hidden="true">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
    <div class="grid-pattern"></div>
  </div>

  {#if menuOpen}
    <div class="menu-overlay" role="dialog" aria-modal="true">
      <div class="menu-shell">
        <div class="menu-header">
          <p class="menu-eyebrow">Made by JACK</p>
          <h2>Ultimate Tic-Tac-Toe</h2>
          <p class="menu-subtitle">The strategy game inside a strategy game.</p>
        </div>

        <div class="menu-cards">
          <button class="menu-card" onclick={() => requestModeSwitch("local")}>
            <i class="fa-solid fa-display" aria-hidden="true"></i>
            <span>Local</span>
          </button>
          <button class="menu-card" onclick={() => requestModeSwitch("bot")}>
            <i class="fa-solid fa-robot" aria-hidden="true"></i>
            <span>Bot</span>
          </button>
          <button class="menu-card" onclick={() => requestModeSwitch("social")}>
            <i class="fa-solid fa-people-group" aria-hidden="true"></i>
            <span>Social Multiplayer</span>
          </button>
          <button
            class="menu-card"
            onclick={() => requestModeSwitch("competitive")}
          >
            <i class="fa-solid fa-ranking-star" aria-hidden="true"></i>
            <span>Competitive Ranked</span>
          </button>
        </div>

        <div class="menu-actions">
          <button
            class="btn-primary"
            class:highlight={hasUnfinishedMatch}
            onclick={resumeGame}
            disabled={!hasUnfinishedMatch}
          >
            <i class="fa-solid fa-play" aria-hidden="true"></i>
            <span>Resume Game</span>
          </button>
          <button class="btn-ghost" onclick={openRules}>
            <i class="fa-solid fa-book" aria-hidden="true"></i>
            <span>Rules</span>
          </button>
          <button class="btn-ghost" onclick={() => (menuPanel = "settings")}>
            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
            <span>Settings</span>
          </button>
          <button class="btn-ghost" onclick={() => (menuPanel = "profile")}>
            <i class="fa-solid fa-user-astronaut" aria-hidden="true"></i>
            <span>Profile</span>
          </button>
        </div>

        {#if menuPanel === "main"}
          <div class="menu-social">
            <div class="menu-panel-header">
              <h3>Social Lobby</h3>
              <span class="dim">Create or join a room instantly.</span>
            </div>
            {#if mode === "social" && onlineRoom}
              <div class="match-info">
                <div class="match-row">
                  <i class="fa-solid fa-hashtag" aria-hidden="true"></i>
                  <span
                    >Room <strong>{onlineRoom.code ?? onlineRoom.id}</strong
                    ></span
                  >
                  <button
                    class="btn-ghost btn-icon-only"
                    onclick={() =>
                      copyRoomCode(onlineRoom.code ?? onlineRoom.id)}
                    title="Copy room code"
                  >
                    <i class="fa-solid fa-copy" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="match-row">
                  <i class="fa-solid fa-user-ninja" aria-hidden="true"></i>
                  <span
                    >vs <strong
                      >{onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                        "Waiting..."}</strong
                    ></span
                  >
                </div>
                <div class="match-row">
                  <i class="fa-solid fa-eye" aria-hidden="true"></i>
                  <span>{onlineRoom.spectators ?? 0} spectators</span>
                </div>
              </div>
            {:else}
              <button class="btn-primary" onclick={createSocialRoom}>
                <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"
                ></i>
                <span>Create Room</span>
              </button>
              <div class="field-row">
                <input
                  placeholder="Room code"
                  bind:value={socialCode}
                  class="flex-input"
                  aria-label="Room code"
                />
                <button
                  class="btn-ghost btn-icon-only"
                  onclick={joinSocialRoom}
                  title="Join room"
                >
                  <i class="fa-solid fa-door-open" aria-hidden="true"></i>
                </button>
                <button
                  class="btn-ghost btn-icon-only"
                  onclick={spectateSocialRoom}
                  title="Spectate room"
                >
                  <i class="fa-solid fa-binoculars" aria-hidden="true"></i>
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if menuPanel === "settings"}
          <div class="menu-panel">
            <div class="menu-panel-header">
              <h3>Settings</h3>
              <button
                class="btn-ghost btn-sm"
                onclick={() => (menuPanel = "main")}
              >
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                <span>Back</span>
              </button>
            </div>
            <div class="field">
              <label for="menu-p1name" class="panel-label">
                <i class="fa-solid fa-xmark mark-icon x mini" aria-hidden="true"
                ></i>
                Player 1 name
              </label>
              <input
                id="menu-p1name"
                class="flex-input"
                bind:value={playerNames.X}
                placeholder="Player 1"
              />
            </div>
            <div class="field">
              <label for="menu-p2name" class="panel-label">
                <i
                  class="fa-regular fa-circle mark-icon o mini"
                  aria-hidden="true"
                ></i>
                Player 2 name
              </label>
              <input
                id="menu-p2name"
                class="flex-input"
                bind:value={playerNames.O}
                placeholder="Player 2"
              />
            </div>
            <div class="field">
              <label for="menu-myname" class="panel-label">
                <i class="fa-solid fa-user" aria-hidden="true"></i>
                Multiplayer name
              </label>
              <input
                id="menu-myname"
                class="flex-input"
                bind:value={myName}
                placeholder="Your name"
              />
            </div>
            <div class="field">
              <label for="menu-botdiff" class="panel-label">
                <i class="fa-solid fa-robot" aria-hidden="true"></i>
                Bot difficulty
              </label>
              <select id="menu-botdiff" bind:value={botDifficulty} class="flex-input">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div class="field">
              <label for="menu-turntimer" class="panel-label">
                <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
                Turn timer
              </label>
              <select id="menu-turntimer" bind:value={turnTimeMs} class="flex-input">
                <option value={15000}>15 seconds</option>
                <option value={25000}>25 seconds</option>
                <option value={35000}>35 seconds</option>
              </select>
            </div>
            <div class="field-row">
              <button
                class="btn-ghost"
                onclick={() => (theme = theme === "light" ? "dark" : "light")}
              >
                <i class="fa-solid fa-circle-half-stroke" aria-hidden="true"
                ></i>
                <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
              </button>
              <button
                class="btn-ghost"
                onclick={() => (soundEnabled = !soundEnabled)}
              >
                <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
                <span>{soundEnabled ? "Sound On" : "Sound Off"}</span>
              </button>
            </div>
          </div>
        {/if}

        {#if menuPanel === "profile"}
          <div class="menu-panel">
            <div class="menu-panel-header">
              <h3>Profile</h3>
              <button
                class="btn-ghost btn-sm"
                onclick={() => (menuPanel = "main")}
              >
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                <span>Back</span>
              </button>
            </div>
            {#if authUser && profile}
              <div class="profile-card">
                <div class="profile-header">
                  <div
                    class="rank-badge"
                    style={`--rank-color:${currentRank.color}`}
                  >
                    <i class={`fa-solid ${currentRank.icon}`}></i>
                  </div>
                  <div class="profile-info">
                    <strong>{profile.displayName}</strong>
                    <span class="dim">
                      {currentRank.name} · Rating {profile.rating}
                    </span>
                  </div>
                </div>
                <div class="profile-stats">
                  <span><p style="color: #3c8f52">Wins:</p> {profile.wins}</span>
                  <span><p style="color: #8f3c3c">Losses:</p> {profile.losses}</span>
                  <span><p style="color: #858585">Draws:</p> {profile.draws}</span>
                </div>
                <div class="profile-recent">
                  <h4>Recent Matches</h4>
                  {#if matchHistory.length === 0}
                    <p class="dim">No matches yet.</p>
                  {:else}
                    {#each matchHistory.slice(0, 3) as match}
                      <div class="recent-row">
                        <span class="mode-chip">
                          {#if match.mode === "competitive"}
                            <i
                              class="fa-solid fa-ranking-star"
                              aria-hidden="true"
                            ></i>
                          {:else if match.mode === "social"}
                            <i
                              class="fa-solid fa-people-group"
                              aria-hidden="true"
                            ></i>
                          {:else if match.mode === "bot"}
                            <i class="fa-solid fa-robot" aria-hidden="true"></i>
                          {:else}
                            <i class="fa-solid fa-display" aria-hidden="true"
                            ></i>
                          {/if}
                          <span>{match.mode}</span>
                        </span>
                        <span class="dim"
                          >{new Date(match.endedAt).toLocaleDateString()}</span
                        >
                      </div>
                    {/each}
                  {/if}
                </div>
                <button class="btn-ghost" onclick={handleSignOut}>
                  <i class="fa-solid fa-right-from-bracket"></i>
                  <span>Sign Out</span>
                </button>
              </div>
            {:else}
              <p class="dim">Sign in to access ranked play and your profile.</p>
              <button
                class="btn-primary"
                onclick={() => (authModal = { ...authModal, open: true })}
              >
                <i class="fa-solid fa-user" aria-hidden="true"></i>
                <span>Sign In</span>
              </button>
            {/if}

            <div class="leaderboard">
              <h4>Leaderboard</h4>
              {#if leaderboard.length === 0}
                <p class="dim">No rankings yet.</p>
              {:else}
                {#each leaderboard as entry, i}
                  <div class="leaderboard-row">
                    <span class="rank-num">#{i + 1}</span>
                    <span class="leader-name">{entry.displayName}</span>
                    <span class="leader-rating">{entry.rating}</span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- TOP BAR -->
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <i class="fa-solid fa-xmark brand-x" aria-hidden="true"></i>
        <i class="fa-regular fa-circle brand-o" aria-hidden="true"></i>
      </div>
      <div class="brand-text">
        <h1>Ultimate <em>Tic-Tac-Toe</em></h1>
      </div>
    </div>

    <div class="topbar-center">
      <div class="status-pill" class:winner={!!currentState.winner}>
        {#if currentState.winner === "D"}
          <i class="fa-solid fa-equals" aria-hidden="true"></i>
          <span>Draw!</span>
        {:else if currentState.winner}
          <i class="fa-solid fa-crown" aria-hidden="true"></i>
          <span>{statusLine}</span>
        {:else if currentState.currentPlayer === "X"}
          <i class="fa-solid fa-xmark mark-icon x" aria-hidden="true"></i>
          <span>{statusLine}</span>
        {:else}
          <i class="fa-regular fa-circle mark-icon o" aria-hidden="true"></i>
          <span>{statusLine}</span>
        {/if}
      </div>
    </div>

    <div class="topbar-actions">
      <button
        class="icon-btn"
        onclick={() => (theme = theme === "light" ? "dark" : "light")}
        title={theme === "light" ? "Dark mode" : "Light mode"}
      >
        {#if theme === "light"}
          <i class="fa-solid fa-moon" aria-hidden="true"></i>
        {:else}
          <i class="fa-solid fa-sun" aria-hidden="true"></i>
        {/if}
      </button>
      <button
        class="icon-btn"
        onclick={() => (soundEnabled = !soundEnabled)}
        title={soundEnabled ? "Mute sound" : "Enable sound"}
      >
        {#if soundEnabled}
          <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
        {:else}
          <i class="fa-solid fa-volume-xmark" aria-hidden="true"></i>
        {/if}
      </button>
      <button class="icon-btn" onclick={openMenu} title="Menu">
        <i class="fa-solid fa-grid-2" aria-hidden="true"></i>
      </button>
      <button
        class="icon-btn"
        class:active={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
        title="Toggle panel"
      >
        <i class="fa-solid fa-sliders" aria-hidden="true"></i>
      </button>
    </div>
  </header>

  <!-- MAIN LAYOUT -->
  <main class="layout" class:sidebar-open={sidebarOpen}>
    <div
      class="sidebar-scrim"
      class:show={sidebarOpen}
      role="button"
      tabindex="0"
      aria-label="Close side panel"
      onclick={() => (sidebarOpen = false)}
      onkeydown={(event) => {
        if (event.key === "Enter" || event.key === " ") sidebarOpen = false;
      }}
    ></div>
    <!-- LEFT: BOARD ZONE -->
    <section class="board-zone" data-turn={currentState.currentPlayer}>
      <!-- Stat bar -->
      <div class="stat-bar">
        <div class="stat-card">
          <div class="stat-icon">
            {#if currentState.currentPlayer === "X"}
              <i class="fa-solid fa-xmark mark-icon x" aria-hidden="true"></i>
            {:else}
              <i class="fa-regular fa-circle mark-icon o" aria-hidden="true"
              ></i>
            {/if}
          </div>
          <div class="stat-body">
            <span class="stat-label">Current</span>
            <strong class="stat-value"
              >{currentState.players?.[currentState.currentPlayer] ??
                currentState.currentPlayer}</strong
            >
          </div>
        </div>

        <div class="stat-divider"></div>

        <div class="stat-card">
          <div class="stat-icon target-icon">
            <i class="fa-solid fa-crosshairs" aria-hidden="true"></i>
          </div>
          <div class="stat-body">
            <span class="stat-label">Target</span>
            <strong class="stat-value">{forcedLabel}</strong>
          </div>
        </div>

        <div class="stat-divider"></div>

        <div class="stat-card timer-card" class:urgent={timeLeft <= 8}>
          <div class="timer-ring">
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke-width="2.5"
                class="ring-track"
              />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke-width="2.5"
                class="ring-fill"
                stroke-dasharray="94.25"
                stroke-dashoffset={94.25 - (timerPct / 100) * 94.25}
                transform="rotate(-90 18 18)"
              />
            </svg>
            <span class="timer-num">{timeLeft}</span>
          </div>
          <div class="stat-body">
            <span class="stat-label">Timer</span>
            <strong class="stat-value">{timeLeft}s</strong>
          </div>
        </div>

        {#if mode === "social" || mode === "competitive"}
          <div class="stat-divider"></div>
          <div class="stat-card">
            <div class="stat-icon net-icon">
              <i class="fa-solid fa-wifi" aria-hidden="true"></i>
            </div>
            <div class="stat-body">
              <span class="stat-label"
                >{mode === "social" ? "Room" : "Match"}</span
              >
              <strong class="stat-value"
                >{onlineRoom?.code ?? onlineRoom?.id ?? "—"}</strong
              >
              <span class="stat-sub">
                {#if spectator}
                  Spectating
                {:else if mySymbol === "X"}
                  You <i
                    class="fa-solid fa-xmark mark-icon x mini"
                    aria-hidden="true"
                  ></i>
                {:else}
                  You <i
                    class="fa-regular fa-circle mark-icon o mini"
                    aria-hidden="true"
                  ></i>
                {/if}
              </span>
            </div>
          </div>
        {/if}
      </div>

      <div class="board-actions">
        {#if mode === "local" || mode === "bot"}
          <button class="btn-primary" onclick={() => resetLocalGame()}>
            <i class="fa-solid fa-bolt" aria-hidden="true"></i>
            <span>New Game</span>
          </button>
          <button class="btn-ghost" onclick={() => (sidebarOpen = true)}>
            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
            <span>Settings</span>
          </button>
        {:else}
          <button
            class="btn-primary"
            onclick={requestRematch}
            disabled={!onlineRoom || spectator}
          >
            <i class="fa-solid fa-repeat" aria-hidden="true"></i>
            <span>Rematch</span>
          </button>
          <button
            class="btn-ghost"
            onclick={offerDraw}
            disabled={!!pendingDrawFrom || !onlineRoom || spectator}
          >
            <i class="fa-solid fa-handshake" aria-hidden="true"></i>
            <span>Offer Draw</span>
          </button>
        {/if}
      </div>

      <!-- THE BOARD -->
      <div
        class="ultimate-board"
        role="grid"
        tabindex="0"
        onkeydown={handleKeydown}
        aria-label="Ultimate tic tac toe board"
      >
        {#each currentState.boards as board, boardIndex}
          {@const boardActive = legalBoards.includes(boardIndex)}
          <div
            class="local-board"
            class:active={boardActive}
            class:inactive={!boardActive && !board.winner}
            class:won={board.winner && board.winner !== "D"}
            class:drawn={board.winner === "D"}
            data-board={boardIndex}
          >
            {#if board.winner && board.winner !== "D"}
              <div
                class="board-claim"
                class:claim-x={board.winner === "X"}
                class:claim-o={board.winner === "O"}
              >
                {#if board.winner === "X"}
                  <i
                    class="fa-solid fa-xmark claim-symbol mark-icon x"
                    aria-hidden="true"
                  ></i>
                {:else}
                  <i
                    class="fa-regular fa-circle claim-symbol mark-icon o"
                    aria-hidden="true"
                  ></i>
                {/if}
              </div>
            {/if}
            {#if board.winner === "D"}
              <div class="board-claim claim-draw">
                <i class="fa-solid fa-equals" aria-hidden="true"></i>
              </div>
            {/if}
            {#if board.winLine && board.winner && board.winner !== "D"}
              <div
                class={`win-line ${getWinLineClass(board.winLine)} ${
                  board.winner === "X" ? "line-x" : "line-o"
                }`}
              ></div>
            {/if}

            {#each board.cells as cell, cellIndex}
              {@const isLast =
                currentState.lastMove?.board === boardIndex &&
                currentState.lastMove?.cell === cellIndex}
              {@const isKbd =
                kbdFocus.board === boardIndex && kbdFocus.cell === cellIndex}
              {@const legal = isLegalCell(boardIndex, cellIndex)}
              {@const isHovered =
                hoverCell?.board === boardIndex &&
                hoverCell?.cell === cellIndex}
              <button
                class="cell"
                class:last={isLast}
                class:kbd={isKbd}
                class:legal
                class:illegal={!legal}
                class:cell-x={cell === "X"}
                class:cell-o={cell === "O"}
                aria-label={`Board ${boardIndex + 1} cell ${cellIndex + 1}`}
                onmouseenter={() =>
                  (hoverCell = { board: boardIndex, cell: cellIndex })}
                onmouseleave={() => (hoverCell = null)}
                onclick={() => handleCellClick(boardIndex, cellIndex)}
                disabled={!legal || !!board.winner}
              >
                {#if cell === "X"}
                  <i class="fa-solid fa-xmark mark-icon x" aria-hidden="true"
                  ></i>
                {:else if cell === "O"}
                  <i class="fa-regular fa-circle mark-icon o" aria-hidden="true"
                  ></i>
                {:else if isHovered && legal}
                  <span class="ghost-mark">
                    {#if currentState.currentPlayer === "X"}
                      <i
                        class="fa-solid fa-xmark mark-icon x"
                        aria-hidden="true"
                      ></i>
                    {:else}
                      <i
                        class="fa-regular fa-circle mark-icon o"
                        aria-hidden="true"
                      ></i>
                    {/if}
                  </span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </section>

    <!-- RIGHT: SIDE PANEL -->
    <aside class="side-panel" class:open={sidebarOpen}>
      <!-- MODE SWITCHER -->
      <div class="mode-tabs">
        <button
          class="tab"
          class:tab-active={mode === "local"}
          onclick={() => requestModeSwitch("local")}
        >
          <i class="fa-solid fa-display" aria-hidden="true"></i>
          <span>Local</span>
        </button>
        <button
          class="tab"
          class:tab-active={mode === "bot"}
          onclick={() => requestModeSwitch("bot")}
        >
          <i class="fa-solid fa-robot" aria-hidden="true"></i>
          <span>vs Bot</span>
        </button>
        <button
          class="tab"
          class:tab-active={mode === "social"}
          onclick={() => requestModeSwitch("social")}
        >
          <i class="fa-solid fa-people-group" aria-hidden="true"></i>
          <span>Social</span>
        </button>
        <button
          class="tab"
          class:tab-active={mode === "competitive"}
          onclick={() => requestModeSwitch("competitive")}
        >
          <i class="fa-solid fa-ranking-star" aria-hidden="true"></i>
          <span>Ranked</span>
        </button>
      </div>

      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-bolt" aria-hidden="true"></i>
          <span>Quick Actions</span>
        </div>
        <div class="panel-body">
          {#if mode === "local" || mode === "bot"}
            <button class="btn-primary" onclick={() => resetLocalGame()}>
              <i class="fa-solid fa-bolt" aria-hidden="true"></i>
              <span>New Game</span>
            </button>
            <div class="field-row">
              <button
                class="btn-ghost"
                onclick={undoMove}
                disabled={past.length === 0 || mode !== "local"}
              >
                <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
                <span>Undo</span>
              </button>
              <button
                class="btn-ghost"
                onclick={redoMove}
                disabled={future.length === 0 || mode !== "local"}
              >
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>Redo</span>
              </button>
            </div>
          {:else}
            <button
              class="btn-primary"
              onclick={requestRematch}
              disabled={!onlineRoom || spectator}
            >
              <i class="fa-solid fa-repeat" aria-hidden="true"></i>
              <span>Rematch</span>
            </button>
            <button
              class="btn-ghost"
              onclick={offerDraw}
              disabled={!!pendingDrawFrom || !onlineRoom || spectator}
            >
              <i class="fa-solid fa-handshake" aria-hidden="true"></i>
              <span>Offer Draw</span>
            </button>
          {/if}
          <button class="btn-ghost" onclick={exportGameState}>
            <i class="fa-solid fa-clipboard" aria-hidden="true"></i>
            <span>Copy State</span>
          </button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-timeline" aria-hidden="true"></i>
          <span>Moves</span>
          <span class="badge">{currentState.moves.length}</span>
        </div>
        <div class="panel-body">
          <div class="timeline-scroll">
            {#each currentState.moves as move, index}
              <div class="t-item">
                <span class="t-num">#{index + 1}</span>
                <span
                  class="t-mark"
                  class:t-x={move.player === "X"}
                  class:t-o={move.player === "O"}
                >
                  {#if move.player === "X"}
                    <i
                      class="fa-solid fa-xmark mark-icon x mini"
                      aria-hidden="true"
                    ></i>
                  {:else}
                    <i
                      class="fa-regular fa-circle mark-icon o mini"
                      aria-hidden="true"
                    ></i>
                  {/if}
                </span>
                <span class="t-loc">B{move.board + 1} · C{move.cell + 1}</span>
              </div>
            {/each}
            {#if currentState.moves.length === 0}
              <span class="t-empty">No moves yet</span>
            {/if}
          </div>
        </div>
      </div>

      <!-- SETTINGS PANEL -->
      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-sliders" aria-hidden="true"></i>
          <span>Settings</span>
        </div>
        <div class="panel-body">
          <div class="field">
            <label for="p1name">
              <i class="fa-solid fa-xmark mark-icon x mini" aria-hidden="true"
              ></i>
              Player 1 name
            </label>
            <input
              id="p1name"
              bind:value={playerNames.X}
              placeholder="Player 1"
            />
          </div>
          <div class="field">
            <label for="p2name">
              <i
                class="fa-regular fa-circle mark-icon o mini"
                aria-hidden="true"
              ></i>
              Player 2 name
            </label>
            <input
              id="p2name"
              bind:value={playerNames.O}
              placeholder="Player 2"
            />
          </div>
          <div class="field">
            <label for="myname">
              <i class="fa-solid fa-user" aria-hidden="true"></i>
              Multiplayer name
            </label>
            <input id="myname" bind:value={myName} placeholder="Your name" />
          </div>
          <div class="field">
            <label for="botdiff">
              <i class="fa-solid fa-robot" aria-hidden="true"></i>
              Bot difficulty
            </label>
            <select id="botdiff" bind:value={botDifficulty}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div class="field">
            <label for="turntimer">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
              Turn timer
            </label>
            <select id="turntimer" bind:value={turnTimeMs}>
              <option value={15000}>15 seconds</option>
              <option value={25000}>25 seconds</option>
              <option value={35000}>35 seconds</option>
            </select>
          </div>
          <div class="field-row">
            <button
              class="btn-ghost"
              onclick={() => (theme = theme === "light" ? "dark" : "light")}
            >
              <i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i>
              <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
            </button>
            <button
              class="btn-ghost"
              onclick={() => (soundEnabled = !soundEnabled)}
            >
              <i class="fa-solid fa-volume-high" aria-hidden="true"></i>
              <span>{soundEnabled ? "Sound On" : "Sound Off"}</span>
            </button>
          </div>
          <button class="btn-primary" onclick={() => resetLocalGame()}>
            <i class="fa-solid fa-bolt" aria-hidden="true"></i>
            <span>Apply & Restart</span>
          </button>
        </div>
      </div>

      <!-- BOT PANEL -->
      {#if mode === "bot"}
        <div class="panel panel-accent">
          <div class="panel-header">
            <i class="fa-solid fa-robot" aria-hidden="true"></i>
            <span>Bot Match</span>
          </div>
          <div class="panel-body">
            <p class="info-row">
              You play as <i
                class="fa-solid fa-xmark mark-icon x mini"
                aria-hidden="true"
              ></i>
              <span class="dim">·</span>
              <strong>{BOT_NAME}</strong> plays as
              <i
                class="fa-regular fa-circle mark-icon o mini"
                aria-hidden="true"
              ></i>
            </p>
            <p class="info-row dim">
              Difficulty: <strong>{botDifficulty}</strong>
            </p>
            <button class="btn-primary" onclick={() => resetLocalGame()}>
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>Restart Match</span>
            </button>
          </div>
        </div>
      {/if}

      <!-- SOCIAL PANEL -->
      {#if mode === "social"}
        <div class="panel">
          <div class="panel-header">
            <i class="fa-solid fa-people-group" aria-hidden="true"></i>
            <span>Social Lobby</span>
            <span
              class="conn-dot"
              class:conn-on={connectionStatus === "online"}
              class:conn-mid={connectionStatus === "connecting"}
            ></span>
          </div>
          <div class="panel-body">
            <p class="info-row dim">
              <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
              {connectionStatus}
            </p>
            {#if !onlineRoom}
              <button class="btn-primary" onclick={createSocialRoom}>
                <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"
                ></i>
                <span>Create Room</span>
              </button>
              <div class="field-row">
                <input
                  placeholder="Room code"
                  bind:value={socialCode}
                  class="flex-input"
                  aria-label="Room code"
                />
                <button
                  class="btn-ghost btn-icon-only"
                  onclick={joinSocialRoom}
                  title="Join room"
                >
                  <i class="fa-solid fa-door-open" aria-hidden="true"></i>
                </button>
                <button
                  class="btn-ghost btn-icon-only"
                  onclick={spectateSocialRoom}
                  title="Spectate room"
                >
                  <i class="fa-solid fa-binoculars" aria-hidden="true"></i>
                </button>
              </div>
            {:else}
              <div class="match-info">
                <div class="match-row">
                  <i class="fa-solid fa-hashtag" aria-hidden="true"></i>
                  <span
                    >Room <strong>{onlineRoom.code ?? onlineRoom.id}</strong
                    ></span
                  >
                  <button
                    class="btn-ghost btn-icon-only"
                    onclick={() =>
                      copyRoomCode(onlineRoom.code ?? onlineRoom.id)}
                    title="Copy room code"
                  >
                    <i class="fa-solid fa-copy" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="match-row">
                  <i class="fa-solid fa-user-ninja" aria-hidden="true"></i>
                  <span
                    >vs <strong
                      >{onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                        "Waiting..."}</strong
                    ></span
                  >
                </div>
                <div class="match-row">
                  <i class="fa-solid fa-eye" aria-hidden="true"></i>
                  <span>{onlineRoom.spectators ?? 0} spectators</span>
                </div>
              </div>
              {#if pendingDrawFrom && pendingDrawFrom !== mySymbol}
                <div class="draw-offer">
                  <p>
                    <i class="fa-solid fa-handshake" aria-hidden="true"></i> Draw
                    offered!
                  </p>
                  <div class="field-row">
                    <button
                      class="btn-primary"
                      onclick={() => respondDraw(true)}
                    >
                      <i class="fa-solid fa-check" aria-hidden="true"></i>
                      <span>Accept</span>
                    </button>
                    <button
                      class="btn-ghost"
                      onclick={() => respondDraw(false)}
                    >
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              {/if}
              {#if rematchVotes.length > 0}
                <p class="info-row dim">
                  <i class="fa-solid fa-repeat" aria-hidden="true"></i>
                  Rematch: {rematchVotes.join(", ")}
                </p>
              {/if}
            {/if}
          </div>
        </div>
      {/if}

      <!-- COMPETITIVE PANEL -->
      {#if mode === "competitive"}
        <div class="panel">
          <div class="panel-header">
            <i class="fa-solid fa-ranking-star" aria-hidden="true"></i>
            <span>Ranked Queue</span>
            <span
              class="conn-dot"
              class:conn-on={connectionStatus === "online"}
              class:conn-mid={connectionStatus === "connecting"}
            ></span>
          </div>
          <div class="panel-body">
            {#if !authUser}
              <p class="info-row dim">Sign in to play competitive.</p>
              <button
                class="btn-primary"
                onclick={() => (authModal = { ...authModal, open: true })}
              >
                <i class="fa-solid fa-user" aria-hidden="true"></i>
                <span>Sign In</span>
              </button>
            {:else if !onlineRoom}
              <button
                class="btn-primary"
                onclick={joinCompetitiveQueue}
                disabled={queueStatus.queued}
              >
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <span
                  >{queueStatus.queued
                    ? `Queued · #${queueStatus.position}`
                    : "Enter Queue"}</span
                >
              </button>
              {#if queueStatus.queued}
                <p class="info-row dim">
                  Tier: <strong>{queueStatus.tier || currentRank.name}</strong>
                </p>
                <button class="btn-ghost" onclick={leaveCompetitiveQueue}>
                  <i class="fa-solid fa-door-open" aria-hidden="true"></i>
                  <span>Leave Queue</span>
                </button>
              {/if}
            {:else}
              <div class="match-info">
                <div class="match-row">
                  <i class="fa-solid fa-user-ninja" aria-hidden="true"></i>
                  <span
                    >vs <strong
                      >{onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                        "Opponent"}</strong
                    ></span
                  >
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- SCOREBOARD -->
      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-trophy" aria-hidden="true"></i>
          <span>Scoreboard</span>
        </div>
        <div class="panel-body score-body">
          <div class="score-row">
            <div class="score-player">
              <i class="fa-solid fa-xmark mark-icon x mini" aria-hidden="true"
              ></i>
              <span>{displayNames.X}</span>
            </div>
            <span class="score-num score-x">{scoreboard.X}</span>
          </div>
          <div class="score-divider"></div>
          <div class="score-row">
            <div class="score-player">
              <i
                class="fa-regular fa-circle mark-icon o mini"
                aria-hidden="true"
              ></i>
              <span>{displayNames.O}</span>
            </div>
            <span class="score-num score-o">{scoreboard.O}</span>
          </div>
          <div class="score-divider"></div>
          <div class="score-row">
            <div class="score-player">
              <i class="fa-solid fa-equals" aria-hidden="true"></i>
              <span>Draws</span>
            </div>
            <span class="score-num score-d">{scoreboard.draws}</span>
          </div>
        </div>
      </div>

      <!-- LEADERBOARD (competitive only) -->
      {#if mode === "competitive"}
        <div class="panel">
          <div class="panel-header">
            <i class="fa-solid fa-ranking-star" aria-hidden="true"></i>
            <span>Leaderboard</span>
          </div>
          <div class="panel-body">
            {#if leaderboard.length === 0}
              <p class="info-row dim">No games recorded yet.</p>
            {:else}
              {#each leaderboard as entry, i}
                <div class="score-row">
                  <div class="score-player">
                    <span class="rank-num">#{i + 1}</span>
                    <span>{entry.displayName}</span>
                  </div>
                  <span class="score-num">{entry.rating}</span>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      <!-- HISTORY -->
      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
          <span>Match History</span>
          {#if matchHistory.length > 0}
            <span class="badge">{matchHistory.length}</span>
          {/if}
        </div>
        <div class="panel-body history-body">
          {#if matchHistory.length === 0}
            <p class="info-row dim">No matches yet.</p>
          {:else}
            {#each matchHistory as match}
              <div class="history-item">
                <div class="history-meta">
                  <span class="mode-chip">
                    {#if match.mode === "bot"}
                      <i class="fa-solid fa-robot" aria-hidden="true"></i>
                    {:else if match.mode === "social"}
                      <i class="fa-solid fa-people-group" aria-hidden="true"
                      ></i>
                    {:else if match.mode === "competitive"}
                      <i class="fa-solid fa-ranking-star" aria-hidden="true"
                      ></i>
                    {:else}
                      <i class="fa-solid fa-display" aria-hidden="true"></i>
                    {/if}
                    <span>{match.mode}</span>
                  </span>
                  <span class="history-date"
                    >{new Date(match.endedAt).toLocaleString()}</span
                  >
                </div>
                <button
                  class="btn-ghost btn-sm"
                  onclick={() => openReplay(match)}
                >
                  <i class="fa-solid fa-play" aria-hidden="true"></i>
                  <span>Replay</span>
                </button>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- STATE TOOLS -->
      <div class="panel">
        <div class="panel-header">
          <i class="fa-solid fa-database" aria-hidden="true"></i>
          <span>State Tools</span>
        </div>
        <div class="panel-body">
          <textarea
            rows="3"
            bind:value={exportText}
            placeholder="Paste or export game state JSON"
            aria-label="Game state JSON"
          ></textarea>
          <div class="field-row">
            <button class="btn-ghost" onclick={exportGameState}>
              <i class="fa-solid fa-file-export" aria-hidden="true"></i>
              <span>Export</span>
            </button>
            <button class="btn-ghost" onclick={importGameState}>
              <i class="fa-solid fa-file-import" aria-hidden="true"></i>
              <span>Import</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  </main>

  {#if rulesOpen}
    <div
      class="menu-modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeRules}
    >
      <div
        class="menu-modal"
        role="dialog"
        aria-modal="true"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="menu-modal-header">
          <h3>Rules</h3>
          <button class="btn-ghost btn-icon-only" onclick={closeRules}>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <ul class="rules-list">
          <li>Win a small board by getting three in a row.</li>
          <li>Your move sends your opponent to the matching board.</li>
          <li>If that board is won or full, they can play anywhere.</li>
          <li>Win the big board by winning three small boards in a row.</li>
        </ul>
      </div>
    </div>
  {/if}

  {#if authModal.open}
    <div
      class="menu-modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeAuthModal}
    >
      <div
        class="menu-modal"
        role="dialog"
        aria-modal="true"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="menu-modal-header">
          <h3>{authModal.mode === "signup" ? "Create Account" : "Sign In"}</h3>
          <button class="btn-ghost btn-icon-only" onclick={closeAuthModal}>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div class="field">
          <label>Email</label>
          <input
            type="email"
            bind:value={authForm.email}
            placeholder="you@example.com"
          />
        </div>
        <div class="field">
          <label>Password</label>
          <input
            type="password"
            bind:value={authForm.password}
            placeholder="••••••••"
          />
        </div>
        {#if authModal.mode === "signup"}
          <div class="field">
            <label>Display name</label>
            <input
              type="text"
              bind:value={authForm.displayName}
              placeholder="Player name"
            />
          </div>
        {/if}
        <div class="field-row">
          {#if authModal.mode === "signup"}
            <button class="btn-primary" onclick={handleEmailSignUp}>
              <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
              <span>Create Account</span>
            </button>
          {:else}
            <button class="btn-primary" onclick={handleEmailSignIn}>
              <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>
              <span>Sign In</span>
            </button>
          {/if}
          <button class="btn-ghost" onclick={handleGoogleSignIn}>
            <i class="fa-brands fa-google" aria-hidden="true"></i>
            <span>Google</span>
          </button>
        </div>
        <button
          class="btn-ghost btn-sm"
          onclick={() =>
            (authModal = {
              ...authModal,
              mode: authModal.mode === "signup" ? "signin" : "signup",
            })}
        >
          <span
            >{authModal.mode === "signup"
              ? "Already have an account?"
              : "Need an account?"}</span
          >
        </button>
      </div>
    </div>
  {/if}

  {#if confirmSwitch.open}
    <div
      class="menu-modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => (confirmSwitch = { open: false, nextMode: null })}
    >
      <div
        class="menu-modal"
        role="dialog"
        aria-modal="true"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="menu-modal-header">
          <h3>Switch Mode?</h3>
          <button
            class="btn-ghost btn-icon-only"
            onclick={() => (confirmSwitch = { open: false, nextMode: null })}
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <p class="dim">
          Switching modes will reset the current match. Continue?
        </p>
        <div class="field-row">
          <button class="btn-primary" onclick={confirmModeSwitch}>
            <i class="fa-solid fa-check" aria-hidden="true"></i>
            <span>Yes, Switch</span>
          </button>
          <button
            class="btn-ghost"
            onclick={() => (confirmSwitch = { open: false, nextMode: null })}
          >
            <i class="fa-solid fa-ban" aria-hidden="true"></i>
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- REPLAY MODAL -->
  {#if replay.open && replay.match}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close replay"
      onclick={closeReplay}
      onkeydown={(event) => {
        if (
          event.key === "Escape" ||
          event.key === "Enter" ||
          event.key === " "
        )
          closeReplay();
      }}
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Replay viewer"
        tabindex="0"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h2>
            <i class="fa-solid fa-film" aria-hidden="true"></i>
            Replay — {replay.match.mode}
          </h2>
          <button
            class="btn-ghost btn-icon-only"
            aria-label="Close replay"
            onclick={closeReplay}
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        {#if replayState}
          <div class="ultimate-board replay-board" aria-hidden="true">
            {#each replayState.boards as board, boardIndex}
              <div
                class="local-board"
                class:won={board.winner && board.winner !== "D"}
                class:drawn={board.winner === "D"}
              >
                {#if board.winner && board.winner !== "D"}
                  <div
                    class="board-claim"
                    class:claim-x={board.winner === "X"}
                    class:claim-o={board.winner === "O"}
                  >
                    {#if board.winner === "X"}
                      <i
                        class="fa-solid fa-xmark claim-symbol mark-icon x"
                        aria-hidden="true"
                      ></i>
                    {:else}
                      <i
                        class="fa-regular fa-circle claim-symbol mark-icon o"
                        aria-hidden="true"
                      ></i>
                    {/if}
                  </div>
                {/if}
                {#if board.winner === "D"}
                  <div class="board-claim claim-draw">
                    <i class="fa-solid fa-equals" aria-hidden="true"></i>
                  </div>
                {/if}
                {#if board.winLine && board.winner && board.winner !== "D"}
                  <div
                    class={`win-line ${getWinLineClass(board.winLine)} ${
                      board.winner === "X" ? "line-x" : "line-o"
                    }`}
                  ></div>
                {/if}
                {#each board.cells as cell}
                  <div class="cell replay-cell">
                    {#if cell === "X"}
                      <i
                        class="fa-solid fa-xmark mark-icon x"
                        aria-hidden="true"
                      ></i>
                    {:else if cell === "O"}
                      <i
                        class="fa-regular fa-circle mark-icon o"
                        aria-hidden="true"
                      ></i>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}

        <div class="replay-controls">
          <button
            class="btn-ghost"
            onclick={() => (replay.index = 0)}
            aria-label="Go to beginning"
          >
            <i class="fa-solid fa-backward-fast" aria-hidden="true"></i>
          </button>
          <button
            class="btn-ghost"
            onclick={() => (replay.index = Math.max(0, replay.index - 1))}
            aria-label="Go to previous move"
          >
            <i class="fa-solid fa-backward-step" aria-hidden="true"></i>
          </button>
          <button class="btn-primary" onclick={toggleReplayPlay}>
            {#if replay.playing}
              <i class="fa-solid fa-pause" aria-hidden="true"></i>
              <span>Pause</span>
            {:else}
              <i class="fa-solid fa-play" aria-hidden="true"></i>
              <span>Play</span>
            {/if}
          </button>
          <button
            class="btn-ghost"
            onclick={() =>
              (replay.index = Math.min(
                replay.match.moves.length,
                replay.index + 1,
              ))}
            aria-label="Go to next move"
          >
            <i class="fa-solid fa-forward-step" aria-hidden="true"></i>
          </button>
          <button
            class="btn-ghost"
            onclick={() => (replay.index = replay.match.moves.length)}
            aria-label="Go to end"
          >
            <i class="fa-solid fa-forward-fast" aria-hidden="true"></i>
          </button>
        </div>

        <div class="replay-progress">
          <div class="progress-bar">
            <div
              class="progress-fill"
              style="width: {replay.match.moves.length > 0
                ? (replay.index / replay.match.moves.length) * 100
                : 0}%"
            ></div>
          </div>
          <span class="progress-label"
            >Move {replay.index} / {replay.match.moves.length}</span
          >
        </div>
      </div>
    </div>
  {/if}

  <!-- WIN MODAL -->
  {#if winModal.open}
    <div
      class="win-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close result"
      onclick={closeWinModal}
      onkeydown={(event) => {
        if (
          event.key === "Escape" ||
          event.key === "Enter" ||
          event.key === " "
        )
          closeWinModal();
      }}
    >
      <div
        class="win-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Match result"
        tabindex="0"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="win-icon">
          {#if winModal.winner === "D"}
            <i class="fa-solid fa-equals" aria-hidden="true"></i>
          {:else if winModal.winner === "X"}
            <i class="fa-solid fa-xmark mark-icon x" aria-hidden="true"></i>
          {:else}
            <i class="fa-regular fa-circle mark-icon o" aria-hidden="true"></i>
          {/if}
        </div>
        <h2>
          {#if winModal.winner === "D"}
            Draw Game
          {:else}
            {currentState.players?.[winModal.winner] ?? "Player"} wins
          {/if}
        </h2>
        <p class="win-sub">{statusLine}</p>
        <div class="win-actions">
          {#if mode === "social" || mode === "competitive"}
            <button
              class="btn-primary"
              onclick={() => {
                requestRematch();
                closeWinModal();
              }}
              disabled={!onlineRoom || spectator}
            >
              <i class="fa-solid fa-repeat" aria-hidden="true"></i>
              <span>Rematch</span>
            </button>
          {:else}
            <button
              class="btn-primary"
              onclick={() => {
                resetLocalGame();
                closeWinModal();
              }}
            >
              <i class="fa-solid fa-bolt" aria-hidden="true"></i>
              <span>New Game</span>
            </button>
          {/if}
          <button class="btn-ghost" onclick={closeWinModal}>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            <span>Close</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- TOAST NOTIFICATIONS -->
  <div class="toast-zone" aria-live="polite">
    {#each toastList as toast (toast.id)}
      <div
        class="toast"
        class:toast-error={toast.tone === "error"}
        class:toast-success={toast.tone === "success"}
      >
        {#if toast.tone === "error"}
          <i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
        {:else if toast.tone === "success"}
          <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
        {:else}
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        {/if}
        <span>{toast.message}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  /* ─────────────────────────────────────────
	   DESIGN TOKENS & THEMES
	   ───────────────────────────────────────── */
  :global(:root) {
    --font-display: "Fira Code", "Fira Code", monospace;
    --font-body: "Manrope", "Fira Code", monospace;
    --radius-sm: 8px;
    --radius-md: 14px;
    --radius-lg: 20px;
    --radius-xl: 28px;
    --radius-pill: 999px;
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  }

  /* DARK THEME (default) */
  :global(body),
  :global(body[data-theme="dark"]) {
    --bg: #080e14;
    --bg-2: #0d1520;
    --bg-3: #121d2b;
    --bg-4: #182535;
    --surface: rgba(13, 21, 32, 0.85);
    --surface-2: rgba(18, 29, 43, 0.7);
    --surface-hover: rgba(24, 37, 53, 0.9);
    --border: rgba(56, 189, 248, 0.12);
    --border-bright: rgba(56, 189, 248, 0.28);
    --text: #b8cfe4;
    --text-bright: #e8f4ff;
    --text-dim: #5a7a95;
    --primary: #38bdf8;
    --primary-dim: rgba(56, 189, 248, 0.15);
    --primary-glow: rgba(56, 189, 248, 0.35);
    --on-primary: #041018;
    --x-color: #fb923c;
    --x-dim: rgba(251, 146, 60, 0.15);
    --x-glow: rgba(251, 146, 60, 0.4);
    --o-color: #38bdf8;
    --o-dim: rgba(56, 189, 248, 0.15);
    --o-glow: rgba(56, 189, 248, 0.4);
    --win-color: #4ade80;
    --win-glow: rgba(74, 222, 128, 0.35);
    --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 20px 60px rgba(0, 0, 0, 0.5);
    --shadow-glow: 0 0 24px var(--primary-glow);
    --board-bg: #0a1420;
    --board-border: rgba(56, 189, 248, 0.2);
    --board-active-border: #38bdf8;
    --cell-bg: #0f1e2e;
    --cell-hover-bg: rgba(56, 189, 248, 0.1);
    --cell-last-border: rgba(56, 189, 248, 0.6);
    --modal-bg: rgba(4, 8, 14, 0.9);
    --toast-bg: rgba(13, 21, 32, 0.97);
  }

  /* LIGHT THEME */
  :global(body[data-theme="light"]) {
    --bg: #f0f4f9;
    --bg-2: #e8eef6;
    --bg-3: #dde5f0;
    --bg-4: #d0daea;
    --surface: rgba(255, 255, 255, 0.92);
    --surface-2: rgba(240, 244, 249, 0.8);
    --surface-hover: rgba(224, 232, 244, 0.95);
    --border: rgba(37, 99, 162, 0.1);
    --border-bright: rgba(37, 99, 162, 0.22);
    --text: #2d4a6b;
    --text-bright: #0f2240;
    --text-dim: #7a96b5;
    --primary: #0284c7;
    --primary-dim: rgba(2, 132, 199, 0.1);
    --primary-glow: rgba(2, 132, 199, 0.25);
    --on-primary: #ffffff;
    --x-color: #ea580c;
    --x-dim: rgba(234, 88, 12, 0.1);
    --x-glow: rgba(234, 88, 12, 0.3);
    --o-color: #0284c7;
    --o-dim: rgba(2, 132, 199, 0.1);
    --o-glow: rgba(2, 132, 199, 0.3);
    --win-color: #16a34a;
    --win-glow: rgba(22, 163, 74, 0.25);
    --shadow-sm: 0 2px 8px rgba(15, 34, 64, 0.08);
    --shadow-md: 0 8px 28px rgba(15, 34, 64, 0.1);
    --shadow-lg: 0 20px 55px rgba(15, 34, 64, 0.14);
    --shadow-glow: 0 0 20px var(--primary-glow);
    --board-bg: #e8eef7;
    --board-border: rgba(2, 132, 199, 0.18);
    --board-active-border: #0284c7;
    --cell-bg: #f8fafd;
    --cell-hover-bg: rgba(2, 132, 199, 0.07);
    --cell-last-border: rgba(2, 132, 199, 0.5);
    --modal-bg: rgba(15, 34, 64, 0.45);
    --toast-bg: rgba(255, 255, 255, 0.98);
  }

  /* ─────────────────────────────────────────
	   GLOBAL RESET
	   ───────────────────────────────────────── */
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  :global(html) {
    scroll-behavior: smooth;
    height: 100%;
    overflow: hidden;
  }
  :global(body) {
    font-family: var(--font-body);
    background: var(--bg);
    color: var(--text);
    height: 100%;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  :global(::selection) {
    background: var(--primary);
    color: var(--bg);
  }
  :global(::-webkit-scrollbar) {
    width: 4px;
  }
  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--border-bright);
    border-radius: 4px;
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--primary);
  }

  svg {
    display: block;
    max-width: 100%;
  }

  input, button, textarea, select {
    font-family: inherit;
  }

  /* ─────────────────────────────────────────
	   APP SHELL
	   ───────────────────────────────────────── */
  .app {
    position: relative;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }

  /* Ambient background */
  .ambient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }
  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.45;
    animation: drift 18s ease-in-out infinite alternate;
  }
  :global(body[data-theme="light"]) .orb {
    opacity: 0.22;
    filter: blur(100px);
  }
  .orb-1 {
    width: 500px;
    height: 500px;
    background: radial-gradient(
      circle,
      rgba(56, 189, 248, 0.3),
      transparent 70%
    );
    top: -150px;
    left: -100px;
    animation-duration: 22s;
  }
  .orb-2 {
    width: 400px;
    height: 400px;
    background: radial-gradient(
      circle,
      rgba(251, 146, 60, 0.2),
      transparent 70%
    );
    bottom: -100px;
    right: -80px;
    animation-duration: 28s;
    animation-delay: -8s;
  }
  .orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(
      circle,
      rgba(74, 222, 128, 0.15),
      transparent 70%
    );
    top: 50%;
    right: 25%;
    animation-duration: 20s;
    animation-delay: -14s;
  }
  .grid-pattern {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
        rgba(56, 189, 248, 0.04) 1px,
        transparent 1px
      ),
      linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
    background-size: 48px 48px;
  }
  :global(body[data-theme="light"]) .grid-pattern {
    background-image: linear-gradient(
        rgba(2, 132, 199, 0.04) 1px,
        transparent 1px
      ),
      linear-gradient(90deg, rgba(2, 132, 199, 0.04) 1px, transparent 1px);
  }
  @keyframes drift {
    0% {
      transform: translate(0, 0) scale(1);
    }
    100% {
      transform: translate(30px, 20px) scale(1.08);
    }
  }

  /* ─────────────────────────────────────────
	   TOPBAR
	   ───────────────────────────────────────── */
  .topbar {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1.5rem;
    height: 60px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(20px);
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .brand-mark {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--primary-dim);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-md);
    padding: 5px 9px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    box-shadow: var(--shadow-glow);
  }
  .brand-x {
    color: var(--x-color);
  }
  .brand-o {
    color: var(--o-color);
    margin-left: 3px;
  }
  .brand-text {
    min-width: 0;
  }
  h1 {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-bright);
    letter-spacing: -0.01em;
    white-space: nowrap;
    line-height: 1.2;
  }
  h1 em {
    font-style: normal;
    color: var(--primary);
  }
  .tagline {
    font-size: 0.65rem;
    color: var(--text-dim);
    letter-spacing: 0.06em;
    white-space: nowrap;
    line-height: 1.2;
  }

  .topbar-center {
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-bright);
    transition: all 0.3s var(--ease-out);
    box-shadow: var(--shadow-sm);
  }
  .status-pill.winner {
    background: rgba(74, 222, 128, 0.12);
    border-color: var(--win-color);
    color: var(--win-color);
    box-shadow: 0 0 20px var(--win-glow);
    animation: pulse-win 1s ease-in-out infinite alternate;
  }
  @keyframes pulse-win {
    from {
      box-shadow: 0 0 12px var(--win-glow);
    }
    to {
      box-shadow:
        0 0 28px var(--win-glow),
        0 0 8px var(--win-glow);
    }
  }

  .pip {
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1;
  }
  .pip-x {
    color: var(--x-color);
  }
  .pip-o {
    color: var(--o-color);
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .icon-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    font-size: 0.9rem;
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: var(--surface-hover);
    border-color: var(--border-bright);
    color: var(--text-bright);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }
  .icon-btn.active {
    background: var(--primary-dim);
    border-color: var(--primary);
    color: var(--primary);
    box-shadow: 0 0 12px var(--primary-glow);
  }

  /* ─────────────────────────────────────────
	   MAIN MENU OVERLAY
	   ───────────────────────────────────────── */
  .menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 25;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: radial-gradient(
        circle at top,
        rgba(8, 15, 25, 0.8),
        rgba(4, 8, 14, 0.92)
      ),
      rgba(4, 8, 14, 0.9);
    backdrop-filter: blur(10px);
  }
  :global(body[data-theme="light"]) .menu-overlay {
    background: radial-gradient(
        circle at top,
        rgba(240, 244, 249, 0.8),
        rgba(220, 232, 246, 0.95)
      ),
      rgba(240, 244, 249, 0.95);
  }
  .menu-shell {
    width: min(980px, 100%);
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-xl);
    padding: 28px;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .menu-header {
    text-align: center;
  }
  .menu-eyebrow {
    font-size: 0.7rem;
    letter-spacing: 0.3em;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .menu-header h2 {
    font-family: var(--font-display);
    font-size: 3.5rem;
    color: var(--text-bright);
    margin-top: 6px;
  }
  .menu-subtitle {
    color: var(--text-dim);
    font-size: 0.9rem;
    margin-top: 4px;
  }
  .menu-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }
  .menu-card {
    height: 150px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 0.95rem;
    color: var(--text-bright);
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    text-align: center;
    padding: 10px;
  }
  .menu-card i {
    font-size: 1.4rem;
    color: var(--primary);
  }
  .menu-card span {
    font-family: var(--font-display);
    font-size: 0.85rem;
    line-height: 1.2;
  }
  .menu-card:hover {
    transform: translateY(-4px);
    border-color: var(--border-bright);
    box-shadow: var(--shadow-sm);
    background: var(--surface-hover);
  }
  .menu-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }
  .menu-social {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .menu-social .menu-panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .btn-primary.highlight {
    box-shadow:
      0 0 20px var(--primary-glow),
      0 0 40px var(--primary-glow);
  }
  .menu-panel {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .menu-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .menu-panel h3 {
    color: var(--text-bright);
    font-size: 1rem;
  }
  .profile-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
  }
  .profile-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .profile-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile-stats {
    display: flex;
    gap: 20px;
    font-size: 1rem;
    color: var(--text);
  }
  .profile-recent {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .profile-recent h4 {
    font-size: 1rem;
    color: var(--text-bright);
  }
  .recent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text);
  }
  .rank-badge {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-bright);
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.2);
  }
  .rank-badge i {
    color: var(--rank-color, var(--primary));
  }
  .leaderboard {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .leaderboard-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text);
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .leaderboard-row:last-child {
    border-bottom: none;
  }
  .leader-name {
    flex: 1;
    margin-left: 8px;
  }
  .leader-rating {
    font-weight: 700;
    color: var(--text-bright);
  }

  .menu-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(4, 8, 14, 0.7);
    backdrop-filter: blur(6px);
    padding: 20px;
  }
  .menu-modal {
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: min(420px, 100%);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-lg);
  }
  .menu-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .rules-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.9rem;
    color: var(--text);
    padding-left: 18px;
  }

  /* ─────────────────────────────────────────
	   LAYOUT
	   ───────────────────────────────────────── */
  .layout {
    position: relative;
    z-index: 1;
    flex: 1;
    display: block;
    overflow: hidden;
    min-height: 0;
  }

  .layout.sidebar-open .board-zone {
    padding-right: 380px;
  }

  .sidebar-scrim {
    position: absolute;
    inset: 0;
    background: rgba(4, 8, 14, 0.55);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 2;
  }
  :global(body[data-theme="light"]) .sidebar-scrim {
    background: rgba(15, 34, 64, 0.2);
  }
  .sidebar-scrim.show {
    opacity: 1;
    pointer-events: auto;
  }
  @media (min-width: 1100px) {
    .sidebar-scrim {
      display: none;
    }
  }

  /* ─────────────────────────────────────────
	   BOARD ZONE (LEFT)
	   ───────────────────────────────────────── */
  .board-zone {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px 14px 20px;
    overflow: hidden;
    min-height: 0;
    position: relative;
    align-items: center;
    --turn-color: var(--primary);
    --turn-glow: var(--primary-glow);
  }
  .board-zone[data-turn="X"] {
    --turn-color: var(--x-color);
    --turn-glow: var(--x-glow);
  }
  .board-zone[data-turn="O"] {
    --turn-color: var(--o-color);
    --turn-glow: var(--o-glow);
  }

  .board-actions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: min(960px, 100%);
    flex-shrink: 0;
  }

  /* Stat Bar */
  .stat-bar {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
    width: min(960px, 100%);
  }
  .stat-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    flex: 1;
    min-width: 0;
    transition: background 0.2s ease;
  }
  .stat-divider {
    width: 1px;
    height: 36px;
    background: var(--border);
    flex-shrink: 0;
  }
  .stat-icon {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    flex-shrink: 0;
    font-size: 0.9rem;
    color: var(--text-dim);
  }
  .target-icon {
    color: var(--primary);
    background: var(--primary-dim);
    border-color: var(--border-bright);
  }
  .net-icon {
    color: var(--win-color);
    background: rgba(74, 222, 128, 0.1);
    border-color: rgba(74, 222, 128, 0.2);
  }
  .big-pip {
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1;
  }
  .stat-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .stat-label {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    line-height: 1;
  }
  .stat-value {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text-bright);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .stat-sub {
    font-size: 0.62rem;
    color: var(--text-dim);
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Timer ring */
  .timer-card.urgent .timer-ring .ring-fill {
    stroke: var(--x-color);
  }
  .timer-card.urgent .stat-value {
    color: var(--x-color);
  }
  .timer-ring {
    position: relative;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
  }
  .timer-ring svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .ring-track {
    stroke: var(--border);
  }
  .ring-fill {
    stroke: var(--primary);
    transition: stroke-dashoffset 0.4s ease;
  }
  .timer-num {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--text-bright);
  }

  /* ─────────────────────────────────────────
	   ULTIMATE BOARD
	   ───────────────────────────────────────── */
  .ultimate-board {
    background: var(--board-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 10px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    outline: none;
    box-shadow: var(--shadow-md);
    max-height: 80vh;
    width: min(78vh, 960px);
    flex: 1;
    min-height: 0;
    transition: box-shadow 0.3s ease;
  }
  .ultimate-board:focus-visible {
    box-shadow:
      0 0 0 2px var(--primary),
      var(--shadow-md);
  }

  .local-board {
    background: var(--bg-3);
    border: 1.5px solid var(--board-border);
    border-radius: var(--radius-lg);
    padding: 6px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
    position: relative;
    transition:
      transform 0.25s var(--ease-spring),
      box-shadow 0.25s ease,
      border-color 0.25s ease,
      opacity 0.25s ease;
  }
  .local-board.active {
    border-color: var(--turn-color);
    box-shadow:
      0 0 0 1px var(--turn-color),
      0 0 20px var(--turn-glow);
    transform: translateY(-2px) scale(1.008);
    z-index: 2;
  }
  .local-board.inactive {
    opacity: 0.55;
    filter: saturate(0.5);
  }
  :global(body[data-theme="light"]) .local-board {
    background: var(--bg-2);
  }
  :global(body[data-theme="light"]) .local-board.inactive {
    opacity: 0.5;
  }

  .board-claim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: calc(var(--radius-lg) - 1px);
    pointer-events: none;
    z-index: 3;
    backdrop-filter: blur(2px);
    animation: claimIn 0.4s var(--ease-spring) both;
  }

  .win-line {
    position: absolute;
    left: 10%;
    right: 10%;
    top: 50%;
    height: 4px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 16px currentColor;
    z-index: 4;
    pointer-events: none;
    transform-origin: left center;
    transform: var(--line-start, scaleX(0));
    animation: line-draw 0.45s ease forwards;
  }
  .win-line.line-x {
    color: var(--x-color);
  }
  .win-line.line-o {
    color: var(--o-color);
  }
  .win-line.row-0 {
    top: 17%;
    --line-start: scaleX(0);
    --line-end: scaleX(1);
  }
  .win-line.row-1 {
    top: 50%;
    --line-start: scaleX(0);
    --line-end: scaleX(1);
  }
  .win-line.row-2 {
    top: 83%;
    --line-start: scaleX(0);
    --line-end: scaleX(1);
  }
  .win-line.col-0,
  .win-line.col-1,
  .win-line.col-2 {
    top: 10%;
    bottom: 10%;
    width: 4px;
    height: auto;
    left: 17%;
    right: auto;
    transform-origin: center top;
    --line-start: scaleY(0);
    --line-end: scaleY(1);
  }
  .win-line.col-1 {
    left: 50%;
  }
  .win-line.col-2 {
    left: 83%;
  }
  .win-line.diag-1,
  .win-line.diag-2 {
    width: 140%;
    left: -20%;
    top: 50%;
    transform-origin: center;
  }
  .win-line.diag-1 {
    --line-start: rotate(45deg) scaleX(0);
    --line-end: rotate(45deg) scaleX(1);
  }
  .win-line.diag-2 {
    --line-start: rotate(-45deg) scaleX(0);
    --line-end: rotate(-45deg) scaleX(1);
  }
  @keyframes line-draw {
    to {
      transform: var(--line-end, scaleX(1));
    }
  }
  .claim-x {
    background: rgba(251, 146, 60, 0.15);
    border: 2px solid var(--x-color);
  }
  .claim-o {
    background: rgba(56, 189, 248, 0.15);
    border: 2px solid var(--o-color);
  }
  .claim-draw {
    background: rgba(255, 255, 255, 0.06);
    border: 2px solid rgba(255, 255, 255, 0.2);
  }
  :global(body[data-theme="light"]) .claim-draw {
    background: rgba(0, 0, 0, 0.04);
    border-color: rgba(0, 0, 0, 0.15);
  }
  .claim-symbol {
    font-size: 2.4rem;
    font-weight: 900;
    line-height: 1;
    filter: drop-shadow(0 2px 8px currentColor);
  }
  .claim-x .claim-symbol {
    color: var(--x-color);
  }
  .claim-o .claim-symbol {
    color: var(--o-color);
  }
  .claim-draw i {
    font-size: 1.6rem;
    color: var(--text-dim);
  }
  @keyframes claimIn {
    from {
      opacity: 0;
      transform: scale(0.7);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* CELLS */
  .cell {
    aspect-ratio: 1;
    background: var(--cell-bg);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition:
      background 0.15s ease,
      transform 0.15s var(--ease-spring),
      box-shadow 0.15s ease,
      border-color 0.15s ease;
    overflow: hidden;
  }
  :global(body[data-theme="light"]) .cell {
    background: var(--cell-bg);
    border-color: var(--border);
  }
  .cell.legal:hover {
    background: var(--cell-hover-bg);
    border-color: var(--turn-color);
    box-shadow: 0 0 12px var(--turn-glow);
    transform: scale(1.06);
    z-index: 1;
  }
  .cell.illegal {
    cursor: default;
    border: 1px solid var(--border);
  }
  .cell.last {
    border-color: var(--cell-last-border);
    box-shadow: 0 0 8px var(--primary-glow);
  }
  .cell.kbd {
    border-color: var(--turn-color);
    box-shadow: 0 0 0 2px var(--turn-color);
  }
  .cell:disabled {
    cursor: not-allowed;
  }
  .cell.cell-x {
    animation: pop-in 0.28s var(--ease-in-out) both;
  }
  .cell.cell-o {
    animation: pop-in 0.28s var(--ease-in-out) both;
  }

  .mark-icon {
    font-size: 1.3rem;
    line-height: 1;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .mark-icon.mini {
    font-size: 0.95rem;
  }
  .mark-icon.x,
  .mark-x {
    color: var(--x-color);
    text-shadow: 0 0 10px var(--x-glow);
  }
  .mark-icon.o,
  .mark-o {
    color: var(--o-color);
    text-shadow: 0 0 10px var(--o-glow);
  }
  .ghost-mark {
    opacity: 0.35;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Win modal */
  .win-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 8, 14, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
    padding: 20px;
  }
  :global(body[data-theme="light"]) .win-backdrop {
    background: rgba(15, 34, 64, 0.35);
  }
  .win-modal {
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-xl);
    padding: 26px;
    min-width: min(420px, 92vw);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
    animation: modal-rise 0.3s var(--ease-out) both;
  }
  .win-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto;
    font-size: 1.6rem;
  }
  .win-modal h2 {
    font-size: 1.2rem;
    color: var(--text-bright);
  }
  .win-sub {
    font-size: 0.85rem;
    color: var(--text-dim);
  }
  .win-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  @keyframes modal-rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes pop-in {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
    60% {
      transform: scale(1.15);
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* ─────────────────────────────────────────
	   CONTROL BAR
	   ───────────────────────────────────────── */
  .control-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  /* Buttons */
  .btn-primary,
  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 16px 30px;
    border-radius: var(--radius-md);
    font-family: var(--font-body);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.2s var(--ease-out);
    white-space: normal;
    line-height: 1.2;
    flex-shrink: 0;
  }
  .btn-sm {
    padding: 6px 10px;
    font-size: 0.7rem;
  }
  .btn-primary {
    background: var(--primary);
    color: var(--on-primary);
    border-color: transparent;
    box-shadow: 0 0 16px var(--primary-glow);
  }
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow:
      0 0 24px var(--primary-glow),
      0 4px 12px rgba(0, 0, 0, 0.2);
    filter: brightness(1.08);
  }
  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
    filter: none;
  }
  .btn-ghost {
    background: var(--surface-2);
    color: var(--text);
    border-color: var(--border);
  }
  .btn-ghost:hover {
    background: var(--surface-hover);
    border-color: var(--border-bright);
    color: var(--text-bright);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }
  .btn-ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
  .btn-ghost.btn-icon-only {
    padding: 20px;
    flex-shrink: 0;
  }
  .btn-sm {
    padding: 10px 14px;
    font-size: .85rem;
  }

  /* ─────────────────────────────────────────
	   TIMELINE
	   ───────────────────────────────────────── */
  .timeline-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: var(--shadow-sm);
  }
  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .panel-header i {
    font-size: 0.75rem;
    color: var(--primary);
  }
  .badge {
    margin-left: auto;
    background: var(--primary-dim);
    border: 1px solid var(--border-bright);
    color: var(--primary);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
  }
  .timeline-scroll {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    max-height: 180px;
    align-items: stretch;
  }
  .t-item {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: 0.72rem;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color 0.2s;
  }
  .t-item:last-child {
    border-color: var(--border-bright);
    box-shadow: 0 0 6px var(--primary-glow);
  }
  .t-num {
    color: var(--text-dim);
  }
  .t-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .t-x {
    color: var(--x-color);
  }
  .t-o {
    color: var(--o-color);
  }
  .t-loc {
    color: var(--text-dim);
  }
  .t-empty {
    font-size: 0.75rem;
    color: var(--text-dim);
    padding: 4px 0;
  }

  /* ─────────────────────────────────────────
	   SIDE PANEL (RIGHT)
	   ───────────────────────────────────────── */
  .side-panel {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 360px;
    border-left: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    transform: translateX(100%);
    transition: transform 0.3s var(--ease-out);
    z-index: 3;
    backdrop-filter: blur(18px);
    box-shadow: var(--shadow-lg);
  }
  .side-panel.open {
    transform: translateX(0);
  }

  /* Mode Tabs */
  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 8px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    border-radius: 0;
    font-family: var(--font-body);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }
  .tab:last-child {
    border-right: none;
  }
  .tab i {
    font-size: 0.8rem;
  }
  .tab:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .tab.tab-active {
    background: var(--primary-dim);
    color: var(--primary);
    box-shadow: inset 0 -2px 0 var(--primary);
  }

  /* Panel cards */
  .panel {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .panel .panel-header {
    border-bottom: 1px solid var(--border);
  }
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }

  /* Fields */
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-dim);
    font-family: var(--font-display);
  }
  .field label i,
  .field label .mark-icon {
    font-size: 0.75rem;
  }
  .field-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .flex-input {
    padding: 16px 24px;
    font-size: 16px;
    font-family: var(--font-body);
    flex: 1;
    min-width: 0;
  }

  input,
  select,
  textarea {
    width: 100%;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 7px 10px;
    font-family: var(--font-body);
    font-size: 0.8rem;
    color: var(--text-bright);
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
    outline: none;
  }
  :global(body[data-theme="light"]) input,
  :global(body[data-theme="light"]) select,
  :global(body[data-theme="light"]) textarea {
    background: var(--bg-2);
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-dim);
  }
  textarea {
    resize: vertical;
    min-height: 60px;
  }
  select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 16px;
    padding-right: 30px;
  }

  /* Panel content */
  .panel-accent {
    background: var(--surface-2);
  }
  .info-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.8rem;
    color: var(--text);
    flex-wrap: wrap;
  }
  .info-row i {
    font-size: 0.78rem;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .dim {
    color: var(--text-dim);
    font-size: 1rem;
  }

  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-dim);
    margin-left: auto;
    flex-shrink: 0;
  }
  .conn-dot.conn-on {
    background: var(--win-color);
    box-shadow: 0 0 6px var(--win-glow);
    animation: blink 2s ease-in-out infinite;
  }
  .conn-dot.conn-mid {
    background: var(--x-color);
    animation: blink 0.7s ease-in-out infinite;
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .match-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 8px 12px;
  }
  .match-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text);
  }
  .match-row i {
    color: var(--text-dim);
    font-size: 0.75rem;
  }
  .match-row strong {
    color: var(--text-bright);
  }

  .draw-offer {
    background: rgba(251, 146, 60, 0.08);
    border: 1px solid rgba(251, 146, 60, 0.25);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .draw-offer p {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.82rem;
    color: var(--x-color);
    font-weight: 600;
  }

  /* Scoreboard */
  .score-body {
    gap: 0;
    padding: 0;
  }
  .score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    gap: 8px;
    transition: background 0.15s;
  }
  .score-row:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }
  .score-row:hover {
    background: var(--surface-2);
  }
  .score-player {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--text);
    min-width: 0;
  }
  .score-player i {
    color: var(--text-dim);
    font-size: 0.8rem;
  }
  .score-player .mark-icon {
    font-size: 0.9rem;
  }
  .score-num {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--text-bright);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .score-x {
    color: var(--x-color);
  }
  .score-o {
    color: var(--o-color);
  }
  .score-d {
    color: var(--text-dim);
  }
  .rank-num {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-weight: 700;
    min-width: 20px;
  }
  .score-divider {
    /* handled by border-bottom on .score-row */
  }

  /* History */
  .history-body {
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
  }
  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }
  .history-item:hover {
    background: var(--surface-2);
  }
  .history-item:last-child {
    border-bottom: none;
  }
  .history-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .mode-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--primary-dim);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
    width: fit-content;
  }
  .mode-chip i {
    font-size: 0.6rem;
  }
  .history-date {
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  /* ─────────────────────────────────────────
	   REPLAY MODAL
	   ───────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--modal-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 100;
    backdrop-filter: blur(8px);
    animation: fade-in 0.2s ease both;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    width: min(560px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: slide-up 0.3s var(--ease-spring) both;
  }
  .modal-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .modal-header h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-bright);
  }
  .modal-header h2 i {
    color: var(--primary);
    font-size: 0.9rem;
  }
  .modal-header .btn-ghost {
    margin-left: auto;
  }

  .replay-board {
    padding: 8px;
    gap: 6px;
    box-shadow: var(--shadow-sm);
  }
  .replay-board .local-board {
    padding: 4px;
    gap: 3px;
  }
  .replay-cell {
    background: var(--surface-2);
    border-radius: 4px;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
  }
  .replay-cell .mark-icon {
    font-size: 0.9rem;
  }

  .replay-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }

  .replay-progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .progress-bar {
    height: 4px;
    background: var(--border);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--primary);
    border-radius: var(--radius-pill);
    transition: width 0.3s ease;
    box-shadow: 0 0 8px var(--primary-glow);
  }
  .progress-label {
    font-size: 0.72rem;
    color: var(--text-dim);
    text-align: center;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ─────────────────────────────────────────
	   TOASTS
	   ───────────────────────────────────────── */
  .toast-zone {
    position: fixed;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: var(--toast-bg);
    border: 1px solid var(--border-bright);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-bright);
    animation: toast-in 0.3s var(--ease-spring) both;
    max-width: 280px;
  }
  .toast i {
    font-size: 0.85rem;
    flex-shrink: 0;
    color: var(--primary);
  }
  .toast.toast-error {
    border-left: 3px solid var(--x-color);
  }
  .toast.toast-error i {
    color: var(--x-color);
  }
  .toast.toast-success {
    border-left: 3px solid var(--win-color);
  }
  .toast.toast-success i {
    color: var(--win-color);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  /* ─────────────────────────────────────────
	   RESPONSIVE
	   ───────────────────────────────────────── */
  @media (max-width: 860px) {
    .layout.sidebar-open .board-zone {
      padding-right: 16px;
    }
    .side-panel {
      width: min(92vw, 360px);
      border-left: none;
      box-shadow: var(--shadow-md);
    }
    .ultimate-board,
    .stat-bar {
      width: 100%;
      max-width: 100%;
    }
    .board-actions {
      width: 100%;
    }
    .menu-shell {
      padding: 20px;
    }
  }
  @media (max-width: 560px) {
    .topbar {
      padding: 0 12px;
      height: 54px;
    }
    .topbar-center {
      display: none;
    }
    .board-zone {
      padding: 10px 12px;
      gap: 8px;
    }
    h1 {
      font-size: 0.9rem;
    }
    .stat-bar {
      gap: 0;
    }
    .stat-card {
      padding: 8px 10px;
    }
    .stat-label {
      display: none;
    }
    .menu-cards {
      grid-template-columns: repeat(2, minmax(120px, 1fr));
    }
    .menu-card {
      height: 120px;
    }
    .mode-tabs {
      grid-template-columns: repeat(2, 1fr);
    }
    .board-actions {
      flex-wrap: wrap;
      justify-content: center;
    }
    .board-actions .btn-primary,
    .board-actions .btn-ghost {
      flex: 1 1 140px;
    }
    .ultimate-board {
      padding: 7px;
      gap: 6px;
    }
    .local-board {
      padding: 4px;
      gap: 3px;
    }
  }
</style>
