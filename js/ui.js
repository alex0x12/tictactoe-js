import { EMPTY, X, O, rowOf, colOf } from './board.js'
import { currentPlayer } from './game.js'

// GLYPH говорит, каким символом рисовать значение клетки: 1 это крестик, 2 это нолик.
// COLUMNS это буквы столбцов для подписей вида "C3". Больше пятнадцати столбцов не бывает,
// потому что N ограничено пятнадцатью.
const GLYPH = { [X]: '✕', [O]: '○' }
const COLUMNS = 'ABCDEFGHIJKLMNO'

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

  for (let i = 0; i < state.cells.length; i++) {
    const cell = root.children[i]
    const value = state.cells[i]

    cell.textContent = value === EMPTY ? '' : GLYPH[value]
    cell.setAttribute('aria-label', cellLabel(state, i))

    // в порядке табуляции участвует только клетка под курсором (roving tabindex)
    cell.tabIndex = i === cursor ? 0 : -1
    cell.classList.toggle('win', win.includes(i))
  }

  // класс висит на поле, а не на клетках: по нему CSS гасит всё, кроме победной линии
  root.classList.toggle('finished', state.outcome !== null)
}

// renderStatus(state, panel) обновляет правую панель: чей ход или чем кончилась партия,
// сколько сделано ходов и какие кнопки доступны. Ничего не возвращает и новый HTML
// не строит, а меняет текст и атрибуты уже существующих элементов, иначе после каждой
// перерисовки терялись бы обработчики кнопок.
// turn, moves, undoButton, redoButton и resignButton это найденные внутри panel элементы.
// p это сторона, которая сделала бы следующий ход, считается по длине history.
function renderStatus(state, panel) {
  const turn = panel.querySelector('.turn')
  const moves = panel.querySelector('.moves')
  const undoButton = panel.querySelector('.btn-undo')
  const redoButton = panel.querySelector('.btn-redo')
  const resignButton = panel.querySelector('.btn-resign')

  // после победного хода currentPlayer это уже проигравший, значит победитель это 3 - p
  const p = currentPlayer(state)

  if (state.outcome === null) {
    turn.textContent = `Ход: ${GLYPH[p]}`
    moves.textContent = `Сделано ходов: ${state.history.length}`
  } else if (state.outcome === 'win') {
    turn.textContent = `${GLYPH[3 - p]} выиграл`
    moves.textContent = `Сделано ходов: ${state.history.length}`
  } else if (state.outcome === 'draw') {
    turn.textContent = 'Ничья'
    moves.textContent = 'Свободных клеток нет'
  } else {
    turn.textContent = `${GLYPH[p]} сдался`
    moves.textContent = `Сделано ходов: ${state.history.length}`
  }

  // undo доступен, пока есть что снимать. redo только когда в стеке есть ходы и партия
  // не закончена, потому что game.js не даёт вернуть ход в законченную партию
  undoButton.disabled = state.history.length === 0
  redoButton.disabled = state.redo.length === 0 || state.outcome !== null
  resignButton.disabled = state.outcome !== null
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

export { renderBoard, renderStatus, setCursor }
