const LINES = [
	[0, 1, 2],
	[3, 4, 5],
	[6, 7, 8],
	[0, 3, 6],
	[1, 4, 7],
	[2, 5, 8],
	[0, 4, 8],
	[2, 4, 6]
];

export const PLAYERS = ['X', 'O'];

export function createEmptyBoard() {
	return {
		cells: Array(9).fill(null),
		winner: null,
		winLine: null,
		lastMove: null
	};
}

export function createState({
	id,
	mode = 'local',
	players = { X: 'Player 1', O: 'Player 2' },
	turnTimeMs = 25000
} = {}) {
	return {
		id: id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
		mode,
		players,
		boards: Array.from({ length: 9 }, () => createEmptyBoard()),
		currentPlayer: 'X',
		forcedBoard: null,
		winner: null,
		winLine: null,
		status: 'playing',
		lastMove: null,
		moves: [],
		moveCount: 0,
		turnTimeMs,
		turnEndsAt: Date.now() + turnTimeMs,
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

export function cloneState(state) {
	try {
		return structuredClone(state);
	} catch (error) {
		// Svelte $state proxies can fail structuredClone; JSON round-trip keeps data shape.
		return JSON.parse(JSON.stringify(state));
	}
}

export function serializeState(state) {
	return JSON.stringify(state);
}

export function deserializeState(raw) {
	const parsed = JSON.parse(raw);
	return parsed;
}

export function evaluateBoard(cells) {
	for (const line of LINES) {
		const [a, b, c] = line;
		if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
			return { winner: cells[a], winLine: line };
		}
	}
	if (cells.every(Boolean)) return { winner: 'D', winLine: null };
	return { winner: null, winLine: null };
}

export function isBoardComplete(board) {
	return Boolean(board.winner);
}

export function getLegalBoards(state) {
	if (state.forcedBoard !== null) {
		const forced = state.boards[state.forcedBoard];
		if (forced && !forced.winner) return [state.forcedBoard];
	}
	return state.boards.map((board, index) => (!board.winner ? index : null)).filter((v) => v !== null);
}

export function getLegalMoves(state) {
	const boards = getLegalBoards(state);
	const moves = [];
	for (const boardIndex of boards) {
		const board = state.boards[boardIndex];
		for (let cell = 0; cell < 9; cell += 1) {
			if (!board.cells[cell]) moves.push({ board: boardIndex, cell });
		}
	}
	return moves;
}

export function validateMove(state, move, player) {
	if (!state || state.status !== 'playing' || state.winner) return 'Game over';
	if (!PLAYERS.includes(player)) return 'Unknown player';
	if (state.currentPlayer !== player) return 'Not your turn';
	if (move.board < 0 || move.board > 8 || move.cell < 0 || move.cell > 8) return 'Out of bounds';
	const board = state.boards[move.board];
	if (!board || board.winner) return 'Board unavailable';
	if (state.forcedBoard !== null && state.forcedBoard !== move.board) return 'Forced board';
	if (board.cells[move.cell]) return 'Cell occupied';
	return null;
}

export function applyMove(state, move, { player, validate = true, now = Date.now() } = {}) {
	const actingPlayer = player ?? state.currentPlayer;
	if (validate) {
		const error = validateMove(state, move, actingPlayer);
		if (error) return { ok: false, error, state };
	}

	const board = state.boards[move.board];
	board.cells[move.cell] = actingPlayer;
	board.lastMove = move.cell;
	const boardResult = evaluateBoard(board.cells);
	if (boardResult.winner) {
		board.winner = boardResult.winner;
		board.winLine = boardResult.winLine;
	}

	const nextForced = state.boards[move.cell];
	state.forcedBoard = nextForced && !nextForced.winner ? move.cell : null;
	state.lastMove = { board: move.board, cell: move.cell, player: actingPlayer, at: now };
	state.moves.push(state.lastMove);
	state.moveCount += 1;
	state.currentPlayer = actingPlayer === 'X' ? 'O' : 'X';
	state.updatedAt = now;
	state.turnEndsAt = now + state.turnTimeMs;

	const global = evaluateGlobal(state);
	if (global.winner) {
		state.winner = global.winner;
		state.winLine = global.winLine;
		state.status = 'ended';
	}

	return { ok: true, state };
}

export function evaluateGlobal(state) {
	const macro = state.boards.map((board) => (board.winner === 'X' || board.winner === 'O' ? board.winner : null));
	for (const line of LINES) {
		const [a, b, c] = line;
		if (macro[a] && macro[a] === macro[b] && macro[a] === macro[c]) {
			return { winner: macro[a], winLine: line };
		}
	}
	if (state.boards.every((board) => board.winner)) return { winner: 'D', winLine: null };
	return { winner: null, winLine: null };
}

export function replayStateFromMoves(moves, seedState = createState()) {
	const state = cloneState(seedState);
	for (const move of moves) {
		applyMove(state, { board: move.board, cell: move.cell }, { player: move.player, validate: false, now: move.at });
	}
	return state;
}

export function getMacroCell(state, index) {
	const board = state.boards[index];
	return board.winner === 'X' || board.winner === 'O' ? board.winner : null;
}

export function getLineValue(cells, player) {
	let score = 0;
	for (const line of LINES) {
		const values = line.map((i) => cells[i]);
		const mine = values.filter((v) => v === player).length;
		const opp = values.filter((v) => v && v !== player).length;
		if (mine && !opp) score += Math.pow(3, mine);
		if (opp && !mine) score -= Math.pow(3, opp);
	}
	return score;
}

export function getBoardScore(board, player) {
	if (board.winner === player) return 200;
	if (board.winner && board.winner !== player && board.winner !== 'D') return -200;
	if (board.winner === 'D') return 0;
	return getLineValue(board.cells, player);
}

export function getGlobalScore(state, player) {
	const macro = state.boards.map((board) => (board.winner === 'X' || board.winner === 'O' ? board.winner : null));
	return getLineValue(macro, player);
}
