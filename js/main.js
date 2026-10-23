import { rowOf, colOf, opponent } from './board.js'
import { createGame, currentPlayer, isLegal, applyMove, undo, redo, resign } from './game.js'
import { renderBoard, renderStatus, setCursor } from './ui.js'
import { loadSettings, saveSettings, loadGame, saveGame, recordResult } from './storage.js'

// main.js это точка входа. Тут сходятся модель партии из game.js, отрисовка из ui.js,
// сохранение из storage.js и обработчики ввода. В памяти состояние партии живёт только
// здесь, в localStorage лежит его копия.

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
// Напрямую её зовёт только afterChange.
function draw() {
  renderBoard(state, boardElement)
  renderStatus(state, statusElement)
}

// humanResult(state) переводит исход законченной партии в результат со стороны человека:
// 'w' победа, 'd' ничья, 'l' поражение. Нужна только для статистики.
// Сдача всегда поражение, потому что сдаётся только человек, ИИ не сдаётся.
// winner это сторона, сделавшая победный ход: после него currentPlayer уже указывает
// на проигравшего, поэтому победитель это его соперник.
function humanResult(state) {
  if (state.outcome === 'draw') return 'd'
  if (state.outcome === 'resign') return 'l'
  const winner = opponent(currentPlayer(state))
  return winner === state.humanSide ? 'w' : 'l'
}

// afterChange() завершает любое изменение партии: ход, отмену, возврат, сдачу, новую партию.
// Если партия только что закончилась, один раз пишет результат в статистику, потом
// сохраняет партию и перерисовывает экран. Сохраняем после каждого полухода, иначе F5
// между ходом человека и ответом ИИ потеряет ход человека.
// Флаг counted лежит в самой партии и сохраняется вместе с ней. Будь он обычной переменной,
// F5 сбросил бы его, и одну партию можно было бы посчитать дважды. undo его не сбрасывает:
// партия, доигранная заново с середины, та же самая.
// Всё синхронно, поэтому клик не может вклиниться между ходом и перерисовкой.
function afterChange() {
  if (state.outcome !== null && !state.counted) {
    recordResult(state, humanResult(state))
    state.counted = true
  }
  saveGame(state)
  draw()
}

// startGame() создаёт партию по ползункам, запоминает её параметры как настройки,
// сохраняет, показывает и ставит курсор в первую клетку. afterChange сразу затирает
// старую запись в хранилище, иначе после "Новой партии" и F5 вернулась бы прежняя.
// Зовётся по кнопке "Новая партия", при смене N или K и при загрузке страницы,
// если сохранённой партии нет. debug пока всегда false, галочки ещё нет.
function startGame() {
  state = createNewGame()
  saveSettings({
    N: state.N, K: state.K, mode: state.mode, difficulty: state.difficulty,
    humanFirst: state.humanSide === state.first, debug: false,
  })
  afterChange()
  setCursor(boardElement, state.cursor)
}

// play(i) обрабатывает ход в клетку i, это общий вход для мыши и клавиатуры.
// Порядок обязателен и синхронен: проверить легальность, применить ход, сохранить
// и перерисовать (последние два шага делает afterChange), без setTimeout
// и requestAnimationFrame между шагами. Легальность берём из state.cells
// через isLegal, а не из DOM. Иначе клик по клетке, которая в модели уже занята, но на
// экране ещё пустая, поставил бы второй камень поверх чужого.
function play(i) {
  if (!isLegal(state, i)) return
  applyMove(state, i)
  state.cursor = i
  afterChange()
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
// следит за стеком redo, тут только вызов и afterChange.
document.querySelector('.btn-undo').addEventListener('click', () => {
  undo(state)
  afterChange()
})

document.querySelector('.btn-redo').addEventListener('click', () => {
  redo(state)
  afterChange()
})

document.querySelector('.btn-new').addEventListener('click', startGame)

document.querySelector('.btn-resign').addEventListener('click', () => {
  resign(state)
  afterChange()
})

// --- параметры: любое изменение N или K начинает новую партию ---

// refreshOutputs() синхронизирует подписи и границы ползунков. K не может быть больше N,
// поэтому верхняя граница ползунка K следует за N, а слишком большое K подрезается.
// Зовётся на каждый сдвиг ползунка и из showParams.
function refreshOutputs() {
  winInput.max = sizeInput.value
  if (Number(winInput.value) > Number(sizeInput.value)) winInput.value = sizeInput.value
  sizeValue.value = sizeInput.value
  winValue.value = winInput.value
}

// showParams(N, K) ставит ползунки на N и K и обновляет подписи. Зовётся при восстановлении
// партии после F5 и при отказе от новой партии, чтобы вернуть ползунки к текущей.
// Сначала поднимаем winInput.max, потом задаём K: ползунок молча обрезает значение больше
// своего max и не возвращает его, когда max потом растёт. Если задать K раньше, партия
// с K = 6 показала бы на ползунке 3, потому что в index.html стоит max="3".
function showParams(N, K) {
  sizeInput.value = N
  winInput.max = N
  winInput.value = K
  refreshOutputs()
}

sizeInput.addEventListener('input', refreshOutputs)
winInput.addEventListener('input', refreshOutputs)

// applySettings() применяет новые N и K. К идущей партии их применить нельзя, индексы
// в history посчитаны по старому N. Поэтому любое изменение начинает новую партию,
// а если ходы уже сделаны, сначала спрашиваем. При отказе ползунки возвращаются
// к значениям текущей партии.
function applySettings() {
  if (state.history.length > 0 && !confirm('Начать новую партию с новыми настройками?')) {
    showParams(state.N, state.K)
    return
  }
  startGame()
}

// change срабатывает, когда ползунок отпустили, а не на каждый пиксель движения
sizeInput.addEventListener('change', applySettings)
winInput.addEventListener('change', applySettings)

// restoreOrStart() запускается один раз при загрузке страницы. Если в хранилище есть годная
// партия, продолжает её: ползунки ставит на её N и K, курсор на последний ход (cursor
// не сохраняется). afterChange сразу перезаписывает запись уже проверенной, так что мусор,
// обрезанный при проверке, из хранилища пропадает. Законченная партия блокируется сама,
// потому что isLegal не пропускает ходы, пока outcome не null.
// Если партии нет, начинает новую, а ползунки ставит по сохранённым настройкам.
// saved это партия из хранилища или null, settings это настройки или null.
function restoreOrStart() {
  const saved = loadGame()

  if (saved === null) {
    const settings = loadSettings()
    if (settings) showParams(settings.N, settings.K)
    else refreshOutputs()
    startGame()
    return
  }

  state = saved
  state.cursor = state.history.at(-1) ?? 0
  showParams(state.N, state.K)
  afterChange()
  setCursor(boardElement, state.cursor)
}

restoreOrStart()
