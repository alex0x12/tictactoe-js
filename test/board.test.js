import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY, X, O, idx, rowOf, colOf, inside,
  createBoard, place, unplace, opponent,
} from '../js/board.js';

test('idx переводит строку и столбец в плоский индекс', () => {
  assert.equal(idx(0, 0, 5), 0);
  assert.equal(idx(0, 4, 5), 4);
  assert.equal(idx(1, 0, 5), 5);
  assert.equal(idx(4, 4, 5), 24);
});

test('rowOf и colOf обратны к idx на всём поле', () => {
  const N = 7;
  for (let i = 0; i < N * N; i++) {
    assert.equal(idx(rowOf(i, N), colOf(i, N), N), i, `сломалось на индексе ${i}`);
  }
});

test('inside проверяет строку и столбец по отдельности', () => {
  assert.equal(inside(0, 0, 5), true);
  assert.equal(inside(4, 4, 5), true);
  assert.equal(inside(-1, 0, 5), false);
  assert.equal(inside(0, -1, 5), false);
  assert.equal(inside(5, 0, 5), false);
  assert.equal(inside(0, 5, 5), false);
});

test('createBoard даёт пустое поле нужного размера', () => {
  const cells = createBoard(5);
  assert.equal(cells.length, 25);
  assert.ok(cells instanceof Int8Array);
  assert.ok([...cells].every((v) => v === EMPTY));
});

test('place и unplace обратны друг другу', () => {
  const cells = createBoard(5);
  place(cells, 12, X);
  assert.equal(cells[12], X);
  unplace(cells, 12);
  assert.equal(cells[12], EMPTY);
});

test('opponent меняет игрока туда и обратно', () => {
  assert.equal(opponent(X), O);
  assert.equal(opponent(O), X);
  assert.equal(opponent(opponent(X)), X);
});
