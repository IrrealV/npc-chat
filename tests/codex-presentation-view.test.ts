import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  OVERLAY_HTML,
  PANEL_HTML,
  PRESENTATION_CSS,
  PRESENTATION_SCRIPT,
} from '../src/npc/presentation-view.js';

class FakeElement {
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  detachCount = 0;
  readonly dataset: Record<string, string> = {};
  className = '';
  hidden = false;
  scrollHeight = 100;
  scrollTop = 0;
  clientHeight = 20;
  #text = '';

  constructor(readonly tagName: string) {}
  set textContent(value: string) { this.#text = value; }
  get textContent(): string { return this.#text; }
  set innerHTML(_value: string) { throw new Error('unsafe_inner_html'); }
  #detach(): void {
    const parent = this.parent;
    if (parent === null) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = null;
    this.detachCount += 1;
  }
  #attach(parent: FakeElement): void {
    this.#detach();
    parent.children.push(this);
    this.parent = parent;
  }
  append(...elements: FakeElement[]): void {
    for (const element of elements) element.#attach(this);
  }
  replaceChildren(fragment: FakeElement): void {
    for (const child of [...this.children]) child.#detach();
    for (const child of [...fragment.children]) child.#attach(this);
  }
  remove(): void { this.#detach(); }
}

class FakeEventSource {
  static latest: FakeEventSource;
  readonly listeners = new Map<string, (event: { data: string }) => void>();
  onopen: (() => void) | undefined;
  onerror: (() => void) | undefined;
  constructor(readonly path: string) { FakeEventSource.latest = this; }
  addEventListener(name: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(name, listener);
  }
  snapshot(
    messages: ReadonlyArray<{ id: string; username: string; message: string }>,
    stream = 'stream-a',
  ): void {
    this.listeners.get('snapshot')?.({ data: JSON.stringify({ stream, messages }) });
  }
}

function execute(view: 'panel' | 'overlay') {
  const elements = {
    messages: new FakeElement('ol'),
    empty: new FakeElement('p'),
    status: new FakeElement('span'),
  };
  const body = new FakeElement('body');
  body.dataset.view = view;
  const document = {
    body,
    getElementById: (id: keyof typeof elements) => elements[id],
    createElement: (tag: string) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('fragment'),
  };
  vm.runInNewContext(PRESENTATION_SCRIPT, { document, EventSource: FakeEventSource, JSON, Array });
  return { ...elements, source: FakeEventSource.latest! };
}

function message(id: string, username: string, text: string): { id: string; username: string; message: string } {
  return { id, username, message: text };
}

function reconnect(source: FakeEventSource): void {
  source.onerror?.();
  source.onopen?.();
}

function ruleBody(css: string, selector: string): string {
  const header = `${selector}{`;
  const at = css.indexOf(header);
  if (at < 0) throw new Error(`Missing stylesheet rule: ${selector}`);
  const boundary = at === 0 ? '' : css[at - 1];
  if (boundary !== '\n' && boundary !== '}' && boundary !== ',') {
    throw new Error(`Ambiguous stylesheet rule: ${selector}`);
  }
  return css.slice(at + header.length, css.indexOf('}', at));
}

describe('served presentation documents', () => {
  it('uses external assets, English chrome, and an explicitly transparent overlay', () => {
    expect(PANEL_HTML).toContain('Waiting for messages.');
    expect(PANEL_HTML).toContain('src="/presentation.js"');
    expect(PANEL_HTML).not.toContain('<script>');
    expect(OVERLAY_HTML).toContain('data-view="overlay"');
    expect(PRESENTATION_CSS).toMatch(/:root\{[^}]*background:transparent/);
    expect(PRESENTATION_CSS).toContain('body[data-view="panel"]{background:#15171b}');
    expect(PRESENTATION_CSS).toContain('body[data-view="overlay"]{background:transparent}');
    expect(PRESENTATION_CSS).toContain('overflow-wrap:anywhere');
  });

  it('replaces panel snapshots with text nodes and preserves an older scroll position', () => {
    const app = execute('panel');
    app.messages.scrollTop = 0;
    app.source.snapshot([
      message('m1', '<img src=x>', '<script>bad()</script>\nEspañol'),
    ]);

    expect(app.source.path).toBe('/events');
    expect(app.messages.children).toHaveLength(1);
    expect(app.messages.children[0]?.children[0]?.textContent).toBe('<img src=x>');
    expect(app.messages.children[0]?.children[1]?.textContent).toBe('<script>bad()</script>\nEspañol');
    expect(app.messages.scrollTop).toBe(0);
    expect(app.empty.hidden).toBe(true);
  });

  it('keeps only the latest ten overlay messages and accepts a fresh empty restart snapshot', () => {
    const app = execute('overlay');
    const messages = Array.from({ length: 12 }, (_, index) =>
      message(`m${index + 1}`, `User ${index}`, `Message ${index}`));
    app.source.snapshot(messages);

    expect(app.messages.children).toHaveLength(10);
    expect(app.messages.children[0]?.children[1]?.textContent).toBe('Message 2');
    app.source.snapshot([]);
    expect(app.messages.children).toHaveLength(0);
    expect(app.empty.hidden).toBe(false);
  });

  it('reports connection, reconnect, and invalid snapshot state without rendering stale data', () => {
    const app = execute('panel');
    app.source.onopen?.();
    expect(app.status.textContent).toBe('Live');
    app.source.onerror?.();
    expect(app.status.textContent).toBe('Reconnecting');
    app.source.listeners.get('snapshot')?.({ data: '{bad json' });
    expect(app.status.textContent).toBe('Invalid update');
    expect(app.messages.children).toHaveLength(0);
  });

  it('renders an initial snapshot silently without entrance animation', () => {
    const app = execute('panel');
    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
    ]);

    expect(app.messages.children).toHaveLength(2);
    expect(app.messages.children.every((row) => row.className === '')).toBe(true);
  });

  it('retains surviving row identity, keeps rows mounted, and animates only live new arrivals', () => {
    const app = execute('panel');
    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
    ]);
    const firstRow = app.messages.children[0];
    const secondRow = app.messages.children[1];

    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
      message('m3', 'Cata', 'Tres'),
    ]);

    expect(app.messages.children[0]).toBe(firstRow);
    expect(app.messages.children[1]).toBe(secondRow);
    expect(firstRow?.parent).toBe(app.messages);
    expect(firstRow?.detachCount).toBe(0);
    expect(secondRow?.detachCount).toBe(0);
    expect(app.messages.children).toHaveLength(3);
    expect(app.messages.children[2]?.className).toBe('enter');
    expect(app.messages.children[2]?.children[1]?.textContent).toBe('Tres');
    expect(app.messages.children[0]?.className).toBe('');
    expect(app.messages.children[1]?.className).toBe('');

    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
      message('m3', 'Cata', 'Tres'),
      message('m4', 'Dana', 'Cuatro'),
    ]);
    expect(app.messages.children[2]?.className).toBe('');
    expect(app.messages.children[3]?.className).toBe('enter');
    expect(app.messages.children[0]?.detachCount).toBe(0);
    expect(app.messages.children[1]?.detachCount).toBe(0);
    expect(app.messages.children[2]?.detachCount).toBe(0);
  });

  it('keeps every surviving row continuously mounted on repeated identical snapshots', () => {
    const app = execute('panel');
    const snapshot = [
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
      message('m3', 'Cata', 'Tres'),
      message('m4', 'Dana', 'Cuatro'),
    ];
    app.source.snapshot(snapshot);
    const mounted = [...app.messages.children];

    app.source.snapshot(snapshot);
    app.source.snapshot(snapshot);

    expect(app.messages.children).toStrictEqual(mounted);
    expect(mounted.every((row) => row.parent === app.messages)).toBe(true);
    expect(mounted.every((row) => row.detachCount === 0)).toBe(true);
    expect(mounted.every((row) => row.className === '')).toBe(true);
  });

  it('keeps duplicate identical messages as distinct rows via presentation IDs', () => {
    const app = execute('panel');
    app.source.snapshot([
      message('m7', 'Ana', 'Hola'),
      message('m8', 'Ana', 'Hola'),
    ]);

    expect(app.messages.children).toHaveLength(2);
    expect(app.messages.children[0]?.children[1]?.textContent).toBe('Hola');
    expect(app.messages.children[1]?.children[1]?.textContent).toBe('Hola');
  });

  it('restores an identical reconnect snapshot silently and restarts a new stream silently', () => {
    const app = execute('panel');
    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    const original = app.messages.children[0];

    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    expect(app.messages.children[0]).toBe(original);
    expect(original?.detachCount).toBe(0);
    expect(app.messages.children[0]?.className).toBe('');

    app.source.snapshot([message('m1', 'Ana', 'Uno')], 'stream-b');
    expect(app.messages.children).toHaveLength(1);
    expect(app.messages.children[0]?.className).toBe('');
    expect(app.messages.children[0]).not.toBe(original);
  });

  it('animates the first live arrival after an initial empty snapshot', () => {
    const app = execute('panel');
    app.source.snapshot([]);
    expect(app.messages.children).toHaveLength(0);
    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    expect(app.messages.children[0]?.className).toBe('enter');
  });

  it('restores same-stream history silently after a real reconnect and animates the next normal arrival', () => {
    const app = execute('panel');
    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    const original = app.messages.children[0];

    app.source.onerror?.();
    expect(app.status.textContent).toBe('Reconnecting');
    app.source.onopen?.();
    expect(app.status.textContent).toBe('Live');
    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
    ]);

    expect(app.messages.children[0]).toBe(original);
    expect(original?.detachCount).toBe(0);
    expect(app.messages.children[1]?.className).toBe('');
    expect(app.messages.children).toHaveLength(2);

    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
      message('m3', 'Cata', 'Tres'),
    ]);
    expect(app.messages.children[2]?.className).toBe('enter');
  });

  it('restores overlay history silently after a real reconnect too', () => {
    const app = execute('overlay');
    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    reconnect(app.source);
    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
    ]);
    expect(app.messages.children[1]?.className).toBe('');
    expect(app.messages.children).toHaveLength(2);
  });

  it('reconciles a connected coalesced jump silently without local stagger', () => {
    const app = execute('panel');
    app.source.snapshot([message('m1', 'Ana', 'Uno')]);
    const firstRow = app.messages.children[0];

    app.source.snapshot([
      message('m1', 'Ana', 'Uno'),
      message('m2', 'Beto', 'Dos'),
      message('m3', 'Cata', 'Tres'),
      message('m4', 'Dana', 'Cuatro'),
    ]);

    expect(app.messages.children.slice(0, 1)).toStrictEqual([firstRow]);
    expect(app.messages.children).toHaveLength(4);
    expect(app.messages.children.slice(1).every((row) => row.className === '')).toBe(true);
    expect(app.messages.children.every((row) => row.parent === app.messages)).toBe(true);
    expect(firstRow?.detachCount).toBe(0);
  });

  it('drops trimmed rows that leave the retained history window', () => {
    const app = execute('panel');
    const twelve = Array.from({ length: 12 }, (_, index) =>
      message(`m${index + 1}`, `User ${index}`, `Message ${index}`));
    app.source.snapshot(twelve);
    const retained = app.messages.children.slice(2);

    app.source.snapshot(twelve.slice(2));
    expect(app.messages.children).toHaveLength(10);
    expect(app.messages.children).toStrictEqual(retained);
    expect(app.messages.children.every((row) => row.className === '')).toBe(true);
  });

  it('animates with CSS opacity and transform and honors reduced motion', () => {
    expect(PRESENTATION_CSS).toContain('@keyframes');
    expect(PRESENTATION_CSS).toContain('li.enter{animation:');
    expect(PRESENTATION_CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{li\.enter\{animation:none\}\}/);
    const animationBlock = PRESENTATION_CSS.match(/li\.enter\{animation:[^}]*\}/)?.[0] ?? '';
    expect(animationBlock).toContain('.2s');
    const keyframesBlock = PRESENTATION_CSS.match(/@keyframes [^{]+\{.*?\}\}/)?.[0] ?? '';
    expect(keyframesBlock).toContain('opacity');
    expect(keyframesBlock).toContain('transform');
  });
});

describe('served overlay stylesheet contract', () => {
  it('scales overlay text with a bounded clamp and lets names inherit the full size', () => {
    const frame = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] main');
    const name = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] .name');

    expect(frame).toMatch(/font-size:clamp\(24px,\s*3\.5vw,\s*32px\)/);
    expect(name).toContain('font-size:inherit');
  });

  it('renders names inline with a CSS colon separator and no truncation or nowrap', () => {
    const name = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] .name');
    const separator = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] .name::after');

    expect(name).toContain('display:inline');
    expect(separator).toContain('content:": "');
    expect(PRESENTATION_CSS).not.toContain('nowrap');
    expect(PRESENTATION_CSS).not.toContain('text-overflow');
  });

  it('keeps the overlay page transparent while each message gets a solid opaque backplate', () => {
    const row = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] li');
    const list = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] ol');

    expect(PRESENTATION_CSS).toContain('body[data-view="overlay"]{background:transparent}');
    expect(list).not.toContain('background');
    expect(row).toContain('background:#142139');
    expect(row).toContain('background:oklch(0.25 0.05 262)');
    expect(row.indexOf('background:#142139')).toBeLessThan(row.indexOf('background:oklch(0.25 0.05 262)'));
    expect(row).not.toContain('background:none');
    expect(row).not.toContain('background:transparent');
    expect(row).not.toContain('rgba(');
  });

  it('keeps each message as one content-fit block row bounded by the available width', () => {
    const row = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] li');

    expect(row).toContain('display:block');
    expect(row).not.toContain('inline-block');
    expect(row).toContain('width:fit-content');
    expect(row).not.toMatch(/(?:^|;)width:100%/);
    expect(row).toContain('max-width:100%');
    expect(row).toContain('box-sizing:border-box');
    expect(PRESENTATION_CSS).toContain('*{box-sizing:border-box}');
  });

  it('frames each message backplate with a fine border, restrained radius, and comfortable padding', () => {
    const row = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] li');

    expect(row).toContain('border:1px solid #4d638b');
    expect(row).toContain('border:1px solid oklch(0.5 0.07 262)');
    expect(row).toContain('border-radius:.5rem');
    expect(row).toContain('padding:.5rem .8rem');
    expect(row.indexOf('border:1px solid #4d638b')).toBeLessThan(row.indexOf('border:1px solid oklch(0.5 0.07 262)'));
    expect(row).not.toContain('border:0');
    expect(row).not.toContain('gradient');
    expect(row).not.toContain('backdrop-filter');
    expect(row).not.toContain('box-shadow');
    expect(row).not.toContain('transition:');
    expect(row).not.toContain('animation:');
  });

  it('bounds the overlay in a fixed border-box viewport frame with hidden overflow', () => {
    const frame = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] main');

    expect(frame).toContain('height:100vh');
    expect(frame).toContain('box-sizing:border-box');
    expect(frame).toContain('overflow:hidden');
    expect(frame).toContain('padding:1.25rem');
    expect(frame).not.toContain('min-height');
  });

  it('bottom-aligns a non-shrinking message list inside the frame', () => {
    const frame = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] main');
    const list = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] ol');

    expect(frame).toContain('flex-direction:column');
    expect(frame).toContain('justify-content:flex-end');
    expect(list).toContain('flex:0 0 auto');
    expect(list).not.toContain('max-height:calc');
  });

  it('leaves shared panel and overlay behavior rules unchanged', () => {
    expect(PRESENTATION_CSS).toContain('body[data-view="panel"]{background:#15171b}');
    expect(ruleBody(PRESENTATION_CSS, '.name')).toContain('font-size:.78rem');
    expect(ruleBody(PRESENTATION_CSS, 'ol')).toContain('max-height:calc(100vh - 4rem)');
    expect(ruleBody(PRESENTATION_CSS, 'li')).toContain('border-bottom:1px solid #292d34');
    expect(ruleBody(PRESENTATION_CSS, 'li')).not.toContain('background');
    expect(ruleBody(PRESENTATION_CSS, '.message')).toContain('white-space:pre-wrap');
    expect(ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] header,body[data-view="overlay"] #empty')).toContain('display:none');
    expect(PRESENTATION_CSS).toContain('@keyframes npc-entrance');
    expect(PRESENTATION_CSS).toContain('li.enter{animation:npc-entrance .2s ease-out}');
    expect(PRESENTATION_CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{li\.enter\{animation:none\}\}/);
    expect(PRESENTATION_CSS).toContain('@media (max-width:420px){main{padding:.75rem}li{padding:.5rem 0}}');
  });

  it('separates overlay message backplates with a one-rem vertical gap the panel does not inherit', () => {
    const overlayRow = ruleBody(PRESENTATION_CSS, 'body[data-view="overlay"] li');
    const panelRow = ruleBody(PRESENTATION_CSS, 'li');

    expect(overlayRow).toContain('margin-top:1rem');
    expect(overlayRow).not.toContain('margin-top:.35rem');
    expect(panelRow).not.toContain('margin-top');
  });
});
