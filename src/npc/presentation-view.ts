export const PRESENTATION_SCRIPT_PATH = '/presentation.js';
export const PRESENTATION_STYLE_PATH = '/presentation.css';

function documentFor(view: 'panel' | 'overlay'): string {
  const title = view === 'panel' ? 'NPC chat' : 'NPC chat overlay';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${PRESENTATION_STYLE_PATH}">
<script src="${PRESENTATION_SCRIPT_PATH}" defer></script>
</head>
<body data-view="${view}">
<main aria-label="${title}">
<header><strong>${title}</strong><span id="status" role="status">Connecting</span></header>
<ol id="messages" aria-live="polite"></ol>
<p id="empty">Waiting for messages.</p>
</main>
</body>
</html>`;
}

export const PANEL_HTML = documentFor('panel');
export const OVERLAY_HTML = documentFor('overlay');

export const PRESENTATION_CSS = `
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#eef0f4;background:transparent}
*{box-sizing:border-box}
html,body{min-height:100%;margin:0}
body{background:transparent}
body[data-view="panel"]{background:#15171b}
main{max-width:46rem;margin:0 auto;padding:1rem}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-bottom:.75rem;border-bottom:1px solid #343840}
header strong{font-size:1rem}#status{font-size:.75rem;color:#a9afb9}
ol{list-style:none;margin:0;padding:.75rem 0;max-height:calc(100vh - 4rem);overflow:auto;overflow-wrap:anywhere}
li{padding:.55rem 0;border-bottom:1px solid #292d34;line-height:1.45}
.name{display:block;margin-bottom:.15rem;color:#b8c8ff;font-size:.78rem;font-weight:700;letter-spacing:.02em}
.message{white-space:pre-wrap}#empty{color:#a9afb9;font-size:.9rem}
body[data-view="overlay"]{background:transparent}body[data-view="overlay"] main{box-sizing:border-box;height:100vh;display:flex;flex-direction:column;justify-content:flex-end;max-width:none;padding:1.25rem;overflow:hidden;font-size:clamp(24px,3.5vw,32px);text-shadow:0 1px 3px #101216}
body[data-view="overlay"] header,body[data-view="overlay"] #empty{display:none}
body[data-view="overlay"] ol{flex:0 0 auto;max-height:none;overflow:visible;padding:0}body[data-view="overlay"] li{display:block;width:fit-content;max-width:100%;box-sizing:border-box;border:1px solid #4d638b;border:1px solid oklch(0.5 0.07 262);border-radius:.5rem;padding:.5rem .8rem;margin-top:1rem;background:#142139;background:oklch(0.25 0.05 262)}
body[data-view="overlay"] .name{display:inline;margin:0;font-size:inherit}
body[data-view="overlay"] .name::after{content:": "}
@keyframes npc-entrance{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
li.enter{animation:npc-entrance .2s ease-out}
@media (prefers-reduced-motion:reduce){li.enter{animation:none}}
@media (max-width:420px){main{padding:.75rem}li{padding:.5rem 0}}
`;

export const PRESENTATION_SCRIPT = `(() => {
  'use strict';
  const list = document.getElementById('messages');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const isOverlay = document.body.dataset.view === 'overlay';
  const rows = new Map();
  let stream = '';
  let hasRendered = false;
  let restoring = false;
  const source = new EventSource('/events');
  function createRow(item, animate) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    const message = document.createElement('span');
    name.className = 'name';
    message.className = 'message';
    name.textContent = item.username;
    message.textContent = item.message;
    row.append(name, message);
    if (animate) row.className = 'enter';
    return row;
  }
  function render(snapshot) {
    const all = Array.isArray(snapshot && snapshot.messages) ? snapshot.messages : [];
    const messages = isOverlay ? all.slice(-10) : all.slice(-100);
    const rawStream = snapshot && snapshot.stream;
    const nextStream = typeof rawStream === 'string' && rawStream.length > 0 ? rawStream : '';
    const resets = !hasRendered || nextStream !== stream;
    const keepBottom = isOverlay || list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    if (resets) {
      for (const row of rows.values()) row.remove();
      rows.clear();
    }
    const seen = new Set();
    const arrivals = [];
    for (const item of messages) {
      if (!item || typeof item.id !== 'string' || item.id.length === 0
        || typeof item.username !== 'string' || typeof item.message !== 'string') continue;
      const key = nextStream + '/' + item.id;
      seen.add(key);
      if (!rows.has(key)) arrivals.push({ key, item });
    }
    for (const key of Array.from(rows.keys())) {
      if (!seen.has(key)) {
        rows.get(key).remove();
        rows.delete(key);
      }
    }
    // Only a single new arrival on a stable connection is a normal live reveal;
    // reconnect or coalesced restoration of history stays silent.
    const animate = hasRendered && !resets && !restoring && arrivals.length === 1;
    restoring = false;
    for (const row of rows.values()) row.className = '';
    for (const arrival of arrivals) {
      const row = createRow(arrival.item, animate);
      rows.set(arrival.key, row);
      list.append(row);
    }
    empty.hidden = list.children.length !== 0;
    stream = nextStream;
    hasRendered = true;
    if (keepBottom) list.scrollTop = list.scrollHeight;
  }
  source.addEventListener('snapshot', (event) => {
    try { render(JSON.parse(event.data)); } catch { status.textContent = 'Invalid update'; }
  });
  source.onopen = () => { status.textContent = 'Live'; };
  source.onerror = () => { status.textContent = 'Reconnecting'; restoring = true; };
})();
`;
