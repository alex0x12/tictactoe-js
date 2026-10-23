import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, createBoard, place } from '../js/board.js';
import { WIN, rawScore, evaluate } from '../js/eval.js';

function board(N, moves) {
  const cells = createBoard(N);
  for (const [i, p] of moves) place(cells, i, p);
  return cells;
}

test('пустая доска оценивается в ноль', () => {
  assert.equal(rawScore(createBoard(5), 5, 4), 0);
});

test('ОЦЕНКА АНТИСИММЕТРИЧНА: evaluate(X) === -evaluate(O)', () => {
  // На этом держится вся конструкция negamax.
  // Любой "множитель на чужие угрозы" ломает это равенство.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const cells = createBoard(7);
    for (let k = 0; k < 12; k++) {
      const i = Math.floor(rnd() * 49);
      if (cells[i] === 0) place(cells, i, k % 2 === 0 ? X : O);
    }
    assert.equal(
      evaluate(cells, 7, 4, X), -evaluate(cells, 7, 4, O),
      'антисимметрия нарушена',
    );
  }
});

test('симметричная позиция оценивается в ноль', () => {
  // У обоих одинаковая структура, зеркально отражённая.
  // крестики в строке 1, нолики в строке 5 (на поле 5x5 это зеркало по вертикали)
  const cells = board(5, [[0, X], [1, X], [20, O], [21, O]]);
  assert.equal(rawScore(cells, 5, 4), 0);
});

test('тройка стоит дороже двойки', () => {
  const two   = board(7, [[0, X], [1, X]]);
  const three = board(7, [[0, X], [1, X], [2, X]]);
  assert.ok(rawScore(three, 7, 4) > rawScore(two, 7, 4));
});

test('окно со смешанными камнями не даёт вклада', () => {
  // На поле 4x4 при K=4 в каждой строке ровно одно окно.
  // alive: строка 0 = X X . .  окно живое, пара даёт вклад
  // dead:  строка 0 = X X O .  то же окно мертво, вклад пары исчез
  const alive = board(4, [[0, X], [1, X]]);
  const dead  = board(4, [[0, X], [1, X], [2, O]]);
  assert.ok(rawScore(alive, 4, 4) > rawScore(dead, 4, 4),
            'чужой камень в окне обязан обнулить вклад пары');
});

test('перевес крестиков даёт плюс, перевес ноликов минус', () => {
  assert.ok(rawScore(board(7, [[0, X], [1, X], [2, X]]), 7, 4) > 0);
  assert.ok(rawScore(board(7, [[0, O], [1, O], [2, O]]), 7, 4) < 0);
});

test('WIN больше любой достижимой суммы эвристики', () => {
  // Абсолютный потолок: все 225 клеток заняты одним игроком.
  // Больше эвристика выдать не может физически.
  const cells = createBoard(15);
  for (let i = 0; i < 225; i++) place(cells, i, X);
  assert.ok(Math.abs(rawScore(cells, 15, 5)) < WIN,
            'эвристика не должна перебивать победу');
});

test('WIN больше N*N, иначе WIN - ply уходит в минус', () => {
  assert.ok(WIN > 15 * 15);
});

test('WIN больше суммы эвристики при любом K', () => {
  // С весами 10^(n-1) при больших K эвристика переросла бы WIN, и ИИ предпочёл бы
  // длинную линию победе. Вес по числу недостающих камней этого не допускает.
  const cells = createBoard(15);
  for (let i = 0; i < 225; i++) place(cells, i, X);
  for (let K = 3; K <= 15; K++) {
    assert.ok(Math.abs(rawScore(cells, 15, K)) < WIN, `при K = ${K} эвристика перебивает победу`);
  }
});
