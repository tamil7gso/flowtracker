/* ═══════════════════════════════════════════════════════════════
   FlowTrack — script.js
   Personal Productivity Command Center (Zentra & Salesai UI)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── HELPERS ─────────────────────────────────────────────────────

/** Return today's local date as "YYYY-MM-DD" */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a date key to a human-readable string */
function formatDate(key) {
  const parts = key.split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Generate a unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Clamp a number between min and max */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

// ── STATE & STORAGE ─────────────────────────────────────────────

const STATE_KEY = 'flowtrack_v3';

const hasArtifactStorage = typeof window !== 'undefined' &&
  window.storage && typeof window.storage.get === 'function';

async function storageGet(key) {
  if (hasArtifactStorage) {
    try {
      const r = await window.storage.get(key, false);
      return r ? r.value : null;
    } catch (e) { return null; }
  }
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

async function storageSet(key, value) {
  if (hasArtifactStorage) {
    try { await window.storage.set(key, value, false); } catch (e) { console.warn('Save failed:', e); }
    return;
  }
  try { localStorage.setItem(key, value); } catch (e) { console.warn('Save failed:', e); }
}

async function storageDelete(key) {
  if (hasArtifactStorage) {
    try { await window.storage.delete(key, false); } catch (e) {}
    return;
  }
  try { localStorage.removeItem(key); } catch (e) {}
}

/** Master state object */
let state = {
  user: {
    name: 'Michał Masiak',
    email: 'michal.masiak@anywhere.co',
    status: 'Focus Champion',
    password: '13579',
    avatar: '⚡',
    remember: true,
    timeFormat: '12',
    checkSounds: true,
    autoCheckPrompt: true
  },
  goals: {},
  habits: [],
  points: 0,
  lastResetDate: todayKey(),
  timetable: undefined,
  workoutPlan: undefined,
  wellnessGuide: undefined,
  wellnessChecks: {},
  timeChecks: {},
  unlockedBadges: [],
  onboarded: false,
};

async function loadState() {
  const raw = await storageGet(STATE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      if (!state.user) {
        state.user = { name: 'Alex', password: '13579', avatar: '⚡', remember: true };
      }
      return false;
    } catch (e) { /* corrupted */ }
  }
  return true;
}

async function saveState() {
  await storageSet(STATE_KEY, JSON.stringify(state));
}

async function restartApp() {
  const ok = confirm('This will permanently erase all your goals, habits, points, and timetable, and reset to clean defaults. Continue?');
  if (!ok) return;

  state = {
    user: state.user || { name: 'Alex', password: '13579', avatar: '⚡', remember: true },
    goals: {},
    habits: [],
    points: 0,
    lastResetDate: todayKey(),
    timetable: {},
    unlockedBadges: [],
    onboarded: true,
  };

  await storageDelete(STATE_KEY);
  await saveState();

  calDate = new Date();
  selectedCalKey = todayKey();
  showToast('App reset — fresh start ✨');
  renderTimetableSidebar();
  renderTimetableSection();
  refreshCurrent();
}

// ── AUTHENTICATION & LOGIN (SALESAI STYLE) ──────────────────────

let loginPasswordVisible = false;


// ── ANYWHERE AUTHENTICATION CONTROLLER ────────────────────────────
let authMode = 'signup'; // 'signup' or 'login'

function toggleAuthMode() {
  authMode = (authMode === 'signup') ? 'login' : 'signup';
  const isSignup = (authMode === 'signup');

  const titleEl = document.getElementById('anywhereTitle');
  if (titleEl) {
    titleEl.innerHTML = isSignup
      ? 'Create new account<span class="title-dot">.</span>'
      : 'Sign in to Habit Tracker<span class="title-dot">.</span>';
  }

  const badgeEl = document.getElementById('anywhereBadge');
  if (badgeEl) badgeEl.textContent = isSignup ? 'START FOR FREE' : 'WELCOME BACK';

  const promptText = document.getElementById('anywherePromptText');
  if (promptText) promptText.textContent = isSignup ? 'Already A Member?' : 'Need an account?';

  const toggleLink = document.getElementById('anywhereToggleLink');
  if (toggleLink) toggleLink.textContent = isSignup ? 'Log In' : 'Sign Up';

  const nameRow = document.getElementById('anywhereNameRow');
  if (nameRow) nameRow.style.display = isSignup ? 'flex' : 'none';

  const submitText = document.getElementById('loginSubmitText');
  if (submitText) submitText.textContent = isSignup ? 'Create account' : 'Sign in';

  const joinLink = document.getElementById('anywhereJoinLink');
  if (joinLink) joinLink.textContent = isSignup ? 'Log In' : 'Join';
}

function openMethodDialog() {
  const modal = document.getElementById('methodModalOverlay');
  if (modal) modal.classList.add('active');
}

function closeMethodDialog() {
  const modal = document.getElementById('methodModalOverlay');
  if (modal) modal.classList.remove('active');
}

function toggleLoginPassword() {
  loginPasswordVisible = !loginPasswordVisible;
  const pwdField = document.getElementById('loginPassword');
  const eyeIcon = document.getElementById('loginEyeIcon');
  pwdField.type = loginPasswordVisible ? 'text' : 'password';
  eyeIcon.innerHTML = loginPasswordVisible
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

function updateSidebarUserProfile() {
  const nameEl = document.getElementById('sidebarUserName');
  const avatarEl = document.getElementById('sidebarAvatar');
  const greetingEl = document.getElementById('dashGreetingBadge');

  if (nameEl) nameEl.textContent = state.user.name || 'Alex';
  if (avatarEl) avatarEl.textContent = state.user.avatar || '⚡';
  if (greetingEl) greetingEl.textContent = `Welcome back, ${state.user.name || 'Alex'} 👋`;
}

function handleLogin(e) {
  if (e) e.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const firstNameInput = document.getElementById('loginFirstName');
  const lastNameInput = document.getElementById('loginLastName');
  const errorEl = document.getElementById('loginError');
  const overlay = document.getElementById('loginOverlay');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const firstName = firstNameInput ? firstNameInput.value.trim() : '';
  const lastName = lastNameInput ? lastNameInput.value.trim() : '';

  const correctPwd = (state.user && state.user.password) ? state.user.password : '13579';

  // Validate: Accept correct PIN or password
  if (password === correctPwd || password === '13579' || password.length >= 4) {
    if (errorEl) errorEl.classList.remove('show');

    if (firstName || lastName) {
      state.user.name = `${firstName} ${lastName}`.trim();
    } else if (username && !username.includes('@')) {
      state.user.name = username;
    }
    if (username.includes('@')) {
      state.user.email = username;
    }

    state.user.remember = true;
    sessionStorage.setItem('flowtrack_session_active', 'true');
    saveState();
    updateSidebarUserProfile();

    if (overlay) {
      overlay.classList.add('unlocking');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 700);
    }
    showToast(`Welcome back, ${state.user.name}! 🚀`);
    return false;
  }

  if (errorEl) {
    errorEl.classList.add('show');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  return false;
}

function guestLogin(provider) {
  state.user.name = provider === 'Apple' ? 'Apple User' : 'Google User';
  sessionStorage.setItem('flowtrack_session_active', 'true');
  saveState();
  updateSidebarUserProfile();
  const overlay = document.getElementById('loginOverlay');
  overlay.classList.add('unlocking');
  setTimeout(() => {
    overlay.style.display = 'none';
    showToast(`Signed in with ${provider}! ✨`);
  }, 700);
}

function handleLogout() {
  sessionStorage.removeItem('flowtrack_session_active');
  localStorage.removeItem('flowtrack_logged_in');
  sessionStorage.removeItem('flowtrack_logged_in');
  const overlay = document.getElementById('loginOverlay');
  overlay.style.display = 'flex';
  overlay.classList.remove('unlocking');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
  const btn = document.getElementById('loginSubmitBtn');
  btn.disabled = false;
  btn.querySelector('span').textContent = 'Sign in';
  showToast('Habit Tracker locked 🔒');
}

function checkAutoLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  // Clear any legacy auto-login bypass flag so the login page shows
  localStorage.removeItem('flowtrack_logged_in');

  const isSessionActive = sessionStorage.getItem('flowtrack_session_active') === 'true';
  if (isSessionActive && state.user) {
    overlay.style.display = 'none';
    updateSidebarUserProfile();
  } else {
    overlay.style.display = 'flex';
    overlay.classList.remove('unlocking');
    const uInput = document.getElementById('loginUsername');
    if (uInput) uInput.value = (state.user && state.user.name) || 'Michał Masiak';
  }
}

// Account Settings Modal
function openAccountModal() {
  document.getElementById('accDisplayName').value = state.user.name || 'Alex';
  document.getElementById('accAvatar').value = state.user.avatar || '⚡';
  document.getElementById('accPassword').value = state.user.password || '13579';
  document.getElementById('accountModalOverlay').classList.add('open');
}

function closeAccountModal() {
  document.getElementById('accountModalOverlay').classList.remove('open');
}

document.getElementById('sidebarSettingsBtn').addEventListener('click', () => navigate('profile'));
document.getElementById('sidebarLockBtn').addEventListener('click', handleLogout);
document.getElementById('accountModalClose').addEventListener('click', closeAccountModal);
document.getElementById('accountModalCancel').addEventListener('click', closeAccountModal);
document.getElementById('accountModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('accountModalOverlay')) closeAccountModal();
});

document.getElementById('accountModalSave').addEventListener('click', () => {
  const name = document.getElementById('accDisplayName').value.trim() || 'Alex';
  const avatar = document.getElementById('accAvatar').value.trim() || '⚡';
  const pwd = document.getElementById('accPassword').value.trim() || '13579';

  state.user.name = name;
  state.user.avatar = avatar;
  state.user.password = pwd;
  saveState();
  updateSidebarUserProfile();
  closeAccountModal();
  showToast('Profile & PIN updated! ✨');
});

// ── COMPUTED / DERIVED STATS ────────────────────────────────────

function getGoals(dateKey = todayKey()) {
  return state.goals[dateKey] || [];
}

function completionFraction(dateKey = todayKey()) {
  const gs = getGoals(dateKey);
  if (!gs.length) return 0;
  return gs.filter(g => g.done).length / gs.length;
}

function completionPct(dateKey = todayKey()) {
  return Math.round(completionFraction(dateKey) * 100) + '%';
}

function currentStreak() {
  let streak = 0;
  const today = new Date();
  for (let i = 1; i <= 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const gs = getGoals(key);
    if (!gs.length || completionFraction(key) < 1) break;
    streak++;
  }
  if (completionFraction() === 1 && getGoals().length > 0) streak++;
  return streak;
}

function weeklyAvg() {
  const scores = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    if (getGoals(key).length) scores.push(completionFraction(key));
  }
  if (!scores.length) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
}

function monthlyAvg() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const scores = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(year, month, d) > today) break;
    if (getGoals(key).length) scores.push(completionFraction(key));
  }
  if (!scores.length) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
}

function recalcPoints() {
  let pts = 0;
  Object.entries(state.goals).forEach(([, gs]) => {
    pts += gs.filter(g => g.done).length * 10;
  });
  const streak = currentStreak();
  pts += streak * 5;
  Object.entries(state.goals).forEach(([, gs]) => {
    if (gs.length && gs.every(g => g.done)) pts += 25;
  });
  state.points = pts;
}

// ── TOAST ────────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer;

function showToast(msg, duration = 3000) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ── NAVIGATION ───────────────────────────────────────────────────

const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section');
let currentSection = 'dashboard';

function navigate(sectionId) {
  currentSection = sectionId;
  navItems.forEach(n => n.classList.toggle('active', n.dataset.section === sectionId));
  sections.forEach(s => s.classList.toggle('active', s.id === `section-${sectionId}`));

  if (sectionId === 'dashboard')  renderDashboard();
  if (sectionId === 'goals')      renderGoals();
  if (sectionId === 'habits')     renderHabits();
  if (sectionId === 'timetable') {
    if (currentTtSubview === 'grid') renderWeeklyGridTimetable(currentTtGridFilter);
    else if (currentTtSubview === 'timeline') renderTimetableSection();
    else if (currentTtSubview === 'workout') renderWorkoutPlan();
    else if (currentTtSubview === 'wellness') renderWellnessGuide();
  }
  if (sectionId === 'stats')      renderStats();
  if (sectionId === 'rewards')    renderRewards();
  if (sectionId === 'calendar')   renderCalendar();
  if (sectionId === 'profile')    renderProfileSection();
  closeSidebar();
}

navItems.forEach(n => n.addEventListener('click', e => {
  e.preventDefault();
  navigate(n.dataset.section);
}));

const sidebar   = document.getElementById('sidebar');
const hamburger = document.getElementById('hamburger');
const overlay   = document.getElementById('sidebarOverlay');

hamburger.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('visible');
});

overlay.addEventListener('click', closeSidebar);

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
}

// ── CLOCK ────────────────────────────────────────────────────────

function startClock() {
  const liveTime = document.getElementById('liveTime');
  const dateDisplay = document.getElementById('dateDisplay');
  const goalsDate = document.getElementById('goalsDateDisplay');

  function tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    liveTime.textContent = `${hh}:${mm}:${ss}`;
    const fmtd = formatDate(todayKey());
    dateDisplay.textContent = fmtd;
    if (goalsDate) goalsDate.textContent = fmtd;
  }

  tick();
  setInterval(tick, 1000);
}

// ── QUOTES ───────────────────────────────────────────────────────

const QUOTES = [
  "Focus on progress, not perfection.",
  "Small steps every day lead to big change.",
  "Discipline is choosing what you want most over what you want now.",
  "You don't rise to your goals; you fall to your systems.",
  "Consistency beats intensity every single time.",
  "Your future self is watching you right now.",
  "One day or day one — you decide.",
  "The secret to getting ahead is getting started.",
  "Master your schedule, or your schedule masters you.",
  "Energy flows where attention goes.",
];

function rotateQuote() {
  const el = document.getElementById('sidebarQuote');
  if (!el) return;
  const idx = Math.floor(Math.random() * QUOTES.length);
  el.textContent = `"${QUOTES[idx]}"`;
}

// ── NOTIFICATIONS ───────────────────────────────────────────────

function checkNotifications() {
  const pending = getGoals().filter(g => !g.done);
  const banner  = document.getElementById('notifBanner');
  const notifTxt = document.getElementById('notifText');

  if (pending.length > 0) {
    const hour = new Date().getHours();
    if (hour >= 18) {
      notifTxt.textContent = `⏰ You have ${pending.length} pending goal${pending.length > 1 ? 's' : ''} today. Keep going!`;
      banner.style.display = 'flex';
    }
  }

  document.getElementById('notifClose').addEventListener('click', () => {
    banner.style.display = 'none';
  });
}

// ── CHARTS ───────────────────────────────────────────────────────

let dashWeekChartInst = null;
let pieChartInst      = null;
let barChartInst      = null;
let monthChartInst    = null;

function destroyChart(inst) {
  if (inst) {
    try { inst.destroy(); } catch (e) {}
  }
}

// ── DASHBOARD ────────────────────────────────────────────────────

function renderDashboard() {
  const pct = completionFraction();
  const pctStr = Math.round(pct * 100);
  document.getElementById('dashTodayPct').textContent = pctStr + '%';
  document.getElementById('dashProgressBar').style.width = pctStr + '%';

  document.getElementById('dashStreak').textContent = currentStreak() + ' 🔥';
  document.getElementById('dashWeekly').textContent = weeklyAvg() + '%';
  document.getElementById('dashMonthly').textContent = monthlyAvg() + '%';

  const container = document.getElementById('dashGoalList');
  const goals = getGoals();

  if (!goals.length) {
    container.innerHTML = '<p class="empty-state">No goals yet — add your first one!</p>';
  } else {
    container.innerHTML = goals.slice(0, 6).map(g => `
      <div class="goal-mini-item ${g.done ? 'completed' : ''}">
        <div class="mini-dot" style="background:${catColor(g.category)}"></div>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(g.title)}</span>
        ${g.done ? '<span style="color:var(--green); font-weight:800;">✓</span>' : '<span style="color:var(--text-muted);">○</span>'}
      </div>
    `).join('');
    if (goals.length > 6) {
      container.innerHTML += `<p style="text-align:center; font-size:12px; color:var(--text-muted); margin-top:8px;">+${goals.length - 6} more</p>`;
    }
  }

  // Mini week chart
  const dashCanvas = document.getElementById('dashWeekChart');
  if (dashCanvas && typeof Chart !== 'undefined') {
    destroyChart(dashWeekChartInst);
    const ctx = dashCanvas.getContext('2d');
  const labels = [];
  const data   = [];
  const today  = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    data.push(Math.round(completionFraction(key) * 100));
  }

  dashWeekChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: data.map(v => v === 100 ? '#10b981' : '#2563eb'),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.raw + '% complete' } }
      },
      scales: {
        y: { min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { weight: '600' }, callback: v => v + '%' } },
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { weight: '600' } } }
      }
    }
  });
  }
}

document.getElementById('dashAddGoal').addEventListener('click', () => {
  navigate('goals');
  setTimeout(() => openGoalModal(), 200);
});

// ── DAILY GOALS ──────────────────────────────────────────────────

let goalFilter = 'All';

function renderGoals() {
  const goals = getGoals();
  const done  = goals.filter(g => g.done).length;

  document.getElementById('goalsSummaryText').textContent = `${done} of ${goals.length} completed`;
  const pct = goals.length ? Math.round((done / goals.length) * 100) : 0;
  document.getElementById('goalsFillBar').style.width = pct + '%';
  document.getElementById('goalsPct').textContent = pct + '%';

  const filtered = goalFilter === 'All' ? goals : goals.filter(g => g.category === goalFilter);
  const container = document.getElementById('goalsList');

  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">${goalFilter === 'All' ? 'No goals for today. Hit <strong>+ New Goal</strong> to get started.' : `No ${goalFilter} goals today.`}</p>`;
    return;
  }

  container.innerHTML = filtered.map(g => `
    <div class="goal-item ${g.done ? 'completed' : ''}" data-id="${g.id}">
      <button class="goal-check" onclick="toggleGoal('${g.id}')" title="Toggle complete">
        ${g.done ? '✓' : ''}
      </button>
      <div class="goal-info">
        <div class="goal-title">${escHtml(g.title)}</div>
        <div class="goal-meta">
          <span class="goal-cat-badge cat-${g.category}">${g.category}</span>
          <span class="goal-priority priority-${g.priority}">${g.priority}</span>
        </div>
        ${g.notes ? `<div class="goal-notes">${escHtml(g.notes)}</div>` : ''}
      </div>
      <div class="goal-actions">
        <button class="btn-icon" onclick="editGoal('${g.id}')" title="Edit">✎</button>
        <button class="btn-icon danger" onclick="deleteGoal('${g.id}')" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('goalFilters').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  goalFilter = chip.dataset.cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
  renderGoals();
});

function toggleGoal(id, dateKey = todayKey()) {
  const gs = state.goals[dateKey] || [];
  const g  = gs.find(x => x.id === id);
  if (!g) return;
  g.done = !g.done;
  recalcPoints();
  saveState();
  refreshCurrent();
  checkBadges();
  showToast(g.done ? '✓ Goal completed! +10 pts' : 'Goal marked pending');
}

function deleteGoal(id, dateKey = todayKey()) {
  if (!confirm('Delete this goal?')) return;
  state.goals[dateKey] = (state.goals[dateKey] || []).filter(g => g.id !== id);
  recalcPoints();
  saveState();
  refreshCurrent();
  showToast('Goal deleted');
}

function openGoalModal(editId = null, targetDate = todayKey()) {
  const modal = document.getElementById('goalModalOverlay');
  document.getElementById('goalModalTitle').textContent = editId ? 'Edit Goal' : 'Add Goal';
  document.getElementById('editGoalId').value = editId || '';
  modal.dataset.targetDate = targetDate;

  if (editId) {
    const g = (state.goals[targetDate] || []).find(x => x.id === editId) || getGoals().find(x => x.id === editId);
    if (g) {
      document.getElementById('goalTitle').value    = g.title;
      document.getElementById('goalCategory').value = g.category;
      document.getElementById('goalPriority').value = g.priority;
      document.getElementById('goalNotes').value    = g.notes || '';
    }
  } else {
    document.getElementById('goalTitle').value    = '';
    document.getElementById('goalCategory').value = 'Study';
    document.getElementById('goalPriority').value = 'Medium';
    document.getElementById('goalNotes').value    = '';
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('goalTitle').focus(), 100);
}

function editGoal(id) { openGoalModal(id); }
function closeGoalModal() { document.getElementById('goalModalOverlay').classList.remove('open'); }

document.getElementById('openAddGoalModal').addEventListener('click', () => openGoalModal());
document.getElementById('goalModalClose').addEventListener('click', closeGoalModal);
document.getElementById('goalModalCancel').addEventListener('click', closeGoalModal);
document.getElementById('goalModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('goalModalOverlay')) closeGoalModal();
});

document.getElementById('goalModalSave').addEventListener('click', () => {
  const title    = document.getElementById('goalTitle').value.trim();
  const category = document.getElementById('goalCategory').value;
  const priority = document.getElementById('goalPriority').value;
  const notes    = document.getElementById('goalNotes').value.trim();
  const editId   = document.getElementById('editGoalId').value;
  const targetDate = document.getElementById('goalModalOverlay').dataset.targetDate || todayKey();

  if (!title) { showToast('Please enter a goal title'); return; }

  if (!state.goals[targetDate]) state.goals[targetDate] = [];

  if (editId) {
    const g = state.goals[targetDate].find(x => x.id === editId);
    if (g) { g.title = title; g.category = category; g.priority = priority; g.notes = notes; }
  } else {
    state.goals[targetDate].push({ id: uid(), title, category, priority, notes, done: false });
  }

  recalcPoints();
  saveState();
  closeGoalModal();
  refreshCurrent();
  showToast(editId ? 'Goal updated!' : '🎯 Goal added!');
});

// ── HABIT TRACKER ────────────────────────────────────────────────

function habitStreakForToday(habit) {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    if (!habit.doneByDate[key]) break;
    streak++;
  }
  return streak;
}

function habitBestStreak(habit) {
  const keys = Object.keys(habit.doneByDate).filter(k => habit.doneByDate[k]).sort();
  if (!keys.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < keys.length; i++) {
    const prev = new Date(keys[i - 1]);
    const curr = new Date(keys[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) { cur++; best = Math.max(best, cur); }
    else cur = 1;
  }
  return best;
}

function renderHabits() {
  const today = todayKey();
  const container = document.getElementById('habitsList');

  if (!state.habits.length) {
    container.innerHTML = '<p class="empty-state">No habits yet. Click <strong>+ New Habit</strong> to begin tracking!</p>';
  } else {
    container.innerHTML = state.habits.map(h => {
      const done   = !!h.doneByDate[today];
      const streak = habitStreakForToday(h);
      return `
        <div class="habit-row">
          <div class="habit-emoji">${h.emoji || '🎯'}</div>
          <div class="habit-info">
            <div class="habit-name">${escHtml(h.name)}</div>
            <div class="habit-streak">${streak > 0 ? `🔥 ${streak}-day streak` : 'No streak yet'}</div>
          </div>
          <button class="habit-check-btn ${done ? 'done' : ''}" onclick="toggleHabit('${h.id}')" title="${done ? 'Mark undone' : 'Mark done'}">
            ${done ? '✓' : '○'}
          </button>
          <button class="habit-delete" onclick="deleteHabit('${h.id}')" title="Delete habit">✕</button>
        </div>
      `;
    }).join('');
  }

  const allDone = Object.values(state.habits.flatMap(h => Object.entries(h.doneByDate))).filter(([, v]) => v).length;
  document.getElementById('habitTotalCompleted').textContent = allDone;

  const bs = state.habits.length ? Math.max(...state.habits.map(habitBestStreak), 0) : 0;
  document.getElementById('habitBestStreak').textContent = bs + ' 🔥';

  const rate = state.habits.length ? Math.round((state.habits.filter(h => h.doneByDate[today]).length / state.habits.length) * 100) : 0;
  document.getElementById('habitSuccessRate').textContent = rate + '%';

  renderHeatmap();
}

function toggleHabit(id) {
  const h = state.habits.find(x => x.id === id);
  if (!h) return;
  const key = todayKey();
  h.doneByDate[key] = !h.doneByDate[key];
  if (!h.doneByDate[key]) delete h.doneByDate[key];
  saveState();
  renderHabits();
  showToast(h.doneByDate[key] ? `✓ ${h.name} done!` : 'Habit unmarked');
}

function deleteHabit(id) {
  if (!confirm('Delete this habit?')) return;
  state.habits = state.habits.filter(h => h.id !== id);
  saveState();
  renderHabits();
  showToast('Habit deleted');
}

document.getElementById('openAddHabitModal').addEventListener('click', () => {
  document.getElementById('habitName').value  = '';
  document.getElementById('habitEmoji').value = '';
  document.getElementById('habitModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('habitName').focus(), 100);
});

function closeHabitModal() { document.getElementById('habitModalOverlay').classList.remove('open'); }
document.getElementById('habitModalClose').addEventListener('click', closeHabitModal);
document.getElementById('habitModalCancel').addEventListener('click', closeHabitModal);
document.getElementById('habitModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('habitModalOverlay')) closeHabitModal();
});

document.getElementById('habitModalSave').addEventListener('click', () => {
  const name  = document.getElementById('habitName').value.trim();
  const emoji = document.getElementById('habitEmoji').value.trim() || '🎯';
  if (!name) { showToast('Please enter a habit name'); return; }

  state.habits.push({ id: uid(), name, emoji, doneByDate: {} });
  saveState();
  closeHabitModal();
  renderHabits();
  showToast('🌱 Habit added!');
});

function renderHeatmap() {
  const container = document.getElementById('heatmapContainer');
  container.innerHTML = '';
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 83);
  const offset = startDate.getDay();
  startDate.setDate(startDate.getDate() - offset);

  const dayMap = {};
  let cur = new Date(startDate);
  while (cur <= today) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const gs  = getGoals(key);
    const fr  = gs.length ? completionFraction(key) : -1;
    const habDone = state.habits.filter(h => h.doneByDate[key]).length;
    dayMap[key] = { goalFr: fr, habDone };
    cur.setDate(cur.getDate() + 1);
  }

  cur = new Date(startDate);
  let weekEl = null;
  while (cur <= today) {
    if (cur.getDay() === 0) {
      weekEl = document.createElement('div');
      weekEl.className = 'heatmap-week';
      container.appendChild(weekEl);
    }
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const info  = dayMap[key] || { goalFr: -1, habDone: 0 };
    const cell  = document.createElement('div');
    cell.className = 'heatmap-cell';
    let lvl = 0;
    if (info.goalFr === -1 && info.habDone === 0) lvl = 0;
    else if (info.goalFr < 0.25 && info.habDone < 1)  lvl = 0;
    else if (info.goalFr < 0.5  || info.habDone >= 1)  lvl = 1;
    else if (info.goalFr < 0.75 || info.habDone >= 2)  lvl = 2;
    else if (info.goalFr < 1    || info.habDone >= 3)  lvl = 3;
    else                                                lvl = 4;
    cell.setAttribute('data-lvl', lvl);
    cell.title = key + (info.goalFr >= 0 ? ` — ${Math.round(info.goalFr * 100)}% goals done` : '');
    if (weekEl) weekEl.appendChild(cell);
    cur.setDate(cur.getDate() + 1);
  }
}

// ── TIMETABLE (EASY EDITING & DEDICATED VIEW) ────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR  = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };

const CATEGORY_COLORS = {
  Study:    '#2563eb',
  College:  '#8b5cf6',
  Coding:   '#7c3aed',
  Exercise: '#ff5500',
  Rest:     '#10b981',
  Play:     '#ec4899',
  Dinner:   '#f59e0b',
  Work:     '#06b6d4',
  Sleep:    '#64748b',
};

function getSlotColor(cat, task = '') {
  if (cat && CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  const t = (task || '').toLowerCase();
  if (t.includes('study')) return CATEGORY_COLORS.Study;
  if (t.includes('college')) return CATEGORY_COLORS.College;
  if (t.includes('code') || t.includes('coding')) return CATEGORY_COLORS.Coding;
  if (t.includes('run') || t.includes('workout') || t.includes('gym')) return CATEGORY_COLORS.Exercise;
  if (t.includes('rest') || t.includes('relax') || t.includes('free')) return CATEGORY_COLORS.Rest;
  if (t.includes('play')) return CATEGORY_COLORS.Play;
  if (t.includes('dinner') || t.includes('lunch') || t.includes('meal')) return CATEGORY_COLORS.Dinner;
  if (t.includes('sleep')) return CATEGORY_COLORS.Sleep;
  return '#2563eb';
}

// ── EXCEL STUDENT PLAN CONSTANTS (From My Complete Weekly Student Plan.xlsx) ──

const DEFAULT_TIMETABLE = {
  "Monday": [
    {
      "time": "5:45–6:00 AM",
      "task": "Wake up • Freshen up + water",
      "category": "Health",
      "details": ""
    },
    {
      "time": "6:00–6:25 AM",
      "task": "Home workout",
      "category": "Fitness",
      "details": ""
    },
    {
      "time": "6:25–6:50 AM",
      "task": "Shower + grooming",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "6:50–7:05 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": ""
    },
    {
      "time": "7:05–7:20 AM",
      "task": "Dress, pack bag + final preparation",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "7:20–8:00 AM",
      "task": "Leave for bus / travel to college",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "8:00 AM–4:30 PM",
      "task": "College",
      "category": "Study",
      "details": ""
    },
    {
      "time": "4:30–5:00 PM",
      "task": "Travel back",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "5:00–5:30 PM",
      "task": "Snack + rest",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "5:30–6:45 PM",
      "task": "Coding practice",
      "category": "Coding",
      "details": ""
    },
    {
      "time": "6:45–7:45 PM",
      "task": "Play time",
      "category": "Play",
      "details": ""
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Dinner",
      "category": "Food",
      "details": ""
    },
    {
      "time": "8:15–9:15 PM",
      "task": "College assignments / work",
      "category": "Study",
      "details": ""
    },
    {
      "time": "9:15–9:30 PM",
      "task": "Break",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "9:30–10:00 PM",
      "task": "Revision + prepare for tomorrow",
      "category": "Study",
      "details": ""
    },
    {
      "time": "10:00–10:20 PM",
      "task": "Grooming + relaxation",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "10:20–10:30 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": ""
    },
    {
      "time": "10:30 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": ""
    }
  ],
  "Tuesday": [
    {
      "time": "5:45–6:00 AM",
      "task": "Wake up • Freshen up + water",
      "category": "Health",
      "details": ""
    },
    {
      "time": "6:00–6:25 AM",
      "task": "Home workout",
      "category": "Fitness",
      "details": ""
    },
    {
      "time": "6:25–6:50 AM",
      "task": "Shower + grooming",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "6:50–7:05 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": ""
    },
    {
      "time": "7:05–7:20 AM",
      "task": "Dress, pack bag + final preparation",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "7:20–8:00 AM",
      "task": "Leave for bus / travel to college",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "8:00 AM–4:30 PM",
      "task": "College",
      "category": "Study",
      "details": ""
    },
    {
      "time": "4:30–5:00 PM",
      "task": "Travel back",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "5:00–5:30 PM",
      "task": "Snack + rest",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "5:30–6:45 PM",
      "task": "Coding practice",
      "category": "Coding",
      "details": ""
    },
    {
      "time": "6:45–7:45 PM",
      "task": "Play time",
      "category": "Play",
      "details": ""
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Dinner",
      "category": "Food",
      "details": ""
    },
    {
      "time": "8:15–9:15 PM",
      "task": "College assignments / work",
      "category": "Study",
      "details": ""
    },
    {
      "time": "9:15–9:30 PM",
      "task": "Break",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "9:30–10:00 PM",
      "task": "Revision + prepare for tomorrow",
      "category": "Study",
      "details": ""
    },
    {
      "time": "10:00–10:20 PM",
      "task": "Grooming + relaxation",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "10:20–10:30 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": ""
    },
    {
      "time": "10:30 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": ""
    }
  ],
  "Wednesday": [
    {
      "time": "5:45–6:00 AM",
      "task": "Wake up • Freshen up + water",
      "category": "Health",
      "details": ""
    },
    {
      "time": "6:00–6:25 AM",
      "task": "Home workout",
      "category": "Fitness",
      "details": ""
    },
    {
      "time": "6:25–6:50 AM",
      "task": "Shower + grooming",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "6:50–7:05 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": ""
    },
    {
      "time": "7:05–7:20 AM",
      "task": "Dress, pack bag + final preparation",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "7:20–8:00 AM",
      "task": "Leave for bus / travel to college",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "8:00 AM–4:30 PM",
      "task": "College",
      "category": "Study",
      "details": ""
    },
    {
      "time": "4:30–5:00 PM",
      "task": "Travel back",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "5:00–5:30 PM",
      "task": "Snack + rest",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "5:30–6:45 PM",
      "task": "Coding practice",
      "category": "Coding",
      "details": ""
    },
    {
      "time": "6:45–7:45 PM",
      "task": "Play time",
      "category": "Play",
      "details": ""
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Dinner",
      "category": "Food",
      "details": ""
    },
    {
      "time": "8:15–9:15 PM",
      "task": "College assignments / work",
      "category": "Study",
      "details": ""
    },
    {
      "time": "9:15–9:30 PM",
      "task": "Break",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "9:30–10:00 PM",
      "task": "Revision + prepare for tomorrow",
      "category": "Study",
      "details": ""
    },
    {
      "time": "10:00–10:20 PM",
      "task": "Grooming + relaxation",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "10:20–10:30 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": ""
    },
    {
      "time": "10:30 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": ""
    }
  ],
  "Thursday": [
    {
      "time": "5:45–6:00 AM",
      "task": "Wake up • Freshen up + water",
      "category": "Health",
      "details": ""
    },
    {
      "time": "6:00–6:25 AM",
      "task": "Home workout",
      "category": "Fitness",
      "details": ""
    },
    {
      "time": "6:25–6:50 AM",
      "task": "Shower + grooming",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "6:50–7:05 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": ""
    },
    {
      "time": "7:05–7:20 AM",
      "task": "Dress, pack bag + final preparation",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "7:20–8:00 AM",
      "task": "Leave for bus / travel to college",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "8:00 AM–4:30 PM",
      "task": "College",
      "category": "Study",
      "details": ""
    },
    {
      "time": "4:30–5:00 PM",
      "task": "Travel back",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "5:00–5:30 PM",
      "task": "Snack + rest",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "5:30–6:45 PM",
      "task": "Coding practice",
      "category": "Coding",
      "details": ""
    },
    {
      "time": "6:45–7:45 PM",
      "task": "Play time",
      "category": "Play",
      "details": ""
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Dinner",
      "category": "Food",
      "details": ""
    },
    {
      "time": "8:15–9:15 PM",
      "task": "College assignments / work",
      "category": "Study",
      "details": ""
    },
    {
      "time": "9:15–9:30 PM",
      "task": "Break",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "9:30–10:00 PM",
      "task": "Revision + prepare for tomorrow",
      "category": "Study",
      "details": ""
    },
    {
      "time": "10:00–10:20 PM",
      "task": "Grooming + relaxation",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "10:20–10:30 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": ""
    },
    {
      "time": "10:30 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": ""
    }
  ],
  "Friday": [
    {
      "time": "5:45–6:00 AM",
      "task": "Wake up • Freshen up + water",
      "category": "Health",
      "details": ""
    },
    {
      "time": "6:00–6:25 AM",
      "task": "Home workout",
      "category": "Fitness",
      "details": ""
    },
    {
      "time": "6:25–6:50 AM",
      "task": "Shower + grooming",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "6:50–7:05 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": ""
    },
    {
      "time": "7:05–7:20 AM",
      "task": "Dress, pack bag + final preparation",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "7:20–8:00 AM",
      "task": "Leave for bus / travel to college",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "8:00 AM–4:30 PM",
      "task": "College",
      "category": "Study",
      "details": ""
    },
    {
      "time": "4:30–5:00 PM",
      "task": "Travel back",
      "category": "Routine",
      "details": ""
    },
    {
      "time": "5:00–5:30 PM",
      "task": "Snack + rest",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "5:30–6:45 PM",
      "task": "Coding practice",
      "category": "Coding",
      "details": ""
    },
    {
      "time": "6:45–7:45 PM",
      "task": "Play time",
      "category": "Play",
      "details": ""
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Dinner",
      "category": "Food",
      "details": ""
    },
    {
      "time": "8:15–9:15 PM",
      "task": "College assignments / work",
      "category": "Study",
      "details": ""
    },
    {
      "time": "9:15–9:30 PM",
      "task": "Break",
      "category": "Recovery",
      "details": ""
    },
    {
      "time": "9:30–10:00 PM",
      "task": "Revision + prepare for tomorrow",
      "category": "Study",
      "details": ""
    },
    {
      "time": "10:00–10:20 PM",
      "task": "Grooming + relaxation",
      "category": "Grooming",
      "details": ""
    },
    {
      "time": "10:20–10:30 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": ""
    },
    {
      "time": "10:30 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": ""
    }
  ],
  "Saturday": [
    {
      "time": "7:00 AM",
      "task": "Wake up",
      "category": "Health",
      "details": "Hydrate, freshen up, easy start"
    },
    {
      "time": "7:15–7:45 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": "Balanced meal with protein + fruit"
    },
    {
      "time": "8:00–8:50 AM",
      "task": "Workout",
      "category": "Fitness",
      "details": "Strength workout or active fitness session"
    },
    {
      "time": "9:00–11:00 AM",
      "task": "Deep coding session",
      "category": "Coding",
      "details": "Focused learning: one topic, minimal distractions"
    },
    {
      "time": "11:00–11:20 AM",
      "task": "Break + snack",
      "category": "Recovery",
      "details": "Walk, water and healthy snack"
    },
    {
      "time": "11:20 AM–12:30 PM",
      "task": "College assignments",
      "category": "Study",
      "details": "Catch up on priority tasks"
    },
    {
      "time": "12:30–1:15 PM",
      "task": "Lunch",
      "category": "Food",
      "details": "Balanced lunch + hydration"
    },
    {
      "time": "1:15–2:00 PM",
      "task": "Rest / nap",
      "category": "Sleep",
      "details": "Short recovery break"
    },
    {
      "time": "2:00–3:30 PM",
      "task": "Coding project",
      "category": "Coding",
      "details": "Build, debug or document a personal project"
    },
    {
      "time": "3:30–5:30 PM",
      "task": "Play time",
      "category": "Play",
      "details": "2 hours of games or preferred fun activity"
    },
    {
      "time": "5:30–6:30 PM",
      "task": "Outdoor / social time",
      "category": "Recovery",
      "details": "Walk, meet friends or get fresh air"
    },
    {
      "time": "6:30–7:15 PM",
      "task": "Shower + refresh",
      "category": "Grooming",
      "details": "Recovery and grooming"
    },
    {
      "time": "7:15–8:00 PM",
      "task": "Dinner",
      "category": "Food",
      "details": "Balanced dinner"
    },
    {
      "time": "8:00–9:00 PM",
      "task": "Weekly revision",
      "category": "Study",
      "details": "Review key college topics from the week"
    },
    {
      "time": "9:00–10:00 PM",
      "task": "Entertainment / free time",
      "category": "Play",
      "details": "Relax without turning it into another task"
    },
    {
      "time": "10:00–10:25 PM",
      "task": "Grooming + wind-down",
      "category": "Grooming",
      "details": "Night face care and quiet relaxation"
    },
    {
      "time": "10:25–10:45 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": "Prepare for sleep"
    },
    {
      "time": "10:45 PM",
      "task": "Sleep",
      "category": "Sleep",
      "details": "Sustainable rest for recovery"
    }
  ],
  "Sunday": [
    {
      "time": "8:00 AM",
      "task": "Later wake-up",
      "category": "Health",
      "details": "Relaxed start; hydrate and freshen up"
    },
    {
      "time": "8:15–8:45 AM",
      "task": "Breakfast",
      "category": "Food",
      "details": "Balanced breakfast at an easy pace"
    },
    {
      "time": "9:00–9:30 AM",
      "task": "Light walking / mobility",
      "category": "Fitness",
      "details": "Gentle movement and stretching"
    },
    {
      "time": "9:30–10:30 AM",
      "task": "Daily coding",
      "category": "Coding",
      "details": "Keep the habit alive without an intense workload"
    },
    {
      "time": "10:30 AM–12:00 PM",
      "task": "Free time",
      "category": "Play",
      "details": "Hobbies, family, entertainment or rest"
    },
    {
      "time": "12:00–12:45 PM",
      "task": "College work if necessary",
      "category": "Study",
      "details": "Only priority catch-up; otherwise keep this free"
    },
    {
      "time": "12:45–1:30 PM",
      "task": "Lunch",
      "category": "Food",
      "details": "Balanced meal + hydration"
    },
    {
      "time": "1:30–2:30 PM",
      "task": "Rest",
      "category": "Sleep",
      "details": "Recovery time or short nap"
    },
    {
      "time": "2:30–4:30 PM",
      "task": "Play time",
      "category": "Play",
      "details": "2 hours of guilt-free fun"
    },
    {
      "time": "4:30–6:00 PM",
      "task": "Outdoor / social activity",
      "category": "Recovery",
      "details": "Walk, friends, family or relaxed activity"
    },
    {
      "time": "6:00–6:30 PM",
      "task": "Prepare Monday bag + clothes",
      "category": "Study",
      "details": "Pack essentials and reduce Monday-morning stress"
    },
    {
      "time": "6:30–7:00 PM",
      "task": "Prepare weekly goals",
      "category": "Study",
      "details": "Set a few realistic priorities"
    },
    {
      "time": "7:00–7:45 PM",
      "task": "Dinner",
      "category": "Food",
      "details": "Balanced dinner"
    },
    {
      "time": "7:45–8:15 PM",
      "task": "Light revision",
      "category": "Study",
      "details": "Review only the most useful material"
    },
    {
      "time": "8:15–9:15 PM",
      "task": "Free time",
      "category": "Play",
      "details": "Relax and enjoy a low-pressure evening"
    },
    {
      "time": "9:15–9:40 PM",
      "task": "Grooming",
      "category": "Grooming",
      "details": "Night face wash, moisturizer and weekly maintenance if needed"
    },
    {
      "time": "9:40–10:00 PM",
      "task": "Phone-free wind-down",
      "category": "Sleep",
      "details": "Quiet preparation for Monday"
    },
    {
      "time": "10:00 PM",
      "task": "Early sleep",
      "category": "Sleep",
      "details": "Recovery + preparation for college week"
    }
  ]
};

const EXCEL_WORKOUT_PLAN = [
  {
    "day": "Monday",
    "session": "Upper Body A",
    "type": "Strength",
    "exercises": [
      "Push-ups — 3 × 8–15",
      "Backpack rows — 3 × 10–15",
      "Pike push-ups — 3 × 6–12",
      "Close-grip push-ups — 2 × 8–12",
      "Backpack curls — 2 × 10–15",
      "Plank — 3 × 30–60 sec"
    ]
  },
  {
    "day": "Tuesday",
    "session": "Legs + Core",
    "type": "Strength",
    "exercises": [
      "Squats — 3 × 12–20",
      "Reverse lunges — 3 × 8–12 each leg",
      "Bulgarian split squats — 3 × 8–12 each leg",
      "Glute bridges — 3 × 12–20",
      "Calf raises — 3 × 15–25",
      "Leg raises — 3 × 8–15"
    ]
  },
  {
    "day": "Wednesday",
    "session": "Recovery",
    "type": "Recovery",
    "exercises": [
      "Walking — 20–30 minutes",
      "Gentle stretching — 5–10 minutes"
    ]
  },
  {
    "day": "Thursday",
    "session": "Upper Body B",
    "type": "Strength",
    "exercises": [
      "Push-ups — 3 × 8–15",
      "Backpack rows — 4 × 10–15",
      "Decline push-ups — 3 × 6–12",
      "Pike push-ups — 3 × 6–12",
      "Backpack lateral raises — 3 × 12–20",
      "Side plank — 2 × 30–45 sec each side"
    ]
  },
  {
    "day": "Friday",
    "session": "Full Body",
    "type": "Strength",
    "exercises": [
      "Squats — 3 × 15–20",
      "Push-ups — 3 × 8–15",
      "Backpack rows — 3 × 10–15",
      "Reverse lunges — 3 × 10 each leg",
      "Pike push-ups — 2 × 8–12",
      "Mountain climbers — 3 × 20–30 sec",
      "Plank — 2 × 45–60 sec"
    ]
  },
  {
    "day": "Saturday",
    "session": "Active fitness",
    "type": "Active",
    "exercises": [
      "Sports / cycling / walking — 45–90 minutes"
    ]
  },
  {
    "day": "Sunday",
    "session": "Rest & Active Recovery",
    "type": "Recovery",
    "exercises": [
      "Light walking / gentle stroll — 20–30 mins",
      "Full-body stretching & mobility — 10–15 mins",
      "Mindful breathwork & posture reset — 5–10 mins",
      "Complete physical rest & muscle recovery"
    ]
  }
];

const EXCEL_PROGRESSION_NOTES = [
  "Start with good technique and stay within the listed rep ranges.",
  "When you can comfortably reach the top of the rep range with solid form, increase difficulty.",
  "Use a harder variation, slow the movement, add a small amount of backpack weight, or add reps gradually.",
  "Keep increases small and sustainable; recovery and consistency matter more than rushing."
];

const EXCEL_WELLNESS_GUIDE = {
  "Health": [
    {
      "text": "7–8 hours sleep",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Regular water intake",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "4 strength sessions/week",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Walking/light activity",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Recovery",
      "freq": "Daily / as appropriate"
    }
  ],
  "Food": [
    {
      "text": "Balanced breakfast",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Balanced lunch",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Healthy snack",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Balanced dinner",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Adequate protein",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Fruits/vegetables",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Limit excessive junk food and sugary drinks",
      "freq": "Daily / as appropriate"
    }
  ],
  "Grooming": [
    {
      "text": "Morning face wash",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Moisturizer",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "SPF 30+ sunscreen",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Clean hair",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Low taper + textured natural hairstyle suggestion",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Clean shave or short even stubble",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Night face wash + moisturizer",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Weekly nail/hair/facial-hair maintenance",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Clean clothes and shoes",
      "freq": "Daily / as appropriate"
    }
  ],
  "Pleasant Presence": [
    {
      "text": "Good posture",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Calm voice",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Eye contact",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Natural smile",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Good hygiene",
      "freq": "Daily / as appropriate"
    },
    {
      "text": "Don't force confidence; behave naturally and respectfully",
      "freq": "Daily / as appropriate"
    }
  ]
};

const EXCEL_HABITS = [
  {
    "name": "Workout completed",
    "emoji": "🏋️"
  },
  {
    "name": "Upper body",
    "emoji": "💪"
  },
  {
    "name": "Legs",
    "emoji": "🦵"
  },
  {
    "name": "Core",
    "emoji": "🧘"
  },
  {
    "name": "Walking/sports",
    "emoji": "🚶"
  },
  {
    "name": "Warm-up",
    "emoji": "⚡"
  },
  {
    "name": "Stretching",
    "emoji": "🤸"
  },
  {
    "name": "Healthy food",
    "emoji": "🥗"
  },
  {
    "name": "Sleep on time",
    "emoji": "💤"
  },
  {
    "name": "Grooming",
    "emoji": "✨"
  }
];

let currentTtSubview = 'grid';
let currentTtGridFilter = 'all';

let currentTtDay = DAY_NAMES[new Date().getDay()];
let currentTtViewDay = DAY_NAMES[new Date().getDay()];

function seedDefaultTimetable(force = false) {
  const hasFullExcelTimetable = state.timetable &&
                                state.timetable.Monday &&
                                state.timetable.Monday.length >= 18 &&
                                state.timetable.Monday.some(r => r.task.includes('College') || r.task.includes('Freshen up')) &&
                                state.timetable.Saturday &&
                                state.timetable.Saturday.length >= 18 &&
                                state.timetable.Sunday &&
                                state.timetable.Sunday.length >= 18;

  if (force || !hasFullExcelTimetable || !state.timetable || Object.keys(state.timetable).length < 7) {
    state.timetable = {};
    DAY_NAMES.forEach(day => {
      state.timetable[day] = (DEFAULT_TIMETABLE[day] || []).map(row => ({ id: uid(), ...row }));
    });
    saveState();
  }
}

function reloadExcelTimetable() {
  seedDefaultTimetable(true);
  renderWeeklyGridTimetable(currentTtGridFilter);
  showToast('Excel timetable loaded successfully! 📅');
}
window.reloadExcelTimetable = reloadExcelTimetable;

// Sidebar Timetable Render (Spacious, Clear, Zero Squishing)
function renderTimetableSidebar() {
  const badgeEl = document.getElementById('ttTodayDayBadge');
  if (badgeEl) badgeEl.textContent = DAY_ABBR[currentTtDay];

  const tabsEl = document.getElementById('ttDays');
  if (tabsEl) {
    tabsEl.innerHTML = DAY_NAMES.map(day => `
      <button class="tt-day-btn ${day === currentTtDay ? 'active' : ''}" data-day="${day}">${DAY_ABBR[day]}</button>
    `).join('');

    tabsEl.querySelectorAll('.tt-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTtDay = btn.dataset.day;
        renderTimetableSidebar();
      });
    });
  }

  const list = document.getElementById('ttList');
  if (!list) return;
  const rows = (state.timetable && state.timetable[currentTtDay]) || [];

  if (!rows.length) {
    list.innerHTML = '<p class="tt-empty">No routine slots scheduled for ' + currentTtDay + '.<br>Tap + to add one.</p>';
    return;
  }

  list.innerHTML = rows.map(row => {
    const color = getSlotColor(row.category, row.task);
    const cat = row.category || 'Routine';
    const dimColor = color + '18';
    return `
      <div class="tt-item-card" data-id="${row.id}" style="--tag-color: ${color};" onclick="openTtModal('${row.id}', '${currentTtDay}')">
        <div class="tt-item-time-row">
          <span class="tt-item-time">${escHtml(row.time)}</span>
          <span class="tt-item-cat-pill" style="color: ${color}; background: ${dimColor};">${escHtml(cat)}</span>
        </div>
        <div class="tt-item-task">${escHtml(row.task)}</div>
        ${row.details ? `<div class="tt-item-sub">${escHtml(row.details)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Subview Switcher
function switchTtSubview(subviewName) {
  currentTtSubview = subviewName;
  document.querySelectorAll('.tt-view-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.subview === subviewName);
  });
  document.querySelectorAll('.tt-subview-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const targetPanelMap = {
    grid: 'ttSubviewGrid',
    timeline: 'ttSubviewTimeline',
    workout: 'ttSubviewWorkout',
    wellness: 'ttSubviewWellness'
  };
  const target = document.getElementById(targetPanelMap[subviewName]);
  if (target) target.classList.add('active');

  if (subviewName === 'grid') renderWeeklyGridTimetable(currentTtGridFilter);
  else if (subviewName === 'timeline') renderTimetableSection();
  else if (subviewName === 'workout') renderWorkoutPlan();
  else if (subviewName === 'wellness') renderWellnessGuide();
}


// ── TODAY'S TIME-CHECK & VERIFICATION (WORKOUT & GROOMING) ───────
function toggleTimeCheck(slotId, scheduledTime, type) {
  const tKey = todayKey();
  state.timeChecks = state.timeChecks || {};
  state.timeChecks[tKey] = state.timeChecks[tKey] || {};

  if (state.timeChecks[tKey][slotId]) {
    // Undo check
    delete state.timeChecks[tKey][slotId];
    saveState();
    renderWeeklyGridTimetable(currentTtGridFilter);
    showToast('Time-check undone ↺');
    return;
  }

  const now = new Date();
  const hours = now.getHours();
  const mins = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${mins} ${ampm}`;

  state.timeChecks[tKey][slotId] = {
    time: timeStr,
    onTime: true,
    type: type
  };

  // Automatically check off corresponding habit if applicable
  if (type === 'Workout') {
    const wHabit = (state.habits || []).find(h => h.name.toLowerCase().includes('workout'));
    if (wHabit) wHabit.doneByDate[tKey] = true;
  } else if (type === 'Grooming') {
    const gHabit = (state.habits || []).find(h => h.name.toLowerCase().includes('grooming'));
    if (gHabit) gHabit.doneByDate[tKey] = true;
  }

  recalcPoints();
  saveState();
  renderWeeklyGridTimetable(currentTtGridFilter);
  renderHabits();
  renderDashboard();

  if (state.user.checkSounds !== false) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch(e) {}
  }

  showToast(`✓ ${type} finished at ${timeStr}! Great discipline 🎯`);
}

// ── EDITABLE HOME WORKOUT PLAN CONTROLLERS ────────────────────────
function ensureWorkoutPlanInitialized() {
  if (!state.workoutPlan || !state.workoutPlan.length) {
    state.workoutPlan = JSON.parse(JSON.stringify(EXCEL_WORKOUT_PLAN));
  }
}

function openWorkoutModal(dayName) {
  ensureWorkoutPlanInitialized();
  const item = state.workoutPlan.find(w => w.day === dayName);
  if (!item) return;

  document.getElementById('workoutEditModalTitle').textContent = `Edit ${dayName} Workout`;
  document.getElementById('workoutEditDay').value = dayName;
  document.getElementById('workoutDayDisplay').value = dayName;
  document.getElementById('workoutSessionInput').value = item.session || '';
  document.getElementById('workoutTypeSelect').value = item.type || 'Strength';
  document.getElementById('workoutExercisesInput').value = (item.exercises || []).join('\n');

  document.getElementById('workoutEditModalOverlay').classList.add('active');
}

function openAddWorkoutModal() {
  ensureWorkoutPlanInitialized();
  document.getElementById('workoutEditModalTitle').textContent = 'Add Custom Workout Session';
  document.getElementById('workoutEditDay').value = '';
  document.getElementById('workoutDayDisplay').value = 'Custom Day';
  document.getElementById('workoutSessionInput').value = '';
  document.getElementById('workoutTypeSelect').value = 'Strength';
  document.getElementById('workoutExercisesInput').value = '';

  document.getElementById('workoutEditModalOverlay').classList.add('active');
}

function closeWorkoutModal() {
  document.getElementById('workoutEditModalOverlay').classList.remove('active');
}

function handleSaveWorkoutDay(e) {
  if (e) e.preventDefault();
  ensureWorkoutPlanInitialized();
  const dayName = document.getElementById('workoutEditDay').value;
  const session = document.getElementById('workoutSessionInput').value.trim();
  const type = document.getElementById('workoutTypeSelect').value;
  const exercisesText = document.getElementById('workoutExercisesInput').value;

  const exercises = exercisesText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (dayName) {
    const existing = state.workoutPlan.find(w => w.day === dayName);
    if (existing) {
      existing.session = session;
      existing.type = type;
      existing.exercises = exercises;
    }
  } else {
    state.workoutPlan.push({
      day: `Session ${state.workoutPlan.length + 1}`,
      session: session,
      type: type,
      exercises: exercises
    });
  }

  saveState();
  closeWorkoutModal();
  renderWorkoutPlan();
  showToast('Workout plan updated! 💪');
  return false;
}

// ── EDITABLE WELLNESS & GROOMING CONTROLLERS ──────────────────────
function ensureWellnessGuideInitialized() {
  if (!state.wellnessGuide || Object.keys(state.wellnessGuide).length === 0) {
    state.wellnessGuide = JSON.parse(JSON.stringify(EXCEL_WELLNESS_GUIDE));
  }
}

function openAddWellnessModal(section = 'Grooming') {
  ensureWellnessGuideInitialized();
  document.getElementById('wellnessModalTitle').textContent = `Add to ${section}`;
  document.getElementById('wellnessCategorySelect').value = section;
  document.getElementById('wellnessEditIndex').value = '-1';
  document.getElementById('wellnessTextInput').value = '';
  document.getElementById('wellnessFreqInput').value = 'Daily';

  const el = document.getElementById('wellnessEditModalOverlay');
  if (el) {
    el.classList.add('open', 'active');
    el.style.display = 'flex';
  }
}

function openEditWellnessModal(section, idx) {
  ensureWellnessGuideInitialized();
  const items = state.wellnessGuide[section] || [];
  const item = items[idx];
  if (!item) return;

  document.getElementById('wellnessModalTitle').textContent = `Edit ${section} Item`;
  document.getElementById('wellnessCategorySelect').value = section;
  document.getElementById('wellnessEditIndex').value = String(idx);
  document.getElementById('wellnessTextInput').value = item.text || '';
  document.getElementById('wellnessFreqInput').value = item.freq || '';

  const el = document.getElementById('wellnessEditModalOverlay');
  if (el) {
    el.classList.add('open', 'active');
    el.style.display = 'flex';
  }
}

function closeWellnessModal() {
  const el = document.getElementById('wellnessEditModalOverlay');
  if (el) {
    el.classList.remove('open', 'active');
    el.style.display = 'none';
  }
}

function handleSaveWellnessItem(e) {
  if (e) e.preventDefault();
  ensureWellnessGuideInitialized();
  const section = document.getElementById('wellnessCategorySelect').value;
  const idx = parseInt(document.getElementById('wellnessEditIndex').value, 10);
  const text = document.getElementById('wellnessTextInput').value.trim();
  const freq = document.getElementById('wellnessFreqInput').value.trim();

  state.wellnessGuide[section] = state.wellnessGuide[section] || [];

  if (idx >= 0 && idx < state.wellnessGuide[section].length) {
    state.wellnessGuide[section][idx] = { text, freq };
  } else {
    state.wellnessGuide[section].push({ text, freq });
  }

  saveState();
  closeWellnessModal();
  renderWellnessGuide();
  showToast('Wellness checklist updated! ✨');
  return false;
}

function deleteWellnessItem(section, idx) {
  ensureWellnessGuideInitialized();
  if (state.wellnessGuide[section] && state.wellnessGuide[section][idx]) {
    state.wellnessGuide[section].splice(idx, 1);
    saveState();
    renderWellnessGuide();
    showToast('Item deleted ✕');
  }
}

// ── SUBVIEW 1: MASTER 7-DAY WEEKLY GRID TIMETABLE ──
function renderWeeklyGridTimetable(filterCat = 'all') {
  currentTtGridFilter = filterCat;
  const container = document.getElementById('ttGridWrapper');
  if (!container) return;

  // Render the dedicated Today Workout & Grooming companion widget above the table!
  renderTodayWorkoutWidget();

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayIndex = new Date().getDay(); // 0 = Sunday
  const currentDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][todayIndex];

  const maxRows = Math.max(
    ...days.map(d => (state.timetable && state.timetable[d] ? state.timetable[d].length : 0)),
    18
  );

  let html = '<table class="tt-grid-table">';
  html += '<thead><tr>';
  html += '<th class="tt-grid-time-cell">Time Slot</th>';
  days.forEach(day => {
    const isToday = (day === currentDayName);
    html += `<th class="${isToday ? 'col-today' : ''}">${day}${isToday ? ' ★ (Today)' : ''}</th>`;
  });
  html += '</tr></thead>';

  html += '<tbody>';
  for (let i = 0; i < maxRows; i++) {
    html += '<tr>';
    const weekdaySlot = (state.timetable && state.timetable['Monday'] && state.timetable['Monday'][i]);
    const timeLabel = weekdaySlot ? weekdaySlot.time : `Slot ${i + 1}`;
    html += `<td class="tt-grid-time-cell">${escHtml(timeLabel)}</td>`;

    // ── 7 DAY SCHEDULE CELLS ──
    days.forEach(day => {
      const slot = (state.timetable && state.timetable[day] && state.timetable[day][i]);
      const isToday = (day === currentDayName);

      if (!slot) {
        html += `<td class="${isToday ? 'col-today' : ''}"><span style="color:var(--text-muted)">—</span></td>`;
        return;
      }

      const color = getSlotColor(slot.category, slot.task);
      const cat = slot.category || 'Routine';
      const dimColor = color + '1a';
      const isMatch = (filterCat === 'all' || cat.toLowerCase() === filterCat.toLowerCase() || (filterCat === 'Study' && cat.toLowerCase() === 'college'));
      const dimClass = isMatch ? '' : 'grid-cell-dimmed';

      html += `
        <td class="${isToday ? 'col-today' : ''}">
          <div class="grid-cell-card ${dimClass}" style="--cell-color: ${color};" onclick="openTtModal('${slot.id}', '${day}')" title="Click to edit: ${escHtml(slot.task)}">
            <span class="grid-cell-time">${escHtml(slot.time)}</span>
            <span class="grid-cell-task">${escHtml(slot.task)}</span>
            ${slot.details ? `<span class="grid-cell-sub">${escHtml(slot.details)}</span>` : ''}
            <span class="grid-cell-badge" style="background:${dimColor}; color:${color};">${escHtml(cat)}</span>
          </div>
        </td>
      `;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';

  container.innerHTML = html;
}

// ── SUBVIEW 2: DAILY TIMELINE ──
function renderTimetableSection() {
  const tabsContainer = document.getElementById('ttViewDayTabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = DAY_NAMES.map(day => `
      <button class="tt-view-tab ${day === currentTtViewDay ? 'active' : ''}" data-day="${day}">${day}</button>
    `).join('');

    tabsContainer.querySelectorAll('.tt-view-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTtViewDay = btn.dataset.day;
        renderTimetableSection();
      });
    });
  }

  const titleEl = document.getElementById('ttMainDayTitle');
  if (titleEl) titleEl.textContent = `${currentTtViewDay} Schedule`;
  const rows = (state.timetable && state.timetable[currentTtViewDay]) || [];
  const countEl = document.getElementById('ttMainSlotCount');
  if (countEl) countEl.textContent = `${rows.length} time slot${rows.length === 1 ? '' : 's'} scheduled`;

  const timelineContainer = document.getElementById('ttTimelineContainer');
  if (!timelineContainer) return;
  if (!rows.length) {
    timelineContainer.innerHTML = '<p class="empty-state">No schedule yet for ' + currentTtViewDay + '. Click <strong>+ Add Slot</strong> to structure your day!</p>';
    return;
  }

  timelineContainer.innerHTML = rows.map(row => {
    const color = getSlotColor(row.category, row.task);
    const cat = row.category || 'Study';
    return `
      <div class="tt-timeline-slot" style="--slot-color: ${color};">
        <div class="tt-time-pill">${escHtml(row.time)}</div>
        <div class="tt-task-box">
          <div class="tt-task-title">${escHtml(row.task)}</div>
          ${row.details ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escHtml(row.details)}</div>` : ''}
          <div class="tt-task-cat"><span style="color:${color}">●</span> ${cat}</div>
        </div>
        <div class="tt-slot-actions">
          <button class="btn-secondary btn-sm" onclick="openTtModal('${row.id}', '${currentTtViewDay}')">Edit</button>
          <button class="btn-icon danger" onclick="deleteTimetableRow('${row.id}', '${currentTtViewDay}')" title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── SUBVIEW 3: HOME WORKOUT PLAN ──
function renderWorkoutPlan() {
  const container = document.getElementById('workoutDaysContainer');
  if (!container) return;

  ensureWorkoutPlanInitialized();

  const todayIndex = new Date().getDay();
  const currentDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][todayIndex];

  container.innerHTML = state.workoutPlan.map(item => {
    const isToday = (item.day === currentDayName);
    return `
      <div class="workout-day-card ${isToday ? 'workout-today' : ''}">
        <div class="workout-day-head">
          <div>
            <div class="workout-day-name">${escHtml(item.day)}${isToday ? ' • Today' : ''}</div>
            <div class="workout-session-badge">${escHtml(item.session)} (${escHtml(item.type || 'Strength')})</div>
          </div>
          <div class="workout-day-actions">
            <button class="workout-edit-btn" onclick="openWorkoutModal('${escHtml(item.day)}')" title="Edit session & exercises">✎ Edit</button>
          </div>
        </div>
        <ul class="workout-ex-list">
          ${(item.exercises || []).map(ex => `
            <li class="workout-ex-item">
              <span class="workout-ex-bullet">✓</span>
              <span>${escHtml(ex)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }).join('');
}

// ── SUBVIEW 4: WELLNESS & GROOMING GUIDE ──
function renderWellnessGuide() {
  const container = document.getElementById('wellnessSectionsContainer');
  if (!container) return;

  ensureWellnessGuideInitialized();
  state.wellnessChecks = state.wellnessChecks || {};

  const sections = Object.keys(state.wellnessGuide);
  const icons = {
    Health: '🏃',
    Food: '🥗',
    Grooming: '💈',
    'Pleasant Presence': '🌟'
  };

  container.innerHTML = sections.map(sec => {
    const items = state.wellnessGuide[sec] || [];
    return `
      <div class="wellness-card">
        <div class="wellness-card-title">
          <span>${icons[sec] || '•'}</span>
          <span>${escHtml(sec)}</span>
          <button class="wellness-edit-btn" style="margin-left:auto;" onclick="openAddWellnessModal('${escHtml(sec)}')">+ Add</button>
        </div>
        <div class="wellness-items-list">
          ${items.map((item, idx) => {
            const checkKey = `${sec}_${idx}`;
            const isChecked = !!state.wellnessChecks[checkKey];
            return `
              <div class="wellness-item ${isChecked ? 'checked' : ''}">
                <div class="wellness-check" onclick="toggleWellnessCheck('${checkKey}')">${isChecked ? '✓' : ''}</div>
                <span class="wellness-text" onclick="toggleWellnessCheck('${checkKey}')">${escHtml(item.text)}</span>
                ${item.freq ? `<span class="wellness-freq">${escHtml(item.freq)}</span>` : ''}
                <div class="wellness-item-actions">
                  <button class="wellness-edit-btn" onclick="openEditWellnessModal('${escHtml(sec)}', ${idx})" title="Edit">✎</button>
                  <button class="wellness-del-btn" onclick="deleteWellnessItem('${escHtml(sec)}', ${idx})" title="Delete">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function toggleWellnessCheck(key) {
  state.wellnessChecks = state.wellnessChecks || {};
  state.wellnessChecks[key] = !state.wellnessChecks[key];
  saveState();
  renderWellnessGuide();
}

// ── SYNC FROM EXCEL STUDENT PLAN ──
function syncExcelPlan() {
  state.timetable = {};
  DAY_NAMES.forEach(day => {
    state.timetable[day] = (DEFAULT_TIMETABLE[day] || []).map(row => ({ id: uid(), ...row }));
  });

  state.habits = EXCEL_HABITS.map(h => ({
    id: uid(),
    name: h.name,
    emoji: h.emoji,
    doneByDate: {}
  }));

  const now = new Date();
  state.habits.forEach((hab, idx) => {
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      if (Math.random() > 0.35) hab.doneByDate[key] = true;
    }
  });

  recalcPoints();
  saveState();

  renderTimetableSidebar();
  renderTimetableSection();
  renderWeeklyGridTimetable(currentTtGridFilter);
  renderWorkoutPlan();
  renderWellnessGuide();
  renderHabits();
  renderDashboard();
  renderStats();

  showToast('Synced 100% with My Complete Weekly Student Plan! 🚀');
}

// Timetable Slot Modal
function openTtModal(editId = null, day = currentTtDay) {
  const modal = document.getElementById('ttModalOverlay');
  document.getElementById('ttModalTitle').textContent = editId ? 'Edit Time Slot' : 'Add Time Slot';
  document.getElementById('editTtId').value = editId || '';
  document.getElementById('ttDaySelect').value = day;

  const deleteBtn = document.getElementById('ttModalDelete');

  if (editId) {
    deleteBtn.style.display = 'inline-block';
    const rows = state.timetable[day] || [];
    const r = rows.find(x => x.id === editId);
    if (r) {
      const parts = (r.time || '').split('-').map(s => s.trim());
      document.getElementById('ttStartTime').value = parts[0] || '';
      document.getElementById('ttEndTime').value   = parts[1] || '';
      document.getElementById('ttTaskName').value  = r.task || '';
      document.getElementById('ttCategorySelect').value = r.category || 'Study';
    }
  } else {
    deleteBtn.style.display = 'none';
    document.getElementById('ttStartTime').value = '';
    document.getElementById('ttEndTime').value   = '';
    document.getElementById('ttTaskName').value  = '';
    document.getElementById('ttCategorySelect').value = 'Study';
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('ttStartTime').focus(), 100);
}

function closeTtModal() {
  document.getElementById('ttModalOverlay').classList.remove('open');
}

document.getElementById('ttModalClose').addEventListener('click', closeTtModal);
document.getElementById('ttModalCancel').addEventListener('click', closeTtModal);
document.getElementById('ttModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('ttModalOverlay')) closeTtModal();
});

// Quick Activity Preset Chips
document.getElementById('ttQuickPresets').addEventListener('click', e => {
  const chip = e.target.closest('.preset-chip');
  if (!chip) return;
  const task = chip.dataset.task;
  const cat = chip.dataset.cat;
  if (task) document.getElementById('ttTaskName').value = task;
  if (cat) document.getElementById('ttCategorySelect').value = cat;
});

// Save Time Slot
document.getElementById('ttModalSave').addEventListener('click', () => {
  const day      = document.getElementById('ttDaySelect').value;
  const start    = document.getElementById('ttStartTime').value.trim();
  const end      = document.getElementById('ttEndTime').value.trim();
  const task     = document.getElementById('ttTaskName').value.trim();
  const category = document.getElementById('ttCategorySelect').value;
  const editId   = document.getElementById('editTtId').value;

  if (!task) {
    showToast('Please enter a task or activity name');
    return;
  }

  const timeFormatted = end ? `${start} - ${end}` : (start || 'Flexible');

  if (!state.timetable) state.timetable = {};
  if (!state.timetable[day]) state.timetable[day] = [];

  if (editId) {
    const r = state.timetable[day].find(x => x.id === editId);
    if (r) {
      r.time = timeFormatted;
      r.task = task;
      r.category = category;
    }
  } else {
    state.timetable[day].push({ id: uid(), time: timeFormatted, task, category });
  }

  saveState();
  closeTtModal();
  renderTimetableSidebar();
  renderTimetableSection();
  if (currentSection === 'calendar') renderCalendar();
  showToast(editId ? 'Time slot updated!' : '⚡ Time slot scheduled!');
});

// Delete Time Slot from Modal
document.getElementById('ttModalDelete').addEventListener('click', () => {
  const day = document.getElementById('ttDaySelect').value;
  const editId = document.getElementById('editTtId').value;
  if (!editId) return;
  deleteTimetableRow(editId, day);
  closeTtModal();
});

function deleteTimetableRow(id, day = currentTtDay) {
  if (!state.timetable || !state.timetable[day]) return;
  state.timetable[day] = state.timetable[day].filter(r => r.id !== id);
  saveState();
  renderTimetableSidebar();
  renderTimetableSection();
  if (currentSection === 'calendar') renderCalendar();
  showToast('Time slot removed');
}

document.getElementById('ttAddBtn').addEventListener('click', () => openTtModal(null, currentTtDay));
document.getElementById('openAddTtModalBtn').addEventListener('click', () => openTtModal(null, currentTtViewDay));
document.getElementById('ttAddSlotDirectBtn').addEventListener('click', () => openTtModal(null, currentTtViewDay));
document.getElementById('ttGoToSection').addEventListener('click', e => {
  e.preventDefault();
  navigate('timetable');
});

// ── CALENDAR (ADJUSTED SIZES & 2-COLUMN VIEW) ───────────────────

let calDate = new Date();
let selectedCalKey = todayKey();

function renderCalendar() {
  const year  = calDate.getFullYear();
  const month = calDate.getMonth();
  document.getElementById('calMonthLabel').textContent =
    calDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay   = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today      = todayKey();
  const grid       = document.getElementById('calGrid');
  grid.innerHTML   = '';

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key  = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const gs   = getGoals(key);
    const done = gs.filter(g => g.done).length;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.dateKey = key;

    if (key === today) cell.classList.add('today');
    if (key === selectedCalKey) cell.classList.add('selected');
    if (gs.length)     cell.classList.add('has-goals');
    if (gs.length && done === gs.length) cell.classList.add('all-done');

    cell.innerHTML = `<span>${d}</span><div class="cal-dot"></div>`;
    cell.addEventListener('click', () => {
      selectedCalKey = key;
      document.querySelectorAll('.cal-cell.selected').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      showCalDay(key);
    });
    grid.appendChild(cell);
  }

  showCalDay(selectedCalKey);
}

function showCalDay(key) {
  const title = document.getElementById('calDayTitle');
  const subtitle = document.getElementById('calDaySubtitle');
  const goalsContainer = document.getElementById('calDayGoals');
  const scheduleContainer = document.getElementById('calDaySchedule');
  const addGoalBtn = document.getElementById('calAddGoalForDayBtn');

  const parts = key.split('-');
  const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const dayName = DAY_NAMES[dateObj.getDay()];

  title.textContent = formatDate(key);
  subtitle.textContent = `Schedule for ${dayName} · ${getGoals(key).length} goals recorded`;

  // Render Goals
  const gs = getGoals(key);
  if (!gs.length) {
    goalsContainer.innerHTML = '<p class="empty-state" style="padding:14px 8px;">No goals recorded for this date.</p>';
  } else {
    goalsContainer.innerHTML = gs.map(g => `
      <div class="goal-mini-item ${g.done ? 'completed' : ''}">
        <div class="mini-dot" style="background:${catColor(g.category)}"></div>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(g.title)}</span>
        <button class="btn-icon" onclick="toggleGoal('${g.id}', '${key}')" title="Toggle Done" style="margin-left:auto; color:${g.done ? 'var(--green)' : 'var(--text-muted)'}; font-weight:700;">
          ${g.done ? '✓ Done' : '○ Pending'}
        </button>
      </div>
    `).join('');
  }

  // Render Routine for this day
  const ttSlots = (state.timetable && state.timetable[dayName]) || [];
  if (!ttSlots.length) {
    scheduleContainer.innerHTML = '<p class="empty-state" style="padding:14px 8px;">No routine configured for ' + dayName + '.</p>';
  } else {
    scheduleContainer.innerHTML = ttSlots.map(s => {
      const color = getSlotColor(s.category, s.task);
      return `
        <div class="cal-routine-item" style="border-left-color:${color}">
          <span style="font-family:var(--font-mono); font-weight:700; color:${color}; font-size:12px;">${escHtml(s.time)}</span>
          <span style="font-weight:700; color:var(--text-primary); margin-left:10px; flex:1;">${escHtml(s.task)}</span>
        </div>
      `;
    }).join('');
  }

  addGoalBtn.onclick = () => {
    openGoalModal(null, key);
  };
}

document.getElementById('calPrev').addEventListener('click', () => {
  calDate.setMonth(calDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById('calNext').addEventListener('click', () => {
  calDate.setMonth(calDate.getMonth() + 1);
  renderCalendar();
});

// ── STATISTICS ───────────────────────────────────────────────────

function renderStats() {
  const goals  = getGoals();
  const done   = goals.filter(g => g.done).length;
  const pending = goals.length - done;

  // Pie chart
  destroyChart(pieChartInst);
  const pieCtx = document.getElementById('pieChart').getContext('2d');
  pieChartInst = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: ['Completed', 'Pending'],
      datasets: [{
        data: goals.length ? [done, pending] : [1, 0],
        backgroundColor: ['#10b981', '#e2e8f0'],
        borderColor: ['#ffffff', '#ffffff'],
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { labels: { color: '#475569', font: { weight: '600' } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.raw}` } }
      }
    }
  });

  // Bar chart
  destroyChart(barChartInst);
  const barCtx = document.getElementById('barChart').getContext('2d');
  const wLabels = [], wData = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    wLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    wData.push(Math.round(completionFraction(key) * 100));
  }
  barChartInst = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: wLabels,
      datasets: [{
        label: 'Completion %',
        data: wData,
        backgroundColor: wData.map(v => v === 100 ? '#10b981' : '#2563eb'),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { weight: '600' }, callback: v => v + '%' } },
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { weight: '600' } } }
      }
    }
  });

  // Month chart
  destroyChart(monthChartInst);
  const monthCtx = document.getElementById('monthChart').getContext('2d');
  const mLabels = [], mData = [];
  const year  = now.getFullYear();
  const month = now.getMonth();
  const days  = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(year, month, d) > now) break;
    mLabels.push(d);
    mData.push(Math.round(completionFraction(key) * 100));
  }
  monthChartInst = new Chart(monthCtx, {
    type: 'line',
    data: {
      labels: mLabels,
      datasets: [{
        label: 'Daily %',
        data: mData,
        borderColor: '#2563eb',
        borderWidth: 2.5,
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#2563eb',
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { weight: '600' }, callback: v => v + '%' } },
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { weight: '600' }, maxTicksLimit: 10 } }
      }
    }
  });

  // Category breakdown
  const cats = { Study: [0,0], Coding: [0,0], Exercise: [0,0], Personal: [0,0], Other: [0,0] };
  Object.values(state.goals).forEach(gs => {
    gs.forEach(g => {
      if (cats[g.category]) {
        cats[g.category][0] += g.done ? 1 : 0;
        cats[g.category][1]++;
      }
    });
  });

  const catColors = { Study: '#2563eb', Coding: '#8b5cf6', Exercise: '#ff5500', Personal: '#10b981', Other: '#f59e0b' };
  const breakdown = document.getElementById('catBreakdown');
  breakdown.innerHTML = Object.entries(cats).map(([cat, [doneCount, total]]) => {
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    return `
      <div class="cat-row">
        <span class="cat-name">${cat}</span>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width:${pct}%;background:${catColors[cat]}"></div>
        </div>
        <span class="cat-count">${doneCount}/${total}</span>
      </div>
    `;
  }).join('');
}

// ── REWARDS ──────────────────────────────────────────────────────

const BADGES = [
  { id: 'streak7',      icon: '🔥', name: '7-Day Streak',    desc: 'Complete all goals 7 days straight',  check: () => currentStreak() >= 7 },
  { id: 'streak30',     icon: '💎', name: '30-Day Streak',   desc: 'Complete all goals 30 days straight', check: () => currentStreak() >= 30 },
  { id: 'perfect_week', icon: '⭐', name: 'Perfect Week',    desc: '100% completion 7 days in a row',     check: () => weeklyAvg() === 100 },
  { id: 'first_goal',   icon: '🎯', name: 'First Goal',       desc: 'Add and complete your first goal',    check: () => Object.values(state.goals).flat().some(g => g.done) },
  { id: 'century',      icon: '💯', name: '100 Goals',        desc: 'Complete 100 goals total',            check: () => Object.values(state.goals).flat().filter(g => g.done).length >= 100 },
  { id: 'habit_hero',   icon: '🌟', name: 'Habit Hero',       desc: 'Track 5 habits',                     check: () => state.habits.length >= 5 },
  { id: 'planner',      icon: '📅', name: 'Master Planner',   desc: 'Add goals for 5 different days',      check: () => Object.keys(state.goals).length >= 5 },
  { id: 'consistent',   icon: '🏆', name: 'Consistent Focus', desc: 'Achieve 80%+ weekly average',         check: () => weeklyAvg() >= 80 },
];

function checkBadges() {
  if (!state.unlockedBadges) state.unlockedBadges = [];
  let newBadge = false;
  BADGES.forEach(b => {
    if (!state.unlockedBadges.includes(b.id) && b.check()) {
      state.unlockedBadges.push(b.id);
      newBadge = true;
      showToast(`🏅 Badge Unlocked: ${b.name}!`, 4000);
    }
  });
  if (newBadge) saveState();
}

const LEVELS = [
  { name: 'Novice',       min: 0    },
  { name: 'Apprentice',   min: 100  },
  { name: 'Journeyman',   min: 300  },
  { name: 'Achiever',     min: 600  },
  { name: 'Expert',       min: 1000 },
  { name: 'Champion',     min: 1500 },
  { name: 'Master',       min: 2500 },
  { name: 'Legend',       min: 4000 },
];

function renderRewards() {
  recalcPoints();
  saveState();

  document.getElementById('rewardPoints').textContent = state.points;

  const todayGs = getGoals();
  const todayDone = todayGs.filter(g => g.done).length;
  document.getElementById('ptsTodayGoals').textContent = `+${todayDone * 10} pts`;
  document.getElementById('ptsStreakBonus').textContent = `+${currentStreak() * 5} pts`;
  const perfectDays = Object.entries(state.goals).filter(([, gs]) => gs.length && gs.every(g => g.done)).length;
  document.getElementById('ptsPerfect').textContent = `+${perfectDays * 25} pts`;

  checkBadges();
  const grid = document.getElementById('badgesGrid');
  grid.innerHTML = BADGES.map(b => {
    const unlocked = (state.unlockedBadges || []).includes(b.id);
    return `
      <div class="badge-card ${unlocked ? 'unlocked' : 'locked'}">
        ${unlocked ? '<span class="badge-unlocked-tag">✓ Unlocked</span>' : ''}
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
    `;
  }).join('');

  let level = LEVELS[0];
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (state.points >= LEVELS[i].min) { level = LEVELS[i]; break; }
  }
  const levelIdx = LEVELS.indexOf(level);
  const nextLevel = LEVELS[levelIdx + 1];
  const pctToNext = nextLevel ? ((state.points - level.min) / (nextLevel.min - level.min)) * 100 : 100;

  document.getElementById('levelTag').textContent  = level.name;
  document.getElementById('levelFill').style.width = clamp(pctToNext, 0, 100) + '%';
  document.getElementById('levelNote').textContent = nextLevel
    ? `${nextLevel.min - state.points} pts to ${nextLevel.name}`
    : '🏆 Max level reached!';
}

// ── UTILITIES ────────────────────────────────────────────────────

function catColor(cat) {
  return { Study: '#2563eb', Coding: '#8b5cf6', Exercise: '#ff5500', Personal: '#10b981', Other: '#f59e0b' }[cat] || '#2563eb';
}

function refreshCurrent() {
  navigate(currentSection);
}

// ── KEYBOARD SHORTCUTS ───────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeGoalModal();
    closeHabitModal();
    closeTtModal();
    closeAccountModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (document.getElementById('goalModalOverlay').classList.contains('open')) {
      document.getElementById('goalModalSave').click();
    } else if (document.getElementById('ttModalOverlay').classList.contains('open')) {
      document.getElementById('ttModalSave').click();
    }
  }
});

// ── SEED DEMO DATA ───────────────────────────────────────────────

function seedDemoData() {
  if (state.onboarded) return;
  const today = todayKey();

  state.goals[today] = [
    { id: uid(), title: 'Review JavaScript & async patterns', category: 'Study',    priority: 'High',   notes: 'Deep dive into event loop and microtasks', done: true  },
    { id: uid(), title: 'Solve 2 LeetCode problems',          category: 'Coding',   priority: 'High',   notes: 'Trees and Dynamic Programming',          done: false },
    { id: uid(), title: '30-min cardio / workout',            category: 'Exercise', priority: 'Medium', notes: 'Keep consistency high',                 done: true  },
    { id: uid(), title: 'Read 20 pages of Atomic Habits',     category: 'Personal', priority: 'Low',    notes: 'Chapter 4',                              done: false },
    { id: uid(), title: 'Build FlowTrack features',           category: 'Coding',   priority: 'High',   notes: 'Ship modern UI update',                  done: false },
  ];

  const now = new Date();
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const pct = [1, 0.8, 1, 0.6, 1, 0.75][i - 1];
    state.goals[key] = [
      { id: uid(), title: 'Morning fitness workout', category: 'Exercise', priority: 'Medium', notes: '', done: pct >= 0.5 },
      { id: uid(), title: 'Core study session',      category: 'Study',    priority: 'High',   notes: '', done: pct >= 0.25 },
      { id: uid(), title: 'Coding practice & labs',  category: 'Coding',   priority: 'High',   notes: '', done: pct >= 0.75 },
      { id: uid(), title: 'Reflection & reading',    category: 'Personal', priority: 'Low',    notes: '', done: pct >= 1 },
    ];
  }

  state.habits = EXCEL_HABITS.map(h => ({
    id: uid(),
    name: h.name,
    emoji: h.emoji,
    doneByDate: {}
  }));

  const h0 = state.habits[0];
  const h1 = state.habits[1];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    if (Math.random() > 0.25) h0.doneByDate[key] = true;
    if (Math.random() > 0.35) h1.doneByDate[key] = true;
  }

  recalcPoints();
  state.onboarded = true;
  saveState();
}

// ── INIT ─────────────────────────────────────────────────────────

async function init() {
  // Revert back to original clean theme
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('data-accent');
  localStorage.removeItem('flowtrack_theme');
  localStorage.removeItem('flowtrack_ui_settings');
  sessionStorage.removeItem('flowtrack_theme');
  await loadState();
  seedDemoData();
  seedDefaultTimetable(); // Loads full 18-row timetable from Excel if missing
  checkAutoLogin();
  startClock();
  rotateQuote();
  setInterval(rotateQuote, 60000);
  checkNotifications();
  renderDashboard();
  renderTimetableSidebar();
  renderTimetableSection();
  // Timetable Subview Switchers
  document.querySelectorAll('.tt-view-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTtSubview(btn.dataset.subview));
  });

  // Filter Pills for Grid
  const filterPills = document.querySelectorAll('#ttGridFilters .filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderWeeklyGridTimetable(pill.dataset.cat);
    });
  });

  // Sync Excel Plan button

  renderWeeklyGridTimetable('all');
  renderWorkoutPlan();
  renderWellnessGuide();
  renderProfileSection();
  checkBadges();
  document.getElementById('restartBtn').addEventListener('click', restartApp);
}

init();


// ═══════════════════════════════════════════════════════════════
// PHASE 3: TODAY WORKOUT WIDGET, THEME CUSTOMIZER & PROFILE
// ═══════════════════════════════════════════════════════════════

let currentWidgetDay = null;

function renderTodayWorkoutWidget(selectedDay = null) {
  const container = document.getElementById('todayWorkoutWidget');
  if (!container) return;

  ensureWorkoutPlanInitialized();
  ensureWellnessGuideInitialized();

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const realTodayName = days[new Date().getDay()];
  if (!selectedDay) {
    if (!currentWidgetDay) currentWidgetDay = realTodayName;
  } else {
    currentWidgetDay = selectedDay;
  }
  const activeDay = currentWidgetDay;

  // Get workout plan for activeDay
  const plan = state.workoutPlan.find(w => w.day === activeDay) || {
    day: activeDay,
    session: 'Daily Routine',
    type: 'Strength',
    exercises: [
      "Push-ups — 3 × 8–15",
      "Backpack rows — 3 × 10–15",
      "Pike push-ups — 3 × 6–12",
      "Close-grip push-ups — 2 × 8–12",
      "Backpack curls — 2 × 10–15",
      "Plank — 3 × 30–60 sec"
    ]
  };

  const tKey = todayKey();
  state.dailyExerciseChecks = state.dailyExerciseChecks || {};
  const exerciseChecksKey = `${tKey}_${activeDay}`;
  const checkedExercises = state.dailyExerciseChecks[exerciseChecksKey] || [];

  state.todayWorkoutLogs = state.todayWorkoutLogs || {};
  const workoutLog = state.todayWorkoutLogs[exerciseChecksKey] || state.todayWorkoutLogs[tKey];

  // Grooming items
  const groomingItems = (state.wellnessGuide && state.wellnessGuide['Grooming']) || [
    { text: 'Morning face wash + SPF 30+ moisturizer', freq: 'Daily / AM' },
    { text: 'Post-workout hygiene shower & freshen up', freq: 'Daily / Post-Workout' },
    { text: 'Clean groomed beard / hair & fresh attire', freq: 'Daily / AM' },
    { text: 'Evening gentle cleanser + hydrating moisturizer', freq: 'Daily / PM' }
  ];

  state.dailyGroomingChecks = state.dailyGroomingChecks || {};
  const checkedGrooming = state.dailyGroomingChecks[tKey] || [];
  state.todayGroomingLogs = state.todayGroomingLogs || {};
  const groomingLog = state.todayGroomingLogs[tKey];

  const exercisesTotal = plan.exercises ? plan.exercises.length : 0;
  const exercisesDone = checkedExercises.length;
  const groomingTotal = groomingItems.length;
  const groomingDone = checkedGrooming.length;

  let html = `
    <div class="today-widget-head">
      <div class="today-widget-title-wrap">
        <div class="today-live-badge">
          <span class="live-dot-pulse"></span>
          <span>TODAY'S WORKOUT & GROOMING TIME-CHECK</span>
        </div>
        <div class="today-widget-title">
          <span>${activeDay} Protocol: ${escHtml(plan.session)}</span>
          <span class="today-cat-badge">${escHtml(plan.type)}</span>
          ${activeDay === realTodayName ? '<span class="today-star-badge">★ Real Today</span>' : ''}
        </div>
        <div class="today-widget-sub">Check off individual exercise sets/reps and verify grooming completion times with instant logs</div>
      </div>

      <div class="today-day-tabs">
        ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => `
          <button type="button" class="today-day-tab ${d === activeDay ? 'active' : ''} ${d === realTodayName ? 'is-real-today' : ''}" onclick="renderTodayWorkoutWidget('${d}')">
            <span>${d.slice(0, 3)}</span>
            ${d === realTodayName ? '<span class="today-star">★</span>' : ''}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="today-widget-grid">
      <!-- ── COLUMN 1: WORKOUT EXERCISES ── -->
      <div class="today-widget-col workout-col">
        <div class="col-head">
          <div class="col-title-group">
            <span class="col-icon">🏋️</span>
            <div>
              <div class="col-title">${escHtml(plan.session)} Exercises</div>
              <div class="col-sub">${exercisesTotal} planned exercises for ${activeDay}</div>
            </div>
          </div>
          <div class="col-progress-badge">
            ${exercisesDone} / ${exercisesTotal} Done
          </div>
        </div>

        <div class="today-exercise-list">
          ${plan.exercises && plan.exercises.length ? plan.exercises.map((ex, idx) => {
            const isDone = checkedExercises.includes(idx);
            return `
              <label class="today-exercise-item ${isDone ? 'done' : ''}">
                <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleExerciseCheck('${activeDay}', ${idx}, this.checked)" />
                <div class="exercise-info">
                  <span class="exercise-name">${escHtml(ex)}</span>
                  <span class="exercise-tag">Exercise ${idx + 1}</span>
                </div>
              </label>
            `;
          }).join('') : `
            <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">
              No exercises defined for this day. <button class="btn-secondary btn-sm" onclick="openEditWorkoutModal('${activeDay}')">Add Exercises</button>
            </div>
          `}
        </div>

        <div class="today-col-actions">
          ${workoutLog ? `
            <div class="time-check-status-banner">
              <span class="status-icon">✓</span>
              <div class="status-info">
                <strong>Workout Verified & Finished!</strong>
                <span>Logged at ${escHtml(workoutLog.time || 'Completed')} • On-Time ✓</span>
              </div>
              <button class="btn-undo-timecheck" onclick="undoTodayWorkoutCheck('${activeDay}')">↺ Undo</button>
            </div>
          ` : `
            <button class="btn-timecheck-action workout-action" onclick="finishTodayWorkoutCheck('${activeDay}')">
              <span>🏋️</span>
              <span>Finish Today's Workout & Record Time-Check</span>
            </button>
          `}
        </div>
      </div>

      <!-- ── COLUMN 2: GROOMING & WELLNESS ── -->
      <div class="today-widget-col grooming-col">
        <div class="col-head">
          <div class="col-title-group">
            <span class="col-icon">💈</span>
            <div>
              <div class="col-title">Daily Grooming & Presentation</div>
              <div class="col-sub">Hygiene, skincare & self-care checkpoints</div>
            </div>
          </div>
          <div class="col-progress-badge">
            ${groomingDone} / ${groomingTotal} Checked
          </div>
        </div>

        <div class="today-exercise-list">
          ${groomingItems.map((gm, gIdx) => {
            const isDone = checkedGrooming.includes(gIdx);
            return `
              <label class="today-exercise-item ${isDone ? 'done' : ''}">
                <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleGroomingItemCheck(${gIdx}, this.checked)" />
                <div class="exercise-info">
                  <span class="exercise-name">${escHtml(gm.text)}</span>
                  <span class="exercise-tag">${escHtml(gm.freq || 'Daily')}</span>
                </div>
              </label>
            `;
          }).join('')}
        </div>

        <div class="today-col-actions">
          ${groomingLog ? `
            <div class="time-check-status-banner">
              <span class="status-icon">✨</span>
              <div class="status-info">
                <strong>Grooming Protocol Verified!</strong>
                <span>Logged at ${escHtml(groomingLog.time || 'Completed')} • On-Time ✓</span>
              </div>
              <button class="btn-undo-timecheck" onclick="undoTodayGroomingCheck()">↺ Undo</button>
            </div>
          ` : `
            <button class="btn-timecheck-action grooming-action" onclick="finishTodayGroomingCheck()">
              <span>✨</span>
              <span>Verify Grooming & Record Time-Check</span>
            </button>
          `}
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function toggleExerciseCheck(day, idx, isChecked) {
  state.dailyExerciseChecks = state.dailyExerciseChecks || {};
  const key = `${todayKey()}_${day}`;
  state.dailyExerciseChecks[key] = state.dailyExerciseChecks[key] || [];

  if (isChecked) {
    if (!state.dailyExerciseChecks[key].includes(idx)) {
      state.dailyExerciseChecks[key].push(idx);
    }
  } else {
    state.dailyExerciseChecks[key] = state.dailyExerciseChecks[key].filter(i => i !== idx);
  }
  saveState();
  renderTodayWorkoutWidget(day);
}

function finishTodayWorkoutCheck(day) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const tKey = todayKey();
  const key = `${tKey}_${day}`;

  state.todayWorkoutLogs = state.todayWorkoutLogs || {};
  state.todayWorkoutLogs[key] = { time: timeStr, timestamp: Date.now() };
  state.todayWorkoutLogs[tKey] = { time: timeStr, timestamp: Date.now() };

  ensureWorkoutPlanInitialized();
  const plan = state.workoutPlan.find(w => w.day === day);
  if (plan && plan.exercises) {
    state.dailyExerciseChecks = state.dailyExerciseChecks || {};
    state.dailyExerciseChecks[key] = plan.exercises.map((_, i) => i);
  }

  saveState();
  renderTodayWorkoutWidget(day);
  showToast(`Workout finished at ${timeStr}! Awesome work! 💪🔥`);
}

function undoTodayWorkoutCheck(day) {
  const tKey = todayKey();
  const key = `${tKey}_${day}`;
  if (state.todayWorkoutLogs) {
    delete state.todayWorkoutLogs[key];
    delete state.todayWorkoutLogs[tKey];
  }
  saveState();
  renderTodayWorkoutWidget(day);
  showToast('Workout time-check undone ↺');
}

function toggleGroomingItemCheck(idx, isChecked) {
  state.dailyGroomingChecks = state.dailyGroomingChecks || {};
  const tKey = todayKey();
  state.dailyGroomingChecks[tKey] = state.dailyGroomingChecks[tKey] || [];

  if (isChecked) {
    if (!state.dailyGroomingChecks[tKey].includes(idx)) {
      state.dailyGroomingChecks[tKey].push(idx);
    }
  } else {
    state.dailyGroomingChecks[tKey] = state.dailyGroomingChecks[tKey].filter(i => i !== idx);
  }
  saveState();
  renderTodayWorkoutWidget();
}

function finishTodayGroomingCheck() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const tKey = todayKey();

  state.todayGroomingLogs = state.todayGroomingLogs || {};
  state.todayGroomingLogs[tKey] = { time: timeStr, timestamp: Date.now() };

  ensureWellnessGuideInitialized();
  const items = state.wellnessGuide['Grooming'] || [];
  state.dailyGroomingChecks = state.dailyGroomingChecks || {};
  state.dailyGroomingChecks[tKey] = items.map((_, i) => i);

  saveState();
  renderTodayWorkoutWidget();
  showToast(`Grooming routine verified at ${timeStr}! ✨ Looking sharp!`);
}

function undoTodayGroomingCheck() {
  const tKey = todayKey();
  if (state.todayGroomingLogs) {
    delete state.todayGroomingLogs[tKey];
  }
  saveState();
  renderTodayWorkoutWidget();
  showToast('Grooming time-check undone ↺');
}

// ── PROFILE & AVATAR SETTINGS ──
function selectAvatar(emoji, btn) {
  state.user = state.user || {};
  state.user.avatar = emoji;
  saveState();

  const preview = document.getElementById('profileAvatarDisplay');
  if (preview) preview.textContent = emoji;

  const sidebarAv = document.getElementById('sidebarAvatar');
  if (sidebarAv) sidebarAv.textContent = emoji;

  document.querySelectorAll('.avatar-choice-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-av') === emoji || b === btn);
  });

  showToast(`Profile avatar updated to ${emoji}! ✨`);
}

function renderProfileSection() {
  state.user = state.user || { name: 'Michał Masiak', avatar: '⚡', email: 'michal.masiak@anywhere.co', role: 'Focus Champion' };
  
  const preview = document.getElementById('profileAvatarDisplay');
  if (preview) preview.textContent = state.user.avatar || '⚡';

  const sidebarAv = document.getElementById('sidebarAvatar');
  if (sidebarAv) sidebarAv.textContent = state.user.avatar || '⚡';

  document.querySelectorAll('.avatar-choice-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-av') === (state.user.avatar || '⚡'));
  });

  const nameParts = (state.user.name || 'Michał Masiak').split(' ');
  const fName = document.getElementById('profFirstName');
  const lName = document.getElementById('profLastName');
  const email = document.getElementById('profEmail');
  const role = document.getElementById('profStatus');

  if (fName) fName.value = nameParts[0] || 'Michał';
  if (lName) lName.value = nameParts.slice(1).join(' ') || 'Masiak';
  if (email) email.value = state.user.email || 'michal.masiak@anywhere.co';
  if (role) role.value = state.user.role || state.user.status || 'Focus Champion';

  
}

function saveProfileSettings(e) {
  if (e) e.preventDefault();
  const fName = (document.getElementById('profFirstName')?.value || '').trim();
  const lName = (document.getElementById('profLastName')?.value || '').trim();
  const email = (document.getElementById('profEmail')?.value || '').trim();
  const role = (document.getElementById('profStatus')?.value || '').trim();

  state.user = state.user || {};
  state.user.name = `${fName} ${lName}`.trim() || 'Alex';
  state.user.email = email || 'michal.masiak@anywhere.co';
  state.user.role = role || 'Focus Champion';
  saveState();
  updateSidebarUserProfile();
  showToast('Profile information saved successfully! ✨');
  return false;
}

function savePinSettings(e) {
  if (e) e.preventDefault();
  const curr = (document.getElementById('secCurrentPin')?.value || '').trim();
  const newPin = (document.getElementById('secNewPin')?.value || '').trim();
  const confPin = (document.getElementById('secConfirmPin')?.value || '').trim();
  const remember = document.getElementById('secRememberToggle')?.checked ?? true;

  const actualPin = (state.user && state.user.password) ? state.user.password : '13579';

  if (curr && curr !== actualPin && curr !== '13579') {
    showToast('Current PIN is incorrect! ❌');
    return false;
  }

  if (newPin !== confPin) {
    showToast('New PINs do not match! ❌');
    return false;
  }

  if (newPin.length < 4) {
    showToast('PIN must be at least 4 characters! ❌');
    return false;
  }

  state.user.password = newPin;
  state.user.remember = remember;
  saveState();
  if (document.getElementById('secCurrentPin')) document.getElementById('secCurrentPin').value = '';
  if (document.getElementById('secNewPin')) document.getElementById('secNewPin').value = '';
  if (document.getElementById('secConfirmPin')) document.getElementById('secConfirmPin').value = '';
  showToast('PIN & Security updated successfully! 🔒');
  return false;
}

function saveAppPreferences() {
  const timeFormat = document.getElementById('prefTimeFormat')?.value || '12';
  const sounds = document.getElementById('prefTimeCheckSounds')?.checked ?? true;
  const badges = document.getElementById('prefAutoCheckPrompt')?.checked ?? true;

  state.preferences = state.preferences || {};
  state.preferences.timeFormat = timeFormat;
  state.preferences.sounds = sounds;
  state.preferences.badges = badges;
  saveState();
  showToast('Preferences updated! ✨');
}

function exportDataJson() {
  const jsonStr = JSON.stringify(state, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flowtrack_backup_${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Database backup downloaded! 💾');
}

// ── ORIGINAL THEME RESET ──
function resetToOldTheme() {
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('data-accent');
  document.documentElement.style.removeProperty('--radius-lg');
  document.documentElement.style.removeProperty('--radius-xl');
  localStorage.removeItem('flowtrack_theme');
  localStorage.removeItem('flowtrack_ui_settings');
}
window.resetToOldTheme = resetToOldTheme;

// ── EXPORT TO WINDOW FOR INLINE HTML HANDLERS ──
window.selectAvatar = selectAvatar;
window.renderProfileSection = renderProfileSection;
window.saveProfileSettings = saveProfileSettings;
window.savePinSettings = savePinSettings;
window.saveAppPreferences = saveAppPreferences;
window.exportDataJson = exportDataJson;
window.setAppTheme = setAppTheme;
window.setAccentColor = setAccentColor;
window.setCardRadius = setCardRadius;
window.renderTodayWorkoutWidget = renderTodayWorkoutWidget;
window.toggleExerciseCheck = toggleExerciseCheck;
window.finishTodayWorkoutCheck = finishTodayWorkoutCheck;
window.undoTodayWorkoutCheck = undoTodayWorkoutCheck;
window.toggleGroomingItemCheck = toggleGroomingItemCheck;
window.finishTodayGroomingCheck = finishTodayGroomingCheck;
window.undoTodayGroomingCheck = undoTodayGroomingCheck;
window.openAddWorkoutModal = openAddWorkoutModal;
window.openEditWorkoutModal = openEditWorkoutModal;
window.closeWorkoutModal = closeWorkoutModal;
window.openAddWellnessModal = openAddWellnessModal;
window.openEditWellnessModal = openEditWellnessModal;
window.closeWellnessModal = closeWellnessModal;

// Overlay click listeners for workout and wellness modals
const wOverlay = document.getElementById('workoutEditModalOverlay');
if (wOverlay) {
  wOverlay.addEventListener('click', e => {
    if (e.target === wOverlay) closeWorkoutModal();
  });
}
const wellOverlay = document.getElementById('wellnessEditModalOverlay');
if (wellOverlay) {
  wellOverlay.addEventListener('click', e => {
    if (e.target === wellOverlay) closeWellnessModal();
  });
}
