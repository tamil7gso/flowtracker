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

// ── SQLITE DATABASE BRIDGE (flowtrack.db) ────────────────────────
const DB_API_BASE = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) 
  ? window.location.origin 
  : 'http://127.0.0.1:5000';

const FlowTrackDB = {
  connected: false,
  apiBase: DB_API_BASE,

  async checkStatus() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.apiBase}/api/db/status`, { 
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        this.connected = (data.status === 'connected');
        this.updateUiStatus(data);
        return data;
      }
    } catch (e) {
      this.connected = false;
      this.updateUiStatus(null);
    }
    return null;
  },

  updateUiStatus(dbInfo) {
    const badge = document.getElementById('topbarDbBadge');
    const badgeTxt = document.getElementById('topbarDbStatusText');
    const loginInd = document.getElementById('loginDbText');
    const dbPill = document.getElementById('dbStatusPill');

    if (this.connected && dbInfo) {
      if (badge) {
        badge.className = 'topbar-db-badge online';
        badge.title = `SQLite Database: ${dbInfo.db_file} (${dbInfo.users_count} user${dbInfo.users_count === 1 ? '' : 's'})`;
      }
      if (badgeTxt) badgeTxt.textContent = `SQLite: Connected`;
      if (loginInd) loginInd.textContent = `SQLite Database (${dbInfo.db_file}) Active`;
      if (dbPill) {
        dbPill.className = 'db-status-pill online';
        dbPill.textContent = `🟢 Connected (${dbInfo.users_count} users)`;
      }
    } else {
      if (badge) {
        badge.className = 'topbar-db-badge offline';
        badge.title = 'Local storage mode. Run start_server.bat to connect SQLite database.';
      }
      if (badgeTxt) badgeTxt.textContent = `Local Mode`;
      if (loginInd) loginInd.textContent = `Local Storage (Start server for SQLite)`;
      if (dbPill) {
        dbPill.className = 'db-status-pill offline';
        dbPill.textContent = `🟡 Local Cache Mode`;
      }
    }
  },

  async login(username, password) {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return null;

    try {
      const res = await fetch(`${this.apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.token) {
          sessionStorage.setItem('flowtrack_db_token', data.token);
          localStorage.setItem('flowtrack_db_token', data.token);
        }
        return data;
      } else {
        return { error: data.error || 'Login failed' };
      }
    } catch (e) {
      return null;
    }
  },

  async register(username, name, password, avatar = '🌱') {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return null;

    try {
      const res = await fetch(`${this.apiBase}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, password, avatar })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.token) {
          sessionStorage.setItem('flowtrack_db_token', data.token);
          localStorage.setItem('flowtrack_db_token', data.token);
        }
        return data;
      } else {
        return { error: data.error || 'Registration failed' };
      }
    } catch (e) {
      return null;
    }
  },

  async updateProfile(userObj) {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return false;

    const token = sessionStorage.getItem('flowtrack_db_token') || localStorage.getItem('flowtrack_db_token');
    try {
      const res = await fetch(`${this.apiBase}/api/user/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': token || ''
        },
        body: JSON.stringify(userObj)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  async updatePin(username, newPin) {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return false;

    const token = sessionStorage.getItem('flowtrack_db_token') || localStorage.getItem('flowtrack_db_token');
    try {
      const res = await fetch(`${this.apiBase}/api/user/pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': token || ''
        },
        body: JSON.stringify({ username, newPin })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  async saveState(username, stateObj) {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return false;

    const token = sessionStorage.getItem('flowtrack_db_token') || localStorage.getItem('flowtrack_db_token');
    try {
      const res = await fetch(`${this.apiBase}/api/user/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': token || ''
        },
        body: JSON.stringify({ username, state: stateObj })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  async loadState(username) {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return null;

    const token = sessionStorage.getItem('flowtrack_db_token') || localStorage.getItem('flowtrack_db_token');
    try {
      const res = await fetch(`${this.apiBase}/api/user/state?username=${encodeURIComponent(username)}`, {
        headers: { 'X-Session-Token': token || '' }
      });
      if (res.ok) {
        const data = await res.json();
        return data.state;
      }
    } catch (e) {
      return null;
    }
    return null;
  },

  async getUsers() {
    if (!this.connected) await this.checkStatus();
    if (!this.connected) return [];
    try {
      const res = await fetch(`${this.apiBase}/api/users`);
      if (res.ok) {
        const data = await res.json();
        return data.users || [];
      }
    } catch (e) {
      return [];
    }
    return [];
  }
};
window.FlowTrackDB = FlowTrackDB;

/** Master state object */
let state = {
  user: {
    username: 'michal_masiak',
    name: 'Michał Masiak',
    email: 'michal.masiak@anywhere.co',
    status: 'Focus Champion',
    password: '13579',
    avatar: '⚡',
    avatarPhoto: null,
    logoImage: null,
    logoIcon: '🌿',
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
  // Check if SQLite database server is reachable
  await FlowTrackDB.checkStatus();

  let loadedFromDb = false;
  const activeUser = localStorage.getItem('flowtrack_active_username') || (state.user && state.user.username);

  if (FlowTrackDB.connected && activeUser) {
    try {
      const dbState = await FlowTrackDB.loadState(activeUser);
      if (dbState) {
        state = { ...state, ...dbState };
        loadedFromDb = true;
      }
    } catch (e) {}
  }

  if (!loadedFromDb) {
    const raw = await storageGet(STATE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state = { ...state, ...parsed };
      } catch (e) {}
    }
  }

  if (!state.user) {
    state.user = {
      username: 'michal_masiak',
      name: 'Michał Masiak',
      password: '13579',
      avatar: '⚡',
      avatarPhoto: null,
      logoImage: null,
      logoIcon: '🌿',
      remember: true
    };
  }
  if (!state.user.username) {
    state.user.username = 'michal_masiak';
  }
  return false;
}

async function saveState() {
  // 1. Instant local storage cache
  await storageSet(STATE_KEY, JSON.stringify(state));

  // 2. Persist directly into SQLite database (flowtrack.db)
  if (FlowTrackDB.connected && state.user && state.user.username) {
    FlowTrackDB.saveState(state.user.username, state);
  }
}

async function restartApp() {
  const ok = confirm('This will permanently erase all your goals, habits, points, and timetable, and reset to clean defaults. Continue?');
  if (!ok) return;

  state = {
    user: state.user || { name: 'Alex', password: '13579', avatar: '⚡',
    avatarPhoto: null,
    logoImage: null,
    logoIcon: '🌿', remember: true },
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


// ── MULTI-ACCOUNT REGISTRY & STORAGE ──────────────────────────────
const ACCOUNTS_STORAGE_KEY = 'flowtrack_accounts_v1';

function getStoredAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) {}

  const defaultAccounts = [
    {
      username: 'michal_masiak',
      name: 'Michał Masiak',
      password: '13579',
      role: 'Focus Champion',
      email: 'michal.masiak@anywhere.co',
      avatar: '⚡',
      avatarPhoto: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(defaultAccounts));
  } catch (e) {}
  return defaultAccounts;
}

function saveStoredAccount(account) {
  if (!account || !account.username) return;
  const accounts = getStoredAccounts();
  const normalizedU = account.username.trim().toLowerCase().replace(/^@/, '');
  const cleanAccount = { ...account, username: account.username.trim().replace(/^@/, '') };
  const idx = accounts.findIndex(a => a.username.trim().toLowerCase().replace(/^@/, '') === normalizedU);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], ...cleanAccount };
  } else {
    accounts.push(cleanAccount);
  }
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch (e) {}

  // Synchronize directly with SQLite database (flowtrack.db)
  if (FlowTrackDB.connected) {
    FlowTrackDB.updateProfile(cleanAccount);
  }
}

function findStoredAccount(username) {
  if (!username) return null;
  const accounts = getStoredAccounts();
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  return accounts.find(a => 
    a.username.trim().toLowerCase().replace(/^@/, '') === clean || 
    (a.name && a.name.trim().toLowerCase() === clean)
  );
}

// ── ANYWHERE AUTHENTICATION CONTROLLER ────────────────────────────
let authMode = 'login'; // 'login' or 'signup'

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = (authMode === 'signup');

  const titleEl = document.getElementById('anywhereTitle');
  if (titleEl) {
    titleEl.innerHTML = isSignup
      ? 'Create new account<span class="title-dot">.</span>'
      : 'Sign in to Habit Tracker<span class="title-dot">.</span>';
  }

  const badgeEl = document.getElementById('anywhereBadge');
  if (badgeEl) badgeEl.textContent = isSignup ? '✦ START YOUR JOURNEY' : '✦ WELCOME BACK';

  const promptText = document.getElementById('anywherePromptText');
  if (promptText) promptText.textContent = isSignup ? 'Already have an account?' : 'Need an account?';

  const toggleLink = document.getElementById('anywhereToggleLink');
  if (toggleLink) toggleLink.textContent = isSignup ? 'Log In' : 'Sign Up';

  const nameRow = document.getElementById('anywhereNameRow');
  if (nameRow) nameRow.style.display = isSignup ? 'flex' : 'none';

  const userLabel = document.getElementById('loginUsernameLabel');
  if (userLabel) userLabel.textContent = isSignup ? 'Choose a Username' : 'Username';

  const userInput = document.getElementById('loginUsername');
  if (userInput) {
    userInput.placeholder = isSignup ? 'Choose your username (e.g. alex_focus)' : 'Enter your username';
    if (isSignup && (userInput.value === 'michal_masiak' || userInput.value === (state.user && state.user.username))) {
      userInput.value = '';
    } else if (!isSignup && !userInput.value) {
      userInput.value = (state.user && state.user.username) || 'michal_masiak';
    }
  }

  const userHint = document.getElementById('loginUsernameHint');
  if (userHint) {
    userHint.style.display = isSignup ? 'block' : 'none';
    userHint.textContent = isSignup ? 'This username will be your login ID.' : '';
  }

  const pwdLabel = document.getElementById('loginPasswordLabel');
  if (pwdLabel) pwdLabel.textContent = isSignup ? 'Create Password / PIN' : 'Password / PIN';

  const pwdInput = document.getElementById('loginPassword');
  if (pwdInput) {
    pwdInput.placeholder = isSignup ? 'Create password (min 4 chars)' : '•••••••• (default: 13579)';
    if (isSignup && pwdInput.value === '13579') pwdInput.value = '';
    else if (!isSignup && !pwdInput.value) pwdInput.value = '13579';
  }

  const submitText = document.getElementById('loginSubmitText');
  if (submitText) submitText.textContent = isSignup ? 'Create account' : 'Sign in';

  const errorEl = document.getElementById('loginError');
  if (errorEl) errorEl.classList.remove('show');
}

function toggleAuthMode() {
  setAuthMode(authMode === 'signup' ? 'login' : 'signup');
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
  const eyeBtn = document.getElementById('loginEyeBtn');
  const eyeIcon = document.getElementById('loginEyeIcon');
  if (pwdField) pwdField.type = loginPasswordVisible ? 'text' : 'password';
  if (eyeBtn) {
    eyeBtn.textContent = loginPasswordVisible ? '🙈' : '👁';
  }
  if (eyeIcon) {
    eyeIcon.innerHTML = loginPasswordVisible
      ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y2="23"/>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}


// ── USER IDENTITY & CUSTOMIZABLE DP / LOGO ───────────────────────

function renderUserIdentity() {
  if (!state.user) state.user = {};
  const name = state.user.name || 'Michał Masiak';
  const role = state.user.role || state.user.status || 'Focus Champion';
  const avatar = state.user.avatar || '⚡';
  const photo = state.user.avatarPhoto || null;
  const logoImg = state.user.logoImage || null;
  const logoIcon = state.user.logoIcon || '🌿';

  // 1. Top-Right Profile Widget (Red Arrowed)
  const topName = document.getElementById('topUserName');
  const topRole = document.getElementById('topUserRole');
  const topAvatar = document.getElementById('topUserAvatar');

  if (topName) topName.textContent = name;
  if (topRole) topRole.textContent = role;
  if (topAvatar) {
    if (photo) {
      topAvatar.innerHTML = `<img src="${photo}" class="top-dp-img" alt="${escHtml(name)}" />`;
    } else {
      topAvatar.innerHTML = `<span class="avatar-text">${avatar}</span>`;
    }
  }

  // 2. Profile Section Large Previews
  const profDisplay = document.getElementById('profileAvatarDisplay');
  if (profDisplay) {
    if (photo) {
      profDisplay.innerHTML = `<img src="${photo}" class="dp-large-img" alt="${escHtml(name)}" />`;
    } else {
      profDisplay.innerHTML = avatar;
    }
  }

  const removePhotoBtn = document.getElementById('removePhotoBtn');
  if (removePhotoBtn) {
    removePhotoBtn.style.display = photo ? 'inline-flex' : 'none';
  }

  const customLogoDisplay = document.getElementById('customLogoDisplay');
  if (customLogoDisplay) {
    if (logoImg) {
      customLogoDisplay.innerHTML = `<img src="${logoImg}" class="logo-preview-img" alt="Logo" />`;
    } else {
      customLogoDisplay.innerHTML = logoIcon;
    }
  }

  const removeLogoBtn = document.getElementById('removeLogoBtn');
  if (removeLogoBtn) {
    removeLogoBtn.style.display = logoImg ? 'inline-flex' : 'none';
  }

  // 3. Update all Brand Logo displays
  const brandLogos = document.querySelectorAll('.brand-icon, .botanical-logo-badge, #topbarLeafLogo');
  brandLogos.forEach(el => {
    if (logoImg) {
      el.innerHTML = `<img src="${logoImg}" class="brand-custom-logo-img" alt="Logo" />`;
    } else {
      el.textContent = logoIcon;
    }
  });

  // 4. Update Greeting in Dashboard
  const greetingEl = document.getElementById('dashGreetingBadge');
  if (greetingEl) greetingEl.textContent = `🌱 Welcome back, ${name} 👋`;

  // 5. Update Profile Form Inputs if on Profile section
  const fNameInput = document.getElementById('profFirstName');
  const lNameInput = document.getElementById('profLastName');
  const uNameInput = document.getElementById('profUsername');
  const emailInput = document.getElementById('profEmail');
  const statusInput = document.getElementById('profStatus');
  if (fNameInput && !fNameInput.matches(':focus')) {
    const parts = name.split(' ');
    fNameInput.value = parts[0] || 'Michał';
    if (lNameInput) lNameInput.value = parts.slice(1).join(' ') || 'Masiak';
  }
  if (uNameInput && !uNameInput.matches(':focus')) {
    uNameInput.value = state.user.username || 'michal_masiak';
  }
  if (emailInput && !emailInput.matches(':focus')) emailInput.value = state.user.email || 'michal.masiak@anywhere.co';
  if (statusInput && !statusInput.matches(':focus')) statusInput.value = role;

  // Legacy sidebar fallbacks if present
  const sideName = document.getElementById('sidebarUserName');
  const sideAvatar = document.getElementById('sidebarAvatar');
  if (sideName) sideName.textContent = name;
  if (sideAvatar) {
    if (photo) sideAvatar.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    else sideAvatar.textContent = avatar;
  }
}
window.renderUserIdentity = renderUserIdentity;

function updateSidebarUserProfile() {
  renderUserIdentity();
}
window.updateSidebarUserProfile = updateSidebarUserProfile;

function handleUserPhotoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image size should be under 5MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    state.user = state.user || {};
    state.user.avatarPhoto = e.target.result;
    saveState();
    saveStoredAccount(state.user);
    renderUserIdentity();
    showToast('Profile photo (DP) updated! 📸');
  };
  reader.readAsDataURL(file);
}
window.handleUserPhotoUpload = handleUserPhotoUpload;

function removeUserPhoto() {
  state.user = state.user || {};
  state.user.avatarPhoto = null;
  saveState();
  saveStoredAccount(state.user);
  renderUserIdentity();
  showToast('Profile photo removed. Using avatar icon.');
}
window.removeUserPhoto = removeUserPhoto;

function handleAppLogoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file for logo');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    state.user = state.user || {};
    state.user.logoImage = e.target.result;
    saveState();
    saveStoredAccount(state.user);
    renderUserIdentity();
    showToast('Brand logo updated! 🌿');
  };
  reader.readAsDataURL(file);
}
window.handleAppLogoUpload = handleAppLogoUpload;

function removeAppLogo() {
  state.user = state.user || {};
  state.user.logoImage = null;
  state.user.logoIcon = '🌿';
  saveState();
  saveStoredAccount(state.user);
  renderUserIdentity();
  showToast('Logo reset to default 🌿');
}
window.removeAppLogo = removeAppLogo;

async function handleLogin(e) {
  if (e) e.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const firstNameInput = document.getElementById('loginFirstName');
  const lastNameInput = document.getElementById('loginLastName');
  const errorEl = document.getElementById('loginError');
  const overlay = document.getElementById('loginOverlay');

  const rawUsername = usernameInput ? usernameInput.value.trim() : '';
  const username = rawUsername.replace(/^@/, '');
  const password = passwordInput ? passwordInput.value.trim() : '';
  const firstName = firstNameInput ? firstNameInput.value.trim() : '';
  const lastName = lastNameInput ? lastNameInput.value.trim() : '';

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.add('show');
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function clearError() {
    if (errorEl) {
      errorEl.classList.remove('show');
    }
  }

  // ── CASE 1: SIGN UP (CREATING NEW ACCOUNT WITH USERNAME) ────────
  if (authMode === 'signup') {
    if (!username) {
      showError('Please set a username for your account.');
      if (usernameInput) usernameInput.focus();
      return false;
    }
    if (username.length < 3) {
      showError('Username must be at least 3 characters long.');
      if (usernameInput) usernameInput.focus();
      return false;
    }
    if (/\s/.test(username)) {
      showError('Username cannot contain spaces. Use letters, numbers, or underscores.');
      if (usernameInput) usernameInput.focus();
      return false;
    }

    if (!password || password.length < 4) {
      showError('Password / PIN must be at least 4 characters.');
      if (passwordInput) passwordInput.focus();
      return false;
    }

    // Attempt SQLite Database Registration
    const displayName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : username;

    if (FlowTrackDB.connected) {
      const regRes = await FlowTrackDB.register(username, displayName, password, '🌱');
      if (regRes && regRes.error) {
        showError(regRes.error);
        if (usernameInput) usernameInput.focus();
        return false;
      }
    } else {
      const existing = findStoredAccount(username);
      if (existing) {
        showError(`Username "${username}" is already taken. Please choose another username or switch to Log In.`);
        if (usernameInput) usernameInput.focus();
        return false;
      }
    }

    clearError();

    const newAccount = {
      username: username,
      name: displayName,
      password: password,
      role: 'Focus Champion',
      email: `${username}@habittracker.local`,
      avatar: '🌱',
      avatarPhoto: null,
      createdAt: new Date().toISOString()
    };
    saveStoredAccount(newAccount);

    state.user = state.user || {};
    state.user.username = username;
    state.user.name = displayName;
    state.user.password = password;
    state.user.role = 'Focus Champion';
    state.user.status = 'Focus Champion';
    state.user.remember = true;

    sessionStorage.setItem('flowtrack_session_active', 'true');
    localStorage.setItem('flowtrack_active_username', username);
    saveState();

    renderUserIdentity();
    updateSidebarUserProfile();

    if (overlay) {
      overlay.classList.add('unlocking');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 700);
    }
    showToast(`🎉 Account saved to SQLite database! Welcome, @${username}!`);
    return false;
  }

  // ── CASE 2: LOG IN (SIGN IN USING USERNAME & PASSWORD) ──────────
  if (!username) {
    showError('Please enter your username to log in.');
    if (usernameInput) usernameInput.focus();
    return false;
  }
  if (!password) {
    showError('Please enter your password / PIN.');
    if (passwordInput) passwordInput.focus();
    return false;
  }

  let isAuthenticated = false;
  let matchedUser = null;

  // 1. Try SQLite Database Authentication
  if (!FlowTrackDB.connected) {
    await FlowTrackDB.checkStatus();
  }
  if (FlowTrackDB.connected) {
    const loginRes = await FlowTrackDB.login(username, password);
    if (loginRes && loginRes.success && loginRes.user) {
      isAuthenticated = true;
      matchedUser = loginRes.user;

      // Load user state from database
      try {
        const dbState = await FlowTrackDB.loadState(username);
        if (dbState) {
          state = { ...state, ...dbState };
        }
      } catch (e) {}
    } else if (loginRes && loginRes.error) {
      showError(loginRes.error);
      return false;
    }
  }

  // 2. Fallback to local accounts if database offline
  if (!isAuthenticated) {
    const account = findStoredAccount(username);
    const currentUsername = (state.user && state.user.username) ? state.user.username.toLowerCase() : '';
    const currentName = (state.user && state.user.name) ? state.user.name.toLowerCase() : '';
    const currentPassword = (state.user && state.user.password) ? state.user.password : '13579';

    if (account) {
      if (account.password === password || (account.password === '13579' && password === '13579')) {
        isAuthenticated = true;
        matchedUser = account;
      }
    } else if (username.toLowerCase() === currentUsername || username.toLowerCase() === currentName) {
      if (password === currentPassword || password === '13579') {
        isAuthenticated = true;
        matchedUser = state.user;
      }
    } else if ((username.toLowerCase() === 'michal_masiak' || username.toLowerCase() === 'michal' || username.toLowerCase() === 'alex') && (password === '13579' || password === currentPassword)) {
      isAuthenticated = true;
      matchedUser = state.user;
    }
  }

  if (isAuthenticated) {
    clearError();

    state.user = state.user || {};
    if (matchedUser) {
      state.user.username = matchedUser.username || username;
      state.user.name = matchedUser.name || state.user.name || username;
      state.user.password = matchedUser.password || password;
      if (matchedUser.role) state.user.role = matchedUser.role;
      if (matchedUser.avatar) state.user.avatar = matchedUser.avatar;
      if (matchedUser.avatarPhoto !== undefined) state.user.avatarPhoto = matchedUser.avatarPhoto;
      if (matchedUser.logoImage !== undefined) state.user.logoImage = matchedUser.logoImage;
      if (matchedUser.logoIcon) state.user.logoIcon = matchedUser.logoIcon;
    }

    state.user.remember = true;
    sessionStorage.setItem('flowtrack_session_active', 'true');
    localStorage.setItem('flowtrack_session_active', 'true');
    localStorage.setItem('flowtrack_active_username', state.user.username);
    saveState();

    renderUserIdentity();
    updateSidebarUserProfile();

    if (overlay) {
      overlay.classList.add('unlocking');
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('unlocking');
      }, 350);
    }
    showToast(`🌿 Welcome back, ${state.user.name || state.user.username}!`);
    return false;
  } else {
    showError('Invalid username or password. Default username: michal_masiak | PIN: 13579');
    if (passwordInput) {
      passwordInput.focus();
      passwordInput.select();
    }
    return false;
  }
}

function guestLogin(provider) {
  const guestUser = provider === 'Apple' ? 'apple_user' : 'google_user';
  state.user = state.user || {};
  state.user.username = guestUser;
  state.user.name = provider === 'Apple' ? 'Apple User' : 'Google User';
  sessionStorage.setItem('flowtrack_session_active', 'true');
  localStorage.setItem('flowtrack_session_active', 'true');
  saveState();
  renderUserIdentity();
  updateSidebarUserProfile();
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.classList.add('unlocking');
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('unlocking');
      showToast(`Signed in with ${provider}! ✨`);
    }, 350);
  }
}

function handleLogout() {
  sessionStorage.removeItem('flowtrack_session_active');
  localStorage.removeItem('flowtrack_session_active');
  localStorage.removeItem('flowtrack_logged_in');
  sessionStorage.removeItem('flowtrack_logged_in');
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('unlocking');
  }
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
  
  // Set auth mode to 'login'
  setAuthMode('login');

  const uInput = document.getElementById('loginUsername');
  if (uInput) {
    uInput.value = (state.user && state.user.username) || 'michal_masiak';
  }
  showToast('Habit Tracker locked 🔒');
}

function checkAutoLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;

  const isSessionActive = (sessionStorage.getItem('flowtrack_session_active') === 'true') ||
                          (localStorage.getItem('flowtrack_session_active') === 'true');
  if (isSessionActive && state.user) {
    overlay.style.display = 'none';
    renderUserIdentity();
    updateSidebarUserProfile();
  } else {
    overlay.style.display = 'flex';
    overlay.classList.remove('unlocking');
    setAuthMode('login');
    const uInput = document.getElementById('loginUsername');
    if (uInput) uInput.value = (state.user && state.user.username) || 'michal_masiak';
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

document.getElementById('sidebarSettingsBtn')?.addEventListener('click', () => navigate('profile'));
document.getElementById('sidebarLockBtn')?.addEventListener('click', handleLogout);
document.getElementById('accountModalClose')?.addEventListener('click', closeAccountModal);
document.getElementById('accountModalCancel')?.addEventListener('click', closeAccountModal);
document.getElementById('accountModalOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('accountModalOverlay')) closeAccountModal();
});

document.getElementById('accountModalSave')?.addEventListener('click', () => {
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
  const gs = state.goals[dateKey] || [];
  gs.forEach(g => {
    if (g.time === undefined) g.time = 'None';
    if (g.skipped === undefined) g.skipped = false;
  });
  return gs;
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

  const topSecName = document.getElementById('topbarActiveSection');
  if (topSecName) {
    const titles = {
      dashboard: 'Dashboard',
      goals: 'Daily Goals',
      habits: 'Habit Tracker',
      timetable: 'Weekly Timetable',
      stats: 'Statistics',
      rewards: 'Achievements & Rewards',
      calendar: 'Calendar',
      profile: 'Profile & Settings'
    };
    topSecName.textContent = titles[sectionId] || sectionId;
  }

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

hamburger?.addEventListener('click', () => {
  sidebar?.classList.toggle('open');
  overlay?.classList.toggle('visible');
});

overlay?.addEventListener('click', closeSidebar);

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
    if (liveTime) liveTime.textContent = `${hh}:${mm}:${ss}`;
    const fmtd = formatDate(todayKey());
    if (dateDisplay) dateDisplay.textContent = fmtd;
    if (goalsDate) goalsDate.textContent = fmtd;
  }

  tick();
  setInterval(tick, 1000);
  runGoalTimeCheck();
  setInterval(runGoalTimeCheck, 10000);
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

  document.getElementById('notifClose')?.addEventListener('click', () => {
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

// ── DASHBOARD (BOTANICAL THEMED) ──────────────────────────────────

function renderDashboard() {
  const pct = completionFraction();
  const pctStr = Math.round(pct * 100);

  const pctEl = document.getElementById('dashTodayPct');
  if (pctEl) pctEl.textContent = pctStr + '%';

  // SVG circular progress ring for botanical theme (Card 2)
  const donutFill = document.getElementById('dashDonutFill');
  if (donutFill) {
    const totalCirc = 301.6;
    const offset = totalCirc * (1 - pct);
    donutFill.style.strokeDashoffset = offset;
  }

  const progressBar = document.getElementById('dashProgressBar');
  if (progressBar) progressBar.style.width = pctStr + '%';

  const streakEl = document.getElementById('dashStreak');
  if (streakEl) streakEl.textContent = currentStreak() + ' 🔥';

  const streakValEl = document.getElementById('dashStreakVal');
  if (streakValEl) streakValEl.textContent = currentStreak() || 18;

  const weeklyEl = document.getElementById('dashWeekly');
  if (weeklyEl) weeklyEl.textContent = weeklyAvg() + '%';

  const monthlyEl = document.getElementById('dashMonthly');
  if (monthlyEl) monthlyEl.textContent = monthlyAvg() + '%';

  // Completion breakdown counts
  const goals = getGoals();
  const doneCount = goals.filter(g => g.done).length;
  const skippedCount = goals.filter(g => g.skipped && !g.done).length;
  const inProgressCount = goals.filter(g => !g.done && !g.skipped).length;

  const compCountEl = document.getElementById('dashCompletedCount');
  if (compCountEl) compCountEl.textContent = doneCount || 6;

  const inProgCountEl = document.getElementById('dashInProgressCount');
  if (inProgCountEl) inProgCountEl.textContent = inProgressCount || 2;

  const skippedCountEl = document.getElementById('dashSkippedCount');
  if (skippedCountEl) skippedCountEl.textContent = skippedCount;

  const container = document.getElementById('dashGoalList');
  if (container) {
    if (!goals.length) {
      container.innerHTML = '<p class="empty-state">No goals yet — add your first one!</p>';
    } else {
      container.innerHTML = goals.slice(0, 6).map(g => `
        <div class="goal-mini-item ${g.done ? 'completed' : (g.skipped ? 'skipped' : '')}">
          <div class="mini-dot" style="background:${catColor(g.category)}"></div>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(g.title)}</span>
          ${g.done ? '<span style="color:var(--green); font-weight:800;">✓</span>' : (g.skipped ? '<span style="color:var(--red); font-weight:800;">✕</span>' : '<span style="color:var(--text-muted);">○</span>')}
        </div>
      `).join('');
      if (goals.length > 6) {
        container.innerHTML += `<p style="text-align:center; font-size:12px; color:var(--text-muted); margin-top:8px;">+${goals.length - 6} more</p>`;
      }
    }
  }

  // Mini week chart if present
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
          backgroundColor: data.map(v => v === 100 ? '#4c7349' : '#183224'),
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
          y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { color: '#889886', font: { weight: '600' }, callback: v => v + '%' } },
          x: { grid: { display: false }, ticks: { color: '#4a5b48', font: { weight: '600' } } }
        }
      }
    });
  }

  // Render botanical dashboard habits table with strict 7-day checks
  renderDashboardHabitsCard();
}

const dashAddGoalBtn = document.getElementById('dashAddGoal');
if (dashAddGoalBtn) {
  dashAddGoalBtn.addEventListener('click', () => {
    navigate('goals');
    setTimeout(() => openGoalModal(), 200);
  });
}

function openAddGoalModalDirect() {
  navigate('goals');
  setTimeout(() => openGoalModal(), 200);
}
window.openAddGoalModalDirect = openAddGoalModalDirect;

// ── CURRENT WEEK DATES & DASHBOARD HABIT TRACKING ──
function getCurrentWeekDates() {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Mon, 1 = Tue, ..., 6 = Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const dates = [];
  const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayShortNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayFullNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push({
      dayIndex: i,
      name: dayShortNames[i],
      fullName: dayFullNames[i],
      letter: dayLetters[i],
      dateKey: `${y}-${m}-${day}`,
      isPast: i < dayOfWeek,
      isToday: i === dayOfWeek,
      isFuture: i > dayOfWeek
    });
  }
  return { dayOfWeek, dates };
}
window.getCurrentWeekDates = getCurrentWeekDates;

function ensureDashboardHabitsInitialized() {
  if (state.dashHabits && state.dashHabits.length >= 5) return;

  const week = getCurrentWeekDates();
  const d0 = week.dates[0].dateKey;
  const d1 = week.dates[1].dateKey;
  const d2 = week.dates[2].dateKey;
  const d3 = week.dates[3].dateKey;
  const d4 = week.dates[4].dateKey;

  // Initialize with the 5 core habits matching botanical dashboard design
  state.dashHabits = [
    {
      id: 'water',
      name: 'Drink Water',
      goal: '8 glasses a day',
      icon: '💧',
      catClass: 'cat-water',
      target: 8,
      doneByDate: { [d0]: true, [d1]: true, [d2]: true, [d3]: true, [d4]: true }
    },
    {
      id: 'meditate',
      name: 'Meditate',
      goal: '10 minutes',
      icon: '🧘',
      catClass: 'cat-mind',
      target: 10,
      doneByDate: { [d0]: true, [d1]: true, [d2]: true, [d3]: true }
    },
    {
      id: 'exercise',
      name: 'Exercise',
      goal: '30 minutes',
      icon: '🏋️',
      catClass: 'cat-exercise',
      target: 7,
      doneByDate: { [d0]: true, [d1]: true, [d2]: true, [d3]: true }
    },
    {
      id: 'read',
      name: 'Read Book',
      goal: '20 minutes',
      icon: '📖',
      catClass: 'cat-read',
      target: 7,
      doneByDate: { [d0]: true, [d1]: true, [d2]: true }
    },
    {
      id: 'sugar',
      name: 'No Sugar',
      goal: 'Stay healthy',
      icon: '🍃',
      catClass: 'cat-sugar',
      target: 7,
      doneByDate: { [d0]: true, [d1]: true, [d2]: true, [d3]: true, [d4]: true }
    }
  ];
  saveState();
}
window.ensureDashboardHabitsInitialized = ensureDashboardHabitsInitialized;

function renderDashboardHabitsCard() {
  const container = document.getElementById('dashHabitsTableWrap');
  if (!container) return;

  ensureDashboardHabitsInitialized();
  const week = getCurrentWeekDates();

  let html = `
    <div class="habits-table-head">
      <div class="th-name">Habit</div>
      <div class="th-days">
        ${week.dates.map(d => `
          <span class="${d.isToday ? 'col-head-today' : ''}" style="${d.isToday ? 'color:var(--forest); font-weight:800;' : ''}" title="${d.fullName}${d.isToday ? ' (Today)' : ''}">
            ${d.letter}
          </span>
        `).join('')}
      </div>
      <div class="th-ratio">Done</div>
    </div>
  `;

  state.dashHabits.forEach(h => {
    h.doneByDate = h.doneByDate || {};
    let doneThisWeek = 0;

    const daysPillsHtml = week.dates.map(d => {
      const isDone = !!h.doneByDate[d.dateKey];
      if (isDone) {
        doneThisWeek++;
        return `<button type="button" class="day-pill-check checked done locked" disabled title="${d.fullName}: Completed ✓ (Locked)">✓</button>`;
      } else if (d.isPast) {
        // PAST DAY UNCOMPLETED: STRICT WRONG SYMBOL ✕
        return `<button type="button" class="day-pill-check missed locked" disabled title="${d.fullName}: Missed ✕ (Locked)">✕</button>`;
      } else if (d.isToday) {
        // TODAY ACTIVE: CLICKABLE TO COMPLETE
        return `<button type="button" class="day-pill-check today-active" onclick="toggleDashboardHabitDay('${h.id}', '${d.dateKey}')" title="${d.fullName} (Today): Click to complete and lock">○</button>`;
      } else {
        // FUTURE DAY: DISABLED
        return `<button type="button" class="day-pill-check future" disabled title="${d.fullName}: Upcoming">○</button>`;
      }
    }).join('');

    html += `
      <div class="habit-interactive-row" data-habit-id="${h.id}">
        <div class="habit-info-cell">
          <div class="habit-icon-circle ${h.catClass}">${h.icon}</div>
          <div class="habit-details">
            <div class="habit-name-txt">${escHtml(h.name)}</div>
            <div class="habit-goal-txt">${escHtml(h.goal)}</div>
          </div>
        </div>
        <div class="habit-week-checks">
          ${daysPillsHtml}
        </div>
        <div class="habit-ratio-cell">${doneThisWeek}/${h.target || 7}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}
window.renderDashboardHabitsCard = renderDashboardHabitsCard;

function toggleDashboardHabitDay(habitId, dateKey) {
  ensureDashboardHabitsInitialized();
  const habit = state.dashHabits.find(h => h.id === habitId);
  if (!habit) return;

  habit.doneByDate = habit.doneByDate || {};

  if (habit.doneByDate[dateKey]) {
    showToast('🔒 Completed habit day is locked and cannot be changed.');
    return;
  }

  const week = getCurrentWeekDates();
  const targetDate = week.dates.find(d => d.dateKey === dateKey);

  if (targetDate && targetDate.isPast) {
    showToast('🔒 Past days cannot be modified — uncompleted habits remain missed (✕).');
    return;
  }
  if (targetDate && targetDate.isFuture) {
    showToast('🔒 Future days cannot be marked in advance.');
    return;
  }

  // Strict check: Mark done and permanently lock
  habit.doneByDate[dateKey] = true;

  // Sync to state.habits if corresponding habit exists
  if (state.habits) {
    const matchingHabit = state.habits.find(h => h.name.toLowerCase() === habit.name.toLowerCase() || h.id === habit.id);
    if (matchingHabit) {
      matchingHabit.doneByDate = matchingHabit.doneByDate || {};
      matchingHabit.doneByDate[dateKey] = true;
    }
  }

  saveState();

  if (state.user.checkSounds !== false) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch(e) {}
  }

  showToast(`🌿 "${habit.name}" completed for today! (Locked permanently ✓)`);
  renderDashboardHabitsCard();
  renderHabits();
  renderDashboard();
  recalcPoints();
  checkBadges();
}
window.toggleDashboardHabitDay = toggleDashboardHabitDay;

function toggleWeekDayHabit(btn) {
  if (!btn) return;
  const habitRow = btn.closest('.habit-interactive-row');
  const habitId = habitRow ? habitRow.dataset.habitId : null;
  const dateKey = btn.dataset.dateKey || todayKey();
  if (habitId) {
    toggleDashboardHabitDay(habitId, dateKey);
  }
}
window.toggleWeekDayHabit = toggleWeekDayHabit;

// ── TIMETABLE SLOT COMPLETION & AUTO-EXPIRE HELPERS ──
function parseSlotEndTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(/[-–—]/);
  let endPart = parts.length > 1 ? parts[1].trim() : parts[0].trim();

  let period = null;
  const pmMatch = timeStr.match(/(AM|PM)/i);
  if (endPart.match(/(AM|PM)/i)) {
    period = endPart.match(/(AM|PM)/i)[1].toUpperCase();
  } else if (pmMatch) {
    period = pmMatch[1].toUpperCase();
  }

  const timeMatch = endPart.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;
  let h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);

  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;

  const now = new Date();
  const endD = new Date(now);
  endD.setHours(h, m, 0, 0);
  return endD;
}
window.parseSlotEndTime = parseSlotEndTime;

function isSlotTimeExpired(timeStr) {
  const endD = parseSlotEndTime(timeStr);
  if (!endD) return false;
  return new Date() > endD;
}
window.isSlotTimeExpired = isSlotTimeExpired;

function toggleTimetableSlot(slotId, day, dateKey) {
  const weekInfo = getCurrentWeekDates();
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dIdx = dayNames.indexOf(day);
  if (!dateKey) {
    dateKey = dIdx >= 0 ? weekInfo.dates[dIdx].dateKey : todayKey();
  }

  state.timetableChecks = state.timetableChecks || {};
  const checkKey = `${dateKey}_${slotId}`;

  // Strict check 1: If already completed, cannot change
  if (state.timetableChecks[checkKey] || state.timetableChecks[`${day}_${slotId}`]) {
    showToast('🔒 Completed timetable slot is locked and cannot be changed.');
    return;
  }

  // Strict check 2: If day is in past, cannot change
  const todayMonIndex = (new Date().getDay() + 6) % 7;
  if (dIdx < todayMonIndex) {
    showToast('🔒 Past days cannot be modified — uncompleted tasks remain missed (✕).');
    return;
  }

  // Strict check 3: If today and expired, cannot change
  let slotObj = null;
  if (state.timetable && state.timetable[day]) {
    slotObj = state.timetable[day].find(s => s.id === slotId);
  }
  if (slotObj && dIdx === todayMonIndex && isSlotTimeExpired(slotObj.time)) {
    showToast('🔒 Time slot has expired and is marked as missed (✕). Cannot be changed.');
    return;
  }

  // Mark done permanently!
  state.timetableChecks[checkKey] = true;
  state.timetableChecks[`${day}_${slotId}`] = true;
  saveState();

  if (state.user.checkSounds !== false) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch(e) {}
  }

  showToast(`✓ Time slot "${slotObj ? slotObj.task : 'Task'}" finished! (Locked permanently)`);
  renderWeeklyGridTimetable(currentTtGridFilter);
  renderTimetableSection();
  renderTimetableSidebar();
}
window.toggleTimetableSlot = toggleTimetableSlot;


// ── GOAL TIME & AUTO-SKIP HELPERS ───────────────────────────────

function formatGoalTime(timeStr) {
  if (!timeStr || timeStr === 'None') return 'None';
  if (!timeStr.includes(':')) return timeStr;
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = String(parseInt(mStr || '0', 10)).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}
window.formatGoalTime = formatGoalTime;

function isGoalTimeExpired(timeStr, dateKey = todayKey()) {
  if (!timeStr || timeStr === 'None') return false;
  const today = todayKey();
  if (dateKey < today) return true;  // Past day is expired
  if (dateKey > today) return false; // Future day not yet expired

  // Current day: compare hours & minutes
  if (!timeStr.includes(':')) return false;
  const [hStr, mStr] = timeStr.split(':');
  const goalMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr || '0', 10);
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes > goalMinutes;
}
window.isGoalTimeExpired = isGoalTimeExpired;

function handleGoalTimeNoneToggle(isNoneChecked) {
  const timeInput = document.getElementById('goalTime');
  if (!timeInput) return;
  if (isNoneChecked) {
    timeInput.disabled = true;
    timeInput.value = '';
  } else {
    timeInput.disabled = false;
    if (!timeInput.value) timeInput.value = '16:00';
  }
}
window.handleGoalTimeNoneToggle = handleGoalTimeNoneToggle;

function runGoalTimeCheck() {
  const today = todayKey();
  const todayGoals = state.goals[today] || [];
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let changed = false;

  todayGoals.forEach(g => {
    // RULE 1: If a goal is completed (done === true), IT MUST NEVER CHANGE AGAIN!
    if (g.done) {
      if (g.skipped) {
        g.skipped = false;
        changed = true;
      }
      return;
    }

    // RULE 2: If a goal has NO time or time is 'None', IT MUST NOT CHANGE TO SKIPPED!
    if (!g.time || g.time === 'None' || !g.time.includes(':')) {
      if (g.skipped) {
        g.skipped = false;
        changed = true;
      }
      return;
    }

    // RULE 3: If a goal has a scheduled time, check if local time passed deadline:
    const [hStr, mStr] = g.time.split(':');
    const goalMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr || '0', 10);
    if (currentMinutes > goalMinutes) {
      if (!g.skipped) {
        g.skipped = true;
        changed = true;
        showToast(`⏰ Goal "${g.title}" reached deadline (${formatGoalTime(g.time)}) and was marked Skipped.`);
      }
    } else {
      // Still within time (before deadline): must NOT be skipped!
      if (g.skipped) {
        g.skipped = false;
        changed = true;
      }
    }
  });

  if (changed) {
    saveState();
    const currSec = document.querySelector('.section.active');
    if (currSec && currSec.id === 'section-goals') renderGoals(false);
    if (currSec && currSec.id === 'section-dashboard') renderDashboard();
  }
}
window.runGoalTimeCheck = runGoalTimeCheck;

// ── DAILY GOALS ──────────────────────────────────────────────────

let goalFilter = 'All';

function renderGoals(checkTime = true) {
  if (checkTime) runGoalTimeCheck();
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

  container.innerHTML = filtered.map(g => {
    const isSkipped = g.skipped && !g.done;
    const hasTime = g.time && g.time !== 'None';
    const timeDisplay = hasTime ? formatGoalTime(g.time) : 'None';
    const timeClass = isSkipped ? 'badge-time-expired' : (hasTime ? 'badge-time-set' : 'badge-time-none');

    // Strict Locking Rule: Once completed or skipped, it must NOT change again!
    let checkIcon = '';
    let checkTitle = 'Click to complete';
    let checkDisabled = '';
    let checkClass = '';

    if (g.done) {
      checkIcon = '✓';
      checkTitle = 'Completed — Locked permanently ✓';
      checkDisabled = 'disabled';
      checkClass = 'checked locked';
    } else if (isSkipped) {
      checkIcon = '✕';
      checkTitle = 'Skipped — Deadline passed. Locked permanently 🔒';
      checkDisabled = 'disabled';
      checkClass = 'skipped-check locked';
    } else {
      checkIcon = '';
      checkTitle = 'Click to complete goal (Will lock permanently)';
      checkDisabled = '';
      checkClass = '';
    }

    return `
      <div class="goal-item ${g.done ? 'completed' : (isSkipped ? 'skipped' : '')}" data-id="${g.id}">
        <button class="goal-check ${checkClass}" ${checkDisabled} onclick="toggleGoal('${g.id}')" title="${checkTitle}">
          ${checkIcon}
        </button>
        <div class="goal-info">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <div class="goal-title">${escHtml(g.title)}</div>
            ${isSkipped ? '<span class="status-badge-skipped">✕ Skipped</span>' : ''}
            ${g.done ? '<span class="status-badge-completed">✓ Done</span>' : ''}
          </div>
          <div class="goal-meta" style="margin-top:4px;">
            <span class="goal-time-badge ${timeClass}">⏰ ${timeDisplay}${isSkipped ? ' (Expired)' : ''}</span>
            <span class="goal-cat-badge cat-${g.category}">${g.category}</span>
            <span class="goal-priority priority-${g.priority}">${g.priority}</span>
          </div>
          ${g.notes ? `<div class="goal-notes">${escHtml(g.notes)}</div>` : ''}
        </div>
        <div class="goal-actions">
          ${(!g.done && !isSkipped) ? `<button class="btn-icon" onclick="editGoal('${g.id}')" title="Edit">✎</button>` : ''}
          <button class="btn-icon danger" onclick="deleteGoal('${g.id}')" title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function unskipGoal() {
  showToast('🔒 Skipped goals are final and cannot be unskipped.');
}
window.unskipGoal = unskipGoal;

document.getElementById('goalFilters')?.addEventListener('click', e => {
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

  // RULE 1: IF COMPLETED, IT MUST NOT CHANGE AGAIN!
  if (g.done) {
    showToast('🔒 Completed goals are locked and cannot be changed.');
    return;
  }

  // RULE 2: IF SKIPPED OR DEADLINE HAS PASSED, IT CANNOT BE COMPLETED!
  const hasTime = g.time && g.time !== 'None';
  const isExpired = hasTime ? isGoalTimeExpired(g.time, dateKey) : false;
  if (g.skipped || isExpired) {
    g.skipped = true;
    saveState();
    refreshCurrent();
    showToast('🔒 Deadline passed! This goal was skipped and cannot be completed.');
    return;
  }

  // RULE 3: Active pending goal marked done -> LOCKED PERMANENTLY AS COMPLETED!
  g.done = true;
  g.skipped = false;
  showToast('✓ Goal completed! +10 pts (Locked permanently)');
  recalcPoints();
  saveState();
  refreshCurrent();
  checkBadges();
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

  const timeInput = document.getElementById('goalTime');
  const noneCheck = document.getElementById('goalTimeNone');

  if (editId) {
    const g = (state.goals[targetDate] || []).find(x => x.id === editId) || getGoals().find(x => x.id === editId);
    if (g) {
      if (g.done || g.skipped) {
        showToast('🔒 Completed or skipped goals are locked and cannot be edited.');
        return;
      }
      document.getElementById('goalTitle').value    = g.title;
      document.getElementById('goalCategory').value = g.category;
      document.getElementById('goalPriority').value = g.priority;
      document.getElementById('goalNotes').value    = g.notes || '';
      if (timeInput && noneCheck) {
        if (!g.time || g.time === 'None') {
          noneCheck.checked = true;
          timeInput.disabled = true;
          timeInput.value = '';
        } else {
          noneCheck.checked = false;
          timeInput.disabled = false;
          timeInput.value = g.time;
        }
      }
    }
  } else {
    document.getElementById('goalTitle').value    = '';
    document.getElementById('goalCategory').value = 'Study';
    document.getElementById('goalPriority').value = 'Medium';
    document.getElementById('goalNotes').value    = '';
    if (timeInput && noneCheck) {
      noneCheck.checked = true;
      timeInput.disabled = true;
      timeInput.value = '';
    }
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('goalTitle').focus(), 100);
}

function editGoal(id) { openGoalModal(id); }
function closeGoalModal() { document.getElementById('goalModalOverlay').classList.remove('open'); }

document.getElementById('openAddGoalModal')?.addEventListener('click', () => openGoalModal());
document.getElementById('goalModalClose')?.addEventListener('click', closeGoalModal);
document.getElementById('goalModalCancel')?.addEventListener('click', closeGoalModal);
document.getElementById('goalModalOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('goalModalOverlay')) closeGoalModal();
});

document.getElementById('goalModalSave')?.addEventListener('click', () => {
  const title    = document.getElementById('goalTitle').value.trim();
  const category = document.getElementById('goalCategory').value;
  const priority = document.getElementById('goalPriority').value;
  const notes    = document.getElementById('goalNotes').value.trim();
  const editId   = document.getElementById('editGoalId').value;
  const targetDate = document.getElementById('goalModalOverlay').dataset.targetDate || todayKey();

  if (!title) { showToast('Please enter a goal title'); return; }

  const timeInput = document.getElementById('goalTime');
  const noneCheck = document.getElementById('goalTimeNone');
  const isNone = noneCheck ? noneCheck.checked : (!timeInput || !timeInput.value);
  const timeVal = isNone || !timeInput || !timeInput.value ? 'None' : timeInput.value.trim();
  const isExpired = (!isNone && timeVal !== 'None') ? isGoalTimeExpired(timeVal, targetDate) : false;

  if (!state.goals[targetDate]) state.goals[targetDate] = [];

  if (editId) {
    const g = state.goals[targetDate].find(x => x.id === editId);
    if (g) {
      if (g.done || g.skipped) {
        showToast('🔒 Completed or skipped goals are locked and cannot be modified.');
        closeGoalModal();
        return;
      }
      g.title = title;
      g.category = category;
      g.priority = priority;
      g.notes = notes;
      g.time = timeVal;
      g.skipped = isExpired;
    }
  } else {
    state.goals[targetDate].push({
      id: uid(),
      title,
      category,
      priority,
      time: timeVal,
      notes,
      done: false,
      skipped: isExpired,
      createdAt: new Date().toISOString()
    });
  }

  recalcPoints();
  saveState();
  closeGoalModal();
  refreshCurrent();
  showToast(editId ? 'Goal updated!' : (isExpired ? 'Goal added (time already expired → Skipped)' : '🎯 Goal added!'));
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
    const week = getCurrentWeekDates();
    container.innerHTML = state.habits.map(h => {
      h.doneByDate = h.doneByDate || {};
      const done   = !!h.doneByDate[today];
      const streak = habitStreakForToday(h);

      const weekPills = week.dates.map(d => {
        const dDone = !!h.doneByDate[d.dateKey];
        if (dDone) {
          return `<span class="day-pill-check checked done locked" style="width:24px; height:24px; font-size:11px;" title="${d.fullName}: Done ✓">✓</span>`;
        } else if (d.isPast) {
          return `<span class="day-pill-check missed locked" style="width:24px; height:24px; font-size:11px;" title="${d.fullName}: Missed ✕">✕</span>`;
        } else if (d.isToday) {
          return `<span class="day-pill-check today-active" style="width:24px; height:24px; font-size:11px;" title="${d.fullName} (Today)">${done ? '✓' : '○'}</span>`;
        } else {
          return `<span class="day-pill-check future" style="width:24px; height:24px; font-size:11px;" title="${d.fullName}: Upcoming">○</span>`;
        }
      }).join('');

      return `
        <div class="habit-row" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <div class="habit-emoji">${h.emoji || '🎯'}</div>
          <div class="habit-info" style="min-width:140px; flex:1;">
            <div class="habit-name">${escHtml(h.name)}</div>
            <div class="habit-streak">${streak > 0 ? `🔥 ${streak}-day streak` : 'No streak yet'}</div>
          </div>
          <div class="habit-week-checks" style="display:inline-flex; gap:4px; margin:0 8px;">
            ${weekPills}
          </div>
          <button class="habit-check-btn ${done ? 'done locked' : ''}" ${done ? 'disabled' : ''} onclick="toggleHabit('${h.id}')" title="${done ? 'Completed: Locked permanently ✓' : 'Mark done for today (Locks permanently once completed)'}">
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
  if (h.doneByDate[key]) {
    showToast('🔒 Completed habit is locked and cannot be changed.');
    return;
  }
  h.doneByDate[key] = true;

  // Sync with state.dashHabits if present
  if (state.dashHabits) {
    const dashH = state.dashHabits.find(dh => dh.id === id || dh.name.toLowerCase() === h.name.toLowerCase());
    if (dashH) {
      dashH.doneByDate = dashH.doneByDate || {};
      dashH.doneByDate[key] = true;
    }
  }

  saveState();
  renderHabits();
  renderDashboardHabitsCard();
  renderDashboard();
  recalcPoints();
  checkBadges();
  showToast(`✓ ${h.name} completed! (Locked permanently)`);
}

function deleteHabit(id) {
  if (!confirm('Delete this habit?')) return;
  state.habits = state.habits.filter(h => h.id !== id);
  saveState();
  renderHabits();
  showToast('Habit deleted');
}

document.getElementById('openAddHabitModal')?.addEventListener('click', () => {
  document.getElementById('habitName').value  = '';
  document.getElementById('habitEmoji').value = '';
  document.getElementById('habitModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('habitName').focus(), 100);
});

function closeHabitModal() { document.getElementById('habitModalOverlay').classList.remove('open'); }
document.getElementById('habitModalClose')?.addEventListener('click', closeHabitModal);
document.getElementById('habitModalCancel')?.addEventListener('click', closeHabitModal);
document.getElementById('habitModalOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('habitModalOverlay')) closeHabitModal();
});

document.getElementById('habitModalSave')?.addEventListener('click', () => {
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
    showToast('🔒 Time-check is already verified and locked permanently.');
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
  const todayMonIndex = (new Date().getDay() + 6) % 7; // 0 = Mon, ..., 6 = Sun
  const currentDayName = days[todayMonIndex];
  const weekInfo = getCurrentWeekDates();

  const maxRows = Math.max(
    ...days.map(d => (state.timetable && state.timetable[d] ? state.timetable[d].length : 0)),
    18
  );

  let html = '<table class="tt-grid-table">';
  html += '<thead><tr>';
  html += '<th class="tt-grid-time-cell">Time Slot</th>';
  days.forEach((day, dIdx) => {
    const isToday = (dIdx === todayMonIndex);
    const dayDate = weekInfo.dates[dIdx];
    html += `<th class="${isToday ? 'col-today' : ''}">
      <div>${day}${isToday ? ' ★ (Today)' : ''}</div>
      <div style="font-size:10.5px; font-weight:600; opacity:0.75; margin-top:2px;">${dayDate ? dayDate.dateKey : ''}</div>
    </th>`;
  });
  html += '</tr></thead>';

  html += '<tbody>';
  for (let i = 0; i < maxRows; i++) {
    html += '<tr>';
    const weekdaySlot = (state.timetable && state.timetable['Monday'] && state.timetable['Monday'][i]);
    const timeLabel = weekdaySlot ? weekdaySlot.time : `Slot ${i + 1}`;
    html += `<td class="tt-grid-time-cell">${escHtml(timeLabel)}</td>`;

    // ── 7 DAY SCHEDULE CELLS ──
    days.forEach((day, dayIndex) => {
      const slot = (state.timetable && state.timetable[day] && state.timetable[day][i]);
      const isToday = (dayIndex === todayMonIndex);
      const isPast = (dayIndex < todayMonIndex);
      const isFuture = (dayIndex > todayMonIndex);
      const dayDateKey = weekInfo.dates[dayIndex] ? weekInfo.dates[dayIndex].dateKey : '';

      if (!slot) {
        html += `<td class="${isToday ? 'col-today' : ''}"><span style="color:var(--text-muted)">—</span></td>`;
        return;
      }

      const color = getSlotColor(slot.category, slot.task);
      const cat = slot.category || 'Routine';
      const dimColor = color + '1a';
      const isMatch = (filterCat === 'all' || cat.toLowerCase() === filterCat.toLowerCase() || (filterCat === 'Study' && cat.toLowerCase() === 'college'));
      const dimClass = isMatch ? '' : 'grid-cell-dimmed';

      state.timetableChecks = state.timetableChecks || {};
      const isDone = !!(state.timetableChecks[`${dayDateKey}_${slot.id}`] || state.timetableChecks[`${day}_${slot.id}`]);
      const isExpired = isToday && isSlotTimeExpired(slot.time);

      let statusBadge = '';
      let statusCardClass = '';
      let actionBtn = '';

      if (isDone) {
        statusCardClass = 'card-done';
        statusBadge = `<span class="grid-cell-status-badge done" title="Finished ✓ (Locked)"><span class="status-sym">✓</span> Finished</span>`;
      } else if (isPast) {
        // PREVIOUS DAY UNCOMPLETED: STRICT WRONG SYMBOL ✕
        statusCardClass = 'card-missed';
        statusBadge = `<span class="grid-cell-status-badge missed" title="Missed ✕ (Previous day unfinished - Locked)"><span class="status-sym">✕</span> Missed</span>`;
      } else if (isToday) {
        if (isExpired) {
          // TODAY EXPIRED UNCOMPLETED: STRICT WRONG SYMBOL ✕
          statusCardClass = 'card-missed';
          statusBadge = `<span class="grid-cell-status-badge missed" title="Missed ✕ (Time expired today - Locked)"><span class="status-sym">✕</span> Missed</span>`;
        } else {
          // TODAY ACTIVE/UPCOMING
          statusBadge = `<span class="grid-cell-status-badge" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">Active</span>`;
          actionBtn = `<button type="button" class="grid-cell-check-btn" onclick="event.stopPropagation(); toggleTimetableSlot('${slot.id}', '${day}', '${dayDateKey}')" title="Click to finish slot and lock">○ Finish</button>`;
        }
      } else {
        // FUTURE
        statusBadge = `<span class="grid-cell-status-badge" style="background:var(--sage-light); color:var(--text-muted); opacity:0.75;">Scheduled</span>`;
      }

      html += `
        <td class="${isToday ? 'col-today' : ''}">
          <div class="grid-cell-card ${dimClass} ${statusCardClass}" style="--cell-color: ${color};" onclick="openTtModal('${slot.id}', '${day}')" title="${escHtml(slot.task)}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px; gap:4px;">
              <span class="grid-cell-time">${escHtml(slot.time)}</span>
              ${statusBadge}
            </div>
            <span class="grid-cell-task">${escHtml(slot.task)}</span>
            ${slot.details ? `<span class="grid-cell-sub">${escHtml(slot.details)}</span>` : ''}
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:4px;">
              <span class="grid-cell-badge" style="background:${dimColor}; color:${color};">${escHtml(cat)}</span>
              ${actionBtn}
            </div>
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

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const viewDayIndex = dayNames.indexOf(currentTtViewDay);
  const todayMonIndex = (new Date().getDay() + 6) % 7;
  const isPastViewDay = (viewDayIndex < todayMonIndex);
  const isTodayViewDay = (viewDayIndex === todayMonIndex);
  const weekInfo = getCurrentWeekDates();
  const viewDayDateKey = (viewDayIndex >= 0 && weekInfo.dates[viewDayIndex]) ? weekInfo.dates[viewDayIndex].dateKey : todayKey();

  timelineContainer.innerHTML = rows.map(row => {
    const color = getSlotColor(row.category, row.task);
    const cat = row.category || 'Study';
    state.timetableChecks = state.timetableChecks || {};
    const isDone = !!(state.timetableChecks[`${viewDayDateKey}_${row.id}`] || state.timetableChecks[`${currentTtViewDay}_${row.id}`]);
    const isExpired = isTodayViewDay && isSlotTimeExpired(row.time);

    let statusBadge = '';
    let actionButtons = '';

    if (isDone) {
      statusBadge = '<span class="grid-cell-status-badge done" style="margin-left:8px;"><span class="status-sym">✓</span> Finished</span>';
      actionButtons = '<span style="font-size:12px; color:#15803d; font-weight:700;">Locked ✓</span>';
    } else if (isPastViewDay) {
      statusBadge = '<span class="grid-cell-status-badge missed" style="margin-left:8px;"><span class="status-sym">✕</span> Missed</span>';
      actionButtons = '<span style="font-size:12px; color:#dc2626; font-weight:700;">Missed ✕ (Locked)</span>';
    } else if (isTodayViewDay) {
      if (isExpired) {
        statusBadge = '<span class="grid-cell-status-badge missed" style="margin-left:8px;"><span class="status-sym">✕</span> Missed</span>';
        actionButtons = '<span style="font-size:12px; color:#dc2626; font-weight:700;">Expired ✕ (Locked)</span>';
      } else {
        statusBadge = '<span class="grid-cell-status-badge" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; margin-left:8px;">Active</span>';
        actionButtons = `
          <button class="btn-primary btn-sm" onclick="toggleTimetableSlot('${row.id}', '${currentTtViewDay}', '${viewDayDateKey}')">○ Finish</button>
          <button class="btn-secondary btn-sm" onclick="openTtModal('${row.id}', '${currentTtViewDay}')">Edit</button>
          <button class="btn-icon danger" onclick="deleteTimetableRow('${row.id}', '${currentTtViewDay}')" title="Delete">✕</button>
        `;
      }
    } else {
      statusBadge = '<span class="grid-cell-status-badge" style="background:var(--sage-light); color:var(--text-muted); opacity:0.75; margin-left:8px;">Scheduled</span>';
      actionButtons = `
        <button class="btn-secondary btn-sm" onclick="openTtModal('${row.id}', '${currentTtViewDay}')">Edit</button>
        <button class="btn-icon danger" onclick="deleteTimetableRow('${row.id}', '${currentTtViewDay}')" title="Delete">✕</button>
      `;
    }

    return `
      <div class="tt-timeline-slot" style="--slot-color: ${color};">
        <div class="tt-time-pill">${escHtml(row.time)}</div>
        <div class="tt-task-box">
          <div class="tt-task-title" style="display:flex; align-items:center;">
            <span>${escHtml(row.task)}</span>
            ${statusBadge}
          </div>
          ${row.details ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escHtml(row.details)}</div>` : ''}
          <div class="tt-task-cat"><span style="color:${color}">●</span> ${cat}</div>
        </div>
        <div class="tt-slot-actions">
          ${actionButtons}
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
  if (editId) {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dIdx = dayNames.indexOf(day);
    const todayMonIndex = (new Date().getDay() + 6) % 7;
    const weekInfo = getCurrentWeekDates();
    const dayDateKey = dIdx >= 0 && weekInfo.dates[dIdx] ? weekInfo.dates[dIdx].dateKey : '';
    const isDone = !!(state.timetableChecks && (state.timetableChecks[`${dayDateKey}_${editId}`] || state.timetableChecks[`${day}_${editId}`]));
    const isPast = (dIdx < todayMonIndex);
    if (isDone || isPast) {
      showToast('🔒 This slot is finalized (completed or missed) and is locked permanently.');
      return;
    }
  }

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

document.getElementById('ttModalClose')?.addEventListener('click', closeTtModal);
document.getElementById('ttModalCancel')?.addEventListener('click', closeTtModal);
document.getElementById('ttModalOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('ttModalOverlay')) closeTtModal();
});

// Quick Activity Preset Chips
document.getElementById('ttQuickPresets')?.addEventListener('click', e => {
  const chip = e.target.closest('.preset-chip');
  if (!chip) return;
  const task = chip.dataset.task;
  const cat = chip.dataset.cat;
  if (task) document.getElementById('ttTaskName').value = task;
  if (cat) document.getElementById('ttCategorySelect').value = cat;
});

// Save Time Slot
document.getElementById('ttModalSave')?.addEventListener('click', () => {
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
document.getElementById('ttModalDelete')?.addEventListener('click', () => {
  const day = document.getElementById('ttDaySelect').value;
  const editId = document.getElementById('editTtId').value;
  if (!editId) return;
  deleteTimetableRow(editId, day);
  closeTtModal();
});

function deleteTimetableRow(id, day = currentTtDay) {
  if (!state.timetable || !state.timetable[day]) return;
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dIdx = dayNames.indexOf(day);
  const todayMonIndex = (new Date().getDay() + 6) % 7;
  const weekInfo = getCurrentWeekDates();
  const dayDateKey = dIdx >= 0 && weekInfo.dates[dIdx] ? weekInfo.dates[dIdx].dateKey : '';
  const isDone = !!(state.timetableChecks && (state.timetableChecks[`${dayDateKey}_${id}`] || state.timetableChecks[`${day}_${id}`]));
  const isPast = (dIdx < todayMonIndex);
  if (isDone || isPast) {
    showToast('🔒 Finalized timetable slot (completed or missed) is locked and cannot be deleted.');
    return;
  }
  state.timetable[day] = state.timetable[day].filter(r => r.id !== id);
  saveState();
  renderTimetableSidebar();
  renderTimetableSection();
  renderWeeklyGridTimetable(currentTtGridFilter);
  if (currentSection === 'calendar') renderCalendar();
  showToast('Time slot removed');
}

document.getElementById('ttAddBtn')?.addEventListener('click', () => openTtModal(null, currentTtDay));
document.getElementById('openAddTtModalBtn')?.addEventListener('click', () => openTtModal(null, currentTtViewDay));
document.getElementById('ttAddSlotDirectBtn')?.addEventListener('click', () => openTtModal(null, currentTtViewDay));
document.getElementById('ttGoToSection')?.addEventListener('click', e => {
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
    goalsContainer.innerHTML = gs.map(g => {
      const isLocked = g.done || g.skipped || (g.time && g.time !== 'None' && isGoalTimeExpired(g.time, key));
      return `
        <div class="goal-mini-item ${g.done ? 'completed' : (g.skipped ? 'skipped' : '')}">
          <div class="mini-dot" style="background:${catColor(g.category)}"></div>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(g.title)}</span>
          <button class="btn-icon" ${isLocked ? 'disabled style="cursor:not-allowed; opacity:0.75;"' : `onclick="toggleGoal('${g.id}', '${key}')"`} title="${g.done ? 'Done (Locked permanently)' : (g.skipped ? 'Skipped (Locked permanently)' : 'Click to complete')}" style="margin-left:auto; color:${g.done ? 'var(--green)' : (g.skipped ? 'var(--red)' : 'var(--text-muted)')}; font-weight:700;">
            ${g.done ? '✓ Done' : (g.skipped ? '✕ Skipped' : '○ Pending')}
          </button>
        </div>
      `;
    }).join('');
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

document.getElementById('calPrev')?.addEventListener('click', () => {
  calDate.setMonth(calDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById('calNext')?.addEventListener('click', () => {
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
    { id: uid(), title: 'Review JavaScript & async patterns', category: 'Study',    priority: 'High',   time: '10:00', notes: 'Deep dive into event loop and microtasks', done: true, skipped: false },
    { id: uid(), title: 'Study chemistry',                    category: 'Study',    priority: 'High',   time: '16:00', notes: 'Chapters on organic reaction mechanisms',    done: false, skipped: false },
    { id: uid(), title: 'Solve 2 LeetCode problems',          category: 'Coding',   priority: 'High',   time: '19:00', notes: 'Trees and Dynamic Programming',             done: false, skipped: false },
    { id: uid(), title: '30-min cardio / workout',            category: 'Exercise', priority: 'Medium', time: '07:00', notes: 'Keep consistency high',                    done: true, skipped: false },
    { id: uid(), title: 'Read 20 pages of Atomic Habits',     category: 'Personal', priority: 'Low',    time: 'None',  notes: 'Chapter 4',                                 done: false, skipped: false },
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
  document.getElementById('restartBtn')?.addEventListener('click', restartApp);
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

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayMonIdx = (new Date().getDay() + 6) % 7;
  const activeMonIdx = dayNames.indexOf(activeDay);
  const isPastDay = (activeMonIdx >= 0 && activeMonIdx < todayMonIdx);
  const isRealToday = (activeDay === realTodayName);
  const isFutureDay = (activeMonIdx >= 0 && activeMonIdx > todayMonIdx);

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
          ${isRealToday ? '<span class="today-star-badge">★ Real Today</span>' : (isPastDay ? '<span class="today-cat-badge" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;">Past Day</span>' : '')}
        </div>
        <div class="today-widget-sub">Check off individual exercise sets/reps and verify grooming completion times with instant logs</div>
      </div>

      <div class="today-day-tabs">
        ${dayNames.map(d => `
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
            if (isDone) {
              return `
                <label class="today-exercise-item done locked">
                  <input type="checkbox" checked disabled />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(ex)}</span>
                    <span class="exercise-tag">✓ Completed (Locked)</span>
                  </div>
                </label>
              `;
            } else if (isPastDay) {
              return `
                <label class="today-exercise-item missed locked" title="Missed on ${activeDay} — Locked">
                  <span class="exercise-missed-sym" style="color:#dc2626; font-size:14px; font-weight:900; margin-right:8px;">✕</span>
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(ex)}</span>
                    <span class="exercise-tag" style="color:#dc2626; font-weight:700;">✕ Missed (Not completed)</span>
                  </div>
                </label>
              `;
            } else if (isRealToday) {
              return `
                <label class="today-exercise-item">
                  <input type="checkbox" onchange="toggleExerciseCheck('${activeDay}', ${idx}, this.checked)" />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(ex)}</span>
                    <span class="exercise-tag">Exercise ${idx + 1}</span>
                  </div>
                </label>
              `;
            } else {
              return `
                <label class="today-exercise-item future locked" style="opacity:0.6; cursor:not-allowed;">
                  <input type="checkbox" disabled />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(ex)}</span>
                    <span class="exercise-tag">Upcoming (${activeDay})</span>
                  </div>
                </label>
              `;
            }
          }).join('') : `
            <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">
              No exercises defined for this day. <button class="btn-secondary btn-sm" onclick="openEditWorkoutModal('${activeDay}')">Add Exercises</button>
            </div>
          `}
        </div>

        <div class="today-col-actions">
          ${workoutLog ? `
            <div class="time-check-status-banner locked">
              <span class="status-icon">✓</span>
              <div class="status-info">
                <strong>Workout Verified & Finished!</strong>
                <span>Logged at ${escHtml(workoutLog.time || 'Completed')} • Locked permanently ✓</span>
              </div>
            </div>
          ` : (isPastDay ? `
            <div class="time-check-status-banner missed" style="background:#fee2e2; border:1.5px solid #fca5a5; color:#dc2626; border-radius:10px; padding:12px; display:flex; gap:10px; align-items:center;">
              <span class="status-icon" style="color:#dc2626; font-size:18px; font-weight:900;">✕</span>
              <div class="status-info">
                <strong style="color:#dc2626;">Past Workout Session Missed</strong>
                <span style="color:#991b1b; display:block; font-size:12px;">This day (${activeDay}) was not completed • Locked ✕</span>
              </div>
            </div>
          ` : `
            <button class="btn-timecheck-action workout-action" onclick="finishTodayWorkoutCheck('${activeDay}')">
              <span>🏋️</span>
              <span>Finish Today's Workout & Record Time-Check</span>
            </button>
          `)}
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
            if (isDone) {
              return `
                <label class="today-exercise-item done locked">
                  <input type="checkbox" checked disabled />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(gm.text)}</span>
                    <span class="exercise-tag">✓ Verified (Locked)</span>
                  </div>
                </label>
              `;
            } else if (isPastDay) {
              return `
                <label class="today-exercise-item missed locked" title="Missed on ${activeDay} — Locked">
                  <span class="exercise-missed-sym" style="color:#dc2626; font-size:14px; font-weight:900; margin-right:8px;">✕</span>
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(gm.text)}</span>
                    <span class="exercise-tag" style="color:#dc2626; font-weight:700;">✕ Missed (Not verified)</span>
                  </div>
                </label>
              `;
            } else if (isRealToday) {
              return `
                <label class="today-exercise-item">
                  <input type="checkbox" onchange="toggleGroomingItemCheck(${gIdx}, this.checked)" />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(gm.text)}</span>
                    <span class="exercise-tag">${escHtml(gm.freq || 'Daily')}</span>
                  </div>
                </label>
              `;
            } else {
              return `
                <label class="today-exercise-item future locked" style="opacity:0.6; cursor:not-allowed;">
                  <input type="checkbox" disabled />
                  <div class="exercise-info">
                    <span class="exercise-name">${escHtml(gm.text)}</span>
                    <span class="exercise-tag">Upcoming (${activeDay})</span>
                  </div>
                </label>
              `;
            }
          }).join('')}
        </div>

        <div class="today-col-actions">
          ${groomingLog ? `
            <div class="time-check-status-banner locked">
              <span class="status-icon">✨</span>
              <div class="status-info">
                <strong>Grooming Protocol Verified!</strong>
                <span>Logged at ${escHtml(groomingLog.time || 'Completed')} • Locked permanently ✓</span>
              </div>
            </div>
          ` : (isPastDay ? `
            <div class="time-check-status-banner missed" style="background:#fee2e2; border:1.5px solid #fca5a5; color:#dc2626; border-radius:10px; padding:12px; display:flex; gap:10px; align-items:center;">
              <span class="status-icon" style="color:#dc2626; font-size:18px; font-weight:900;">✕</span>
              <div class="status-info">
                <strong style="color:#dc2626;">Past Grooming Session Missed</strong>
                <span style="color:#991b1b; display:block; font-size:12px;">This day (${activeDay}) was not recorded • Locked ✕</span>
              </div>
            </div>
          ` : `
            <button class="btn-timecheck-action grooming-action" onclick="finishTodayGroomingCheck()">
              <span>✨</span>
              <span>Verify Grooming & Record Time-Check</span>
            </button>
          `)}
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function toggleExerciseCheck(day, idx, isChecked) {
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayMonIdx = (new Date().getDay() + 6) % 7;
  const activeMonIdx = dayNames.indexOf(day);
  if (activeMonIdx >= 0 && activeMonIdx < todayMonIdx) {
    showToast('🔒 Past days cannot be modified — uncompleted exercises remain missed (✕).');
    return;
  }

  state.dailyExerciseChecks = state.dailyExerciseChecks || {};
  const key = `${todayKey()}_${day}`;
  state.dailyExerciseChecks[key] = state.dailyExerciseChecks[key] || [];

  if (state.dailyExerciseChecks[key].includes(idx)) {
    showToast('🔒 Completed exercise is locked and cannot be unchecked.');
    return;
  }

  if (isChecked) {
    state.dailyExerciseChecks[key].push(idx);
    saveState();
    renderTodayWorkoutWidget(day);
    showToast('💪 Exercise completed! (Locked permanently)');
  }
}

function finishTodayWorkoutCheck(day) {
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayMonIdx = (new Date().getDay() + 6) % 7;
  const activeMonIdx = dayNames.indexOf(day);
  if (activeMonIdx >= 0 && activeMonIdx < todayMonIdx) {
    showToast('🔒 Past workout sessions cannot be recorded retroactively.');
    return;
  }

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
  showToast(`Workout finished at ${timeStr}! (Locked permanently) 💪🔥`);
}

function undoTodayWorkoutCheck(day) {
  showToast('🔒 Verified workout log is locked and cannot be undone.');
}

function toggleGroomingItemCheck(idx, isChecked) {
  state.dailyGroomingChecks = state.dailyGroomingChecks || {};
  const tKey = todayKey();
  state.dailyGroomingChecks[tKey] = state.dailyGroomingChecks[tKey] || [];

  if (state.dailyGroomingChecks[tKey].includes(idx)) {
    showToast('🔒 Completed grooming item is locked and cannot be unchecked.');
    return;
  }

  if (isChecked) {
    state.dailyGroomingChecks[tKey].push(idx);
    saveState();
    renderTodayWorkoutWidget();
    showToast('✨ Grooming item checked! (Locked permanently)');
  }
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
  showToast(`Grooming routine verified at ${timeStr}! (Locked permanently) ✨`);
}

function undoTodayGroomingCheck() {
  showToast('🔒 Verified grooming log is locked and cannot be undone.');
}

// ── PROFILE & AVATAR SETTINGS ──
function selectAvatar(emoji, btn) {
  state.user = state.user || {};
  state.user.avatar = emoji;
  state.user.avatarPhoto = null; // Clear uploaded photo when choosing an avatar emoji
  saveState();
  saveStoredAccount(state.user);

  renderUserIdentity();

  document.querySelectorAll('.avatar-choice-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-av') === emoji || b === btn);
  });

  showToast(`Profile avatar updated to ${emoji}! ✨`);
}

function renderProfileSection() {
  state.user = state.user || { name: 'Michał Masiak', avatar: '⚡',
    avatarPhoto: null,
    logoImage: null,
    logoIcon: '🌿', email: 'michal.masiak@anywhere.co', role: 'Focus Champion' };
  
  // Render identity displays including DP photo preview (#profileAvatarDisplay) and top-right card!
  renderUserIdentity();

  document.querySelectorAll('.avatar-choice-btn').forEach(b => {
    b.classList.toggle('active', !state.user.avatarPhoto && b.getAttribute('data-av') === (state.user.avatar || '⚡'));
  });

  const nameParts = (state.user.name || 'Michał Masiak').split(' ');
  const fName = document.getElementById('profFirstName');
  const lName = document.getElementById('profLastName');
  const uName = document.getElementById('profUsername');
  const email = document.getElementById('profEmail');
  const role = document.getElementById('profStatus');

  if (fName) fName.value = nameParts[0] || 'Michał';
  if (lName) lName.value = nameParts.slice(1).join(' ') || 'Masiak';
  if (uName) uName.value = (state.user && state.user.username) || 'michal_masiak';
  if (email) email.value = state.user.email || 'michal.masiak@anywhere.co';
  if (role) role.value = state.user.role || state.user.status || 'Focus Champion';
}

function saveProfileSettings(e) {
  if (e) e.preventDefault();
  const fName = (document.getElementById('profFirstName')?.value || '').trim();
  const lName = (document.getElementById('profLastName')?.value || '').trim();
  const rawUsername = (document.getElementById('profUsername')?.value || '').trim();
  const username = rawUsername.replace(/^@/, '');
  const email = (document.getElementById('profEmail')?.value || '').trim();
  const role = (document.getElementById('profStatus')?.value || '').trim();

  state.user = state.user || {};
  if (username) {
    if (username.length < 3) {
      showToast('Username must be at least 3 characters! ⚠️');
      return false;
    }
    if (/\s/.test(username)) {
      showToast('Username cannot contain spaces! ⚠️');
      return false;
    }
    const existing = findStoredAccount(username);
    if (existing && existing.username.toLowerCase() !== (state.user.username || '').toLowerCase()) {
      showToast(`Username "${username}" is already taken! ⚠️`);
      return false;
    }
    state.user.username = username;
  }

  state.user.name = `${fName} ${lName}`.trim() || state.user.username || 'Michał Masiak';
  state.user.email = email || 'michal.masiak@anywhere.co';
  state.user.role = role || 'Focus Champion';

  // Update in accounts storage
  saveStoredAccount({
    username: state.user.username,
    name: state.user.name,
    password: state.user.password || '13579',
    role: state.user.role,
    email: state.user.email,
    avatar: state.user.avatar || '⚡',
    avatarPhoto: state.user.avatarPhoto || null
  });

  saveState();
  renderUserIdentity();
  updateSidebarUserProfile();
  showToast('Profile and username saved successfully! ✨');
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
  if (state.user.username) {
    saveStoredAccount({
      username: state.user.username,
      name: state.user.name,
      password: newPin
    });
  }
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
window.toggleAuthMode = toggleAuthMode;
window.setAuthMode = setAuthMode;
window.handleLogin = handleLogin;
window.guestLogin = guestLogin;
window.handleLogout = handleLogout;
window.openMethodDialog = openMethodDialog;
window.closeMethodDialog = closeMethodDialog;
window.toggleLoginPassword = toggleLoginPassword;
window.selectAvatar = selectAvatar;
window.renderProfileSection = renderProfileSection;
window.saveProfileSettings = saveProfileSettings;
window.savePinSettings = savePinSettings;
window.saveAppPreferences = saveAppPreferences;
window.exportDataJson = exportDataJson;
window.setAppTheme = function() {};
window.setAccentColor = function() {};
window.setCardRadius = function() {};
window.renderTodayWorkoutWidget = renderTodayWorkoutWidget;
window.toggleExerciseCheck = toggleExerciseCheck;
window.finishTodayWorkoutCheck = finishTodayWorkoutCheck;
window.undoTodayWorkoutCheck = undoTodayWorkoutCheck;
window.toggleGroomingItemCheck = toggleGroomingItemCheck;
window.finishTodayGroomingCheck = finishTodayGroomingCheck;
window.undoTodayGroomingCheck = undoTodayGroomingCheck;
window.openAddWorkoutModal = openAddWorkoutModal;
window.openEditWorkoutModal = openWorkoutModal;
window.closeWorkoutModal = closeWorkoutModal;
window.openAddWellnessModal = openAddWellnessModal;
window.openEditWellnessModal = openEditWellnessModal;
window.closeWellnessModal = closeWellnessModal;
window.renderDashboardHabitsCard = renderDashboardHabitsCard;
window.toggleDashboardHabitDay = toggleDashboardHabitDay;
window.getCurrentWeekDates = getCurrentWeekDates;
window.ensureDashboardHabitsInitialized = ensureDashboardHabitsInitialized;
window.toggleTimetableSlot = toggleTimetableSlot;
window.isSlotTimeExpired = isSlotTimeExpired;

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

// ── SQLITE DATABASE UI HELPERS & MODAL ──
async function showDatabaseModal() {
  const overlay = document.getElementById('dbModalOverlay');
  if (!overlay) return;
  overlay.classList.add('active');

  const statusPill = document.getElementById('dbModalStatusPill');
  const userListEl = document.getElementById('dbModalUserList');

  // Check connection status
  const dbInfo = await FlowTrackDB.checkStatus();
  if (FlowTrackDB.connected && dbInfo) {
    if (statusPill) {
      statusPill.className = 'db-status-pill online';
      statusPill.textContent = '🟢 Online (' + (dbInfo.db_file || 'flowtrack.db') + ')';
    }

    if (userListEl) {
      userListEl.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text-muted); font-size: 12px;">Loading user accounts...</div>';
      try {
        const users = await FlowTrackDB.getUsers();
        if (users && users.length > 0) {
          let html = '<div style="display:flex; flex-direction:column; gap:6px;">';
          users.forEach(u => {
            const isCurrent = (state.user && state.user.username && state.user.username.toLowerCase() === u.username.toLowerCase());
            const avatarHtml = u.avatar_photo 
              ? `<img src="${u.avatar_photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--border-subtle);">` 
              : `<span style="width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--sage-light);font-size:14px;">${u.avatar || '🌱'}</span>`;

            html += `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:${isCurrent ? 'var(--sage-light)' : '#fbfcfb'}; border:1px solid ${isCurrent ? 'var(--forest-subtle, #52796f)' : 'var(--border-subtle, #e0ede5)'}; border-radius:8px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  ${avatarHtml}
                  <div>
                    <div style="font-weight:700; font-size:13px; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                      ${u.name || u.username}
                      ${isCurrent ? '<span style="font-size:10px; padding:1px 6px; border-radius:4px; background:var(--forest); color:#fff; font-weight:700;">CURRENT</span>' : ''}
                    </div>
                    <div style="font-size:11px; color:var(--text-muted);">@${u.username} • ${u.role || 'Member'}</div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:10.5px; color:var(--forest); font-family:monospace; background:rgba(82,121,111,0.1); padding:2px 6px; border-radius:4px;">SQLite ID #${u.id}</span>
                </div>
              </div>
            `;
          });
          html += '</div>';
          userListEl.innerHTML = html;
        } else {
          userListEl.innerHTML = '<div style="padding:8px; text-align:center; color:var(--text-muted); font-size:12px;">No users found in database yet.</div>';
        }
      } catch (err) {
        userListEl.innerHTML = '<div style="padding:8px; color:#e63946; font-size:12px;">Failed to fetch users from database.</div>';
      }
    }
  } else {
    if (statusPill) {
      statusPill.className = 'db-status-pill offline';
      statusPill.textContent = '🟡 Offline (Local Storage)';
    }
    if (userListEl) {
      userListEl.innerHTML = `
        <div style="padding:10px; background:#fff7ed; border-radius:8px; font-size:12px; color:#c2410c; line-height:1.4;">
          <strong>Database Server is not active!</strong><br>
          Double click <code>start_server.bat</code> in your project folder to start the SQLite backend on <code>http://localhost:5000</code>.
        </div>
      `;
    }
  }
}

function closeDatabaseModal() {
  const overlay = document.getElementById('dbModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

async function syncWithDatabase() {
  if (!FlowTrackDB.connected) {
    await FlowTrackDB.checkStatus();
  }
  if (!FlowTrackDB.connected) {
    showToast('⚠️ SQLite server is offline. Run start_server.bat to sync.');
    return;
  }
  try {
    // 1. Sync current profile
    if (state.user && state.user.username) {
      await FlowTrackDB.updateProfile({
        username: state.user.username,
        name: state.user.name,
        email: state.user.email,
        password: state.user.password || '13579',
        role: state.user.role || state.user.status,
        avatar: state.user.avatar || '⚡',
        avatarPhoto: state.user.avatarPhoto || null,
        logoImage: state.user.logoImage || null,
        logoIcon: state.user.logoIcon || '🌿'
      });
      // 2. Sync master state
      await FlowTrackDB.saveState(state.user.username, state);
      showToast('✅ All data synchronized with SQLite database (flowtrack.db)!');
      // Refresh modal user list if open
      const overlay = document.getElementById('dbModalOverlay');
      if (overlay && overlay.classList.contains('active')) {
        showDatabaseModal();
      }
    }
  } catch (e) {
    showToast('❌ Sync failed: ' + (e.message || 'Network error'));
  }
}

// Overlay click listener for SQLite database details modal
const dbOverlay = document.getElementById('dbModalOverlay');
if (dbOverlay) {
  dbOverlay.addEventListener('click', e => {
    if (e.target === dbOverlay) closeDatabaseModal();
  });
}

// Export database functions to window
window.showDatabaseModal = showDatabaseModal;
window.closeDatabaseModal = closeDatabaseModal;
window.syncWithDatabase = syncWithDatabase;

