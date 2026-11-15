import { getProfile, logout } from './net.js'
import { loadAccount, clearAccount, clearOnlineId } from './storage.js'

// profile.js это страница профиля, profile.html. Она показывает вошедшему игроку его
// статистику и список его партий, а ещё тут кнопка "Выйти". Вход на этой странице не сделан:
// форма входа одна, на странице игры, а двух одинаковых форм не нужно. Если игрок не вошёл,
// страница показывает ссылку туда. Всё, что пришло с сервера, попадает на страницу через
// textContent и createElement, не через innerHTML: никнейм придумал другой человек.

// page это блок страницы с профилем
const page = document.querySelector('.profile')

// RESULT_WORDS это итог партии словом для списка "Мои партии". Цвет точки дублируется
// словом, потому что красный и зелёный легко спутать.
const RESULT_WORDS = { playing: 'идёт', win: 'победа', loss: 'поражение', draw: 'ничья' }

// renderProfile(profile, panel) показывает строку статистики и список "Мои партии" внутри
// блока panel. profile это ответ getProfile. Каждая партия это ссылка /?game=ID на страницу
// игры, поэтому до неё можно дойти клавишей Tab и открыть Enter. Идущую партию страница игры
// покажет живой, законченную повтором. В ссылке цветная точка, итог словом и описание вида
// "3x3, K=3, против masha, ходов: 7, 15.11.2026". Число из game.created это время
// в миллисекундах, браузер сам превращает его в дату.
// dot это точка, link это ссылка на партию, item это строка списка.
function renderProfile(profile, panel) {
  const stats = panel.querySelector('.stats')
  const list = panel.querySelector('.my-games')
  list.replaceChildren()

  stats.textContent = `Победы ${profile.wins}, ничьи ${profile.draws}, `
    + `поражения ${profile.losses}, очки ${profile.points}`

  for (const game of profile.games) {
    const dot = document.createElement('span')
    dot.className = `dot ${game.result}`

    const date = new Date(game.created).toLocaleDateString('ru-RU')
    const link = document.createElement('a')
    link.className = 'game-item'
    link.href = `/?game=${encodeURIComponent(game.id)}`
    link.append(dot, `${RESULT_WORDS[game.result]}, ${game.N}x${game.N}, K=${game.K}, `
      + `против ${game.opponent}, ходов: ${game.moves}, ${date}`)

    const item = document.createElement('li')
    item.append(link)
    list.append(item)
  }

  if (profile.games.length === 0) {
    const empty = document.createElement('li')
    empty.textContent = 'Партий пока нет'
    list.append(empty)
  }
}

// showError(text) пишет текст в строку ошибок под профилем, пустая строка её очищает
function showError(text) {
  page.querySelector('.profile-error').textContent = text
}

// showLoggedOut() показывает "Вы не вошли" и прячет данные профиля
function showLoggedOut() {
  page.querySelector('.logged-out').hidden = false
  page.querySelector('.account').hidden = true
}

// showProfile() загружает профиль и рисует его. Если игрок не вошёл, сервер не спрашиваем.
// 401 значит, что токен больше не годится, например базу удалили: забываем его и показываем
// "Вы не вошли". Остальные ошибки пишем в строку ошибок.
async function showProfile() {
  showError('')
  if (!loadAccount()) {
    showLoggedOut()
    return
  }

  try {
    const profile = await getProfile()
    page.querySelector('.logged-out').hidden = true
    page.querySelector('.account').hidden = false
    page.querySelector('.nickname').textContent = profile.nickname
    renderProfile(profile, page)
  } catch (error) {
    if (error.status === 401) {
      clearAccount()
      showLoggedOut()
      return
    }
    showError(error.message)
  }
}

// Выход. Если сервер не ответил, из учётной записи выходим всё равно: токен забывает браузер.
// ttt.online тоже забываем: партия на странице игры принадлежала этому игроку.
page.querySelector('.btn-logout').addEventListener('click', async () => {
  try {
    await logout()
  } catch {
    // сервер мог не ответить, из учётной записи выходим всё равно
  }
  clearAccount()
  clearOnlineId()
  showLoggedOut()
})

// pageshow по той же причине, что и на странице рейтинга: по кнопке "Назад" браузер может
// показать страницу из памяти без запуска скрипта, и после партии остался бы старый список
// с мигающей точкой у уже законченной партии
window.addEventListener('pageshow', showProfile)
