import { applyMove, cloneState, getLegalMoves } from "./game.js";

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const CENTER = 4;
const CELL_CORNERS = new Set([0, 2, 6, 8]);
const BOARD_CORNERS = new Set([0, 2, 6, 8]);

const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const opponentOf = (player) => (player === "X" ? "O" : "X");

function isWinningMoveOnBoard(board, cell, player) {
  if (board.cells[cell]) return false;
  for (const line of LINES) {
    if (!line.includes(cell)) continue;
    const win = line.every((idx) => (idx === cell ? true : board.cells[idx] === player));
    if (win) return true;
  }
  return false;
}

function getImmediateWinningMoves(state, player) {
  const legal = getLegalMoves(state);
  const wins = [];
  for (const move of legal) {
    const board = state.boards[move.board];
    if (board?.winner) continue;
    if (isWinningMoveOnBoard(board, move.cell, player)) wins.push(move);
  }
  return wins;
}

function getBlockingMoves(state, player) {
  const opponent = opponentOf(player);
  const oppWins = getImmediateWinningMoves(state, opponent);
  if (!oppWins.length) return [];
  const set = new Set(oppWins.map((m) => `${m.board}-${m.cell}`));
  return getLegalMoves(state).filter((m) => set.has(`${m.board}-${m.cell}`));
}

function countTwoInRow(cells, player) {
  let count = 0;
  const opponent = opponentOf(player);
  for (const line of LINES) {
    let mine = 0;
    let opp = 0;
    let empty = 0;
    for (const idx of line) {
      const value = cells[idx];
      if (!value) empty += 1;
      else if (value === player) mine += 1;
      else opp += 1;
    }
    if (mine === 2 && empty === 1 && opp === 0) count += 1;
  }
  return count;
}

function countImmediateWinningMoves(board, player) {
  if (!board || board.winner) return 0;
  let count = 0;
  for (let cell = 0; cell < 9; cell += 1) {
    if (board.cells[cell]) continue;
    if (isWinningMoveOnBoard(board, cell, player)) count += 1;
  }
  return count;
}

function getMacro(state) {
  return state.boards.map((board) =>
    board.winner === "X" || board.winner === "O" ? board.winner : null,
  );
}

function countMacroTwoInRow(macro, player) {
  let count = 0;
  const opponent = opponentOf(player);
  for (const line of LINES) {
    let mine = 0;
    let opp = 0;
    let empty = 0;
    for (const idx of line) {
      const value = macro[idx];
      if (!value) empty += 1;
      else if (value === player) mine += 1;
      else opp += 1;
    }
    if (mine === 2 && empty === 1 && opp === 0) count += 1;
  }
  return count;
}

function isMetaWinningMove(state, move, player) {
  const board = state.boards[move.board];
  if (!board || board.winner) return false;
  if (!isWinningMoveOnBoard(board, move.cell, player)) return false;
  const macro = getMacro(state);
  macro[move.board] = player;
  return LINES.some((line) => line.every((idx) => macro[idx] === player));
}

function sendsOpponentToLosingBoard(state, move, player) {
  const target = state.boards[move.cell];
  if (!target || target.winner) return false;
  const opponent = opponentOf(player);
  const oppWins = countImmediateWinningMoves(target, opponent);
  const myWins = countImmediateWinningMoves(target, player);
  return myWins > 0 && oppWins === 0;
}

function evaluateState(state, player, { master = false } = {}) {
  const opponent = opponentOf(player);
  if (state.winner === player) return 100;
  if (state.winner && state.winner !== "D") return -100;
  if (state.winner === "D") return 0;

  let score = 0;
  const macro = getMacro(state);

  for (let i = 0; i < 9; i += 1) {
    const board = state.boards[i];
    if (!board) continue;
    if (board.winner === player) score += 10;
    else if (board.winner && board.winner !== "D") score -= 10;
    else {
      score += countTwoInRow(board.cells, player) * 2;
      score -= countTwoInRow(board.cells, opponent) * 2;
    }

    if (board.winner === player) {
      if (i === CENTER) score += 1;
      if (BOARD_CORNERS.has(i)) score += 0.5;
    } else if (board.winner === opponent) {
      if (i === CENTER) score -= 1;
      if (BOARD_CORNERS.has(i)) score -= 0.5;
    }

    if (master && !board.winner) {
      const playerCenter = board.cells[CENTER] === player;
      const playerCorner = [...CELL_CORNERS].some((idx) => board.cells[idx] === player);
      if (playerCenter && playerCorner) score += 4;

      const oppCenter = board.cells[CENTER] === opponent;
      const oppCorner = [...CELL_CORNERS].some((idx) => board.cells[idx] === opponent);
      if (oppCenter && oppCorner) score -= 4;
    }
  }

  if (state.forcedBoard !== null) {
    const forced = state.boards[state.forcedBoard];
    if (forced && !forced.winner) {
      if (countImmediateWinningMoves(forced, opponent) > 0) score -= 3;
      if (master && countImmediateWinningMoves(forced, opponent) === 0) score += 3;
    }
  }

  if (master) {
    score += countMacroTwoInRow(macro, player) * 5;
    score -= countMacroTwoInRow(macro, opponent) * 5;
  }

  return score;
}

function orderMoves(state, moves, player) {
  const opponent = opponentOf(player);
  const oppWinningSet = new Set(
    getImmediateWinningMoves(state, opponent).map((m) => `${m.board}-${m.cell}`),
  );
  return moves
    .map((move) => {
      let weight = 0;
      if (isMetaWinningMove(state, move, player)) weight += 1000;
      if (isWinningMoveOnBoard(state.boards[move.board], move.cell, player)) weight += 300;
      if (oppWinningSet.has(`${move.board}-${move.cell}`)) weight += 200;
      if (sendsOpponentToLosingBoard(state, move, player)) weight += 120;
      if (move.cell === CENTER) weight += 40;
      if (CELL_CORNERS.has(move.cell)) weight += 25;
      return { move, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.move);
}

function minimax(state, depth, alpha, beta, maximizing, player, ctx, masterEval) {
  if (ctx?.shouldAbort()) {
    ctx.aborted = true;
    return { score: evaluateState(state, player, { master: masterEval }), aborted: true };
  }
  if (depth === 0 || state.winner) {
    return { score: evaluateState(state, player, { master: masterEval }) };
  }

  const moves = orderMoves(state, getLegalMoves(state), state.currentPlayer);
  if (!moves.length) return { score: evaluateState(state, player, { master: masterEval }) };

  let bestMove = moves[0];
  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      const next = cloneState(state);
      applyMove(next, move, {
        player: next.currentPlayer,
        validate: false,
        now: next.updatedAt + 1,
      });
      const result = minimax(next, depth - 1, alpha, beta, false, player, ctx, masterEval);
      if (result.aborted) return result;
      if (result.score > value) {
        value = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return { score: value, move: bestMove };
  }

  let value = Infinity;
  for (const move of moves) {
    const next = cloneState(state);
    applyMove(next, move, {
      player: next.currentPlayer,
      validate: false,
      now: next.updatedAt + 1,
    });
    const result = minimax(next, depth - 1, alpha, beta, true, player, ctx, masterEval);
    if (result.aborted) return result;
    if (result.score < value) {
      value = result.score;
      bestMove = move;
    }
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return { score: value, move: bestMove };
}

function chooseEasyMove(state) {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  const player = state.currentPlayer;
  const winMoves = getImmediateWinningMoves(state, player);
  const blockMoves = getBlockingMoves(state, player);
  const roll = Math.random();
  if (roll < 0.2 && winMoves.length) return randItem(winMoves);
  if (roll < 0.3 && blockMoves.length) return randItem(blockMoves);
  return randItem(legal);
}

function chooseMediumMove(state) {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  const player = state.currentPlayer;
  const winMoves = getImmediateWinningMoves(state, player);
  if (winMoves.length) return randItem(winMoves);
  const blockMoves = getBlockingMoves(state, player);
  if (blockMoves.length && Math.random() < 0.6) return randItem(blockMoves);

  const weighted = [];
  for (const move of legal) {
    let weight = 1;
    if (move.cell === CENTER) weight = 2;
    else if (CELL_CORNERS.has(move.cell)) weight = 2;
    for (let i = 0; i < weight; i += 1) weighted.push(move);
  }
  return randItem(weighted);
}

function chooseHardMove(state) {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  const result = minimax(state, 4, -Infinity, Infinity, true, state.currentPlayer, null, false);
  return result.move ?? legal[0];
}

function chooseMasterMove(state) {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const limit = 160;
  let bestMove = legal[0];
  let depth = 2;
  while (true) {
    const ctx = {
      aborted: false,
      shouldAbort: () => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        return now - start > limit;
      },
    };
    const result = minimax(state, depth, -Infinity, Infinity, true, state.currentPlayer, ctx, true);
    if (result.aborted) break;
    if (result.move) bestMove = result.move;
    depth += 1;
    if (ctx.shouldAbort()) break;
  }
  return bestMove;
}

export function chooseBotMove(state, difficulty = "medium") {
  if (!state) return null;
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  if (difficulty === "easy") return chooseEasyMove(state);
  if (difficulty === "hard") return chooseHardMove(state);
  if (difficulty === "master") return chooseMasterMove(state);
  return chooseMediumMove(state);
}
