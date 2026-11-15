import { rowOf, colOf, opponent } from './board.js'
import { createGame, currentPlayer, isLegal, applyMove, undo, redo, resign } from './game.js'
import {
  renderBoard, renderStatus, renderScore, renderAccount, renderProfile, renderReplay,
  renderLeaderboard, setCursor,
} from './ui.js'
import {
  loadSettings, saveSettings, loadGame, saveGame, clearGame, loadStats, statsKey, recordResult,
  loadAccount, saveAccount, clearAccount, loadOnlineId, saveOnlineId, clearOnlineId,
} from './storage.js'
import { chooseMove } from './ai.js'
import {
  register, login, logout, getLeaderboard, getProfile, newGame, joinGame, getGame, sendMove,
  sendResign, fromServer, replayFromServer,
} from './net.js'

// main.js это точка входа. Тут сходятся модель партии из game.js, отрисовка из ui.js,
// сохранение из storage.js, ход ИИ из ai.js, разговор с сервером из net.js и обработчики
// ввода. В памяти состояние партии живёт только здесь, в localStorage лежит его копия.

// Ссылки на элементы страницы ищем один раз при загрузке модуля.
// boardElement это поле, statusElement правая панель, дальше ползунки и их подписи.
// aiOptions это группы "Сложность" и "Кто ходит первым", они нужны только против ИИ.
// onlineElement это блок "Игра по сети" на левой панели, loginForm форма входа внутри него.
// replayElement это полоса повтора под полем, myGamesElement список "Мои партии".
const boardElement = document.getElementById('board')
const statusElement = document.getElementById('status')
const sizeInput = document.getElementById('size')
const sizeValue = document.getElementById('size-value')
const winInput = document.getElementById('win')
const winValue = document.getElementById('win-value')
const aiOptions = document.querySelectorAll('.ai-only')
const onlineElement = document.querySelector('.online-only')
const loginForm = document.querySelector('.login-form')
const replayElement = document.querySelector('.replay')
const myGamesElement = document.querySelector('.my-games')

// state это текущая партия, объект GameState из game.js. Единственный источник истины,
// DOM только отражает его и правил не решает.
let state

// Переменные игры по сети. pollTimer это id setInterval опроса или null. pollBusy равен
// true, пока запрос опроса ещё не вернулся: при медленной сети запросы иначе накладывались
// бы друг на друга. sending равен true, пока свой ход летит на сервер. pendingJoin это id
// из ?game=, если по ссылке пришёл ещё не вошедший игрок: принять приглашение он сможет
// после входа. replayTimer это id setInterval проигрывания повтора или null.
let pollTimer = null
let pollBusy = false
let sending = false
let pendingJoin = null
let replayTimer = null

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

// draw() перерисовывает всё, что зависит от состояния: поле, панель статуса, счёт, блок
// входа и полосу повтора. Её зовёт afterChange, а в разделе про сеть ещё и обработчики, которые меняют только
// вид страницы: вход и выход. Счёт читается из хранилища при каждой перерисовке, это дёшево,
// а результат только что законченной партии уже записан. Учётная запись читается так же:
// account это { token, nickname } или null, если игрок не вошёл.
function draw() {
  const account = loadAccount()
  renderBoard(state, boardElement)
  renderStatus(state, statusElement, account)
  renderScore(state, loadStats().items[statsKey(state)], statusElement)
  renderAccount(account, state, onlineElement)
  renderReplay(state, replayElement)
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
// Партия по сети и повтор в ttt.game не пишутся никогда: такая партия живёт на сервере,
// а повтор это просмотр. У живой партии по сети запоминается только её номер, чтобы
// после F5 вернуться в неё. В статистику против ИИ они тоже не попадают.
function afterChange() {
  if (state.mode === 'online' || state.replay) {
    if (state.online && !state.replay) saveOnlineId(state.online.id)
    draw()
    return
  }

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
// Новая партия останавливает опрос и повтор и забывает партию по сети: номер из ttt.online
// стирается. В режиме "По сети" создаётся пустое поле, без state.online, партия появится
// после кнопки слева. Локальная партия при переходе в этот режим удаляется, иначе после F5
// она вернулась бы поверх.
function startGame() {
  stopPolling()
  stopReplay()
  clearOnlineId()
  state = createNewGame()
  saveSettings({ ...settingsOf(state), debug: false })
  if (state.mode === 'online') clearGame()
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
// В режиме "По сети" ход идёт через сервер, его делает playOnline. Во время повтора
// клики по полю ничего не делают.
function play(i) {
  if (state.replay) return
  if (state.mode === 'online') {
    playOnline(i)
    return
  }
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

// По сети сдача идёт через сервер: resignOnline отправляет её и ждёт ответа.
document.querySelector('.btn-resign').addEventListener('click', () => {
  if (state.mode === 'online') {
    resignOnline()
    return
  }
  resign(state)
  afterChange()
})

// --- параметры: любое изменение начинает новую партию ---

// refreshOutputs() синхронизирует подписи и границы ползунков и доступность настроек ИИ.
// K не может быть больше N, поэтому верхняя граница ползунка K следует за N, а слишком
// большое K подрезается. Группы "Сложность" и "Кто ходит первым" выключаются в режимах
// "два игрока" и "по сети", а блок "Игра по сети" виден только в последнем.
// Зовётся на каждый сдвиг ползунка, при смене радиокнопки и из showSettings.
function refreshOutputs() {
  winInput.max = sizeInput.value
  if (Number(winInput.value) > Number(sizeInput.value)) winInput.value = sizeInput.value
  sizeValue.value = sizeInput.value
  winValue.value = winInput.value
  for (const group of aiOptions) group.disabled = checkedValue('mode') !== 'ai'
  onlineElement.hidden = checkedValue('mode') !== 'online'
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
// Повтор закрывается без вопроса: терять в нём нечего.
function applySettings() {
  if (state.history.length > 0 && !state.replay && !confirm('Начать новую партию с новыми настройками?')) {
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
// Порядок проверок такой: ссылка-приглашение, потом локальная партия, потом партия по сети
// из ttt.online (только если сохранённый режим "По сети"), потом новая партия. Пункты 2 и 3
// не конфликтуют: при переходе в режим "По сети" ttt.game удаляется.
// saved это партия из хранилища или null, settings это настройки или null,
// invited это id из ?game= или null, onlineId это id партии по сети или null.
function restoreOrStart() {
  // 1. пришли по ссылке-приглашению. Переход по ней уже говорит, чего хочет игрок,
  // поэтому режим "По сети" включается без вопроса. Локальная партия при этом удаляется,
  // как при любом переходе в этот режим. ?game убираем из адреса, чтобы F5 не заходил
  // по ссылке снова. window.history написано полностью, чтобы не путать с state.history
  const invited = new URLSearchParams(location.search).get('game')
  if (invited !== null) {
    window.history.replaceState(null, '', location.pathname)
    showSettings({ ...(loadSettings() ?? readSettings()), mode: 'online' })
    startGame()
    if (loadAccount()) joinById(invited)
    else {
      pendingJoin = invited
      showError('Войдите, чтобы принять приглашение')
    }
    return
  }

  const saved = loadGame()

  if (saved === null) {
    const settings = loadSettings()
    // startGame забудет ttt.online, поэтому номер партии читаем заранее
    const onlineId = loadOnlineId()
    if (settings) showSettings(settings)
    else refreshOutputs()
    startGame()
    // 3. режим "По сети" и сохранённая партия на сервере
    if (settings?.mode === 'online' && onlineId && loadAccount()) openSaved(onlineId)
    return
  }

  // 2. дальше как было: локальная партия из ttt.game

  state = saved
  state.cursor = state.history.at(-1) ?? 0
  showSettings(settingsOf(state))
  afterChange()
  setCursor(boardElement, state.cursor)
  requestAiMove()
}

// --- игра по сети ---

// showError(text) пишет текст в красную строку блока "Игра по сети". Пустая строка
// её очищает. Все ошибки сервера показываются тут как есть: net.js уже собрал для них
// текст, понятный игроку.
function showError(text) {
  onlineElement.querySelector('.online-error').textContent = text
}

// handleError(error) разбирает ошибку запроса к серверу. 401 на запрос с токеном значит,
// что токен больше не годится, например базу удалили: забываем его и просим войти заново.
// Если на экране была партия по сети, она уже недоступна, поэтому начинаем с пустого поля.
// Локальную партию при этом не трогаем. Список "Мои партии" и статистика пропадают вместе
// с учётной записью. Остальные ошибки просто показываем.
function handleError(error) {
  if (error.status === 401) {
    clearAccount()
    renderProfile(null, onlineElement)
    if (state.mode === 'online') startGame()
    else draw()
    showError('Войдите заново')
    return
  }
  showError(error.message)
}

// refreshLists() перезагружает рейтинг, а у вошедшего игрока ещё и профиль: статистику
// и список "Мои партии". Зовётся при загрузке страницы, после входа, когда в партии по сети
// появился соперник и когда она закончилась. Если сервер не ответил, вместо таблицы пишется
// "Рейтинг недоступен", игре это не мешает. Рейтинг и профиль грузятся отдельно, чтобы
// сбой одного не убирал второй.
async function refreshLists() {
  try {
    renderLeaderboard(await getLeaderboard(), statusElement)
  } catch {
    renderLeaderboard(null, statusElement)
  }

  if (!loadAccount()) {
    renderProfile(null, onlineElement)
    return
  }
  try {
    renderProfile(await getProfile(), onlineElement)
  } catch (error) {
    handleError(error)
  }
}

// startPolling() запускает опрос: раз в секунду pollTick спрашивает сервер о партии.
// Сначала stopPolling, чтобы два таймера не работали сразу. stopPolling() останавливает опрос.
function startPolling() {
  stopPolling()
  pollTimer = setInterval(pollTick, 1000)
}

function stopPolling() {
  clearInterval(pollTimer)
  pollTimer = null
}

// showOnlineGame(view) показывает партию с сервера и запускает опрос, пока она идёт.
// view это ответ сервера. Панель встаёт на N и K партии, а не на то, что стояло на
// ползунках: друг мог позвать на 15x15, а ползунки показывали 3x3. Режим "По сети"
// запоминается в настройках, локальная партия удаляется, как при любом входе в этот режим.
// Если до этого шёл повтор, он останавливается. settings это новые настройки панели.
function showOnlineGame(view) {
  stopReplay()
  const settings = { ...readSettings(), N: view.N, K: view.K, mode: 'online' }
  showSettings(settings)
  saveSettings({ ...settings, debug: false })
  clearGame()

  state = fromServer(view)
  state.cursor = state.history.at(-1) ?? 0
  afterChange()
  setCursor(boardElement, state.cursor)
  if (state.outcome === null) startPolling()
  else stopPolling()
}

// applyView(view) заменяет показанную партию свежим ответом сервера целиком. Вызывать
// можно, только когда на экране та же партия (state.online.id === view.id) и это не повтор:
// это проверяют вызывающие. Курсор клавиатуры сохраняется, он относится к экрану.
// Новый ответ приходит без online.offline, поэтому "Нет связи с сервером" пропадает сам.
// before это то, что было на экране до замены. Если соперник пришёл или партия закончилась,
// обновились рейтинг и список партий, поэтому их перезагружаем.
function applyView(view) {
  const before = state.online
  const cursor = state.cursor
  state = fromServer(view)
  state.cursor = cursor
  afterChange()
  if (state.outcome !== null) stopPolling()

  const joined = before.o === null && view.o !== null
  const finished = before.outcome === null && view.outcome !== null
  if (joined || finished) refreshLists()
}

// pollTick() это один такт опроса. Он идёт и в свою очередь игрока: соперник может сдаться,
// пока игрок думает. Ничего не делает, пока свой ход летит на сервер (sending) или прошлый
// запрос опроса ещё не вернулся (pollBusy). После await обязательно проверяем, что на экране
// всё ещё та же партия: пока ждали ответ, игрок мог открыть другую партию, повтор или сменить
// режим, и тогда ответ выбрасывается. Так же устроен ход ИИ: makeAiMove перед поиском
// проверяет, что ход всё ещё за ИИ.
// История на сервере только растёт. Если в ответе ходов меньше, чем на экране, он ушёл
// с сервера раньше, чем туда дошёл только что сделанный ход, и стёр бы этот ход с экрана.
// Ошибка сети показывает "Нет связи с сервером", опрос продолжается: как только сервер
// ответит, online.offline сбросится заменой партии. 401 разбирает handleError.
// online это партия на экране в момент начала такта, changed говорит, чем ответ отличается.
async function pollTick() {
  const online = state.online
  if (!online || state.replay || state.outcome !== null || sending || pollBusy) return

  pollBusy = true
  try {
    const view = await getGame(online.id)
    if (state.online?.id !== online.id || state.replay || sending) return
    if (view.history.length < state.history.length) return
    const changed = view.o !== online.o
      || view.history.length !== state.history.length
      || view.outcome !== state.outcome
    if (changed || online.offline) applyView(view)
  } catch (error) {
    if (error.status === 401) handleError(error)
    else if (state.online?.id === online.id) {
      state.online.offline = true
      draw()
    }
  } finally {
    pollBusy = false
  }
}

// playOnline(i) делает ход в клетку i в партии по сети. Сначала проверки: партия идёт,
// соперник пришёл, сейчас очередь игрока, ход разрешён, предыдущий ход уже не летит.
// Иначе ничего не делаем. Потом камень ставится у себя сразу и экран перерисовывается:
// он появляется без ожидания сервера, а повторный клик уже не пройдёт, потому что очередь
// сменилась. Дальше ход уходит на сервер, и ответ заменяет партию целиком. Если сервер
// отказал, показываем текст ошибки и заново берём партию с сервера, чтобы убрать свой камень.
// sending равен true, пока ход летит. online это партия на экране в момент хода.
async function playOnline(i) {
  const online = state.online
  if (!online || online.o === null || sending) return
  if (currentPlayer(state) !== online.you || !isLegal(state, i)) return

  applyMove(state, i)
  state.cursor = i
  draw()

  sending = true
  try {
    const view = await sendMove(online.id, i)
    if (state.online?.id === online.id && !state.replay) applyView(view)
  } catch (error) {
    handleError(error)
    if (error.status !== 401) reloadGame(online.id)
  } finally {
    sending = false
  }
}

// reloadGame(id) заново берёт партию id с сервера и показывает её. Нужна, когда сервер
// отказал в ходе: на экране остался камень, которого на сервере нет.
async function reloadGame(id) {
  try {
    const view = await getGame(id)
    if (state.online?.id === id && !state.replay) applyView(view)
  } catch (error) {
    handleError(error)
  }
}

// resignOnline() сдаёт партию по сети. В отличие от хода, на экране ничего не меняется
// до ответа сервера: сдачу на доске не видно, итог придёт вместе с ответом.
async function resignOnline() {
  const id = state.online?.id
  if (!id) return
  try {
    const view = await sendResign(id)
    if (state.online?.id === id && !state.replay) applyView(view)
  } catch (error) {
    handleError(error)
  }
}

// startOnline(invite) начинает партию по сети с N и K с ползунков. invite равен false для
// случайного соперника и true для приглашения. Зовётся кнопками "Случайный соперник"
// и "Пригласить друга". Если соперник нашёлся сразу, он уже в партии: рейтинг и список
// партий тоже обновляем.
async function startOnline(invite) {
  const { N, K } = readSettings()
  try {
    const view = await newGame(N, K, invite)
    showError('')
    showOnlineGame(view)
    if (view.o !== null) refreshLists()
  } catch (error) {
    handleError(error)
  }
}

document.querySelector('.btn-random').addEventListener('click', () => startOnline(false))
document.querySelector('.btn-invite').addEventListener('click', () => startOnline(true))

// joinById(id) входит в партию по пригласительной ссылке. Сначала pendingJoin сбрасывается,
// чтобы после входа не принимать то же приглашение второй раз.
async function joinById(id) {
  pendingJoin = null
  try {
    const view = await joinGame(id)
    showError('')
    showOnlineGame(view)
    refreshLists()
  } catch (error) {
    handleError(error)
  }
}

// openSaved(id) продолжает партию по сети после F5. Если сервер партию не отдал, например
// её уже нет (404) или она чужая (403), остаёмся на пустом поле: startGame номер уже забыл.
// Если за время ожидания на экране что-то другое, ответ выбрасывается. 401 разбирает
// handleError.
async function openSaved(id) {
  try {
    const view = await getGame(id)
    if (state.mode === 'online' && !state.online) showOnlineGame(view)
  } catch (error) {
    if (error.status === 401) handleError(error)
  }
}

// Поле со ссылкой выделяет весь текст по клику, так её проще скопировать
document.querySelector('.invite-link').addEventListener('focus', (event) => event.target.select())

// Форма входа. Обе кнопки отправляют форму, event.submitter говорит, какая из них нажата:
// "Регистрация" или "Войти". Enter в поле нажимает первую, то есть "Войти".
// send это функция из net.js, которую выбрала кнопка. Токен и никнейм из ответа
// запоминаются в хранилище, после этого draw показывает "Вы: ...". Если игрок пришёл
// по ссылке-приглашению и войти не успел, id партии ждёт в pendingJoin: после входа
// принимаем приглашение сразу.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const nickname = loginForm.elements.nickname.value.trim()
  const password = loginForm.elements.password.value
  const send = event.submitter?.value === 'register' ? register : login

  try {
    saveAccount(await send(nickname, password))
  } catch (error) {
    showError(error.message)
    return
  }

  loginForm.reset()
  showError('')
  draw()
  refreshLists()
  if (pendingJoin) joinById(pendingJoin)
})

// Выход. Если сервер не ответил, из учётной записи выходим всё равно: токен забывает
// браузер, а на сервере он останется лежать, но без него им уже никто не воспользуется.
// Потом начинается пустое поле, партия по сети на экране больше не нужна.
document.querySelector('.btn-logout').addEventListener('click', async () => {
  try {
    await logout()
  } catch {
    // сервер мог не ответить, из учётной записи выходим всё равно
  }
  clearAccount()
  showError('')
  startGame()
  refreshLists()
})

// --- повтор ---

// openReplay(view) открывает повтор законченной партии, view это ответ сервера о ней.
// Опрос и прежний повтор останавливаются, номер партии по сети забывается: повтор после
// F5 не возвращается. Панель ставится на N и K партии и режим 'online'. settingsOf(state)
// тут не годится: у повтора режим 'pvp', и панель переключилась бы на "Два игрока".
// Повтор никогда не пишется в ttt.game и не проходит через afterChange с записью:
// здесь и в обработчиках ниже зовётся draw напрямую, а afterChange для повтора только рисует.
// settings это новые настройки панели.
function openReplay(view) {
  stopPolling()
  stopReplay()
  clearOnlineId()
  const settings = { ...readSettings(), N: view.N, K: view.K, mode: 'online' }
  showSettings(settings)
  saveSettings({ ...settings, debug: false })
  clearGame()

  state = replayFromServer(view)
  state.cursor = 0
  draw()
}

// stopReplay() останавливает проигрывание повтора и сбрасывает флаг replay.playing,
// по которому кнопка называется "Пуск" или "Пауза". state?. нужен потому, что startGame
// зовёт stopReplay ещё до первой партии, когда state пуст.
function stopReplay() {
  clearInterval(replayTimer)
  replayTimer = null
  if (state?.replay) state.replay.playing = false
}

// stepReplay(forward) делает один шаг повтора: вперёд это redo, назад это undo. Шаг вручную
// ставит проигрывание на паузу. Дальше перерисовываем экран, поле и счётчик берутся из state.
function stepReplay(forward) {
  stopReplay()
  if (forward) redo(state)
  else undo(state)
  draw()
}

// togglePlay() запускает проигрывание или ставит его на паузу. Проигрывание это redo
// раз в секунду, когда ходы кончились, оно останавливается само. Если нажать "Пуск"
// на последнем ходе, повтор сначала отматывается в начало: undo в режиме 'pvp' снимает
// по одному полуходу, пока история не опустеет.
function togglePlay() {
  if (state.replay.playing) {
    stopReplay()
    draw()
    return
  }

  if (state.redo.length === 0) {
    while (undo(state) > 0) {
      // снимаем по полуходу, пока история не опустеет
    }
  }

  state.replay.playing = true
  replayTimer = setInterval(() => {
    redo(state)
    if (state.redo.length === 0) stopReplay()
    draw()
  }, 1000)
  draw()
}

replayElement.querySelector('.btn-back').addEventListener('click', () => stepReplay(false))
replayElement.querySelector('.btn-forward').addEventListener('click', () => stepReplay(true))
replayElement.querySelector('.btn-play').addEventListener('click', togglePlay)
replayElement.querySelector('.btn-close').addEventListener('click', startGame)

// Клик по строке списка "Мои партии": один слушатель на весь список, нужную строку находим
// от места клика, как и на поле. Партию заново читаем с сервера, в списке есть только
// краткие данные. Идущая партия открывается как живая, с опросом: так можно вернуться
// в неё после выхода из учётной записи или после смены ползунков. Законченная открывается
// повтором. item это найденная строка.
myGamesElement.addEventListener('click', async (event) => {
  const item = event.target.closest('.game-item')
  if (!item) return
  try {
    const view = await getGame(item.dataset.id)
    showError('')
    if (view.outcome === null) showOnlineGame(view)
    else openReplay(view)
  } catch (error) {
    handleError(error)
  }
})

// --- запуск ---

restoreOrStart()
refreshLists()
