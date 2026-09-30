// wellmimir.com: header, menu, reveals, the rune ring, and downloads that
// always point at the newest published release in ZipEmUp-source/Mimir-releases.
(() => {
  'use strict';

  const REPO = 'ZipEmUp-source/Mimir-releases';
  const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;
  const CACHE_KEY = 'mimir-latest-release';
  const CACHE_MS = 60 * 60 * 1000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Header turns solid once the hero scrolls away ──────────────────────
  const header = document.querySelector('.site-header');
  const onScroll = () => header.classList.toggle('is-solid', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Menu on small screens ──────────────────────────────────────────────
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.menu-toggle');
  if (nav && toggle) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    nav.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
  }

  // ── Reveal on scroll ───────────────────────────────────────────────────
  const revealed = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealed.forEach((node) => node.classList.add('is-in'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealed.forEach((node) => observer.observe(node));
  }

  // ── The rune ring around the iris: the 24 staves of the elder futhark ──
  const ring = document.getElementById('rune-ring');
  if (ring) {
    const staves = [...'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'];
    const ns = 'http://www.w3.org/2000/svg';
    staves.forEach((stave, i) => {
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('transform', `rotate(${(i / staves.length) * 360} 32 32) translate(32 4.6)`);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = stave;
      ring.appendChild(text);
    });
  }

  // ── A soft light follows the pointer across the feature cards ──────────
  if (!reduceMotion) {
    document.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - box.left}px`);
        card.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    });
  }

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  // ── Downloads ──────────────────────────────────────────────────────────
  const ua = navigator.userAgent || '';
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || Boolean(navigator.userAgentData && navigator.userAgentData.mobile);
  const mac = !mobile && (/Mac/i.test(platform) || /Macintosh/.test(ua));
  const windows = !mobile && (/Win/i.test(platform) || /Windows/.test(ua));

  const readCache = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return saved && Date.now() - saved.at < CACHE_MS ? saved.release : null;
    } catch { return null; }
  };
  const writeCache = (release) => {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release })); } catch { /* private mode */ }
  };

  const megabytes = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const pick = (assets, pattern) => assets.find((asset) => pattern.test(asset.name) && !/\.sig$/.test(asset.name));

  async function latestRelease() {
    const cached = readCache();
    if (cached) return cached;
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const data = await response.json();
    const release = {
      tag: data.tag_name,
      name: data.name || data.tag_name,
      url: data.html_url,
      published: data.published_at,
      assets: (data.assets || []).map(({ name, size, browser_download_url: href }) => ({ name, size, href })),
    };
    writeCache(release);
    return release;
  }

  async function wireDownloads() {
    let release = null;
    try { release = await latestRelease(); } catch { /* the links already point at the releases page */ }

    const found = release ? {
      windows: pick(release.assets, /_x64-setup\.exe$/i),
      'windows-msi': pick(release.assets, /\.msi$/i),
      'mac-arm': pick(release.assets, /_aarch64\.dmg$/i),
      'mac-intel': pick(release.assets, /_x64\.dmg$/i),
    } : {};

    document.querySelectorAll('[data-asset]').forEach((link) => {
      const asset = found[link.dataset.asset];
      if (!asset) return;
      link.href = asset.href;
      link.hidden = false;
      const size = link.querySelector('[data-size]');
      if (size) size.textContent = `${size.textContent} · ${megabytes(asset.size)}`;
    });

    if (release) {
      const version = release.tag;
      const saga = (release.name.split(/\s[—–-]\s/)[1] || '').trim();
      const date = release.published ? new Date(release.published).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      document.querySelectorAll('[data-release-short]').forEach((node) => {
        node.innerHTML = '';
        node.append(`Latest: ${version} `);
        if (saga) {
          const name = document.createElement('span');
          name.className = 'release-name';
          name.textContent = saga;
          node.append(name);
        }
      });
      document.querySelectorAll('[data-release-long]').forEach((node) => {
        node.textContent = `Latest: Mimir ${version}${saga ? ` “${saga}”` : ''}${date ? ` · ${date}` : ''}`;
      });
      document.querySelectorAll('[data-release-notes]').forEach((node) => { node.href = release.url; });
    }

    // The main button: straight to the right file where we can tell, otherwise to the choices.
    const mine = windows ? 'windows' : mac ? 'mac-arm' : null;
    const label = windows ? 'Download for Windows' : mac ? 'Download for Mac' : 'Get Mimir for your computer';
    document.querySelectorAll('[data-primary-label]').forEach((node) => { node.textContent = label; });
    if (mine) {
      document.querySelector(`.platform[data-asset="${mine}"]`)?.classList.add('is-mine');
      if (mac) document.querySelector('.platform[data-asset="mac-intel"]')?.classList.add('is-mine');
    }
    const direct = mine && found[mine];
    document.querySelectorAll('[data-primary-download]').forEach((button) => {
      if (direct && !mac) {
        // Windows: one file fits everyone. Macs split by chip, so they get the choice.
        button.href = direct.href;
      } else {
        button.href = '#download';
      }
    });
  }

  wireDownloads();
})();
