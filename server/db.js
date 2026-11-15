import { DatabaseSync } from 'node:sqlite'

// db.js это всё, что сервер знает про SQL. Тут открывается база и лежат маленькие функции,
// по одной на запрос. В app.js SQL не пишется: там только логика адресов, а откуда берутся
// данные, видно по названию функции отсюда. Все запросы синхронные, потому что DatabaseSync
// из node:sqlite не отдаёт промисов.

// SCHEMA это три таблицы. Что в них значит:
//   nickname объявлен с COLLATE NOCASE, поэтому после alex нельзя зарегистрировать Alex.
//     В SQLite NOCASE понимает регистр только у латинских букв, и никнейм ими и ограничен;
//   password это строка "соль:хеш", сам пароль не хранится, см. auth.js;
//   tokens это выданные при входе токены, по одной строке на каждый вход;
//   games.id это случайная строка из 12 символов, а не номер 1, 2, 3: id попадает в ссылку
//     для друга, и по номерам можно было бы угадать чужую партию;
//   x_id это создатель партии, он всегда играет крестиком, o_id пуст, пока соперник не пришёл;
//   invite это 1 для партии по приглашению и 0 для случайного соперника;
//   history это ходы JSON-текстом, например [4,0,8]. Как и в браузере, доска и очередь хода
//     получаются из истории;
//   outcome это null, 'win', 'draw' или 'resign', winner_id пуст при ничьей и в идущей партии;
//   created_at это Date.now() в миллисекундах, по нему список партий идёт от новых к старым.
// Состояние партии отдельным полем не хранится, его видно по двум полям: o_id пуст значит
// партия ждёт соперника, o_id есть и outcome пуст значит идёт, outcome есть значит закончена.
// Очки рейтинга тоже не хранятся, запрос считает их как wins * 3 + draws.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  wins     INTEGER NOT NULL DEFAULT 0,
  draws    INTEGER NOT NULL DEFAULT 0,
  losses   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens (
  token   TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS games (
  id         TEXT PRIMARY KEY,
  N          INTEGER NOT NULL,
  K          INTEGER NOT NULL,
  x_id       INTEGER NOT NULL REFERENCES users(id),
  o_id       INTEGER REFERENCES users(id),
  invite     INTEGER NOT NULL,
  history    TEXT NOT NULL DEFAULT '[]',
  outcome    TEXT,
  winner_id  INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
`

// openDb(file) открывает базу из файла file и создаёт таблицы, если их ещё нет.
// Зовётся из index.js с настоящим файлом и из тестов с ':memory:', то есть с базой
// в памяти, которая пропадает вместе с тестом. Внешние ключи в SQLite по умолчанию
// выключены, поэтому включаем их сами: без этого в games можно было бы записать
// игрока, которого нет. db это открытая база, её передают во все функции ниже.
function openDb(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

// --- игроки и токены ---

// createUser(db, nickname, passwordHash) записывает нового игрока и возвращает его id.
// passwordHash это строка "соль:хеш" из auth.js. lastInsertRowid может прийти как BigInt,
// поэтому приводим к обычному числу. Если никнейм занят, база бросит ошибку, но app.js
// проверяет это раньше через findUserByNickname.
function createUser(db, nickname, passwordHash) {
  const result = db.prepare('INSERT INTO users (nickname, password) VALUES (?, ?)')
    .run(nickname, passwordHash)
  return Number(result.lastInsertRowid)
}

// findUserByNickname(db, nickname) возвращает строку игрока из users или undefined.
// Сравнение идёт без учёта регистра: так объявлен столбец.
function findUserByNickname(db, nickname) {
  return db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname)
}

// findUserByToken(db, token) возвращает строку игрока, которому выдан токен, или undefined.
// Так сервер узнаёт, кто прислал запрос. Зовётся из requireUser в app.js.
function findUserByToken(db, token) {
  return db.prepare(`
    SELECT users.* FROM tokens
    JOIN users ON users.id = tokens.user_id
    WHERE tokens.token = ?`).get(token)
}

// saveToken(db, token, userId) запоминает выданный токен и его владельца.
function saveToken(db, token, userId) {
  db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, userId)
}

// deleteToken(db, token) забывает токен. Остальные токены игрока остаются, поэтому выход
// на одном компьютере не выбрасывает его с другого.
function deleteToken(db, token) {
  db.prepare('DELETE FROM tokens WHERE token = ?').run(token)
}

// --- партии ---

// GAME_SELECT это начало запроса, который читает партию вместе с никнеймами игроков:
// в ответе нужны имена, а не id. JOIN берёт крестика, он есть всегда. LEFT JOIN нужен там,
// где игрока может не быть: нолик ещё не пришёл, победителя ещё нет. x, o и w это
// короткие имена одной и той же таблицы users, взятой три раза.
const GAME_SELECT = `
  SELECT games.*, x.nickname AS x_name, o.nickname AS o_name, w.nickname AS winner_name
  FROM games
  JOIN users x ON x.id = games.x_id
  LEFT JOIN users o ON o.id = games.o_id
  LEFT JOIN users w ON w.id = games.winner_id`

// insertGame(db, { id, N, K, xId, invite }) записывает новую партию, в которой пока один
// игрок, крестик xId. invite это true или false, в базе он лежит как 1 или 0.
// Время создания ставит сервер, а не браузер.
function insertGame(db, { id, N, K, xId, invite }) {
  db.prepare('INSERT INTO games (id, N, K, x_id, invite, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, N, K, xId, invite ? 1 : 0, Date.now())
}

// findGame(db, id) возвращает партию вместе с x_name, o_name и winner_name
// или undefined, если такой партии нет.
function findGame(db, id) {
  return db.prepare(`${GAME_SELECT} WHERE games.id = ?`).get(id)
}

// findWaitingGame(db, N, K) возвращает самую старую партию, которая ждёт соперника,
// без приглашения и с такими же N и K, или undefined. Это строка из games без никнеймов,
// нужен только её id. rowid решает, если две партии созданы в одну миллисекунду.
function findWaitingGame(db, N, K) {
  return db.prepare(`
    SELECT * FROM games
    WHERE o_id IS NULL AND invite = 0 AND N = ? AND K = ?
    ORDER BY created_at, rowid
    LIMIT 1`).get(N, K)
}

// deleteWaitingGames(db, userId) удаляет партии игрока, в которых нет соперника.
// У игрока не больше одной такой партии, поэтому перед новой старую убирают.
function deleteWaitingGames(db, userId) {
  db.prepare('DELETE FROM games WHERE x_id = ? AND o_id IS NULL').run(userId)
}

// setOpponent(db, id, userId) сажает игрока userId на место нолика в партии id.
function setOpponent(db, id, userId) {
  db.prepare('UPDATE games SET o_id = ? WHERE id = ?').run(userId, id)
}

// gamesOfUser(db, userId) возвращает до 20 партий игрока от новых к старым, в том же виде,
// что и findGame. Берутся партии, где он крестик или нолик и где уже есть соперник:
// ждущие партии в список не попадают. rowid решает порядок, если две партии созданы
// в одну миллисекунду. Нужна для профиля.
function gamesOfUser(db, userId) {
  return db.prepare(`${GAME_SELECT}
    WHERE (games.x_id = ? OR games.o_id = ?) AND games.o_id IS NOT NULL
    ORDER BY games.created_at DESC, games.rowid DESC
    LIMIT 20`).all(userId, userId)
}

// saveMoves(db, id, history, outcome, winnerId) записывает ходы и итог партии id.
// history приходит массивом, в базу уходит JSON-текстом. outcome это null, 'win', 'draw'
// или 'resign', winnerId это id победителя или null.
function saveMoves(db, id, history, outcome, winnerId) {
  db.prepare('UPDATE games SET history = ?, outcome = ?, winner_id = ? WHERE id = ?')
    .run(JSON.stringify(history), outcome, winnerId, id)
}

// ADD_RESULT это готовый запрос на каждый итог. Имя столбца нельзя передать через ?,
// поэтому запросов три, а не один с подстановкой. Склеивать SQL из строки, пришедшей
// снаружи, нельзя никогда: так делается взлом через SQL-инъекцию.
const ADD_RESULT = {
  win: 'UPDATE users SET wins = wins + 1 WHERE id = ?',
  draw: 'UPDATE users SET draws = draws + 1 WHERE id = ?',
  loss: 'UPDATE users SET losses = losses + 1 WHERE id = ?',
}

// addResult(db, userId, result) прибавляет единицу к счётчику игрока userId.
// result это 'win', 'draw' или 'loss'. Зовётся один раз для каждого игрока, когда
// партия закончилась.
function addResult(db, userId, result) {
  db.prepare(ADD_RESULT[result]).run(userId)
}

// --- рейтинг ---

// leaderboard(db) возвращает до 20 лучших игроков, которые сыграли хотя бы одну партию:
// { nickname, wins, draws, losses, points }. Очки считает сам запрос, победа даёт 3,
// ничья 1. Порядок: больше очков, при равенстве больше побед, дальше по никнейму.
// Последний ключ нужен, чтобы при полном равенстве порядок не менялся от запроса к запросу.
function leaderboard(db) {
  return db.prepare(`
    SELECT nickname, wins, draws, losses, wins * 3 + draws AS points
    FROM users
    WHERE wins + draws + losses > 0
    ORDER BY points DESC, wins DESC, nickname
    LIMIT 20`).all()
}

export {
  openDb,
  createUser, findUserByNickname, findUserByToken, saveToken, deleteToken,
  insertGame, findGame, findWaitingGame, deleteWaitingGames, setOpponent,
  gamesOfUser, saveMoves, addResult, leaderboard,
}
