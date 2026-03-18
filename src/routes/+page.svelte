<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { flip } from "svelte/animate";
  import { io } from "socket.io-client";
  import {
    collection,
    doc,
    getDoc,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
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
  import {
    AlertTriangle,
    Bot,
    Check,
    ChevronRight,
    Clock,
    Copy,
    Crown,
    DoorOpen,
    Download,
    Eye,
    FastForward,
    Flag,
    Handshake,
    Info,
    Loader2,
    LogIn,
    LogOut,
    Menu,
    Moon,
    Pause,
    Play,
    Puzzle,
    Repeat,
    Rewind,
    RotateCcw,
    RotateCw,
    Settings,
    Share2,
    SkipBack,
    SkipForward,
    Sparkles,
    Star,
    Sun,
    Swords,
    Timer,
    Trophy,
    Upload,
    User,
    UserPlus,
    Users,
    Volume2,
    VolumeX,
    Wifi,
    WifiOff,
    X,
    Zap,
  } from "lucide-svelte";
  import { db } from "$lib/firebase.js";
  import {
    signInEmail,
    signInGoogle,
    signOutUser,
    signUpEmail,
    subscribeAuth,
  } from "$lib/auth.js";
  import { getRankFromRating, RANK_TIERS } from "$lib/ranking.js";

  const BOT_NAME = "Atlas";
  const STORAGE_KEY = "uttt-settings-v1";
  const HISTORY_KEY = "uttt-history-v1";
  const SCORE_KEY = "uttt-scoreboard-v1";
  const TOKEN_KEY = "uttt-token-v1";
  const SAVED_GAME_KEY = "uttt-saved-game-v1";
  const MODE_KEY = "uttt-mode-v1";
  const LAST_LOCAL_MODE_KEY = "uttt-last-local-mode-v1";
  const ADAPTIVE_KEY = "uttt-adaptive-v1";
  const PUZZLE_KEY = "uttt-puzzles-v1";
  const ACHIEVEMENTS_KEY = "uttt-achievements-v1";
  const SEASON_KEY = "uttt-season-v1";
  const QUICK_REACTIONS = ["👍", "🔥", "😅", "🤔", "😤", "🎯", "👀", "gg"];

  let mode = $state("local");
  let screen = $state("menu");
  let menuOpen = $state(true);
  let menuPanel = $state("main");
  let theme = $state("dark");
  let soundEnabled = $state(true);
  let botDifficulty = $state("medium");
  let turnTimeMs = $state(25000);
  let timerMode = $state("shared");
  let chessClockMs = $state(300000);
  let timerPosition = $state("bottom");
  let playerNames = $state({ X: "Player 1", O: "Player 2" });
  let myName = $state("Player");
  // svelte-ignore state_referenced_locally
  let localState = $state(createState({ players: playerNames, turnTimeMs }));
  let multiplayerPlaceholder = $state(
    // svelte-ignore state_referenced_locally
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
  let playerBanks = $state({ X: 300, O: 300 });
  let bankFlash = $state(null);
  let past = $state([]);
  let future = $state([]);
  let replay = $state({ open: false, match: null, index: 0, playing: false });
  let exportText = $state("");
  let socialCode = $state("");
  let hoverCell = $state(null);
  let kbdIndex = $state(40);
  let sidebarOpen = $state(false);
  let panelSections = $state({
    actions: true,
    moves: true,
    settings: true,
    bot: true,
    puzzles: true,
    social: true,
    competitive: true,
    leaderboard: true,
    score: true,
    history: true,
    annotations: true,
    chat: true,
    state: true,
    tournament: true,
  });
  let rulesOpen = $state(false);
  let authModal = $state({ open: false, mode: "signin" });
  let authForm = $state({ email: "", password: "", displayName: "" });
  let authUser = $state(null);
  let profile = $state(null);
  let leaderboard = $state([]);
  let pendingCompetitiveStart = $state(false);
  let lastMode = $state(null);
  let lastLocalMode = $state("local");
  let hydrated = $state(false);
  let botThinking = false;
  let socket = null;
  let replayTimer = null;
  let analysisTimer = null;
  let lastWinner = $state(null);
  let winModal = $state({ open: false, winner: null, reason: null });
  let boardEl = $state(null);
  let pressedCell = $state(null);
  let ripplesTick = $state(0);
  let menuModePreview = $state("local");
  let settingsDirty = $state(false);
  let settingsSaved = $state(false);
  let lastSettingsSnapshot = $state(null);
  let adaptiveHistory = $state([]);
  let adaptiveRate = $state(0.5);
  let adaptivePulse = $state(false);
  let lastAdaptiveDifficulty = $state("medium");
  let puzzleIndex = $state(0);
  let solvedPuzzles = $state([]);
  let earnedAchievements = $state([]);
  let annotationMode = $state(false);
  let analysisMode = $state(false);
  let annotationColor = $state("red");
  let annotationTick = $state(0);
  let annotationOpacity = $state(0.8);
  let showHeatmap = $state(false);
  let heatmap = $state(null);
  let analysisScores = $state({});
  let analysisLoading = $state(false);
  let chatMessages = $state([]);
  let chatInput = $state("");
  let chatUnread = $state(0);
  let friends = $state([]);
  let friendInput = $state("");
  let shareCopied = $state(false);
  let shareQrOpen = $state(false);
  let shareUrl = $state("");
  let sharedViewOnly = $state(false);
  let puzzleConfetti = $state([]);
  let spotlightBoard = $state(null);
  let boardTheme = $state("default");
  let themeFlash = $state(false);
  let highContrast = $state(false);
  let seasonData = $state({
    season: 1,
    endsAt: 0,
    trophies: [],
    startRating: 1000,
  });
  let showInstallPrompt = $state(false);
  let lastSyncAt = $state(0);
  let syncingStats = $state(false);
  let tournament = $state({
    active: false,
    status: "lobby",
    players: ["Player 1", "Player 2", "Player 3", "Player 4"],
    bracket: [],
    currentMatch: 0,
    champion: null,
  });
  let savedGamePrompt = $state(null);
  let statsUpdatedAt = $state(0);
  let lastFocusElement = null;
  let leaderboardUnsub = null;
  let saveTimer = null;
  let statsSyncTimer = null;
  let nowRaf = null;
  let nowLastTick = 0;
  let audioCtx = null;
  let deferredPrompt = null;
  let hintCell = $state(null);
  let spotlightTimer = null;
  let hintTimer = null;
  let puzzleStartAt = 0;
  const rippleMap = new Map();
  const annotationMap = new Map();

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

  const BOARD_THEMES = {
    default: {
      "--x-col": "hsl(34, 96%, 60%)",
      "--o-col": "hsl(204, 92%, 62%)",
      "--brand": "#4db8ff",
      "--board-bg": "#08101e",
      "--cell-bg": "#0d1a2b",
      "--bg-base": "#070d18",
    },
    neon: {
      "--x-col": "hsl(300, 92%, 62%)",
      "--o-col": "hsl(170, 90%, 56%)",
      "--brand": "#7f5bff",
      "--board-bg": "#0b0f1f",
      "--cell-bg": "#11162c",
      "--bg-base": "#070811",
    },
    pastel: {
      "--x-col": "hsl(24, 86%, 62%)",
      "--o-col": "hsl(192, 74%, 58%)",
      "--brand": "#6aa9ff",
      "--board-bg": "#eef2f8",
      "--cell-bg": "#f7f9fc",
      "--bg-base": "#e8eef6",
    },
    mono: {
      "--x-col": "hsl(0, 0%, 92%)",
      "--o-col": "hsl(0, 0%, 70%)",
      "--brand": "#e2e8f0",
      "--board-bg": "#0f172a",
      "--cell-bg": "#111827",
      "--bg-base": "#0b1222",
    },
    forest: {
      "--x-col": "hsl(120, 60%, 52%)",
      "--o-col": "hsl(44, 78%, 58%)",
      "--brand": "#2fb78b",
      "--board-bg": "#0b1a17",
      "--cell-bg": "#102723",
      "--bg-base": "#061412",
    },
  };

  const MODE_DEFS = [
    {
      id: "local",
      label: "Local",
      desc: "Two players, one screen",
      icon: Play,
      accent: "var(--brand)",
      glow: "var(--brand-glow)",
    },
    {
      id: "bot",
      label: "vs Atlas",
      desc: "Challenge the AI bot",
      icon: Bot,
      accent: "hsl(38, 90%, 60%)",
      glow: "hsla(38, 90%, 60%, 0.35)",
    },
    {
      id: "social",
      label: "Social",
      desc: "Play with friends online",
      icon: Users,
      accent: "hsl(172, 70%, 50%)",
      glow: "hsla(172, 70%, 50%, 0.35)",
    },
    {
      id: "competitive",
      label: "Ranked",
      desc: "Compete for rating",
      icon: Crown,
      accent: "hsl(45, 90%, 55%)",
      glow: "hsla(45, 90%, 55%, 0.35)",
    },
    {
      id: "puzzle",
      label: "Puzzles",
      desc: "Solve curated challenges",
      icon: Puzzle,
      accent: "hsl(268, 80%, 65%)",
      glow: "hsla(268, 80%, 65%, 0.35)",
    },
    {
      id: "tournament",
      label: "Tournament",
      desc: "4-player bracket",
      icon: Swords,
      accent: "hsl(14, 85%, 60%)",
      glow: "hsla(14, 85%, 60%, 0.35)",
    },
  ];

  const ACHIEVEMENT_ICONS = {
    crown: Crown,
    star: Star,
    trophy: Trophy,
    zap: Zap,
    flag: Flag,
    sparkles: Sparkles,
  };

  let effectiveNames = $derived.by(() =>
    mode === "bot" ? { ...playerNames, O: BOT_NAME } : { ...playerNames },
  );
  let displayNames = $derived.by(() => currentState?.players ?? effectiveNames);
  let currentState = $derived.by(() => {
    if (mode === "social" || mode === "competitive") {
      return onlineRoom?.state ?? multiplayerPlaceholder;
    }
    return localState;
  });
  let isOnline = $derived.by(() => mode === "social" || mode === "competitive");
  let legalBoards = $derived.by(() => getLegalBoards(currentState));
  let timeLeft = $derived.by(() => {
    if (timerMode === "chess" && !isOnline) {
      const bank = playerBanks[currentState.currentPlayer] ?? 0;
      return Math.max(0, Math.ceil(bank));
    }
    return Math.max(0, Math.ceil((currentState.turnEndsAt - now) / 1000));
  });
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
    const total =
      timerMode === "chess" && !isOnline
        ? chessClockMs / 1000
        : currentState.turnTimeMs / 1000;
    return total > 0 ? (timeLeft / total) * 100 : 0;
  });
  let timerGradient = $derived.by(() => {
    if (timerPct > 60) return `linear-gradient(90deg, var(--win-col), var(--brand))`;
    if (timerPct > 30) return `linear-gradient(90deg, var(--warning), var(--brand))`;
    return `linear-gradient(90deg, var(--err-col), hsl(0, 90%, 45%))`;
  });
  let timerLabelText = $derived.by(() =>
    timerMode === "chess" && !isOnline ? formatTime(timeLeft) : `${timeLeft}s`,
  );
  let timerRingColor = $derived.by(() => {
    if (timerPct > 60) return "var(--win-col)";
    if (timerPct > 30) return "var(--warning)";
    return "var(--err-col)";
  });
  let hasUnfinishedMatch = $derived.by(() => {
    const localUnfinished = localState?.moves?.length > 0 && !localState.winner;
    const onlineUnfinished =
      onlineRoom?.state?.moves?.length > 0 && !onlineRoom.state.winner;
    return !!(localUnfinished || onlineUnfinished);
  });
  let effectiveBotDifficulty = $derived.by(() => {
    if (adaptiveRate < 0.3) return "easy";
    if (adaptiveRate <= 0.5) return "medium";
    if (adaptiveRate <= 0.75) return "hard";
    return "master";
  });
  let undoGhostMove = $derived.by(() => (mode === "local" ? future[0] : null));
  let multiplayerBanner = $derived.by(() => {
    if (mode !== "social" && mode !== "competitive") return null;
    if (spectator) return "SPECTATING";
    return currentState.currentPlayer === mySymbol ? "YOUR TURN" : "WAITING…";
  });
  let annotationAllowed = $derived.by(
    () => analysisMode || Boolean(currentState.winner),
  );
  let currentRank = $derived.by(() =>
    profile
      ? getRankFromRating(profile.rating ?? 1000)
      : getRankFromRating(1000),
  );
  let adaptivePct = $derived.by(() => Math.round(adaptiveRate * 100));
  let seasonDaysLeft = $derived.by(() => {
    if (!seasonData?.endsAt) return 0;
    const diff = seasonData.endsAt - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  });
  let syncState = $derived.by(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
    if (!lastSyncAt) return "stale";
    const diff = now - lastSyncAt;
    if (diff < 30000) return "fresh";
    if (diff < 120000) return "mid";
    return "stale";
  });

  function notify(message, tone = "info", options = {}) {
    const id = `${Date.now()}-${Math.random()}`;
    const {
      persistent = false,
      actions = [],
      duration = 3200,
      title = null,
      subtitle = null,
    } = options;
    toastList = [
      ...toastList,
      { id, message, tone, actions, persistent, duration, title, subtitle },
    ];
    if (!persistent) {
      setTimeout(() => {
        toastList = toastList.filter((toast) => toast.id !== id);
      }, duration);
    }
  }

  function dismissToast(id) {
    toastList = toastList.filter((toast) => toast.id !== id);
  }

  function ensureAudioContext() {
    if (audioCtx || typeof window === "undefined") return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }

  function playSound(type) {
    if (!soundEnabled || typeof window === "undefined") return;
    ensureAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = type === "win" ? 660 : type === "error" ? 160 : 320;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  }

  function saveSettings() {
    if (typeof localStorage === "undefined") return;
    const data = {
      theme,
      boardTheme,
      highContrast,
      soundEnabled,
      botDifficulty,
      turnTimeMs,
      timerMode,
      chessClockMs,
      timerPosition,
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
      boardTheme = parsed.boardTheme ?? boardTheme;
      highContrast = parsed.highContrast ?? highContrast;
      soundEnabled = parsed.soundEnabled ?? soundEnabled;
      botDifficulty = parsed.botDifficulty ?? botDifficulty;
      turnTimeMs = parsed.turnTimeMs ?? turnTimeMs;
      timerMode = parsed.timerMode ?? timerMode;
      chessClockMs = parsed.chessClockMs ?? chessClockMs;
      timerPosition = parsed.timerPosition ?? timerPosition;
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

  function loadSeason() {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(SEASON_KEY);
    const nowTime = Date.now();
    if (!raw) {
      seasonData = {
        season: 1,
        endsAt: nowTime + 1000 * 60 * 60 * 24 * 30,
        trophies: [],
        startRating: profile?.rating ?? 1000,
      };
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      seasonData = {
        season: parsed.season ?? 1,
        endsAt: parsed.endsAt ?? nowTime + 1000 * 60 * 60 * 24 * 30,
        trophies: Array.isArray(parsed.trophies) ? parsed.trophies : [],
        startRating: parsed.startRating ?? profile?.rating ?? 1000,
      };
    } catch {
      seasonData = {
        season: 1,
        endsAt: nowTime + 1000 * 60 * 60 * 24 * 30,
        trophies: [],
        startRating: profile?.rating ?? 1000,
      };
    }
  }

  function persistSeason() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SEASON_KEY, JSON.stringify(seasonData));
  }

  function maybeAdvanceSeason() {
    if (mode !== "competitive") return;
    const nowTime = Date.now();
    if (!seasonData.endsAt) return;
    if (nowTime < seasonData.endsAt) return;
    const trophies = [...(seasonData.trophies ?? []), currentRank.name];
    seasonData = {
      season: (seasonData.season ?? 1) + 1,
      endsAt: nowTime + 1000 * 60 * 60 * 24 * 30,
      trophies,
      startRating: profile?.rating ?? 1000,
    };
    persistSeason();
    notify("New Season!", "trophy");
  }

  function saveLocalGameNow() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      SAVED_GAME_KEY,
      serializeState(cloneState(localState)),
    );
  }

  function saveLocalGameDebounced() {
    if (typeof localStorage === "undefined") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveLocalGameNow();
    }, 400);
  }

  function loadLocalGame() {
    if (typeof localStorage === "undefined") return;
    const data = localStorage.getItem(SAVED_GAME_KEY);
    if (!data) return;
    try {
      const parsed = deserializeState(data);
      localState = parsed;
      sharedViewOnly = false;
    } catch {
      /* ignore */
    }
  }

  function resetLocalGame({ keepHistory = false } = {}) {
    localState = createState({ players: effectiveNames, turnTimeMs });
    sharedViewOnly = false;
    if (timerMode === "chess") {
      playerBanks = {
        X: Math.floor(chessClockMs / 1000),
        O: Math.floor(chessClockMs / 1000),
      };
    }
    if (!keepHistory) {
      past = [];
      future = [];
    }
    replay.playing = false;
    replay.index = 0;
    saveLocalGameNow();
  }

  function updatePlayerNames() {
    if (mode !== "tournament") {
      localState.players = { ...effectiveNames };
      localState.turnTimeMs = turnTimeMs;
      localState.updatedAt = Date.now();
    }
    multiplayerPlaceholder.players = { ...playerNames };
    multiplayerPlaceholder.turnTimeMs = turnTimeMs;
    multiplayerPlaceholder.updatedAt = Date.now();
  }

  function applySettings() {
    updatePlayerNames();
    saveSettings();
    lastSettingsSnapshot = JSON.stringify({
      playerNames,
      myName,
      botDifficulty,
      turnTimeMs,
      timerMode,
      chessClockMs,
      timerPosition,
      boardTheme,
      highContrast,
    });
    settingsDirty = false;
    settingsSaved = true;
    if (timerMode === "chess") {
      playerBanks = {
        X: Math.floor(chessClockMs / 1000),
        O: Math.floor(chessClockMs / 1000),
      };
    }
    saveLocalGameDebounced();
  }

  function getWinLineClass(winLine) {
    if (!winLine) return "";
    return WIN_LINE_MAP[winLine.join(",")] ?? "";
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(safe / 60)
      .toString()
      .padStart(2, "0");
    const ss = Math.floor(safe % 60)
      .toString()
      .padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function formatMs(ms) {
    if (typeof ms !== "number") return "";
    const sec = ms / 1000;
    return `${sec.toFixed(1)}s`;
  }

  function closeWinModal() {
    winModal = { ...winModal, open: false };
  }

  function setMode(nextMode) {
    mode = nextMode;
    if (typeof localStorage !== "undefined") {
      const persisted =
        nextMode === "social" || nextMode === "competitive"
          ? "local"
          : nextMode;
      localStorage.setItem(MODE_KEY, persisted);
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
    if (typeof document !== "undefined") {
      lastFocusElement = document.activeElement;
    }
    menuOpen = true;
    screen = "menu";
    menuPanel = "main";
    sidebarOpen = false;
    menuModePreview = mode;
  }

  function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    showInstallPrompt = false;
    deferredPrompt = null;
  }

  function togglePanel(section) {
    const next = !panelSections[section];
    panelSections = { ...panelSections, [section]: next };
    if (section === "chat" && next) chatUnread = 0;
  }

  function captureFocus() {
    if (typeof document !== "undefined") {
      lastFocusElement = document.activeElement;
    }
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

  function previewMode(nextMode) {
    menuModePreview = nextMode;
  }

  function commitMode(nextMode) {
    startMode(nextMode);
  }

  function startMode(nextMode) {
    if (mode === "competitive") leaveCompetitiveQueue();
    if (mode === "social" || mode === "competitive") onlineRoom = null;
    if (nextMode !== "competitive")
      queueStatus = { queued: false, position: 0, tier: "" };
    sharedViewOnly = false;
    if (nextMode === "competitive") {
      if (!authUser) {
        openAuthModal("signin");
        pendingCompetitiveStart = true;
        return;
      }
      joinCompetitiveQueue();
      sidebarOpen = true;
      return;
    }
    setMode(nextMode);
    menuOpen = false;
    screen = "game";
    pendingDrawFrom = null;
    rematchVotes = [];
    spectator = false;
    if (nextMode === "puzzle") {
      loadPuzzle(puzzleIndex);
      sidebarOpen = true;
      return;
    }
    if (nextMode === "tournament") {
      startTournament();
      sidebarOpen = true;
      return;
    }
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
  }

  function openRules() {
    captureFocus();
    rulesOpen = true;
    screen = "rules";
  }

  function closeRules() {
    rulesOpen = false;
    screen = menuOpen ? "menu" : "game";
  }

  function openAuthModal(nextMode = authModal.mode) {
    captureFocus();
    authModal = { ...authModal, open: true, mode: nextMode };
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
      mode,
      winner: state.winner ?? "D",
      reason,
      players: { ...state.players },
      moves: state.moves,
      botDifficulty: mode === "bot" ? effectiveBotDifficulty : null,
      createdAt: state.createdAt,
      endedAt: Date.now(),
      turnTimeMs: state.turnTimeMs,
    };
    matchHistory = [entry, ...matchHistory].slice(0, 30);
    persistHistory();
    awardAchievements(state, entry);
    maybeAdvanceSeason();
    syncStatsDebounced();
    syncSavedGame(state);
  }

  function updateLocalScore(winner) {
    if (mode === "puzzle") return;
    if (winner === "D" || !winner) {
      scoreboard = { ...scoreboard, draws: scoreboard.draws + 1 };
    } else if (winner === "X") {
      scoreboard = { ...scoreboard, X: scoreboard.X + 1 };
    } else {
      scoreboard = { ...scoreboard, O: scoreboard.O + 1 };
    }
    persistScoreboard();
    syncStatsDebounced();
  }

  function loadAdaptive() {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(ADAPTIVE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      adaptiveHistory = Array.isArray(parsed.history) ? parsed.history : [];
      adaptiveRate =
        typeof parsed.rate === "number" ? parsed.rate : adaptiveRate;
    } catch {
      /* ignore */
    }
  }

  function persistAdaptive() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      ADAPTIVE_KEY,
      JSON.stringify({ history: adaptiveHistory, rate: adaptiveRate }),
    );
  }

  function updateAdaptiveOutcome(winner) {
    if (mode !== "bot") return;
    const outcome =
      winner === "X" ? 1 : winner === "O" ? 0 : winner === "D" ? 0.5 : 0.5;
    adaptiveHistory = [...adaptiveHistory, outcome].slice(-10);
    adaptiveRate = adaptiveRate * 0.7 + outcome * 0.3;
    persistAdaptive();
  }

  const PUZZLE_STATES = [
    "{\"id\":\"9b0aadda-3110-45e1-a843-cf53693e528e\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[\"X\",\"X\",\"X\",null,null,null,null,null,null],\"winner\":\"X\",\"winLine\":[0,1,2],\"lastMove\":2},{\"cells\":[\"X\",\"X\",\"X\",null,null,null,null,null,null],\"winner\":\"X\",\"winLine\":[0,1,2],\"lastMove\":2},{\"cells\":[\"X\",\"X\",null,null,\"O\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":4},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":2,\"cell\":4,\"player\":\"O\",\"at\":1773843636457},\"moves\":[{\"board\":0,\"cell\":0,\"player\":\"X\",\"at\":1773843636449},{\"board\":0,\"cell\":1,\"player\":\"X\",\"at\":1773843636450},{\"board\":0,\"cell\":2,\"player\":\"X\",\"at\":1773843636451},{\"board\":1,\"cell\":0,\"player\":\"X\",\"at\":1773843636452},{\"board\":1,\"cell\":1,\"player\":\"X\",\"at\":1773843636453},{\"board\":1,\"cell\":2,\"player\":\"X\",\"at\":1773843636454},{\"board\":2,\"cell\":0,\"player\":\"X\",\"at\":1773843636455},{\"board\":2,\"cell\":1,\"player\":\"X\",\"at\":1773843636456},{\"board\":2,\"cell\":4,\"player\":\"O\",\"at\":1773843636457}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661449,\"createdAt\":1773843636449,\"updatedAt\":1773843636457}",
    "{\"id\":\"752aa2c1-eb17-4759-9307-e36d64457a52\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[\"X\",\"X\",\"X\",null,null,null,null,null,null],\"winner\":\"X\",\"winLine\":[0,1,2],\"lastMove\":2},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",\"X\",\"X\",null,null,null,null,null,null],\"winner\":\"X\",\"winLine\":[0,1,2],\"lastMove\":2},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,\"X\",\"O\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":4},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":6,\"cell\":4,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":0,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":0,\"cell\":1,\"player\":\"X\",\"at\":1773843636451},{\"board\":0,\"cell\":2,\"player\":\"X\",\"at\":1773843636452},{\"board\":3,\"cell\":0,\"player\":\"X\",\"at\":1773843636453},{\"board\":3,\"cell\":1,\"player\":\"X\",\"at\":1773843636454},{\"board\":3,\"cell\":2,\"player\":\"X\",\"at\":1773843636455},{\"board\":6,\"cell\":0,\"player\":\"X\",\"at\":1773843636456},{\"board\":6,\"cell\":3,\"player\":\"X\",\"at\":1773843636457},{\"board\":6,\"cell\":4,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"f4446d2c-e876-404d-be9c-57bdcb3d401b\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",\"O\",null,null,\"X\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":1}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":8,\"cell\":1,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":0,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":0,\"cell\":4,\"player\":\"X\",\"at\":1773843636451},{\"board\":0,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":4,\"cell\":0,\"player\":\"X\",\"at\":1773843636453},{\"board\":4,\"cell\":4,\"player\":\"X\",\"at\":1773843636454},{\"board\":4,\"cell\":8,\"player\":\"X\",\"at\":1773843636455},{\"board\":8,\"cell\":0,\"player\":\"X\",\"at\":1773843636456},{\"board\":8,\"cell\":4,\"player\":\"X\",\"at\":1773843636457},{\"board\":8,\"cell\":1,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"c47bba9a-995f-45a4-8132-594a61126e46\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,\"X\",null,null,\"X\",null,null,\"X\"],\"winner\":\"X\",\"winLine\":[2,5,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,\"X\",null,null,\"X\",null,null,\"X\"],\"winner\":\"X\",\"winLine\":[2,5,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,\"X\",null,\"O\",\"X\",null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":4}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":8,\"cell\":4,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":2,\"cell\":2,\"player\":\"X\",\"at\":1773843636450},{\"board\":2,\"cell\":5,\"player\":\"X\",\"at\":1773843636451},{\"board\":2,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":5,\"cell\":2,\"player\":\"X\",\"at\":1773843636453},{\"board\":5,\"cell\":5,\"player\":\"X\",\"at\":1773843636454},{\"board\":5,\"cell\":8,\"player\":\"X\",\"at\":1773843636455},{\"board\":8,\"cell\":2,\"player\":\"X\",\"at\":1773843636456},{\"board\":8,\"cell\":5,\"player\":\"X\",\"at\":1773843636457},{\"board\":8,\"cell\":4,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"627cb0f4-115d-44c0-862b-c84290b8b9af\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,\"X\",\"X\",\"X\"],\"winner\":\"X\",\"winLine\":[6,7,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,\"X\",\"X\",\"X\"],\"winner\":\"X\",\"winLine\":[6,7,8],\"lastMove\":8},{\"cells\":[null,null,null,null,\"O\",null,\"X\",\"X\",null],\"winner\":null,\"winLine\":null,\"lastMove\":4}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":8,\"cell\":4,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":6,\"cell\":6,\"player\":\"X\",\"at\":1773843636450},{\"board\":6,\"cell\":7,\"player\":\"X\",\"at\":1773843636451},{\"board\":6,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":7,\"cell\":6,\"player\":\"X\",\"at\":1773843636453},{\"board\":7,\"cell\":7,\"player\":\"X\",\"at\":1773843636454},{\"board\":7,\"cell\":8,\"player\":\"X\",\"at\":1773843636455},{\"board\":8,\"cell\":6,\"player\":\"X\",\"at\":1773843636456},{\"board\":8,\"cell\":7,\"player\":\"X\",\"at\":1773843636457},{\"board\":8,\"cell\":4,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"3eaaad09-7e6b-41a2-9347-8d4c1518878f\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,\"X\",null,\"X\",null,\"X\",null,null],\"winner\":\"X\",\"winLine\":[2,4,6],\"lastMove\":6},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,\"X\",\"O\",null,\"X\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":2},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":7,\"cell\":2,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":1,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":1,\"cell\":4,\"player\":\"X\",\"at\":1773843636451},{\"board\":1,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":4,\"cell\":2,\"player\":\"X\",\"at\":1773843636453},{\"board\":4,\"cell\":4,\"player\":\"X\",\"at\":1773843636454},{\"board\":4,\"cell\":6,\"player\":\"X\",\"at\":1773843636455},{\"board\":7,\"cell\":1,\"player\":\"X\",\"at\":1773843636456},{\"board\":7,\"cell\":4,\"player\":\"X\",\"at\":1773843636457},{\"board\":7,\"cell\":2,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"0f5ebcec-5bd5-4ac9-ac9f-e9b937c10490\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,\"X\",null,null,\"X\",null,null],\"winner\":\"X\",\"winLine\":[0,3,6],\"lastMove\":6},{\"cells\":[\"X\",\"X\",\"X\",null,null,null,null,null,null],\"winner\":\"X\",\"winLine\":[0,1,2],\"lastMove\":2},{\"cells\":[\"X\",null,null,\"X\",\"O\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":4},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":5,\"cell\":4,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":3,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":3,\"cell\":3,\"player\":\"X\",\"at\":1773843636451},{\"board\":3,\"cell\":6,\"player\":\"X\",\"at\":1773843636452},{\"board\":4,\"cell\":0,\"player\":\"X\",\"at\":1773843636453},{\"board\":4,\"cell\":1,\"player\":\"X\",\"at\":1773843636454},{\"board\":4,\"cell\":2,\"player\":\"X\",\"at\":1773843636455},{\"board\":5,\"cell\":0,\"player\":\"X\",\"at\":1773843636456},{\"board\":5,\"cell\":3,\"player\":\"X\",\"at\":1773843636457},{\"board\":5,\"cell\":4,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"2e2e9dcf-5d81-45b7-a7f4-9bad2ee9f977\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,\"X\",null,\"X\",null,\"X\",null,null],\"winner\":\"X\",\"winLine\":[2,4,6],\"lastMove\":6},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,\"O\",\"X\",null,\"X\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":1},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":6,\"cell\":1,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":2,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":2,\"cell\":4,\"player\":\"X\",\"at\":1773843636451},{\"board\":2,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":4,\"cell\":2,\"player\":\"X\",\"at\":1773843636453},{\"board\":4,\"cell\":4,\"player\":\"X\",\"at\":1773843636454},{\"board\":4,\"cell\":6,\"player\":\"X\",\"at\":1773843636455},{\"board\":6,\"cell\":2,\"player\":\"X\",\"at\":1773843636456},{\"board\":6,\"cell\":4,\"player\":\"X\",\"at\":1773843636457},{\"board\":6,\"cell\":1,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"ce2e5e51-6ec4-4c13-9663-0ed703e47250\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[null,null,\"X\",null,\"X\",null,\"X\",null,null],\"winner\":\"X\",\"winLine\":[2,4,6],\"lastMove\":6},{\"cells\":[\"X\",\"O\",null,null,null,null,null,null,\"X\"],\"winner\":null,\"winLine\":null,\"lastMove\":1},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":2,\"cell\":1,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":0,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":0,\"cell\":4,\"player\":\"X\",\"at\":1773843636451},{\"board\":0,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":1,\"cell\":2,\"player\":\"X\",\"at\":1773843636453},{\"board\":1,\"cell\":4,\"player\":\"X\",\"at\":1773843636454},{\"board\":1,\"cell\":6,\"player\":\"X\",\"at\":1773843636455},{\"board\":2,\"cell\":0,\"player\":\"X\",\"at\":1773843636456},{\"board\":2,\"cell\":8,\"player\":\"X\",\"at\":1773843636457},{\"board\":2,\"cell\":1,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}",
    "{\"id\":\"e939a3fd-2cbe-49b8-ba85-c5c3a45907e0\",\"mode\":\"puzzle\",\"players\":{\"X\":\"Player 1\",\"O\":\"Player 2\"},\"boards\":[{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[null,null,null,null,null,null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":null},{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[\"X\",null,null,null,\"X\",null,null,null,\"X\"],\"winner\":\"X\",\"winLine\":[0,4,8],\"lastMove\":8},{\"cells\":[\"X\",\"O\",null,null,\"X\",null,null,null,null],\"winner\":null,\"winLine\":null,\"lastMove\":1}],\"currentPlayer\":\"X\",\"forcedBoard\":null,\"winner\":null,\"winLine\":null,\"status\":\"playing\",\"lastMove\":{\"board\":8,\"cell\":1,\"player\":\"O\",\"at\":1773843636458},\"moves\":[{\"board\":6,\"cell\":0,\"player\":\"X\",\"at\":1773843636450},{\"board\":6,\"cell\":4,\"player\":\"X\",\"at\":1773843636451},{\"board\":6,\"cell\":8,\"player\":\"X\",\"at\":1773843636452},{\"board\":7,\"cell\":0,\"player\":\"X\",\"at\":1773843636453},{\"board\":7,\"cell\":4,\"player\":\"X\",\"at\":1773843636454},{\"board\":7,\"cell\":8,\"player\":\"X\",\"at\":1773843636455},{\"board\":8,\"cell\":0,\"player\":\"X\",\"at\":1773843636456},{\"board\":8,\"cell\":4,\"player\":\"X\",\"at\":1773843636457},{\"board\":8,\"cell\":1,\"player\":\"O\",\"at\":1773843636458}],\"moveCount\":9,\"turnTimeMs\":25000,\"turnEndsAt\":1773843661450,\"createdAt\":1773843636450,\"updatedAt\":1773843636458}"
  ];

  const puzzles = [
    { id: "p1", title: "Line It Up", difficulty: "Beginner", state: PUZZLE_STATES[0] },
    { id: "p2", title: "Left Column", difficulty: "Beginner", state: PUZZLE_STATES[1] },
    { id: "p3", title: "Diagonal Finish", difficulty: "Beginner", state: PUZZLE_STATES[2] },
    { id: "p4", title: "Right Column", difficulty: "Beginner", state: PUZZLE_STATES[3] },
    { id: "p5", title: "Bottom Sweep", difficulty: "Intermediate", state: PUZZLE_STATES[4] },
    { id: "p6", title: "Center Column", difficulty: "Intermediate", state: PUZZLE_STATES[5] },
    { id: "p7", title: "Middle Row", difficulty: "Intermediate", state: PUZZLE_STATES[6] },
    { id: "p8", title: "Counter Diagonal", difficulty: "Expert", state: PUZZLE_STATES[7] },
    { id: "p9", title: "Fork Threat", difficulty: "Expert", state: PUZZLE_STATES[8] },
    { id: "p10", title: "Final Edge", difficulty: "Expert", state: PUZZLE_STATES[9] },
  ];

  const PUZZLE_HINTS = {
    p1: { board: 2, cell: 2 },
    p2: { board: 6, cell: 6 },
    p3: { board: 8, cell: 8 },
    p4: { board: 8, cell: 8 },
    p5: { board: 8, cell: 8 },
    p6: { board: 7, cell: 7 },
    p7: { board: 5, cell: 6 },
    p8: { board: 6, cell: 6 },
    p9: { board: 2, cell: 4 },
    p10: { board: 8, cell: 8 },
  };

  const ACHIEVEMENTS = [
    {
      id: "first-blood",
      name: "First Blood",
      description: "Record your first win.",
      icon: "trophy",
      condition: (state, _scoreboard, history) =>
        isUserWinner(state) &&
        history.filter((m) => m.winner === getUserSymbol()).length === 1,
    },
    {
      id: "speedster",
      name: "Speedster",
      description: "Win in 15 moves or fewer.",
      icon: "zap",
      condition: (state) => isUserWinner(state) && state.moveCount <= 15,
    },
    {
      id: "shutout",
      name: "Shutout",
      description: "Win without losing a sub-board.",
      icon: "flag",
      condition: (state) =>
        isUserWinner(state) && countBoardWins(state, getOppSymbol()) === 0,
    },
    {
      id: "atlas-slayer",
      name: "Atlas Slayer",
      description: "Beat Atlas on hard difficulty.",
      icon: "crown",
      condition: (state, _score, _history, entry) =>
        mode === "bot" &&
        isUserWinner(state) &&
        ["hard", "master"].includes(entry?.botDifficulty),
    },
    {
      id: "centurion",
      name: "Centurion",
      description: "Play 100 total moves.",
      icon: "sparkles",
      condition: (_state, _scoreboard, history) =>
        history.reduce((sum, match) => sum + (match.moves?.length ?? 0), 0) >=
        100,
    },
    {
      id: "comeback",
      name: "Comeback",
      description: "Win after your opponent claims 2 boards.",
      icon: "trophy",
      condition: (state) =>
        isUserWinner(state) && countBoardWins(state, getOppSymbol()) >= 2,
    },
    {
      id: "marathoner",
      name: "Marathoner",
      description: "Win in 35 moves or more.",
      icon: "flag",
      condition: (state) => isUserWinner(state) && state.moveCount >= 35,
    },
    {
      id: "hat-trick",
      name: "Hat Trick",
      description: "Win three matches in a row.",
      icon: "crown",
      condition: (_state, _scoreboard, history) =>
        history.slice(0, 3).every((m) => m.winner === getUserSymbol()),
    },
    {
      id: "socialite",
      name: "Socialite",
      description: "Complete 5 social matches.",
      icon: "trophy",
      condition: (_state, _scoreboard, history) =>
        history.filter((m) => m.mode === "social").length >= 5,
    },
    {
      id: "ranked-rookie",
      name: "Ranked Rookie",
      description: "Complete a ranked match.",
      icon: "trophy",
      condition: (_state, _scoreboard, history) =>
        history.some((m) => m.mode === "competitive"),
    },
    {
      id: "puzzle-solver",
      name: "Puzzle Solver",
      description: "Solve 3 puzzles.",
      icon: "sparkles",
      condition: () => solvedPuzzles.length >= 3,
    },
    {
      id: "tournament-champ",
      name: "Tournament Champ",
      description: "Win a tournament.",
      icon: "crown",
      condition: () => Boolean(tournament.champion),
    },
  ];

  function getUserSymbol() {
    return mode === "social" || mode === "competitive" ? mySymbol : "X";
  }

  function getOppSymbol() {
    return getUserSymbol() === "X" ? "O" : "X";
  }

  function isUserWinner(state) {
    return state?.winner && state.winner === getUserSymbol();
  }

  function countBoardWins(state, player) {
    if (!state?.boards) return 0;
    return state.boards.filter((board) => board.winner === player).length;
  }

  function getRankColor(name) {
    const tier = RANK_TIERS.find((t) => t.name === name);
    return tier?.color ?? "var(--text-2)";
  }

  function loadSolvedPuzzles() {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(PUZZLE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        solvedPuzzles = [];
        return;
      }
      if (parsed.length > 0 && typeof parsed[0] === "string") {
        solvedPuzzles = parsed.map((id) => ({ id, bestMs: null, lastMs: null }));
      } else {
        solvedPuzzles = parsed;
      }
    } catch {
      /* ignore */
    }
  }

  function persistSolvedPuzzles() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PUZZLE_KEY, JSON.stringify(solvedPuzzles));
  }

  function getPuzzleRecord(id) {
    return solvedPuzzles.find((entry) => entry.id === id);
  }

  function loadPuzzle(index) {
    const puzzle = puzzles[index % puzzles.length];
    if (!puzzle) return;
    puzzleIndex = index % puzzles.length;
    localState = deserializeState(puzzle.state);
    sharedViewOnly = false;
    puzzleStartAt = Date.now();
    localState.turnEndsAt = Date.now() + localState.turnTimeMs;
    if (timerMode === "chess") {
      playerBanks = {
        X: Math.floor(chessClockMs / 1000),
        O: Math.floor(chessClockMs / 1000),
      };
    }
    past = [];
    future = [];
    saveLocalGameNow();
  }

  function showPuzzleHint() {
    const puzzle = puzzles[puzzleIndex];
    if (!puzzle) return;
    const hint = PUZZLE_HINTS[puzzle.id];
    if (!hint) return;
    hintCell = hint;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintCell = null;
    }, 2000);
  }

  function resetPuzzle() {
    loadPuzzle(puzzleIndex);
  }

  function spawnPuzzleConfetti(board, cell) {
    if (!boardEl || typeof document === "undefined") return;
    const cellEl = boardEl.querySelector(
      `[data-board="${board}"] .cell:nth-child(${cell + 1})`,
    );
    if (!cellEl) return;
    const cellRect = cellEl.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    const x = cellRect.left - boardRect.left + cellRect.width / 2;
    const y = cellRect.top - boardRect.top + cellRect.height / 2;
    puzzleConfetti = Array.from({ length: 24 }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      x,
      y,
      size: [4, 6, 8][i % 3],
      deg: i * 15,
    }));
    setTimeout(() => {
      puzzleConfetti = [];
    }, 1200);
  }

  function markPuzzleSolved(id) {
    const elapsed = Math.max(0, Date.now() - (puzzleStartAt || Date.now()));
    const existing = getPuzzleRecord(id);
    if (existing) {
      const bestMs =
        typeof existing.bestMs === "number"
          ? Math.min(existing.bestMs, elapsed)
          : elapsed;
      solvedPuzzles = solvedPuzzles.map((entry) =>
        entry.id === id ? { ...entry, bestMs, lastMs: elapsed } : entry,
      );
    } else {
      solvedPuzzles = [
        ...solvedPuzzles,
        { id, bestMs: elapsed, lastMs: elapsed },
      ];
    }
    persistSolvedPuzzles();
  }

  function nextPuzzle() {
    const currentIndex = puzzleIndex;
    const unsolved = puzzles.findIndex(
      (p, i) => i !== currentIndex && !getPuzzleRecord(p.id),
    );
    loadPuzzle(unsolved >= 0 ? unsolved : (currentIndex + 1) % puzzles.length);
  }

  function loadAchievements() {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      earnedAchievements = Array.isArray(parsed) ? parsed : [];
    } catch {
      /* ignore */
    }
  }

  function persistAchievements() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(earnedAchievements));
  }

  function awardAchievements(state, entry = null) {
    const earned = new Set(earnedAchievements);
    const newly = [];
    for (const achievement of ACHIEVEMENTS) {
      if (earned.has(achievement.id)) continue;
      if (achievement.condition(state, scoreboard, matchHistory, entry)) {
        earned.add(achievement.id);
        newly.push(achievement);
      }
    }
    if (newly.length === 0) return;
    earnedAchievements = Array.from(earned);
    persistAchievements();
    newly.forEach((achievement) => {
      notify(`Achievement unlocked: ${achievement.name}`, "trophy", {
        title: achievement.name,
        subtitle: achievement.description,
        duration: 5000,
      });
    });
  }

  function syncStatsDebounced() {
    if (!authUser || !db) return;
    if (statsSyncTimer) clearTimeout(statsSyncTimer);
    statsSyncTimer = setTimeout(async () => {
      try {
        await setDoc(
          doc(collection(db, "users"), authUser.uid),
          {
            stats: {
              scoreboard,
              matchHistory: matchHistory.slice(0, 30),
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true },
        );
        lastSyncAt = Date.now();
      } catch {
        /* ignore */
      }
    }, 600);
  }

  async function syncSavedGame(state) {
    if (!authUser || !db) return;
    if (!(mode === "local" || mode === "bot")) return;
    try {
      await setDoc(
        doc(collection(db, "users"), authUser.uid),
        {
          savedGame: {
            state: serializeState(cloneState(state)),
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true },
      );
      lastSyncAt = Date.now();
    } catch {
      /* ignore */
    }
  }

  async function loadRemoteStatsAndSavedGame() {
    if (!authUser || !db) return;
    try {
      const userSnap = await getDoc(doc(collection(db, "users"), authUser.uid));
      if (userSnap.exists()) {
        const data = userSnap.data();
        const stats = data?.stats;
        const updated =
          typeof stats?.updatedAt?.toMillis === "function"
            ? stats.updatedAt.toMillis()
            : 0;
        if (updated > statsUpdatedAt) {
          statsUpdatedAt = updated;
          if (stats?.scoreboard) scoreboard = stats.scoreboard;
          if (stats?.matchHistory) matchHistory = stats.matchHistory;
        }
        const saved = data?.savedGame;
        if (saved?.state) {
          const parsed = deserializeState(saved.state);
          if (!parsed.winner) {
            savedGamePrompt = parsed;
            notify("Continue saved game?", "info", {
              persistent: true,
              actions: [
                {
                  label: "Accept",
                  action: () => {
                    localState = parsed;
                    mode = "local";
                    menuOpen = false;
                    screen = "game";
                    saveLocalGameNow();
                  },
                },
                {
                  label: "Dismiss",
                  action: () => {
                    savedGamePrompt = null;
                  },
                },
              ],
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
    lastSyncAt = Date.now();
  }

  async function syncNow() {
    syncingStats = true;
    await loadRemoteStatsAndSavedGame();
    syncingStats = false;
  }

  function shareGame() {
    if (mode === "social" || mode === "competitive") {
      notify("Sharing is only available for local games.", "error");
      return;
    }
    const raw = serializeState(cloneState(currentState));
    const encoded = btoa(unescape(encodeURIComponent(raw)));
    const url = new URL(window.location.href);
    url.searchParams.set("g", encoded);
    history.replaceState(null, "", url.toString());
    shareUrl = url.toString();
    if (navigator?.clipboard) navigator.clipboard.writeText(shareUrl);
    shareCopied = true;
    shareQrOpen = true;
    setTimeout(() => {
      shareCopied = false;
    }, 1500);
    notify("Share link copied", "success");
  }

  function loadSharedGameFromUrl() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const param = url.searchParams.get("g");
    if (!param) return;
    try {
      const decoded = decodeURIComponent(escape(atob(param)));
      const parsed = deserializeState(decoded);
      localState = parsed;
      mode = "local";
      menuOpen = false;
      screen = "game";
      sharedViewOnly = true;
      saveLocalGameNow();
      notify("Loaded shared game", "success");
    } catch {
      notify("Invalid shared game link", "error");
    }
  }

  function handleTimeout(loser) {
    if (mode === "social" || mode === "competitive") return;
    if (localState.winner) return;
    const winner = loser === "X" ? "O" : "X";
    localState.winner = winner;
    localState.status = "ended";
    localState.winLine = null;
    localState.updatedAt = Date.now();
    captureFocus();
    winModal = { open: true, winner, reason: "timeout" };
    recordMatch(localState, "timeout");
    updateLocalScore(winner);
    updateAdaptiveOutcome(winner);
    saveLocalGameNow();
  }

  function addBankIncrement(player) {
    if (timerMode !== "chess" || isOnline) return;
    const next = (playerBanks[player] ?? 0) + 15;
    playerBanks = { ...playerBanks, [player]: next };
    bankFlash = player;
    playSound("move");
    setTimeout(() => {
      if (bankFlash === player) bankFlash = null;
    }, 500);
  }

  function handleAnnotationClick(board, cell) {
    if (!annotationMode) return false;
    if (!analysisMode && !currentState.winner) return false;
    const key = `${board}-${cell}`;
    const current = annotationMap.get(key);
    let next = null;
    if (!current) {
      next = { type: "dot", color: annotationColor };
    } else if (current.type === "dot") {
      next = { type: "arrow-right", color: annotationColor };
    } else if (current.type === "arrow-right") {
      next = { type: "arrow-down", color: annotationColor };
    } else if (current.type === "arrow-down") {
      next = { type: "cross", color: annotationColor };
    }
    if (next) annotationMap.set(key, next);
    else annotationMap.delete(key);
    annotationTick += 1;
    return true;
  }

  function getAnnotation(board, cell) {
    annotationTick;
    return annotationMap.get(`${board}-${cell}`);
  }

  function computeAnalysisScores() {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisLoading = true;
    analysisTimer = setTimeout(() => {
      const scores = {};
      for (let i = 0; i < 9; i += 1) {
        const board = currentState.boards[i];
        if (!board || board.winner) continue;
        const clone = cloneState(currentState);
        clone.forcedBoard = i;
        chooseBotMove(clone, "master");
        const open = board.cells.filter((c) => !c).length;
        scores[i] = open / 9;
      }
      analysisScores = scores;
      analysisLoading = false;
    }, 0);
  }

  function clearAnnotations() {
    annotationMap.clear();
    annotationTick += 1;
  }

  function exportAnnotations() {
    const payload = JSON.stringify(Array.from(annotationMap.entries()));
    if (navigator?.clipboard) navigator.clipboard.writeText(payload);
    notify("Annotations copied");
  }

  function startTournament() {
    const players = tournament.players.map((p, i) => p || `Player ${i + 1}`);
    const bracket = [
      {
        id: "semi-1",
        round: 1,
        playerA: players[0],
        playerB: players[1],
        winner: null,
      },
      {
        id: "semi-2",
        round: 1,
        playerA: players[2],
        playerB: players[3],
        winner: null,
      },
      { id: "final", round: 2, playerA: null, playerB: null, winner: null },
    ];
    tournament = {
      ...tournament,
      active: true,
      status: "active",
      players,
      bracket,
      currentMatch: 0,
      champion: null,
    };
    startTournamentMatch(0);
  }

  function startTournamentMatch(index) {
    const match = tournament.bracket[index];
    if (!match?.playerA || !match?.playerB) return;
    localState = createState({
      players: { X: match.playerA, O: match.playerB },
      turnTimeMs,
    });
    localState.mode = "tournament";
    past = [];
    future = [];
    if (timerMode === "chess") {
      playerBanks = {
        X: Math.floor(chessClockMs / 1000),
        O: Math.floor(chessClockMs / 1000),
      };
    }
  }

  function advanceTournament(state) {
    if (state.winner === "D") {
      notify("Draw - replay this match", "info");
      startTournamentMatch(tournament.currentMatch);
      return;
    }
    const winnerName = state.players?.[state.winner] ?? "Winner";
    const bracket = [...tournament.bracket];
    bracket[tournament.currentMatch] = {
      ...bracket[tournament.currentMatch],
      winner: winnerName,
    };
    let nextMatch = tournament.currentMatch + 1;
    if (tournament.currentMatch === 0) {
      bracket[2].playerA = winnerName;
      nextMatch = 1;
    } else if (tournament.currentMatch === 1) {
      bracket[2].playerB = winnerName;
      nextMatch = 2;
    }
    if (nextMatch >= bracket.length) {
      tournament = {
        ...tournament,
        bracket,
        champion: winnerName,
        status: "complete",
        currentMatch: nextMatch,
      };
      awardAchievements(state);
      return;
    }
    tournament = { ...tournament, bracket, currentMatch: nextMatch };
    if (nextMatch === 2 && (!bracket[2]?.playerA || !bracket[2]?.playerB)) {
      return;
    }
    startTournamentMatch(nextMatch);
  }

  function resetTournament() {
    tournament = {
      active: false,
      status: "lobby",
      players: ["Player 1", "Player 2", "Player 3", "Player 4"],
      bracket: [],
      currentMatch: 0,
      champion: null,
    };
  }

  function updateTournamentPlayer(index, value) {
    const players = [...tournament.players];
    players[index] = value;
    tournament = { ...tournament, players };
  }

  function focusTrap(node) {
    const previous = lastFocusElement || document.activeElement;
    const selector =
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
    const getFocusable = () =>
      Array.from(node.querySelectorAll(selector)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
    const onKeydown = (event) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    tick().then(() => {
      const focusable = getFocusable();
      if (focusable.length > 0) focusable[0].focus();
    });
    node.addEventListener("keydown", onKeydown);
    return {
      destroy() {
        node.removeEventListener("keydown", onKeydown);
        if (previous && typeof previous.focus === "function") previous.focus();
      },
    };
  }

  function spawnRipple(x, y, board, cell) {
    const id = Date.now() + Math.random();
    const key = `${board}-${cell}`;
    const list = rippleMap.get(key) ?? [];
    list.push({ id, x, y, board, cell });
    rippleMap.set(key, list);
    ripplesTick += 1;
    setTimeout(() => {
      const next = (rippleMap.get(key) ?? []).filter((r) => r.id !== id);
      if (next.length === 0) {
        rippleMap.delete(key);
      } else {
        rippleMap.set(key, next);
      }
      ripplesTick += 1;
    }, 600);
  }

  function getRipples(board, cell) {
    ripplesTick;
    return rippleMap.get(`${board}-${cell}`) ?? [];
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
    const result = applyMove(
      localState,
      { board, cell },
      { player: localState.currentPlayer },
    );
    if (result.ok) {
      if (mode === "local") {
        past = [...past, { ...result.state.lastMove }];
        future = [];
      }
      playSound("move");
      if (result.state.winner) {
        playSound("win");
        recordMatch(result.state, result.state.status);
        updateLocalScore(result.state.winner);
        updateAdaptiveOutcome(result.state.winner);
      } else if (mode === "bot" && result.state.currentPlayer === "O") {
        queueBotMove();
      }
      saveLocalGameNow();
    }
  }

  function queueBotMove() {
    if (botThinking) return;
    botThinking = true;
    const delay = 400;
    setTimeout(() => {
      const move = chooseBotMove(
        cloneState(localState),
        effectiveBotDifficulty,
      );
      if (move) applyLocalMove(move.board, move.cell);
      botThinking = false;
    }, delay);
  }

  function handleCellClick(board, cell, event) {
    if (event) {
      const rect = event.currentTarget.getBoundingClientRect();
      spawnRipple(
        event.clientX - rect.left,
        event.clientY - rect.top,
        board,
        cell,
      );
    }
    if (handleAnnotationClick(board, cell)) return;
    if (sharedViewOnly) return;
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
      openAuthModal("signin");
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

  function sendChat(message = chatInput) {
    if (!socket || !onlineRoom) return;
    const text = String(message || "").trim();
    if (!text) return;
    socket.emit("sendChat", { roomId: onlineRoom.id, text });
    chatInput = "";
  }

  function addFriend() {
    const name = String(friendInput || "").trim();
    if (!name) return;
    if (!friends.find((f) => f.name.toLowerCase() === name.toLowerCase())) {
      friends = [...friends, { name, online: false, challenged: false }];
    }
    socket?.emit("addFriend", { name });
    friendInput = "";
  }

  function challengeFriend(name) {
    if (!onlineRoom) {
      notify("Create a room before challenging friends", "error");
      return;
    }
    socket?.emit("challengeFriend", {
      name,
      code: onlineRoom.code ?? onlineRoom.id,
    });
    friends = friends.map((friend) =>
      friend.name === name ? { ...friend, challenged: true } : friend,
    );
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
      sharedViewOnly = false;
      past = [];
      future = [];
      saveLocalGameNow();
      notify("Game state loaded");
    } catch {
      notify("Invalid state JSON", "error");
    }
  }

  function undoMove() {
    if (mode !== "local" || past.length === 0) return;
    const last = past[past.length - 1];
    past = past.slice(0, -1);
    future = [last, ...future];
    const rebuilt = replayStateFromMoves(
      past,
      createState({ id: localState.id, players: effectiveNames, turnTimeMs }),
    );
    localState = rebuilt;
    playSound("move");
    saveLocalGameNow();
  }

  function redoMove() {
    if (mode !== "local" || future.length === 0) return;
    const next = future[0];
    future = future.slice(1);
    past = [...past, next];
    const rebuilt = replayStateFromMoves(
      past,
      createState({ id: localState.id, players: effectiveNames, turnTimeMs }),
    );
    localState = rebuilt;
    playSound("move");
    saveLocalGameNow();
  }

  function openReplay(match) {
    if (!match?.moves?.length) {
      notify("Replay unavailable", "error");
      return;
    }
    captureFocus();
    replay = { open: true, match, index: 0, playing: false };
  }

  function closeReplay() {
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = null;
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
          replayTimer = null;
        }
      }, 650);
    } else {
      clearInterval(replayTimer);
      replayTimer = null;
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
      handleCellClick(board, cell, null);
      return;
    }
    kbdIndex = row * 9 + col;
  }

  function isLegalCell(boardIndex, cellIndex) {
    if (currentState.winner) return false;
    if (sharedViewOnly) return false;
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
    socket.on("chatMessage", (payload) => {
      const message = payload?.message ?? payload;
      if (!message) return;
      chatMessages = [...chatMessages, message].slice(-200);
      if (!panelSections.chat) chatUnread += 1;
    });
    socket.on("friendStatus", ({ name, online }) => {
      if (!name) return;
      const exists = friends.find(
        (friend) => friend.name.toLowerCase() === name.toLowerCase(),
      );
      if (!exists) {
        friends = [...friends, { name, online: !!online, challenged: false }];
        return;
      }
      friends = friends.map((friend) =>
        friend.name.toLowerCase() === name.toLowerCase()
          ? { ...friend, online: !!online }
          : friend,
      );
    });
    socket.on("friendChallenge", ({ from, code }) => {
      if (!from || !code) return;
      notify(`${from} challenged you!`, "info", {
        persistent: true,
        actions: [
          {
            label: "Accept",
            action: () => {
              socialCode = code;
              joinSocialRoom();
            },
          },
          {
            label: "Decline",
            action: () => {},
          },
        ],
      });
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
    if (!lastSettingsSnapshot) {
      lastSettingsSnapshot = JSON.stringify({
        playerNames,
        myName,
        botDifficulty,
        turnTimeMs,
        timerMode,
        chessClockMs,
        timerPosition,
        boardTheme,
        highContrast,
      });
      settingsDirty = false;
      return;
    }
    const snapshot = JSON.stringify({
      playerNames,
      myName,
      botDifficulty,
      turnTimeMs,
      timerMode,
      chessClockMs,
      timerPosition,
      boardTheme,
      highContrast,
    });
    settingsDirty = snapshot !== lastSettingsSnapshot;
    if (settingsDirty) settingsSaved = false;
  });
  $effect(() => {
    if (typeof document !== "undefined") {
      document.body.dataset.theme = theme;
      if (highContrast) document.body.dataset.hc = "true";
      else document.body.removeAttribute("data-hc");
    }
  });
  $effect(() => {
    if (typeof document === "undefined") return;
    const tokens = BOARD_THEMES[boardTheme] ?? BOARD_THEMES.default;
    Object.entries(tokens).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
    themeFlash = true;
    setTimeout(() => {
      themeFlash = false;
    }, 400);
  });
  $effect(() => {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(TOKEN_KEY, reconnectToken);
  });
  $effect(() => {
    if (mode !== "social" && mode !== "competitive") saveLocalGameDebounced();
  });
  $effect(() => {
    if (!hydrated) return;
    const prevMode = lastMode ?? "local";
    if (mode === prevMode) {
      lastMode = mode;
      return;
    }
    lastMode = mode;
    if (
      mode !== "social" &&
      mode !== "competitive" &&
      mode !== "puzzle" &&
      mode !== "tournament"
    )
      resetLocalGame();
  });
  $effect(() => {
    if (mode !== "competitive") {
      leaderboard = [];
      leaderboardUnsub?.();
      leaderboardUnsub = null;
      return;
    }
    if (!db || leaderboardUnsub) return;
    const usersQuery = query(
      collection(db, "users"),
      orderBy("rating", "desc"),
      limit(20),
    );
    leaderboardUnsub = onSnapshot(usersQuery, (snapshot) => {
      leaderboard = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
    });
  });
  $effect(() => {
    if (effectiveBotDifficulty === lastAdaptiveDifficulty) return;
    lastAdaptiveDifficulty = effectiveBotDifficulty;
    adaptivePulse = true;
    setTimeout(() => {
      adaptivePulse = false;
    }, 400);
  });

  $effect(() => {
    const forced = currentState.forcedBoard;
    if (forced === null || forced === undefined) {
      spotlightBoard = null;
      return;
    }
    if (spotlightBoard === forced) return;
    spotlightBoard = forced;
    if (spotlightTimer) clearTimeout(spotlightTimer);
    spotlightTimer = setTimeout(() => {
      spotlightBoard = null;
    }, 700);
  });

  $effect(() => {
    if (!analysisMode) {
      analysisScores = {};
      analysisLoading = false;
      return;
    }
    if (currentState.winner) {
      analysisScores = {};
      analysisLoading = false;
      return;
    }
    if (
      (mode === "social" || mode === "competitive") &&
      currentState.currentPlayer !== mySymbol
    ) {
      analysisScores = {};
      analysisLoading = false;
      return;
    }
    computeAnalysisScores();
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
    if (winModal.open) return;
    captureFocus();
    winModal = { open: true, winner, reason: null };
    if (mode === "puzzle" && winner === "X") {
      const puzzle = puzzles[puzzleIndex];
      if (puzzle) {
        markPuzzleSolved(puzzle.id);
        awardAchievements(currentState);
        if (currentState.lastMove) {
          spawnPuzzleConfetti(
            currentState.lastMove.board,
            currentState.lastMove.cell,
          );
        }
      }
    }
    if (mode === "tournament" && tournament.status === "active") {
      advanceTournament(currentState);
    }
  });

  $effect(() => {
    if (!showHeatmap || !currentState.winner) {
      heatmap = null;
      return;
    }
    const counts = Array.from({ length: 9 }, () => Array(9).fill(0));
    for (const move of currentState.moves || []) {
      if (!counts[move.board]) continue;
      counts[move.board][move.cell] += 1;
    }
    const flat = counts.flat();
    const max = Math.max(0, ...flat);
    heatmap = counts.map((row) =>
      row.map((value) => (max > 0 ? value / max : 0)),
    );
  });

  function handleMouseMove(e) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--cx", `${e.clientX}px`);
    document.documentElement.style.setProperty("--cy", `${e.clientY}px`);
  }

  onMount(() => {
    loadSettings();
    loadSeason();
    loadHistory();
    loadScoreboard();
    loadLocalGame();
    loadAdaptive();
    loadSolvedPuzzles();
    loadAchievements();
    if (typeof localStorage !== "undefined") {
      reconnectToken = localStorage.getItem(TOKEN_KEY) ?? reconnectToken;
      const savedMode = localStorage.getItem(MODE_KEY);
      const savedLocalMode = localStorage.getItem(LAST_LOCAL_MODE_KEY);
      if (savedMode) mode = savedMode === "online" ? "social" : savedMode;
      if (savedLocalMode) lastLocalMode = savedLocalMode;
    }
    menuModePreview = mode;
    hydrated = true;
    screen = "menu";
    menuOpen = true;
    if (timerMode === "chess") {
      playerBanks = {
        X: Math.floor(chessClockMs / 1000),
        O: Math.floor(chessClockMs / 1000),
      };
    }
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--cx", "50vw");
      document.documentElement.style.setProperty("--cy", "50vh");
    }
    const tickNow = (ts) => {
      if (document.visibilityState === "visible") {
        if (!nowLastTick) nowLastTick = ts;
        const deltaMs = ts - nowLastTick;
        if (deltaMs >= 250) {
          const nowTime = Date.now();
          const deltaSec = (nowTime - now) / 1000;
          if (
            timerMode === "chess" &&
            !currentState.winner &&
            mode !== "social" &&
            mode !== "competitive"
          ) {
            const current = currentState.currentPlayer;
            const nextBank = Math.max(
              0,
              (playerBanks[current] ?? 0) - deltaSec,
            );
            playerBanks = { ...playerBanks, [current]: nextBank };
            if (nextBank <= 0) handleTimeout(current);
          }
          now = nowTime;
          nowLastTick = ts;
        }
      }
      nowRaf = requestAnimationFrame(tickNow);
    };
    nowRaf = requestAnimationFrame(tickNow);
    const unlockAudio = () => ensureAudioContext();
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    const onBeforeInstall = (event) => {
      event.preventDefault();
      deferredPrompt = event;
      showInstallPrompt = true;
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    const unsubAuth = subscribeAuth((user, userProfile) => {
      authUser = user;
      profile = userProfile;
      if (pendingCompetitiveStart && authUser) {
        pendingCompetitiveStart = false;
        joinCompetitiveQueue();
      }
      if (authUser) loadRemoteStatsAndSavedGame();
    });
    loadSharedGameFromUrl();
    return () => {
      if (nowRaf) cancelAnimationFrame(nowRaf);
      unsubAuth?.();
      leaderboardUnsub?.();
      leaderboardUnsub = null;
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  });

  onDestroy(() => {
    if (replayTimer) clearInterval(replayTimer);
    if (nowRaf) cancelAnimationFrame(nowRaf);
    if (saveTimer) clearTimeout(saveTimer);
    if (statsSyncTimer) clearTimeout(statsSyncTimer);
    if (spotlightTimer) clearTimeout(spotlightTimer);
    if (hintTimer) clearTimeout(hintTimer);
    if (analysisTimer) clearTimeout(analysisTimer);
  });
</script>

<svelte:head>
  <title>Ultimate Tic-Tac-Toe - Made by Jack</title>
  <meta
    name="description"
    content="Play Ultimate Tic-Tac-Toe locally, against a bot, or online with friends and ranked matchmaking. Control the grid, win the meta."
  />
  <meta name="robots" content="index,follow" />
  <meta property="og:title" content="Ultimate Tic-Tac-Toe" />
  <meta
    property="og:description"
    content="Play Ultimate Tic-Tac-Toe locally, against a bot, or online with friends and ranked matchmaking."
  />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="color-scheme" content="dark light" />
  <meta
    name="theme-color"
    media="(prefers-color-scheme: dark)"
    content="#060a10"
  />
  <meta
    name="theme-color"
    media="(prefers-color-scheme: light)"
    content="#f4f6fb"
  />
  <link rel="icon" href="/uttt_logo.svg" type="image/svg+xml" />
  <link rel="manifest" href="/manifest.json" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="app"
  data-theme={theme}
  data-screen={screen}
  onmousemove={handleMouseMove}
>
  <a class="skip-link" href="#main-content">Skip to main content</a>

  <!-- Cursor light effect -->
  <div class="cursor-light" aria-hidden="true"></div>

  <!-- Ambient background -->
  <div class="ambient" aria-hidden="true">
    <div class="orb orb-a"></div>
    <div class="orb orb-b"></div>
    <div class="orb orb-c"></div>
    <div class="noise"></div>
    <div class="grid-lines"></div>
  </div>

  <!-- ═══════════════════════════════════════
       MAIN MENU OVERLAY
       ═══════════════════════════════════════ -->
  {#if menuOpen}
    <div
      class="menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="menu-title"
    >
      <div class="menu-shell">
        {#if hasUnfinishedMatch}
          <button class="menu-resume btn-primary" onclick={resumeGame}>
            <Play size={15} />
            <span>Resume Game</span>
          </button>
        {/if}
        <!-- Logo & Hero -->
        <div class="menu-hero">
          <div class="menu-logo" aria-hidden="true">
            <span class="logo-x">✕</span>
            <div class="logo-divider"></div>
            <span class="logo-o">○</span>
          </div>
          <div class="menu-titles">
            <p class="menu-eyebrow">Made by Jack</p>
            <h2 id="menu-title" class="menu-heading">
              Ultimate<br /><em>Tic‑Tac‑Toe</em>
            </h2>
            <p class="menu-sub">The strategy game inside a strategy game.</p>
          </div>
        </div>

        <!-- Mode cards -->
        <div class="mode-grid" role="group" aria-label="Game modes">
          {#each MODE_DEFS as modeDef}
            <div
              class="mode-card"
              class:mode-active={menuModePreview === modeDef.id}
              data-mode={modeDef.id}
              role="button"
              tabindex="0"
              aria-pressed={menuModePreview === modeDef.id}
              style={`--mode-accent:${modeDef.accent};--mode-glow:${modeDef.glow};`}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") previewMode(modeDef.id);
              }}
              onclick={() => previewMode(modeDef.id)}
            >
              <div class="mode-card-head">
                <div class="mode-card-icon">
                  <svelte:component this={modeDef.icon} size={18} />
                </div>
                <div class="mode-card-body">
                  <strong>{modeDef.label}</strong>
                  <span>{modeDef.desc}</span>
                </div>
              </div>
              {#if menuModePreview === modeDef.id}
                <div class="mode-card-cta">
                  <button
                    class="btn-primary btn-sm"
                    onclick={() => commitMode(modeDef.id)}
                  >
                    Play
                  </button>
                  {#if hasUnfinishedMatch && modeDef.id !== mode}
                    <p class="mode-warning">
                      Switching will reset the current match.
                    </p>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Quick Actions Row -->
        <div class="menu-actions">
          <button class="menu-action-btn" onclick={openRules}>Rules</button>
          <button
            class="menu-action-btn"
            onclick={() =>
              (menuPanel = menuPanel === "settings" ? "main" : "settings")}
          >
            Settings
          </button>
          <button
            class="menu-action-btn"
            onclick={() =>
              (menuPanel = menuPanel === "profile" ? "main" : "profile")}
          >
            Profile
          </button>
        </div>

        <!-- Sub-panels -->
        {#if menuPanel === "main"}
          <div class="menu-lobby glass-card">
            <div class="lobby-header">
              <h3>Social Lobby</h3>
              <span class="lobby-tagline">Invite friends with a room code</span>
            </div>
            {#if mode === "social" && onlineRoom}
              <div class="active-room">
                <div class="room-code-display">
                  <span class="room-code-label">Room Code</span>
                  <span class="room-code-value"
                    >{onlineRoom.code ?? onlineRoom.id}</span
                  >
                  <button
                    class="icon-btn-sm"
                    onclick={() =>
                      copyRoomCode(onlineRoom.code ?? onlineRoom.id)}
                    aria-label="Copy room code"
                  >
                    Copy
                  </button>
                </div>
                <div class="room-meta">
                  <span
                    >vs {onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                      "Waiting…"}</span
                  >
                  <span>{onlineRoom.spectators ?? 0} watching</span>
                </div>
              </div>
            {:else}
              <div class="lobby-controls">
                <button class="btn-primary" onclick={createSocialRoom}>
                  Create Room
                </button>
                <div class="lobby-join">
                  <label class="sr-only" for="menu-social-code">Room code</label
                  >
                  <input
                    id="menu-social-code"
                    placeholder="Room code…"
                    bind:value={socialCode}
                    aria-label="Room code"
                  />
                  <button
                    class="icon-btn-sm"
                    onclick={joinSocialRoom}
                    aria-label="Join room">Join</button
                  >
                  <button
                    class="icon-btn-sm"
                    onclick={spectateSocialRoom}
                    aria-label="Spectate room">Spectate</button
                  >
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if menuPanel === "settings"}
          <div class="menu-panel-card glass-card">
            <div class="panel-card-header">
              <h3>Settings</h3>
              <button
                class="btn-ghost btn-xs"
                onclick={() => (menuPanel = "main")}
              >
                Back
              </button>
            </div>
            <div class="settings-grid">
              <div class="setting-field">
                <label for="menu-p1name">Player 1</label>
                <input
                  id="menu-p1name"
                  bind:value={playerNames.X}
                  placeholder="Player 1"
                />
              </div>
              <div class="setting-field">
                <label for="menu-p2name">Player 2</label>
                <input
                  id="menu-p2name"
                  bind:value={playerNames.O}
                  placeholder="Player 2"
                />
              </div>
              <div class="setting-field">
                <label for="menu-myname">Online Name</label>
                <input
                  id="menu-myname"
                  bind:value={myName}
                  placeholder="Your name"
                />
              </div>
              <div class="setting-field">
                <label for="menu-botdiff">Bot Level</label>
                <select id="menu-botdiff" bind:value={botDifficulty}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="master">Master</option>
                </select>
              </div>
              <div class="setting-field">
                <label for="menu-turntimer">Turn Timer</label>
                <select id="menu-turntimer" bind:value={turnTimeMs}>
                  <option value={15000}>15 s</option>
                  <option value={25000}>25 s</option>
                  <option value={35000}>35 s</option>
                </select>
              </div>
              <div class="setting-field">
                <label for="menu-timer-mode">Timer Mode</label>
                <select id="menu-timer-mode" bind:value={timerMode}>
                  <option value="shared">Shared</option>
                  <option value="chess">Chess Clock</option>
                </select>
              </div>
              <div class="setting-field">
                <label for="menu-timer-pos">Timer Position</label>
                <select id="menu-timer-pos" bind:value={timerPosition}>
                  <option value="bottom">Bottom (center)</option>
                  <option value="left">Left (side)</option>
                  <option value="corner">Corner (mini)</option>
                </select>
              </div>
              <div class="setting-field">
                <label for="menu-chess-clock">Chess Clock</label>
                <select id="menu-chess-clock" bind:value={chessClockMs}>
                  <option value={180000}>3 minutes</option>
                  <option value={300000}>5 minutes</option>
                  <option value={480000}>8 minutes</option>
                </select>
              </div>
              <div class="setting-field">
                <label>Board Theme</label>
                <div class="theme-swatches">
                  {#each ["default", "neon", "pastel", "mono", "forest"] as t}
                    <button
                      class="theme-swatch"
                      class:theme-active={boardTheme === t}
                      style={`--swatch:${BOARD_THEMES[t]["--brand"]}`}
                      onclick={() => (boardTheme = t)}
                      aria-label={`Board theme ${t}`}
                    >
                      {#if boardTheme === t}
                        <Check size={12} />
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
            <div class="toggle-row">
              <button
                class="toggle-btn"
                onclick={() => (theme = theme === "light" ? "dark" : "light")}
                aria-pressed={theme === "dark"}
              >
                {theme === "light" ? "Dark Mode" : "Light Mode"}
              </button>
              <button
                class="toggle-btn"
                onclick={() => (soundEnabled = !soundEnabled)}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? "Sound On" : "Sound Off"}
              </button>
              <button
                class="toggle-btn"
                onclick={() => (highContrast = !highContrast)}
                aria-pressed={highContrast}
              >
                High Contrast
              </button>
            </div>
            <div class="settings-actions">
              <button
                class="btn-primary"
                onclick={applySettings}
                disabled={!settingsDirty}
              >
                Save Settings
              </button>
              {#if settingsSaved}
                <button class="btn-ghost" onclick={() => resetLocalGame()}>
                  New Game
                </button>
              {/if}
            </div>
          </div>
        {/if}

        {#if menuPanel === "profile"}
          <div class="menu-panel-card glass-card">
            <div class="panel-card-header">
              <h3>Profile</h3>
              <button
                class="btn-ghost btn-xs"
                onclick={() => (menuPanel = "main")}
              >
                Back
              </button>
            </div>
            {#if authUser && profile}
              <div class="profile-hero">
                <div
                  class="profile-rank-badge"
                  style="--rc:{currentRank.color}"
                >
                  {#if currentRank.name === "Elite" ||
                  currentRank.name === "Champion"}
                    <Crown size={16} />
                  {:else}
                    <Star size={16} />
                  {/if}
                </div>
                <div class="profile-name-block">
                  <strong>{profile.displayName}</strong>
                  <span class="profile-rank-label"
                    >{currentRank.name} · {profile.rating} ELO</span
                  >
                </div>
              </div>
              <div class="profile-stats-row">
                <div class="pstat pstat-win">
                  <span class="pstat-num">{profile.wins}</span><span
                    class="pstat-label">Wins</span
                  >
                </div>
                <div class="pstat pstat-loss">
                  <span class="pstat-num">{profile.losses}</span><span
                    class="pstat-label">Losses</span
                  >
                </div>
                <div class="pstat pstat-draw">
                  <span class="pstat-num">{profile.draws}</span><span
                    class="pstat-label">Draws</span
                  >
                </div>
              </div>
              <div class="sync-row">
                <span class={`sync-icon sync-${syncState}`}>
                  {#if syncState === "offline"}
                    <WifiOff size={12} />
                  {:else}
                    <Wifi size={12} />
                  {/if}
                </span>
                <span class="sync-text">
                  {#if syncState === "fresh"}
                    Synced just now
                  {:else if syncState === "mid"}
                    Synced recently
                  {:else if syncState === "offline"}
                    Offline
                  {:else}
                    Sync pending
                  {/if}
                </span>
                <button class="btn-ghost btn-xs" onclick={syncNow}>
                  {#if syncingStats}
                    <Loader2 size={12} class="spin" />
                  {/if}
                  Sync Now
                </button>
              </div>
              <div class="season-block">
                <div class="season-row">
                  <span>Season {seasonData.season}</span>
                  <span class="dim-text">{seasonDaysLeft} days left</span>
                </div>
                <div class="season-trophies">
                  {#if seasonData.trophies.length === 0}
                    <span class="dim-text">No trophies yet</span>
                  {:else}
                    {#each seasonData.trophies as trophy}
                      <span
                        class="season-chip"
                        style={`--chip:${getRankColor(trophy)}`}
                      >
                        {trophy}
                      </span>
                    {/each}
                  {/if}
                </div>
              </div>
              <button class="btn-ghost btn-sm" onclick={handleSignOut}>
                Sign Out
              </button>
            {:else}
              <p class="dim-text">
                Sign in for ranked play, stats &amp; your profile.
              </p>
              <button
                class="btn-primary"
                onclick={() => openAuthModal("signin")}
              >
                Sign In
              </button>
            {/if}
            {#if leaderboard.length > 0}
              <div class="mini-leaderboard">
                <h4 class="mini-lb-title">Top Players</h4>
                {#each leaderboard.slice(0, 5) as entry, i (entry.id)}
                  <div
                    class="mini-lb-row"
                    class:lb-self={authUser && entry.id === authUser.uid}
                    animate:flip={{ duration: 360 }}
                  >
                    <span class="lb-pos">{i + 1}</span>
                    <span class="lb-name">{entry.displayName}</span>
                    <span class="lb-elo">{entry.rating}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="achievements">
              <div class="achievements-head">
                <h4 class="mini-lb-title">Achievements</h4>
                <span class="achievements-count"
                  >{earnedAchievements.length} / {ACHIEVEMENTS.length}
                  unlocked</span
                >
              </div>
              <div class="achievements-bar">
                <div
                  class="achievements-fill"
                  style={`width:${(earnedAchievements.length / ACHIEVEMENTS.length) * 100}%`}
                ></div>
              </div>
              <div class="achievement-grid">
                {#each ACHIEVEMENTS as achievement}
                  <div
                    class="achievement-item"
                    class:achievement-unlocked={earnedAchievements.includes(
                      achievement.id,
                    )}
                    title={achievement.description}
                  >
                    <svelte:component
                      this={ACHIEVEMENT_ICONS[achievement.icon] ?? Trophy}
                      size={16}
                    />
                    <div class="achievement-body">
                      <strong>{achievement.name}</strong>
                      <span>{achievement.description}</span>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}

        {#if showInstallPrompt}
          <div class="install-banner" role="status" aria-live="polite">
            <div class="install-copy">
              <strong>Install as app</strong>
              <span>Launch faster from your home screen.</span>
            </div>
            <button class="btn-primary btn-sm" onclick={promptInstall}>
              <Download size={15} />
              Install
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════
       TOP BAR
       ═══════════════════════════════════════ -->
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-icon" aria-hidden="true">
        <span class="bi-x">✕</span>
        <span class="bi-o">○</span>
      </div>
      <div class="brand-wordmark">
        <h1>Ultimate <em>TTT</em></h1>
      </div>
    </div>

    <div class="topbar-status" role="status" aria-live="polite">
      <div
        class="status-capsule"
        class:is-winner={!!currentState.winner}
        class:is-draw={currentState.winner === "D"}
      >
        {#if currentState.winner === "D"}
          <span>= Draw</span>
        {:else if currentState.winner}
          <Crown size={14} />
          <span>{statusLine}</span>
        {:else if currentState.currentPlayer === "X"}
          <span class="player-pip pip-x" aria-hidden="true">✕</span>
          <span>{statusLine}</span>
        {:else}
          <span class="player-pip pip-o" aria-hidden="true">○</span>
          <span>{statusLine}</span>
        {/if}
        {#if mode === "social" && (onlineRoom?.spectators ?? 0) > 0}
          <span class="spectator-badge">
            <Eye size={14} class="eye-pulse" />
            {onlineRoom.spectators}
          </span>
        {/if}
      </div>
    </div>

    <div class="topbar-controls">
      <button
        class="topbar-btn"
        onclick={() => (theme = theme === "light" ? "dark" : "light")}
        aria-label={theme === "light"
          ? "Switch to dark mode"
          : "Switch to light mode"}
        aria-pressed={theme === "dark"}
      >
        {#if theme === "light"}
          <Sun size={16} />
          <span class="topbar-label">Light</span>
        {:else}
          <Moon size={16} />
          <span class="topbar-label">Dark</span>
        {/if}
      </button>
      <button
        class="topbar-btn"
        onclick={() => (soundEnabled = !soundEnabled)}
        aria-label={soundEnabled ? "Mute" : "Unmute"}
        aria-pressed={soundEnabled}
      >
        {#if soundEnabled}
          <Volume2 size={16} />
        {:else}
          <VolumeX size={16} />
        {/if}
        <span class="topbar-label">Sound</span>
      </button>
      <button class="topbar-btn" onclick={openMenu} aria-label="Open menu">
        <Menu size={16} />
      </button>
    </div>
  </header>

  <!-- ═══════════════════════════════════════
       MAIN LAYOUT
       ═══════════════════════════════════════ -->
  <main id="main-content" class="layout" class:has-sidebar={sidebarOpen}>
    <!-- Scrim for mobile -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="scrim"
      class:scrim-show={sidebarOpen}
      role="presentation"
      aria-hidden="true"
      onclick={() => (sidebarOpen = false)}
      onkeydown={() => {}}
    ></div>

    <!-- ─── BOARD ZONE ─── -->
    <section
      class="board-zone"
      data-player={currentState.currentPlayer}
      aria-label="Game board"
    >
      {#if multiplayerBanner}
        <div
          class="turn-banner"
          class:turn-active={currentState.currentPlayer === mySymbol}
        >
          {multiplayerBanner}
        </div>
      {/if}
      {#if sharedViewOnly}
        <div class="shared-banner">
          <span>Shared game loaded — playing as viewer</span>
          <button
            class="btn-ghost btn-xs"
            onclick={() => (sharedViewOnly = false)}
          >
            Take over as X
          </button>
        </div>
      {/if}

      <!-- HUD Bar -->
      <div class="hud-bar" role="group" aria-label="Game stats">
        <div class="hud-segment">
          <div class="hud-label" data-label-short="NOW">Current</div>
          <div class="hud-value hud-player">
            {#if currentState.currentPlayer === "X"}
              <span class="player-sym sym-x" aria-label="X">✕</span>
            {:else}
              <span class="player-sym sym-o" aria-label="O">○</span>
            {/if}
            <span
              >{currentState.players?.[currentState.currentPlayer] ??
                currentState.currentPlayer}</span
            >
          </div>
        </div>
        <div class="hud-divider" aria-hidden="true"></div>
        <div class="hud-segment">
          <div class="hud-label" data-label-short="GO TO">Target</div>
          <div class="hud-value">{forcedLabel}</div>
        </div>
        {#if mode === "social" || mode === "competitive"}
          <div class="hud-divider" aria-hidden="true"></div>
          <div class="hud-segment">
            <div class="hud-label" data-label-short="ROOM">Room</div>
            <div class="hud-value hud-room">
              <span
                class="conn-dot"
                class:conn-on={connectionStatus === "online"}
                class:conn-mid={connectionStatus === "connecting"}
                aria-hidden="true"
              ></span>
              <span>{onlineRoom?.code ?? onlineRoom?.id ?? "-"}</span>
            </div>
          </div>
        {/if}
      </div>

      <div
        class="board-stage"
        class:has-side={
          (timerMode === "chess" && !isOnline) ||
          ((timerMode === "shared" || isOnline) && timerPosition === "left")
        }
        data-timer-pos={timerPosition}
      >
        {#if timerMode === "chess" && !isOnline}
          <aside class="side-timers">
            <div class="chess-banks">
              {#each ["X", "O"] as sym}
                {@const pct =
                  (playerBanks[sym] / (chessClockMs / 1000)) * 100}
                <div
                  class="bank"
                  class:bank-x={sym === "X"}
                  class:bank-o={sym === "O"}
                  class:bank-active={currentState.currentPlayer === sym}
                  class:bank-low={playerBanks[sym] <= 30}
                  class:bank-flash={bankFlash === sym}
                >
                  <div class="bank-head">
                    <span class={`bank-sym ${sym === "X" ? "sym-x" : "sym-o"}`}>
                      {sym === "X" ? "✕" : "○"}
                    </span>
                    <span class="bank-name">{displayNames[sym]}</span>
                    <span class="bank-time">{formatTime(playerBanks[sym])}</span>
                    <button
                      class="bank-inc"
                      onclick={() => addBankIncrement(sym)}
                      aria-label={`Add 15 seconds to ${displayNames[sym]}`}
                    >
                      +15s
                    </button>
                  </div>
                  <div class="bank-track">
                    <div class="bank-fill" style={`width:${pct}%`}></div>
                  </div>
                </div>
              {/each}
            </div>
          </aside>
        {:else if (timerMode === "shared" || isOnline) && timerPosition === "left"}
          <aside class="side-timers">
            <div class="turn-timer-bar timer-left" class:timer-urgent={timeLeft <= 8}>
              <div class="turn-timer-track">
                <div
                  class="turn-timer-fill"
                  style={`width:${timerPct}%;background:${timerGradient};`}
                ></div>
              </div>
              <span class="turn-timer-caption" data-label-short="TIME">Time</span>
              <span class="turn-timer-label">{timerLabelText}</span>
            </div>
          </aside>
        {/if}

        <div class="board-stack">
          <div class="board-wrap">
            {#if (timerMode === "shared" || isOnline) && timerPosition === "corner"}
              <div
                class="corner-timer"
                style={`--pct:${timerPct}%;--ring:${timerRingColor};`}
                aria-label="Turn timer"
              >
                <div class="corner-ring"></div>
                <div class="corner-time">{timerLabelText}</div>
              </div>
            {/if}

            <!-- THE BOARD -->
            <div
              class="ultimate-board"
              class:theme-flash={themeFlash}
              bind:this={boardEl}
              role="grid"
              tabindex="0"
              onkeydown={handleKeydown}
              aria-label="Ultimate tic-tac-toe board"
            >
        {#each currentState.boards as board, boardIndex}
          {@const boardActive = legalBoards.includes(boardIndex)}
          <div
            class="mini-board"
            class:mini-active={boardActive}
            class:mini-inactive={!boardActive && !board.winner}
            class:mini-won={board.winner && board.winner !== "D"}
            class:mini-drawn={board.winner === "D"}
            class:mini-spotlight={spotlightBoard === boardIndex}
            data-board={boardIndex}
            aria-label={`Sub-board ${boardIndex + 1}${board.winner ? `, won by ${board.winner === "D" ? "draw" : board.winner}` : boardActive ? ", active" : ""}`}
          >
            {#if board.winner && board.winner !== "D"}
              <div
                class="board-overlay"
                class:ov-x={board.winner === "X"}
                class:ov-o={board.winner === "O"}
                aria-hidden="true"
              >
                <span class="board-overlay-sym"
                  >{board.winner === "X" ? "✕" : "○"}</span
                >
              </div>
            {/if}
            {#if board.winner === "D"}
              <div class="board-overlay ov-draw" aria-hidden="true">
                <span class="board-overlay-sym">=</span>
              </div>
            {/if}
            {#if board.winLine && board.winner && board.winner !== "D"}
              <div
                class={`win-strike ${getWinLineClass(board.winLine)} ${board.winner === "X" ? "strike-x" : "strike-o"}`}
                aria-hidden="true"
              ></div>
            {/if}

            {#each board.cells as cell, cellIndex}
              {@const isLast =
                currentState.lastMove?.board === boardIndex &&
                currentState.lastMove?.cell === cellIndex}
              {@const isKbd =
                kbdFocus.board === boardIndex && kbdFocus.cell === cellIndex}
              {@const legal = isLegalCell(boardIndex, cellIndex)}
              {@const isHov =
                hoverCell?.board === boardIndex &&
                hoverCell?.cell === cellIndex}
              {@const isPressed =
                pressedCell?.board === boardIndex &&
                pressedCell?.cell === cellIndex}
              {@const isUndo =
                undoGhostMove?.board === boardIndex &&
                undoGhostMove?.cell === cellIndex}
              {@const annotation = getAnnotation(boardIndex, cellIndex)}
              <button
                class="cell"
                class:cell-last={isLast}
                class:cell-kbd={isKbd}
                class:cell-legal={legal}
                class:cell-occupied={!!cell}
                class:cell-x={cell === "X"}
                class:cell-o={cell === "O"}
                class:cell-hover={isHov && legal}
                class:cell-pressed={isPressed}
                class:cell-undo={isUndo}
                class:cell-undo-x={isUndo && undoGhostMove?.player === "X"}
                class:cell-undo-o={isUndo && undoGhostMove?.player === "O"}
                class:cell-hint={hintCell?.board === boardIndex &&
                  hintCell?.cell === cellIndex}
                class:cell-heat={showHeatmap && currentState.winner}
                aria-label={`Sub-board ${boardIndex + 1}, cell ${cellIndex + 1}${cell ? `, ${cell}` : legal ? ", playable" : ""}`}
                onmouseenter={() =>
                  (hoverCell = { board: boardIndex, cell: cellIndex })}
                onmouseleave={() => (hoverCell = null)}
                onmousedown={() =>
                  (pressedCell = { board: boardIndex, cell: cellIndex })}
                onmouseup={() => (pressedCell = null)}
                onmousemove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hx = ((e.clientX - rect.left) / rect.width) * 100;
                  const hy = ((e.clientY - rect.top) / rect.height) * 100;
                  e.currentTarget.style.setProperty("--hx", `${hx}%`);
                  e.currentTarget.style.setProperty("--hy", `${hy}%`);
                }}
                onclick={(e) => handleCellClick(boardIndex, cellIndex, e)}
                style={`--heat:${showHeatmap && heatmap ? heatmap[boardIndex]?.[cellIndex] ?? 0 : 0};`}
                disabled={
                  ((!legal || !!board.winner) && !annotationMode) ||
                  (sharedViewOnly && !annotationMode)
                }
              >
                {#each getRipples(boardIndex, cellIndex) as rip (rip.id)}
                  <span
                    class="ripple"
                    style="--rx:{rip.x}px;--ry:{rip.y}px"
                    aria-hidden="true"
                  ></span>
                {/each}
                {#if annotation}
                  <span
                    class="cell-annotation"
                    style={`--annotation-color:${annotation.color};--annotation-opacity:${annotationOpacity}`}
                  >
                    {#if annotation.type === "dot"}
                      <span class="annotation-dot"></span>
                    {:else if annotation.type === "arrow-right"}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <defs>
                          <marker
                            id={`arrow-${boardIndex}-${cellIndex}-r`}
                            markerWidth="6"
                            markerHeight="6"
                            refX="5"
                            refY="3"
                            orient="auto"
                          >
                            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                          </marker>
                        </defs>
                        <path
                          d="M4 12h12"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          marker-end={`url(#arrow-${boardIndex}-${cellIndex}-r)`}
                        />
                      </svg>
                    {:else if annotation.type === "arrow-down"}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <defs>
                          <marker
                            id={`arrow-${boardIndex}-${cellIndex}-d`}
                            markerWidth="6"
                            markerHeight="6"
                            refX="3"
                            refY="5"
                            orient="auto"
                          >
                            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                          </marker>
                        </defs>
                        <path
                          d="M12 4v12"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          marker-end={`url(#arrow-${boardIndex}-${cellIndex}-d)`}
                        />
                      </svg>
                    {:else if annotation.type === "cross"}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M6 6l12 12M18 6l-12 12"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                        />
                      </svg>
                    {/if}
                  </span>
                {/if}
                {#if isUndo}
                  <span class="cell-undo-border" aria-hidden="true"></span>
                {/if}
                {#if cell === "X"}
                  <span class="cell-sym sym-x" aria-hidden="true">✕</span>
                {:else if cell === "O"}
                  <span class="cell-sym sym-o" aria-hidden="true">○</span>
                {:else if isHov && legal}
                  <span class="cell-ghost" aria-hidden="true">
                    {currentState.currentPlayer === "X" ? "✕" : "○"}
                  </span>
                {:else if isUndo}
                  <span class="cell-undo-ghost" aria-hidden="true">
                    {undoGhostMove?.player === "X" ? "✕" : "○"}
                  </span>
                {/if}
              </button>
            {/each}
            {#if analysisMode && !board.winner}
              <div
                class="analysis-bar"
                style={`--eval:${analysisScores[boardIndex] ?? 0}`}
              ></div>
            {/if}
          </div>
        {/each}
            </div>
            {#if puzzleConfetti.length}
              <div class="puzzle-confetti-layer" aria-hidden="true">
                {#each puzzleConfetti as p (p.id)}
                  <span
                    class="puzzle-confetti"
                    style={`--x:${p.x}px;--y:${p.y}px;--size:${p.size}px;--deg:${p.deg}deg`}
                  ></span>
                {/each}
              </div>
            {/if}
          </div>
          {#if showHeatmap && currentState.winner}
            <div class="heatmap-legend" aria-hidden="true">
              <span>Cold</span>
              <div class="heatmap-bar"></div>
              <span>Hot</span>
            </div>
          {/if}
          {#if (timerMode === "shared" || isOnline) && timerPosition === "bottom"}
            <div class="turn-timer-bar" class:timer-urgent={timeLeft <= 8}>
              <div class="turn-timer-track">
                <div
                  class="turn-timer-fill"
                  style={`width:${timerPct}%;background:${timerGradient};`}
                ></div>
              </div>
              <span class="turn-timer-caption" data-label-short="TIME">Time</span>
              <span class="turn-timer-label">{timerLabelText}</span>
            </div>
          {/if}
        </div>
      </div>

      {#if analysisMode}
        <div class="analysis-status">
          {#if analysisLoading}
            <Loader2 size={14} class="spin" />
            <span>Analyzing…</span>
          {:else}
            <span>Analysis ready</span>
          {/if}
        </div>
      {/if}
    </section>

    <!-- ─── SIDE PANEL ─── -->
    <aside
      class="side-panel"
      class:panel-open={sidebarOpen}
      aria-label="Game controls"
      aria-hidden={!sidebarOpen}
    >
      <!-- Mode tabs -->
      <nav class="mode-tabs" aria-label="Switch game mode">
        {#each MODE_DEFS as modeDef}
          <button
            class="mode-tab"
            class:tab-active={mode === modeDef.id}
            onclick={() => commitMode(modeDef.id)}
            role="tab"
            aria-selected={mode === modeDef.id}
            aria-current={mode === modeDef.id ? "page" : undefined}
            aria-label={`Switch to ${modeDef.label} mode`}
          >
            <svelte:component this={modeDef.icon} size={15} />
            <span>{modeDef.label}</span>
          </button>
        {/each}
      </nav>

      <!-- Scrollable panel content -->
      <div class="panel-scroll">
        <!-- Quick Actions -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.actions}
            onclick={() => togglePanel("actions")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("actions")}
          >
            <span>Actions</span>
            <ChevronRight size={12} class={ panelSections.actions ? "chev-open" : "" } />
          </div>
          {#if panelSections.actions}
            <div class="ps-body">
            {#if mode === "local" || mode === "bot" || mode === "tournament"}
              <button class="btn-primary" onclick={() => resetLocalGame()}>
                New Game
              </button>
              <div class="btn-row">
                <button
                  class="btn-ghost"
                  onclick={undoMove}
                  disabled={past.length === 0 || mode !== "local"}
                >
                  Undo
                </button>
                <button
                  class="btn-ghost"
                  onclick={redoMove}
                  disabled={future.length === 0 || mode !== "local"}
                >
                  Redo
                </button>
              </div>
            {:else}
              <button
                class="btn-primary"
                onclick={requestRematch}
                disabled={!onlineRoom || spectator}
              >
                Rematch
              </button>
              <button
                class="btn-ghost"
                onclick={offerDraw}
                disabled={!!pendingDrawFrom || !onlineRoom || spectator}
              >
                Offer Draw
              </button>
            {/if}
            <div class="share-row">
              <button class="btn-ghost" onclick={shareGame}>
                {#if shareCopied}
                  <Check size={15} />
                  Copied!
                {:else}
                  <Share2 size={15} />
                  Share
                {/if}
              </button>
              {#if shareQrOpen && shareUrl}
                <div class="share-qr">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(shareUrl)}`}
                    alt="Share QR"
                  />
                </div>
              {/if}
            </div>
            <button class="btn-ghost" onclick={exportGameState}>
              <Copy size={15} />
              Copy State
            </button>
            </div>
          {/if}
        </div>

        <!-- Move Timeline -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.moves}
            onclick={() => togglePanel("moves")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("moves")}
          >
            <span>Moves</span>
            <span class="ps-badge">{currentState.moves.length}</span>
            <ChevronRight size={12} class={ panelSections.moves ? "chev-open" : "" } />
          </div>
          {#if panelSections.moves}
            <div class="ps-body ps-timeline">
            {#each currentState.moves as move, i}
              <div
                class="tl-item"
                class:tl-x={move.player === "X"}
                class:tl-o={move.player === "O"}
              >
                <span class="tl-n">#{i + 1}</span>
                <span class="tl-sym">{move.player === "X" ? "✕" : "○"}</span>
                <span class="tl-pos">B{move.board + 1}·C{move.cell + 1}</span>
              </div>
            {/each}
            {#if currentState.moves.length === 0}
              <span class="tl-empty">No moves yet</span>
            {/if}
            </div>
          {/if}
        </div>

        <!-- Settings -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.settings}
            onclick={() => togglePanel("settings")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("settings")}
          >
            <span>Settings</span>
            <ChevronRight size={12} class={ panelSections.settings ? "chev-open" : "" } />
          </div>
          {#if panelSections.settings}
            <div class="ps-body">
            <div class="sf">
              <label for="s-p1"><span class="sym-x">✕</span> Player 1</label
              ><input
                id="s-p1"
                bind:value={playerNames.X}
                placeholder="Player 1"
              />
            </div>
            <div class="sf">
              <label for="s-p2"><span class="sym-o">○</span> Player 2</label
              ><input
                id="s-p2"
                bind:value={playerNames.O}
                placeholder="Player 2"
              />
            </div>
            <div class="sf">
              <label for="s-name">Online Name</label>
              <input id="s-name" bind:value={myName} placeholder="Your name" />
            </div>
            <div class="sf">
              <label for="s-bot">Bot Level</label>
              <select id="s-bot" bind:value={botDifficulty}
                ><option value="easy">Easy</option><option value="medium"
                  >Medium</option
                ><option value="hard">Hard</option
                ><option value="master">Master</option></select
              >
            </div>
            <div class="sf">
              <label for="s-timer">Turn Timer</label>
              <select id="s-timer" bind:value={turnTimeMs}
                ><option value={15000}>15 s</option><option value={25000}
                  >25 s</option
                ><option value={35000}>35 s</option></select
              >
            </div>
            <div class="sf">
              <label for="s-timer-mode">Timer Mode</label>
              <select id="s-timer-mode" bind:value={timerMode}>
                <option value="shared">Shared</option>
                <option value="chess">Chess Clock</option>
              </select>
            </div>
            <div class="sf">
              <label for="s-timer-pos">Timer Position</label>
              <select id="s-timer-pos" bind:value={timerPosition}>
                <option value="bottom">Bottom (center)</option>
                <option value="left">Left (side)</option>
                <option value="corner">Corner (mini)</option>
              </select>
            </div>
            <div class="sf">
              <label for="s-chess-clock">Chess Clock</label>
              <select id="s-chess-clock" bind:value={chessClockMs}>
                <option value={180000}>3 minutes</option>
                <option value={300000}>5 minutes</option>
                <option value={480000}>8 minutes</option>
              </select>
            </div>
            <div class="sf">
              <label>Board Theme</label>
              <div class="theme-swatches">
                {#each ["default", "neon", "pastel", "mono", "forest"] as t}
                  <button
                    class="theme-swatch"
                    class:theme-active={boardTheme === t}
                    style={`--swatch:${BOARD_THEMES[t]["--brand"]}`}
                    onclick={() => (boardTheme = t)}
                    aria-label={`Board theme ${t}`}
                  >
                    {#if boardTheme === t}
                      <Check size={12} />
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
            <div class="btn-row">
              <button
                class="btn-ghost"
                onclick={() => (theme = theme === "light" ? "dark" : "light")}
              >
                {#if theme === "light"}
                  <Moon size={15} />
                  Dark
                {:else}
                  <Sun size={15} />
                  Light
                {/if}
              </button>
              <button
                class="btn-ghost"
                onclick={() => (soundEnabled = !soundEnabled)}
              >
                {#if soundEnabled}
                  <Volume2 size={15} />
                  On
                {:else}
                  <VolumeX size={15} />
                  Off
                {/if}
              </button>
              <button
                class="btn-ghost"
                onclick={() => (highContrast = !highContrast)}
                aria-pressed={highContrast}
              >
                <Eye size={15} />
                High Contrast
              </button>
            </div>
            <button
              class="btn-primary"
              onclick={applySettings}
              disabled={!settingsDirty}
            >
              Save Settings
            </button>
            {#if settingsSaved}
              <button class="btn-ghost" onclick={() => resetLocalGame()}>
                New Game
              </button>
            {/if}
            </div>
          {/if}
        </div>

        <!-- Bot Panel -->
        {#if mode === "bot"}
          <div class="panel-section panel-accent-bot">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.bot}
              onclick={() => togglePanel("bot")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("bot")}
            >
              <span>Bot Match</span>
              <ChevronRight size={12} class={ panelSections.bot ? "chev-open" : "" } />
            </div>
            {#if panelSections.bot}
              <div class="ps-body">
              <p class="info-line">
                You play <span class="sym-x">✕</span> ·
                <strong>{BOT_NAME}</strong>
                plays <span class="sym-o">○</span>
              </p>
              <p class="info-line dim-text">
                Atlas is playing at:
                <span
                  class={`adaptive-badge diff-${effectiveBotDifficulty}`}
                  class:adaptive-pulse={adaptivePulse}
                >
                  {effectiveBotDifficulty.slice(0, 1).toUpperCase() +
                    effectiveBotDifficulty.slice(1)}
                </span>
              </p>
              <div class="adaptive-meter">
                <div
                  class="adaptive-fill"
                  style={`width:${adaptivePct}%`}
                ></div>
                <span>{adaptivePct}% win rate</span>
              </div>
              {#if botThinking}
                <div class="bot-thinking">
                  <Loader2 size={14} class="spin" />
                  Atlas is thinking…
                </div>
              {/if}
              <button class="btn-primary" onclick={() => resetLocalGame()}>
                Restart
              </button>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Puzzle Panel -->
        {#if mode === "puzzle"}
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.puzzles}
              onclick={() => togglePanel("puzzles")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("puzzles")}
            >
              <span>Puzzles</span>
              <ChevronRight size={12} class={ panelSections.puzzles ? "chev-open" : "" } />
            </div>
            {#if panelSections.puzzles}
              <div class="ps-body">
              <div class="puzzle-list">
                {#each puzzles as puzzle, idx}
                  {@const record = getPuzzleRecord(puzzle.id)}
                  <button
                    class="puzzle-item"
                    class:puzzle-active={idx === puzzleIndex}
                    onclick={() => loadPuzzle(idx)}
                  >
                    <div>
                      <strong>{puzzle.title}</strong>
                      <span class="puzzle-diff">{puzzle.difficulty}</span>
                    </div>
                    {#if record}
                      <span class="puzzle-check">
                        <Check size={14} />
                        {#if record.bestMs}
                          <em>{formatMs(record.bestMs)}</em>
                        {/if}
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
              <div class="btn-row">
                <button class="btn-ghost" onclick={showPuzzleHint}>
                  <Info size={15} />
                  Hint
                </button>
                <button class="btn-ghost" onclick={resetPuzzle}>
                  <RotateCcw size={15} />
                  Reset
                </button>
                <button class="btn-primary" onclick={nextPuzzle}>
                  Next Puzzle
                </button>
              </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Tournament Panel -->
        {#if mode === "tournament"}
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.tournament}
              onclick={() => togglePanel("tournament")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("tournament")}
            >
              <span>Tournament</span>
              <ChevronRight
                size={12}
                class={ panelSections.tournament ? "chev-open" : "" }
              />
            </div>
            {#if panelSections.tournament}
              <div class="ps-body">
                {#if tournament.status === "lobby"}
                  <div class="tournament-lobby">
                    {#each tournament.players as player, idx}
                      <div class="sf">
                        <label for={`tour-${idx}`}>Player {idx + 1}</label>
                        <input
                          id={`tour-${idx}`}
                          value={player}
                          oninput={(e) =>
                            updateTournamentPlayer(idx, e.currentTarget.value)}
                        />
                      </div>
                    {/each}
                    <button class="btn-primary" onclick={startTournament}>
                      Start Tournament
                    </button>
                  </div>
                {:else}
                  <div class="bracket">
                    <div class="bracket-round">
                      <div
                        class="bracket-match"
                        class:match-active={tournament.currentMatch === 0}
                        data-connector="right"
                      >
                        <div class="bm-row">
                          {tournament.bracket[0]?.playerA ?? "TBD"}
                        </div>
                        <div class="bm-row">
                          {tournament.bracket[0]?.playerB ?? "TBD"}
                        </div>
                        {#if tournament.bracket[0]?.winner}
                          <div class="bm-winner">
                            Winner: {tournament.bracket[0].winner}
                          </div>
                        {/if}
                      </div>
                      <div
                        class="bracket-match"
                        class:match-active={tournament.currentMatch === 1}
                        data-connector="right"
                      >
                        <div class="bm-row">
                          {tournament.bracket[1]?.playerA ?? "TBD"}
                        </div>
                        <div class="bm-row">
                          {tournament.bracket[1]?.playerB ?? "TBD"}
                        </div>
                        {#if tournament.bracket[1]?.winner}
                          <div class="bm-winner">
                            Winner: {tournament.bracket[1].winner}
                          </div>
                        {/if}
                      </div>
                    </div>
                    <div class="bracket-round bracket-final">
                      <div
                        class="bracket-match"
                        class:match-active={tournament.currentMatch === 2}
                      >
                        <div class="bm-row">
                          {tournament.bracket[2]?.playerA ?? "TBD"}
                        </div>
                        <div class="bm-row">
                          {tournament.bracket[2]?.playerB ?? "TBD"}
                        </div>
                        {#if tournament.bracket[2]?.winner}
                          <div class="bm-winner">
                            Winner: {tournament.bracket[2].winner}
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                  {#if tournament.status === "complete"}
                    <div class="tournament-podium">
                      <div class="podium-confetti" aria-hidden="true">
                        {#each Array(36) as _, i}
                          <span
                            class="podium-particle"
                            style={`--i:${i}`}
                          ></span>
                        {/each}
                      </div>
                      <div class="podium-card">
                        <Crown size={32} />
                        <strong>{tournament.champion}</strong>
                        <span>Champion</span>
                      </div>
                      <button class="btn-ghost" onclick={resetTournament}>
                        New Tournament
                      </button>
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Social Panel -->
        {#if mode === "social"}
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.social}
              onclick={() => togglePanel("social")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("social")}
            >
              <span>Social Lobby</span>
              <span
                class="conn-dot ml-auto"
                class:conn-on={connectionStatus === "online"}
                class:conn-mid={connectionStatus === "connecting"}
                aria-label={connectionStatus}
              ></span>
              <ChevronRight size={12} class={ panelSections.social ? "chev-open" : "" } />
            </div>
            {#if panelSections.social}
              <div class="ps-body">
              <p class="info-line dim-text">
                {connectionStatus}
              </p>
              {#if !onlineRoom}
                <button class="btn-primary" onclick={createSocialRoom}>
                  Create Room
                </button>
                <div class="input-row">
                  <label class="sr-only" for="sp-code">Room code</label>
                  <input
                    id="sp-code"
                    placeholder="Room code…"
                    bind:value={socialCode}
                    aria-label="Room code"
                  />
                  <button
                    class="icon-btn-sm"
                    onclick={joinSocialRoom}
                    aria-label="Join">Join</button
                  >
                  <button
                    class="icon-btn-sm"
                    onclick={spectateSocialRoom}
                    aria-label="Spectate">Spectate</button
                  >
                </div>
              {:else}
                <div class="room-info-block">
                  <div class="room-row">
                    <span class="room-code-chip"
                      >{onlineRoom.code ?? onlineRoom.id}</span
                    >
                    <button
                      class="icon-btn-sm"
                      onclick={() =>
                        copyRoomCode(onlineRoom.code ?? onlineRoom.id)}
                      aria-label="Copy code">Copy</button
                    >
                  </div>
                  <div class="room-row dim-text">
                    vs
                    <strong
                      >{onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                        "Waiting…"}</strong
                    >
                  </div>
                  <div class="room-row dim-text">
                    <Eye size={14} />
                    {onlineRoom.spectators ?? 0} spectators
                  </div>
                </div>
                {#if pendingDrawFrom && pendingDrawFrom !== mySymbol}
                  <div class="draw-banner">
                    <span>Draw offered!</span>
                    <div class="btn-row">
                      <button
                        class="btn-primary btn-sm"
                        onclick={() => respondDraw(true)}>Accept</button
                      >
                      <button
                        class="btn-ghost btn-sm"
                        onclick={() => respondDraw(false)}>Decline</button
                      >
                    </div>
                  </div>
                {/if}
                <div class="friends-block">
                  <div class="friends-head">
                    <strong>Invite Friends</strong>
                    <span class="dim-text">Challenge instantly</span>
                  </div>
                  <div class="input-row">
                    <input
                      placeholder="Friend username"
                      bind:value={friendInput}
                      aria-label="Add friend"
                    />
                    <button class="icon-btn-sm" onclick={addFriend}>
                      <UserPlus size={15} />
                    </button>
                  </div>
                  <div class="friends-list">
                    {#if friends.length === 0}
                      <span class="dim-text">No friends yet.</span>
                    {:else}
                      {#each friends as friend}
                        <div class="friend-item">
                          <span
                            class="friend-status"
                            class:friend-online={friend.online}
                          ></span>
                          <span class="friend-name">{friend.name}</span>
                          <button
                            class="btn-ghost btn-xs"
                            onclick={() => challengeFriend(friend.name)}
                            disabled={!friend.online}
                          >
                            <Swords size={15} />
                            Challenge
                          </button>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Competitive Panel -->
        {#if mode === "competitive"}
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.competitive}
              onclick={() => togglePanel("competitive")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("competitive")}
            >
              <span>Ranked Queue</span>
              <span
                class="conn-dot ml-auto"
                class:conn-on={connectionStatus === "online"}
                class:conn-mid={connectionStatus === "connecting"}
                aria-label={connectionStatus}
              ></span>
              <ChevronRight
                size={12}
                class={ panelSections.competitive ? "chev-open" : "" }
              />
            </div>
            {#if panelSections.competitive}
              <div class="ps-body">
              {#if !authUser}
                <p class="info-line dim-text">Sign in to play ranked.</p>
                <button
                  class="btn-primary"
                  onclick={() => openAuthModal("signin")}
                >
                  Sign In
                </button>
              {:else if !onlineRoom}
                <button
                  class="btn-primary"
                  onclick={joinCompetitiveQueue}
                  disabled={queueStatus.queued}
                >
                  {queueStatus.queued
                    ? `Queued · #${queueStatus.position}`
                    : "Enter Queue"}
                </button>
                {#if queueStatus.queued}
                  <p class="info-line dim-text">
                    Tier: <strong>{queueStatus.tier || currentRank.name}</strong
                    >
                  </p>
                  <button class="btn-ghost" onclick={leaveCompetitiveQueue}>
                    Leave
                  </button>
                {/if}
              {:else}
                <div class="room-info-block">
                  <div class="room-row dim-text">
                    vs <strong
                      >{onlineRoom.players?.[mySymbol === "X" ? "O" : "X"] ??
                        "Opponent"}</strong
                    >
                  </div>
                </div>
              {/if}
              </div>
            {/if}
          </div>
          <!-- Leaderboard in competitive -->
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.leaderboard}
              onclick={() => togglePanel("leaderboard")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("leaderboard")}
            >
              <span>Leaderboard</span>
              <ChevronRight
                size={12}
                class={ panelSections.leaderboard ? "chev-open" : "" }
              />
            </div>
            {#if panelSections.leaderboard}
              <div class="ps-body ps-lb">
              {#if leaderboard.length === 0}
                <p class="info-line dim-text">No games yet.</p>
              {:else}
                {#each leaderboard as entry, i (entry.id)}
                  <div class="lb-row" animate:flip={{ duration: 360 }}>
                    <span class="lb-pos">#{i + 1}</span>
                    <span class="lb-name">{entry.displayName}</span>
                    <span class="lb-elo">{entry.rating}</span>
                  </div>
                {/each}
              {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Scoreboard -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.score}
            onclick={() => togglePanel("score")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("score")}
          >
            <span>Score</span>
            <ChevronRight size={12} class={ panelSections.score ? "chev-open" : "" } />
          </div>
          {#if panelSections.score}
            <div class="ps-body ps-score">
            <div class="score-row">
              <div class="score-who">
                <span class="sym-x">✕</span>
                {displayNames.X}
              </div>
              <span class="score-num sc-x">{scoreboard.X}</span>
            </div>
            <div class="score-row">
              <div class="score-who">
                <span class="sym-o">○</span>
                {displayNames.O}
              </div>
              <span class="score-num sc-o">{scoreboard.O}</span>
            </div>
            <div class="score-row">
              <div class="score-who">= Draws</div>
              <span class="score-num sc-d">{scoreboard.draws}</span>
            </div>
            </div>
          {/if}
        </div>

        <!-- Match History -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.history}
            onclick={() => togglePanel("history")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("history")}
          >
            <span>History</span>
            {#if matchHistory.length > 0}<span class="ps-badge"
                >{matchHistory.length}</span
              >{/if}
            <ChevronRight size={12} class={ panelSections.history ? "chev-open" : "" } />
          </div>
          {#if panelSections.history}
            <div class="ps-body ps-history">
            {#if matchHistory.length === 0}
              <p class="info-line dim-text">No matches yet.</p>
            {:else}
              {#each matchHistory as match}
                <div class="hist-item">
                  <div class="hist-meta">
                    <span class="hist-mode-chip">{match.mode}</span>
                    <span class="hist-date"
                      >{new Date(match.endedAt).toLocaleString()}</span
                    >
                  </div>
                  <button
                    class="btn-ghost btn-xs"
                    onclick={() => openReplay(match)}
                  >
                    Replay
                  </button>
                </div>
              {/each}
            {/if}
            </div>
          {/if}
        </div>

        <!-- Annotations -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.annotations}
            onclick={() => togglePanel("annotations")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("annotations")}
          >
            <span>Annotations</span>
            <ChevronRight
              size={12}
              class={ panelSections.annotations ? "chev-open" : "" }
            />
          </div>
          {#if panelSections.annotations}
            <div class="ps-body">
            <div class="btn-row">
              <button
                class="btn-ghost"
                onclick={() => (annotationMode = !annotationMode)}
                aria-pressed={annotationMode}
                disabled={!annotationAllowed}
              >
                {annotationMode ? "Annotate On" : "Annotate Off"}
              </button>
              <button
                class="btn-ghost"
                onclick={() => (analysisMode = !analysisMode)}
                aria-pressed={analysisMode}
              >
                {analysisMode ? "Analysis On" : "Analysis Off"}
              </button>
              <button
                class="btn-ghost"
                onclick={() => (showHeatmap = !showHeatmap)}
                aria-pressed={showHeatmap}
                disabled={!currentState.winner}
              >
                Heatmap
              </button>
            </div>
            <div class="color-row">
              {#each ["red", "green", "blue", "yellow"] as color}
                <button
                  class="color-chip"
                  class:color-active={annotationColor === color}
                  style={`--chip:${color}`}
                  aria-label={`Annotation color ${color}`}
                  onclick={() => (annotationColor = color)}
                ></button>
              {/each}
            </div>
            <div class="sf">
              <label for="annotation-opacity">Annotation opacity</label>
              <input
                id="annotation-opacity"
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                bind:value={annotationOpacity}
              />
            </div>
            <button class="btn-ghost" onclick={clearAnnotations}>
              Clear Annotations
            </button>
            <button class="btn-ghost" onclick={exportAnnotations}>
              <Upload size={15} />
              Export Annotations
            </button>
            </div>
          {/if}
        </div>

        <!-- Chat -->
        {#if mode === "social" || mode === "competitive"}
          <div class="panel-section">
            <div
              class="ps-head"
              role="button"
              tabindex="0"
              aria-expanded={panelSections.chat}
              onclick={() => togglePanel("chat")}
              onkeydown={(e) => e.key === "Enter" && togglePanel("chat")}
            >
              <span>Chat</span>
              {#if chatUnread > 0}
                <span class="ps-badge badge-err">{chatUnread}</span>
              {/if}
              <ChevronRight size={12} class={ panelSections.chat ? "chev-open" : "" } />
            </div>
            {#if panelSections.chat}
              <div class="ps-body chat-body">
                <div class="chat-list">
                  {#each chatMessages.slice(-20) as msg (msg.id)}
                    <div class="chat-msg" animate:flip={{ duration: 220 }}>
                      <span class="chat-sym">
                        {msg.symbol === "X"
                          ? "✕"
                          : msg.symbol === "O"
                            ? "○"
                            : "•"}
                      </span>
                      <div class="chat-main">
                        <span class="chat-name">{msg.name ?? "Player"}</span>
                        <span class="chat-text">{msg.text}</span>
                      </div>
                    </div>
                  {/each}
                  {#if chatMessages.length === 0}
                    <span class="dim-text">No messages yet.</span>
                  {/if}
                </div>
                <div class="chat-quick">
                  {#each QUICK_REACTIONS as reaction}
                    <button
                      class="chat-quick-btn"
                      onclick={() => sendChat(reaction)}
                    >
                      {reaction}
                    </button>
                  {/each}
                </div>
                <div class="chat-input-row">
                  <input
                    placeholder="Type a message…"
                    bind:value={chatInput}
                    onkeydown={(e) => {
                      if (e.key === "Enter") sendChat();
                    }}
                  />
                  <button class="btn-primary btn-sm" onclick={() => sendChat()}>
                    Send
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- State Tools -->
        <div class="panel-section">
          <div
            class="ps-head"
            role="button"
            tabindex="0"
            aria-expanded={panelSections.state}
            onclick={() => togglePanel("state")}
            onkeydown={(e) => e.key === "Enter" && togglePanel("state")}
          >
            <span>State</span>
            <ChevronRight size={12} class={ panelSections.state ? "chev-open" : "" } />
          </div>
          {#if panelSections.state}
            <div class="ps-body">
            <label class="sr-only" for="state-json">Game state JSON</label>
            <textarea
              id="state-json"
              rows="3"
              bind:value={exportText}
              placeholder="Paste or export state JSON"
              aria-label="Game state JSON"
            ></textarea>
            <div class="btn-row">
              <button class="btn-ghost" onclick={exportGameState}>
                <Download size={15} />
                Export
              </button>
              <button class="btn-ghost" onclick={importGameState}>
                <Upload size={15} />
                Import
              </button>
            </div>
            </div>
          {/if}
        </div>
      </div>
      <!-- /panel-scroll -->
    </aside>
  </main>

  {#if !sidebarOpen}
    <button
      class="fab"
      onclick={() => (sidebarOpen = true)}
      aria-label="Open controls"
    >
      <Settings size={16} class="fab-icon" />
    </button>
  {/if}

  <!-- ═══════════════════════════════════════
       MODALS
       ═══════════════════════════════════════ -->

  <!-- Rules -->
  {#if rulesOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeRules}
      aria-label="Close rules"
      onkeydown={(e) => {
        if (e.key === "Escape") closeRules();
      }}
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="modal-sheet"
        role="dialog"
        tabindex="0"
        aria-modal="true"
        aria-labelledby="rules-title"
        use:focusTrap
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="modal-head">
          <h3 id="rules-title">Rules</h3>
          <button class="icon-btn-sm" onclick={closeRules} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <ol class="rules-ol">
          <li><strong>Win a small board</strong> by placing three in a row.</li>
          <li>
            <strong>Your move sends</strong> your opponent to the matching board.
          </li>
          <li>
            <strong>If that board is full</strong> or already won, they play anywhere.
          </li>
          <li>
            <strong>Win the meta-board</strong> by claiming three small boards in
            a row.
          </li>
        </ol>
      </div>
    </div>
  {/if}

  <!-- Auth -->
  {#if authModal.open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeAuthModal}
      aria-label="Close sign in"
      onkeydown={(e) => {
        if (e.key === "Escape") closeAuthModal();
      }}
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="modal-sheet"
        role="dialog"
        tabindex="0"
        aria-modal="true"
        aria-labelledby="auth-title"
        use:focusTrap
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="modal-head">
          <h3 id="auth-title">
            {authModal.mode === "signup" ? "Create Account" : "Sign In"}
          </h3>
          <button
            class="icon-btn-sm"
            onclick={closeAuthModal}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div class="sf">
          <label for="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            bind:value={authForm.email}
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>
        <div class="sf">
          <label for="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            bind:value={authForm.password}
            placeholder="••••••••"
            autocomplete={authModal.mode === "signup"
              ? "new-password"
              : "current-password"}
            required
          />
        </div>
        {#if authModal.mode === "signup"}
          <div class="sf">
            <label for="auth-display">Display Name</label>
            <input
              id="auth-display"
              name="displayName"
              type="text"
              bind:value={authForm.displayName}
              placeholder="Your name"
              autocomplete="nickname"
            />
          </div>
        {/if}
        <div class="btn-row">
          {#if authModal.mode === "signup"}
            <button class="btn-primary" onclick={handleEmailSignUp}>
              Create Account
            </button>
          {:else}
            <button class="btn-primary" onclick={handleEmailSignIn}>
              Sign In
            </button>
          {/if}
          <button class="btn-ghost" onclick={handleGoogleSignIn}>
            Google
          </button>
        </div>
        <button
          class="btn-ghost btn-xs"
          onclick={() =>
            (authModal = {
              ...authModal,
              mode: authModal.mode === "signup" ? "signin" : "signup",
            })}
        >
          {authModal.mode === "signup"
            ? "Already have an account?"
            : "Need an account?"}
        </button>
      </div>
    </div>
  {/if}

  <!-- Replay -->
  {#if replay.open && replay.match}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeReplay}
      aria-label="Close replay"
      onkeydown={(e) => {
        if (e.key === "Escape") closeReplay();
      }}
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="modal-sheet modal-wide"
        role="dialog"
        tabindex="0"
        aria-modal="true"
        aria-labelledby="replay-title"
        use:focusTrap
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="modal-head">
          <h3 id="replay-title">Replay - {replay.match.mode}</h3>
          <button class="icon-btn-sm" onclick={closeReplay} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        {#if replayState}
          {@const replayLast = replay.match.moves[replay.index - 1]}
          <div class="replay-board-wrap" aria-hidden="true">
            {#key replay.index}
              <div class="replay-badge">Move {replay.index}</div>
            {/key}
            <div class="ultimate-board replay-mode">
              {#each replayState.boards as board, bi}
                <div
                  class="mini-board"
                  class:mini-won={board.winner && board.winner !== "D"}
                  class:mini-drawn={board.winner === "D"}
                >
                  {#if board.winner && board.winner !== "D"}
                    <div
                      class="board-overlay"
                      class:ov-x={board.winner === "X"}
                      class:ov-o={board.winner === "O"}
                      aria-hidden="true"
                    >
                      <span class="board-overlay-sym"
                        >{board.winner === "X" ? "✕" : "○"}</span
                      >
                    </div>
                  {/if}
                  {#if board.winLine && board.winner && board.winner !== "D"}
                    <div
                      class={`win-strike ${getWinLineClass(board.winLine)} ${board.winner === "X" ? "strike-x" : "strike-o"}`}
                      aria-hidden="true"
                    ></div>
                  {/if}
                  {#each board.cells as cell, cellIndex}
                    {@const isReplayLast =
                      replayLast &&
                      replayLast.board === bi &&
                      replayLast.cell === cellIndex}
                    <div
                      class="cell replay-cell"
                      class:cell-replay-last={isReplayLast}
                    >
                      {#if cell === "X"}<span
                          class="cell-sym sym-x"
                          aria-hidden="true">✕</span
                        >{:else if cell === "O"}<span
                          class="cell-sym sym-o"
                          aria-hidden="true">○</span
                        >{/if}
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="replay-controls">
          <button
            class="btn-ghost"
            onclick={() => (replay.index = 0)}
            aria-label="Go to start"
          >
            Start
          </button>
          <button
            class="btn-ghost"
            onclick={() => (replay.index = Math.max(0, replay.index - 1))}
            aria-label="Previous move"
          >
            Prev
          </button>
          <button class="btn-primary" onclick={toggleReplayPlay}>
            {#if replay.playing}Pause{:else}Play{/if}
          </button>
          <button
            class="btn-ghost"
            onclick={() =>
              (replay.index = Math.min(
                replay.match.moves.length,
                replay.index + 1,
              ))}
            aria-label="Next move"
          >
            Next
          </button>
          <button
            class="btn-ghost"
            onclick={() => (replay.index = replay.match.moves.length)}
            aria-label="Go to end"
          >
            End
          </button>
        </div>
        <div class="replay-progress">
          <div class="rp-track">
            <div
              class="rp-fill"
              style="width:{replay.match.moves.length > 0
                ? (replay.index / replay.match.moves.length) * 100
                : 0}%"
            ></div>
          </div>
          <span class="rp-label"
            >Move {replay.index} / {replay.match.moves.length}</span
          >
        </div>
      </div>
    </div>
  {/if}

  <!-- Win Modal -->
  {#if winModal.open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="win-backdrop"
      role="button"
      tabindex="0"
      onclick={closeWinModal}
      aria-label="Close result"
      onkeydown={(e) => {
        if (e.key === "Escape") closeWinModal();
      }}
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="win-modal"
        role="dialog"
        tabindex="0"
        aria-modal="true"
        aria-labelledby="win-title"
        use:focusTrap
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="win-particles" aria-hidden="true">
          {#each Array(18) as _, i}
            <div class="win-particle" style="--i:{i};--deg:{i * 20}deg"></div>
          {/each}
        </div>
        <div
          class="win-sym-wrap"
          class:ws-x={winModal.winner === "X"}
          class:ws-o={winModal.winner === "O"}
          class:ws-draw={winModal.winner === "D"}
        >
          {#if winModal.winner === "D"}
            <span class="win-sym">⊜</span>
          {:else}
            <span class="win-sym">{winModal.winner === "X" ? "✕" : "○"}</span>
          {/if}
        </div>
        <h2 id="win-title" class="win-title">
          {#if winModal.winner === "D"}
            It's a Draw
          {:else}
            {currentState.players?.[winModal.winner] ?? "Player"} Wins!
          {/if}
        </h2>
        <p class="win-sub" class:win-timeout={winModal.reason === "timeout"}>
          {#if winModal.reason === "timeout"}
            <Clock size={14} />
            <span>Win by timeout</span>
          {:else}
            {statusLine}
          {/if}
        </p>
        <div class="win-actions">
          {#if mode === "social" || mode === "competitive"}
            {#if spectator}
              <button
                class="btn-primary"
                onclick={() => {
                  openMenu();
                  closeWinModal();
                }}
              >
                Back to Lobby
              </button>
            {:else}
              <button
                class="btn-primary"
                onclick={() => {
                  requestRematch();
                  closeWinModal();
                }}
                disabled={!onlineRoom}
              >
                Rematch
              </button>
            {/if}
          {:else}
            <button
              class="btn-primary"
              onclick={() => {
                resetLocalGame();
                closeWinModal();
              }}
            >
              New Game
            </button>
          {/if}
          <button class="btn-ghost" onclick={closeWinModal}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Toast Notifications -->
  <div class="toast-zone" role="status" aria-live="polite" aria-atomic="true">
    {#each toastList as t (t.id)}
      <div
        class="toast"
        class:toast-err={t.tone === "error"}
        class:toast-ok={t.tone === "success"}
        class:toast-trophy={t.tone === "trophy"}
        class:toast-persistent={t.persistent}
        style={`--toast-duration:${t.duration ?? 3200}ms;`}
      >
        <div class="toast-icon" aria-hidden="true">
          {#if t.tone === "trophy"}
            <Trophy size={28} />
          {:else}
            <span class="toast-dot"></span>
          {/if}
        </div>
        <div class="toast-body">
          {#if t.title}
            <strong class="toast-title">{t.title}</strong>
            {#if t.subtitle}
              <span class="toast-sub">{t.subtitle}</span>
            {/if}
          {:else}
            <span>{t.message}</span>
          {/if}
          {#if t.actions && t.actions.length > 0}
            <div class="toast-actions">
              {#each t.actions as action}
                <button
                  class="toast-action"
                  onclick={() => {
                    action.action?.();
                    dismissToast(t.id);
                  }}
                >
                  {action.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if t.persistent}
          <button
            class="toast-close"
            aria-label="Dismiss"
            onclick={() => dismissToast(t.id)}
          >
            Dismiss
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* ═══════════════════════════════════════════════════════
     DESIGN TOKENS
     ═══════════════════════════════════════════════════════ */
  :global(:root) {
    /* Typography */
    --font-mono: "Space Mono", "Courier New", monospace;
    --font-sans: "DM Sans", system-ui, sans-serif;

    /* Spacing (4px grid) */
    --s1: 4px;
    --s2: 8px;
    --s3: 12px;
    --s4: 16px;
    --s5: 20px;
    --s6: 24px;
    --s7: 28px;
    --s8: 32px;
    --s10: 40px;
    --s12: 48px;

    /* Radii */
    --r-xs: 4px;
    --r-sm: 8px;
    --r-md: 12px;
    --r-lg: 16px;
    --r-xl: 24px;
    --r-2xl: 32px;
    --r-pill: 9999px;

    /* Motion */
    --dur-fast: 100ms;
    --dur-base: 180ms;
    --dur-slow: 320ms;
    --dur-enter: 400ms;
    --dur-exit: 200ms;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --ease-in: cubic-bezier(0.4, 0, 1, 1);
    --ease-inout: cubic-bezier(0.65, 0, 0.35, 1);
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --ease-bounce: cubic-bezier(0.175, 0.885, 0.32, 1.275);

    /* Elevation (shadow system) */
    --elev-1: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08);
    --elev-2: 0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1);
    --elev-3: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12);
    --elev-4: 0 24px 64px rgba(0, 0, 0, 0.32), 0 8px 20px rgba(0, 0, 0, 0.16);
  }

  /* ── DARK THEME ─────────────────────────────────────── */
  :global(body),
  :global(body[data-theme="dark"]) {
    /* Canvas */
    --bg-deep: #040810;
    --bg-base: #070d18;
    --bg-raised: #0c1524;
    --bg-float: #111e30;

    /* Glass surfaces */
    --glass-bg: rgba(12, 21, 36, 0.78);
    --glass-bg-hover: rgba(17, 30, 48, 0.88);
    --glass-border: rgba(255, 255, 255, 0.07);
    --glass-border-hi: rgba(255, 255, 255, 0.14);
    --glass-blur: 20px;

    /* Text */
    --text-1: #e8f0fa;
    --text-2: #9ab2cc;
    --text-3: #4e6a87;

    /* Brand / Primary (electric blue) */
    --brand: #4db8ff;
    --brand-dim: rgba(77, 184, 255, 0.14);
    --brand-glow: rgba(77, 184, 255, 0.32);
    --on-brand: #020e1a;

    /* Player X (amber) */
    --x-hue: 34;
    --x-col: hsl(34, 96%, 60%);
    --x-dim: hsla(34, 96%, 60%, 0.14);
    --x-glow: hsla(34, 96%, 60%, 0.38);

    /* Player O (sky) */
    --o-hue: 204;
    --o-col: hsl(204, 92%, 62%);
    --o-dim: hsla(204, 92%, 62%, 0.14);
    --o-glow: hsla(204, 92%, 62%, 0.38);

    /* Win / Success */
    --win-col: #50e07a;
    --win-glow: rgba(80, 224, 122, 0.3);

    /* Error */
    --err-col: #ff5c72;
    --success: var(--win-col);
    --warning: #f5b955;
    --danger: var(--err-col);

    /* Board */
    --board-gap: 8px;
    --board-pad: 10px;
    --board-bg: #08101e;
    --board-border: rgba(255, 255, 255, 0.06);
    --cell-bg: #0d1a2b;
    --cell-border: rgba(255, 255, 255, 0.04);
    --cell-hover-bg: rgba(77, 184, 255, 0.09);

    /* Components */
    --topbar-h: 56px;
    --sidebar-w: 340px;

    color-scheme: dark;
  }

  /* ── LIGHT THEME ────────────────────────────────────── */
  :global(body[data-theme="light"]) {
    --bg-deep: #dfe6f0;
    --bg-base: #ebf0f8;
    --bg-raised: #f4f7fc;
    --bg-float: #ffffff;

    --glass-bg: rgba(255, 255, 255, 0.75);
    --glass-bg-hover: rgba(255, 255, 255, 0.92);
    --glass-border: rgba(0, 0, 0, 0.07);
    --glass-border-hi: rgba(0, 0, 0, 0.14);
    --glass-blur: 18px;

    --text-1: #0f1e33;
    --text-2: #4a6080;
    --text-3: #8ca5bf;

    --brand: #0077d6;
    --brand-dim: rgba(0, 119, 214, 0.1);
    --brand-glow: rgba(0, 119, 214, 0.22);
    --on-brand: #ffffff;

    --x-col: hsl(27, 90%, 50%);
    --x-dim: hsla(27, 90%, 50%, 0.1);
    --x-glow: hsla(27, 90%, 50%, 0.28);

    --o-col: hsl(207, 88%, 48%);
    --o-dim: hsla(207, 88%, 48%, 0.1);
    --o-glow: hsla(207, 88%, 48%, 0.28);

    --win-col: #16a34a;
    --win-glow: rgba(22, 163, 74, 0.22);
    --err-col: #dc2626;
    --success: var(--win-col);
    --warning: #d97706;
    --danger: var(--err-col);

    --board-bg: #e2eaf5;
    --board-border: rgba(0, 0, 0, 0.06);
    --cell-bg: #f5f8fd;
    --cell-border: rgba(0, 0, 0, 0.05);
    --cell-hover-bg: rgba(0, 119, 214, 0.07);

    color-scheme: light;
  }

  /* ── HIGH CONTRAST ───────────────────────────────────── */
  :global(body[data-hc="true"]) {
    --x-col: #ff6600;
    --o-col: #00ccff;
    --brand: #ffff00;
    --text-1: #ffffff;
    --text-2: #cccccc;
    --board-bg: #000000;
    --cell-bg: #111111;
    --bg-base: #000000;
    --glass-bg: rgba(0, 0, 0, 0.95);
    --glass-border: rgba(255, 255, 255, 0.5);
    color-scheme: dark;
  }

  /* ═══════════════════════════════════════════════════════
     GLOBAL RESET & BASE
     ═══════════════════════════════════════════════════════ */
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  :global(html) {
    height: 100%;
    overflow: hidden;
    scroll-behavior: smooth;
  }
  :global(body) {
    font-family: var(--font-sans);
    font-size: 14px;
    background: var(--bg-base);
    color: var(--text-1);
    height: 100%;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  :global(button) {
    transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(button:active) {
    transform: scale(0.96);
    transition-duration: 80ms;
  }
  :global(input),
  :global(select),
  :global(textarea) {
    transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  :global(input:hover),
  :global(select:hover),
  :global(textarea:hover) {
    transform: translateY(-1px);
  }
  :global(input:focus),
  :global(select:focus),
  :global(textarea:focus) {
    outline: none;
    box-shadow:
      0 0 0 2px var(--brand-dim),
      0 0 0 3px var(--brand);
  }
  :global(::selection) {
    background: var(--brand);
    color: var(--on-brand);
  }
  :global(::-webkit-scrollbar) {
    width: 3px;
  }
  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--glass-border-hi);
    border-radius: 3px;
  }
  .spin {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Skip link */
  .skip-link {
    position: absolute;
    top: var(--s3);
    left: var(--s3);
    padding: var(--s2) var(--s4);
    border-radius: var(--r-pill);
    background: var(--brand);
    color: var(--on-brand);
    font-weight: 700;
    font-size: 0.8rem;
    text-decoration: none;
    transform: translateY(-200%);
    transition: transform var(--dur-base) var(--ease-out);
    z-index: 9999;
  }
  .skip-link:focus {
    transform: translateY(0);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ═══════════════════════════════════════════════════════
     APP SHELL
     ═══════════════════════════════════════════════════════ */
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-base);
  }

  /* Cursor light - follows mouse */
  .cursor-light {
    position: fixed;
    left: 0;
    top: 0;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: radial-gradient(
      circle at center,
      var(--brand-glow) 0%,
      transparent 70%
    );
    transform: translate(calc(var(--cx) - 300px), calc(var(--cy) - 300px));
    pointer-events: none;
    z-index: 0;
    opacity: 0.35;
    transition: transform 0.08s linear;
    will-change: transform;
  }
  :global(body[data-theme="light"]) .cursor-light {
    opacity: 0.18;
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
    filter: blur(90px);
    animation: orb-drift 24s ease-in-out infinite alternate;
    will-change: transform;
  }
  .orb-a {
    width: 580px;
    height: 580px;
    background: radial-gradient(
      circle,
      hsla(204, 92%, 55%, 0.22),
      transparent 68%
    );
    top: -200px;
    left: -120px;
    animation-duration: 26s;
  }
  .orb-b {
    width: 440px;
    height: 440px;
    background: radial-gradient(
      circle,
      hsla(34, 96%, 55%, 0.16),
      transparent 68%
    );
    bottom: -140px;
    right: -100px;
    animation-duration: 32s;
    animation-delay: -10s;
  }
  .orb-c {
    width: 340px;
    height: 340px;
    background: radial-gradient(
      circle,
      hsla(150, 70%, 50%, 0.1),
      transparent 68%
    );
    top: 45%;
    right: 22%;
    animation-duration: 20s;
    animation-delay: -16s;
  }
  :global(body[data-theme="light"]) .orb {
    opacity: 0.6;
    filter: blur(110px);
  }
  @keyframes orb-drift {
    0% {
      transform: translate(0, 0) scale(1);
    }
    50% {
      transform: translate(22px, 14px) scale(1.05);
    }
    100% {
      transform: translate(-12px, 26px) scale(0.97);
    }
  }
  .noise {
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    background-size: 200px 200px;
    opacity: 0.4;
    mix-blend-mode: overlay;
  }
  .grid-lines {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
        rgba(255, 255, 255, 0.025) 1px,
        transparent 1px
      ),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 52px 52px;
  }
  :global(body[data-theme="light"]) .grid-lines {
    background-image: linear-gradient(rgba(0, 0, 0, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0, 0, 0, 0.025) 1px, transparent 1px);
  }

  /* ═══════════════════════════════════════════════════════
     TOP BAR
     ═══════════════════════════════════════════════════════ */
  .topbar {
    position: relative;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s4);
    height: var(--topbar-h);
    padding: 0 var(--s5);
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    flex-shrink: 0;
  }

  .topbar-brand {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  .brand-icon {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--brand-dim);
    border: 1px solid var(--brand-glow);
    border-radius: var(--r-sm);
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    box-shadow: 0 0 16px var(--brand-glow);
  }
  .bi-x {
    color: var(--x-col);
  }
  .bi-o {
    color: var(--o-col);
    margin-left: 3px;
  }
  .brand-wordmark h1 {
    font-family: var(--font-mono);
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .brand-wordmark h1 em {
    font-style: normal;
    color: var(--brand);
  }

  .topbar-status {
    flex: 1;
    display: flex;
    justify-content: center;
  }
  .status-capsule {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: 5px 14px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-1);
    transition: all var(--dur-slow) var(--ease-out);
    box-shadow: var(--elev-1);
  }
  .status-capsule.is-winner {
    background: rgba(80, 224, 122, 0.1);
    border-color: var(--win-col);
    color: var(--win-col);
    box-shadow:
      0 0 0 1px var(--win-col),
      0 0 24px var(--win-glow);
    animation: capsule-pulse 1.2s ease-in-out infinite alternate;
  }
  .status-capsule.is-draw {
    border-color: var(--text-3);
    color: var(--text-2);
  }
  @keyframes capsule-pulse {
    from {
      box-shadow:
        0 0 0 1px var(--win-col),
        0 0 16px var(--win-glow);
    }
    to {
      box-shadow:
        0 0 0 1px var(--win-col),
        0 0 36px var(--win-glow);
    }
  }
  .player-pip {
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .pip-x {
    color: var(--x-col);
  }
  .pip-o {
    color: var(--o-col);
  }

  .topbar-controls {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .topbar-btn {
    min-width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 10px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    color: var(--text-2);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all var(--dur-base) var(--ease-out);
    will-change: transform;
  }
  .topbar-btn:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hi);
    color: var(--text-1);
    transform: translateY(-1px) scale(1.04);
    box-shadow: var(--elev-2);
  }
  .topbar-btn:active {
    transform: translateY(0) scale(0.97);
    transition-duration: var(--dur-fast);
  }
  .topbar-btn-active {
    background: var(--brand-dim);
    border-color: var(--brand);
    color: var(--brand);
    box-shadow: 0 0 12px var(--brand-glow);
  }
  .topbar-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: inherit;
  }
  .spectator-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--glass-border-hi);
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .eye-pulse {
    animation: eye-pulse 2s ease-in-out infinite;
  }
  @keyframes eye-pulse {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(0.7);
    }
  }

  /* ═══════════════════════════════════════════════════════
     MENU OVERLAY
     ═══════════════════════════════════════════════════════ */
  .menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s6);
    background: rgba(4, 8, 16, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: fade-in var(--dur-enter) var(--ease-out);
  }
  :global(body[data-theme="light"]) .menu-overlay {
    background: rgba(200, 214, 230, 0.65);
  }

  .menu-shell {
    width: min(900px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-2xl);
    padding: var(--s7);
    box-shadow: var(--elev-4);
    display: flex;
    flex-direction: column;
    gap: var(--s6);
    backdrop-filter: blur(24px);
    animation: slide-up var(--dur-enter) var(--ease-spring);
  }
  .menu-hero,
  .mode-grid,
  .menu-actions,
  .menu-lobby {
    animation: slide-up var(--dur-enter) var(--ease-spring) both;
  }
  .menu-hero {
    animation-delay: 0ms;
  }
  .mode-grid {
    animation-delay: 60ms;
  }
  .menu-actions {
    animation-delay: 120ms;
  }
  .menu-lobby {
    animation-delay: 180ms;
  }
  .menu-resume {
    width: 100%;
    justify-content: center;
    gap: var(--s3);
    font-size: 1rem;
    height: 52px;
    padding: 0 var(--s5);
    animation: resume-glow 2s ease-in-out infinite;
  }
  @keyframes resume-glow {
    0% {
      box-shadow: 0 0 12px var(--brand-glow);
    }
    50% {
      box-shadow: 0 0 32px var(--brand-glow);
    }
    100% {
      box-shadow: 0 0 12px var(--brand-glow);
    }
  }

  .install-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    padding: var(--s3);
    border-radius: var(--r-lg);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    animation: install-in 0.4s var(--ease-out) both;
  }
  .install-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.78rem;
  }
  @keyframes install-in {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .menu-hero {
    display: flex;
    align-items: center;
    gap: var(--s6);
  }
  .menu-logo {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-family: var(--font-mono);
    font-size: 2.2rem;
    font-weight: 700;
    flex-shrink: 0;
  }
  .logo-x {
    color: var(--x-col);
    text-shadow: 0 0 24px var(--x-glow);
  }
  .logo-o {
    color: var(--o-col);
    text-shadow: 0 0 24px var(--o-glow);
  }
  .logo-divider {
    width: 2px;
    height: 40px;
    background: var(--glass-border-hi);
    border-radius: 2px;
  }
  .menu-titles {
    flex: 1;
  }
  .menu-eyebrow {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .menu-heading {
    font-family: var(--font-mono);
    font-size: clamp(1.8rem, 4vw, 3rem);
    font-weight: 700;
    color: var(--text-1);
    line-height: 1.1;
    margin: var(--s1) 0 var(--s2);
  }
  .menu-heading em {
    font-style: normal;
    color: var(--brand);
  }
  .menu-sub {
    color: var(--text-2);
    font-size: 0.9rem;
  }

  /* Mode grid */
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s3);
  }
  .mode-card {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s4) var(--s4);
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-lg);
    cursor: pointer;
    text-align: left;
    transition: all var(--dur-base) var(--ease-out);
    position: relative;
    overflow: hidden;
    will-change: transform;
  }
  .mode-card-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    width: 100%;
  }
  .mode-card::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--brand-dim), transparent);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .mode-card:hover {
    transform: translateY(-4px);
    border-color: var(--glass-border-hi);
    box-shadow: var(--elev-3);
  }
  .mode-card:hover::before {
    opacity: 1;
  }
  .mode-card:hover .mode-card-icon {
    transform: scale(1.12);
    filter: brightness(1.15);
  }
  .mode-card:active {
    transform: translateY(-1px) scale(0.99);
  }
  .mode-card-ranked {
    border-color: hsla(40, 100%, 50%, 0.15);
  }
  .mode-card-ranked::before {
    background: linear-gradient(135deg, hsla(40, 100%, 50%, 0.08), transparent);
  }
  .mode-active {
    border-color: var(--brand) !important;
    box-shadow:
      0 0 0 1px var(--brand),
      0 0 20px var(--brand-glow) !important;
    flex-direction: column;
    align-items: stretch;
    gap: var(--s3);
  }
  .mode-active::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      105deg,
      transparent 20%,
      rgba(255, 255, 255, 0.06) 50%,
      transparent 80%
    );
    background-size: 200% 200%;
    animation: shimmer 3s linear infinite;
    pointer-events: none;
  }
  @keyframes shimmer {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }
  .mode-card-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--mode-accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--mode-accent) 45%, transparent);
    border-radius: var(--r-sm);
    color: var(--mode-accent);
    font-size: 1rem;
    position: relative;
    z-index: 1;
    transition: transform var(--dur-base) var(--ease-out),
      filter var(--dur-base) var(--ease-out);
    box-shadow: 0 0 16px var(--mode-glow);
  }
  .mode-card-body {
    flex: 1;
    min-width: 0;
    position: relative;
    z-index: 1;
  }
  .mode-card-body strong {
    display: block;
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .mode-card-body span {
    font-size: 0.74rem;
    color: var(--text-2);
  }
  .mode-card-cta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s1);
    width: 100%;
    margin-top: auto;
    padding-top: var(--s2);
  }
  .mode-warning {
    font-size: 0.65rem;
    color: var(--warning);
    max-width: 100%;
    text-align: left;
  }
  .mode-card-arrow {
    color: var(--text-3);
    font-size: 0.75rem;
    transition: transform var(--dur-base) var(--ease-out);
  }
  /* .mode-card:hover .mode-card-arrow {
    transform: translateX(3px);
    color: var(--brand);
  } */

  /* Menu action buttons */
  .menu-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }
  .menu-action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s4);
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
    will-change: transform;
  }
  .menu-action-btn:hover {
    background: var(--glass-bg-hover);
    color: var(--text-1);
    border-color: var(--glass-border-hi);
    transform: translateY(-1px);
  }
  .menu-action-btn:active {
    transform: translateY(0) scale(0.98);
  }
  .menu-action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
  }
  .menu-action-primary {
    background: var(--brand-dim);
    border-color: var(--brand);
    color: var(--brand);
  }
  .menu-action-primary:hover {
    background: var(--brand);
    color: var(--on-brand);
    box-shadow: 0 0 20px var(--brand-glow);
  }
  .menu-action-primary.has-game {
    animation: action-pulse 2s ease-in-out infinite alternate;
  }
  @keyframes action-pulse {
    from {
      box-shadow: 0 0 8px var(--brand-glow);
    }
    to {
      box-shadow: 0 0 24px var(--brand-glow);
    }
  }

  /* Glass card sub-panel */
  .glass-card {
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-xl);
    padding: var(--s5);
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }
  .lobby-header h3 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .lobby-tagline {
    font-size: 0.78rem;
    color: var(--text-3);
  }
  .active-room {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .room-code-display {
    display: flex;
    align-items: center;
    gap: var(--s3);
    background: var(--bg-float);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-md);
    padding: var(--s3) var(--s4);
  }
  .room-code-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-3);
  }
  .room-code-value {
    font-family: var(--font-mono);
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--brand);
    letter-spacing: 0.12em;
    flex: 1;
  }
  .room-meta {
    display: flex;
    gap: var(--s4);
    font-size: 0.78rem;
    color: var(--text-2);
  }
  /* .room-meta i {
    color: var(--text-3);
    margin-right: 4px;
  } */
  .lobby-controls {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .lobby-join {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .lobby-join input {
    flex: 1;
  }

  /* Menu panel card (settings, profile) */
  .menu-panel-card {
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-xl);
    padding: var(--s5);
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }
  .panel-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .panel-card-header h3 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--s3);
  }
  .setting-field {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
  .setting-field label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-3);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .toggle-row {
    display: flex;
    gap: var(--s2);
    flex-wrap: wrap;
  }
  .toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
  }
  .toggle-btn:hover {
    background: var(--glass-bg-hover);
    color: var(--text-1);
    border-color: var(--glass-border-hi);
  }

  /* Profile */
  .profile-hero {
    display: flex;
    align-items: center;
    gap: var(--s4);
  }
  .profile-rank-badge {
    width: 44px;
    height: 44px;
    border-radius: var(--r-md);
    background: var(--bg-float);
    border: 1px solid var(--glass-border-hi);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 16px rgba(0, 0, 0, 0.2);
  }
  /* .profile-rank-badge i {
    color: var(--rc, var(--brand));
    font-size: 1.1rem;
  } */
  .profile-name-block {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .profile-name-block strong {
    font-size: 0.95rem;
    color: var(--text-1);
  }
  .profile-rank-label {
    font-size: 0.75rem;
    color: var(--text-3);
  }
  .profile-stats-row {
    display: flex;
    gap: var(--s4);
  }
  .pstat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .pstat-num {
    font-family: var(--font-mono);
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1;
  }
  .pstat-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
  }
  .pstat-win .pstat-num {
    color: var(--win-col);
  }
  .pstat-loss .pstat-num {
    color: var(--err-col);
  }
  .pstat-draw .pstat-num {
    color: var(--text-2);
  }

  .mini-leaderboard {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .mini-lb-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
    padding-bottom: var(--s2);
    border-bottom: 1px solid var(--glass-border);
  }
  .mini-lb-row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    font-size: 0.8rem;
    padding: var(--s1) 0;
  }
  .mini-lb-row.lb-self {
    color: var(--brand);
  }
  .lb-pos {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-3);
    min-width: 20px;
  }
  .lb-name {
    flex: 1;
    color: var(--text-1);
  }
  .lb-elo {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--text-2);
  }

  /* ═══════════════════════════════════════════════════════
     LAYOUT
     ═══════════════════════════════════════════════════════ */
  .layout {
    position: relative;
    z-index: 1;
    flex: 1;
    display: block;
    overflow: hidden;
    min-height: 0;
    transition: padding-right var(--dur-slow) var(--ease-out);
  }
  .layout.has-sidebar {
    padding-right: var(--sidebar-w);
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: rgba(4, 8, 16, 0.55);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-slow) var(--ease-out);
    z-index: 2;
  }
  .scrim-show {
    opacity: 1;
    pointer-events: auto;
  }
  @media (min-width: 1100px) {
    .scrim {
      display: none;
    }
  }

  /* ═══════════════════════════════════════════════════════
     BOARD ZONE
     ═══════════════════════════════════════════════════════ */
  .board-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
    padding: var(--s4) var(--s5);
    height: 100%;
    overflow: hidden;
    min-height: 0;
  }
  .board-stage {
    --timer-left-w: clamp(210px, 22vw, 260px);
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
    justify-items: center;
    gap: var(--s4);
  }
  .board-stage.has-side {
    grid-template-columns: var(--timer-left-w) minmax(0, 1fr);
    align-items: start;
    justify-content: center;
  }
  .side-timers {
    width: var(--timer-left-w);
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .side-timers .turn-timer-bar,
  .side-timers .chess-banks {
    width: 100%;
  }
  .board-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
    width: 100%;
    position: relative;
  }
  .board-wrap {
    position: relative;
    width: max-content;
    max-width: 100%;
    display: flex;
    justify-content: center;
  }

  /* HUD bar */
  .hud-bar {
    display: flex;
    align-items: stretch;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-xl);
    overflow: hidden;
    width: min(var(--board-max, 700px), 100%);
    box-shadow: var(--elev-1);
    flex-shrink: 0;
    backdrop-filter: blur(var(--glass-blur));
  }
  .hud-segment {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s3) var(--s4);
    flex: 1;
  }
  .hud-divider {
    width: 1px;
    background: var(--glass-border);
    flex-shrink: 0;
  }
  .hud-label {
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-3);
  }
  .hud-value {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-1);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hud-player .player-sym {
    font-family: var(--font-mono);
    font-size: 1rem;
  }
  .hud-room {
    gap: var(--s2);
  }
  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
    flex-shrink: 0;
    transition: background var(--dur-slow) ease;
  }
  .conn-on {
    background: var(--win-col);
    box-shadow: 0 0 8px var(--win-glow);
    animation: dot-blink 2s ease-in-out infinite;
  }
  .conn-mid {
    background: var(--x-col);
    animation: dot-blink 0.6s ease-in-out infinite;
  }
  @keyframes dot-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  .ml-auto {
    margin-left: auto;
  }

  /* Turn banner */
  .turn-banner {
    width: min(var(--board-max, 700px), 100%);
    padding: var(--s3) var(--s4);
    border-radius: var(--r-pill);
    text-align: center;
    font-size: 0.85rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    color: var(--text-1);
    box-shadow: var(--elev-1);
  }
  .turn-banner.turn-active {
    box-shadow:
      0 0 20px var(--brand-glow),
      inset 0 0 18px var(--brand-dim);
    animation: turn-glow 1.4s ease-in-out infinite alternate;
  }
  .board-zone[data-player="X"] .turn-banner {
    color: var(--x-col);
    --turn-glow: var(--x-col);
    text-shadow: 0 0 8px var(--x-glow);
  }
  .board-zone[data-player="O"] .turn-banner {
    color: var(--o-col);
    --turn-glow: var(--o-col);
    text-shadow: 0 0 8px var(--o-glow);
  }
  @keyframes turn-glow {
    from {
      text-shadow: 0 0 8px var(--turn-glow);
    }
    to {
      text-shadow: 0 0 22px var(--turn-glow);
    }
  }

  .shared-banner {
    width: min(var(--board-max, 700px), 100%);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    border-radius: var(--r-md);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    font-size: 0.72rem;
    color: var(--text-2);
  }
  .heatmap-legend {
    width: min(var(--board-max, 700px), 100%);
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.68rem;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .heatmap-bar {
    flex: 1;
    height: 6px;
    border-radius: var(--r-pill);
    background: linear-gradient(
      90deg,
      rgba(255, 92, 114, 0.1),
      rgba(255, 92, 114, 0.55)
    );
    border: 1px solid var(--glass-border);
  }
  .puzzle-confetti-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .puzzle-confetti {
    position: absolute;
    width: var(--size);
    height: var(--size);
    background: var(--brand);
    border-radius: 2px;
    transform: translate(-50%, -50%) rotate(var(--deg)) translateY(0);
    animation: puzzle-burst 1.2s var(--ease-out) forwards;
  }
  .puzzle-confetti:nth-child(3n) {
    background: var(--x-col);
  }
  .puzzle-confetti:nth-child(3n + 1) {
    background: var(--o-col);
  }
  @keyframes puzzle-burst {
    0% {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(var(--deg)) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(var(--deg)) translateY(-90px);
    }
  }

  /* Timer bar */
  .turn-timer-bar {
    width: min(var(--board-max, 700px), 100%);
    position: relative;
    padding: var(--s2);
    border-radius: var(--r-pill);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    box-shadow: var(--elev-1);
    overflow: hidden;
  }
  .turn-timer-bar.timer-left {
    padding: var(--s3);
  }
  .turn-timer-track {
    height: 10px;
    border-radius: var(--r-pill);
    background: var(--glass-border);
    overflow: hidden;
  }
  .turn-timer-fill {
    position: relative;
    height: 100%;
    transition: width 0.28s linear;
    box-shadow: 0 0 12px var(--brand-glow);
    overflow: hidden;
  }
  .turn-timer-fill::after {
    content: "";
    position: absolute;
    top: -50%;
    width: 20px;
    height: 200%;
    background: rgba(255, 255, 255, 0.35);
    filter: blur(2px);
    animation: glint 2s linear infinite;
    left: -5%;
  }
  .turn-timer-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-1);
    pointer-events: none;
  }
  .turn-timer-caption {
    position: absolute;
    left: var(--s3);
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-3);
    pointer-events: none;
  }
  .turn-timer-bar.timer-left .turn-timer-caption {
    left: var(--s4);
  }
  .timer-urgent .turn-timer-fill {
    background: linear-gradient(90deg, var(--danger), var(--x-col));
    box-shadow: 0 0 14px rgba(255, 92, 114, 0.4);
  }
  .timer-urgent {
    animation: timer-pulse 0.9s ease-in-out infinite;
  }
  @keyframes timer-pulse {
    0%,
    100% {
      box-shadow: var(--elev-1);
    }
    50% {
      box-shadow: 0 0 18px rgba(255, 92, 114, 0.45);
    }
  }
  .corner-timer {
    position: absolute;
    left: var(--s3);
    bottom: var(--s3);
    width: 62px;
    height: 62px;
    border-radius: 50%;
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    box-shadow: var(--elev-2);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--text-1);
    pointer-events: none;
  }
  .corner-ring {
    position: absolute;
    inset: 6px;
    border-radius: 50%;
    background: conic-gradient(var(--ring) var(--pct), rgba(255, 255, 255, 0.12) 0);
    -webkit-mask: radial-gradient(circle, transparent 62%, #000 63%);
    mask: radial-gradient(circle, transparent 62%, #000 63%);
  }
  .corner-time {
    font-size: 0.74rem;
    letter-spacing: 0.02em;
  }
  @keyframes glint {
    0% {
      left: -5%;
    }
    100% {
      left: 105%;
    }
  }

  /* Chess clock banks */
  .chess-banks {
    width: min(var(--board-max, 700px), 100%);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .bank {
    position: relative;
    padding: var(--s3);
    border-radius: var(--r-lg);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .bank-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .bank-sym {
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
  .bank-name {
    flex: 1;
    font-weight: 600;
    color: var(--text-2);
  }
  .bank-time {
    font-family: var(--font-mono);
    font-size: 0.98rem;
    font-weight: 700;
  }
  .bank-inc {
    border: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-1);
    border-radius: var(--r-pill);
    padding: 2px 8px;
    font-size: 0.6rem;
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
  }
  .bank-inc:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hi);
  }
  .bank-track {
    height: 8px;
    border-radius: var(--r-pill);
    background: var(--glass-border);
    overflow: hidden;
  }
  .bank-fill {
    height: 100%;
    transition: width 0.28s linear, background 0.3s ease;
  }
  .bank-x .bank-fill {
    background: linear-gradient(90deg, var(--x-col), color-mix(in srgb, var(--x-col) 60%, white));
  }
  .bank-o .bank-fill {
    background: linear-gradient(90deg, var(--o-col), color-mix(in srgb, var(--o-col) 60%, white));
  }
  .bank-active {
    animation: bank-active-pulse 1.2s ease-in-out infinite;
  }
  .bank-active.bank-x {
    border-left: 4px solid var(--x-col);
    box-shadow: 0 0 18px var(--x-glow);
    --bank-glow: var(--x-glow);
  }
  .bank-active.bank-o {
    border-left: 4px solid var(--o-col);
    box-shadow: 0 0 18px var(--o-glow);
    --bank-glow: var(--o-glow);
  }
  .bank-low {
    border-color: var(--err-col);
    animation:
      bank-danger-pulse 0.7s ease-in-out infinite alternate,
      bank-shake 5s ease-in-out infinite;
  }
  .bank-low .bank-fill {
    background: linear-gradient(90deg, var(--err-col), hsl(0, 90%, 45%));
  }
  .bank-flash {
    animation: bank-flash 0.4s ease;
  }
  @keyframes bank-flash {
    0% {
      box-shadow: 0 0 0 rgba(80, 224, 122, 0);
    }
    50% {
      box-shadow:
        0 0 0 2px var(--win-col),
        0 0 18px var(--win-glow);
    }
    100% {
      box-shadow: none;
    }
  }
  @keyframes bank-active-pulse {
    0%,
    100% {
      box-shadow: 0 0 12px var(--bank-glow);
    }
    50% {
      box-shadow: 0 0 26px var(--bank-glow);
    }
  }
  @keyframes bank-danger-pulse {
    0% {
      border-color: transparent;
    }
    100% {
      border-color: var(--err-col);
    }
  }
  @keyframes bank-shake {
    0%,
    90% {
      transform: translateX(0);
    }
    92% {
      transform: translateX(-3px);
    }
    94% {
      transform: translateX(3px);
    }
    96% {
      transform: translateX(-2px);
    }
    98% {
      transform: translateX(2px);
    }
    100% {
      transform: translateX(0);
    }
  }

  .analysis-status {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    border-radius: var(--r-pill);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    font-size: 0.72rem;
    color: var(--text-2);
  }

  /* ═══════════════════════════════════════════════════════
     THE BOARD
     ═══════════════════════════════════════════════════════ */
  .ultimate-board {
    --board-max: min(
      calc(100vh - var(--topbar-h) - 120px),
      calc(100vw - var(--s10))
    );
    width: var(--board-max);
    aspect-ratio: 1;
    flex-shrink: 0;
    background: var(--board-bg);
    border: 1px solid var(--board-border);
    border-radius: var(--r-2xl);
    padding: var(--board-pad);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--board-gap);
    outline: none;
    box-shadow: var(--elev-2);
    transition: box-shadow var(--dur-slow) ease;
  }
  .ultimate-board.theme-flash {
    animation: theme-flash 0.4s ease;
  }
  .board-stage.has-side .ultimate-board {
    --board-max: min(
      calc(100vh - var(--topbar-h) - 120px),
      calc(100vw - var(--s10) - var(--timer-left-w))
    );
  }
  @keyframes theme-flash {
    from {
      filter: saturate(0);
    }
    to {
      filter: saturate(1);
    }
  }
  .ultimate-board:focus-visible {
    box-shadow:
      0 0 0 3px var(--brand),
      var(--elev-2);
  }
  .replay-mode {
    width: min(320px, 90vw);
    aspect-ratio: 1;
    margin: 0 auto;
  }

  /* Player-turn accent on board edge */
  .board-zone[data-player="X"] .ultimate-board {
    box-shadow:
      var(--elev-2),
      0 0 0 1px var(--x-col),
      0 0 32px var(--x-glow);
  }
  .board-zone[data-player="O"] .ultimate-board {
    box-shadow:
      var(--elev-2),
      0 0 0 1px var(--o-col),
      0 0 32px var(--o-glow);
  }

  /* Mini board */
  .mini-board {
    background: var(--bg-raised);
    border: 1.5px solid var(--board-border);
    border-radius: var(--r-lg);
    padding: 5px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    position: relative;
    transition:
      transform var(--dur-slow) var(--ease-spring),
      box-shadow var(--dur-slow) ease,
      border-color var(--dur-base) ease,
      opacity var(--dur-slow) ease,
      filter var(--dur-slow) ease;
    will-change: transform;
  }
  .mini-active {
    border-color: var(--brand);
    box-shadow:
      0 0 0 1px var(--brand),
      0 0 18px var(--brand-glow);
    transform: translateY(-2px) scale(1.01);
    z-index: 2;
    --pulse-color: var(--brand-glow);
    animation: board-pulse 1.6s ease-in-out infinite alternate;
  }
  /* Turn-tinted active board */
  .board-zone[data-player="X"] .mini-active {
    border-color: var(--x-col);
    box-shadow:
      0 0 0 1px var(--x-col),
      0 0 18px var(--x-glow);
    --pulse-color: var(--x-glow);
  }
  .board-zone[data-player="O"] .mini-active {
    border-color: var(--o-col);
    box-shadow:
      0 0 0 1px var(--o-col),
      0 0 18px var(--o-glow);
    --pulse-color: var(--o-glow);
  }
  .mini-spotlight {
    animation:
      board-spotlight 0.6s ease-in-out 1,
      board-pulse 1.6s ease-in-out infinite alternate;
  }
  .board-zone[data-player="X"] .mini-spotlight {
    --spot-color: var(--x-col);
  }
  .board-zone[data-player="O"] .mini-spotlight {
    --spot-color: var(--o-col);
  }
  @keyframes board-pulse {
    from {
      box-shadow: 0 0 12px var(--pulse-color);
    }
    to {
      box-shadow: 0 0 24px var(--pulse-color);
    }
  }
  @keyframes board-spotlight {
    0% {
      box-shadow: 0 0 0 2px var(--spot-color);
    }
    20% {
      box-shadow: 0 0 0 2px #ffffff;
    }
    40% {
      box-shadow: 0 0 0 2px var(--spot-color);
    }
    60% {
      box-shadow: 0 0 0 2px #ffffff;
    }
    80% {
      box-shadow: 0 0 0 2px var(--spot-color);
    }
    100% {
      box-shadow: 0 0 0 1px var(--spot-color);
    }
  }
  .mini-inactive {
    opacity: 0.48;
    filter: saturate(0.5);
  }
  .analysis-bar {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 6px;
    height: 4px;
    border-radius: var(--r-pill);
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .analysis-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #ef4444, #22c55e);
    transform: scaleX(var(--eval));
    transform-origin: left center;
    transition: transform 0.3s ease;
  }
  .mini-won,
  .mini-drawn {
    transform: none !important;
    box-shadow: none !important;
  }

  /* Board overlay (won/drawn claim) */
  .board-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: calc(var(--r-lg) - 1px);
    pointer-events: none;
    z-index: 5;
    backdrop-filter: blur(3px);
    animation: overlay-in var(--dur-enter) var(--ease-spring) both;
  }
  .ov-x {
    background: hsla(34, 96%, 50%, 0.13);
    border: 2px solid var(--x-col);
  }
  .ov-o {
    background: hsla(204, 92%, 50%, 0.13);
    border: 2px solid var(--o-col);
  }
  .ov-draw {
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid var(--text-3);
  }
  :global(body[data-theme="light"]) .ov-draw {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--text-3);
  }
  .board-overlay-sym {
    font-family: var(--font-mono);
    font-size: clamp(1.5rem, 4vw, 2.6rem);
    font-weight: 700;
    line-height: 1;
  }
  .ov-x .board-overlay-sym {
    color: var(--x-col);
    text-shadow: 0 0 20px var(--x-glow);
  }
  .ov-o .board-overlay-sym {
    color: var(--o-col);
    text-shadow: 0 0 20px var(--o-glow);
  }
  /* .ov-draw i {
    font-size: 1.4rem;
    color: var(--text-3);
  } */
  @keyframes overlay-in {
    0% {
      opacity: 0;
      transform: scale(0.3);
    }
    65% {
      opacity: 1;
      transform: scale(1.08);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Win strike line */
  .win-strike {
    position: absolute;
    border-radius: var(--r-pill);
    z-index: 6;
    pointer-events: none;
    animation: strike-draw 0.55s var(--ease-out) forwards;
  }
  .strike-x {
    background: var(--x-col);
    box-shadow: 0 0 14px var(--x-glow);
  }
  .strike-o {
    background: var(--o-col);
    box-shadow: 0 0 14px var(--o-glow);
  }
  /* Rows */
  .row-0,
  .row-1,
  .row-2 {
    left: 8%;
    right: 8%;
    height: 3px;
    transform-origin: left center;
  }
  .row-0 {
    top: 17%;
  }
  .row-1 {
    top: 50%;
  }
  .row-2 {
    top: 83%;
  }
  /* Cols */
  .col-0,
  .col-1,
  .col-2 {
    top: 8%;
    bottom: 8%;
    width: 3px;
    transform-origin: center top;
  }
  .col-0 {
    left: 17%;
  }
  .col-1 {
    left: 50%;
  }
  .col-2 {
    left: 83%;
  }
  /* Diags */
  .diag-1,
  .diag-2 {
    width: 135%;
    left: -17.5%;
    top: 50%;
    height: 3px;
    transform-origin: center;
  }
  .diag-1 {
    transform: rotate(45deg) scaleX(0);
  }
  .diag-2 {
    transform: rotate(-45deg) scaleX(0);
  }
  @keyframes strike-draw {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  .col-0,
  .col-1,
  .col-2 {
    animation-name: strike-draw-y;
  }
  @keyframes strike-draw-y {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  .diag-1 {
    animation-name: strike-diag-1;
  }
  .diag-2 {
    animation-name: strike-diag-2;
  }
  @keyframes strike-diag-1 {
    from {
      transform: rotate(45deg) scaleX(0);
    }
    to {
      transform: rotate(45deg) scaleX(1);
    }
  }
  @keyframes strike-diag-2 {
    from {
      transform: rotate(-45deg) scaleX(0);
    }
    to {
      transform: rotate(-45deg) scaleX(1);
    }
  }

  /* Cells */
  .cell {
    aspect-ratio: 1;
    background: var(--cell-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--r-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    transition:
      background var(--dur-base) ease,
      border-color var(--dur-base) ease,
      transform var(--dur-base) var(--ease-spring),
      box-shadow var(--dur-base) ease;
    will-change: transform;
    -webkit-tap-highlight-color: transparent;
    --hx: 50%;
    --hy: 50%;
  }
  .cell::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle at var(--hx) var(--hy),
      var(--brand-dim) 0%,
      transparent 70%
    );
    opacity: 0;
    transition: opacity 120ms ease;
    pointer-events: none;
    z-index: 0;
  }
  .cell::after {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(255, 92, 114, 1);
    opacity: 0;
    transition: opacity 160ms ease;
    pointer-events: none;
    mix-blend-mode: screen;
    z-index: 0;
  }
  .cell > * {
    position: relative;
    z-index: 1;
  }
  .cell:disabled {
    cursor: default;
  }
  .cell-legal:hover::before,
  .cell-hover::before {
    opacity: 1;
  }
  .cell-legal:hover {
    background: var(--cell-hover-bg);
    border-color: var(--brand);
    transform: scale(1.06) translateZ(0);
    box-shadow:
      0 0 12px var(--brand-glow),
      0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 1;
  }
  .board-zone[data-player="X"] .cell-legal:hover {
    border-color: var(--x-col);
    background: var(--x-dim);
    box-shadow: 0 0 12px var(--x-glow);
  }
  .board-zone[data-player="O"] .cell-legal:hover {
    border-color: var(--o-col);
    background: var(--o-dim);
    box-shadow: 0 0 12px var(--o-glow);
  }
  .board-zone[data-player="X"] .cell::before {
    background: radial-gradient(
      circle at var(--hx) var(--hy),
      var(--x-dim) 0%,
      transparent 70%
    );
  }
  .board-zone[data-player="O"] .cell::before {
    background: radial-gradient(
      circle at var(--hx) var(--hy),
      var(--o-dim) 0%,
      transparent 70%
    );
  }
  .cell-pressed {
    transform: scale(0.92) translateZ(0) !important;
    transition-duration: var(--dur-fast) !important;
  }
  .cell-last {
    border-color: var(--brand);
    box-shadow: 0 0 10px var(--brand-glow);
  }
  .cell-heat::after {
    opacity: calc(var(--heat) * 0.55);
  }
  .cell-hint {
    animation: hint-pulse 2s ease-in-out;
    box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.6),
      0 0 18px rgba(255, 215, 0, 0.45);
  }
  @keyframes hint-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.35),
        0 0 10px rgba(255, 215, 0, 0.35);
    }
    50% {
      box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.75),
        0 0 22px rgba(255, 215, 0, 0.6);
    }
  }
  .cell-kbd {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .cell-x,
  .cell-o {
    animation: cell-pop var(--dur-slow) var(--ease-bounce) both;
  }
  @keyframes cell-pop {
    0% {
      transform: scale(0) rotate(-15deg);
      opacity: 0;
    }
    50% {
      transform: scale(1.28) rotate(4deg);
    }
    75% {
      transform: scale(0.94) rotate(-2deg);
    }
    100% {
      transform: scale(1) rotate(0);
      opacity: 1;
    }
  }

  /* Cell symbols */
  .cell-sym {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 1.3rem;
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }
  .sym-x {
    color: var(--x-col);
    text-shadow: 0 0 12px var(--x-glow);
  }
  .sym-o {
    color: var(--o-col);
    text-shadow: 0 0 12px var(--o-glow);
  }
  .cell-ghost {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: clamp(0.7rem, 2.5vw, 1.3rem);
    opacity: 0.28;
    pointer-events: none;
    user-select: none;
    color: var(--text-2);
  }
  .cell-undo-border {
    position: absolute;
    inset: 5px;
    border: 2px dashed rgba(255, 255, 255, 0.4);
    border-radius: var(--r-xs);
    pointer-events: none;
  }
  .cell-undo-x .cell-undo-border {
    border-color: color-mix(in srgb, var(--x-col) 50%, transparent);
  }
  .cell-undo-o .cell-undo-border {
    border-color: color-mix(in srgb, var(--o-col) 50%, transparent);
  }
  .cell-undo-ghost {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: clamp(0.7rem, 2.5vw, 1.3rem);
    opacity: 0.35;
    pointer-events: none;
    user-select: none;
    animation: undo-breathe 2s ease-in-out infinite;
  }
  .cell-undo-x .cell-undo-ghost {
    color: var(--x-col);
  }
  .cell-undo-o .cell-undo-ghost {
    color: var(--o-col);
  }
  @keyframes undo-breathe {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 0.45;
    }
  }
  .cell-annotation {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--annotation-color);
    pointer-events: none;
    opacity: var(--annotation-opacity, 0.85);
  }
  .cell-annotation svg {
    width: 20px;
    height: 20px;
  }
  .annotation-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
  }

  /* Ripple effect */
  .ripple {
    position: absolute;
    width: 100%;
    height: 100%;
    left: calc(var(--rx) - 50%);
    top: calc(var(--ry) - 50%);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.18);
    transform: scale(0);
    animation: ripple-out 0.55s var(--ease-out) forwards;
    pointer-events: none;
  }
  @keyframes ripple-out {
    to {
      transform: scale(2.8);
      opacity: 0;
    }
  }

  /* ═══════════════════════════════════════════════════════
     SIDE PANEL
     ═══════════════════════════════════════════════════════ */
  .side-panel {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--sidebar-w);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--glass-bg);
    border-left: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    transform: translateX(100%);
    transition: transform var(--dur-slow) var(--ease-out);
    z-index: 3;
    box-shadow: var(--elev-3);
    will-change: transform;
  }
  .panel-open {
    transform: translateX(0);
  }
  .fab {
    position: fixed;
    right: var(--s4);
    bottom: var(--s4);
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: var(--brand);
    color: var(--on-brand);
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow:
      0 12px 30px rgba(0, 0, 0, 0.35),
      0 0 18px var(--brand-glow);
    display: grid;
    place-items: center;
    z-index: 10;
    animation: fab-bounce 0.5s var(--ease-out) both;
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .fab-icon {
    transition: transform var(--dur-base) var(--ease-out);
  }
  .fab:hover {
    transform: translateY(-2px) scale(1.03);
  }
  .fab:hover .fab-icon {
    transform: rotate(12deg);
  }
  .fab:active {
    transform: translateY(0) scale(0.98);
  }
  @keyframes fab-bounce {
    0% {
      opacity: 0;
      transform: translateY(20px);
    }
    60% {
      opacity: 1;
      transform: translateY(-4px);
    }
    100% {
      transform: translateY(0);
    }
  }

  /* Mode tabs */
  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-bottom: 1px solid var(--glass-border);
    flex-shrink: 0;
  }
  .mode-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: var(--s3) var(--s2);
    background: transparent;
    border: none;
    border-right: 1px solid var(--glass-border);
    font-family: var(--font-sans);
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--text-3);
    cursor: pointer;
    transition: all 180ms var(--ease-out);
    letter-spacing: 0.04em;
    position: relative;
    min-width: 52px;
  }
  .mode-tab:last-child {
    border-right: none;
  }
  .mode-tab:nth-child(3n) {
    border-right: none;
  }
  /* .mode-tab i {
    font-size: 0.85rem;
  } */
  .mode-tab:hover {
    background: var(--glass-bg-hover);
    color: var(--text-1);
  }
  .tab-active {
    color: var(--brand);
    background: color-mix(in srgb, var(--brand) 12%, transparent);
  }
  .tab-active::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--brand);
  }

  /* Panel scroll */
  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* Panel sections */
  .panel-section {
    border-bottom: 1px solid var(--glass-border);
  }
  .ps-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
    background: var(--bg-raised);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
    border-bottom: 1px solid var(--glass-border);
    cursor: pointer;
    justify-content: space-between;
  }
  .ps-head > span {
    flex: 1;
  }
  .ps-head svg {
    transition: transform 180ms var(--ease-out);
  }
  .chev-open {
    transform: rotate(90deg);
  }
  .ps-badge {
    margin-left: auto;
    background: var(--brand-dim);
    border: 1px solid var(--brand-glow);
    color: var(--brand);
    font-size: 0.6rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: var(--r-pill);
  }
  .badge-err {
    background: rgba(255, 92, 114, 0.18);
    border-color: rgba(255, 92, 114, 0.45);
    color: var(--danger);
  }
  .ps-body {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
  }
  .panel-accent-bot {
    background: var(--bg-raised);
  }

  .chat-body {
    gap: var(--s2);
  }
  .chat-list {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding-right: 4px;
  }
  .chat-msg {
    display: flex;
    gap: var(--s2);
    align-items: flex-start;
    font-size: 0.72rem;
    color: var(--text-1);
  }
  .chat-sym {
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .chat-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .chat-name {
    font-size: 0.62rem;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .chat-text {
    color: var(--text-1);
  }
  .chat-quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chat-quick-btn {
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    padding: 2px 8px;
    font-size: 0.7rem;
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
  }
  .chat-quick-btn:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hi);
    transform: translateY(-1px);
  }
  .chat-input-row {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .chat-input-row input {
    flex: 1;
  }

  .friends-block {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .friends-head {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .friends-head input {
    flex: 1;
  }
  .friends-list {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .friend-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    justify-content: space-between;
    padding: var(--s1) 0;
  }
  .friend-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-3);
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.2);
  }
  .friend-online {
    background: var(--success);
    box-shadow: 0 0 8px var(--win-glow);
  }
  .friend-name {
    flex: 1;
    font-size: 0.74rem;
    color: var(--text-1);
  }

  .puzzle-list {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    max-height: 220px;
    overflow-y: auto;
  }
  .puzzle-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
    padding: var(--s2) var(--s3);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    text-align: left;
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
  }
  .puzzle-item strong {
    display: block;
    font-size: 0.78rem;
    color: var(--text-1);
  }
  .puzzle-diff {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
  }
  .puzzle-item:hover {
    border-color: var(--glass-border-hi);
    transform: translateY(-1px);
  }
  .puzzle-active {
    border-color: var(--brand);
    box-shadow: 0 0 12px var(--brand-glow);
  }
  .puzzle-check {
    color: var(--success);
    font-weight: 700;
    font-size: 0.85rem;
  }

  .achievements {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .achievements-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
  }
  .achievements-count {
    font-size: 0.68rem;
    color: var(--text-3);
  }
  .achievements-bar {
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--glass-border);
    overflow: hidden;
  }
  .achievements-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--warning), var(--brand));
    box-shadow: 0 0 10px rgba(245, 185, 85, 0.4);
  }
  .achievement-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s2);
  }
  .achievement-item {
    position: relative;
    display: flex;
    gap: var(--s2);
    align-items: flex-start;
    padding: var(--s2) var(--s3);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    background: var(--bg-float);
    opacity: 0.4;
    filter: grayscale(1);
    transition: all var(--dur-base) var(--ease-out);
    overflow: hidden;
  }
  .achievement-item svg {
    flex-shrink: 0;
    color: var(--text-3);
  }
  .achievement-unlocked {
    opacity: 1;
    filter: none;
    border-color: rgba(245, 185, 85, 0.9);
    box-shadow: 0 0 12px rgba(245, 185, 85, 0.35);
  }
  .achievement-unlocked::after {
    content: "";
    position: absolute;
    inset: -40%;
    background: linear-gradient(
      105deg,
      transparent 20%,
      rgba(255, 255, 255, 0.12) 50%,
      transparent 80%
    );
    background-size: 200% 200%;
    animation: shimmer 3.4s linear infinite;
    pointer-events: none;
  }
  .achievement-body strong {
    display: block;
    font-size: 0.74rem;
    color: var(--text-1);
  }
  .achievement-body span {
    font-size: 0.64rem;
    color: var(--text-3);
  }

  .sync-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2);
    border-radius: var(--r-md);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
  }
  .sync-icon {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--glass-border);
    color: var(--text-2);
  }
  .sync-fresh {
    background: rgba(80, 224, 122, 0.2);
    color: var(--success);
  }
  .sync-mid {
    background: rgba(245, 185, 85, 0.2);
    color: var(--warning);
  }
  .sync-offline,
  .sync-stale {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-3);
  }
  .sync-text {
    font-size: 0.7rem;
    color: var(--text-2);
    flex: 1;
  }

  .season-block {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s2);
    border-radius: var(--r-md);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
  }
  .season-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--text-2);
  }
  .season-trophies {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
  }
  .season-chip {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: color-mix(in srgb, var(--chip) 15%, transparent);
    border: 1px solid var(--chip);
    color: var(--chip);
  }

  .tournament-lobby {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .bracket {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--s3);
    align-items: center;
  }
  .bracket-round {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    position: relative;
  }
  .bracket-round:not(.bracket-final)::after {
    content: "";
    position: absolute;
    right: calc(-1 * var(--s3));
    top: 18%;
    bottom: 18%;
    width: 1px;
    background: var(--glass-border-hi);
  }
  .bracket-match {
    position: relative;
    padding: var(--s2) var(--s3);
    border-radius: var(--r-md);
    border: 1px solid var(--glass-border);
    background: var(--bg-float);
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
  .bracket-match[data-connector="right"]::after {
    content: "";
    position: absolute;
    right: calc(-1 * var(--s3));
    top: 50%;
    width: var(--s3);
    height: 1px;
    background: var(--glass-border-hi);
  }
  .bm-row {
    font-size: 0.72rem;
    color: var(--text-1);
  }
  .bm-winner {
    font-size: 0.62rem;
    color: var(--success);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .match-active {
    border-color: var(--brand);
    box-shadow: 0 0 12px var(--brand-glow);
    animation: match-pulse 1.4s ease-in-out infinite;
  }
  @keyframes match-pulse {
    0%,
    100% {
      box-shadow: 0 0 10px var(--brand-glow);
    }
    50% {
      box-shadow: 0 0 20px var(--brand-glow);
    }
  }
  .tournament-podium {
    margin-top: var(--s2);
    padding: var(--s3);
    border-radius: var(--r-md);
    background: var(--brand-dim);
    border: 1px solid var(--brand-glow);
    text-align: center;
    color: var(--text-1);
    position: relative;
    overflow: hidden;
  }
  .podium-confetti {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .podium-particle {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    background: var(--warning);
    border-radius: 2px;
    opacity: 0;
    animation: podium-burst 0.9s var(--ease-out) calc(var(--i) * 0.03s)
      forwards;
  }
  .podium-particle:nth-child(3n) {
    background: var(--x-col);
  }
  .podium-particle:nth-child(3n + 1) {
    background: var(--o-col);
  }
  @keyframes podium-burst {
    0% {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(calc(var(--i) * 10deg))
        translateY(0);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(calc(var(--i) * 10deg))
        translateY(-80px);
    }
  }
  .podium-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s1);
    padding: var(--s2);
    border-radius: var(--r-md);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--glass-border-hi);
    position: relative;
    z-index: 1;
  }

  /* Timeline */
  .ps-timeline {
    max-height: 160px;
    overflow-y: auto;
    gap: var(--s1);
    padding: var(--s2) var(--s3);
  }
  .tl-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-sm);
    padding: 3px var(--s2);
    font-size: 0.72rem;
    flex-shrink: 0;
    transition: border-color var(--dur-base) ease;
  }
  .tl-item:last-child {
    border-color: var(--glass-border-hi);
  }
  .tl-n {
    color: var(--text-3);
    min-width: 22px;
  }
  .tl-sym {
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .tl-x .tl-sym {
    color: var(--x-col);
  }
  .tl-o .tl-sym {
    color: var(--o-col);
  }
  .tl-pos {
    color: var(--text-3);
    font-size: 0.68rem;
  }
  .tl-empty {
    font-size: 0.76rem;
    color: var(--text-3);
    padding: var(--s1);
  }

  /* Settings fields */
  .sf {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
  .sf label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-3);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* Scoreboard */
  .ps-score {
    padding: 0;
    gap: 0;
  }
  .score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s3) var(--s4);
    border-bottom: 1px solid var(--glass-border);
    transition: background var(--dur-base) ease;
  }
  .score-row:last-child {
    border-bottom: none;
  }
  .score-row:hover {
    background: var(--bg-raised);
  }
  .score-who {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.82rem;
    color: var(--text-2);
  }
  .score-num {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-1);
    letter-spacing: -0.02em;
  }
  .sc-x {
    color: var(--x-col);
  }
  .sc-o {
    color: var(--o-col);
  }
  .sc-d {
    color: var(--text-3);
  }

  /* History */
  .ps-history {
    max-height: 180px;
    overflow-y: auto;
    padding: 0;
    gap: 0;
  }
  .hist-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s3) var(--s4);
    gap: var(--s2);
    border-bottom: 1px solid var(--glass-border);
    transition: background var(--dur-base) ease;
  }
  .hist-item:last-child {
    border-bottom: none;
  }
  .hist-item:hover {
    background: var(--bg-raised);
  }
  .hist-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .hist-mode-chip {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: var(--brand-dim);
    border: 1px solid var(--brand-glow);
    color: var(--brand);
    padding: 1px var(--s2);
    border-radius: var(--r-pill);
    width: fit-content;
  }
  .hist-date {
    font-size: 0.65rem;
    color: var(--text-3);
  }

  /* Leaderboard in panel */
  .ps-lb {
    gap: 0;
    padding: 0;
  }
  .lb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s2) var(--s4);
    gap: var(--s2);
    border-bottom: 1px solid var(--glass-border);
    font-size: 0.78rem;
  }
  .lb-row:last-child {
    border-bottom: none;
  }
  .lb-pos {
    font-family: var(--font-mono);
    color: var(--text-3);
    min-width: 24px;
    font-size: 0.72rem;
  }
  .lb-name {
    flex: 1;
    color: var(--text-1);
  }
  .lb-elo {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--brand);
  }

  /* Room / Social info blocks */
  .room-info-block {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    padding: var(--s3);
  }
  .room-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.8rem;
    color: var(--text-2);
  }
  /* .room-row i {
    color: var(--text-3);
  } */
  .room-row strong {
    color: var(--text-1);
  }
  .room-code-chip {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--brand);
    letter-spacing: 0.1em;
  }
  .input-row {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .input-row input {
    flex: 1;
  }

  .draw-banner {
    background: hsla(34, 96%, 50%, 0.08);
    border: 1px solid hsla(34, 96%, 50%, 0.22);
    border-radius: var(--r-md);
    padding: var(--s3);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .draw-banner > span {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.8rem;
    color: var(--x-col);
    font-weight: 600;
  }

  /* ═══════════════════════════════════════════════════════
     GLOBAL COMPONENTS: BUTTONS, INPUTS
     ═══════════════════════════════════════════════════════ */
  .btn-primary,
  .btn-ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
    padding: var(--s2) var(--s4);
    border-radius: var(--r-md);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--dur-base) var(--ease-out);
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
    will-change: transform;
    line-height: 1.3;
  }
  .btn-sm {
    padding: var(--s1) var(--s3) !important;
    font-size: 0.74rem !important;
  }
  .btn-xs {
    padding: 3px var(--s2) !important;
    font-size: 0.7rem !important;
    border-radius: var(--r-sm) !important;
  }
  .btn-primary {
    background: var(--brand);
    color: var(--on-brand);
    box-shadow:
      0 0 16px var(--brand-glow),
      var(--elev-1);
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow:
      0 0 28px var(--brand-glow),
      var(--elev-2);
    filter: brightness(1.08);
  }
  .btn-primary:active {
    transform: translateY(0) scale(0.97);
    transition-duration: var(--dur-fast);
  }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
    filter: none;
  }
  .btn-ghost {
    background: var(--glass-bg);
    color: var(--text-2);
    border-color: var(--glass-border);
  }
  .btn-ghost:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hi);
    color: var(--text-1);
    transform: translateY(-1px);
    box-shadow: var(--elev-1);
  }
  .btn-ghost:active {
    transform: translateY(0) scale(0.97);
    transition-duration: var(--dur-fast);
  }
  .btn-ghost:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
  }

  .btn-row {
    display: flex;
    gap: var(--s2);
    align-items: center;
  }
  .btn-row .btn-primary,
  .btn-row .btn-ghost {
    flex: 1;
  }
  .share-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  .share-qr {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    padding: var(--s2);
    background: var(--bg-float);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-md);
    box-shadow: var(--elev-3);
    transform: scale(0.8);
    opacity: 0;
    transform-origin: top left;
    animation: share-pop 0.2s var(--ease-out) forwards;
    z-index: 10;
  }
  .share-qr img {
    display: block;
    width: 120px;
    height: 120px;
  }
  @keyframes share-pop {
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  .color-row {
    display: flex;
    gap: var(--s2);
    margin: var(--s2) 0;
  }
  .color-chip {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--chip);
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.3);
    cursor: pointer;
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }
  .color-chip:hover {
    transform: scale(1.08);
  }
  .color-active {
    border-color: var(--text-1);
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.35);
  }

  .icon-btn-sm {
    min-width: 30px;
    height: 30px;
    width: auto;
    padding: 0 var(--s2);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
    font-size: 0.75rem;
    transition: all var(--dur-base) var(--ease-out);
    flex-shrink: 0;
  }
  .icon-btn-sm:hover {
    background: var(--glass-bg-hover);
    border-color: var(--glass-border-hi);
    color: var(--text-1);
    transform: scale(1.08);
  }
  .icon-btn-sm:active {
    transform: scale(0.95);
  }

  input,
  select,
  textarea {
    width: 100%;
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-sm);
    padding: var(--s2) var(--s3);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    color: var(--text-1);
    outline: none;
    transition:
      border-color var(--dur-base) ease,
      box-shadow var(--dur-base) ease;
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 2px var(--brand-dim);
  }
  button:focus-visible,
  [role="button"]:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    box-shadow: 0 0 0 3px var(--brand-dim);
  }
  textarea {
    resize: vertical;
    min-height: 56px;
  }
  select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none'%3E%3Cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 16px;
    padding-right: 28px;
  }

  .info-line {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.78rem;
    color: var(--text-2);
    flex-wrap: wrap;
  }
  .adaptive-badge {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: 0.7rem;
    font-weight: 700;
    color: #0b0b0b;
    transition: background 600ms ease, color 600ms ease;
  }
  .diff-easy {
    background: #22c55e;
    color: #03110a;
  }
  .diff-medium {
    background: #facc15;
    color: #221b03;
  }
  .diff-hard {
    background: #fb923c;
    color: #2a1405;
  }
  .diff-master {
    background: #ef4444;
    color: #240606;
  }
  .adaptive-meter {
    position: relative;
    height: 10px;
    border-radius: var(--r-pill);
    background: var(--glass-border);
    overflow: hidden;
  }
  .adaptive-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brand), var(--x-col));
    transition: width 0.4s ease;
  }
  .adaptive-meter span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.6rem;
    color: var(--text-1);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    pointer-events: none;
  }
  .adaptive-pulse {
    display: inline-block;
    color: var(--brand);
    animation: adaptive-bump 0.45s var(--ease-spring);
  }
  @keyframes adaptive-bump {
    0% {
      transform: scale(1);
    }
    60% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
    }
  }
  .dim-text {
    color: var(--text-3) !important;
    font-size: 0.8rem;
  }

  /* ═══════════════════════════════════════════════════════
     MODALS
     ═══════════════════════════════════════════════════════ */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 8, 16, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s6);
    z-index: 100;
    animation: fade-in var(--dur-enter) var(--ease-out);
  }
  :global(body[data-theme="light"]) .modal-backdrop {
    background: rgba(15, 30, 60, 0.38);
  }

  .modal-sheet {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-xl);
    padding: var(--s6);
    width: min(440px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--elev-4);
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    backdrop-filter: blur(24px);
    animation: slide-up var(--dur-enter) var(--ease-spring);
  }
  .modal-wide {
    width: min(560px, 100%);
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
  }
  .modal-head h3 {
    display: flex;
    align-items: center;
    gap: var(--s2);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-1);
  }

  .rules-ol {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    padding-left: var(--s5);
    font-size: 0.85rem;
    color: var(--text-2);
    line-height: 1.6;
  }
  .rules-ol strong {
    color: var(--text-1);
  }

  /* Win Modal */
  .win-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 8, 16, 0.68);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s6);
    z-index: 50;
    animation: fade-in var(--dur-enter) var(--ease-out);
  }
  :global(body[data-theme="light"]) .win-backdrop {
    background: rgba(15, 30, 60, 0.32);
  }

  .win-modal {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-2xl);
    padding: var(--s8) var(--s7);
    min-width: min(360px, 92vw);
    box-shadow: var(--elev-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s4);
    text-align: center;
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(24px);
    animation: win-rise var(--dur-enter) var(--ease-spring);
  }
  @keyframes win-rise {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* Win particles */
  .win-particles {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .win-particle {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand);
    --particle-dur: calc(0.7s + (var(--i) * 0.02s));
    animation: particle-burst var(--particle-dur) var(--ease-out)
      calc(var(--i) * 0.04s) forwards;
    opacity: 0;
  }
  .win-particle:nth-child(3n + 1) {
    width: 4px;
    height: 4px;
  }
  .win-particle:nth-child(3n + 2) {
    width: 6px;
    height: 6px;
  }
  .win-particle:nth-child(3n) {
    width: 8px;
    height: 8px;
  }
  .win-particle:nth-child(odd) {
    background: var(--x-col);
  }
  .win-particle:nth-child(3n) {
    background: var(--win-col);
  }
  @keyframes particle-burst {
    0% {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(var(--deg)) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) rotate(var(--deg)) translateY(-80px);
    }
  }

  .win-sym-wrap {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--brand-dim);
    border: 2px solid var(--brand-glow);
    position: relative;
    z-index: 1;
    animation: sym-pop var(--dur-slow) var(--ease-bounce);
  }
  .ws-x {
    background: var(--x-dim);
    border-color: var(--x-glow);
  }
  .ws-o {
    background: var(--o-dim);
    border-color: var(--o-glow);
  }
  .ws-draw {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--text-3);
  }
  .win-sym {
    font-family: var(--font-mono);
    font-size: 2rem;
    font-weight: 700;
  }
  .ws-x .win-sym {
    color: var(--x-col);
    text-shadow: 0 0 24px var(--x-glow);
  }
  .ws-o .win-sym {
    color: var(--o-col);
    text-shadow: 0 0 24px var(--o-glow);
  }
  .ws-draw .win-sym {
    color: var(--text-2);
  }
  @keyframes sym-pop {
    from {
      transform: scale(0);
    }
    80% {
      transform: scale(1.18);
    }
    to {
      transform: scale(1);
    }
  }

  .win-title {
    font-family: var(--font-mono);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text-1);
    position: relative;
    z-index: 1;
  }
  .win-sub {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    font-size: 0.82rem;
    color: var(--text-3);
    position: relative;
    z-index: 1;
  }
  .win-sub.win-timeout {
    color: var(--err-col);
    font-weight: 700;
  }
  .win-actions {
    display: flex;
    gap: var(--s3);
    flex-wrap: wrap;
    justify-content: center;
    position: relative;
    z-index: 1;
  }

  /* Replay */
  .replay-board-wrap {
    display: flex;
    justify-content: center;
    position: relative;
  }
  .replay-badge {
    position: absolute;
    top: var(--s2);
    right: var(--s2);
    padding: 2px 8px;
    background: var(--bg-float);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    font-size: 0.62rem;
    font-weight: 700;
    color: var(--text-1);
    box-shadow: var(--elev-1);
    animation: badge-pop 0.4s var(--ease-spring);
  }
  @keyframes badge-pop {
    0% {
      transform: scale(0);
    }
    70% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
    }
  }
  .replay-cell {
    aspect-ratio: 1;
    background: var(--bg-raised);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-xs);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cell-replay-last {
    box-shadow:
      0 0 0 2px var(--brand),
      0 0 12px var(--brand-glow);
    animation: replay-ring 1.2s ease-in-out infinite;
  }
  @keyframes replay-ring {
    0%,
    100% {
      box-shadow:
        0 0 0 2px var(--brand),
        0 0 8px var(--brand-glow);
    }
    50% {
      box-shadow:
        0 0 0 4px var(--brand),
        0 0 16px var(--brand-glow);
    }
  }
  .replay-cell .cell-sym {
    font-size: 0.7rem;
  }
  .replay-controls {
    display: flex;
    gap: var(--s2);
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
  }
  .replay-progress {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .rp-track {
    height: 3px;
    background: var(--glass-border);
    border-radius: var(--r-pill);
    overflow: hidden;
  }
  .rp-fill {
    height: 100%;
    background: var(--brand);
    border-radius: var(--r-pill);
    transition: width 0.3s ease;
    box-shadow: 0 0 8px var(--brand-glow);
  }
  .rp-label {
    font-size: 0.7rem;
    color: var(--text-3);
    text-align: center;
  }

  /* ═══════════════════════════════════════════════════════
     TOASTS
     ═══════════════════════════════════════════════════════ */
  .toast-zone {
    position: fixed;
    bottom: var(--s5);
    right: var(--s5);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border-hi);
    border-radius: var(--r-md);
    box-shadow: var(--elev-3);
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-1);
    backdrop-filter: blur(16px);
    animation: toast-in var(--dur-slow) var(--ease-spring) both;
    max-width: 300px;
    pointer-events: auto;
    --toast-accent: var(--brand);
    position: relative;
    overflow: hidden;
  }
  .toast::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--toast-accent);
    transform-origin: left center;
    animation: toast-progress var(--toast-duration) linear forwards;
  }
  .toast.toast-persistent::after {
    display: none;
  }
  .toast-icon {
    flex-shrink: 0;
    color: var(--toast-accent);
    display: grid;
    place-items: center;
  }
  /* .toast-icon svg {
    width: 16px;
    height: 16px;
  } */
  .toast-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--toast-accent);
    box-shadow: 0 0 10px var(--toast-accent);
  }
  .toast-body {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    flex: 1;
  }
  .toast-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-1);
  }
  .toast-sub {
    font-size: 0.75rem;
    color: var(--text-2);
  }
  .toast-actions {
    display: flex;
    gap: var(--s1);
    flex-wrap: wrap;
  }
  .toast-action,
  .toast-close {
    background: transparent;
    border: 1px solid var(--glass-border);
    color: var(--text-1);
    border-radius: var(--r-pill);
    padding: 2px 8px;
    font-size: 0.65rem;
    cursor: pointer;
    transition: all var(--dur-base) var(--ease-out);
  }
  .toast-action:hover,
  .toast-close:hover {
    border-color: var(--glass-border-hi);
    transform: translateY(-1px);
  }
  .toast-err {
    border-left: 3px solid var(--danger);
    --toast-accent: var(--danger);
  }
  .toast-ok {
    border-left: 3px solid var(--success);
    --toast-accent: var(--success);
  }
  .toast-trophy {
    min-height: 72px;
    border-left: 6px solid transparent;
    --toast-accent: var(--warning);
    animation-delay: 0.4s;
  }
  .toast-trophy::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 6px;
    background: linear-gradient(180deg, #fcd34d, #f59e0b);
  }
  .toast-trophy .toast-icon {
    width: 32px;
    height: 32px;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(32px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes toast-progress {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  /* ═══════════════════════════════════════════════════════
     SHARED KEYFRAMES
     ═══════════════════════════════════════════════════════ */
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
      transform: translateY(24px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* ═══════════════════════════════════════════════════════
     RESPONSIVE
     ═══════════════════════════════════════════════════════ */
  @media (max-width: 980px) {
    .board-stage.has-side {
      grid-template-columns: 1fr;
    }
    .side-timers {
      width: min(100%, 700px);
      order: -1;
    }
  }
  @media (max-width: 860px) {
    .layout.has-sidebar {
      padding-right: 0;
    }
    .side-panel {
      width: min(92vw, var(--sidebar-w));
      border-left: none;
    }
    .hud-bar {
      width: 100%;
    }
    .turn-timer-bar,
    .chess-banks,
    .turn-banner {
      width: 100%;
    }
  }

  @media (max-width: 768px) {
    .topbar-label {
      display: none;
    }
    .topbar-btn {
      width: 34px;
      padding: 0;
    }
  }

  @media (max-width: 580px) {
    :global(:root) {
      --topbar-h: 50px;
      --sidebar-w: 100vw;
    }
    .topbar {
      padding: 0 var(--s4);
    }
    .topbar-status {
      display: none;
    }
    .brand-wordmark h1 {
      font-size: 0.8rem;
    }
    .board-zone {
      padding: var(--s3) var(--s3);
      gap: var(--s2);
    }
    .hud-label {
      position: relative;
      color: transparent;
      font-size: 0.52rem;
    }
    .hud-label::after {
      content: attr(data-label-short);
      position: absolute;
      left: 0;
      top: 0;
      color: var(--text-3);
    }
    .turn-timer-caption {
      color: transparent;
    }
    .turn-timer-caption::after {
      content: attr(data-label-short);
      position: absolute;
      left: 0;
      top: 0;
      color: var(--text-3);
    }
    .hud-segment {
      padding: var(--s2) var(--s3);
    }
    .mode-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .menu-logo {
      font-size: 1.6rem;
    }
    .menu-heading {
      font-size: 1.6rem;
    }
    .menu-shell {
      padding: var(--s5);
      gap: var(--s4);
    }
    .mode-tabs {
      grid-template-columns: repeat(3, 1fr);
    }
    .replay-mode {
      width: min(260px, 88vw);
    }
  }

  /* ═══════════════════════════════════════════════════════
     REDUCED MOTION
     ═══════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
    .cursor-light {
      display: none;
    }
    .orb {
      animation: none;
    }
  }
</style>
