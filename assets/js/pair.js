// wellmimir.com/pair/: desktop Mimir's pairing QR opens this page. The address and code ride the fragment
// (#url=…&code=…), which the browser never sends to this server or anyone else, and leave the address bar as soon as
// they are read. GitHub Pages cannot send a header that forbids framing, so the page itself refuses to show a code
// inside another site's page, where an overlay could trick someone into giving it away.
(() => {
  'use strict';

  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  if (window.top !== window.self) {
    document.getElementById('pair-framed').hidden = false;
    return;
  }
  const url = params.get('url') || '';
  const code = (params.get('code') || '').toUpperCase();
  let ok = false;
  try { ok = new URL(url).protocol === 'https:' && /^[0-9A-Z-]{4,24}$/.test(code); } catch { ok = false; }
  if (!ok) {
    document.getElementById('pair-missing').hidden = false;
    return;
  }
  const query = `pair?url=${encodeURIComponent(url)}&code=${encodeURIComponent(code)}`;
  document.getElementById('open-store').href = `wellmimir://${query}`;
  document.getElementById('open-dev').href = `mimir-mobile://${query}`;
  document.getElementById('pair-url').textContent = url;
  document.getElementById('pair-code').textContent = code;
  document.getElementById('pair-actions').hidden = false;
  document.getElementById('pair-details').hidden = false;
})();
