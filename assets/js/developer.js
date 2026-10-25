// wellmimir.com/developer: the Mimir credits monitor. Sign in with an emailed
// code (Supabase Auth, the same account service Mimir uses), then read the
// admin RPCs: totals, a 30-day chart, every user's balance and use, a user's
// ledger, a form that gives (or takes back) credits, the bug reports people
// and Mimir's error checker send (each marked checked, fixed or ignored), and
// messages: free words to one user or to everyone, read and answered inside Mimir.
//
// Two locks, both kept by the account service, not by this page: the account
// must be on the developers' list (mimir_private.credit_admins, by account id),
// and the session must have passed an authenticator app's code (Supabase Auth
// MFA, TOTP) in the last twelve hours, with exactly one authenticator on the
// account. This page only walks a developer through the second step.
//
// Every node that shows data is built with createElement + textContent:
// emails and notes are written by users, so nothing here uses innerHTML.
(() => {
  'use strict';

  const API = 'https://ujeqidiltvghvhawbrag.supabase.co';
  // Publishable by design: it ships inside the desktop app.
  const KEY = 'sb_publishable_R2Ib-rShs2p7nxL2x5l76w_9eDawjed';
  const SESSION_KEY = 'mimir-dev-session';
  const REFRESH_MS = 60 * 1000;
  const MICROS_PER_CREDIT = 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const $ = (id) => document.getElementById(id);

  // ── Small helpers ────────────────────────────────────────────────────────
  const el = (tag, props, ...children) => {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  };
  const svgEl = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const credits = (micros) => intFmt.format(Math.round(num(micros) / MICROS_PER_CREDIT));
  const creditsWord = (micros) => `${credits(micros)} credits`;
  const dollars = (micros) => usdFmt.format(num(micros) / 1e6);
  const signedCredits = (micros) => {
    const n = Math.round(num(micros) / MICROS_PER_CREDIT);
    return (n > 0 ? '+' : n < 0 ? '−' : '') + intFmt.format(Math.abs(n));
  };
  const time = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  };
  const ago = (iso) => {
    const t = time(iso);
    if (t == null) return 'never';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))} mo ago`;
    return `${Math.floor(s / (86400 * 365))} y ago`;
  };
  const fullDate = (iso) => {
    const t = time(iso);
    return t == null ? '' : new Date(t).toLocaleString();
  };
  const shortDate = (iso) => {
    const t = time(iso);
    return t == null ? '—' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const say = (node, text, tone) => {
    node.textContent = text || '';
    node.dataset.tone = tone || '';
  };

  // ── Session (sessionStorage only: gone when the tab closes) ──────────────
  let session = null;
  const loadSession = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      return s && s.access_token && s.refresh_token ? s : null;
    } catch { return null; }
  };
  const saveSession = (s) => {
    session = s;
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* private window: the session lives in memory only */ }
  };
  const fromAuthAnswer = (a) => ({
    access_token: a.access_token,
    refresh_token: a.refresh_token,
    expires_at: num(a.expires_at) || Math.floor(Date.now() / 1000) + num(a.expires_in || 3600),
    email: (a.user && a.user.email) || (session && session.email) || '',
  });

  // ── HTTP ─────────────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(status, body) {
      const b = body && typeof body === 'object' ? body : {};
      super(b.msg || b.message || b.error_description || b.error || `HTTP ${status}`);
      this.status = status;
      this.code = b.error_code || b.code || '';
      this.body = b;
    }
  }
  const call = async (path, body, { auth = false, method = 'POST' } = {}) => {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (auth && session) headers.Authorization = `Bearer ${session.access_token}`;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { msg: 'network' });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  };

  let refreshing = null;
  const refreshSession = () => {
    if (!session) return Promise.reject(new ApiError(401, { msg: 'signed out' }));
    if (!refreshing) {
      refreshing = call('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then((a) => { saveSession(fromAuthAnswer(a)); scheduleRefresh(); })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  };
  let refreshTimer = 0;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    if (!session) return;
    // Refresh two minutes before the token ends (never sooner than in 5 s).
    const wait = Math.max(5000, session.expires_at * 1000 - Date.now() - 120 * 1000);
    refreshTimer = setTimeout(() => { refreshSession().catch(onSessionLost); }, wait);
  };
  const fresh = async () => {
    if (session && session.expires_at * 1000 - Date.now() < 60 * 1000) await refreshSession();
  };

  // A call to the admin RPCs, with one refresh-and-retry on an expired token.
  const rpc = async (name, body) => {
    await fresh();
    try {
      return await call(`/rest/v1/rpc/${name}`, body || {}, { auth: true });
    } catch (err) {
      if (err.status === 401 && err.code !== '42501') {
        await refreshSession();
        return call(`/rest/v1/rpc/${name}`, body || {}, { auth: true });
      }
      throw err;
    }
  };
  const isNotInstalled = (err) => err.status === 404 || err.code === 'PGRST202' || err.code === '42883';
  // The account is on the list but this session has not passed the authenticator code.
  const needsMfa = (err) => !!(err && err.body && err.body.hint === 'mfa');
  const isNotAdmin = (err) => err.code === '42501' || err.status === 403;

  // Plain words for what the auth service says.
  const authWords = (err) => {
    const code = String(err.code || '');
    const msg = String(err.message || '').toLowerCase();
    if (err.status === 0) return 'Could not reach the account service. Check the connection and try again.';
    if (err.status === 429 || code.startsWith('over_') || msg.includes('rate limit') || msg.includes('security purposes')) {
      return 'Too many tries. Wait a minute, then try again.';
    }
    if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('email address')) {
      return 'That email address does not look right.';
    }
    if (code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid')) {
      return 'That code is wrong or has expired. Check it, or send a new one.';
    }
    if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found' || msg.includes('signups not allowed')) {
      return 'No Mimir account uses that email.';
    }
    return `The account service said: ${err.message}`;
  };
  const rpcWords = (err) => {
    if (err.status === 0) return 'Could not reach the account service. Check the connection.';
    return err.message || `The account service answered ${err.status}.`;
  };

  // ── Views ────────────────────────────────────────────────────────────────
  const views = ['signin', 'mfa', 'blocked', 'dash', 'loading'];
  const show = (name) => {
    for (const v of views) $(v).hidden = v !== name;
    const signedIn = !!session && name !== 'signin';
    $('who').hidden = !signedIn;
    $('who-email').textContent = signedIn ? session.email : '';
  };

  // ── Sign in ──────────────────────────────────────────────────────────────
  let pendingEmail = '';
  const showSignIn = (msg) => {
    stopAuto();
    $('email-form').hidden = false;
    $('code-form').hidden = true;
    say($('signin-msg'), msg || '', msg ? 'error' : '');
    show('signin');
  };
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((n) => { n.disabled = on; });

  $('email-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say($('signin-msg'), 'That email address does not look right.', 'error');
      return;
    }
    busy($('email-form'), true);
    say($('signin-msg'), 'Sending…');
    try {
      await call('/auth/v1/otp', { email, create_user: false });
      pendingEmail = email;
      $('email-form').hidden = true;
      $('code-form').hidden = false;
      $('code-sent').textContent = `We sent a code to ${email}. It works once and soon expires.`;
      $('code').value = '';
      say($('signin-msg'), '');
      $('code').focus();
    } catch (err) {
      say($('signin-msg'), authWords(err), 'error');
    } finally {
      busy($('email-form'), false);
    }
  });

  $('code-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = $('code').value.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      say($('signin-msg'), 'The code is the 6 to 10 digits in the email.', 'error');
      return;
    }
    busy($('code-form'), true);
    say($('signin-msg'), 'Checking…');
    try {
      const a = await call('/auth/v1/verify', { type: 'email', email: pendingEmail, token });
      saveSession(fromAuthAnswer(a));
      scheduleRefresh();
      say($('signin-msg'), '');
      await enter();
    } catch (err) {
      say($('signin-msg'), authWords(err), 'error');
    } finally {
      busy($('code-form'), false);
    }
  });

  $('code-back').addEventListener('click', () => {
    $('code-form').hidden = true;
    $('email-form').hidden = false;
    say($('signin-msg'), '');
    $('email').focus();
  });

  const signOut = async () => {
    stopAuto();
    clearTimeout(refreshTimer);
    const s = session;
    saveSession(null);
    if (s) {
      try {
        await fetch(`${API}/auth/v1/logout?scope=local`, {
          method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` },
        });
      } catch { /* the token is gone from this tab either way */ }
    }
    if ($('ledger').open) $('ledger').close();
    if ($('convo').open) $('convo').close();
    data = null;
    inbox = null;
    showSignIn();
    $('email').focus();
  };
  $('sign-out').addEventListener('click', signOut);
  $('blocked-out').addEventListener('click', signOut);
  $('mfa-out').addEventListener('click', signOut);
  $('blocked-retry').addEventListener('click', () => enter());

  const onSessionLost = () => {
    saveSession(null);
    showSignIn('Your sign-in ended. Sign in again.');
  };

  const showBlocked = (title, text) => {
    stopAuto();
    $('blocked-title').textContent = title;
    $('blocked-text').textContent = text;
    show('blocked');
  };
  const NOT_DEV = ['This account is not a Mimir developer.', 'The credits monitor is only for Mimir\'s developers. Sign in with a developer account.'];
  const NOT_INSTALLED = ['Not installed yet', 'The credits monitor is not installed on the account service yet.'];

  // ── The second lock: an authenticator app's code ─────────────────────────
  let mfaFactor = null; // the factor id the code is checked against
  const TWO_FACTORS = ['Locked: two authenticators', 'This account has more than one authenticator app, so the developer page stays locked. If you did not add the second one, someone may have your email. Remove them all from the Supabase SQL editor (supabase/README.md, step 4), then sign in again to set up one.'];

  const showMfa = async (status) => {
    stopAuto();
    show('loading');
    if (status && Number(status.factors) > 1) { showBlocked(...TWO_FACTORS); return; }
    let factors = [];
    try {
      const user = await call('/auth/v1/user', undefined, { auth: true, method: 'GET' });
      factors = Array.isArray(user && user.factors) ? user.factors.filter((f) => f.factor_type === 'totp') : [];
    } catch (err) {
      if (err.status === 401 || err.status === 403) { onSessionLost(); return; }
      showBlocked('Could not check this account', authWords(err));
      return;
    }
    const verified = factors.filter((f) => f.status === 'verified');
    if (verified.length > 1) { showBlocked(...TWO_FACTORS); return; }
    $('mfa-code').value = '';
    say($('mfa-msg'), '');
    if (verified.length === 1) {
      mfaFactor = verified[0].id;
      $('mfa-title').textContent = 'Authenticator code';
      $('mfa-text').textContent = 'Type the six-digit code your authenticator app shows for Mimir.';
      $('mfa-enrol').hidden = true;
    } else {
      // First time: clear any half-finished setup, then make a new one.
      for (const f of factors) {
        try { await call(`/auth/v1/factors/${encodeURIComponent(f.id)}`, undefined, { auth: true, method: 'DELETE' }); } catch { /* left for Supabase to expire */ }
      }
      let enrolled;
      try {
        enrolled = await call('/auth/v1/factors', { factor_type: 'totp', friendly_name: `Mimir developer ${new Date().toISOString().slice(0, 10)}`, issuer: 'Mimir developer' }, { auth: true });
      } catch (err) {
        showBlocked('Could not set up an authenticator', `The account service said: ${err.message}. Check that App Authenticator (TOTP) is on in Supabase → Authentication → Multi-Factor.`);
        return;
      }
      mfaFactor = enrolled.id;
      $('mfa-title').textContent = 'Set up an authenticator';
      $('mfa-text').textContent = 'One more lock on this page. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…), then type the six digits it shows. From now on it asks for them at every sign-in.';
      const qr = enrolled.totp && typeof enrolled.totp.qr_code === 'string' ? enrolled.totp.qr_code : '';
      $('mfa-qr').hidden = !qr.startsWith('data:image/');
      if (qr.startsWith('data:image/')) $('mfa-qr').src = qr;
      $('mfa-secret').textContent = (enrolled.totp && enrolled.totp.secret) || '';
      $('mfa-enrol').hidden = false;
    }
    show('mfa');
    $('mfa-code').focus();
  };

  $('mfa-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $('mfa-code').value.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      say($('mfa-msg'), 'The code is the six digits the app shows.', 'error');
      return;
    }
    if (!mfaFactor) return;
    busy($('mfa-form'), true);
    say($('mfa-msg'), 'Checking…');
    try {
      await fresh();
      const id = encodeURIComponent(mfaFactor);
      const challenge = await call(`/auth/v1/factors/${id}/challenge`, {}, { auth: true });
      const a = await call(`/auth/v1/factors/${id}/verify`, { challenge_id: challenge.id, code }, { auth: true });
      saveSession(fromAuthAnswer(a));
      scheduleRefresh();
      $('mfa-secret').textContent = '';
      $('mfa-qr').removeAttribute('src');
      say($('mfa-msg'), '');
      await enter();
    } catch (err) {
      const c = String(err.code || '');
      say($('mfa-msg'), c === 'mfa_verification_failed' || c.startsWith('mfa_challenge') || err.status === 422
        ? 'That code did not match. Wait for the next one and try again.'
        : authWords(err), 'error');
    } finally {
      busy($('mfa-form'), false);
    }
  });

  // Signed in: check the account may see the monitor, then load it.
  const enter = async () => {
    show('loading');
    try {
      let status;
      try {
        status = await rpc('mimir_admin_status', {});
      } catch (err) {
        if (!isNotInstalled(err)) throw err;
        // An account service from before the second lock: the list alone decides.
        status = { admin: (await rpc('mimir_admin_check', {})) === true, mfa: true };
      }
      if (!status || status.admin !== true) { showBlocked(...NOT_DEV); return; }
      if (status.mfa !== true) { await showMfa(status); return; }
    } catch (err) {
      if (err.status === 401) { onSessionLost(); return; }
      if (isNotInstalled(err)) { showBlocked(...NOT_INSTALLED); return; }
      if (needsMfa(err)) { await showMfa(null); return; }
      if (isNotAdmin(err)) { showBlocked(...NOT_DEV); return; }
      showBlocked('Could not check this account', rpcWords(err));
      return;
    }
    show('dash');
    await load();
    loadBugs();
    startAuto();
  };

  // ── Dashboard data ───────────────────────────────────────────────────────
  let data = null; // { overview, daily, at }
  let loadingNow = false;
  const load = async () => {
    if (loadingNow || !session) return;
    loadingNow = true;
    $('refresh').disabled = true;
    say($('updated'), data ? 'Refreshing…' : 'Loading…');
    try {
      const [overview, daily] = await Promise.all([
        rpc('mimir_admin_overview', {}),
        rpc('mimir_admin_daily', { p_days: 30 }),
      ]);
      data = { overview: overview || {}, daily: Array.isArray(daily) ? daily : [], at: Date.now() };
      say($('dash-msg'), '');
      render();
      loadInbox();
    } catch (err) {
      if (err.status === 401) { onSessionLost(); return; }
      if (isNotInstalled(err)) { showBlocked(...NOT_INSTALLED); return; }
      if (needsMfa(err)) { showMfa(null); return; }
      if (isNotAdmin(err)) { showBlocked(...NOT_DEV); return; }
      say($('dash-msg'), `Could not load the numbers. ${rpcWords(err)}`, 'error');
    } finally {
      loadingNow = false;
      $('refresh').disabled = false;
      stampUpdated();
    }
  };
  const stampUpdated = () => {
    if (!data) { say($('updated'), ''); return; }
    say($('updated'), `Updated ${new Date(data.at).toLocaleTimeString()} · refreshes every minute while this tab is open`);
  };
  $('refresh').addEventListener('click', () => load());

  // Auto-refresh every 60 s while the tab is visible.
  let autoTimer = 0;
  const startAuto = () => {
    stopAuto();
    autoTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
      // Never under someone typing a note.
      if (!$('bugs').contains(document.activeElement)) loadBugs();
    }, REFRESH_MS);
  };
  const stopAuto = () => { clearInterval(autoTimer); autoTimer = 0; };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && autoTimer && data && Date.now() - data.at > REFRESH_MS) load();
  });

  // ── Render ───────────────────────────────────────────────────────────────
  const render = () => {
    renderTiles(data.overview.totals || {});
    renderChart(data.daily);
    renderUsers();
  };

  const tile = (label, value, sub, tone) => el('li', { class: `tile${tone ? ` tile-${tone}` : ''}` },
    el('span', { class: 'tile-label', text: label }),
    el('span', { class: 'tile-value', text: value }),
    sub ? el('span', { class: 'tile-sub', text: sub }) : null);

  const renderTiles = (t) => {
    const users = num(t.users);
    const pct = (n) => (users ? `${Math.round((num(n) / users) * 100)}% of users` : '');
    $('tiles').replaceChildren(
      tile('Users', intFmt.format(users), `${intFmt.format(num(t.turns_30d))} turns in 30 days`),
      tile('Active today', intFmt.format(num(t.active_1d)), `${intFmt.format(num(t.turns_1d))} turns today`, 'teal'),
      tile('Active 7 days', intFmt.format(num(t.active_7d)), pct(t.active_7d)),
      tile('Active 30 days', intFmt.format(num(t.active_30d)), pct(t.active_30d)),
      tile('Spent today', credits(t.spent_1d_micros), `credits · ${dollars(t.spent_1d_micros)}`, 'gold'),
      tile('Spent 30 days', credits(t.spent_30d_micros), `credits · ${dollars(t.spent_30d_micros)}`, 'gold'),
      tile('Outstanding', credits(t.balance_micros), `credits · ${dollars(t.balance_micros)}` +
        (num(t.held_micros) ? ` · ${credits(t.held_micros)} held` : '')),
      tile('Ever granted', credits(t.granted_micros), `credits · ${dollars(t.granted_micros)}`),
    );
  };

  // A 30-day bar chart of credits spent, with active users as a line on its own scale.
  const niceMax = (v) => {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  };
  const dayLabel = (d) => {
    const [y, m, dd] = String(d).split('-').map(Number);
    if (!y || !m || !dd) return String(d);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const renderChart = (days) => {
    const box = $('chart');
    if (!days.length) {
      box.replaceChildren(el('p', { class: 'dev-note', text: 'No days to show yet.' }));
      return;
    }
    // Draw at the box's own width so the labels keep their size on a phone.
    const W = Math.max(280, Math.min(1100, Math.round(box.clientWidth || 760)));
    const narrow = W < 520;
    const H = narrow ? 200 : 240, L = narrow ? 44 : 52, R = narrow ? 26 : 40, T = 14, B = 30;
    const iw = W - L - R, ih = H - T - B;
    const spent = days.map((d) => num(d.spent_micros) / MICROS_PER_CREDIT);
    const active = days.map((d) => num(d.active_users));
    const yMax = niceMax(Math.max(...spent));
    const aMax = Math.max(1, niceMax(Math.max(...active)));
    const step = iw / days.length;
    const bw = Math.max(2, step * 0.66);
    const totalSpent = spent.reduce((a, b) => a + b, 0);
    const peak = days[spent.indexOf(Math.max(...spent))];

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg', preserveAspectRatio: 'xMidYMid meet' });
    const title = svgEl('title');
    title.textContent = `Credits spent per day over the last ${days.length} days: ${intFmt.format(totalSpent)} credits in all` +
      (peak ? `, most on ${dayLabel(peak.day)} (${credits(peak.spent_micros)} credits, ${num(peak.active_users)} active users)` : '') + '.';
    svg.append(title);

    // Grid and left axis (credits)
    for (let i = 0; i <= 4; i++) {
      const y = T + ih - (ih * i) / 4;
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, class: i ? 'grid' : 'axis' }));
      const lt = svgEl('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      lt.textContent = intFmt.format((yMax * i) / 4);
      svg.append(lt);
      const rt = svgEl('text', { x: W - R + 8, y: y + 4, 'text-anchor': 'start', class: 'tick tick-teal' });
      rt.textContent = Number.isInteger((aMax * i) / 4) ? String((aMax * i) / 4) : '';
      svg.append(rt);
    }

    // Bars
    days.forEach((d, i) => {
      const h = (spent[i] / yMax) * ih;
      const x = L + i * step + (step - bw) / 2;
      const g = svgEl('g', { class: 'bar' });
      const t = svgEl('title');
      t.textContent = `${dayLabel(d.day)}: ${credits(d.spent_micros)} credits (${dollars(d.spent_micros)}), ` +
        `${intFmt.format(num(d.turns))} turns, ${intFmt.format(num(d.active_users))} active users, ` +
        `${intFmt.format(num(d.input_tokens))} tokens in, ${intFmt.format(num(d.output_tokens))} out`;
      g.append(t);
      // A transparent column so the whole day is hoverable.
      g.append(svgEl('rect', { x: L + i * step, y: T, width: step, height: ih, class: 'hit' }));
      g.append(svgEl('rect', { x, y: T + ih - h, width: bw, height: Math.max(h, spent[i] > 0 ? 1.5 : 0), rx: Math.min(3, bw / 3), class: 'bar-fill' }));
      svg.append(g);
      const every = narrow ? 14 : 7;
      if (i === 0 || i === days.length - 1 || (days.length > 10 && i % every === 0 && i > 3 && days.length - 1 - i > 3)) {
        const xt = svgEl('text', { x: L + i * step + step / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' });
        xt.textContent = dayLabel(d.day);
        svg.append(xt);
      }
    });

    // Active users line
    const pts = active.map((a, i) => `${(L + i * step + step / 2).toFixed(1)},${(T + ih - (a / aMax) * ih).toFixed(1)}`);
    svg.append(svgEl('polyline', { points: pts.join(' '), class: 'line', fill: 'none' }));
    active.forEach((a, i) => {
      svg.append(svgEl('circle', { cx: L + i * step + step / 2, cy: T + ih - (a / aMax) * ih, r: 2.6, class: 'dot' }));
    });

    const caption = el('p', { class: 'chart-caption' },
      el('span', { text: `${intFmt.format(totalSpent)} credits` }),
      ` (${dollars(totalSpent * MICROS_PER_CREDIT)}) spent in ${days.length} days. Left scale: credits. Right scale: active users.`);
    box.replaceChildren(svg, caption);
    lastChartWidth = box.clientWidth;
  };

  // Users table
  const sortBy = { active: 'active', balance: 'balance', spent: 'spent' };
  const sorters = {
    active: (a, b) => (time(b.last_turn_at) || time(b.last_seen_at) || 0) - (time(a.last_turn_at) || time(a.last_seen_at) || 0),
    balance: (a, b) => num(b.balance_micros) - num(a.balance_micros),
    spent: (a, b) => num(b.spent_30d_micros) - num(a.spent_30d_micros),
  };
  const isActive = (u) => {
    const t = time(u.last_turn_at);
    return t != null && Date.now() - t < DAY_MS;
  };
  const cell = (text, cls, title) => el('td', { class: cls, title }, text);
  const renderUsers = () => {
    if (!data) return;
    const all = Array.isArray(data.overview.users) ? data.overview.users : [];
    const q = $('search').value.trim().toLowerCase();
    const list = all.filter((u) => !q || String(u.email || '').toLowerCase().includes(q))
      .sort(sorters[sortBy[$('sort').value] || 'active']);
    $('user-count').textContent = q ? `${list.length} of ${all.length}` : String(all.length);
    const tbody = $('users').tBodies[0];
    if (!list.length) {
      tbody.replaceChildren(el('tr', null, el('td', { class: 'empty', colspan: '8', text: all.length ? 'No email matches that search.' : 'No users yet.' })));
      return;
    }
    tbody.replaceChildren(...list.map((u) => {
      const active = isActive(u);
      const who = el('button', { class: 'user-link', type: 'button', onclick: () => openLedger(u) },
        el('span', { class: `status${active ? ' is-active' : ''}`, 'aria-hidden': 'true' }),
        el('span', { class: 'user-email', text: u.email || '(no email)' }),
        active ? el('span', { class: 'sr-only', text: ' (active in the last 24 hours)' }) : null);
      const held = num(u.held_micros);
      return el('tr', { class: active ? 'is-active' : null },
        el('td', { class: 'email' }, who),
        cell(credits(u.balance_micros), 'num', `${dollars(u.balance_micros)}${held ? ` · ${credits(held)} held` : ''}`),
        cell(credits(u.spent_30d_micros), 'num', `${dollars(u.spent_30d_micros)} · ${credits(u.spent_total_micros)} credits all time`),
        cell(intFmt.format(num(u.turns_30d)), 'num', `${intFmt.format(num(u.turns_total))} turns all time`),
        cell(ago(u.last_turn_at), 'when', fullDate(u.last_turn_at) || null),
        cell(u.last_model || '—', 'model'),
        cell(intFmt.format(num(u.computers)), 'num', u.last_seen_at ? `A computer last seen ${ago(u.last_seen_at)}` : null),
        cell(shortDate(u.joined_at), 'when', u.last_sign_in_at ? `Last signed in ${ago(u.last_sign_in_at)}` : null),
      );
    }));
  };
  let lastChartWidth = 0;
  window.addEventListener('resize', () => {
    const w = $('chart').clientWidth;
    if (data && Math.abs(w - lastChartWidth) > 24) { lastChartWidth = w; renderChart(data.daily); }
  }, { passive: true });
  $('search').addEventListener('input', renderUsers);
  $('sort').addEventListener('change', renderUsers);

  // ── Bug reports ──────────────────────────────────────────────────────────
  // Loaded apart from the numbers: a service whose schema.sql predates bug
  // reports still shows its credits.
  let bugs = null; // { reports, counts }
  let bugsLoading = false;
  const STATUS_WORDS = { new: 'Open', checked: 'Checked', fixed: 'Fixed', ignored: 'Ignored' };
  const loadBugs = async () => {
    if (bugsLoading || !session) return;
    bugsLoading = true;
    try {
      const status = $('bug-status').value || null;
      const answer = await rpc('mimir_admin_bug_reports', { p_status: status, p_limit: 200 });
      bugs = { reports: Array.isArray(answer && answer.reports) ? answer.reports : [], counts: (answer && answer.counts) || {} };
      say($('bug-msg'), '');
      renderBugs();
    } catch (err) {
      if (err.status === 401) { onSessionLost(); return; }
      if (isNotInstalled(err)) {
        say($('bug-msg'), 'Bug reports are not installed on the account service yet: run the newest supabase/schema.sql in the SQL Editor.', 'error');
        $('bugs').replaceChildren();
        return;
      }
      say($('bug-msg'), `Could not load the bug reports. ${rpcWords(err)}`, 'error');
    } finally {
      bugsLoading = false;
    }
  };
  const renderBugs = () => {
    if (!bugs) return;
    const c = bugs.counts;
    $('bug-count').textContent = `${intFmt.format(num(c.new))} open`;
    $('bug-count').title = `${num(c.checked)} checked · ${num(c.fixed)} fixed · ${num(c.ignored)} ignored`;
    const list = $('bugs');
    if (!bugs.reports.length) {
      list.replaceChildren(el('li', { class: 'bug-empty', text: $('bug-status').value === 'new' ? 'No open reports. Nothing waiting on you.' : 'No reports here.' }));
      return;
    }
    // A report being read stays open across a refresh.
    const open = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.id));
    list.replaceChildren(...bugs.reports.map((b) => {
      const id = String(b.id);
      const note = el('input', { type: 'text', maxlength: '500', placeholder: 'A note, e.g. fixed in 0.33.1', value: b.note || '', 'aria-label': 'Note' });
      const mark = (status) => el('button', {
        class: `btn btn-small ${status === 'fixed' ? 'btn-gold' : 'btn-ghost'}`,
        type: 'button',
        text: status === 'new' ? 'Reopen' : `Mark ${STATUS_WORDS[status].toLowerCase()}`,
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await rpc('mimir_admin_bug_mark', { p_id: b.id, p_status: status, p_note: note.value.trim() || null });
            say($('bug-msg'), `Report ${id} marked ${STATUS_WORDS[status].toLowerCase()}.`);
            await loadBugs();
          } catch (err) {
            if (err.status === 401) { onSessionLost(); return; }
            say($('bug-msg'), `Could not mark it. ${rpcWords(err)}`, 'error');
            event.currentTarget.disabled = false;
          }
        },
      });
      const repeat = num(b.occurrences) > 1 ? `seen ${intFmt.format(num(b.occurrences))} times` : null;
      const meta = [`v${b.version}`, b.platform, b.edition === 'store' ? 'store edition' : null,
        b.email || '(account gone)', repeat, ago(b.last_at)].filter(Boolean).join(' · ');
      const details = el('details', { class: `bug bug-${b.status}`, 'data-id': id },
        el('summary', null,
          el('span', { class: `kind kind-${b.kind === 'auto' ? 'refund' : 'grant'}`, text: b.kind === 'auto' ? 'Auto' : 'Person' }),
          el('span', { class: 'bug-summary', text: b.summary }),
          el('span', { class: 'bug-meta', text: meta, title: `First ${fullDate(b.at)} · last ${fullDate(b.last_at)}` })),
        el('pre', { class: 'bug-body', text: b.body || '(no body)' }),
        el('div', { class: 'bug-actions' },
          note,
          ...['checked', 'fixed', 'ignored', 'new'].filter((s) => s !== b.status).map(mark)));
      if (open.has(id)) details.open = true;
      return el('li', null, details);
    }));
  };
  $('bug-status').addEventListener('change', () => { bugs = null; loadBugs(); });
  $('refresh').addEventListener('click', () => loadBugs());

  // ── A user's ledger ──────────────────────────────────────────────────────
  let ledgerUser = null;
  const kindWords = { starter: 'Starter', grant: 'Grant', turn: 'Turn', refund: 'Refund' };
  const openLedger = async (u) => {
    ledgerUser = u;
    const dlg = $('ledger');
    $('ledger-title').textContent = u.email || '(no email)';
    say($('ledger-msg'), `Balance ${creditsWord(u.balance_micros)} (${dollars(u.balance_micros)}). Loading the ledger…`);
    $('ledger-table').tBodies[0].replaceChildren();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    try {
      const r = await rpc('mimir_admin_user', { p_user: u.user_id });
      if (ledgerUser !== u) return;
      const entries = Array.isArray(r && r.entries) ? r.entries : [];
      say($('ledger-msg'), `Balance ${creditsWord(u.balance_micros)} (${dollars(u.balance_micros)}). ` +
        (entries.length ? `The last ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first.` : 'No entries yet.'));
      $('ledger-table').tBodies[0].replaceChildren(...entries.map((e) => {
        const m = num(e.micros);
        const tokens = e.kind === 'turn' || num(e.input_tokens) || num(e.output_tokens)
          ? `${intFmt.format(num(e.input_tokens))} / ${intFmt.format(num(e.cached_tokens))} / ${intFmt.format(num(e.output_tokens))}`
          : '—';
        return el('tr', null,
          cell(ago(e.at), 'when', fullDate(e.at) || null),
          el('td', null, el('span', { class: `kind kind-${kindWords[e.kind] ? e.kind : 'other'}`, text: kindWords[e.kind] || String(e.kind || '?') })),
          cell(signedCredits(m), `num ${m < 0 ? 'neg' : m > 0 ? 'pos' : ''}`, dollars(m)),
          cell(e.balance_after == null ? '—' : credits(e.balance_after), 'num', e.balance_after == null ? null : dollars(e.balance_after)),
          cell(e.model || '—', 'model'),
          cell(tokens, 'num'),
          cell(e.note || '', 'note'),
        );
      }));
    } catch (err) {
      if (ledgerUser !== u) return;
      if (err.status === 401) { $('ledger').close(); onSessionLost(); return; }
      say($('ledger-msg'), `Could not load the ledger. ${rpcWords(err)}`, 'error');
    }
  };
  $('ledger-close').addEventListener('click', () => $('ledger').close());
  $('ledger').addEventListener('click', (event) => { if (event.target === $('ledger')) $('ledger').close(); });
  $('ledger').addEventListener('close', () => { ledgerUser = null; });
  $('ledger-message').addEventListener('click', () => {
    const u = ledgerUser;
    $('ledger').close();
    if (u) openConvo({ user_id: u.user_id, email: u.email });
  });
  $('ledger-give').addEventListener('click', () => {
    const email = ledgerUser && ledgerUser.email;
    $('ledger').close();
    if (email) $('grant-email').value = email;
    $('grant-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('grant-amount').focus({ preventScroll: true });
  });

  // ── Messages ─────────────────────────────────────────────────────────────
  // Free, plain words between the developers and each account. Mimir shows
  // them in Settings → Account (desktop) and Settings → Messages (phone).
  const MAX_MESSAGE = 4000;
  let inbox = null; // { threads, broadcasts, unread }
  let inboxMissing = false;
  const loadInbox = async () => {
    if (!session) return;
    try {
      const r = await rpc('mimir_admin_inbox', {});
      inbox = { threads: Array.isArray(r && r.threads) ? r.threads : [], broadcasts: Array.isArray(r && r.broadcasts) ? r.broadcasts : [], unread: num(r && r.unread) };
      inboxMissing = false;
      say($('msg-msg'), '');
    } catch (err) {
      if (err.status === 401) { onSessionLost(); return; }
      if (isNotInstalled(err)) { inboxMissing = true; inbox = null; }
      else say($('msg-msg'), `Could not load the messages. ${rpcWords(err)}`, 'error');
    }
    renderInbox();
  };
  const renderInbox = () => {
    $('msg-everyone').disabled = inboxMissing;
    if (inboxMissing) {
      $('msg-unread').textContent = '';
      $('threads').replaceChildren(el('li', { class: 'empty', text: 'Messages are not installed on the account service yet: run the newest supabase/schema.sql there.' }));
      $('broadcasts-box').hidden = true;
      return;
    }
    if (!inbox) return;
    $('msg-unread').textContent = inbox.unread ? `${intFmt.format(inbox.unread)} unread` : '';
    if (!inbox.threads.length) {
      $('threads').replaceChildren(el('li', { class: 'empty', text: 'No conversations yet. Write to someone from the users table, or to everyone.' }));
    } else {
      $('threads').replaceChildren(...inbox.threads.map((t) => {
        const unread = num(t.unread);
        return el('li', null, el('button', { class: `thread-row${unread ? ' is-unread' : ''}`, type: 'button', onclick: () => openConvo(t) },
          el('span', { class: 'thread-email' }, t.email || '(no email)', unread ? el('span', { class: 'thread-badge', text: `${unread} new` }) : null),
          el('span', { class: 'thread-when', text: ago(t.last_at), title: fullDate(t.last_at) || null }),
          el('span', { class: 'thread-last', text: `${t.last_from_dev ? 'You: ' : ''}${t.last_body || ''}` })));
      }));
    }
    $('broadcasts-box').hidden = !inbox.broadcasts.length;
    $('broadcasts').replaceChildren(...inbox.broadcasts.map((b) => el('li', null,
      el('p', { text: b.body || '' }),
      el('small', { text: `${ago(b.at)} · read by ${intFmt.format(num(b.read))} of ${intFmt.format(num(b.recipients))}`, title: fullDate(b.at) || null }))));
  };

  // The conversation dialog: one account's thread, or a message to everyone.
  let convoWith = null; // { user_id, email } or 'everyone'
  const convoItem = (m) => el('li', { class: `convo-item ${m.from_dev ? 'is-dev' : 'is-user'}` },
    el('span', { class: 'convo-who', text: m.from_dev ? (m.to_all ? 'You · to everyone' : 'You') : 'They wrote' }),
    el('p', { class: 'convo-body', text: m.body || '' }),
    el('span', { class: 'convo-when', title: fullDate(m.at) || null,
      text: ago(m.at) + (m.from_dev ? (m.read_at ? ' · read' : ' · not read yet') : '') }));
  const showConvo = (messages) => {
    const list = $('convo-list');
    list.replaceChildren(...(messages.length ? messages.map(convoItem) : [el('li', { class: 'empty', text: 'Nothing yet. Say hello.' })]));
    list.scrollTop = list.scrollHeight;
  };
  const countConvo = () => { $('convo-count').textContent = `${intFmt.format($('convo-text').value.length)} / ${intFmt.format(MAX_MESSAGE)}`; };
  const hideConvoConfirm = () => { $('convo-confirm').hidden = true; busy($('convo-form'), false); };
  const openConvo = async (who) => {
    convoWith = who;
    const everyone = who === 'everyone';
    const dlg = $('convo');
    dlg.classList.toggle('is-everyone', everyone);
    $('convo-kicker').textContent = everyone ? 'Message' : 'Conversation';
    $('convo-title').textContent = everyone ? 'Everyone with a Mimir account' : (who.email || '(no email)');
    $('convo-text').value = '';
    $('convo-text').placeholder = everyone ? 'Write to everyone…' : 'Write a message…';
    countConvo();
    hideConvoConfirm();
    say($('convo-msg'), everyone ? 'Everyone sees it in Mimir, and each answer comes back here as a conversation of its own.' : 'Loading…');
    $('convo-list').replaceChildren();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('convo-text').focus();
    if (everyone) return;
    try {
      const r = await rpc('mimir_admin_thread', { p_user: who.user_id });
      if (convoWith !== who) return;
      say($('convo-msg'), '');
      showConvo(Array.isArray(r && r.messages) ? r.messages : []);
      loadInbox(); // reading marked their words read
    } catch (err) {
      if (convoWith !== who) return;
      if (err.status === 401) { dlg.close(); onSessionLost(); return; }
      say($('convo-msg'), isNotInstalled(err) ? 'Messages are not installed on the account service yet.' : `Could not load the conversation. ${rpcWords(err)}`, 'error');
    }
  };
  const sendConvo = async () => {
    const who = convoWith;
    const body = $('convo-text').value.trim();
    busy($('convo-form'), true);
    $('convo-yes').disabled = true;
    $('convo-no').disabled = true;
    say($('convo-msg'), 'Sending…');
    try {
      const r = await rpc('mimir_admin_send', { p_user: who === 'everyone' ? null : who.user_id, p_body: body });
      $('convo-text').value = '';
      countConvo();
      if (who === 'everyone') {
        say($('convo-msg'), `Sent to ${intFmt.format(num(r && r.sent))} account${num(r && r.sent) === 1 ? '' : 's'}.`, 'ok');
      } else {
        say($('convo-msg'), 'Sent. They see it the next time Mimir looks, within a few minutes.', 'ok');
        const t = await rpc('mimir_admin_thread', { p_user: who.user_id });
        if (convoWith === who) showConvo(Array.isArray(t && t.messages) ? t.messages : []);
      }
      loadInbox();
    } catch (err) {
      if (err.status === 401) { $('convo').close(); onSessionLost(); return; }
      say($('convo-msg'), `Not sent. ${isNotInstalled(err) ? 'Messages are not installed on the account service yet.' : rpcWords(err)}`, 'error');
    } finally {
      $('convo-yes').disabled = false;
      $('convo-no').disabled = false;
      hideConvoConfirm();
      $('convo-text').focus();
    }
  };
  $('convo-text').addEventListener('input', countConvo);
  $('convo-text').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('convo-form').requestSubmit(); }
  });
  $('convo-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const body = $('convo-text').value.trim();
    if (!body) { say($('convo-msg'), 'Write something first.', 'error'); return; }
    if (body.length > MAX_MESSAGE) { say($('convo-msg'), `That is longer than ${intFmt.format(MAX_MESSAGE)} characters.`, 'error'); return; }
    if (convoWith === 'everyone') {
      const users = data && data.overview && data.overview.totals ? Math.max(0, num(data.overview.totals.users) - 1) : 0;
      $('convo-question').textContent = `Send this to every Mimir account${users ? ` (${intFmt.format(users)} people)` : ''}? It cannot be taken back.`;
      say($('convo-msg'), '');
      busy($('convo-form'), true);
      $('convo-confirm').hidden = false;
      $('convo-yes').focus();
      return;
    }
    sendConvo();
  });
  $('convo-yes').addEventListener('click', () => sendConvo());
  $('convo-no').addEventListener('click', () => { hideConvoConfirm(); $('convo-text').focus(); });
  $('convo-close').addEventListener('click', () => $('convo').close());
  $('convo').addEventListener('click', (event) => { if (event.target === $('convo')) $('convo').close(); });
  $('convo').addEventListener('close', () => { convoWith = null; });
  $('msg-everyone').addEventListener('click', () => openConvo('everyone'));

  // ── Give credits ─────────────────────────────────────────────────────────
  let pendingGrant = null;
  const hideConfirm = () => { pendingGrant = null; $('grant-confirm').hidden = true; busy($('grant-form'), false); };
  $('grant-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const email = $('grant-email').value.trim().toLowerCase();
    const amount = Number($('grant-amount').value);
    const note = $('grant-note').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say($('grant-msg'), 'That email address does not look right.', 'error'); return; }
    if (!Number.isInteger(amount) || amount === 0) { say($('grant-msg'), 'Give a whole number of credits, not zero.', 'error'); return; }
    if (Math.abs(amount) > 10_000_000) { say($('grant-msg'), 'That is more than 10,000,000 credits. Check the number.', 'error'); return; }
    const micros = amount * MICROS_PER_CREDIT;
    pendingGrant = { email, micros, note };
    $('grant-question').textContent = amount > 0
      ? `Give ${intFmt.format(amount)} credits (${dollars(micros)}) to ${email}?`
      : `Take ${intFmt.format(-amount)} credits (${dollars(-micros)}) back from ${email}?`;
    say($('grant-msg'), '');
    busy($('grant-form'), true);
    $('grant-confirm').hidden = false;
    $('grant-yes').focus();
  });
  $('grant-no').addEventListener('click', () => { hideConfirm(); $('grant-amount').focus(); });
  $('grant-yes').addEventListener('click', async () => {
    const g = pendingGrant;
    if (!g) return;
    $('grant-yes').disabled = true;
    $('grant-no').disabled = true;
    say($('grant-msg'), 'Sending…');
    try {
      const r = await rpc('mimir_admin_grant', { p_email: g.email, p_micros: g.micros, p_note: g.note || null });
      const bal = r && r.balance_micros;
      say($('grant-msg'), `Done. ${g.email} now has ${creditsWord(bal)} (${dollars(bal)}).`, 'ok');
      $('grant-amount').value = '';
      $('grant-note').value = '';
      load();
    } catch (err) {
      if (err.status === 401) { onSessionLost(); return; }
      if (isNotInstalled(err)) { say($('grant-msg'), NOT_INSTALLED[1], 'error'); }
      else say($('grant-msg'), `Not sent. ${rpcWords(err)}`, 'error');
    } finally {
      $('grant-yes').disabled = false;
      $('grant-no').disabled = false;
      hideConfirm();
    }
  });

  // Keep the relative times honest between refreshes.
  setInterval(() => { if (data && !$('dash').hidden && document.visibilityState === 'visible') {
      if (!$('users').contains(document.activeElement)) renderUsers();
      stampUpdated();
    } }, 30 * 1000);

  // ── Start ────────────────────────────────────────────────────────────────
  session = loadSession();
  if (session) {
    scheduleRefresh();
    enter();
  } else {
    showSignIn();
  }
})();
