const rows = [
  ['№4', '09.09.2026 19:39', 'Стол 1', 'Терраса', 'Айсулуу', '2 740 с', 'Готовится', 'orange', '—', true],
  ['№3', '09.09.2026 18:56', 'Стол 3', 'Терраса', 'Айсулуу', '1 330 с', 'Отправлен на кухню', 'orange', '—', true],
  ['№2', '09.09.2026 18:35', 'Стол 1', 'Зал', 'Айсулуу', '2 370 с', 'Подан гостям', 'orange', '—', true],
  ['№1', '09.09.2026 18:27', 'Стол 3', 'Терраса', 'Айсулуу', '1 710 с', 'Оплачен', 'green', 'Смешанная (500 с / 1 210 с)', false],
  ['№3', '01.09.2026 22:43', 'Стол 4', 'Терраса', 'Айсулуу', '1 530 с', 'Оплачен', 'green', 'Смешанная (500 с / 1 030 с)', false],
  ['№2', '01.09.2026 22:42', 'Стол 7', 'Терраса', 'Айсулуу', '2 930 с', 'Отправлен на кухню', 'orange', '—', true],
  ['№1', '01.09.2026 22:41', 'Стол 3', 'Терраса', 'Айсулуу', '0 с', 'Отказан', 'red', '—', false],
  ['№2', '17.08.2026 00:55', 'Стол 2', 'Терраса', 'Айсулуу', '2 470 с', 'Оплачен', 'green', 'Смешанная (1 500 с / 970 с)', false],
  ['№1', '17.08.2026 00:53', 'Стол 6', 'Терраса', 'Айсулуу', '1 530 с', 'Оплачен', 'green', 'Смешанная (340 с / 1 190 с)', false],
  ['№4', '16.08.2026 02:45', 'Стол 6', 'Терраса', 'Айсулуу', '1 240 с', 'Оплачен', 'green', 'Смешанная (500 с / 740 с)', false],
  ['№3', '16.08.2026 02:27', 'Стол 8', 'Терраса', 'Айсулуу', '1 340 с', 'Ожидает оплаты', 'purple', '—', true],
];

const paths = {
  chart: '<path d="M3 3v18h18M7 14l3-3 3 3 5-6"/>',
  order: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  warehouse: '<path d="M3 21V8l9-5 9 5v13M3 21h18M8 13h8v8H8zM8 17h8"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3.5 3.5-5.5 7-5.5s7 2 7 5.5M17 8a3 3 0 0 1 0 6M22 21c0-2.5-1.5-4.2-3.5-5"/>',
  journal: '<path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Z"/><path d="M4 5a2 2 0 0 0 2 2h12M8 11h7M8 15h5"/>',
  check: '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.51 1.82 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.62.78 1.05 1.43 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M7 15h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  sort: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }

const ui = {
  period: 'all',
  menu: document.body.dataset.screen === 'period',
  calendar: document.body.dataset.screen === 'calendar',
  month: 9,
  year: 2026,
  date: document.body.dataset.screen === 'calendar' ? '2026-10-09' : '',
  typed: '',
  search: '',
};
if (ui.calendar) ui.period = 'custom';

const options = [['all', 'Всё время'], ['today', 'Сегодня'], ['week', 'За неделю'], ['month', 'За месяц'], ['custom', 'Выбрать дату']];
const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const pad = value => String(value).padStart(2, '0');
const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function calendar() {
  const first = new Date(ui.year, ui.month, 1);
  const leading = (first.getDay() + 6) % 7;
  const count = Math.ceil((leading + new Date(ui.year, ui.month + 1, 0).getDate()) / 7) * 7;
  const cells = Array.from({ length: count }, (_, i) => new Date(ui.year, ui.month, i - leading + 1));
  return `<div class="orders-calendar preview-calendar" role="dialog" aria-label="Выбрать дату">
    <div class="orders-calendar-header"><strong>${monthNames[ui.month]} ${ui.year} г.</strong><div class="orders-calendar-nav"><button data-action="prev" aria-label="Предыдущий месяц">${icon('left')}</button><button data-action="next" aria-label="Следующий месяц" style="transform:rotate(180deg)">${icon('left')}</button></div></div>
    <div class="orders-calendar-grid">${['пн','вт','ср','чт','пт','сб','вс'].map(d => `<span class="orders-calendar-weekday">${d}</span>`).join('')}${cells.map(cell => `<button data-date="${iso(cell)}" class="${cell.getMonth() === ui.month ? '' : 'is-outside'} ${ui.date === iso(cell) ? 'is-selected' : ''}">${cell.getDate()}</button>`).join('')}</div>
    <div class="orders-calendar-footer"><button data-action="clear">Очистить</button><button data-action="today">Сегодня</button></div></div>`;
}
function periodFilter() {
  const label = options.find(item => item[0] === ui.period)[1];
  return `<div class="orders-date-filter ${ui.period === 'custom' ? 'is-custom' : ''}"><div class="orders-period-wrap"><button class="orders-filter-control orders-period-trigger ${ui.menu ? 'is-open' : ''}" data-action="period">${icon('calendar')}<span>${label}</span>${icon('down')}</button>
    ${ui.menu ? `<div class="orders-period-menu" role="listbox">${options.map(([value, text]) => `<button data-period="${value}" role="option" aria-selected="${ui.period === value}" class="${ui.period === value ? 'is-selected' : ''}"><span>${text}</span>${ui.period === value ? icon('check') : ''}</button>`).join('')}</div>` : ''}</div>
    ${ui.period === 'custom' ? `<div class="orders-date-input-wrap"><input class="orders-filter-control orders-date-input ${ui.calendar ? 'is-open' : ''}" value="${ui.typed}" placeholder="ДД.ММ.ГГГГ" aria-label="Выбрать дату"><button class="orders-date-input-icon" data-action="calendar" aria-label="Открыть календарь">${icon('calendar')}</button>${ui.calendar ? calendar() : ''}</div>` : ''}</div>`;
}
function filterSelect(label, iconName, cls) { return `<button class="orders-filter-control preview-select ${cls}" type="button">${icon(iconName)}<span>${label}</span>${icon('down')}</button>`; }
function row(item) {
  const [number, date, table, hall, waiter, amount, status, tone, payment, cancellable] = item;
  return `<tr class="orders-table-row"><td class="number">${number}</td><td>${date}</td><td class="table-table">${table}<br>${hall}</td><td>${waiter}</td><td class="amount">${amount}</td><td><span class="preview-badge ${tone}">${status}</span></td><td>${payment}</td><td class="actions"><div class="preview-action-group"><button aria-label="Изменить статус">${icon('edit')}</button>${cancellable ? `<button aria-label="Отменить">${icon('x')}</button>` : ''}</div></td></tr>`;
}
function render() {
  const nav = [['chart','Статистика'], ['order','Заказы'], ['grid','Столы'], ['menu','Меню'], ['warehouse','Склад'], ['staff','Персонал'], ['journal','Журнал'], ['check','Сверка оплат'], ['settings','Настройки']];
  document.getElementById('preview').innerHTML = `<div class="preview-shell orders-shell"><aside class="preview-sidebar"><div class="preview-logo">ED<span>U</span> POS</div><nav class="preview-nav">${nav.map(([symbol, label]) => `<button class="${label === 'Заказы' ? 'active' : ''}">${icon(symbol)}${label}</button>`).join('')}</nav><div class="preview-sidebar-bottom"><button class="preview-exit">${icon('logout')}Выйти</button><div class="preview-version">v6.32 · 25.09.2026 01:02</div></div></aside>
  <div class="preview-main"><header class="preview-header"><h1>Заказы</h1><div class="preview-online">Онлайн</div></header><main class="preview-content"><div class="orders-redesign">
  <div class="orders-summary"><span>Всего заказов: <span>13</span></span><span class="orders-summary-separator"></span><span>Оплачено: <span>6</span></span><span class="orders-summary-separator"></span><span>Не оплачено: <span>6</span></span><span class="orders-summary-separator"></span><span>Отменено: <span>1</span></span><span class="orders-summary-separator"></span><span>Выручка: <span>9 690 с</span></span></div>
  <div class="orders-filters">${filterSelect('Все статусы','check','orders-status-select')}${filterSelect('Все способы оплаты','cash','orders-payment-select')}${filterSelect('Все официанты','staff','orders-waiter-select')}${periodFilter()}${filterSelect('По умолчанию','sort','orders-sort-select')}<div class="orders-search-wrap preview-search">${icon('search')}<input class="orders-filter-control orders-search-input" placeholder="Поиск по заказам..." value="${ui.search}"></div></div>
  <div class="orders-table-card preview-table-wrap"><table class="orders-table"><thead><tr><th>№ заказа ↓</th><th>Дата и время</th><th>Стол</th><th>Официант</th><th class="amount">Сумма</th><th>Статус заказа</th><th>Способ оплаты</th><th class="actions">Действия</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div></div></main></div>
  <button class="preview-fab" aria-label="Рация"><img src="../../frontend/public/рация.png" alt=""></button></div>`;
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', action));
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    ui.period = button.dataset.period;
    ui.menu = false;
    ui.calendar = ui.period === 'custom';
    render();
  }));
  document.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
    ui.date = button.dataset.date;
    const [year, month, day] = ui.date.split('-');
    ui.typed = `${day}.${month}.${year}`;
    ui.calendar = false;
    render();
  }));
  document.querySelector('.orders-date-input')?.addEventListener('input', event => {
    ui.typed = event.target.value;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(ui.typed)) {
      const [day, month, year] = ui.typed.split('.');
      const selected = new Date(Number(year), Number(month) - 1, Number(day));
      if (selected.getDate() === Number(day) && selected.getMonth() + 1 === Number(month)) {
        ui.date = iso(selected);
        ui.month = selected.getMonth();
        ui.year = selected.getFullYear();
      }
    }
  });
  document.querySelector('.orders-search-input').addEventListener('input', event => { ui.search = event.target.value; });
}
function action(event) {
  switch (event.currentTarget.dataset.action) {
    case 'period': ui.menu = !ui.menu; ui.calendar = false; break;
    case 'calendar': ui.calendar = !ui.calendar; ui.menu = false; break;
    case 'prev': case 'next': {
      const delta = event.currentTarget.dataset.action === 'next' ? 1 : -1;
      const next = new Date(ui.year, ui.month + delta, 1);
      ui.year = next.getFullYear(); ui.month = next.getMonth(); break;
    }
    case 'clear': ui.date = ''; ui.typed = ''; ui.calendar = false; break;
    case 'today': {
      const today = new Date(); ui.date = iso(today); ui.typed = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`; ui.calendar = false; break;
    }
  }
  render();
}
render();
