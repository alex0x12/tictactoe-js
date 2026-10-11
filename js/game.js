import { hasWin, winLine, isBoardFull } from './rules.js'
import {
  EMPTY, X, O, idx, rowOf, colOf, inside,
  createBoard, place, unplace, opponent,
} from './board.js';


function createGame({ N, K, mode, difficulty, humanFirst, seed })
{
  const GameState = {
    N, K, mode, difficulty, seed,
    first: X,
    humanSide: humanFirst ? X : O,
    history: [], redo: [],
    outcome: null,
    winLine: null,
    counted: false,
    cells: createBoard(N),
  }
  return GameState;
}

function currentPlayer(state)
{
  return state.history.length % 2 === 0 ? state.first : opponent(state.first);
}

function isLegal(state, i)
{
  return state.outcome === null
    && Number.isInteger(i)
    && i >= 0 && i < state.N * state.N
    && state.cells[i] === EMPTY;
}

function pushMove(state, i, clearRedo)
{
  const p = currentPlayer(state);

  place(state.cells, i, p);
  state.history.push(i);
  if (clearRedo) state.redo.length = 0;

  // Порядок проверок: победа РАНЬШЕ ничьей.
  // Последний ход мог одновременно заполнить доску и замкнуть линию —
  // если сначала проверить «доска полна», такая партия кончится ничьёй.
  const line = winLine(state.cells, state.N, state.K, i, p);
  if (line)
  {
    state.outcome = 'win';
    state.winLine = line;
  }
  else if (isBoardFull(state.cells))
  {
    state.outcome = 'draw';
  }
}

function applyMove(state, i)
{
  if (!isLegal(state, i)) throw new Error(`нелегальный ход: ${i}`);
  pushMove(state, i, true);          // новый ход — чистим redo
}

function undo(state)
{
  let undone = 0;

  while (true)
  {
    if (state.history.length === 0) break;

    const i = state.history.pop();
    unplace(state.cells, i);
    state.redo.push(i);
    undone++;

    // Партия больше не закончена: сняли ход, который её завершал (или не завершал).
    // Сбрасываем на каждой итерации — undo может снять два полухода,
    // и после каждого состояние не должно считаться финальным.
    state.outcome = null;
    state.winLine = null;

    // В pvp всегда один полуход — откатывать пару не с кем.
    if (state.mode === 'pvp') break;

    // Против ИИ: снимаем до тех пор, пока ход не вернётся человеку.
    // currentPlayer смотрит на history.length — после pop он уже сдвинулся.
    if (currentPlayer(state) === state.humanSide) break;

    // Страховка: не больше двух полуходов за один вызов.
    if (undone >= 2) break;
  }

  return undone;
}

function redo(state)
{
  // Возвращать нечего: стек отмен пуст или все уже использованы.
  if (state.redo.length === 0) return false;

  // Партия закончена — восстановленный ход не сможет состояться,
  // isLegal заблокирует любой ход при outcome !== null.
  if (state.outcome !== null) return false;

  // LIFO: последний отменённый ход возвращается первым.
  const i = state.redo.pop();

  // clearRedo = false — НЕ трогаем стек redo, иначе снесём остаток,
  // из которого только что взяли ход, и второй redo вернёт false.
  pushMove(state, i, false);

  return true;
}

// Помечает партию сданной. Ходов после этого нет — isLegal смотрит на outcome.
function resign(state)
{
  if (state.outcome !== null) return;    // уже закончилась — не перезаписываем
  state.outcome = 'resign';
}

// Пересобирает cells, outcome и winLine из state.history.
// Доверяет истории: она пришла из applyMove, а не из localStorage.
function rebuild(state)
{
  state.cells = createBoard(state.N);
  state.outcome = null;
  state.winLine = null;

  let player = state.first;
  for (const i of state.history)
  {
    place(state.cells, i, player);

    const line = winLine(state.cells, state.N, state.K, i, player);
    if (line)
    {
      state.outcome = 'win';
      state.winLine = line;
      return;                  // после победы ходов быть не могло
    }
    if (isBoardFull(state.cells))
    {
      state.outcome = 'draw';
      return;
    }

    player = opponent(player);
  }
}

export { createGame, currentPlayer, isLegal, applyMove, undo, redo, resign, rebuild };
