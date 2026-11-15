import { getLeaderboard } from './net.js'

// rating.js это страница рейтинга, rating.html. Она грузит таблицу с сервера и рисует её.
// Вход не нужен, рейтинг видят все. Страница не знает про партию и поле, ей нужен только
// блок .rating.

// panel это блок страницы с таблицей и пояснением под ней
const panel = document.querySelector('.rating')

// renderLeaderboard(rows, panel) рисует таблицу рейтинга на странице рейтинга.
// rows это список строк { nickname, wins, draws, losses, points } из getLeaderboard
// или null, если сервер не ответил. Таблица строится заново целиком, строк не больше
// двадцати. Вместо таблицы может быть пояснение: note это строка под ней.
// tr это строка таблицы, value это значение одной ячейки.
function renderLeaderboard(rows, panel) {
  const table = panel.querySelector('.leaderboard')
  const note = panel.querySelector('.leaderboard-note')
  const body = table.tBodies[0]
  body.replaceChildren()

  if (rows === null || rows.length === 0) {
    table.hidden = true
    note.hidden = false
    note.textContent = rows === null ? 'Рейтинг недоступен' : 'Пока никто не играл по сети'
    return
  }

  table.hidden = false
  note.hidden = true
  for (const row of rows) {
    const tr = body.insertRow()
    for (const value of [row.nickname, row.wins, row.draws, row.losses, row.points]) {
      tr.insertCell().textContent = value
    }
  }
}

// showRating() загружает рейтинг и рисует таблицу. Если сервер не ответил, вместо
// таблицы пишется "Рейтинг недоступен".
async function showRating() {
  try {
    renderLeaderboard(await getLeaderboard(), panel)
  } catch {
    renderLeaderboard(null, panel)
  }
}

// pageshow, а не загрузка один раз: по кнопке "Назад" браузер показывает страницу
// из памяти (bfcache), не запуская скрипт заново, и таблица осталась бы старой.
// pageshow срабатывает и при первой загрузке, и при таком возврате
window.addEventListener('pageshow', showRating)
