// SlideFx — a small library of cursor-driven RevealJS fragment styles.
//
// Every style here follows the same contract, which the registry enforces so
// each individual style does not have to:
//
//   * original markup and inline styles are cached before anything is touched,
//     and restored when the fragment is hidden
//   * animations run on a tracked timeline that is cancelled on hide, on
//     re-show, and when navigating away mid-flight
//   * cursors and any chrome (bars, badges, bands) are pooled per element and
//     cleaned up automatically
//
// Marking: put the style's class on the fragment itself, or on elements inside
// it. Styles that act on content already on screen take `for="#selector"` and
// then the fragment itself can be empty, acting purely as a trigger.
//
// Attributes need no data- prefix in the .qmd; Quarto rewrites them to data-*
// and `attr()` reads either spelling.

window.SlideFx = (function () {
  'use strict';

  const SLIDE_W = 1280;
  const SLIDE_H = 720;

  // ── Attribute reading ─────────────────────────────────────────────────────

  function attr(el, name) {
    return el.getAttribute(name) || el.getAttribute('data-' + name) || null;
  }

  function num(el, name, dflt) {
    const raw = attr(el, name);
    if (raw === null) return dflt;
    const v = Number(raw);
    return Number.isFinite(v) ? v : dflt;
  }

  // "12,-4" → {x: 12, y: -4}
  function pair(el, name, dflt) {
    const raw = attr(el, name);
    if (!raw) return dflt;
    const parts = raw.split(',').map(s => Number(s.trim()) || 0);
    return { x: parts[0] || 0, y: parts[1] || 0 };
  }

  function list(el, name) {
    return (attr(el, name) || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  // An element's box in slide coordinates. RevealJS scales the slide with a
  // CSS transform, so screen pixels must be scaled to match the translate
  // values anime.js applies to slide children.
  function posIn(el, section) {
    const s = section.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = SLIDE_W / s.width;
    return {
      x: (r.left - s.left) * k,
      y: (r.top - s.top) * k,
      w: r.width * k,
      h: r.height * k,
      right: (r.right - s.left) * k,
      bottom: (r.bottom - s.top) * k,
    };
  }

  // Where a cursor should grab an element: inside it, but near the top-left.
  // Holding a wide block by its middle does not read as dragging.
  function grabPoint(c) {
    return { x: c.x + Math.min(c.w * 0.3, 140), y: c.y + Math.min(c.h * 0.35, 70) };
  }

  function currentTranslate(el) {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  }

  // Offscreen point a cursor flies in from, given where it is headed.
  function cursorEntry(from, at) {
    return from === 'right'  ? { x: SLIDE_W + 90, y: at.y + 60 }
         : from === 'top'    ? { x: at.x + 40, y: -140 }
         : from === 'bottom' ? { x: at.x + 40, y: SLIDE_H + 140 }
         :                     { x: -140, y: at.y + 60 };
  }

  // ── Cursors ───────────────────────────────────────────────────────────────

  const PALETTE = [
    '#e91e8c', '#1565c0', '#f9a825', '#2e7d32', '#6a1b9a',
    '#c62828', '#00838f', '#e65100', '#4527a0', '#33691e',
  ];
  let paletteAt = 0;

  function nextColor() {
    return PALETTE[paletteAt++ % PALETTE.length];
  }

  function makeCursor(opts) {
    const o = opts || {};
    const color = o.color || nextColor();
    const el = document.createElement('div');
    if (o.id) el.id = o.id;
    el.className = 'collab-cursor-node';
    const tag = o.name
      ? `<span class="collab-cursor-name" style="background:${color}">${o.name}</span>`
      : '';
    el.innerHTML = `
      <svg width="28" height="34" viewBox="0 0 11 14" xmlns="http://www.w3.org/2000/svg"
           class="collab-cursor-arrow">
        <path d="M0 0 L0 12 L3.2 8.8 L5.4 14 L7.2 13.3 L5 7.8 L9 7.8 Z"
              fill="${color}" stroke="white" stroke-width=".7" stroke-linejoin="round"/>
      </svg>${tag}`;
    return el;
  }

  // Cursors are pooled per element under a key, so re-showing a fragment
  // reuses the same node instead of littering the slide.
  // The pool key carries the name and color: two fragments acting on the same
  // element are two different collaborators, and reusing one node would give
  // the second one the first one's tag.
  function cursorFor(el, section, key, name, color) {
    el._fxCursors = el._fxCursors || {};
    const id = [key, name || '', color || ''].join('|');
    if (!el._fxCursors[id]) {
      el._fxCursors[id] = makeCursor({ name: name, color: color });
    }
    const c = el._fxCursors[id];
    if (!c.isConnected) section.appendChild(c);
    return c;
  }

  function allCursors(el) {
    return Object.values(el._fxCursors || {});
  }

  // ── Chrome (bands, badges, bars) ──────────────────────────────────────────

  // Anything created for the animation goes through here so the registry can
  // remove it on hide without each style tracking its own leftovers.
  function chrome(el, section, key, cls, html) {
    el._fxChrome = el._fxChrome || {};
    if (!el._fxChrome[key]) {
      const node = document.createElement('div');
      node.className = cls;
      if (html) node.innerHTML = html;
      el._fxChrome[key] = node;
    }
    const node = el._fxChrome[key];
    node.className = cls;
    if (!node.isConnected) section.appendChild(node);
    return node;
  }

  // Position a chrome node over a slide-coordinate box.
  function placeOver(node, box) {
    node.style.left = box.x + 'px';
    node.style.top = box.y + 'px';
    node.style.width = box.w + 'px';
    node.style.height = box.h + 'px';
  }

  function placeAt(node, x, y) {
    node.style.left = x + 'px';
    node.style.top = y + 'px';
  }

  // ── Caching and restore ───────────────────────────────────────────────────

  const TRACKED_STYLES = [
    'width', 'height', 'minHeight', 'maxHeight', 'transform', 'opacity',
    'clipPath', 'fontSize', 'fontFamily', 'color', 'backgroundColor',
    'visibility', 'position', 'left', 'top',
  ];

  function cache(el) {
    if (el._fxHTML == null) el._fxHTML = el.innerHTML;
    if (el._fxText == null) el._fxText = el.textContent.trim();
    if (!el._fxStyle) {
      el._fxStyle = {};
      TRACKED_STYLES.forEach((p) => { el._fxStyle[p] = el.style[p]; });
    }
  }

  function restore(el) {
    if (el._fxHTML != null) el.innerHTML = el._fxHTML;
    if (el._fxStyle) {
      TRACKED_STYLES.forEach((p) => { el.style[p] = el._fxStyle[p]; });
    }
    if (typeof anime !== 'undefined') {
      anime.remove(el);
      anime.set(el, { translateX: 0, translateY: 0, scale: 1, rotate: 0, opacity: '' });
      el.style.transform = (el._fxStyle && el._fxStyle.transform) || '';
      el.style.opacity = (el._fxStyle && el._fxStyle.opacity) || '';
    }
  }

  // ── Timelines ─────────────────────────────────────────────────────────────

  function stop(el) {
    if (el._fxTl) { el._fxTl.pause(); el._fxTl = null; }
    if (el._fxLoops) { el._fxLoops.forEach(fn => fn()); el._fxLoops = []; }
    if (typeof anime !== 'undefined') {
      anime.remove([el, ...allCursors(el), ...Object.values(el._fxChrome || {})]);
    }
  }

  // Create a tracked timeline. Anything the style adds to it is cancelled
  // automatically when the fragment is hidden or re-shown.
  function timeline(el) {
    const tl = anime.timeline();
    el._fxTl = tl;
    return tl;
  }

  // For behaviors that loop indefinitely rather than running a timeline.
  function onStop(el, fn) {
    el._fxLoops = el._fxLoops || [];
    el._fxLoops.push(fn);
  }

  // Everything a teardown does apart from putting the markup back: timelines
  // cancelled, cursors parked, chrome removed. A style that reverses itself
  // by hand wants this rather than the full restore.
  function sweep(el) {
    stop(el);
    allCursors(el).forEach((c) => {
      if (typeof anime !== 'undefined') anime.set(c, { opacity: 0 });
    });
    Object.values(el._fxChrome || {}).forEach(n => n.remove());
  }

  function teardown(el) {
    sweep(el);
    restore(el);
  }

  // ── Cursor helpers shared by several styles ───────────────────────────────

  // Fly a cursor in from an edge to a point, and return the entry point so the
  // style can send it back the same way.
  //
  // The from-values are given explicitly as [from, to] arrays rather than being
  // set in a `begin` callback: anime.js resolves a tween's start value when the
  // tween is *created*, which for a timeline is at build time, so a `begin`
  // hook runs too late and the cursor flies in from wherever it happened to be
  // parked instead of from the slide edge.
  function flyIn(tl, cursor, from, at, offset, duration) {
    const entry = cursorEntry(from, at);
    tl.add({
      targets: cursor,
      opacity: [0, 1],
      translateX: [entry.x, at.x],
      translateY: [entry.y, at.y],
      duration: duration || 560, easing: 'easeOutCubic',
    }, offset || 0);
    return entry;
  }

  function flyOut(tl, cursor, entry, offset, duration) {
    tl.add({
      targets: cursor, translateX: entry.x, translateY: entry.y, opacity: 0,
      duration: duration || 520, easing: 'easeInQuad',
    }, offset);
  }

  // A grab squeeze. Keyframes rather than two tweens so it reliably lands back
  // on scale 1, and it must not overlap a translate on the same element:
  // concurrent tweens on one transform leave a stale scale behind.
  function squeeze(tl, el, offset, amount) {
    const a = amount || 1.03;
    tl.add({
      targets: el, easing: 'easeOutQuad',
      keyframes: [{ scale: a, duration: 130 }, { scale: 1, duration: 130 }],
    }, offset);
    return offset + 260;
  }

  // Type text into a host element, char by char, cursor tracking the caret.
  // Returns the duration consumed.
  //
  // The host is emptied in `begin`, not up front: the tween drives a plain
  // counter rather than the DOM, so deferring the mutation is safe, and doing
  // it at build time would blank the host the moment the fragment fires
  // instead of when the typing actually starts.
  function typeInto(tl, opts) {
    const { section, host, text, cursor, offset, speed, keepCaret } = opts;
    const caret = document.createElement('span');
    caret.className = 'type-caret';

    const ms = Math.max(text.length * (speed || 55), 120);
    const state = { n: 0 };
    let done = false;

    tl.add({
      targets: state, n: text.length, duration: ms, easing: 'linear',
      begin: () => {
        done = false;
        host.textContent = '';
        host.appendChild(caret);
      },
      update: () => {
        if (done) return;         // anime can tick update once more after complete
        host.textContent = text.slice(0, Math.round(state.n));
        host.appendChild(caret);
        if (cursor) {
          const c = posIn(caret, section);
          anime.set(cursor, { translateX: c.x, translateY: c.y + c.h * 0.55 });
        }
      },
      complete: () => {
        done = true;
        host.textContent = text;
        if (keepCaret) host.appendChild(caret);
        else caret.remove();      // no-op when already detached
      },
    }, offset);
    return ms;
  }

  // Delete text backwards from a host, char by char.
  function deleteFrom(tl, opts) {
    const { section, host, text, cursor, offset, speed } = opts;
    const caret = document.createElement('span');
    caret.className = 'type-caret';
    const ms = Math.max(text.length * (speed || 40), 120);
    const state = { n: text.length };
    let done = false;

    tl.add({
      targets: state, n: 0, duration: ms, easing: 'linear',
      begin: () => { done = false; host.textContent = text; host.appendChild(caret); },
      update: () => {
        if (done) return;
        host.textContent = text.slice(0, Math.round(state.n));
        host.appendChild(caret);
        if (cursor) {
          const c = posIn(caret, section);
          anime.set(cursor, { translateX: c.x, translateY: c.y + c.h * 0.55 });
        }
      },
      complete: () => { done = true; host.textContent = ''; caret.remove(); },
    }, offset);
    return ms;
  }

  // The "lines" of a container: descend through single wrappers so a markdown
  // div holding one <ul> resolves to the <li> elements rather than to the list
  // as a whole. Deliberately not cached — hiding a fragment restores innerHTML,
  // which replaces these nodes, so a cached list would go stale.
  function lines(el) {
    let node = el;
    while (node.children.length === 1 && node.children[0].children.length > 0) {
      node = node.children[0];
    }
    const kids = Array.from(node.children)
      .filter(k => k.textContent.trim() || k.querySelector('img'));
    return kids.length ? kids : [node];
  }

  // Wrap every occurrence of a term in its own span, walking text nodes so
  // existing markup inside the element survives.
  function wrapMatches(root, term, cls) {
    const hits = [];
    if (!term) return hits;
    const lower = term.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let cur = node;
      for (;;) {
        const i = cur.data.toLowerCase().indexOf(lower);
        if (i === -1) break;
        const match = cur.splitText(i);
        const rest = match.splitText(term.length);
        const span = document.createElement('span');
        span.className = cls || 'fx-hit';
        span.textContent = match.data;
        match.replaceWith(span);
        hits.push(span);
        cur = rest;
      }
    });
    return hits;
  }

  // ── Registry ──────────────────────────────────────────────────────────────

  const styles = [];

  // define(cls, { show(ctx), hide(ctx) })
  //
  // ctx = { section, frag, el, cursor(key, name, color), chrome(key, cls, html),
  //         tl(), attr, num, pair, list }
  //
  // `el` is the element being animated: the `for="#sel"` target if given,
  // otherwise the marker itself. Omitting `hide` gets the default teardown,
  // which is right for almost everything.
  function define(cls, spec) {
    styles.push({ cls, spec });
  }

  function markers(frag, cls) {
    return frag.classList.contains(cls)
      ? [frag]
      : Array.from(frag.querySelectorAll('.' + cls));
  }

  function actOn(section, marker) {
    const sel = attr(marker, 'for');
    if (!sel) return marker;
    return section.querySelector(sel) || document.querySelector(sel) || marker;
  }

  function contextFor(section, frag, marker) {
    const el = actOn(section, marker);
    return {
      section, frag, marker, el,
      cursor: (key, name, color) => cursorFor(el, section, key || 'main',
                                              name !== undefined ? name : attr(marker, 'cursor'),
                                              color || attr(marker, 'color')),
      chrome: (key, cls, html) => chrome(el, section, key, cls, html),
      tl: () => timeline(el),
      attr: (n) => attr(marker, n),
      num: (n, d) => num(marker, n, d),
      pair: (n, d) => pair(marker, n, d),
      list: (n) => list(marker, n),
      box: () => posIn(el, section),
      from: () => attr(marker, 'from') || 'left',
    };
  }

  // Two fragments can aim at the same element — delete some list entries, then
  // add one — and the blanket teardown that gives a fragment its clean slate
  // would undo the earlier one. So a marker registers as a holder of the
  // element it acts on, and while an earlier holder is still shown the markup
  // is left exactly as that holder left it. Only the last holder to leave
  // restores the original.
  function shown(marker) {
    const frag = marker.closest('.fragment') || marker;
    return frag.classList.contains('visible');
  }

  function heldByOthers(el, marker) {
    return (el._fxHolders || []).some(m => m !== marker && m.isConnected && shown(m));
  }

  function hold(el, marker) {
    el._fxHolders = (el._fxHolders || []).filter(m => m !== marker).concat([marker]);
  }

  function release(el, marker) {
    el._fxHolders = (el._fxHolders || []).filter(m => m !== marker);
  }

  function run(frag, phase) {
    const section = frag.closest('section');
    if (!section || typeof anime === 'undefined') return;
    styles.forEach(({ cls, spec }) => {
      markers(frag, cls).forEach((marker) => {
        const ctx = contextFor(section, frag, marker);
        if (phase === 'show') {
          cache(ctx.el);
          if (heldByOthers(ctx.el, marker)) {
            sweep(ctx.el);           // keep what the other fragment did
          } else {
            teardown(ctx.el);        // clean slate, in case of a re-show
            cache(ctx.el);           // teardown restored markup; re-cache is a no-op
          }
          hold(ctx.el, marker);
          if (spec.show) spec.show(ctx);
        } else {
          release(ctx.el, marker);
          if (spec.hide) spec.hide(ctx);
          else if (heldByOthers(ctx.el, marker)) sweep(ctx.el);
          else teardown(ctx.el);
        }
      });
    });
  }

  function boot() {
    function go() {
      if (typeof Reveal === 'undefined' || !Reveal.on) { setTimeout(go, 50); return; }
      Reveal.on('fragmentshown',  e => run(e.fragment, 'show'));
      Reveal.on('fragmenthidden', e => run(e.fragment, 'hide'));
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  }
  boot();

  return {
    // boot() wires itself up via Reveal.on regardless of plugin registration;
    // id/init are here only so RevealJS accepts this as a well-formed plugin.
    id: 'SlideFx',
    init() {},
    SLIDE_W, SLIDE_H,
    attr, num, pair, list,
    posIn, grabPoint, currentTranslate, cursorEntry,
    makeCursor, cursorFor, nextColor, PALETTE,
    chrome, placeOver, placeAt,
    cache, restore, stop, timeline, onStop, teardown, sweep,
    flyIn, flyOut, squeeze, typeInto, deleteFrom, wrapMatches, lines,
    define,
  };
})();
