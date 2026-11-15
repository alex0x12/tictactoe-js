import express from 'express'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { X, O } from '../js/board.js'
import { hashPassword, checkPassword, newToken } from './auth.js'
import { createGame, currentPlayer, isLegal, applyMove, resign, rebuild } from '../js/game.js'
import {
  createUser, findUserByNickname, findUserByToken, saveToken, deleteToken,
  insertGame, findGame, findWaitingGame, deleteWaitingGames, setOpponent,
  saveMoves, addResult, leaderboard,
} from './db.js'

// app.js собирает приложение Express: раздаёт страницу и отвечает на адреса API.
// Правила игры не пишутся заново, а берутся из js/game.js, того же файла, что работает
// в браузере. Правила остаются в одном месте.

// root это папка src, server лежит внутри неё
const root = join(import.meta.dirname, '..')

// NICKNAME это правило для никнейма: от 3 до 20 латинских букв, цифр или _
const NICKNAME = /^[A-Za-z0-9_]{3,20}$/

// fail(res, status, error) отвечает ошибкой: код status и тело { error }. Страница
// показывает текст error как есть. Все ожидаемые ошибки идут через неё, тексты в спеке.
function fail(res, status, error) {
  return res.status(status).json({ error })
}

// gameView(row, userId) превращает строку партии из базы (результат findGame) в объект
// для ответа, как в спеке. В базе лежат id игроков, 1 и 0 и история текстом, а страница
// получает никнеймы, true и false и массив. you это сторона того, кто спрашивает:
// 1 крестик, 2 нолик, userId это его id.
function gameView(row, userId) {
  return {
    id: row.id,
    N: row.N,
    K: row.K,
    invite: row.invite === 1,
    x: row.x_name,
    o: row.o_name ?? null,
    you: row.x_id === userId ? X : O,
    history: JSON.parse(row.history),
    outcome: row.outcome,
    winner: row.winner_name ?? null,
  }
}

// createApp(db) возвращает приложение Express. База приходит параметром, а не открывается
// тут, чтобы тесты могли подставить базу в памяти. Запускают приложение через .listen(port),
// это делает index.js. Адреса регистрируются по порядку, обработчик ошибок идёт последним.
function createApp(db) {
  const app = express()

  // express.json() разбирает тело запроса из JSON в req.body
  app.use(express.json())

  // отдаём только то, что нужно странице. Папку src целиком отдавать нельзя:
  // тогда любой скачал бы server/ttt.db с хешами паролей
  app.use('/js', express.static(join(root, 'js')))
  app.use('/css', express.static(join(root, 'css')))
  app.get('/', (req, res) => res.sendFile(join(root, 'index.html')))

  // requireUser(req, res, next) это посредник для адресов, куда нужен вход. Достаёт токен
  // из заголовка "Authorization: Bearer ...", ищет его в таблице и кладёт игрока в req.user,
  // а сам токен в req.token (он нужен выходу). Нет токена или он неизвестен: 401, и до самого
  // обработчика адреса дело не доходит. Стоит внутри createApp, потому что ему нужна db.
  function requireUser(req, res, next) {
    const header = req.get('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const user = token ? findUserByToken(db, token) : undefined
    if (!user) return fail(res, 401, 'Нужно войти')
    req.user = user
    req.token = token
    next()
  }

  // Express 5 кладёт в req.body undefined, если запрос пришёл без тела, а не пустой
  // объект. Поэтому везде ниже "?? {}", иначе деструктуризация упала бы.

  // POST /register заводит игрока и сразу выдаёт ему токен. typeof нужен, потому что
  // регулярка превращает любое значение в строку: число 12345 она приняла бы за "12345".
  app.post('/register', (req, res) => {
    const { nickname, password } = req.body ?? {}
    if (typeof nickname !== 'string' || !NICKNAME.test(nickname)) {
      return fail(res, 400, 'Никнейм: от 3 до 20 латинских букв, цифр или _')
    }
    if (typeof password !== 'string' || password.length < 6) {
      return fail(res, 400, 'Пароль должен быть не короче 6 символов')
    }
    if (findUserByNickname(db, nickname)) return fail(res, 409, 'Этот никнейм уже занят')

    const userId = createUser(db, nickname, hashPassword(password))
    const token = newToken()
    saveToken(db, token, userId)
    res.status(201).json({ token, nickname })
  })

  // POST /login проверяет пароль и выдаёт новый токен. Текст ошибки один и для неизвестного
  // никнейма, и для неверного пароля: иначе по ответу можно было бы узнать, какие никнеймы
  // существуют. Никнейм в ответе берётся из базы, вход как ALEX вернёт alex.
  app.post('/login', (req, res) => {
    const { nickname, password } = req.body ?? {}
    const user = typeof nickname === 'string' ? findUserByNickname(db, nickname) : undefined
    if (!user || typeof password !== 'string' || !checkPassword(password, user.password)) {
      return fail(res, 401, 'Неверный никнейм или пароль')
    }

    const token = newToken()
    saveToken(db, token, user.id)
    res.json({ token, nickname: user.nickname })
  })

  // POST /logout забывает токен, с которым пришёл запрос. Ему больше нельзя доверять,
  // даже если его кто-то скопировал.
  app.post('/logout', requireUser, (req, res) => {
    deleteToken(db, req.token)
    res.json({})
  })

  // POST /games начинает партию. Сначала проверяются N и K, и только потом что-то меняется
  // в базе, чтобы плохой запрос не стёр ждущую партию. Дальше убирается прежняя ждущая
  // партия игрока: больше одной у него быть не может. Если нужен случайный соперник,
  // ищется чужая ждущая партия с теми же N и K, и игрок садится в неё ноликом. Иначе
  // создаётся новая, и игрок ждёт в ней крестиком. Приглашение (invite ровно true) всегда
  // создаёт новую партию, а случайные игроки в неё не попадают.
  // Два игрока не сядут в одну ждущую партию: node:sqlite синхронный, между поиском и записью
  // нет await, а Node обрабатывает запросы по одному. me это id игрока.
  app.post('/games', requireUser, (req, res) => {
    const { N, K, invite } = req.body ?? {}
    if (!Number.isInteger(N) || !Number.isInteger(K) || N < 3 || N > 15 || K < 3 || K > N) {
      return fail(res, 400, 'N от 3 до 15, K от 3 до N')
    }

    const me = req.user.id
    deleteWaitingGames(db, me)

    if (invite !== true) {
      const waiting = findWaitingGame(db, N, K)
      if (waiting) {
        setOpponent(db, waiting.id, me)
        return res.status(201).json(gameView(findGame(db, waiting.id), me))
      }
    }

    // 6 случайных байт дают 12 символов, угадать чужой id нельзя
    const id = randomBytes(6).toString('hex')
    insertGame(db, { id, N, K, xId: me, invite: invite === true })
    res.status(201).json(gameView(findGame(db, id), me))
  })

  // POST /games/:id/join это вход по пригласительной ссылке. Если игрок уже в партии
  // (создатель открыл свою ссылку или друг открыл её второй раз), партия отдаётся
  // без ошибки. Если место нолика свободно, игрок его занимает. Если занято другим,
  // 409, так же для законченной партии, в которой игрока не было.
  // Сюда попадает и старая ссылка: если создатель начал другую партию, ждущая удалилась,
  // и ответ 404.
  app.post('/games/:id/join', requireUser, (req, res) => {
    const row = findGame(db, req.params.id)
    if (!row) return fail(res, 404, 'Партия не найдена')

    const me = req.user.id
    if (row.x_id === me || row.o_id === me) return res.json(gameView(row, me))
    if (row.o_id !== null) return fail(res, 409, 'В партии уже два игрока')

    setOpponent(db, row.id, me)
    res.json(gameView(findGame(db, row.id), me))
  })

  // GET /games/:id отдаёт партию. Видят её только два игрока, зрителей нет.
  // Браузер спрашивает этот адрес раз в секунду, чтобы узнать ход соперника.
  app.get('/games/:id', requireUser, (req, res) => {
    const row = findGame(db, req.params.id)
    if (!row) return fail(res, 404, 'Партия не найдена')

    const me = req.user.id
    if (row.x_id !== me && row.o_id !== me) return fail(res, 403, 'Это не ваша партия')
    res.json(gameView(row, me))
  })

  // POST /games/:id/move делает ход или принимает сдачу. Проверки идут строго в этом порядке,
  // от них зависит, какую ошибку увидит игрок: партия есть, игрок в ней, соперник пришёл,
  // партия не закончена. Потом партия собирается из истории тем же кодом, что и в браузере:
  // createGame в режиме 'pvp', история из базы и rebuild. rebuild истории доверяет, и здесь
  // это можно: в базу история попадает только после isLegal.
  // me это id игрока, side его сторона, opponentId id соперника, winnerId победитель
  // или null.
  app.post('/games/:id/move', requireUser, (req, res) => {
    const row = findGame(db, req.params.id)
    if (!row) return fail(res, 404, 'Партия не найдена')
    const me = req.user.id
    if (row.x_id !== me && row.o_id !== me) return fail(res, 403, 'Это не ваша партия')
    if (row.o_id === null) return fail(res, 409, 'Соперник ещё не пришёл')
    if (row.outcome !== null) return fail(res, 409, 'Партия уже закончена')

    const side = row.x_id === me ? X : O
    const opponentId = side === X ? row.o_id : row.x_id

    const state = createGame({
      N: row.N, K: row.K, mode: 'pvp', difficulty: 'medium', humanFirst: true, seed: 0,
    })
    state.history = JSON.parse(row.history)
    rebuild(state)

    let winnerId = null
    const body = req.body ?? {}
    if (body.resign === true) {
      // сдаться можно и не в свою очередь, поэтому очередь тут не проверяется
      resign(state)
      winnerId = opponentId
    } else {
      if (currentPlayer(state) !== side) return fail(res, 409, 'Не ваш ход')
      if (!isLegal(state, body.cell)) return fail(res, 400, 'Так ходить нельзя')
      applyMove(state, body.cell)
      if (state.outcome === 'win') winnerId = me
    }

    saveMoves(db, row.id, state.history, state.outcome, winnerId)

    // счётчики меняются ровно один раз: после конца партии сюда уже не попасть,
    // проверка outcome выше не пропустит
    if (state.outcome === 'draw') {
      addResult(db, me, 'draw')
      addResult(db, opponentId, 'draw')
    } else if (winnerId !== null) {
      addResult(db, winnerId, 'win')
      addResult(db, winnerId === me ? opponentId : me, 'loss')
    }

    res.json(gameView(findGame(db, row.id), me))
  })

  // GET /leaderboard это общий рейтинг, токен не нужен: таблицу видно и до входа
  app.get('/leaderboard', (req, res) => res.json(leaderboard(db)))

  // здесь в следующих задачах появятся остальные адреса API

  // обработчик ошибок стоит последним. У него четыре параметра, по этому Express
  // и отличает его от обычного обработчика. Express 5 сам ловит исключения в обработчиках
  // и приносит их сюда. Ошибку разбора JSON узнаём по err.type, остальное это 500,
  // а подробности печатаем только в консоль сервера
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Неверный формат запроса' })
    }
    console.error(err)
    res.status(500).json({ error: 'Ошибка сервера' })
  })

  return app
}

export { createApp }
