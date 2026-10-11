import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, createBoard, place } from '../js/board.js';
import { hasWin, winLine, candidates, isBoardFull } from '../js/rules.js';

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

test('на поле 3×3 кандидаты — ВСЕ пустые клетки', () => {
  // Порог «пустых <= 30» обязан сработать: на 3×3 их максимум 9.
  const cells = board(3, [[0, X]]);
  const got = candidates(cells, 3, 3).sort((a, b) => a - b);
  assert.deepEqual(got, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('на пустом поле 15×15 кандидат ровно один — центр', () => {
  const cells = createBoard(15);
  const got = candidates(cells, 15, 5);
  assert.equal(got.length, 1);
  assert.equal(got[0], 7 * 15 + 7, 'центр поля 15×15 — это (7,7)');
});

test('на пустом поле 3×3 кандидатов девять, а не один', () => {
  // Порог по числу пустых клеток срабатывает РАНЬШЕ проверки «доска пуста»
  const cells = createBoard(3);
  assert.equal(candidates(cells, 3, 3).length, 9);
});

test('на 15×15 кандидаты лежат в радиусе 2 от камня при K=5', () => {
  const cells = createBoard(15);
  const centre = 7 * 15 + 7;
  place(cells, centre, X);
  const got = candidates(cells, 15, 5);
  // квадрат 5×5 вокруг камня минус сам камень
  assert.equal(got.length, 24);
  for (const i of got) {
    const dr = Math.abs(Math.trunc(i / 15) - 7);
    const dc = Math.abs((i % 15) - 7);
    assert.ok(Math.max(dr, dc) <= 2, `клетка ${i} дальше радиуса 2`);
  }
});

test('на 15×15 радиус 1 при K=4', () => {
  const cells = createBoard(15);
  place(cells, 7 * 15 + 7, X);
  assert.equal(candidates(cells, 15, 4).length, 8, 'квадрат 3×3 минус сам камень');
});

test('кандидатами не бывают занятые клетки', () => {
  const cells = createBoard(15);
  place(cells, 7 * 15 + 7, X);
  place(cells, 7 * 15 + 8, O);
  const got = candidates(cells, 15, 5);
  assert.ok(!got.includes(7 * 15 + 7));
  assert.ok(!got.includes(7 * 15 + 8));
});

test('когда пустых клеток мало, радиус выключается', () => {
  // 15×15, заполнено 200 клеток → пустых 25 → порог сработал
  const cells = createBoard(15);
  for (let i = 0; i < 200; i++) place(cells, i, i % 2 === 0 ? X : O);
  assert.equal(candidates(cells, 15, 5).length, 25);
});

test('isBoardFull', () => {
  const cells = createBoard(3);
  assert.equal(isBoardFull(cells), false);
  for (let i = 0; i < 9; i++) place(cells, i, X);
  assert.equal(isBoardFull(cells), true);
});
