import express from 'express'
import { join } from 'node:path'
import { hashPassword, checkPassword, newToken } from './auth.js'
import {
  createUser, findUserByNickname, findUserByToken, saveToken, deleteToken,
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
