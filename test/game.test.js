import test from 'node:test';
import assert from 'node:assert/strict';
import { X, O, EMPTY } from '../js/board.js';
import {
  createGame, currentPlayer, isLegal, applyMove, undo, redo, resign, rebuild,
} from '../js/game.js';

function newGame(over = {}) {
  return createGame({
    N: 3, K: 3, mode: 'pvp', difficulty: 'medium',
    humanFirst: true, seed: 12345, ...over,
  });
}

test('новая партия: пустая доска, ходит ✕', () => {
  const g = newGame();
  assert.equal(g.history.length, 0);
  assert.equal(currentPlayer(g), X);
  assert.equal(g.outcome, null);
  assert.equal(g.counted, false);
  assert.ok([...g.cells].every((v) => v === EMPTY));
});

test('ходы чередуются', () => {
  const g = newGame();
  applyMove(g, 0);
  assert.equal(currentPlayer(g), O);
  applyMove(g, 1);
  assert.equal(currentPlayer(g), X);
  assert.equal(g.cells[0], X);
  assert.equal(g.cells[1], O);
});

test('нельзя ходить в занятую клетку', () => {
  const g = newGame();
  applyMove(g, 4);
  assert.equal(isLegal(g, 4), false);
  assert.throws(() => applyMove(g, 4));
});

test('нельзя ходить за границей поля', () => {
  const g = newGame();
  assert.equal(isLegal(g, -1), false);
  assert.equal(isLegal(g, 9), false);
  assert.equal(isLegal(g, 1.5), false);
});

test('победа фиксируется и выдаёт линию', () => {
  const g = newGame();
  for (const i of [0, 3, 1, 4, 2]) applyMove(g, i); // ✕ забирает верхний ряд
  assert.equal(g.outcome, 'win');
  assert.deepEqual([...g.winLine].sort((a, b) => a - b), [0, 1, 2]);
});

test('после конца партии ходить нельзя', () => {
  const g = newGame();
  for (const i of [0, 3, 1, 4, 2]) applyMove(g, i);
  assert.equal(isLegal(g, 5), false);
});

test('ничья фиксируется при заполнении доски', () => {
  const g = newGame();
  // ✕ ○ ✕ / ✕ ○ ○ / ○ ✕ ✕  — ни одной тройки
  for (const i of [0, 1, 2, 4, 3, 5, 7, 6, 8]) applyMove(g, i);
  assert.equal(g.outcome, 'draw');
});

test('победа проверяется РАНЬШЕ ничьей', () => {
  // Последний, девятый камень заполняет доску И замыкает диагональ 0-4-8.
  // Если сначала проверить «доска полна», партия закончится ничьёй вместо победы.
  //   ✕ ✕ ○        ✕: 0, 4, 1, 3, 8
  //   ✕ ✕ ○        ○: 2, 5, 6, 7
  //   ○ ○ ✕        до девятого хода ни у кого нет линии
  const g = newGame();
  for (const i of [0, 2, 4, 5, 1, 6, 3, 7]) applyMove(g, i);
  assert.equal(g.history.length, 8);
  assert.equal(g.outcome, null, 'после восьми ходов победителя быть не должно');
  applyMove(g, 8);
  assert.equal(g.outcome, 'win', 'последний ход выигрышный, а не ничейный');
});

test('undo в режиме двух игроков снимает один полуход', () => {
  const g = newGame();
  applyMove(g, 0);
  applyMove(g, 1);
  assert.equal(undo(g), 1);
  assert.equal(g.history.length, 1);
  assert.equal(g.cells[1], EMPTY);
  assert.equal(currentPlayer(g), O);
});

test('undo против ИИ снимает пару полуходов', () => {
  const g = newGame({ mode: 'ai', humanFirst: true });
  applyMove(g, 0); // человек ✕
  applyMove(g, 1); // ИИ ○
  assert.equal(undo(g), 2);
  assert.equal(g.history.length, 0);
  assert.equal(currentPlayer(g), X, 'снова ход человека');
});

test('undo против ИИ после победы ЧЕЛОВЕКА снимает один полуход', () => {
  // Выигрышный ход человека последний, ответа ИИ за ним нет.
  // Слепой откат пары снял бы лишний ход ИИ и оставил ход за ИИ.
  const g = newGame({ mode: 'ai', humanFirst: true });
  for (const i of [0, 3, 1, 4, 2]) applyMove(g, i);
  assert.equal(g.outcome, 'win');
  assert.equal(undo(g), 1);
  assert.equal(currentPlayer(g), X, 'ход должен вернуться человеку');
  assert.equal(g.outcome, null, 'партия снова играется');
});

test('undo на пустой истории ничего не делает', () => {
  const g = newGame();
  assert.equal(undo(g), 0);
});

test('redo возвращает снятые ходы в исходном порядке', () => {
  const g = newGame({ mode: 'ai', humanFirst: true });
  applyMove(g, 0);
  applyMove(g, 4);
  undo(g);
  assert.equal(g.history.length, 0);
  redo(g);
  redo(g);
  assert.deepEqual(g.history, [0, 4], 'порядок ходов должен восстановиться');
});

test('НОВЫЙ ХОД ОЧИЩАЕТ СТЕК REDO', () => {
  // Иначе «Вернуть» вставит в историю неактуальный ход,
  // и history станет длиннее числа камней на доске.
  const g = newGame();
  applyMove(g, 0);
  applyMove(g, 1);
  undo(g);
  assert.ok(g.redo.length > 0);
  applyMove(g, 5);
  assert.equal(g.redo.length, 0);
  assert.equal(redo(g), false);
});

test('resign помечает партию сданной', () => {
  const g = newGame({ mode: 'ai' });
  applyMove(g, 0);
  resign(g);
  assert.equal(g.outcome, 'resign');
  assert.equal(isLegal(g, 1), false);
});

test('rebuild восстанавливает доску и исход из одной истории', () => {
  const g = newGame();
  for (const i of [0, 3, 1, 4, 2]) applyMove(g, i);
  const saved = [...g.history];
  const g2 = newGame();
  g2.history = saved;
  rebuild(g2);
  assert.deepEqual([...g2.cells], [...g.cells]);
  assert.equal(g2.outcome, 'win');
});
