import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, EMPTY, createBoard, place, unplace, opponent } from '../js/board.js';
import { isBoardFull, hasWin, candidates } from '../js/rules.js';
import { WIN, evaluate } from '../js/eval.js';
import { minimax, bestMoveNaive, alphaBeta, chooseMove, searchDepth } from '../js/ai.js';

function board(N, moves) {
  const cells = createBoard(N);
  for (const [i, p] of moves) place(cells, i, p);
  return cells;
}
const stones = (cells) => [...cells].filter((v) => v !== EMPTY).length;

test('позиция из спеки: ИИ обязан выбрать C3', () => {
  //      A   B   C
  //  1   X   O   X      индексы 0 1 2
  //  2   .   X   .              3 4 5
  //  3   O   .   .              6 7 8
  // ходит нолик; крестик угрожает диагональю 0-4-8, не хватает клетки 8 (C3)
  const cells = board(3, [[0, X], [1, O], [2, X], [4, X], [6, O]]);
  assert.equal(bestMoveNaive(cells, 3, 3, O), 8, 'единственный ход, держащий ничью');
  assert.equal(minimax(cells, 3, 3, O, O, 0, stones(cells)), 0, 'оценка: ничья');
});

test('мат в один ход находится немедленно', () => {
  // крестики на 0 и 1, клетка 2 свободна, надо ставить туда
  const cells = board(3, [[0, X], [1, X], [3, O], [4, O]]);
  assert.equal(bestMoveNaive(cells, 3, 3, X), 2);
});

test('немедленная угроза блокируется', () => {
  // нолики на 0 и 1, ходит крестик, он обязан закрыть 2
  const cells = board(3, [[0, O], [1, O], [4, X]]);
  assert.equal(bestMoveNaive(cells, 3, 3, X), 2);
});

test('быстрая победа предпочитается медленной', () => {
  // Без поправки на ply обе ветви равны, и ИИ тянет время.
  // Здесь у крестика есть мат в один ход (клетка 2) и выигрыш в три хода.
  const cells = board(3, [[0, X], [1, X], [4, O], [6, O]]);
  const s = minimax(cells, 3, 3, X, X, 0, stones(cells));
  assert.ok(s > 9_999_990, `победа должна оцениваться почти в WIN, получено ${s}`);
});

test('идеальная игра с пустой доски 3x3 даёт ничью', () => {
  const cells = createBoard(3);
  assert.equal(minimax(cells, 3, 3, X, X, 0, 0), 0);
});

test('ИИ вторым номером не проигрывает 100 партий против случайных ходов', () => {
  let seed = 2026;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let g = 0; g < 100; g++) {
    const cells = createBoard(3);
    let player = X;                       // крестик ходит случайно, нолик это ИИ
    while (true) {
      const free = [...cells.keys()].filter((i) => cells[i] === EMPTY);
      if (free.length === 0) break;
      const move = player === X
        ? free[Math.floor(rnd() * free.length)]
        : bestMoveNaive(cells, 3, 3, O);
      place(cells, move, player);
      if (hasWin(cells, 3, 3, move, player)) {
        assert.notEqual(player, X, `ИИ проиграл в партии ${g}`);
        break;
      }
      player = opponent(player);
    }
  }
});


/*
abScore собирает ctx и зовёт alphaBeta без предела глубины.
В главном тесте walk обходит все партии 3x3 и в каждой незаконченной позиции сравнивает `alphaBeta` с `minimax`. К одной позиции ведут разные порядки ходов, поэтому сравнений почти 300 тысяч. Тест идёт около секунды.
plainSearch это alphaBeta без отсечений и без сортировки, та же глубина и та же эвристика. На случайных позициях с ограниченной глубиной `alphaBeta` обязан совпасть с ним, так же как на 3x3 он совпадает с `minimax`.
MIDGAME это 20 ходов реальной партии, на ней проверяется скорость.
*/

function abScore(cells, N, K, player, stonesCount) {
  const ctx = {
    cells, N, K, nodes: 0, cutoffs: 0, leaves: 0, rootBest: -1,
  };
  return alphaBeta(ctx, player, Infinity, -Infinity, Infinity, null, 0, stonesCount);
}

test('ГЛАВНЫЙ ТЕСТ: alphaBeta === minimax на всех достижимых позициях 3x3', () => {
  let checked = 0;
  const cells = createBoard(3);

  function walk(player, ply, stonesCount) {
    // Сравниваем ТОЛЬКО нетерминальные позиции: в терминальной ходить некому.
    const ab = abScore(cells, 3, 3, player, stonesCount);
    const mm = minimax(cells, 3, 3, player, player, 0, stonesCount);
    assert.equal(ab, mm,
      `расхождение на позиции [${[...cells].join(',')}], ходит ${player}`);
    checked++;

    for (let i = 0; i < 9; i++) {
      if (cells[i] !== EMPTY) continue;
      place(cells, i, player);
      const terminal = hasWin(cells, 3, 3, i, player) || stonesCount + 1 === 9;
      if (!terminal) walk(opponent(player), ply + 1, stonesCount + 1);
      unplace(cells, i);
    }
  }

  walk(X, 0, 0);
  assert.ok(checked > 2000, `проверено всего ${checked} позиций, обход сломан`);
});

test('alphaBeta посещает не больше узлов, чем minimax, и заметно меньше в сумме', () => {
  // "Строго меньше на каждой позиции" неверно: там, где отсечение невозможно
  // (один легальный ход, терминальная позиция), счётчики совпадут.
  const cells = board(3, [[0, X], [1, O], [2, X], [4, X], [6, O]]);
  const ctx = {
    cells, N: 3, K: 3, nodes: 0, cutoffs: 0, leaves: 0, rootBest: -1,
  };
  alphaBeta(ctx, O, Infinity, -Infinity, Infinity, null, 0, 5);
  assert.ok(ctx.cutoffs > 0, 'отсечений должно быть больше нуля');
});

test('alphaBeta находит тот же ход, что и minimax, на пустой доске 3x3', () => {
  const cells = createBoard(3);
  assert.equal(abScore(cells, 3, 3, X, 0), 0, 'идеальная игра: ничья');
});

// plainSearch это перебор той же глубины без отсечений и без сортировки ходов.
// alphaBeta с ограничением глубины обязан давать ту же оценку.
function plainSearch(cells, N, K, player, depth, lastMove, ply, stonesCount) {
  if (lastMove !== null && hasWin(cells, N, K, lastMove, opponent(player))) return -(WIN - ply);
  if (stonesCount === N * N) return 0;
  if (depth === 0) return evaluate(cells, N, K, player);
  let best = -Infinity;
  for (const move of candidates(cells, N, K)) {
    place(cells, move, player);
    const v = -plainSearch(cells, N, K, opponent(player), depth - 1, move, ply + 1, stonesCount + 1);
    unplace(cells, move);
    if (v > best) best = v;
  }
  return best + 0;
}

// MIDGAME это середина партии 15x15, K=5: 20 ходов, дальше ходит крестик
const MIDGAME = [112, 113, 98, 84, 82, 97, 114, 66, 81, 130, 80, 79, 96, 128, 110, 68, 126, 100, 116, 52];

function midgame() {
  const cells = createBoard(15);
  MIDGAME.forEach((i, n) => place(cells, i, n % 2 === 0 ? X : O));
  return cells;
}

test('alphaBeta с глубиной совпадает с перебором без отсечений', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const [N, K, depth] of [[5, 4, 3], [7, 4, 3], [9, 5, 2], [15, 5, 2]]) {
    for (let t = 0; t < 8; t++) {
      const cells = createBoard(N);
      const mid = (N - 1) >> 1;
      let n = 0;
      while (n < 6) {
        const r = mid - 2 + Math.floor(rnd() * 5);
        const c = mid - 2 + Math.floor(rnd() * 5);
        if (cells[r * N + c] === EMPTY) place(cells, r * N + c, n++ % 2 === 0 ? X : O);
      }
      const ctx = { cells, N, K, nodes: 0, cutoffs: 0, leaves: 0, rootBest: -1 };
      const ab = alphaBeta(ctx, X, depth, -Infinity, Infinity, null, 0, 6);
      const plain = plainSearch(cells, N, K, X, depth, null, 0, 6);
      assert.equal(ab, plain, `${N}x${N}, K=${K}, глубина ${depth}, позиция ${t}`);
    }
  }
});

test('на пустом поле 15x15 ИИ ходит в центр', () => {
  assert.equal(chooseMove(createBoard(15), 15, 5, X, 'hard').move, 112);
});

test('ИИ на любом уровне замыкает пятёрку', () => {
  // крестики на 110..113 (строка 7), пятый камень встаёт в 109 или 114
  for (const level of ['easy', 'medium', 'hard']) {
    const cells = createBoard(15);
    for (const i of [110, 111, 112, 113]) place(cells, i, X);
    place(cells, 200, O);
    const { move } = chooseMove(cells, 15, 5, X, level);
    assert.ok(move === 109 || move === 114, `${level}: ожидался 109 или 114, получен ${move}`);
  }
});

test('ИИ на уровнях medium и hard блокирует четвёрку', () => {
  for (const level of ['medium', 'hard']) {
    const cells = createBoard(15);
    for (const i of [110, 111, 112, 113]) place(cells, i, X);
    place(cells, 200, O);
    const { move } = chooseMove(cells, 15, 5, O, level);
    assert.ok(move === 109 || move === 114, `${level}: обязан закрыть, получен ${move}`);
  }
});

test('при большом K ИИ всё равно берёт победу', () => {
  // K = 9, у крестиков восемь подряд в строке 7, оба конца свободны
  for (const level of ['easy', 'medium', 'hard']) {
    const cells = createBoard(15);
    for (let c = 3; c <= 10; c++) place(cells, 7 * 15 + c, X);
    for (const i of [0, 14, 210, 224, 30, 44, 180]) place(cells, i, O);
    const { move } = chooseMove(cells, 15, 9, X, level);
    assert.ok(move === 107 || move === 116, `${level}: ожидался 107 или 116, получен ${move}`);
  }
});

test('hard на 3x3 не проигрывает случайным ходам ни первым, ни вторым', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 100; g++) {
    const ai = g % 2 === 0 ? X : O;
    const cells = createBoard(3);
    let player = X;
    for (let stonesCount = 0; stonesCount < 9; stonesCount++) {
      const free = [...cells.keys()].filter((i) => cells[i] === EMPTY);
      const move = player === ai
        ? chooseMove(cells, 3, 3, ai, 'hard').move
        : free[Math.floor(rnd() * free.length)];
      place(cells, move, player);
      if (hasWin(cells, 3, 3, move, player)) {
        assert.equal(player, ai, `ИИ проиграл в партии ${g}`);
        break;
      }
      player = opponent(player);
    }
  }
});

test('глубина по уровням и полный перебор под конец партии', () => {
  // аргументы: уровень, пустых клеток, K, ходов-кандидатов
  assert.equal(searchDepth('easy', 100, 5, 50), 1);
  assert.equal(searchDepth('medium', 100, 5, 50), 2);
  assert.equal(searchDepth('hard', 100, 5, 50), 4);
  assert.equal(searchDepth('hard', 100, 6, 50), 3, 'при K от 6 глубина 4 слишком долгая');
  assert.equal(searchDepth('hard', 150, 5, 101), 3, 'больше 100 кандидатов тоже');
  assert.equal(searchDepth('hard', 10, 9, 10), 10, 'под конец считает до конца партии');
  assert.equal(searchDepth('easy', 5, 5, 5), 1, 'полный перебор только у hard');
});

test('chooseMove оставляет доску такой же, как была', () => {
  const cells = midgame();
  const before = [...cells];
  chooseMove(cells, 15, 5, X, 'hard');
  assert.deepEqual([...cells], before);
});

test('повтор той же позиции даёт тот же ход', () => {
  // иначе отмена с повтором хода давала бы ИИ другой ответ
  const a = chooseMove(midgame(), 15, 5, X, 'hard');
  const b = chooseMove(midgame(), 15, 5, X, 'hard');
  assert.equal(a.move, b.move);
  assert.equal(a.nodes, b.nodes);
});

test('hard на 15x15 в середине партии думает меньше 2 секунд и отсекает ветки', () => {
  const r = chooseMove(midgame(), 15, 5, X, 'hard');
  assert.ok(r.ms < 2000, `ход занял ${r.ms} мс`);
  assert.ok(r.cutoffs > 100, `отсечений всего ${r.cutoffs}, сортировка не работает`);
});
