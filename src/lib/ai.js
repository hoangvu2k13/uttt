import { applyMove, cloneState, getBoardScore, getGlobalScore, getLegalMoves } from './game.js';

const CENTER = 4;
const CORNERS = new Set([0, 2, 6, 8]);

function evaluate(state, player) {
	if (state.winner === player) return 100000;
	if (state.winner && state.winner !== player && state.winner !== 'D') return -100000;
	if (state.winner === 'D') return 0;

	let score = 0;
	score += getGlobalScore(state, player) * 50;
	for (let i = 0; i < 9; i += 1) {
		const board = state.boards[i];
		score += getBoardScore(board, player);
		if (!board.winner && board.cells[CENTER] === player) score += 1.5;
	}
	return score;
}

function orderMoves(state, moves, player) {
	return moves
		.map((move) => {
			let weight = 0;
			if (move.cell === CENTER) weight += 2;
			if (CORNERS.has(move.cell)) weight += 1;
			const board = state.boards[move.board];
			if (board.cells[CENTER] === player) weight += 0.5;
			return { move, weight };
		})
		.sort((a, b) => b.weight - a.weight)
		.map((item) => item.move);
}

function minimax(state, depth, alpha, beta, maximizingPlayer, player) {
	if (depth === 0 || state.winner) {
		return { score: evaluate(state, player) };
	}

	const moves = orderMoves(state, getLegalMoves(state), player);
	let bestMove = moves[0];

	if (maximizingPlayer) {
		let value = -Infinity;
		for (const move of moves) {
			const next = cloneState(state);
			applyMove(next, move, { player: next.currentPlayer, validate: false, now: next.updatedAt + 1 });
			const result = minimax(next, depth - 1, alpha, beta, false, player);
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
		applyMove(next, move, { player: next.currentPlayer, validate: false, now: next.updatedAt + 1 });
		const result = minimax(next, depth - 1, alpha, beta, true, player);
		if (result.score < value) {
			value = result.score;
			bestMove = move;
		}
		beta = Math.min(beta, value);
		if (alpha >= beta) break;
	}
	return { score: value, move: bestMove };
}

export function chooseBotMove(state, difficulty = 'medium') {
	const legal = getLegalMoves(state);
	if (!legal.length) return null;
	if (difficulty === 'easy') {
		return legal[Math.floor(Math.random() * legal.length)];
	}

	const depth = difficulty === 'hard' ? 3 : 2;
	const result = minimax(state, depth, -Infinity, Infinity, true, state.currentPlayer);
	if (difficulty === 'medium' && Math.random() < 0.2) {
		return legal[Math.floor(Math.random() * legal.length)];
	}
	return result.move ?? legal[0];
}
