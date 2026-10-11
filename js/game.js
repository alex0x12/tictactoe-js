import { hasWin, winLine, isBoardFull } from './rules.js'
import {
  EMPTY, X, O, idx, rowOf, colOf, inside,
  createBoard, place, unplace, opponent,
} from './board.js';

// game.js это модель партии: ходы, конец игры, отмена с возвратом, сдача, пересборка.
// Модуль нигде не трогает document, window и localStorage, поэтому его гоняют тестами
// в Node наравне с board.js и rules.js. Состав состояния собирается тут же, в createGame.

// createGame({N, K, mode, difficulty, humanFirst, seed}) создаёт новое состояние партии.
// Все параметры фиксируются в момент старта и потом не меняются: иначе партия, сыгранная
// на одной сложности, после переключения радиокнопки засчиталась бы в другую.
// Внутри собирается объект GameState:
//   N и K это размер поля и длина цепочки, от них зависит вся арифметика индексов;
//   mode это 'pvp' или 'ai';
//   difficulty это 'easy', 'medium' или 'hard', она нужна поиску ИИ;
//   seed это зерно генератора для намеренных ошибок ИИ;
//   first это тот, кто ходит первым, всегда крестик;
//   humanSide это сторона человека, в режиме 'pvp' не используется;
//   history это индексы ходов по порядку, из неё выводятся и доска, и чей ход;
//   redo это снятые ходы, вершина стека это последний снятый;
//   outcome это null, 'win', 'draw' или 'resign';
//   winLine это индексы победной цепочки или null;
//   counted помечает, записан ли результат в статистику;
//   cells это кэш доски, он обновляется вместе с history.
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

// currentPlayer(state) говорит, чей сейчас ход: 1 или 2. Это не хранится, а считается
// из чётности длины history, так очередь хода не разойдётся с числом камней на доске.
// Зовут её pushMove (кто ставит камень), undo (когда ход вернулся человеку) и интерфейс.
function currentPlayer(state)
{
  return state.history.length % 2 === 0 ? state.first : opponent(state.first);
}

// isLegal(state, i) проверяет, можно ли поставить камень в клетку i. Это единственная
// проверка легальности в проекте, интерфейс должен спрашивать её, а не смотреть на DOM.
// Ход не пройдёт, если партия уже закончена, если i не целое, если i вне поля
// или если клетка занята.
function isLegal(state, i)
{
  return state.outcome === null
    && Number.isInteger(i)
    && i >= 0 && i < state.N * state.N
    && state.cells[i] === EMPTY;
}

// pushMove(state, i, clearRedo) это внутренний обработчик хода: поставить камень,
// дописать индекс в history и посмотреть, не закончилась ли партия. Наружу не выходит,
// его зовут applyMove и redo. clearRedo различает их: новый ход чистит стек отмен,
// а возврат через redo нет.
// p это сторона, которая ходит, line это победная цепочка или null, которую вернула
// winLine для только что поставленного камня.
function pushMove(state, i, clearRedo)
{
  const p = currentPlayer(state);

  place(state.cells, i, p);
  state.history.push(i);
  if (clearRedo) state.redo.length = 0;

  // победу проверяем раньше ничьей: последний ход мог одновременно заполнить доску
  // и замкнуть линию, и если сначала проверить "доска полна", такая партия кончится ничьёй
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

// applyMove(state, i) делает ход. Сначала проверяет легальность и кидает Error
// на невозможный ход, так что звать его можно только после isLegal.
function applyMove(state, i)
{
  if (!isLegal(state, i)) throw new Error(`нелегальный ход: ${i}`);
  pushMove(state, i, true);          // новый ход, значит чистим redo
}

// undo(state) откатывает ходы и возвращает, сколько полуходов снято (0 если нечего).
// Правило отката такое: снимать, пока ход не вернётся человеку, но минимум один.
// В режиме 'pvp' это всегда один полуход, против ИИ обычно пара, то есть ход человека
// и ответ ИИ. Откатывать можно и после конца партии, разбирать проигрыш это нормально.
// undone считает снятое. Цикл берёт индекс с конца history, убирает камень с доски
// и кладёт индекс в redo, чтобы потом вернуть ходы в исходном порядке.
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

    // партия больше не закончена: сняли ход, который её завершал. Сбрасываем
    // на каждой итерации, потому что undo может снять два полухода, и после каждого
    // состояние не должно считаться финальным
    state.outcome = null;
    state.winLine = null;

    // в pvp всегда один полуход, откатывать пару не с кем
    if (state.mode === 'pvp') break;

    // против ИИ снимаем до тех пор, пока ход не вернётся человеку.
    // currentPlayer смотрит на history.length, а после pop он уже сдвинулся
    if (currentPlayer(state) === state.humanSide) break;

    // на всякий случай не больше двух полуходов за один вызов
    if (undone >= 2) break;
  }

  return undone;
}

// redo(state) возвращает последний отменённый ход, true если получилось.
// Стек redo разбирается с конца, поэтому ходы возвращаются в исходном порядке.
function redo(state)
{
  // возвращать нечего: стек отмен пуст или всё уже вернули
  if (state.redo.length === 0) return false;

  // партия закончена, а isLegal не пропустит ни один ход при outcome !== null
  if (state.outcome !== null) return false;

  // снимаем с конца: последний отменённый ход возвращается первым
  const i = state.redo.pop();

  // clearRedo = false, потому что стек redo трогать нельзя: иначе снесём остаток,
  // из которого только что взяли ход, и второй redo вернёт false
  pushMove(state, i, false);

  return true;
}

// resign(state) помечает партию сданной. После этого isLegal не пропустит ни один ход.
// Если партия уже закончена, ничего не меняется.
function resign(state)
{
  if (state.outcome !== null) return;    // уже закончилась, не перезаписываем
  state.outcome = 'resign';
}

// rebuild(state) заново собирает cells, outcome и winLine из state.history.
// Нужен там, где состояние пришло извне, например из localStorage, и доски с собой
// не принесло. Истории доверяем, она собрана через applyMove, а не пользователем.
// player это чья очередь при проигрывании. После победы или ничьей цикл обрывается,
// дальше ходов быть не могло.
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
