import { EMPTY, place, unplace, opponent } from './board.js';
import { hasWin } from './rules.js';
import { WIN } from './eval.js';

// ai.js выбирает ход ИИ. Здесь два поиска: minimax и alphaBeta.
// minimax перебирает всё до конца партии без отсечений. В игре он не используется,
// он нужен тестам как эталон: alphaBeta обязан давать те же оценки.
// alphaBeta считает до заданной глубины, отсекает ветки, которые заведомо хуже уже
// найденных, и на пределе глубины зовёт эвристику из eval.js.
// Модуль не трогает DOM, поэтому его гоняют тесты в Node.

// minimax(cells, N, K, player, aiPlayer, ply, stones) возвращает оценку позиции с точки
// зрения aiPlayer, когда ходит player. Перебирает все ходы до конца партии.
// Ходит aiPlayer, значит берём максимум из оценок ходов, ходит соперник, значит минимум.
// Победа на ходу номер ply стоит WIN - ply - 1: чем раньше, тем дороже, поэтому ИИ
// выигрывает сразу, а не тянет время. Поражение стоит столько же с минусом.
// stones это число камней на доске, его передаём параметром, чтобы не пересчитывать.
// maximizing говорит, чей ход: true, если ходит сам aiPlayer.
function minimax(cells, N, K, player, aiPlayer, ply, stones) {
  if (stones === N * N) return 0;                        // доска полна, ничья

  const maximizing = player === aiPlayer;
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < N * N; i++) {
    if (cells[i] !== EMPTY) continue;

    place(cells, i, player);
    let v;
    if (hasWin(cells, N, K, i, player)) {
      v = maximizing ? WIN - ply - 1 : -(WIN - ply - 1);
    } else {
      v = minimax(cells, N, K, opponent(player), aiPlayer, ply + 1, stones + 1);
    }
    unplace(cells, i);

    best = maximizing ? Math.max(best, v) : Math.min(best, v);
  }

  return best;
}

// countStones(cells) считает камни на доске. Нужна корневым функциям поиска,
// дальше по дереву число камней передаётся параметром.
function countStones(cells) {
  let stones = 0;
  for (const v of cells) if (v !== EMPTY) stones++;
  return stones;
}

// bestMoveNaive(cells, N, K, player) возвращает индекс лучшего хода по minimax.
// Пробует каждую пустую клетку и берёт ту, где оценка выше. При равных оценках
// остаётся первая найденная. Работает только на 3x3: на 4x4 перебор уже не кончается.
function bestMoveNaive(cells, N, K, player) {
  const stones = countStones(cells);
  let best = -Infinity;
  let bestMove = -1;

  for (let i = 0; i < N * N; i++) {
    if (cells[i] !== EMPTY) continue;

    place(cells, i, player);
    const v = hasWin(cells, N, K, i, player)
      ? WIN - 1
      : minimax(cells, N, K, opponent(player), player, 1, stones + 1);
    unplace(cells, i);

    if (v > best) {
      best = v;
      bestMove = i;
    }
  }

  return bestMove;
}

export { minimax, bestMoveNaive };
