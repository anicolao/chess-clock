// @ts-nocheck
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_LETTERS = {
	p: '',
	n: 'N',
	b: 'B',
	r: 'R',
	q: 'Q',
	k: 'K'
};

function clonePiece(piece) {
	return piece ? { ...piece } : null;
}

function cloneBoard(board) {
	return board.map((piece) => clonePiece(piece));
}

function rowOf(index) {
	return Math.floor(index / 8);
}

function colOf(index) {
	return index % 8;
}

function indexFromRowCol(row, col) {
	return row * 8 + col;
}

function insideBoard(row, col) {
	return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function squareName(index) {
	return `${FILES[colOf(index)]}${8 - rowOf(index)}`;
}

function createInitialBoard() {
	const board = Array.from({ length: 64 }, () => null);
	const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

	for (let file = 0; file < 8; file += 1) {
		board[file] = { color: 'black', type: backRank[file] };
		board[8 + file] = { color: 'black', type: 'p' };
		board[48 + file] = { color: 'white', type: 'p' };
		board[56 + file] = { color: 'white', type: backRank[file] };
	}

	return board;
}

export function boardToOccupiedIndices(board) {
	return board
		.map((piece, index) => piece ? index : null)
		.filter((index) => index !== null)
		sort((a, b) => a - b);
}

export function createInitialPosition() {
	return {
		board: createInitialBoard(),
		sideToMove: 'white',
		castling: {
			whiteKingSide: true,
			whiteQueenSide: true,
			blackKingSide: true,
			blackQueenSide: true
		},
		enPassantTarget: null,
		halfmoveClock: 0,
		fullmoveNumber: 1
	};
}

function boardToOccupiedPieces(board) {
	return board
		.map((piece, index) => piece ? { index, color: piece.color } : null)
		.filter(Boolean)
		.map((entry) => ({
			index: entry.index,
			color: entry.color
		}))
		.sort((a, b) => a.index - b.index || a.color.localeCompare(b.color));
}

function occupiedIndicesEqual(board, observedIndices) {
	const expected = boardToOccupiedIndices(board);
	if (expected.length !== observedIndices.length) return false;
	for (let index = 0; index < expected.length; index += 1) {
		if (expected[index] !== observedIndices[index]) return false;
	}
	return true;
}

function slidingMoves(board, from, color, directions) {
	const moves = [];
	for (const [deltaRow, deltaCol] of directions) {
		let row = rowOf(from) + deltaRow;
		let col = colOf(from) + deltaCol;
		while (insideBoard(row, col)) {
			const to = indexFromRowCol(row, col);
			const target = board[to];
			if (!target) {
				moves.push({ from, to, piece: board[from], capture: false });
			} else {
				if (target.color !== color) {
					moves.push({ from, to, piece: board[from], capture: true });
				}
				break;
			}
			row += deltaRow;
			col += deltaCol;
		}
	}
	return moves;
}

function generatePawnMoves(position, from, piece) {
	const moves = [];
	const board = position.board;
	const row = rowOf(from);
	const col = colOf(from);
	const direction = piece.color === 'white' ? -1 : 1;
	const startRow = piece.color === 'white' ? 6 : 1;
	const promotionRow = piece.color === 'white' ? 0 : 7;

	const forwardRow = row + direction;
	if (insideBoard(forwardRow, col)) {
		const forward = indexFromRowCol(forwardRow, col);
		if (!board[forward]) {
			moves.push({
				from,
				to: forward,
				piece,
				capture: false,
				promotion: forwardRow === promotionRow ? 'q' : null
			});
			if (row === startRow) {
				const doubleForwardRow = row + direction * 2;
				const doubleForward = indexFromRowCol(doubleForwardRow, col);
				if (!board[doubleForward]) {
					moves.push({
						from,
						to: doubleForward,
						piece,
						capture: false,
						promotion: null,
						doubleStep: true
					});
				}
			}
		}
	}

	for (const deltaCol of [-1, 1]) {
		const captureRow = row + direction;
		const captureCol = col + deltaCol;
		if (!insideBoard(captureRow, captureCol)) continue;
		const to = indexFromRowCol(captureRow, captureCol);
		const target = board[to];
		if (target && target.color !== piece.color) {
			moves.push({
				from,
				to,
				piece,
				capture: true,
				promotion: captureRow === promotionRow ? 'q' : null
			});
			continue;
		}
		if (position.enPassantTarget === to) {
			moves.push({
				from,
				to,
				piece,
				capture: true,
				enPassant: true,
				promotion: null
			});
		}
	}

	return moves;
}

function generateKnightMoves(board, from, piece) {
	const moves = [];
	const offsets = [
		[-2, -1], [-2, 1], [-1, -2], [-1, 2],
		[1, -2], [1, 2], [2, -1], [2, 1]
	];
	for (const [deltaRow, deltaCol] of offsets) {
		const row = rowOf(from) + deltaRow;
		const col = colOf(from) + deltaCol;
		if (!insideBoard(row, col)) continue;
		const to = indexFromRowCol(row, col);
		const target = board[to];
		if (!target || target.color !== piece.color) {
			moves.push({ from, to, piece, capture: Boolean(target) });
		}
	}
	return moves;
}

function generateKingMoves(position, from, piece) {
	const moves = [];
	const board = position.board;
	for (let deltaRow = -1; deltaRow <= 1; deltaRow += 1) {
		for (let deltaCol = -1; deltaCol <= 1; deltaCol += 1) {
			if (deltaRow === 0 && deltaCol === 0) continue;
			const row = rowOf(from) + deltaRow;
			const col = colOf(from) + deltaCol;
			if (!insideBoard(row, col)) continue;
			const to = indexFromRowCol(row, col);
			const target = board[to];
			if (!target || target.color !== piece.color) {
				moves.push({ from, to, piece, capture: Boolean(target) });
			}
		}
	}

	if (piece.color === 'white' && from === 60) {
		if (
			position.castling.whiteKingSide
			&& !board[61]
			&& !board[62]
			&& board[63]?.type === 'r'
			&& board[63]?.color === 'white'
		) {
			moves.push({ from, to: 62, piece, capture: false, castle: 'K' });
		}
		if (
			position.castling.whiteQueenSide
			&& !board[59]
			&& !board[58]
			&& !board[57]
			&& board[56]?.type === 'r'
			&& board[56]?.color === 'white'
		) {
			moves.push({ from, to: 58, piece, capture: false, castle: 'Q' });
		}
	}

	if (piece.color === 'black' && from === 4) {
		if (
			position.castling.blackKingSide
			&& !board[5]
			&& !board[6]
			&& board[7]?.type === 'r'
			&& board[7]?.color === 'black'
		) {
			moves.push({ from, to: 6, piece, capture: false, castle: 'K' });
		}
		if (
			position.castling.blackQueenSide
			&& !board[3]
			&& !board[2]
			&& !board[1]
			&& board[0]?.type === 'r'
			&& board[0]?.color === 'black'
		) {
			moves.push({ from, to: 2, piece, capture: false, castle: 'Q' });
		}
	}

	return moves;
}

export function generatePseudoLegalMoves(position) {
	const moves = [];
	for (let from = 0; from < 64; from += 1) {
		const piece = position.board[from];
		if (!piece || piece.color !== position.sideToMove) continue;
		switch (piece.type) {
			case 'p':
				moves.push(...generatePawnMoves(position, from, piece));
				break;
			case 'n':
				moves.push(...generateKnightMoves(position.board, from, piece));
				break;
			case 'b':
				moves.push(...slidingMoves(position.board, from, piece.color, [[-1, -1], [-1, 1], [1, -1], [1, 1]]));
				break;
			case 'r':
				moves.push(...slidingMoves(position.board, from, piece.color, [[-1, 0], [1, 0], [0, -1], [0, 1]]));
				break;
			case 'q':
				moves.push(...slidingMoves(position.board, from, piece.color, [
					[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]
				]));
				break;
			case 'k':
				moves.push(...generateKingMoves(position, from, piece));
				break;
		}
	}
	return moves;
}

export function applyMove(position, move) {
	const next = {
		board: cloneBoard(position.board),
		sideToMove: position.sideToMove === 'white' ? 'black' : 'white',
		castling: { ...position.castling },
		enPassantTarget: null,
		halfmoveClock: move.capture || move.piece.type === 'p' ? 0 : position.halfmoveClock + 1,
		fullmoveNumber: position.sideToMove === 'black' ? position.fullmoveNumber + 1 : position.fullmoveNumber
	};

	const movingPiece = clonePiece(next.board[move.from]);
	next.board[move.from] = null;

	if (move.enPassant) {
		const capturedIndex = move.piece.color === 'white' ? move.to + 8 : move.to - 8;
		next.board[capturedIndex] = null;
	}

	if (move.castle === 'K') {
		if (move.piece.color === 'white') {
			next.board[61] = next.board[63];
			next.board[63] = null;
		} else {
			next.board[5] = next.board[7];
			next.board[7] = null;
		}
	}

	if (move.castle === 'Q') {
		if (move.piece.color === 'white') {
			next.board[59] = next.board[56];
			next.board[56] = null;
		} else {
			next.board[3] = next.board[0];
			next.board[0] = null;
		}
	}

	if (move.promotion) {
		movingPiece.type = move.promotion;
	}
	next.board[move.to] = movingPiece;

	if (move.piece.type === 'k') {
		if (move.piece.color === 'white') {
			next.castling.whiteKingSide = false;
			next.castling.whiteQueenSide = false;
		} else {
			next.castling.blackKingSide = false;
			next.castling.blackQueenSide = false;
		}
	}

	if (move.piece.type === 'r') {
		if (move.from === 56) next.castling.whiteQueenSide = false;
		if (move.from === 63) next.castling.whiteKingSide = false;
		if (move.from === 0) next.castling.blackQueenSide = false;
		if (move.from === 7) next.castling.blackKingSide = false;
	}

	if (move.capture && !move.enPassant) {
		if (move.to === 56) next.castling.whiteQueenSide = false;
		if (move.to === 63) next.castling.whiteKingSide = false;
		if (move.to === 0) next.castling.blackQueenSide = false;
		if (move.to === 7) next.castling.blackKingSide = false;
	}

	if (move.doubleStep) {
		next.enPassantTarget = move.piece.color === 'white' ? move.to + 8 : move.to - 8;
	}

	return next;
}

function needsDisambiguation(position, move) {
	const piece = move.piece;
	if (piece.type === 'p' || piece.type === 'k') return { file: false, rank: false };

	const competingMoves = generatePseudoLegalMoves(position).filter((candidate) =>
		candidate !== move
		&& candidate.to === move.to
		&& candidate.piece.type === piece.type
		&& candidate.piece.color === piece.color
	);

	if (competingMoves.length === 0) return { file: false, rank: false };

	const sameFile = competingMoves.some((candidate) => colOf(candidate.from) === colOf(move.from));
	const sameRank = competingMoves.some((candidate) => rowOf(candidate.from) === rowOf(move.from));

	if (!sameFile) return { file: true, rank: false };
	if (!sameRank) return { file: false, rank: true };
	return { file: true, rank: true };
}

export function moveToSan(position, move) {
	if (move.castle === 'K') return 'O-O';
	if (move.castle === 'Q') return 'O-O-O';

	const pieceLetter = PIECE_LETTERS[move.piece.type];
	const destination = squareName(move.to);
	const captureMark = move.capture ? 'x' : '';
	const promotion = move.promotion ? `=${PIECE_LETTERS[move.promotion]}` : '';

	if (move.piece.type === 'p') {
		const filePrefix = move.capture ? FILES[colOf(move.from)] : '';
		return `${filePrefix}${captureMark}${destination}${promotion}`;
	}

	const disambiguation = needsDisambiguation(position, move);
	const fromFile = disambiguation.file ? FILES[colOf(move.from)] : '';
	const fromRank = disambiguation.rank ? String(8 - rowOf(move.from)) : '';
	return `${pieceLetter}${fromFile}${fromRank}${captureMark}${destination}${promotion}`;
}

export function inferMoveFromObservedPosition(position, observedPieces) {
	const candidates = [];
	const observedIndices = observedPieces.map((piece) => piece.index).sort((a, b) => a - b);

	for (const move of generatePseudoLegalMoves(position)) {
		const nextPosition = applyMove(position, move);
		if (!occupiedIndicesEqual(nextPosition.board, observedIndices)) continue;
		candidates.push({
			move,
			nextPosition,
			san: moveToSan(position, move)
		});
	}

	if (candidates.length !== 1) {
		return {
			match: null,
			candidates
		};
	}

	return {
		match: candidates[0],
		candidates
	};
}
