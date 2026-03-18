import { Server } from "socket.io";
import { applyMove, createState } from "../game.js";
import admin from "firebase-admin";
import { calcElo, getRankFromRating } from "../ranking.js";

const TURN_TIME_MS = 25000;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LEN = 8;

const stateStore = {
  rooms: new Map(),
  socialRooms: new Map(),
  competitiveQueues: new Map(),
  scoreboard: new Map(),
  playersByToken: new Map(),
  nameToSockets: new Map(),
  friendWatchers: new Map(),
};

let adminApp = null;

function getAdmin() {
  if (adminApp) return admin;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  adminApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  return admin;
}

function getFirestore() {
  const adminLib = getAdmin();
  if (!adminLib) return null;
  return adminLib.firestore();
}

function getPlayerRecord(token) {
  return stateStore.playersByToken.get(token);
}

function setPlayerRecord(token, record) {
  stateStore.playersByToken.set(token, record);
}

function ensureNameBucket(nameKey) {
  if (!stateStore.nameToSockets.has(nameKey)) {
    stateStore.nameToSockets.set(nameKey, new Set());
  }
  return stateStore.nameToSockets.get(nameKey);
}

function ensureWatcherBucket(nameKey) {
  if (!stateStore.friendWatchers.has(nameKey)) {
    stateStore.friendWatchers.set(nameKey, new Map());
  }
  return stateStore.friendWatchers.get(nameKey);
}

function notifyFriendStatus(io, nameKey) {
  const watchers = stateStore.friendWatchers.get(nameKey);
  if (!watchers) return;
  const online = (stateStore.nameToSockets.get(nameKey)?.size ?? 0) > 0;
  for (const [socketId, originalName] of watchers.entries()) {
    io.to(socketId).emit("friendStatus", { name: originalName, online });
  }
}

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < CODE_LEN; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function getUniqueSocialCode() {
  let code = generateRoomCode();
  while (stateStore.socialRooms.has(code)) code = generateRoomCode();
  return code;
}

function roomSummary(room) {
  return {
    id: room.id,
    code: room.code ?? room.id,
    mode: room.mode,
    state: room.state,
    players: {
      X: room.players.X?.name,
      O: room.players.O?.name,
    },
    status: room.state.status,
    spectators: room.spectators?.size ?? 0,
  };
}

function updateScoreboard(room) {
  const winner = room.state.winner;
  if (!winner) return;
  const players = room.players;
  for (const symbol of ["X", "O"]) {
    const player = players[symbol];
    if (!player) continue;
    const record = stateStore.scoreboard.get(player.id) ?? {
      id: player.id,
      name: player.name,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    if (winner === "D") record.draws += 1;
    else if (winner === symbol) record.wins += 1;
    else record.losses += 1;
    stateStore.scoreboard.set(player.id, record);
  }
}

function broadcastRoom(io, room, event, payload) {
  io.to(room.id).emit(event, payload);
}

function scheduleTurnTimeout(io, room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    if (room.state.status !== "playing" || room.state.winner) return;
    const winner = room.state.currentPlayer === "X" ? "O" : "X";
    room.state.winner = winner;
    room.state.status = "timeout";
    room.state.turnEndsAt = Date.now();
    room.state.updatedAt = Date.now();
    handleMatchEnd(io, room, "timeout");
    broadcastRoom(io, room, "stateUpdate", {
      room: roomSummary(room),
      reason: "timeout",
    });
  }, room.state.turnTimeMs + 50);
}

function createMatchRoom(io, { mode, id, code, a, b }) {
  const state = createState({
    mode,
    players: { X: a.name, O: b.name },
    turnTimeMs: TURN_TIME_MS,
  });
  const room = {
    id,
    code,
    mode,
    state,
    players: {
      X: { ...a, symbol: "X" },
      O: { ...b, symbol: "O" },
    },
    spectators: new Set(),
    pendingDraw: null,
    rematchVotes: new Set(),
    turnTimer: null,
    finalized: false,
  };

  stateStore.rooms.set(id, room);
  a.socket.join(id);
  b.socket.join(id);
  a.record.roomId = id;
  b.record.roomId = id;
  a.record.symbol = "X";
  b.record.symbol = "O";

  scheduleTurnTimeout(io, room);

  return room;
}

function handleMatchEnd(io, room, reason) {
  if (!room.state.winner || room.finalized) return;
  room.finalized = true;
  if (room.mode === "competitive") {
    updateCompetitiveRatings(io, room, reason);
  } else {
    updateScoreboard(room);
  }
}

async function updateCompetitiveRatings(io, room, reason) {
  const db = getFirestore();
  if (!db) return;
  const winner = room.state.winner;
  const x = room.players.X;
  const o = room.players.O;
  if (!x?.uid || !o?.uid) return;
  const xScore = winner === "D" ? 0.5 : winner === "X" ? 1 : 0;
  const oScore = winner === "D" ? 0.5 : winner === "O" ? 1 : 0;
  const xResult = calcElo(x.rating, o.rating, xScore);
  const oResult = calcElo(o.rating, x.rating, oScore);

  await db.runTransaction(async (tx) => {
    const xRef = db.collection("users").doc(x.uid);
    const oRef = db.collection("users").doc(o.uid);
    const xSnap = await tx.get(xRef);
    const oSnap = await tx.get(oRef);
    const xData = xSnap.data();
    const oData = oSnap.data();
    if (!xData || !oData) return;
    const xRating = xResult.newRating;
    const oRating = oResult.newRating;
    const xRank = getRankFromRating(xRating).name;
    const oRank = getRankFromRating(oRating).name;
    const xUpdates = {
      rating: xRating,
      rank: xRank,
      wins: xData.wins + (xScore === 1 ? 1 : 0),
      losses: xData.losses + (xScore === 0 ? 1 : 0),
      draws: xData.draws + (xScore === 0.5 ? 1 : 0),
    };
    const oUpdates = {
      rating: oRating,
      rank: oRank,
      wins: oData.wins + (oScore === 1 ? 1 : 0),
      losses: oData.losses + (oScore === 0 ? 1 : 0),
      draws: oData.draws + (oScore === 0.5 ? 1 : 0),
    };
    tx.update(xRef, xUpdates);
    tx.update(oRef, oUpdates);
    tx.set(db.collection("matches").doc(), {
      mode: "competitive",
      players: [x.uid, o.uid],
      result: winner,
      ratingDeltas: {
        [x.uid]: xResult.delta,
        [o.uid]: oResult.delta,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  io.to(room.id).emit("ratingUpdate", {
    X: { delta: xResult.delta, rating: xResult.newRating, rank: getRankFromRating(xResult.newRating).name },
    O: { delta: oResult.delta, rating: oResult.newRating, rank: getRankFromRating(oResult.newRating).name },
    reason,
  });
}

function ensureCompetitiveQueue(tier) {
  if (!stateStore.competitiveQueues.has(tier)) {
    stateStore.competitiveQueues.set(tier, []);
  }
  return stateStore.competitiveQueues.get(tier);
}

function removeFromCompetitiveQueue(socketId) {
  for (const [tier, queue] of stateStore.competitiveQueues.entries()) {
    stateStore.competitiveQueues.set(
      tier,
      queue.filter((item) => item.socket.id !== socketId)
    );
  }
}

function tryMatchCompetitive(io, tier) {
  const queue = ensureCompetitiveQueue(tier);
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (!a.socket.connected) continue;
    if (!b.socket.connected) continue;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const room = createMatchRoom(io, { mode: "competitive", id, a, b });
    a.socket.emit("competitiveMatchFound", { room: roomSummary(room), symbol: "X" });
    b.socket.emit("competitiveMatchFound", { room: roomSummary(room), symbol: "O" });
  }
}

function createSocialRoom(io, host) {
  const code = getUniqueSocialCode();
  const room = {
    id: code,
    code,
    mode: "social",
    state: createState({
      mode: "social",
      players: { X: host.name, O: "Waiting..." },
      turnTimeMs: TURN_TIME_MS,
    }),
    players: {
      X: { ...host, symbol: "X" },
      O: null,
    },
    spectators: new Set(),
    pendingDraw: null,
    rematchVotes: new Set(),
    turnTimer: null,
    finalized: false,
  };

  stateStore.socialRooms.set(code, room);
  stateStore.rooms.set(code, room);
  host.socket.join(code);
  host.record.roomId = code;
  host.record.symbol = "X";

  host.socket.emit("socialRoomCreated", {
    room: roomSummary(room),
    code,
    symbol: "X",
  });
}

function joinSocialRoom(io, socket, code, player) {
  const room = stateStore.socialRooms.get(code);
  if (!room) {
    socket.emit("errorMessage", { message: "Room not found." });
    return;
  }
  if (room.players.O) {
    socket.emit("errorMessage", { message: "Room is full." });
    return;
  }
  room.players.O = { ...player, symbol: "O" };
  room.state.players.O = player.name;
  room.state.status = "playing";
  room.state.updatedAt = Date.now();
  socket.join(code);
  player.record.roomId = code;
  player.record.symbol = "O";
  scheduleTurnTimeout(io, room);
  socket.emit("socialRoomJoined", { room: roomSummary(room), symbol: "O" });
  broadcastRoom(io, room, "stateUpdate", { room: roomSummary(room), reason: "join" });
}

export function initSocketServer(httpServer) {
  if (globalThis.__uttt_io) return globalThis.__uttt_io;

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
  });

  globalThis.__uttt_io = io;

  io.on("connection", (socket) => {
    socket.on("hello", ({ name, token }) => {
      const safeName = String(name || "Player").slice(0, 24);
      let record = token ? getPlayerRecord(token) : null;
      if (!record) {
        record = {
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          name: safeName,
          token: token || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
          socketId: socket.id,
          roomId: null,
          symbol: null,
        };
      }
      record.name = safeName;
      record.socketId = socket.id;
      setPlayerRecord(record.token, record);
      socket.data.player = record;
      const previousNameKey = socket.data.nameKey;
      if (previousNameKey && stateStore.nameToSockets.has(previousNameKey)) {
        stateStore.nameToSockets.get(previousNameKey).delete(socket.id);
        if (stateStore.nameToSockets.get(previousNameKey).size === 0) {
          stateStore.nameToSockets.delete(previousNameKey);
        }
        notifyFriendStatus(io, previousNameKey);
      }
      const nameKey = safeName.toLowerCase();
      ensureNameBucket(nameKey).add(socket.id);
      socket.data.nameKey = nameKey;
      notifyFriendStatus(io, nameKey);
      socket.emit("helloAck", { token: record.token, playerId: record.id, name: record.name });

      if (record.roomId) {
        const room = stateStore.rooms.get(record.roomId);
        if (room) {
          socket.join(room.id);
          if (room.players[record.symbol]) {
            room.players[record.symbol].socket = socket;
            room.players[record.symbol].socketId = socket.id;
          }
          socket.emit("reconnected", {
            room: roomSummary(room),
            symbol: record.symbol,
          });
        }
      }
    });

    socket.on("createSocialRoom", () => {
      const player = socket.data.player;
      if (!player) return;
      createSocialRoom(io, { socket, name: player.name, id: player.id, record: player });
    });

    socket.on("joinSocialRoom", ({ code }) => {
      const player = socket.data.player;
      if (!player) return;
      const safeCode = String(code || "").trim().toUpperCase();
      joinSocialRoom(io, socket, safeCode, { socket, name: player.name, id: player.id, record: player });
    });

    socket.on("spectateSocialRoom", ({ code }) => {
      const room = stateStore.socialRooms.get(String(code || "").trim().toUpperCase());
      if (!room) {
        socket.emit("errorMessage", { message: "Room not found." });
        return;
      }
      room.spectators.add(socket.id);
      socket.join(room.id);
      socket.emit("spectatorJoined", { room: roomSummary(room) });
      broadcastRoom(io, room, "stateUpdate", {
        room: roomSummary(room),
        reason: "spectate",
      });
    });

    socket.on("joinCompetitiveQueue", async ({ idToken }) => {
      const player = socket.data.player;
      const db = getFirestore();
      if (!player || !db) {
        socket.emit("errorMessage", { message: "Competitive unavailable." });
        return;
      }
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();
        let userData = userSnap.data();
        if (!userData) {
          const rating = 1000;
          const rank = getRankFromRating(rating).name;
          userData = { displayName: player.name, rating, rank, wins: 0, losses: 0, draws: 0 };
          await userRef.set({ ...userData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        const tier = getRankFromRating(userData.rating).name;
        const queue = ensureCompetitiveQueue(tier);
        queue.push({
          socket,
          name: userData.displayName || player.name,
          id: player.id,
          uid,
          rating: userData.rating,
          rank: userData.rank,
          record: player,
        });
        socket.emit("queueStatus", { queued: true, position: queue.length, tier });
        tryMatchCompetitive(io, tier);
      } catch (error) {
        socket.emit("errorMessage", { message: "Authentication failed." });
      }
    });

    socket.on("leaveCompetitiveQueue", () => {
      removeFromCompetitiveQueue(socket.id);
      socket.emit("queueStatus", { queued: false });
    });

    socket.on("joinQueue", ({ idToken }) => {
      socket.emit("errorMessage", { message: "Use competitive queue." });
      socket.emit("queueStatus", { queued: false });
      if (idToken) socket.emit("queueStatus", { queued: false });
    });

    socket.on("leaveQueue", () => {
      removeFromCompetitiveQueue(socket.id);
      socket.emit("queueStatus", { queued: false });
    });

    socket.on("spectate", ({ roomId }) => {
      const room = stateStore.rooms.get(roomId);
      if (!room) {
        socket.emit("errorMessage", { message: "Room not found." });
        return;
      }
      room.spectators.add(socket.id);
      socket.join(roomId);
      socket.emit("spectatorJoined", { room: roomSummary(room) });
    });

    socket.on("requestState", ({ roomId }) => {
      const room = stateStore.rooms.get(roomId);
      if (room) socket.emit("stateUpdate", { room: roomSummary(room), reason: "sync" });
    });

    socket.on("makeMove", ({ roomId, board, cell }) => {
      const room = stateStore.rooms.get(roomId);
      const player = socket.data.player;
      if (!room || !player) return;
      const symbol = player.symbol;
      if (!symbol || room.players[symbol]?.id !== player.id) {
        socket.emit("moveError", { message: "Not a player in this room." });
        return;
      }
      const result = applyMove(room.state, { board, cell }, { player: symbol, validate: true });
      if (!result.ok) {
        socket.emit("moveError", { message: result.error });
        return;
      }

      room.pendingDraw = null;
      room.rematchVotes.clear();
      if (room.state.winner) handleMatchEnd(io, room, "move");
      else scheduleTurnTimeout(io, room);
      broadcastRoom(io, room, "stateUpdate", { room: roomSummary(room), reason: "move" });
    });

    socket.on("sendChat", ({ roomId, text }) => {
      const room = stateStore.rooms.get(roomId);
      if (!room) return;
      const player = socket.data.player;
      const messageText = String(text || "").trim().slice(0, 200);
      if (!messageText) return;
      const payload = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        text: messageText,
        name: player?.name ?? "Player",
        symbol: player?.symbol ?? null,
        at: Date.now(),
      };
      io.to(room.id).emit("chatMessage", payload);
    });

    socket.on("addFriend", ({ name }) => {
      const safeName = String(name || "").trim().slice(0, 24);
      if (!safeName) return;
      const nameKey = safeName.toLowerCase();
      const watchers = ensureWatcherBucket(nameKey);
      watchers.set(socket.id, safeName);
      const online = (stateStore.nameToSockets.get(nameKey)?.size ?? 0) > 0;
      socket.emit("friendStatus", { name: safeName, online });
    });

    socket.on("challengeFriend", ({ name, code }) => {
      const player = socket.data.player;
      if (!player) return;
      const safeName = String(name || "").trim().slice(0, 24);
      const safeCode = String(code || "").trim().slice(0, 32);
      if (!safeName || !safeCode) return;
      const nameKey = safeName.toLowerCase();
      const targets = stateStore.nameToSockets.get(nameKey);
      if (!targets || targets.size === 0) {
        socket.emit("errorMessage", { message: "Friend is offline." });
        return;
      }
      for (const socketId of targets) {
        io.to(socketId).emit("friendChallenge", { from: player.name, code: safeCode });
      }
    });

    socket.on("offerDraw", ({ roomId }) => {
      const room = stateStore.rooms.get(roomId);
      const player = socket.data.player;
      if (!room || !player) return;
      if (room.pendingDraw) return;
      room.pendingDraw = player.symbol;
      broadcastRoom(io, room, "drawOffered", { from: player.symbol });
    });

    socket.on("respondDraw", ({ roomId, accept }) => {
      const room = stateStore.rooms.get(roomId);
      const player = socket.data.player;
      if (!room || !player) return;
      if (!room.pendingDraw) return;
      if (accept) {
        room.state.winner = "D";
        room.state.status = "draw";
        room.state.updatedAt = Date.now();
        handleMatchEnd(io, room, "draw");
        broadcastRoom(io, room, "stateUpdate", { room: roomSummary(room), reason: "draw" });
      } else {
        broadcastRoom(io, room, "drawDeclined", { by: player.symbol });
      }
      room.pendingDraw = null;
    });

    socket.on("requestRematch", ({ roomId }) => {
      const room = stateStore.rooms.get(roomId);
      const player = socket.data.player;
      if (!room || !player) return;
      room.rematchVotes.add(player.symbol);
      if (room.rematchVotes.size === 2) {
        room.state = createState({
          mode: room.mode,
          players: {
            X: room.players.X?.name ?? "Player 1",
            O: room.players.O?.name ?? "Player 2",
          },
          turnTimeMs: TURN_TIME_MS,
        });
        room.rematchVotes.clear();
        room.pendingDraw = null;
        room.finalized = false;
        scheduleTurnTimeout(io, room);
        broadcastRoom(io, room, "rematchStart", { room: roomSummary(room) });
      } else {
        broadcastRoom(io, room, "rematchVote", { from: player.symbol });
      }
    });

    socket.on("getScoreboard", () => {
      socket.emit("scoreboard", Array.from(stateStore.scoreboard.values()));
    });

    socket.on("disconnect", () => {
      removeFromCompetitiveQueue(socket.id);
      for (const room of stateStore.rooms.values()) {
        if (room.spectators?.has(socket.id)) {
          room.spectators.delete(socket.id);
          broadcastRoom(io, room, "stateUpdate", {
            room: roomSummary(room),
            reason: "spectatorLeft",
          });
        }
      }
      const nameKey = socket.data.nameKey;
      if (nameKey && stateStore.nameToSockets.has(nameKey)) {
        const bucket = stateStore.nameToSockets.get(nameKey);
        bucket.delete(socket.id);
        if (bucket.size === 0) {
          stateStore.nameToSockets.delete(nameKey);
        }
        notifyFriendStatus(io, nameKey);
      }
      for (const [watchKey, watchers] of stateStore.friendWatchers.entries()) {
        if (watchers.delete(socket.id) && watchers.size === 0) {
          stateStore.friendWatchers.delete(watchKey);
        }
      }
    });
  });

  return io;
}
