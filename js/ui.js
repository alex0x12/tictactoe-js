import { EMPTY, X, O, rowOf, colOf } from './board.js'
import { currentPlayer } from './game.js'

// Обозначения сторон и буквы столбцов для координат вида «C3»
const GLYPH = { [X]: '✕', [O]: '○' }
const COLUMNS = 'ABCDEFGHIJKLMNO'

// Индекс клетки → координата «C3» (буква столбца + номер строки)
function coord(i, N) {
  return COLUMNS[colOf(i, N)] + (rowOf(i, N) + 1)
}

function cellLabel(state, i) {
  const value = state.cells[i]
  const what = value === EMPTY ? 'пусто' : value === X ? 'крестик' : 'нолик'
  return `${coord(i, state.N)}, ${what}`
}

// Полная перерисовка поля. Клетки создаются один раз — при смене размера,
// дальше обновляется только их содержимое (иначе терялся бы фокус).
function renderBoard(state, root) {
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

    // roving tabindex: в порядке табуляции участвует только клетка под курсором
    cell.tabIndex = i === cursor ? 0 : -1
    cell.classList.toggle('win', win.includes(i))
  }

  root.classList.toggle('finished', state.outcome !== null)
}

// Статус-панель: чей ход, счётчик ходов и доступность кнопок
function renderStatus(state, panel) {
  const turn = panel.querySelector('.turn')
  const moves = panel.querySelector('.moves')
  const undoButton = panel.querySelector('.btn-undo')
  const redoButton = panel.querySelector('.btn-redo')
  const resignButton = panel.querySelector('.btn-resign')

  // currentPlayer после победного хода — это уже проигравший, поэтому победитель 3 - p
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

  undoButton.disabled = state.history.length === 0
  redoButton.disabled = state.redo.length === 0 || state.outcome !== null
  resignButton.disabled = state.outcome !== null
}

// Курсор клавиатуры — единственная клетка с tabindex="0"
function setCursor(root, i) {
  for (const cell of root.children) cell.tabIndex = -1

  const cell = root.children[i]
  if (!cell) return

  cell.tabIndex = 0
  cell.focus()
}

export { renderBoard, renderStatus, setCursor }
