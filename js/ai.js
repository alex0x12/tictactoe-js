import { EMPTY, idx, rowOf, colOf, inside, place, unplace, opponent } from './board.js';
import { hasWin, candidates } from './rules.js';
import { WIN, weight, evaluate } from './eval.js';

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

// DIRECTIONS это четыре направления окна, как в eval.js и rules.js.
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

// moveGain(cells, N, K, i, player) считает, на сколько вырастет оценка игрока player,
// если он поставит камень в клетку i. Изменятся только окна, которые проходят через i,
// поэтому смотрим только их: до 4 * K окон вместо сотен окон всей доски.
// Своё живое окно растёт на ступень веса, живое окно соперника умирает и перестаёт
// вычитаться, окно с камнями обоих цветов уже мёртвое и ничего не меняет.
// r и c это координаты i, s это сдвиг начала окна назад от i, rs и cs начало окна,
// mine и theirs сколько в окне своих и чужих камней.
function moveGain(cells, N, K, i, player) {
  const r = rowOf(i, N);
  const c = colOf(i, N);
  let gain = 0;

  for (const [dr, dc] of DIRECTIONS) {
    for (let s = 0; s < K; s++) {
      const rs = r - dr * s;
      const cs = c - dc * s;
      if (!inside(rs, cs, N) || !inside(rs + dr * (K - 1), cs + dc * (K - 1), N)) continue;

      let mine = 0;
      let theirs = 0;
      for (let k = 0; k < K; k++) {
        const v = cells[idx(rs + dr * k, cs + dc * k, N)];
        if (v === player) mine++;
        else if (v !== EMPTY) theirs++;
      }

      if (theirs === 0) gain += weight(mine + 1, K) - (mine > 0 ? weight(mine, K) : 0);
      else if (mine === 0) gain += weight(theirs, K);
    }
  }

  return gain;
}

// orderMoves(ctx, moves, player) сортирует ходы от самого многообещающего к худшему
// по moveGain. Отсечение срабатывает тем раньше, чем раньше попался сильный ход, поэтому
// с сортировкой поиск быстрее в десятки раз. На оценку позиции сортировка не влияет,
// только на скорость. Порядок тот же, что дала бы полная оценка доски после хода,
// но moveGain раз в двадцать дешевле, поэтому сортировать выгодно на любой глубине.
// scored это пары [выигрыш, ход]. sort в JavaScript устойчивый: при равных значениях
// ходы остаются в исходном порядке, так что ответ ИИ всегда одинаковый.
function orderMoves(ctx, moves, player) {
  const { cells, N, K } = ctx;
  const scored = moves.map((move) => [moveGain(cells, N, K, move, player), move]);
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map((pair) => pair[1]);
}

// alphaBeta(ctx, player, depth, alpha, beta, lastMove, ply, stones) возвращает оценку
// позиции с точки зрения того, кто ходит (player). Это форма negamax: оценку ребёнка
// берём с минусом, потому что хорошее для соперника плохо для нас. Отдельной ветки
// для минимума не нужно.
// alpha это оценка, которую ходящий уже гарантировал себе выше по дереву, beta это
// предел, выше которого соперник нас сюда не пустит. Как только alpha >= beta,
// остальные ходы считать незачем: соперник выберет другую ветку раньше.
// depth это сколько полуходов ещё смотреть, на нуле зовём эвристику.
// ctx это общие для всего поиска данные: cells, N, K и счётчики nodes, cutoffs, leaves.
// В rootBest запоминаем лучший ход на корне (ply 0), его и сделает ИИ.
// Порядок проверок важен: сначала победа, потом полная доска, потом предел глубины.
// Последний ход мог и заполнить доску, и выиграть, это победа, а не ничья.
function alphaBeta(ctx, player, depth, alpha, beta, lastMove, ply, stones) {
  ctx.nodes++;
  const { cells, N, K } = ctx;

  // предыдущий ход сделал соперник; если он выиграл, для нас это поражение
  if (lastMove !== null && hasWin(cells, N, K, lastMove, opponent(player))) {
    return -(WIN - ply);
  }
  if (stones === N * N) {
    ctx.leaves++;
    return 0;
  }
  if (depth === 0) {
    ctx.leaves++;
    return evaluate(cells, N, K, player);
  }

  for (const move of orderMoves(ctx, candidates(cells, N, K), player)) {
    place(cells, move, player);
    const v = -alphaBeta(ctx, opponent(player), depth - 1, -beta, -alpha, move, ply + 1, stones + 1);
    unplace(cells, move);

    if (v > alpha) {
      alpha = v;
      if (ply === 0) ctx.rootBest = move;
    }
    if (alpha >= beta) {
      ctx.cutoffs++;
      break;                                             // отсечение
    }
  }

  // ничья 0 после смены знака становится -0. Прибавление нуля превращает -0 в 0,
  // а другие числа не меняет. Без этого тест сравнения с minimax видит -0 !== 0
  return alpha + 0;
}

// DEPTHS это глубина поиска для каждого уровня сложности, в полуходах.
// 1 значит "смотрю только свой ход", 2 "свой ход и ответ соперника",
// 4 уже видит вилки: ход, после которого у соперника две угрозы сразу.
const DEPTHS = { easy: 1, medium: 2, hard: 4 };

// FULL_SEARCH это сколько пустых клеток должно остаться, чтобы "Сложный" считал
// до самого конца партии. На 3x3 это с первого хода, поэтому там ИИ непобедим.
const FULL_SEARCH = 10;

// DEEP_MAX_K и DEEP_MAX_MOVES это границы, в которых "Сложный" успевает посчитать
// глубину 4 меньше чем за секунду. При K от 6 почти все окна весят 1, сортировка
// плохо различает ходы, и глубина 4 занимает до 9 секунд. Больше 100 кандидатов
// тоже слишком много. За этими границами "Сложный" смотрит на 3 полухода.
const DEEP_MAX_K = 5;
const DEEP_MAX_MOVES = 100;

// searchDepth(difficulty, empties, K, moves) возвращает глубину для уровня сложности.
// empties это сколько пустых клеток на доске, moves сколько ходов-кандидатов.
// "Сложный" при малом числе пустых клеток считает до конца партии, а при большом K
// или большом числе кандидатов глубину 4 заменяет на 3.
function searchDepth(difficulty, empties, K, moves) {
  if (difficulty !== 'hard') return DEPTHS[difficulty];
  if (empties <= FULL_SEARCH) return empties;
  if (K > DEEP_MAX_K || moves > DEEP_MAX_MOVES) return 3;
  return DEPTHS.hard;
}

// chooseMove(cells, N, K, player, difficulty) выбирает ход ИИ и возвращает объект
// { move, score, depth, nodes, cutoffs, ms }. Всё, кроме move, нужно для проверки
// в консоли: сколько узлов посмотрел поиск и сколько это заняло.
// Если какой-то ход выигрывает сразу, он возвращается без поиска: лучше него ничего
// не найти, а поиск потратил бы время, доказывая, что остальные ходы хуже.
// moves это ходы-кандидаты, их число нужно и для выбора глубины.
// cells после вызова такой же, как до: каждый place в поиске парный с unplace.
function chooseMove(cells, N, K, player, difficulty) {
  const moves = candidates(cells, N, K);
  for (const move of moves) {
    place(cells, move, player);
    const wins = hasWin(cells, N, K, move, player);
    unplace(cells, move);
    if (wins) return { move, score: WIN - 1, depth: 0, nodes: 0, cutoffs: 0, ms: 0 };
  }

  const stones = countStones(cells);
  const depth = searchDepth(difficulty, N * N - stones, K, moves.length);
  const ctx = { cells, N, K, nodes: 0, cutoffs: 0, leaves: 0, rootBest: -1 };

  const t0 = performance.now();
  const score = alphaBeta(ctx, player, depth, -Infinity, Infinity, null, 0, stones);
  const ms = Math.round(performance.now() - t0);

  return { move: ctx.rootBest, score, depth, nodes: ctx.nodes, cutoffs: ctx.cutoffs, ms };
}

export {
  minimax, bestMoveNaive,
  moveGain, orderMoves, alphaBeta,
  DEPTHS, FULL_SEARCH, DEEP_MAX_K, DEEP_MAX_MOVES, searchDepth, chooseMove,
};
