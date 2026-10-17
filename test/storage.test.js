import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O } from '../js/board.js';
import { validateAndRebuild, SCHEMA_VERSION } from '../js/storage.js';

function raw(over = {}) {
  return {
    v: SCHEMA_VERSION, N: 3, K: 3, first: X, humanSide: X,
    mode: 'pvp', difficulty: 'medium', seed: 1,
    history: [], redo: [], outcome: null, counted: false, ...over,
  };
}

test('валидная запись восстанавливается', () => {
  const g = validateAndRebuild(raw({ history: [0, 3, 1] }));
  assert.ok(g);
  assert.deepEqual(g.history, [0, 3, 1]);
  assert.equal(g.cells[0], X);
  assert.equal(g.cells[3], O);
});

test('чужая версия схемы отбрасывается целиком', () => {
  assert.equal(validateAndRebuild(raw({ v: 0 })), null);
  assert.equal(validateAndRebuild(raw({ v: undefined })), null);
});

test('N вне диапазона отбрасывается', () => {
  assert.equal(validateAndRebuild(raw({ N: 2 })), null);
  assert.equal(validateAndRebuild(raw({ N: 40 })), null);
  assert.equal(validateAndRebuild(raw({ N: 5.5 })), null);
  assert.equal(validateAndRebuild(raw({ N: 'пять' })), null);
});

test('K вне диапазона отбрасывается', () => {
  assert.equal(validateAndRebuild(raw({ N: 5, K: 2 })), null);
  assert.equal(validateAndRebuild(raw({ N: 5, K: 6 })), null, 'K не может быть больше N');
});

test('ИНДЕКС ЗА ГРАНИЦЕЙ ОБРЕЗАЕТ ИСТОРИЮ, А НЕ ПРОХОДИТ МОЛЧА', () => {
  // Запись за границу Int8Array НЕ бросает исключение, она просто игнорируется.
  // Без явной проверки history стала бы длиннее числа камней на доске,
  // а currentPlayer считается из history.length и показывал бы не того игрока.
  const g = validateAndRebuild(raw({ history: [0, 3, 300, 5] }));
  assert.ok(g);
  assert.deepEqual(g.history, [0, 3], 'история обрезана по первому плохому ходу');
});

test('повторный индекс обрезает историю', () => {
  const g = validateAndRebuild(raw({ history: [0, 3, 0] }));
  assert.deepEqual(g.history, [0, 3]);
});

test('победа в середине истории обрезает хвост', () => {
  // крестик забирает верхний ряд на пятом ходу, ходов после этого быть не может
  const g = validateAndRebuild(raw({ history: [0, 3, 1, 4, 2, 5, 6] }));
  assert.deepEqual(g.history, [0, 3, 1, 4, 2]);
  assert.equal(g.outcome, 'win');
});

test('исход и флаг counted переживают сохранение', () => {
  const g = validateAndRebuild(raw({ history: [0], outcome: 'resign', counted: true }));
  assert.equal(g.outcome, 'resign');
  assert.equal(g.counted, true);
});

test('redo восстанавливается', () => {
  const g = validateAndRebuild(raw({ history: [0], redo: [4, 3] }));
  assert.deepEqual(g.redo, [4, 3]);
});

test('мусор вместо объекта не роняет функцию', () => {
  assert.equal(validateAndRebuild(null), null);
  assert.equal(validateAndRebuild('строка'), null);
  assert.equal(validateAndRebuild(42), null);
  assert.equal(validateAndRebuild({ history: 'не массив' }), null);
});

test('битая шапка отбрасывается целиком', () => {
  assert.equal(validateAndRebuild(raw({ mode: 'chess' })), null);
  assert.equal(validateAndRebuild(raw({ humanSide: 7 })), null);
  assert.equal(validateAndRebuild(raw({ first: O })), null);
});

test('мусор в redo не проходит', () => {
  assert.deepEqual(validateAndRebuild(raw({ history: [0], redo: [300] })).redo, []);
  assert.deepEqual(validateAndRebuild(raw({ history: [0], redo: [0] })).redo, [], 'клетка 0 занята');
  assert.deepEqual(validateAndRebuild(raw({ history: [0], redo: [4, 4] })).redo, [], 'повтор');
  assert.deepEqual(validateAndRebuild(raw({ history: [0, 3, 300], redo: [4] })).redo, [], 'история обрезана');
});
