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

export { openDb }
