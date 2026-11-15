import { test } from 'node:test'
import assert from 'node:assert/strict'
import { X, O } from '../js/board.js'
import { currentPlayer, undo, redo } from '../js/game.js'
import { fromServer, replayFromServer } from '../js/net.js'

// view(over) собирает ответ сервера о партии 3x3, over заменяет отдельные поля.
// По умолчанию это законченная партия: крестик alex собрал верхнюю строку 0 1 2,
// нолик masha ходил в 3 и 4, спрашивает masha.
function view(over = {}) {
  return {
    id: 'abcdef123456', N: 3, K: 3, invite: false, x: 'alex', o: 'masha', you: O,
    history: [0, 3, 1, 4, 2], outcome: 'win', winner: 'alex', timeLeft: null, ...over,
  }
}

test('fromServer собирает доску, итог и победную линию', () => {
  const g = fromServer(view())
  assert.deepEqual([...g.cells], [X, X, X, O, O, 0, 0, 0, 0])
  assert.deepEqual(g.history, [0, 3, 1, 4, 2])
  assert.equal(g.outcome, 'win')
  assert.deepEqual(g.winLine, [0, 1, 2])
  assert.equal(g.mode, 'online')
  assert.equal(g.humanSide, O)
  assert.deepEqual(g.online, {
    id: 'abcdef123456', invite: false, x: 'alex', o: 'masha', you: O,
    outcome: 'win', winner: 'alex', timeLeft: null,
  })
})

test('fromServer: в идущей партии очередь хода считается по истории', () => {
  const g = fromServer(view({ history: [4], outcome: null, winner: null, you: X }))
  assert.equal(g.outcome, null)
  assert.equal(g.winLine, null)
  assert.equal(currentPlayer(g), O)
  assert.equal(g.humanSide, X)
})

test('fromServer: сдачу видно в outcome, хотя на доске её нет', () => {
  const g = fromServer(view({ history: [4, 0], outcome: 'resign', winner: 'alex' }))
  assert.equal(g.outcome, 'resign')
  assert.deepEqual(g.history, [4, 0])
})

test('fromServer не держит ссылку на массив из ответа', () => {
  const v = view()
  const g = fromServer(v)
  g.history.push(8)
  assert.deepEqual(v.history, [0, 3, 1, 4, 2])
})

test('replayFromServer: пустая доска, все ходы лежат в redo', () => {
  const r = replayFromServer(view())
  assert.equal(r.mode, 'pvp')
  assert.deepEqual(r.replay, { playing: false })
  assert.deepEqual(r.history, [])
  assert.ok(r.cells.every((v) => v === 0))
  assert.equal(r.redo.length, 5)
  assert.equal(r.online.winner, 'alex')
})

test('replayFromServer: redo доигрывает партию до той же позиции, undo снимает один полуход', () => {
  const r = replayFromServer(view())
  let steps = 0
  while (redo(r)) steps++
  assert.equal(steps, 5)
  assert.deepEqual([...r.cells], [...fromServer(view()).cells])
  assert.equal(r.outcome, 'win')
  assert.deepEqual(r.winLine, [0, 1, 2])

  assert.equal(undo(r), 1)
  assert.deepEqual(r.history, [0, 3, 1, 4])
  assert.equal(r.outcome, null)
  assert.deepEqual(r.redo, [2])
})

test('fromServer: проигрыш по времени виден в outcome, остаток времени в online.timeLeft', () => {
  const lost = fromServer(view({ history: [4, 0], outcome: 'timeout', winner: 'alex' }))
  assert.equal(lost.outcome, 'timeout')
  assert.equal(lost.online.timeLeft, null)

  const live = fromServer(view({ history: [4], outcome: null, winner: null, timeLeft: 18000 }))
  assert.equal(live.outcome, null)
  assert.equal(live.online.timeLeft, 18000)
})
