import { rowOf, colOf } from './board.js'
import { createGame, isLegal, applyMove, undo, redo, resign } from './game.js'
import { renderBoard, renderStatus, setCursor } from './ui.js'

const boardElement = document.getElementById('board')
const statusElement = document.getElementById('status')
const sizeInput = document.getElementById('size')
const sizeValue = document.getElementById('size-value')
const winInput = document.getElementById('win')
const winValue = document.getElementById('win-value')

// Единственный источник истины — объект партии. DOM правила не хранит.
let state

function createNewGame() {
  const game = createGame({
    N: Number(sizeInput.value),
    K: Number(winInput.value),
    mode: 'pvp',
    difficulty: 'medium',
    humanFirst: true,
    seed: Date.now() >>> 0,
  })
  game.cursor = 0            // курсор клавиатуры — часть состояния интерфейса
  return game
}

function draw() {
  renderBoard(state, boardElement)
  renderStatus(state, statusElement)
}

function startGame() {
  state = createNewGame()
  draw()
  setCursor(boardElement, state.cursor)
}

// Ход и перерисовка — в одном синхронном такте, без setTimeout и
// requestAnimationFrame. Легальность проверяется только по state.cells.
function play(i) {
  if (!isLegal(state, i)) return
  applyMove(state, i)
  state.cursor = i
  draw()
}

// --- мышь ---

boardElement.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell')
  if (cell) play(Number(cell.dataset.index))
})

// --- клавиатура: стрелки и hjkl двигают курсор, Enter и пробел ставят камень ---

const MOVES = {
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  h: [0, -1],
  l: [0, 1],
  k: [-1, 0],
  j: [1, 0],
}

boardElement.addEventListener('keydown', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (key === 'Enter' || key === ' ') {
    event.preventDefault()
    play(state.cursor)
    return
  }

  const delta = MOVES[key]
  if (!delta) return
  event.preventDefault()

  const row = rowOf(state.cursor, state.N) + delta[0]
  const col = colOf(state.cursor, state.N) + delta[1]
  if (row < 0 || row >= state.N || col < 0 || col >= state.N) return

  state.cursor = row * state.N + col
  setCursor(boardElement, state.cursor)
})

// --- кнопки ---

document.querySelector('.btn-undo').addEventListener('click', () => {
  undo(state)
  draw()
})

document.querySelector('.btn-redo').addEventListener('click', () => {
  redo(state)
  draw()
})

document.querySelector('.btn-new').addEventListener('click', startGame)

document.querySelector('.btn-resign').addEventListener('click', () => {
  resign(state)
  draw()
})

// --- параметры: любое изменение N или K начинает новую партию ---

// K не может быть больше N, поэтому верхняя граница ползунка K следует за N
function refreshOutputs() {
  winInput.max = sizeInput.value
  if (Number(winInput.value) > Number(sizeInput.value)) winInput.value = sizeInput.value
  sizeValue.value = sizeInput.value
  winValue.value = winInput.value
}

sizeInput.addEventListener('input', refreshOutputs)
winInput.addEventListener('input', refreshOutputs)

function applySettings() {
  // Применять новые N и K к идущей партии нельзя: индексы в history считаются
  // по старому N. Либо пустая история — применяем молча, либо спрашиваем.
  if (state.history.length > 0 && !confirm('Начать новую партию с новыми настройками?')) {
    sizeInput.value = state.N
    winInput.value = state.K
    refreshOutputs()
    return
  }
  startGame()
}

sizeInput.addEventListener('change', applySettings)
winInput.addEventListener('change', applySettings)

refreshOutputs()
startGame()
