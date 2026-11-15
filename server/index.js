import { join } from 'node:path'
import { openDb } from './db.js'
import { createApp } from './app.js'

// index.js запускает сервер: npm start. Порт берётся из переменной окружения PORT,
// если её нет, то 3000. База лежит в server/ttt.db и создаётся при первом запуске.
// port это номер порта, db это открытая база.
const port = Number(process.env.PORT ?? 3000)
const db = openDb(join(import.meta.dirname, 'ttt.db'))

createApp(db).listen(port, () => {
  console.log(`Сервер запущен: http://localhost:${port}/`)
})
