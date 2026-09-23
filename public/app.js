const KEYS = {
  earnings: 'shop-ledger-earnings',
  expenses: 'shop-ledger-expenses',
  settings: 'shop-ledger-settings',
}

const cache = {
  earnings: [],
  expenses: [],
  settings: { currency: 'Br', workDaysPerWeek: 6 },
}

const state = {
  tab: 'home',
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  historyFilter: 'all',
  toastTimer: 0,
  db: 'loading',
  dbError: '',
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function loadEarnings() {
  return cache.earnings
}

function loadExpenses() {
  return cache.expenses
}

function loadSettings() {
  return cache.settings
}

function setDbStatus(kind, label) {
  const el = document.getElementById('db-status')
  el.className = `db-status ${kind}`
  el.textContent = label
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'MongoDB request failed')
  }
  return data
}

async function refresh() {
  const data = await api('/api/data')
  cache.earnings = data.earnings || []
  cache.expenses = data.expenses || []
  cache.settings = {
    currency: 'Br',
    workDaysPerWeek: 6,
    ...(data.settings || {}),
  }
  if (cache.settings.currency === '$') cache.settings.currency = 'Br'
}

async function maybeMigrate() {
  if (cache.earnings.length || cache.expenses.length) return
  const earnings = readLocal(KEYS.earnings, [])
  const expenses = readLocal(KEYS.expenses, [])
  const settings = readLocal(KEYS.settings, null)
  if (!earnings.length && !expenses.length && !settings) return
  await api('/api/import', {
    method: 'POST',
    body: JSON.stringify({ earnings, expenses, settings }),
  })
  await refresh()
  flash('Moved old browser records into MongoDB')
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseISO(date) {
  return new Date(`${date}T12:00:00`)
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function prettyDate(date) {
  return parseISO(date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function inMonth(date, year, month) {
  const d = parseISO(date)
  return d.getFullYear() === year && d.getMonth() === month
}

function money(amount, symbol) {
  const formatted = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return amount < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`
}

const FORECAST_DAYS = 30

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function summarize() {
  const earnings = loadEarnings()
  const expenses = loadExpenses()
  const settings = loadSettings()
  const monthEarnings = earnings.filter((item) => inMonth(item.date, state.year, state.month))
  const monthExpenses = expenses.filter((item) => inMonth(item.date, state.year, state.month))
  const earned = monthEarnings.reduce((sum, item) => sum + item.amount, 0)
  const spent = monthExpenses.reduce((sum, item) => sum + item.amount, 0)
  const workDays = new Set(monthEarnings.map((item) => item.date)).size
  const spendDays = new Set(monthExpenses.map((item) => item.date)).size
  const avgPerWorkDay = workDays > 0 ? earned / workDays : 0
  const avgExpensePerDay = spendDays > 0 ? spent / spendDays : 0
  const expectedWorkDays = FORECAST_DAYS
  const forecast = avgPerWorkDay * FORECAST_DAYS
  const expenseForecast = avgExpensePerDay * FORECAST_DAYS
  const allDays = new Set(earnings.map((item) => item.date)).size
  const lifetimeAvg = allDays > 0 ? earnings.reduce((sum, item) => sum + item.amount, 0) / allDays : 0
  const allSpendDays = new Set(expenses.map((item) => item.date)).size
  const lifetimeExpenseAvg =
    allSpendDays > 0 ? expenses.reduce((sum, item) => sum + item.amount, 0) / allSpendDays : 0

  return {
    settings,
    monthEarnings,
    monthExpenses,
    earned,
    spent,
    net: earned - spent,
    workDays,
    spendDays,
    avgPerWorkDay,
    avgExpensePerDay,
    expectedWorkDays,
    forecast,
    expenseForecast,
    forecastNet: forecast - expenseForecast,
    lifetimeAvg,
    lifetimeExpenseAvg,
  }
}

function flash(message) {
  const toast = document.getElementById('toast')
  toast.textContent = message
  toast.classList.remove('hidden')
  window.clearTimeout(state.toastTimer)
  state.toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 2200)
}

function setTab(tab) {
  state.tab = tab
  if (location.hash !== `#${tab}`) {
    history.replaceState(null, '', `#${tab}`)
  }
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab)
  })
  render()
}

function shiftMonth(delta) {
  const date = new Date(state.year, state.month + delta, 1)
  state.year = date.getFullYear()
  state.month = date.getMonth()
  render()
}

function recentRows(summary) {
  return [
    ...summary.monthEarnings.map((item) => ({
      id: item.id,
      date: item.date,
      label: item.note || 'Day earning',
      amount: item.amount,
      kind: 'in',
    })),
    ...summary.monthExpenses.map((item) => ({
      id: item.id,
      date: item.date,
      label: item.note || item.category,
      amount: item.amount,
      kind: 'out',
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
}

function renderHome(summary) {
  const symbol = summary.settings.currency
  const recent = recentRows(summary)
  const payForecast =
    summary.workDays === 0
      ? `<p>Enter each day’s take-home to estimate pay for the full month.</p>`
      : `
        <p>
          You logged ${summary.workDays} work day${summary.workDays === 1 ? '' : 's'} this month.
          Average pay on those days is <b>${money(summary.avgPerWorkDay, symbol)}</b>.
        </p>
        <div class="forecast-grid">
          <div>
            <span>Average per work day</span>
            <b>${money(summary.avgPerWorkDay, symbol)}</b>
          </div>
          <div>
            <span>Pay forecast (30 days)</span>
            <b>${money(summary.forecast, symbol)}</b>
          </div>
        </div>
      `

  const expenseForecast =
    summary.spendDays === 0
      ? `<p>Enter what you buy to estimate expenses for the full month.</p>`
      : `
        <p>
          You logged spending on ${summary.spendDays} day${summary.spendDays === 1 ? '' : 's'} this month.
          Average spend on those days is <b>${money(summary.avgExpensePerDay, symbol)}</b>.
        </p>
        <div class="forecast-grid spend">
          <div>
            <span>Average expense per day</span>
            <b>${money(summary.avgExpensePerDay, symbol)}</b>
          </div>
          <div>
            <span>Expense forecast (30 days)</span>
            <b>${money(summary.expenseForecast, symbol)}</b>
          </div>
        </div>
      `

  const forecastBody = `
    <h4>Pay</h4>
    ${payForecast}
    <h4>Expenses</h4>
    ${expenseForecast}
    ${
      summary.workDays > 0 || summary.spendDays > 0
        ? `<div class="forecast-grid net">
            <div>
              <span>Forecast net after expenses</span>
              <b>${money(summary.forecastNet, symbol)}</b>
            </div>
          </div>
          <p class="hint">
            Forecast = daily average × 30 days
            ${summary.lifetimeAvg > 0 ? ` · All-time pay average ${money(summary.lifetimeAvg, symbol)}` : ''}
            ${summary.lifetimeExpenseAvg > 0 ? ` · All-time expense average ${money(summary.lifetimeExpenseAvg, symbol)}` : ''}.
          </p>`
        : ''
    }
  `

  const recentBody =
    recent.length === 0
      ? `<p class="empty">Nothing logged yet for this month.</p>`
      : `<div class="list">${recent
          .map(
            (item) => `
              <div class="row">
                <div>
                  <b>${escapeHtml(item.label)}</b>
                  <small>${prettyDate(item.date)}</small>
                </div>
                <div style="text-align:right">
                  <b class="${item.kind === 'in' ? 'plus' : 'minus'}">
                    ${item.kind === 'in' ? '+' : '-'}${money(item.amount, symbol)}
                  </b>
                  <div>
                    <button class="ghost-btn" type="button" data-delete="${item.kind}:${item.id}">Delete</button>
                  </div>
                </div>
              </div>
            `,
          )
          .join('')}</div>`

  return `
    <div class="month-nav">
      <button class="icon-btn" type="button" data-shift="-1">Prev</button>
      <h2>${monthLabel(state.year, state.month)}</h2>
      <button class="icon-btn" type="button" data-shift="1">Next</button>
    </div>
    <section class="hero-net">
      <span>Net after expenses</span>
      <strong>${money(summary.net, symbol)}</strong>
    </section>
    <section class="stats">
      <article class="card stat income">
        <label>Earned this month</label>
        <b>${money(summary.earned, symbol)}</b>
      </article>
      <article class="card stat expense">
        <label>Expenses this month</label>
        <b>${money(summary.spent, symbol)}</b>
      </article>
    </section>
    <section class="card forecast">
      <h3>Monthly average</h3>
      ${forecastBody}
    </section>
    <div class="quick-actions">
      <button type="button" data-go="pay">
        Add today’s pay
        <small>What you made today</small>
      </button>
      <button type="button" data-go="expense">
        Track an expense
        <small>What you bought for the shop</small>
      </button>
    </div>
    ${expenseBreakdown(summary, symbol)}
    <section class="card">
      <h3 class="section-title">Recent this month</h3>
      ${recentBody}
    </section>
  `
}

function expenseBreakdown(summary, symbol) {
  const groups = {}
  summary.monthExpenses.forEach((item) => {
    groups[item.category] = (groups[item.category] || 0) + item.amount
  })
  const rows = Object.entries(groups).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) return ''
  return `
    <section class="card forecast">
      <h3>Things bought</h3>
      <div class="list">
        ${rows
          .map(
            ([name, amount]) => `
              <div class="row">
                <b>${escapeHtml(name)}</b>
                <b class="minus">${money(amount, symbol)}</b>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `
}

function deletableList(items, kind, symbol) {
  if (!items.length) {
    return `<p class="empty">Nothing added yet. Save one above, then you can delete it here.</p>`
  }
  return `<div class="list">${[...items]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map((item) => {
      const label = kind === 'in' ? item.note || 'Day earning' : item.category || item.note || 'Expense'
      return `
        <div class="row">
          <div>
            <b>${escapeHtml(label)}</b>
            <small>${prettyDate(item.date)}</small>
          </div>
          <div style="text-align:right">
            <b class="${kind === 'in' ? 'plus' : 'minus'}">
              ${kind === 'in' ? '+' : '-'}${money(item.amount, symbol)}
            </b>
            <div>
              <button class="ghost-btn" type="button" data-delete="${kind}:${item.id}">Delete</button>
            </div>
          </div>
        </div>
      `
    })
    .join('')}</div>`
}

function renderPay(symbol) {
  return `
    <form class="card form" id="pay-form">
      <h2>Add a day’s earning</h2>
      <p class="hint">Put the money you took home that day. We will average it into the month.</p>
      <label class="field">
        <span>Date</span>
        <input name="date" type="date" value="${todayISO()}" required />
      </label>
      <label class="field">
        <span>Amount (${escapeHtml(symbol)})</span>
        <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required />
      </label>
      <label class="field">
        <span>Note (optional)</span>
        <input name="note" placeholder="Brake job, oil changes..." />
      </label>
      <button class="primary-btn" type="submit">Save day earning</button>
    </form>
    <section class="card">
      <h3 class="section-title">Days added</h3>
      ${deletableList(loadEarnings(), 'in', symbol)}
    </section>
  `
}

function renderExpense(symbol) {
  return `
    <form class="card form" id="expense-form">
      <h2>Track an expense</h2>
      <p class="hint">Shop costs come off the month total so you can see real take-home.</p>
      <label class="field">
        <span>Date</span>
        <input name="date" type="date" value="${todayISO()}" required />
      </label>
      <label class="field">
        <span>Amount (${escapeHtml(symbol)})</span>
        <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" required />
      </label>
      <label class="field">
        <span>Things bought</span>
        <input name="bought" required placeholder="Brake pads, diesel, sockets..." />
      </label>
      <label class="field">
        <span>Note (optional)</span>
        <input name="note" placeholder="Where you bought it, extra detail..." />
      </label>
      <button class="primary-btn" type="submit">Save expense</button>
    </form>
    <section class="card">
      <h3 class="section-title">Expenses added</h3>
      ${deletableList(loadExpenses(), 'out', symbol)}
    </section>
  `
}

function renderHistory(summary) {
  const symbol = summary.settings.currency
  const rows = [
    ...summary.monthEarnings.map((item) => ({
      ...item,
      kind: 'in',
      label: item.note || 'Day earning',
    })),
    ...summary.monthExpenses.map((item) => ({
      ...item,
      kind: 'out',
      label: item.note || item.category,
    })),
  ]
    .filter((item) => {
      if (state.historyFilter === 'pay') return item.kind === 'in'
      if (state.historyFilter === 'expense') return item.kind === 'out'
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const body =
    rows.length === 0
      ? `<p class="empty">No entries in this month yet.</p>`
      : `<div class="list">${rows
          .map(
            (item) => `
              <div class="row">
                <div>
                  <b>${escapeHtml(item.label)}</b>
                  <small>${prettyDate(item.date)}${item.category ? ` · ${escapeHtml(item.category)}` : ''}</small>
                </div>
                <div style="text-align:right">
                  <b class="${item.kind === 'in' ? 'plus' : 'minus'}">
                    ${item.kind === 'in' ? '+' : '-'}${money(item.amount, symbol)}
                  </b>
                  <div>
                    <button class="ghost-btn" type="button" data-delete="${item.kind}:${item.id}">Delete</button>
                  </div>
                </div>
              </div>
            `,
          )
          .join('')}</div>`

  return `
    <div class="month-nav">
      <button class="icon-btn" type="button" data-shift="-1">Prev</button>
      <h2>${monthLabel(state.year, state.month)}</h2>
      <button class="icon-btn" type="button" data-shift="1">Next</button>
    </div>
    <section class="card">
      <h2>History</h2>
      <div class="filters">
        <button type="button" data-filter="all" class="${state.historyFilter === 'all' ? 'active' : ''}">All</button>
        <button type="button" data-filter="pay" class="${state.historyFilter === 'pay' ? 'active' : ''}">Pay</button>
        <button type="button" data-filter="expense" class="${state.historyFilter === 'expense' ? 'active' : ''}">Expenses</button>
      </div>
      ${body}
    </section>
  `
}

function renderSetup() {
  return `
    <section class="card form">
      <h2>Database not connected</h2>
      <p class="hint">
        Beki Ledger reads MongoDB Atlas from the server. On Netlify, add
        <b>MONGODB_URI</b> and <b>MONGODB_DB</b> in Site configuration → Environment variables, then redeploy.
      </p>
      ${state.dbError ? `<div class="toast" style="background:#fdecea;color:#b42318">${escapeHtml(state.dbError)}</div>` : ''}
    </section>
  `
}

function render() {
  const view = document.getElementById('view')
  if (state.db === 'loading') {
    view.innerHTML = `<section class="card"><p class="hint">Connecting to MongoDB Atlas...</p></section>`
    return
  }
  if (state.db !== 'ready') {
    view.innerHTML = renderSetup()
    return
  }
  const summary = summarize()
  if (state.tab === 'home') view.innerHTML = renderHome(summary)
  if (state.tab === 'pay') view.innerHTML = renderPay(summary.settings.currency)
  if (state.tab === 'expense') view.innerHTML = renderExpense(summary.settings.currency)
  if (state.tab === 'history') view.innerHTML = renderHistory(summary)
}

async function addEarning(item) {
  const record = { ...item, id: newId() }
  await api('/api/earnings', { method: 'POST', body: JSON.stringify(record) })
  cache.earnings = [record, ...cache.earnings]
}

async function addExpense(item) {
  const record = { ...item, id: newId() }
  await api('/api/expenses', { method: 'POST', body: JSON.stringify(record) })
  cache.expenses = [record, ...cache.expenses]
}

let pendingDelete = null

function findEntry(kind, id) {
  const list = kind === 'in' ? loadEarnings() : loadExpenses()
  return list.find((item) => item.id === id)
}

function askDelete(kind, id) {
  const item = findEntry(kind, id)
  if (!item) return
  pendingDelete = { kind, id }
  const symbol = loadSettings().currency
  const label = kind === 'in' ? item.note || 'Day earning' : item.category || item.note || 'Expense'
  const what = kind === 'in' ? 'pay day' : 'expense'
  document.getElementById('confirm-text').textContent =
    `Delete this ${what}: ${label} · ${prettyDate(item.date)} · ${money(item.amount, symbol)}? This cannot be undone.`
  document.getElementById('confirm-modal').classList.remove('hidden')
}

function closeConfirm() {
  pendingDelete = null
  document.getElementById('confirm-modal').classList.add('hidden')
}

async function removeItem(kind, id) {
  try {
    if (kind === 'in') {
      await api(`/api/earnings/${encodeURIComponent(id)}`, { method: 'DELETE' })
      cache.earnings = cache.earnings.filter((item) => item.id !== id)
    } else {
      await api(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' })
      cache.expenses = cache.expenses.filter((item) => item.id !== id)
    }
    flash('Entry deleted')
    render()
  } catch (error) {
    flash(error.message)
  }
}

document.getElementById('view').addEventListener('click', (event) => {
  const shift = event.target.closest('[data-shift]')
  if (shift) shiftMonth(Number(shift.dataset.shift))

  const go = event.target.closest('[data-go]')
  if (go) setTab(go.dataset.go)

  const filter = event.target.closest('[data-filter]')
  if (filter) {
    state.historyFilter = filter.dataset.filter
    render()
  }

  const del = event.target.closest('[data-delete]')
  if (del) {
    const [kind, id] = del.dataset.delete.split(':')
    askDelete(kind, id)
  }
})

document.getElementById('view').addEventListener('submit', (event) => {
  event.preventDefault()
  const form = event.target
  const data = new FormData(form)
  const amount = Number(data.get('amount'))
  const date = String(data.get('date') || '')
  const note = String(data.get('note') || '').trim()
  if (!date || !Number.isFinite(amount) || amount <= 0) return

  if (form.id === 'pay-form') {
    addEarning({ date, amount, note })
      .then(() => {
        flash('Day earning saved to MongoDB')
        render()
      })
      .catch((error) => flash(error.message))
  }

  if (form.id === 'expense-form') {
    addExpense({
      date,
      amount,
      note,
      category: String(data.get('bought') || '').trim() || 'Stuff',
    })
      .then(() => {
        flash('Expense saved to MongoDB')
        render()
      })
      .catch((error) => flash(error.message))
  }
})

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => setTab(button.dataset.tab))
})

const settingsModal = document.getElementById('settings-modal')

function openSettings() {
  const settings = loadSettings()
  document.getElementById('setting-currency').value = settings.currency
  document.getElementById('setting-days').value = String(settings.workDaysPerWeek)
  settingsModal.classList.remove('hidden')
}

function closeSettings() {
  settingsModal.classList.add('hidden')
}

document.querySelector('[data-open-settings]').addEventListener('click', openSettings)
document.querySelector('[data-close-settings]').addEventListener('click', closeSettings)
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettings()
})

const confirmModal = document.getElementById('confirm-modal')
document.getElementById('confirm-cancel').addEventListener('click', closeConfirm)
document.getElementById('confirm-ok').addEventListener('click', () => {
  const pending = pendingDelete
  closeConfirm()
  if (pending) removeItem(pending.kind, pending.id)
})
confirmModal.addEventListener('click', (event) => {
  if (event.target === confirmModal) closeConfirm()
})

document.getElementById('settings-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const days = Number(document.getElementById('setting-days').value)
  const settings = {
    currency: document.getElementById('setting-currency').value.trim() || 'Br',
    workDaysPerWeek: days >= 5 && days <= 7 ? days : 6,
  }
  api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
    .then((saved) => {
      cache.settings = { ...cache.settings, ...saved }
      closeSettings()
      flash('Settings saved to MongoDB')
      render()
    })
    .catch((error) => flash(error.message))
})

document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          earnings: loadEarnings(),
          expenses: loadExpenses(),
          settings: loadSettings(),
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'beki-ledger-backup.json'
  link.click()
  URL.revokeObjectURL(url)
})

window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#', '')
  if (['home', 'pay', 'expense', 'history'].includes(tab) && tab !== state.tab) {
    setTab(tab)
  }
})

const startTab = location.hash.replace('#', '')
if (['home', 'pay', 'expense', 'history'].includes(startTab)) {
  state.tab = startTab
}

document.querySelectorAll('.tabs button').forEach((button) => {
  button.classList.toggle('active', button.dataset.tab === state.tab)
})

document.getElementById('import-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  file.text().then(async (text) => {
    try {
      const data = JSON.parse(text)
      await api('/api/import', { method: 'POST', body: JSON.stringify(data) })
      await refresh()
      closeSettings()
      flash('Backup restored to MongoDB')
      render()
    } catch (error) {
      flash(error.message)
    }
  })
})

async function boot() {
  try {
    const health = await api('/api/health')
    if (!health.connected) {
      state.db = 'setup'
      state.dbError = health.error || ''
      setDbStatus('bad', 'Setup MongoDB')
      render()
      return
    }
    await refresh()
    await maybeMigrate()
    if (cache.settings.currency === 'Br') {
      api('/api/settings', { method: 'PUT', body: JSON.stringify(cache.settings) }).catch(() => {})
    }
    state.db = 'ready'
    setDbStatus('ok', `MongoDB · ${health.database}`)
    render()
  } catch (error) {
    state.db = 'setup'
    state.dbError = error.message
    setDbStatus('bad', 'Server offline')
    render()
  }
}

boot()
