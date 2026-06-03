import './styles.css';

const STORAGE_KEY = 'gulu-water-state-v1';
const REMINDER_STORAGE_KEY = 'gulu-water-reminder-v1';
const DEFAULT_STATE = {
  target: 2000,
  interval: 60,
  notificationsEnabled: false,
  entries: []
};

let state = loadState();
let deferredPrompt = null;
let reminderTimer = null;

const app = document.querySelector('#app');

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallView();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  updateInstallView();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshReminder();
  }
});

init();

async function init() {
  await registerServiceWorker();
  pruneEntries();
  refreshReminder();
  render();
}

function todayAt(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...DEFAULT_STATE, ...saved, entries: saved.entries ?? [] } : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pruneEntries() {
  const today = new Date().toDateString();
  const entries = state.entries.filter((entry) => new Date(entry.createdAt).toDateString() === today);
  if (entries.length !== state.entries.length) {
    state = { ...state, entries };
    saveState();
  }
}

function totalIntake() {
  return state.entries.reduce((sum, entry) => sum + entry.amount, 0);
}

function progressRatio() {
  return Math.min(totalIntake() / state.target, 1);
}

function statusMessage() {
  const remaining = Math.max(state.target - totalIntake(), 0);
  if (remaining === 0) return '今日达标啦，继续保持轻盈状态！';
  if (remaining <= 350) return `还差 ${remaining}ml，马上就完成啦！`;
  return `还差 ${remaining}ml，继续加油呀！`;
}

function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function canInstall() {
  return Boolean(deferredPrompt);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

async function askNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('当前浏览器不支持系统通知');
    return;
  }
  const permission = await Notification.requestPermission();
  state = { ...state, notificationsEnabled: permission === 'granted' };
  saveState();
  refreshReminder();
  if (permission === 'granted') {
    notify('咕噜喝水已开启', '我会按你设置的间隔提醒你喝水。');
  } else {
    showToast('通知未开启，可以稍后再试');
  }
  updateNotificationView();
}

async function notify(title, body) {
  if (getNotificationPermission() !== 'granted') return;
  const registration = await navigator.serviceWorker?.ready?.catch(() => null);
  if (registration?.showNotification) {
    registration.showNotification(title, {
      body,
      icon: '/icons/icon.svg',
      badge: '/icons/badge.svg',
      tag: 'gulu-water-reminder',
      renotify: true,
      data: { url: '/' }
    });
    return;
  }
  new Notification(title, { body, icon: '/icons/icon.svg' });
}

function refreshReminder() {
  clearTimeout(reminderTimer);
  const permission = getNotificationPermission();
  if (!state.notificationsEnabled || permission !== 'granted') return;

  const now = Date.now();
  const saved = JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY) || 'null');
  const nextAt = saved?.nextAt && saved.nextAt > now ? saved.nextAt : now + state.interval * 60_000;
  localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify({ nextAt }));

  reminderTimer = setTimeout(() => {
    notify('该喝水啦', `${state.interval} 分钟到了，来一杯温柔补水。`);
    localStorage.setItem(
      REMINDER_STORAGE_KEY,
      JSON.stringify({ nextAt: Date.now() + state.interval * 60_000 })
    );
    refreshReminder();
  }, Math.max(nextAt - now, 1000));
}

function addWater(amount, label = smartLabel()) {
  const now = new Date();
  const entry = {
    id: crypto.randomUUID(),
    amount,
    label,
    time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    createdAt: now.toISOString()
  };
  state = {
    ...state,
    entries: [entry, ...state.entries].slice(0, 24)
  };
  saveState();
  showToast(`已添加 ${amount}ml`);
  updateWaterView({ highlightedEntryId: entry.id });
}

function smartLabel() {
  const hour = new Date().getHours();
  if (hour < 10) return '晨间补水';
  if (hour < 14) return '午间补水';
  if (hour < 18) return '下午补水';
  return '晚间补水';
}

async function installApp() {
  if (isStandalone()) {
    showToast('已经在桌面模式中运行');
    return;
  }
  if (!deferredPrompt) {
    showToast('浏览器暂未提供安装入口，可用地址栏安装按钮');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  updateInstallView();
}

function setIntervalMinutes(minutes) {
  state = { ...state, interval: minutes };
  saveState();
  localStorage.removeItem(REMINDER_STORAGE_KEY);
  refreshReminder();
  updateIntervalView();
  updateNotificationView();
}

function updateTarget(value) {
  const target = Math.max(500, Math.min(Number(value) || 2000, 5000));
  state = { ...state, target };
  saveState();
  updateWaterView();
}

function removeEntry(id) {
  state = { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
  saveState();
  updateWaterView();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 220);
  }, 1800);
}

function render() {
  const total = totalIntake();
  const ratio = progressRatio();
  const remaining = Math.max(state.target - total, 0);
  const notificationView = getNotificationViewState();
  const installView = getInstallViewState();

  app.innerHTML = `
    <main class="app-shell" aria-label="咕噜喝水应用">
      <section class="phone-frame">
        <header class="topbar">
          <button class="icon-button" type="button" aria-label="打开菜单">
            ${icon('menu')}
          </button>
          <div class="brand">
            <span>咕噜喝水</span>
            <span class="brand-drop" aria-hidden="true">${dropMascot('small')}</span>
          </div>
          <button class="icon-button" type="button" aria-label="设置">
            ${icon('settings')}
          </button>
        </header>

        <section class="target-card" aria-labelledby="target-title">
          <div>
            <p id="target-title" class="section-label">今日目标</p>
            <label class="target-input">
              <input type="number" min="500" max="5000" step="50" value="${state.target}" aria-label="今日目标毫升" data-action="target" />
              <span>ml</span>
            </label>
          </div>
          <span class="hint-chip">${icon('spark')} 目标建议</span>
        </section>

        <section class="progress-zone" aria-label="今日喝水进度" data-live="progress-zone">
          <div class="progress-ring" style="--progress:${ratio}" data-live="progress-ring">
            <div class="progress-track">
              <div class="mascot" aria-hidden="true">${dropMascot('large')}</div>
            </div>
          </div>
          <div class="progress-copy">
            <span>已喝 <strong data-live="total">${total}</strong> ml</span>
            <small data-live="percent">${Math.round(ratio * 100)}%</small>
          </div>
          <div class="speech" data-live="speech">${statusMessage()}</div>
        </section>

        <section class="quick-add" aria-labelledby="add-title">
          <div class="section-heading">
            <h2 id="add-title">添加饮水</h2>
          </div>
          <div class="amount-grid">
            ${[150, 250, 350].map((amount) => `
              <button class="amount-button amount-button--${amount}" type="button" data-action="add" data-amount="${amount}">
                ${icon('cup')}
                <span>${amount}ml</span>
              </button>
            `).join('')}
            <button class="amount-button amount-button--custom" type="button" data-action="custom">
              ${icon('plus')}
              <span>自定义</span>
            </button>
          </div>
        </section>

        <section class="control-card" aria-labelledby="interval-title">
          <div class="control-title">
            ${icon('clock')}
            <h2 id="interval-title">提醒间隔</h2>
          </div>
          <div class="segmented" role="group" aria-label="提醒间隔" data-live="interval-group">
            ${[30, 60, 90, 120].map((minutes) => `
              <button type="button" class="${state.interval === minutes ? 'is-active' : ''}" data-action="interval" data-minutes="${minutes}">
                ${minutes}分钟
              </button>
            `).join('')}
          </div>
        </section>

        <section class="status-card" aria-labelledby="notify-title" data-live="notification-card">
          <div class="status-main">
            <div class="status-icon status-icon--coral">${icon('bell')}</div>
            <div>
              <h2 id="notify-title">通知提醒</h2>
              <p data-live="notification-description">${notificationView.description}</p>
            </div>
            <button class="primary-button" type="button" data-action="notify" ${notificationView.blocked ? 'disabled' : ''}>
              <span data-live="notification-button-label">${notificationView.buttonLabel}</span> ${icon('chevron')}
            </button>
          </div>
          <div class="meta-row">
            <span data-live="notification-meta">${icon(notificationView.ready ? 'check' : 'info')} ${notificationView.meta}</span>
            <span data-live="notification-next">下次提醒：${notificationView.ready ? formatNextReminder() : '--:--'}</span>
          </div>
        </section>

        <section class="status-card" aria-labelledby="install-title" data-live="install-card">
          <div class="status-main">
            <div class="status-icon status-icon--blue">${icon('download')}</div>
            <div>
              <h2 id="install-title">安装到桌面</h2>
              <p data-live="install-description">${installView.description}</p>
            </div>
            <button class="secondary-button" type="button" data-action="install">
              <span data-live="install-button-label">${installView.buttonLabel}</span> ${icon('chevron')}
            </button>
          </div>
          <div class="meta-row">
            <span>${icon('check')} PWA 已就绪，支持离线使用</span>
            <span data-live="install-meta">${installView.meta}</span>
          </div>
        </section>

        <section class="history" aria-labelledby="history-title">
          <div class="section-heading">
            <h2 id="history-title">${dropMascot('tiny')} 今日记录</h2>
            <span data-live="history-total">总计 ${total} ml</span>
          </div>
          <div class="history-list" data-live="history-list">
            ${renderHistoryList()}
          </div>
        </section>

        <nav class="bottom-nav" aria-label="底部导航">
          <button class="nav-item is-active" type="button">${icon('drop')}<span>首页</span></button>
          <button class="nav-item" type="button">${icon('chart')}<span>统计</span></button>
          <button class="nav-action" type="button" data-action="add" data-amount="250" aria-label="快速添加 250ml">${dropMascot('small')}<span>${icon('plus')}</span></button>
          <button class="nav-item" type="button">${icon('user')}<span>我的</span></button>
        </nav>
      </section>
      <aside class="desktop-note" aria-label="桌面预览信息">
        <div class="desktop-card">
          ${dropMascot('large')}
          <h2>喝水提醒，轻轻咕噜一下</h2>
          <p>移动端可安装为 PWA；桌面端保留同样的提醒、记录和离线能力。</p>
        </div>
      </aside>
    </main>
  `;

  bindEvents();
}

function updateWaterView({ highlightedEntryId } = {}) {
  const total = totalIntake();
  const ratio = progressRatio();
  const ring = app.querySelector('[data-live="progress-ring"]');
  const totalValue = app.querySelector('[data-live="total"]');
  const percent = app.querySelector('[data-live="percent"]');
  const speech = app.querySelector('[data-live="speech"]');
  const historyTotal = app.querySelector('[data-live="history-total"]');
  const historyList = app.querySelector('[data-live="history-list"]');

  if (!ring || !totalValue || !percent || !speech || !historyTotal || !historyList) {
    render();
    return;
  }

  ring.style.setProperty('--progress', ratio);
  restartAnimation(ring, 'progress-ring--bump');
  totalValue.textContent = total;
  percent.textContent = `${Math.round(ratio * 100)}%`;
  speech.textContent = statusMessage();
  historyTotal.textContent = `总计 ${total} ml`;
  historyList.innerHTML = renderHistoryList(highlightedEntryId);
  bindHistoryEvents();
}

function updateIntervalView() {
  const intervalGroup = app.querySelector('[data-live="interval-group"]');
  if (!intervalGroup) {
    render();
    return;
  }

  intervalGroup.querySelectorAll('[data-action="interval"]').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.minutes) === state.interval);
  });
}

function updateNotificationView() {
  const notificationView = getNotificationViewState();
  const description = app.querySelector('[data-live="notification-description"]');
  const button = app.querySelector('[data-action="notify"]');
  const buttonLabel = app.querySelector('[data-live="notification-button-label"]');
  const meta = app.querySelector('[data-live="notification-meta"]');
  const next = app.querySelector('[data-live="notification-next"]');

  if (!description || !button || !buttonLabel || !meta || !next) {
    render();
    return;
  }

  description.textContent = notificationView.description;
  button.disabled = notificationView.blocked;
  buttonLabel.textContent = notificationView.buttonLabel;
  meta.innerHTML = `${icon(notificationView.ready ? 'check' : 'info')} ${notificationView.meta}`;
  next.textContent = `下次提醒：${notificationView.ready ? formatNextReminder() : '--:--'}`;
}

function updateInstallView() {
  const installView = getInstallViewState();
  const description = app.querySelector('[data-live="install-description"]');
  const buttonLabel = app.querySelector('[data-live="install-button-label"]');
  const meta = app.querySelector('[data-live="install-meta"]');

  if (!description || !buttonLabel || !meta) {
    render();
    return;
  }

  description.textContent = installView.description;
  buttonLabel.textContent = installView.buttonLabel;
  meta.textContent = installView.meta;
}

function getNotificationViewState() {
  const permission = getNotificationPermission();
  const ready = state.notificationsEnabled && permission === 'granted';
  const blocked = permission === 'denied' || permission === 'unsupported';

  return {
    ready,
    blocked,
    description: ready
      ? '准时提醒，不错过每一杯水'
      : permission === 'denied'
        ? '浏览器已拒绝，请到系统设置中开启'
        : permission === 'unsupported'
          ? '当前浏览器不支持系统通知'
          : '开启后按间隔发送系统提醒',
    meta: ready
      ? '已授权'
      : permission === 'denied'
        ? '已拒绝'
        : permission === 'unsupported'
          ? '不支持通知'
          : '等待授权',
    buttonLabel: ready
      ? '已开启'
      : permission === 'denied'
        ? '需到设置'
        : permission === 'unsupported'
          ? '不支持'
          : '开启通知'
  };
}

function getInstallViewState() {
  const standalone = isStandalone();

  return {
    description: standalone ? '已用桌面应用模式打开' : '一键安装，离线也能打开',
    buttonLabel: standalone ? '已安装' : '安装到桌面',
    meta: canInstall() || standalone ? '可安装' : '待浏览器触发'
  };
}

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function renderHistoryList(highlightedEntryId) {
  if (!state.entries.length) {
    return `
      <div class="empty-state">
        ${dropMascot('small')}
        <p>今天还没有记录，先喝第一杯吧。</p>
      </div>
    `;
  }

  return state.entries.map((entry) => `
    <button class="history-row ${entry.id === highlightedEntryId ? 'history-row--new' : ''}" type="button" data-action="remove" data-id="${entry.id}" aria-label="删除 ${entry.time} ${entry.amount}ml 记录">
      <span class="timeline-dot"></span>
      <span class="history-time">${entry.time}</span>
      <span class="history-amount">${icon('cup')} ${entry.amount}ml</span>
      <span class="history-label">${entry.label}</span>
      ${icon('chevron')}
    </button>
  `).join('');
}

function bindEvents() {
  app.querySelectorAll('[data-action="add"]').forEach((button) => {
    button.addEventListener('click', () => addWater(Number(button.dataset.amount)));
  });
  app.querySelector('[data-action="custom"]')?.addEventListener('click', () => {
    const input = window.prompt('输入饮水量 ml', '200');
    if (input !== null) addWater(Math.max(50, Math.min(Number(input) || 200, 1000)), '自定义');
  });
  app.querySelectorAll('[data-action="interval"]').forEach((button) => {
    button.addEventListener('click', () => setIntervalMinutes(Number(button.dataset.minutes)));
  });
  app.querySelector('[data-action="notify"]')?.addEventListener('click', askNotificationPermission);
  app.querySelector('[data-action="install"]')?.addEventListener('click', installApp);
  const targetInput = app.querySelector('[data-action="target"]');
  targetInput?.addEventListener('input', (event) => updateTarget(event.target.value));
  targetInput?.addEventListener('change', (event) => updateTarget(event.target.value));
  bindHistoryEvents();
}

function bindHistoryEvents() {
  app.querySelectorAll('[data-action="remove"]').forEach((button) => {
    button.addEventListener('click', () => {
      removeEntry(button.dataset.id);
      showToast('已删除一条记录');
    });
  });
}

function formatNextReminder() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY));
    if (!saved?.nextAt) return '--:--';
    return new Date(saved.nextAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

function dropMascot(size) {
  const className = `drop drop--${size}`;
  return `
    <svg class="${className}" viewBox="0 0 120 140" role="img" aria-label="水滴吉祥物">
      <path d="M60 6C40 34 20 62 20 88c0 28 22 48 60 48s60-20 60-48C140 62 80 34 60 6Z" transform="translate(-20)" fill="url(#dropGradient)" />
      <defs>
        <linearGradient id="dropGradient" x1="28" x2="92" y1="12" y2="136" gradientUnits="userSpaceOnUse">
          <stop stop-color="#8fe6ff" />
          <stop offset="1" stop-color="#43a7ee" />
        </linearGradient>
      </defs>
      <ellipse cx="44" cy="74" rx="8" ry="10" fill="#14213d" />
      <ellipse cx="76" cy="74" rx="8" ry="10" fill="#14213d" />
      <circle cx="47" cy="70" r="3" fill="#fff" />
      <circle cx="79" cy="70" r="3" fill="#fff" />
      <path d="M50 92c5 8 15 8 20 0" fill="none" stroke="#14213d" stroke-width="5" stroke-linecap="round" />
      <circle cx="35" cy="88" r="7" fill="#ff8c9d" opacity=".8" />
      <circle cx="85" cy="88" r="7" fill="#ff8c9d" opacity=".8" />
      <path d="M88 48c9 7 15 15 17 25" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75" />
    </svg>
  `;
}

function icon(name) {
  const icons = {
    menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h10"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3a8 8 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2L3 14.5l2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3h4.8l.4-3a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.6.1-1Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="m12 3 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-5 2.6 1-5.5-4-3.9 5.5-.8L12 3Z"/></svg>',
    cup: '<svg viewBox="0 0 24 24"><path d="M7 4h10l-1 17H8L7 4Z"/><path d="M8 8h8"/><path d="M9 12h6" opacity=".5"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/><path d="M5 4 3 6M19 4l2 2"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 6-3 9h18c0-3-3-2-3-9Z"/><path d="M10 21h4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 3C8 8 5 12 5 16a7 7 0 0 0 14 0c0-4-3-8-7-13Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M5 19V5"/><path d="M5 19h14"/><path d="M9 16v-5M13 16V8M17 16v-9"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>'
  };
  return `<span class="icon" aria-hidden="true">${icons[name] ?? icons.info}</span>`;
}
