import express from 'express'
import { join } from 'node:path'

// app.js собирает приложение Express: раздаёт страницу и отвечает на адреса API.
// Правила игры не пишутся заново, а берутся из js/game.js, того же файла, что работает
// в браузере. Правила остаются в одном месте.

// root это папка src, server лежит внутри неё
const root = join(import.meta.dirname, '..')

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

  // здесь в следующих задачах появятся адреса API

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
