import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, createBoard, place } from '../js/board.js';
import { hasWin, winLine } from '../js/rules.js';

// Вспомогательная: расставить камни и вернуть поле.
// moves — массив [индекс, игрок]
function board(N, moves)
{
  const cells = createBoard(N);
  for (const [i, p] of moves) place(cells, i, p);
  return cells;
}

test('горизонталь: три подряд при K=3', () => {
  const cells = board(5, [[5, X], [6, X], [7, X]]);
  assert.equal(hasWin(cells, 5, 3, 7, X), true);
});


test('вертикаль: три подряд при K=3', () => {
  const cells = board(5, [[2, O], [7, O], [12, O]]);
  assert.equal(hasWin(cells, 5, 3, 12, O), true);
});

test('диагональ вниз-вправо', () => {
  // A1, B2, C3, D4 при K=4 на поле 5×5 → индексы 0, 6, 12, 18
  const cells = board(5, [[0, X], [6, X], [12, X], [18, X]]);
  assert.equal(hasWin(cells, 5, 4, 6, X), true, 'ход в середине цепочки тоже победа');
});

test('диагональ вниз-влево', () => {
  // C1, B2, A3 при K=3 на 5×5 → индексы 2, 6, 10
  const cells = board(5, [[2, O], [6, O], [10, O]]);
  assert.equal(hasWin(cells, 5, 3, 6, O), true);
});

test('двух камней при K=3 недостаточно', () => {
  const cells = board(5, [[5, X], [6, X]]);
  assert.equal(hasWin(cells, 5, 3, 6, X), false);
});

test('чужой камень разрывает цепочку', () => {
  const cells = board(5, [[5, X], [6, O], [7, X]]);
  assert.equal(hasWin(cells, 5, 3, 7, X), false);
});

test('ЛИНИЯ НЕ ЗАВОРАЧИВАЕТСЯ ЧЕРЕЗ КРАЙ ПОЛЯ', () => {
  // На поле 5×5 индексы 3, 4, 5 идут подряд по ПАМЯТИ,
  // но 4 — это E1 (конец первой строки), а 5 — A2 (начало второй).
  // Это не линия. Если проверять только «0 <= i < N*N», тест провалится.
  const cells = board(5, [[3, X], [4, X], [5, X]]);
  assert.equal(hasWin(cells, 5, 3, 5, X), false, 'E1 и A2 в разных строках');
  assert.equal(hasWin(cells, 5, 3, 4, X), false);
});

test('цепочка длиннее K тоже победа', () => {
  // пять подряд при K=3
  const cells = board(5, [[5, X], [6, X], [7, X], [8, X], [9, X]]);
  assert.equal(hasWin(cells, 5, 3, 7, X), true);
});

test('winLine возвращает ВСЮ цепочку, даже если она длиннее K', () => {
  const cells = board(5, [[5, X], [6, X], [7, X], [8, X], [9, X]]);
  const line = winLine(cells, 5, 3, 7, X);
  assert.deepEqual([...line].sort((a, b) => a - b), [5, 6, 7, 8, 9]);
});

test('winLine возвращает null, когда победы нет', () => {
  const cells = board(5, [[5, X], [6, X]]);
  assert.equal(winLine(cells, 5, 3, 6, X), null);
});

test('K = N: победа только по всей строке', () => {
  const cells = board(3, [[0, X], [1, X], [2, X]]);
  assert.equal(hasWin(cells, 3, 3, 1, X), true);
});
