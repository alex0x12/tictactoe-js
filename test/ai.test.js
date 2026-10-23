import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, EMPTY, createBoard, place, unplace, opponent } from '../js/board.js';
import { isBoardFull, hasWin } from '../js/rules.js';
import { minimax, bestMoveNaive } from '../js/ai.js';

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
