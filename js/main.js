import { rowOf, colOf, opponent } from './board.js'
import { createGame, currentPlayer, isLegal, applyMove, undo, redo, resign } from './game.js'
import { renderBoard, renderStatus, renderScore, setCursor } from './ui.js'
import {
  loadSettings, saveSettings, loadGame, saveGame, loadStats, statsKey, recordResult,
} from './storage.js'
import { chooseMove } from './ai.js'

// main.js это точка входа. Тут сходятся модель партии из game.js, отрисовка из ui.js,
// сохранение из storage.js, ход ИИ из ai.js и обработчики ввода. В памяти состояние
// партии живёт только здесь, в localStorage лежит его копия.

// Ссылки на элементы страницы ищем один раз при загрузке модуля.
// boardElement это поле, statusElement правая панель, дальше ползунки и их подписи.
// aiOptions это группы "Сложность" и "Кто ходит первым", они нужны только против ИИ.
const boardElement = document.getElementById('board')
const statusElement = document.getElementById('status')
const sizeInput = document.getElementById('size')
const sizeValue = document.getElementById('size-value')
const winInput = document.getElementById('win')
const winValue = document.getElementById('win-value')
const aiOptions = document.querySelectorAll('.ai-only')

// state это текущая партия, объект GameState из game.js. Единственный источник истины,
// DOM только отражает его и правил не решает.
let state

// checkedValue(name) возвращает value выбранной радиокнопки из группы name.
function checkedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value
}

// setChecked(name, value) выбирает в группе name радиокнопку со значением value.
function setChecked(name, value) {
  document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true
}

// readSettings() читает с левой панели все параметры новой партии.
function readSettings() {
  return {
    N: Number(sizeInput.value),
    K: Number(winInput.value),
    mode: checkedValue('mode'),
    difficulty: checkedValue('difficulty'),
    humanFirst: checkedValue('first') === 'human',
  }
}

// settingsOf(game) достаёт те же параметры из партии. Нужна, чтобы вернуть к ним панель
// после F5 или после отказа от новой партии, и чтобы сохранить их как настройки.
function settingsOf(game) {
  return {
    N: game.N,
    K: game.K,
    mode: game.mode,
    difficulty: game.difficulty,
    humanFirst: game.humanSide === game.first,
  }
}

// createNewGame() собирает новую партию по текущим значениям на панели.
// Параметры читаются из DOM один раз при создании, дальше партия живёт со своими, и смена
// ползунка или радиокнопки её уже не касается. Поле cursor добавляется здесь, потому что
// в createGame его нет, а renderBoard его читает.
function createNewGame() {
  const game = createGame({ ...readSettings(), seed: Date.now() >>> 0 })
  game.cursor = 0
  return game
}

// draw() перерисовывает всё, что зависит от состояния: поле, панель статуса и счёт.
// Напрямую её зовёт только afterChange. Счёт читается из хранилища при каждой
// перерисовке, это дёшево, а результат только что законченной партии уже записан.
function draw() {
  renderBoard(state, boardElement)
  renderStatus(state, statusElement)
  renderScore(state, loadStats().items[statsKey(state)], statusElement)
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
// Зовётся по кнопке "Новая партия", при смене параметров и при загрузке страницы,
// если сохранённой партии нет. Если первым ходит ИИ, в конце запрашиваем его ход.
// debug всегда false: отладочной панели в упрощённой версии нет.
function startGame() {
  state = createNewGame()
  saveSettings({ ...settingsOf(state), debug: false })
  afterChange()
  setCursor(boardElement, state.cursor)
  requestAiMove()
}

// isAiTurn() говорит, должен ли сейчас ходить ИИ: партия против ИИ, она не закончена,
// и очередь не человека.
function isAiTurn() {
  return state.mode === 'ai' && state.outcome === null && currentPlayer(state) !== state.humanSide
}

// requestAiMove() откладывает ход ИИ до следующей перерисовки. Поиск занимает до секунды,
// и всё это время страница стоит. Если считать сразу, браузер не успеет нарисовать ход
// человека, и оба камня появятся разом. requestAnimationFrame зовёт функцию прямо перед
// отрисовкой, а setTimeout внутри него переносит счёт на момент после неё.
function requestAiMove() {
  if (isAiTurn()) requestAnimationFrame(() => setTimeout(makeAiMove))
}

// makeAiMove() считает и делает ход ИИ. Сначала ещё раз проверяет, что ход за ИИ: пока
// ждали отрисовку, могли нажать отмену или начать новую партию. Ход применяется
// и рисуется в одном такте, как и ход человека.
// result это ответ поиска, его итог пишем в консоль: видно глубину, число узлов и время.
function makeAiMove() {
  if (!isAiTurn()) return
  const result = chooseMove(state.cells, state.N, state.K, currentPlayer(state), state.difficulty)
  console.log('ИИ: ход', result.move, 'глубина', result.depth, 'узлов', result.nodes, result.ms, 'мс')
  applyMove(state, result.move)
  afterChange()
}

// play(i) обрабатывает ход в клетку i, это общий вход для мыши и клавиатуры.
// Порядок обязателен и синхронен: проверить легальность, применить ход, сохранить
// и перерисовать (последние два шага делает afterChange), без setTimeout
// и requestAnimationFrame между шагами. Легальность берём из state.cells
// через isLegal, а не из DOM. Иначе клик по клетке, которая в модели уже занята, но на
// экране ещё пустая, поставил бы второй камень поверх чужого.
// Пока ходит ИИ, клики игнорируются. После хода человека запрашиваем ответ ИИ.
function play(i) {
  if (isAiTurn() || !isLegal(state, i)) return
  applyMove(state, i)
  state.cursor = i
  afterChange()
  requestAiMove()
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

// Отмена и возврат. game.js сам решает, что снять (в pvp один полуход, против ИИ обычно
// пару), и сам следит за стеком redo. После отмены ход может оказаться за ИИ, например
// если он ходил первым и отменили всё, поэтому запрашиваем его ход.
document.querySelector('.btn-undo').addEventListener('click', () => {
  undo(state)
  afterChange()
  requestAiMove()
})

// Против ИИ отмена снимает пару ходов, поэтому возврат тоже возвращает пару: свой ход
// и сохранённый ответ ИИ. Если ответа в стеке нет, ИИ посчитает его заново.
document.querySelector('.btn-redo').addEventListener('click', () => {
  redo(state)
  if (isAiTurn() && state.redo.length > 0) redo(state)
  afterChange()
  requestAiMove()
})

document.querySelector('.btn-new').addEventListener('click', startGame)

document.querySelector('.btn-resign').addEventListener('click', () => {
  resign(state)
  afterChange()
})

// --- параметры: любое изменение начинает новую партию ---

// refreshOutputs() синхронизирует подписи и границы ползунков и доступность настроек ИИ.
// K не может быть больше N, поэтому верхняя граница ползунка K следует за N, а слишком
// большое K подрезается. Группы "Сложность" и "Кто ходит первым" выключаются в режиме
// "два игрока". Зовётся на каждый сдвиг ползунка, при смене радиокнопки и из showSettings.
function refreshOutputs() {
  winInput.max = sizeInput.value
  if (Number(winInput.value) > Number(sizeInput.value)) winInput.value = sizeInput.value
  sizeValue.value = sizeInput.value
  winValue.value = winInput.value
  for (const group of aiOptions) group.disabled = checkedValue('mode') !== 'ai'
}

// showSettings(s) ставит панель на параметры s: ползунки, режим, сложность, кто первый.
// Зовётся при восстановлении партии после F5 и при отказе от новой партии.
// Сначала поднимаем winInput.max, потом задаём K: ползунок молча обрезает значение больше
// своего max и не возвращает его, когда max потом растёт. Если задать K раньше, партия
// с K = 6 показала бы на ползунке 3, потому что в index.html стоит max="3".
function showSettings(s) {
  sizeInput.value = s.N
  winInput.max = s.N
  winInput.value = s.K
  setChecked('mode', s.mode)
  setChecked('difficulty', s.difficulty)
  setChecked('first', s.humanFirst ? 'human' : 'ai')
  refreshOutputs()
}

sizeInput.addEventListener('input', refreshOutputs)
winInput.addEventListener('input', refreshOutputs)

// applySettings() применяет новые параметры. К идущей партии их применить нельзя: индексы
// в history посчитаны по старому N, а режим и сложность фиксируются на старте партии.
// Поэтому любое изменение начинает новую партию, а если ходы уже сделаны, сначала
// спрашиваем. При отказе панель возвращается к параметрам текущей партии.
function applySettings() {
  if (state.history.length > 0 && !confirm('Начать новую партию с новыми настройками?')) {
    showSettings(settingsOf(state))
    return
  }
  startGame()
}

// change срабатывает, когда ползунок отпустили, а не на каждый пиксель движения
sizeInput.addEventListener('change', applySettings)
winInput.addEventListener('change', applySettings)

// у радиокнопки change срабатывает при выборе. refreshOutputs сразу включает или
// выключает настройки ИИ, ещё до вопроса о новой партии
for (const radio of document.querySelectorAll('.params input[type="radio"]')) {
  radio.addEventListener('change', () => {
    refreshOutputs()
    applySettings()
  })
}

// restoreOrStart() запускается один раз при загрузке страницы. Если в хранилище есть годная
// партия, продолжает её: панель ставит на её параметры, курсор на последний ход (cursor
// не сохраняется). afterChange сразу перезаписывает запись уже проверенной, так что мусор,
// обрезанный при проверке, из хранилища пропадает. Законченная партия блокируется сама,
// потому что isLegal не пропускает ходы, пока outcome не null.
// Если перезагрузили страницу, пока ИИ считал, ход за ним: запрашиваем его ход заново.
// Если партии нет, начинает новую, а панель ставит по сохранённым настройкам.
// saved это партия из хранилища или null, settings это настройки или null.
function restoreOrStart() {
  const saved = loadGame()

  if (saved === null) {
    const settings = loadSettings()
    if (settings) showSettings(settings)
    else refreshOutputs()
    startGame()
    return
  }

  state = saved
  state.cursor = state.history.at(-1) ?? 0
  showSettings(settingsOf(state))
  afterChange()
  setCursor(boardElement, state.cursor)
  requestAiMove()
}

restoreOrStart()
