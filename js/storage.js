import { X, O } from './board.js';
import { createGame, isLegal, applyMove, resign } from './game.js';

// storage.js сохраняет в localStorage партию, настройки и статистику и читает их обратно.
// Это единственный модуль, который трогает localStorage. Прочитанные оттуда данные могли
// испортить старая версия кода, баг или правка руками в DevTools, поэтому они проверяются
// перед использованием. Исключений наружу модуль не выпускает: если хранилище недоступно,
// игра работает, просто без сохранения.

// SCHEMA_VERSION это версия формата записей, она пишется в поле v каждой из них.
// Когда формат меняется, число увеличивают, и старые записи с другим v выбрасываются,
// а не работают наполовину.
const SCHEMA_VERSION = 1;

// KEYS это имена ключей в localStorage. Ключей три, потому что у данных разный срок жизни:
// партия заканчивается, настройки живут дольше партии, статистика дольше всего.
const KEYS = {
  settings: 'ttt.settings',
  game: 'ttt.game',
  stats: 'ttt.stats',
};

// MODES и DIFFICULTIES это допустимые значения режима и сложности,
// по ним проверяются записи партии и настроек.
const MODES = ['pvp', 'ai'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

// --- проверки значений ---

// isIntInRange(x, lo, hi) проверяет, что x целое число от lo до hi включительно.
// Number.isInteger сам отсекает строки, NaN, null, undefined и дроби,
// так что тип отдельно проверять не нужно.
function isIntInRange(x, lo, hi) {
  return Number.isInteger(x) && x >= lo && x <= hi;
}

// isPlainObject(x) проверяет, что x обычный объект вида {...}. typeof null и typeof
// массива тоже дают 'object', поэтому их отсекаем отдельно.
function isPlainObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// isCount(x) проверяет счётчик статистики: целое число, не меньше нуля.
function isCount(x) {
  return isIntInRange(x, 0, Number.MAX_SAFE_INTEGER);
}

// --- проверка записи партии: без localStorage, поэтому её гоняют тесты в Node ---

// validateAndRebuild(obj) превращает разобранную запись ttt.game в GameState или null.
// Если испорчена шапка (N, K, стороны, режим, сложность, зерно), запись не наша,
// возвращаем null. Если испорчены ходы, оставляем правильное начало истории
// и обрезаем по первому плохому ходу: первые ходы почти наверняка нормальные.
// Ходы проигрываются через isLegal и applyMove, тот же код, что и в живой игре,
// поэтому восстановленная партия подчиняется тем же правилам. rebuild из game.js
// здесь не подходит, он истории доверяет и ничего не проверяет.
// game это собираемая партия, cut говорит, пришлось ли обрезать историю.
function validateAndRebuild(obj) {
  if (!isPlainObject(obj)) return null;
  if (obj.v !== SCHEMA_VERSION) return null;
  if (!isIntInRange(obj.N, 3, 15)) return null;
  if (!isIntInRange(obj.K, 3, obj.N)) return null;
  if (obj.first !== X) return null;                      // крестик всегда ходит первым
  if (obj.humanSide !== X && obj.humanSide !== O) return null;
  if (!MODES.includes(obj.mode)) return null;
  if (!DIFFICULTIES.includes(obj.difficulty)) return null;
  if (!isIntInRange(obj.seed, 0, 0xFFFFFFFF)) return null;
  if (!Array.isArray(obj.history)) return null;

  const game = createGame({
    N: obj.N,
    K: obj.K,
    mode: obj.mode,
    difficulty: obj.difficulty,
    humanFirst: obj.humanSide === X,
    seed: obj.seed,
  });

  // isLegal остановит цикл на нецелом индексе, на индексе за полем, на занятой клетке
  // и на любом ходе после конца партии
  for (const i of obj.history) {
    if (!isLegal(game, i)) break;
    applyMove(game, i);
  }

  // redo продолжает сохранённую историю. Если историю обрезали, продолжение
  // к ней больше не подходит, поэтому его тоже выбрасываем
  const cut = game.history.length < obj.history.length;
  game.redo = cut ? [] : cleanRedo(game, obj.redo);

  // победу и ничью пересчитали по ходам. Сдачу на доске не видно, поэтому
  // это единственный исход, который берём из записи
  if (obj.outcome === 'resign') resign(game);

  game.counted = obj.counted === true;
  return game;
}

// cleanRedo(game, redo) возвращает копию стека redo, если каждый ход из него ещё можно
// сыграть и повторов нет, иначе пустой стек. Без этой проверки кнопка "Вернуть" добавила бы
// в history индекс 300 или поставила бы камень на занятую клетку.
// Зовётся из validateAndRebuild до resign: после сдачи isLegal не пропускает ни одного хода.
// Set хранит только уникальные значения, поэтому если он короче массива, в redo был повтор.
function cleanRedo(game, redo) {
  if (!Array.isArray(redo)) return [];
  if (new Set(redo).size !== redo.length) return [];     // одна клетка дважды

  for (const i of redo) {
    if (!isLegal(game, i)) return [];
  }
  return [...redo];                                      // копия, чтобы не держать чужой массив
}

// --- доступ к localStorage ---

// readJSON(key) читает ключ и разбирает JSON. Возвращает значение или null, если ключа нет,
// хранилище недоступно или внутри мусор. Исключений не бросает.
// Два try стоят отдельно, потому что случаи разные: если не удалось прочитать, удалять
// нечего, а если прочитали мусор, ключ удаляем, чтобы не спотыкаться о него при каждой загрузке.
// raw это строка из хранилища.
function readJSON(key) {
  let raw;
  try {
    raw = localStorage.getItem(key);   // при запрещённых куки Chrome бросает уже здесь
  } catch {
    return null;
  }
  if (raw === null) return null;       // ключ ни разу не записывали

  try {
    return JSON.parse(raw);            // на мусоре бросает SyntaxError
  } catch {
    removeKey(key);
    return null;
  }
}

// writeJSON(key, value) превращает value в JSON и записывает под ключом key.
// Если хранилище запрещено или переполнено, ошибку глотаем: игра продолжается,
// просто не переживёт перезагрузку.
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ничего не делаем
  }
}

// removeKey(key) удаляет ключ. Обёрнут в try по той же причине, что и чтение:
// исключение может бросить само обращение к localStorage.
function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ничего не делаем
  }
}

// --- настройки ---

// loadSettings() возвращает последние сохранённые настройки
// { N, K, mode, difficulty, humanFirst, debug } или null, если их нет или они испорчены.
// main.js ставит по ним ползунки, когда сохранённой партии нет.
// humanFirst и debug становятся true только при точном true, строка или число не пройдут.
function loadSettings() {
  const obj = readJSON(KEYS.settings);
  if (!isPlainObject(obj) || obj.v !== SCHEMA_VERSION) return null;
  if (!isIntInRange(obj.N, 3, 15) || !isIntInRange(obj.K, 3, obj.N)) return null;
  if (!MODES.includes(obj.mode) || !DIFFICULTIES.includes(obj.difficulty)) return null;

  return {
    N: obj.N,
    K: obj.K,
    mode: obj.mode,
    difficulty: obj.difficulty,
    humanFirst: obj.humanFirst === true,
    debug: obj.debug === true,
  };
}

// saveSettings(s) записывает настройки вместе с версией формата. Поля перечислены явно,
// чтобы в хранилище не попало ничего лишнего. Зовётся из startGame в main.js.
function saveSettings(s) {
  writeJSON(KEYS.settings, {
    v: SCHEMA_VERSION,
    N: s.N,
    K: s.K,
    mode: s.mode,
    difficulty: s.difficulty,
    humanFirst: s.humanFirst,
    debug: s.debug,
  });
}

// --- партия ---

// loadGame() читает ttt.game, проверяет через validateAndRebuild и возвращает партию
// или null. Запись, которая не прошла проверку, удаляется, чтобы не лежать там вечно.
// Зовётся один раз при загрузке страницы.
function loadGame() {
  const obj = readJSON(KEYS.game);
  if (obj === null) return null;

  const game = validateAndRebuild(obj);
  if (game === null) removeKey(KEYS.game);
  return game;
}

// saveGame(state) записывает партию. Пишутся только поля из схемы: cells и winLine
// пересчитываются из history, а JSON.stringify превратил бы Int8Array в объект с полями
// "0", "1" и так далее. cursor относится к экрану, а не к партии, его тоже не пишем.
// outcome сохраняется ради сдачи: её на доске не видно, без поля она не пережила бы F5.
// Зовётся после каждого изменения партии через afterChange в main.js.
function saveGame(state) {
  writeJSON(KEYS.game, {
    v: SCHEMA_VERSION,
    N: state.N, K: state.K, first: state.first, humanSide: state.humanSide,
    mode: state.mode, difficulty: state.difficulty, seed: state.seed,
    history: state.history, redo: state.redo,
    outcome: state.outcome, counted: state.counted,
  });
}

// --- статистика ---

// loadStats() всегда возвращает объект { v, items }. items это словарь вида
// { "N5-K4-medium-first": { w, d, l } }, он пустой, если ничего годного не сохранено.
// Испорченные записи отбрасываются по одной, чтобы одна плохая не стёрла остальные.
// Object.entries даёт пары [ключ, значение]: key это ключ статистики, rec его счётчики.
function loadStats() {
  const obj = readJSON(KEYS.stats);
  const items = {};

  if (isPlainObject(obj) && obj.v === SCHEMA_VERSION && isPlainObject(obj.items)) {
    for (const [key, rec] of Object.entries(obj.items)) {
      if (isPlainObject(rec) && isCount(rec.w) && isCount(rec.d) && isCount(rec.l)) {
        items[key] = { w: rec.w, d: rec.d, l: rec.l };
      }
    }
  }
  return { v: SCHEMA_VERSION, items };
}

// statsKey(state) возвращает ключ статистики для партии, например "N5-K4-medium-first".
// Буквы N и K обязательны: без них "5x4" читалось бы как доска 5 на 4.
// first или second говорит, ходил ли человек первым, это заметно разные по сложности партии.
function statsKey(state) {
  const side = state.humanSide === state.first ? 'first' : 'second';
  return `N${state.N}-K${state.K}-${state.difficulty}-${side}`;
}

// recordResult(state, r) прибавляет единицу к w (победа), d (ничья) или l (поражение)
// для ключа этой партии. Партии в режиме "два игрока" не считаются, в них нет "твоей"
// стороны. Чтобы одна партия не посчиталась дважды, main.js перед вызовом проверяет
// флаг counted. rec это счётчики для ключа, если их ещё нет, начинаем с нулей.
function recordResult(state, r) {
  if (state.mode !== 'ai') return;

  const stats = loadStats();
  const key = statsKey(state);
  const rec = stats.items[key] ?? { w: 0, d: 0, l: 0 };
  rec[r] += 1;
  stats.items[key] = rec;
  writeJSON(KEYS.stats, stats);
}

export {
  SCHEMA_VERSION,
  validateAndRebuild,
  loadSettings, saveSettings,
  loadGame, saveGame,
  loadStats, statsKey, recordResult,
};
