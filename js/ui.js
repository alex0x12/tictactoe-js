import { EMPTY, X, O, rowOf, colOf } from './board.js'
import { currentPlayer } from './game.js'

// GLYPH говорит, каким символом рисовать значение клетки: 1 это крестик, 2 это нолик.
// COLUMNS это буквы столбцов для подписей вида "C3". Больше пятнадцати столбцов не бывает,
// потому что N ограничено пятнадцатью.
const GLYPH = { [X]: '✕', [O]: '○' }
const COLUMNS = 'ABCDEFGHIJKLMNO'

// LEVEL_NAMES это названия уровней сложности для строки счёта
const LEVEL_NAMES = { easy: 'лёгкий', medium: 'средний', hard: 'сложный' }

// coord(i, N) превращает индекс клетки в координату вида "C3". Нужна только для aria-label,
// чтобы скринридер читал позицию, а не "клетка 7". Строку и столбец берём из board.js,
// чтобы не повторять арифметику индексов.
function coord(i, N) {
  return COLUMNS[colOf(i, N)] + (rowOf(i, N) + 1)
}

// cellLabel(state, i) собирает aria-label для одной клетки, например "C3, пусто".
// value это значение из state.cells. Клетки и есть единственный источник истины,
// DOM тут только читается и правил не решает.
function cellLabel(state, i) {
  const value = state.cells[i]
  const what = value === EMPTY ? 'пусто' : value === X ? 'крестик' : 'нолик'
  return `${coord(i, state.N)}, ${what}`
}

// renderBoard(state, root) приводит содержимое поля в соответствие с состоянием партии.
// Зовётся после каждого хода и при смене размера, ничего не возвращает.
// cells это фрагмент с новыми клетками, он создаётся только когда число клеток в DOM
// разошлось с N * N, то есть при смене размера. В остальных случаях клетки переиспользуются,
// иначе после каждой перерисовки слетал бы фокус.
// win это индексы победной цепочки, у идущей партии он пустой.
// cursor это индекс клетки под курсором, ровно она получает tabindex="0".
// last это индекс последнего хода, его клетка подсвечивается, чтобы было видно ход ИИ.
function renderBoard(state, root) {
  // N живёт в CSS-переменной, от неё зависит grid-template-columns в style.css
  root.style.setProperty('--n', state.N)
  root.setAttribute('aria-label', `Игровое поле ${state.N} на ${state.N}`)

  if (root.children.length !== state.cells.length) {
    const cells = document.createDocumentFragment()
    for (let i = 0; i < state.cells.length; i++) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.setAttribute('role', 'gridcell')
      cell.dataset.index = i
      cells.append(cell)
    }
    root.replaceChildren(cells)
  }

  const win = state.winLine ?? []
  const cursor = state.cursor ?? 0
  const last = state.history.at(-1)

  for (let i = 0; i < state.cells.length; i++) {
    const cell = root.children[i]
    const value = state.cells[i]

    cell.textContent = value === EMPTY ? '' : GLYPH[value]
    cell.setAttribute('aria-label', cellLabel(state, i))

    // в порядке табуляции участвует только клетка под курсором (roving tabindex)
    cell.tabIndex = i === cursor ? 0 : -1
    cell.classList.toggle('win', win.includes(i))
    cell.classList.toggle('last', i === last)
  }

  // класс висит на поле, а не на клетках: по нему CSS гасит всё, кроме победной линии
  root.classList.toggle('finished', state.outcome !== null)
}

// resultText(outcome, iWon) это строка итога для того, кто смотрит на экран.
// outcome это 'win', 'draw' или 'resign', iWon говорит, выиграл ли он сам. Строка нужна
// и живой партии по сети, и повтору, поэтому вынесена отдельно.
function resultText(outcome, iWon) {
  if (outcome === 'draw') return 'Ничья'
  if (outcome === 'resign') return iWon ? 'Соперник сдался' : 'Вы сдались'
  return iWon ? 'Вы выиграли' : 'Вы проиграли'
}

// onlineLines(state, account) возвращает две строки для правой панели в режиме "По сети":
// первая это то, что пишется в .turn, вторая в .moves. Зовётся из renderStatus.
// account это { token, nickname } вошедшего игрока или null. Он нужен только пустому полю,
// когда партии по сети ещё нет: по нему выбирается, что подсказать игроку.
// online это данные сервера о партии, mine и rival это никнеймы игрока и его соперника,
// p это сторона, чей сейчас ход. lines это две готовые строки.
// Если опрос не дошёл до сервера (online.offline), вторая строка сообщает об этом.
function onlineLines(state, account) {
  const online = state.online
  if (!online) {
    return [account ? 'Выберите соперника слева' : 'Войдите, чтобы играть по сети', '']
  }

  const mine = online.you === X ? online.x : online.o
  const rival = online.you === X ? online.o : online.x
  const p = currentPlayer(state)
  const count = `Сделано ходов: ${state.history.length}`

  let lines
  if (online.o === null) {
    lines = ['Ждём соперника...',
      online.invite ? 'Отправьте другу ссылку слева' : 'Ищем игрока с такими же N и K']
  } else if (state.outcome === null) {
    const who = p === online.you ? 'вы' : rival
    lines = [`Ход: ${GLYPH[p]} (${who})`, count]
  } else {
    // победителя по доске считаем сами: после победного хода currentPlayer это проигравший.
    // Так текст верен и сразу после своего хода, до ответа сервера. Сдачу на доске не видно,
    // её победитель берётся из ответа сервера
    const iWon = state.outcome === 'resign' ? online.winner === mine : 3 - p === online.you
    lines = [resultText(state.outcome, iWon), count]
  }

  if (online.offline) lines[1] = 'Нет связи с сервером'
  return lines
}

// renderStatus(state, panel, account) обновляет правую панель: чей ход или чем кончилась
// партия, сколько сделано ходов и какие кнопки доступны. Ничего не возвращает и новый HTML
// не строит, а меняет текст и атрибуты уже существующих элементов, иначе после каждой
// перерисовки терялись бы обработчики кнопок.
// turn, moves, undoButton, redoButton, newButton и resignButton это найденные внутри panel
// элементы.
// p это сторона, которая сделала бы следующий ход, считается по длине history.
// ai говорит, что партия идёт против ИИ: тогда вместо значка пишем "вы" или "ИИ".
// online говорит, что на экране режим "По сети": тексты тогда берутся из onlineLines,
// а account передаётся дальше только ей.
function renderStatus(state, panel, account) {
  const turn = panel.querySelector('.turn')
  const moves = panel.querySelector('.moves')
  const undoButton = panel.querySelector('.btn-undo')
  const redoButton = panel.querySelector('.btn-redo')
  const newButton = panel.querySelector('.btn-new')
  const resignButton = panel.querySelector('.btn-resign')

  // после победного хода currentPlayer это уже проигравший, значит победитель это 3 - p
  const p = currentPlayer(state)
  const ai = state.mode === 'ai'
  const online = state.mode === 'online'

  if (online) {
    const [first, second] = onlineLines(state, account)
    turn.textContent = first
    moves.textContent = second
  } else if (state.outcome === null) {
    // ИИ ходит сразу, как только до него дошла очередь, поэтому его ход это "думает"
    const who = !ai ? '' : p === state.humanSide ? ' (вы)' : ' (ИИ думает...)'
    turn.textContent = `Ход: ${GLYPH[p]}${who}`
    moves.textContent = `Сделано ходов: ${state.history.length}`
  } else if (state.outcome === 'win') {
    const winner = 3 - p
    if (!ai) turn.textContent = `${GLYPH[winner]} выиграл`
    else turn.textContent = winner === state.humanSide ? 'Вы выиграли' : 'ИИ выиграл'
    moves.textContent = `Сделано ходов: ${state.history.length}`
  } else if (state.outcome === 'draw') {
    turn.textContent = 'Ничья'
    moves.textContent = 'Свободных клеток нет'
  } else {
    // против ИИ сдаться может только человек
    turn.textContent = ai ? 'Вы сдались' : `${GLYPH[p]} сдался`
    moves.textContent = `Сделано ходов: ${state.history.length}`
  }

  // undo доступен, пока есть что снимать. redo только когда в стеке есть ходы и партия
  // не закончена, потому что game.js не даёт вернуть ход в законченную партию.
  // По сети отменить ход в партии с человеком нельзя, а новую партию начинают кнопки
  // на левой панели, поэтому эти три кнопки выключены. Сдаться можно, пока партия идёт,
  // то есть соперник пришёл и итога ещё нет.
  undoButton.disabled = online || state.history.length === 0
  redoButton.disabled = online || state.redo.length === 0 || state.outcome !== null
  newButton.disabled = online
  resignButton.disabled = online
    ? !(state.online && state.online.o !== null && state.outcome === null)
    : state.outcome !== null
}

// renderScore(state, record, panel) показывает счёт против ИИ для настроек этой партии.
// record это { w, d, l } из статистики или undefined, если на этих настройках ещё
// не сыграно ни одной партии. В партии двух людей счёт не ведётся, строка пустая.
// first говорит, кто ходил первым: от этого зависит, в какую строку статистики идёт партия,
// level это название уровня сложности.
// Для партии по сети и повтора вместо счёта пишется, кто с кем играет: "✕ alex против
// ○ masha". Пока соперник не пришёл, строка пустая.
function renderScore(state, record, panel) {
  const score = panel.querySelector('.score')
  if (state.online) {
    const { x, o } = state.online
    score.textContent = o === null ? '' : `${GLYPH[X]} ${x} против ${GLYPH[O]} ${o}`
    return
  }
  if (state.mode !== 'ai') {
    score.textContent = ''
    return
  }

  const { w, d, l } = record ?? { w: 0, d: 0, l: 0 }
  const first = state.humanSide === state.first ? 'вы первым' : 'ИИ первым'
  const level = LEVEL_NAMES[state.difficulty]
  score.textContent = `Счёт: ${state.N}x${state.N}, K=${state.K}, ${level}, ${first}\n`
    + `победы ${w}, ничьи ${d}, поражения ${l}`
}

// setCursor(root, i) делает клетку i курсором клавиатуры и ставит на неё фокус.
// Работает по тому же принципу roving tabindex: tabindex="0" ровно у одной клетки,
// у остальных "-1". Зовётся при движении стрелками и hjkl и при старте новой партии.
function setCursor(root, i) {
  for (const cell of root.children) cell.tabIndex = -1

  const cell = root.children[i]
  if (!cell) return

  cell.tabIndex = 0
  cell.focus()
}

// renderAccount(account, state, panel) обновляет блок "Игра по сети" на левой панели,
// panel это сам блок .online-only. Пока игрок не вошёл, видна форма входа, после входа
// строка "Вы: alex" и кнопки. account это { token, nickname } или null.
// Поле со ссылкой для друга видно, пока партия по приглашению ждёт соперника: ссылку
// собираем из адреса страницы и номера партии. В повторе ссылка не нужна.
// online это партия по сети, если она на экране, waiting говорит, что она ждёт друга.
// Всё, что пришло с сервера, попадает на страницу через textContent и value, а не
// через innerHTML: никнейм придумал другой человек, и вставленный как HTML он был бы дырой.
function renderAccount(account, state, panel) {
  panel.querySelector('.login-form').hidden = account !== null
  panel.querySelector('.account').hidden = account === null
  panel.querySelector('.nickname').textContent = account?.nickname ?? ''

  const online = state.replay ? null : state.online
  const waiting = Boolean(online && online.invite && online.o === null)
  panel.querySelector('.invite').hidden = !waiting
  if (waiting) panel.querySelector('.invite-link').value = `${location.origin}/?game=${online.id}`
}

// renderLeaderboard(rows, panel) рисует таблицу рейтинга в правой панели.
// rows это список строк { nickname, wins, draws, losses, points } из getLeaderboard
// или null, если сервер не ответил. Таблица строится заново целиком, строк не больше
// двадцати. Вместо таблицы может быть пояснение: note это строка под ней.
// tr это строка таблицы, value это значение одной ячейки.
function renderLeaderboard(rows, panel) {
  const table = panel.querySelector('.leaderboard')
  const note = panel.querySelector('.leaderboard-note')
  const body = table.tBodies[0]
  body.replaceChildren()

  if (rows === null || rows.length === 0) {
    table.hidden = true
    note.hidden = false
    note.textContent = rows === null ? 'Рейтинг недоступен' : 'Пока никто не играл по сети'
    return
  }

  table.hidden = false
  note.hidden = true
  for (const row of rows) {
    const tr = body.insertRow()
    for (const value of [row.nickname, row.wins, row.draws, row.losses, row.points]) {
      tr.insertCell().textContent = value
    }
  }
}

export { renderBoard, renderStatus, renderScore, renderAccount, renderLeaderboard, setCursor }
