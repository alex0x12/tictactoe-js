import { rowOf, colOf } from './board.js'
import { createGame, isLegal, applyMove, undo, redo, resign } from './game.js'
import { renderBoard, renderStatus, setCursor } from './ui.js'

// main.js это точка входа. Тут сходятся модель партии из game.js, отрисовка из ui.js
// и обработчики ввода. Больше состояние партии нигде не хранится.

// Ссылки на элементы страницы ищем один раз при загрузке модуля.
// boardElement это поле, statusElement правая панель, дальше ползунки и их подписи.
const boardElement = document.getElementById('board')
const statusElement = document.getElementById('status')
const sizeInput = document.getElementById('size')
const sizeValue = document.getElementById('size-value')
const winInput = document.getElementById('win')
const winValue = document.getElementById('win-value')

// state это текущая партия, объект GameState из game.js. Единственный источник истины,
// DOM только отражает его и правил не решает.
let state

// createNewGame() собирает новую партию по текущим значениям ползунков.
// N и K читаются из DOM один раз при создании, дальше партия живёт со своими значениями,
// и смена ползунка её уже не касается. Поле cursor добавляется здесь, потому что в
// createGame его нет, а renderBoard его читает.
function createNewGame() {
  const game = createGame({
    N: Number(sizeInput.value),
    K: Number(winInput.value),
    mode: 'pvp',
    difficulty: 'medium',
    humanFirst: true,
    seed: Date.now() >>> 0,
  })
  game.cursor = 0
  return game
}

// draw() перерисовывает всё, что зависит от состояния: поле и панель статуса.
// Отдельная функция, чтобы после каждого изменения не забыть вторую половину.
function draw() {
  renderBoard(state, boardElement)
  renderStatus(state, statusElement)
}

// startGame() создаёт партию, показывает её и ставит курсор в первую клетку.
// Зовётся при загрузке страницы и по кнопке "Новая партия".
function startGame() {
  state = createNewGame()
  draw()
  setCursor(boardElement, state.cursor)
}

// play(i) обрабатывает ход в клетку i, это общий вход для мыши и клавиатуры.
// Порядок обязателен и синхронен: проверить легальность, применить ход и перерисовать,
// без setTimeout и requestAnimationFrame между шагами. Легальность берём из state.cells
// через isLegal, а не из DOM. Иначе клик по клетке, которая в модели уже занята, но на
// экране ещё пустая, поставил бы второй камень поверх чужого.
function play(i) {
  if (!isLegal(state, i)) return
  applyMove(state, i)
  state.cursor = i
  draw()
}

// --- мышь ---

// Один слушатель на всё поле вместо слушателя на каждой клетке: находим ближайшую
// клетку от места клика и берём её индекс из data-index.
boardElement.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell')
  if (cell) play(Number(cell.dataset.index))
})

// --- клавиатура: стрелки и hjkl двигают курсор, Enter и пробел ставят камень ---

// MOVES задаёт смещение курсора [строка, столбец] для каждой клавиши: минус это вверх
// или влево, плюс вниз или вправо. hjkl работает как в vim.
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
  // для букв приводим регистр к нижнему, а Enter и стрелки оставляем как есть
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (key === 'Enter' || key === ' ') {
    event.preventDefault()
    play(state.cursor)
    return
  }

  const delta = MOVES[key]
  if (!delta) return
  event.preventDefault()

  // переводим индекс курсора в строку и столбец, сдвигаем и проверяем границы.
  // если клетка за краем, курсор остаётся на месте
  const row = rowOf(state.cursor, state.N) + delta[0]
  const col = colOf(state.cursor, state.N) + delta[1]
  if (row < 0 || row >= state.N || col < 0 || col >= state.N) return

  state.cursor = row * state.N + col
  setCursor(boardElement, state.cursor)
})

// --- кнопки ---

// Отмена и возврат. game.js сам решает, что снять (в pvp это один полуход), и сам
// следит за стеком redo, тут только вызов и перерисовка.
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

// refreshOutputs() синхронизирует подписи и границы ползунков. K не может быть больше N,
// поэтому верхняя граница ползунка K следует за N, а слишком большое K подрезается.
// Зовётся на каждый сдвиг ползунка и при отказе от новой партии, чтобы вернуть ползунки
// к параметрам текущей.
function refreshOutputs() {
  winInput.max = sizeInput.value
  if (Number(winInput.value) > Number(sizeInput.value)) winInput.value = sizeInput.value
  sizeValue.value = sizeInput.value
  winValue.value = winInput.value
}

sizeInput.addEventListener('input', refreshOutputs)
winInput.addEventListener('input', refreshOutputs)

// applySettings() применяет новые N и K. К идущей партии их применить нельзя, индексы
// в history посчитаны по старому N. Поэтому любое изменение начинает новую партию,
// а если ходы уже сделаны, сначала спрашиваем. При отказе ползунки возвращаются
// к значениям текущей партии.
function applySettings() {
  if (state.history.length > 0 && !confirm('Начать новую партию с новыми настройками?')) {
    sizeInput.value = state.N
    winInput.value = state.K
    refreshOutputs()
    return
  }
  startGame()
}

// change срабатывает, когда ползунок отпустили, а не на каждый пиксель движения
sizeInput.addEventListener('change', applySettings)
winInput.addEventListener('change', applySettings)

// старт: показать подписи и запустить первую партию
refreshOutputs()
startGame()
