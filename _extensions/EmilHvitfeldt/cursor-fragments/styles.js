// Fragment styles built on CursorFragments. Each one is registered with
// CursorFragments.define(class, { show(ctx) }), and gets caching, restore-on-hide
// and timeline cancellation from the registry for free.
//
// Styles that act on content already on screen accept `for="#selector"`, so the
// fragment carrying the class can be an empty trigger:
//
//   ::: {.fragment .nudge for="#headline" by="18,0"}
//   :::

(function () {
  'use strict';

  const S = window.CursorFragments;

  // Haul an element in from an offscreen edge, cursor in tow. Shared by
  // .race-in and .drag-from-folder; the standalone .drag-in style in
  // all-the-js-code.html predates this and still has its own copy.
  function haulIn(ctx, el, from, tl, t0, dur, cursor) {
    const section = ctx.section;
    const c = S.posIn(el, section);
    const grab = S.grabPoint(c);
    const M = 80;

    let dx = 0;
    let dy = 0;
    if (from === 'left')        dx = -(c.x + c.w + M);
    else if (from === 'right')  dx = S.SLIDE_W - c.x + M;
    else if (from === 'top')    dy = -(c.y + c.h + M);
    else if (from === 'bottom') dy = S.SLIDE_H - c.y + M;
    else dx = c.x + c.w / 2 < S.SLIDE_W / 2 ? -(c.x + c.w + M) : S.SLIDE_W - c.x + M;

    anime.set(el, { translateX: dx, translateY: dy });
    anime.set(cursor, { translateX: grab.x + dx, translateY: grab.y + dy, opacity: 0 });

    // Overshoot, capped in px: travel distance includes the element's own
    // width, so a bare percentage flings wide blocks.
    const past = v => -Math.sign(v) * Math.min(Math.abs(v) * 0.04, 18);
    const glide = to => [
      { translateX: to.x + past(dx), translateY: to.y + past(dy),
        duration: dur * 0.8, easing: 'easeOutQuad' },
      { translateX: to.x, translateY: to.y,
        duration: dur * 0.2, easing: 'easeOutQuad' },
    ];

    tl.add({ targets: cursor, opacity: 1, duration: 160, easing: 'easeOutQuad' }, t0);
    tl.add({ targets: el, keyframes: glide({ x: 0, y: 0 }) }, t0);
    tl.add({ targets: cursor, keyframes: glide({ x: grab.x, y: grab.y }) }, t0);
    tl.add({ targets: cursor, translateX: grab.x + dx * 0.35, translateY: grab.y + dy * 0.35,
             opacity: 0, duration: 520, easing: 'easeInQuad' }, t0 + dur + 180);
  }

  // ── .retype ───────────────────────────────────────────────────────────────
  // One wrong word, selected, deleted and retyped. The most direct
  // demonstration of editing a rendered slide.

  // Selects `from`, deletes it and types `into`, on `host`. Used both to run
  // the fragment forward (word -> to) and, in `hide`, to run it in reverse
  // (to -> word) as a genuine second animation rather than an anime.js
  // timeline `.reverse()` — which does not correctly invert a hand-rolled
  // counter-driven tween like `typeInto`/`deleteFrom` (their target value is
  // cached once at build time, so replaying the same timeline "backward"
  // just reruns the same forward counter instead of counting down).
  function runRetype(ctx, host, from, into, speed, done) {
    const hc = S.posIn(host, ctx.section);
    const cursor = ctx.cursor();

    const tl = ctx.tl();
    const at = { x: hc.x + hc.w * 0.5, y: hc.y + hc.h * 0.6 };
    const entry = S.flyIn(tl, cursor, ctx.from(), at, 0);

    // select the current word
    anime.set(host, { backgroundColor: 'rgba(66,133,244,0)' });
    tl.add({ targets: host, backgroundColor: 'rgba(66,133,244,0.35)',
             duration: 240, easing: 'easeOutQuad' }, 580);

    // delete it, drop the selection, type the replacement
    let t = 900;
    t += S.deleteFrom(tl, {
      section: ctx.section, host, text: from, cursor,
      offset: t, speed,
    });

    tl.add({ targets: host, backgroundColor: 'rgba(66,133,244,0)',
             duration: 160, easing: 'linear' }, t);
    t += 100;

    t += S.typeInto(tl, {
      section: ctx.section, host, text: into, cursor,
      offset: t, speed: speed + 13,
    });

    S.flyOut(tl, cursor, entry, t + 240);

    if (done) {
      if (tl.finished && typeof tl.finished.then === 'function') tl.finished.then(done);
      else setTimeout(done, t + 240);
    }
  }

  S.define('retype', {
    show(ctx) {
      const to = ctx.attr('to');
      if (to == null) return;

      // With `word`, find that text inside ctx.el and wrap it. Without it,
      // ctx.el is expected to already be the word itself (e.g. an inline
      // [strong]{.fragment .retype to="weak"} span) — animate it directly.
      const word = ctx.attr('word');
      let host;
      if (word) {
        const hits = S.wrapMatches(ctx.el, word, 'fx-hit');
        if (!hits.length) return;
        host = hits[0];
      } else {
        host = ctx.el;
      }
      const text = word || host.textContent;
      host.dataset.fxWord = text;
      host.dataset.fxTo = to;
      runRetype(ctx, host, text, to, ctx.num('speed', 42));
    },
    hide(ctx) {
      const host = ctx.el.classList.contains('fx-hit')
        ? ctx.el
        : ctx.el.querySelector('.fx-hit') || ctx.el;
      const from = host.dataset.fxTo;
      const into = host.dataset.fxWord;
      if (from == null || into == null) { S.teardown(ctx.el); return; }
      runRetype(ctx, host, from, into, ctx.num('speed', 42), () => S.teardown(ctx.el));
    },
  });

  // ── .nudge ────────────────────────────────────────────────────────────────
  // A cursor shifts something a few px, then fusses over it again. A joke
  // about fine control being the whole problem.

  S.define('nudge', {
    show(ctx) {
      const el = ctx.el;
      const c = ctx.box();
      const grab = S.grabPoint(c);
      const cursor = ctx.cursor();
      const by = ctx.pair('by', { x: 18, y: 0 });

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), grab, 0);
      let t = S.squeeze(tl, el, 580);

      tl.add({ targets: el, translateX: by.x, translateY: by.y,
               duration: 420, easing: 'easeInOutQuad' }, t);
      tl.add({ targets: cursor, translateX: grab.x + by.x, translateY: grab.y + by.y,
               duration: 420, easing: 'easeInOutQuad' }, t);
      t += 520;

      // second thoughts: back part of the way
      const half = { x: Math.round(by.x * 0.35), y: Math.round(by.y * 0.35) };
      tl.add({ targets: el, translateX: half.x, translateY: half.y,
               duration: 380, easing: 'easeInOutQuad' }, t);
      tl.add({ targets: cursor, translateX: grab.x + half.x, translateY: grab.y + half.y,
               duration: 380, easing: 'easeInOutQuad' }, t);
      t += 470;

      S.flyOut(tl, cursor, entry, t);
    },
  });

  // ── .paste-in ─────────────────────────────────────────────────────────────
  // A cursor moves to where the content belongs, the shortcut badge appears at
  // the cursor, and the content pops in. Faster than a drag when there are
  // several to get through.

  S.define('paste-in', {
    show(ctx) {
      const el = ctx.el;
      const c = ctx.box();

      // The insertion point: the start of the element, where a caret would be.
      const at = { x: c.x + 14, y: c.y + Math.min(c.h * 0.5, 40) };
      const cursor = ctx.cursor();

      // Badge sits just above the cursor's tip, so the shortcut reads as being
      // pressed at that spot rather than floating over the element.
      const badge = ctx.chrome('badge', 'fx-badge', ctx.attr('badge') || '⌘V');
      badge.style.width = '';
      badge.style.height = '';
      S.placeAt(badge, at.x + 12, at.y - 44);

      anime.set(badge, { opacity: 0, scale: 0.85 });
      anime.set(el, { opacity: 0, scale: 0.84 });

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), at, 0);
      tl.add({ targets: badge, opacity: 1, scale: 1,
               duration: 240, easing: 'easeOutBack' }, 600);
      tl.add({ targets: el, opacity: 1, scale: 1,
               duration: 420, easing: 'easeOutQuad' }, 800);
      tl.add({ targets: badge, opacity: 0, duration: 300, easing: 'easeInQuad' }, 1260);
      S.flyOut(tl, cursor, entry, 1360);
    },
  });

  // ── .approve ──────────────────────────────────────────────────────────────
  // Someone else's cursor arrives and reacts to what you placed.

  S.define('approve', {
    show(ctx) {
      const c = ctx.box();
      const mark = ctx.attr('mark') || '✓';
      const badge = ctx.chrome('badge', 'fx-badge fx-badge--approve', mark);
      badge.style.width = '';
      badge.style.height = '';
      const bx = Math.min(c.right + 16, S.SLIDE_W - 90);
      S.placeAt(badge, bx, c.y + c.h * 0.5 - 18);

      const cursor = ctx.cursor();
      anime.set(badge, { opacity: 0, scale: 0.7 });

      const tl = ctx.tl();
      const at = { x: bx + 6, y: c.y + c.h * 0.5 + 6 };
      const entry = S.flyIn(tl, cursor, ctx.from() || 'right', at, 0);
      tl.add({ targets: badge, opacity: 1, scale: 1,
               duration: 420, easing: 'easeOutBack' }, 600);
      S.flyOut(tl, cursor, entry, 1180);
    },
  });

  // ── .cursor-idle ──────────────────────────────────────────────────────────
  // Named cursors linger and drift instead of leaving, so the slide feels
  // inhabited. Loops until the fragment is hidden.

  S.define('cursor-idle', {
    show(ctx) {
      const names = ctx.list('cursors');
      const n = names.length || Math.max(1, ctx.num('count', 3));
      let running = true;
      S.onStop(ctx.el, () => { running = false; });

      const spot = () => ({
        x: 90 + Math.random() * (S.SLIDE_W - 300),
        y: 90 + Math.random() * (S.SLIDE_H - 240),
      });

      for (let i = 0; i < n; i++) {
        const cur = ctx.cursor('idle-' + i, names[i] || null, null);
        const p = spot();
        anime.set(cur, { translateX: p.x, translateY: p.y, opacity: 0 });
        anime({ targets: cur, opacity: 1, duration: 420, easing: 'easeOutQuad',
                delay: i * 120 });
        (function drift() {
          if (!running) return;
          const q = spot();
          anime({ targets: cur, translateX: q.x, translateY: q.y,
                  duration: 2600 + Math.random() * 2400, easing: 'easeInOutSine',
                  complete: drift });
        })();
      }
    },
  });

  // ── .race-in ──────────────────────────────────────────────────────────────
  // Everything arrives at once from different edges, each with its own cursor.

  S.define('race-in', {
    show(ctx) {
      const items = S.lines(ctx.el);
      if (!items.length) return;

      const names = ctx.list('cursors');
      const stagger = ctx.num('stagger', 170);
      const dur = ctx.num('duration', 820);
      const edges = ['left', 'right', 'top', 'bottom'];

      const tl = ctx.tl();
      items.forEach((it, i) => {
        const name = names.length ? names[i % names.length] : null;
        const cur = ctx.cursor('race-' + i, name, null);
        haulIn(ctx, it, edges[i % edges.length], tl, i * stagger, dur, cur);
      });
    },
  });

  // ── .resize ───────────────────────────────────────────────────────────────
  // Already on the slide at the wrong size; a cursor drags the corner handle
  // to fix it. Nothing arrives from offscreen, so it is not a "-in" style.
  //
  // The shrink to `from-width` has to happen before the fragment ever fires,
  // or the pre-fire CSS override (which keeps it visible) shows it at its
  // full declared size, and firing the fragment then has to snap it down to
  // `from-width` before the drag can grow it back — a visible jump. So every
  // `.resize` image is pre-shrunk once, right after the page loads, using its
  // declared `width` attribute rather than `offsetWidth`: at that point most
  // slides are still `display: none` (Reveal only lays out the current one),
  // so a live measurement would read 0.
  function initResizeImages() {
    document.querySelectorAll('.resize').forEach((el) => {
      if (el.dataset.fxFinalW) return;
      const declared = parseInt(el.getAttribute('width'), 10);
      const finalW = declared || el.offsetWidth;
      if (!finalW) return;
      const startW = S.num(el, 'from-width', Math.round(finalW * 0.55));
      el.dataset.fxFinalW = finalW;
      el.style.width = startW + 'px';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initResizeImages);
  } else {
    initResizeImages();
  }

  S.define('resize', {
    show(ctx) {
      const el = ctx.el;
      const section = ctx.section;
      const finalW = Number(el.dataset.fxFinalW) || el.offsetWidth;
      const startW = ctx.num('from-width', Math.round(finalW * 0.55));
      el.style.width = startW + 'px';

      const c0 = ctx.box();
      const handles = ctx.chrome('handles', 'fx-handles');
      S.placeOver(handles, c0);
      const cursor = ctx.cursor();

      const tl = ctx.tl();
      const at = { x: c0.right, y: c0.bottom };
      const entry = S.flyIn(tl, cursor, ctx.from() || 'right', at, 0);

      const st = { w: startW };
      tl.add({ targets: st, w: finalW, duration: 860, easing: 'easeInOutQuad',
               update: () => {
                 el.style.width = Math.round(st.w) + 'px';
                 const c = S.posIn(el, section);
                 S.placeOver(handles, c);
                 anime.set(cursor, { translateX: c.right, translateY: c.bottom });
               } }, 620);

      tl.add({ targets: handles, opacity: 0, duration: 300, easing: 'easeOutQuad' }, 1560);
      S.flyOut(tl, cursor, entry, 1560);
    },
  });

  // ── .crop ─────────────────────────────────────────────────────────────────
  // A cursor drags a crop edge inward. clip-path cannot be tweened directly,
  // so the inset percentages are animated on a plain object and applied.

  S.define('crop', {
    show(ctx) {
      const el = ctx.el;
      const target = (ctx.attr('inset') || '0 22 0 0')
        .split(/[\s,]+/).map(v => parseFloat(v) || 0);
      const [t2, r2, b2, l2] = target;

      const c0 = ctx.box();
      const frame = ctx.chrome('frame', 'fx-crop-frame');
      const cursor = ctx.cursor();
      const st = { t: 0, r: 0, b: 0, l: 0 };

      const apply = () => {
        el.style.clipPath = `inset(${st.t}% ${st.r}% ${st.b}% ${st.l}%)`;
        const box = {
          x: c0.x + c0.w * st.l / 100,
          y: c0.y + c0.h * st.t / 100,
          w: c0.w * (1 - (st.l + st.r) / 100),
          h: c0.h * (1 - (st.t + st.b) / 100),
        };
        S.placeOver(frame, box);
        anime.set(cursor, { translateX: box.x + box.w, translateY: box.y + box.h * 0.5 });
      };
      apply();

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, 'right', { x: c0.right, y: c0.y + c0.h * 0.5 }, 0);
      tl.add({ targets: st, t: t2, r: r2, b: b2, l: l2,
               duration: 900, easing: 'easeInOutQuad', update: apply }, 620);
      tl.add({ targets: frame, opacity: 0, duration: 320, easing: 'easeOutQuad' }, 1620);
      S.flyOut(tl, cursor, entry, 1620);
    },
  });

  // ── .rotate-handle ────────────────────────────────────────────────────────

  S.define('rotate-handle', {
    show(ctx) {
      const el = ctx.el;
      const angle = ctx.num('angle', -6);
      const c = ctx.box();
      const knob = ctx.chrome('knob', 'fx-knob');
      const badge = ctx.chrome('badge', 'fx-badge fx-badge--angle', '0°');
      badge.style.width = '';
      badge.style.height = '';

      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const radius = c.h / 2 + 44;

      const place = (a) => {
        const rad = (a - 90) * Math.PI / 180;
        const p = { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
        S.placeAt(knob, p.x - 7, p.y - 7);
        S.placeAt(badge, p.x + 16, p.y - 12);
        return p;
      };

      const st = { a: 0 };
      const p0 = place(0);
      const cursor = ctx.cursor();

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, 'top', p0, 0);
      tl.add({ targets: st, a: angle, duration: 860, easing: 'easeInOutQuad',
               update: () => {
                 anime.set(el, { rotate: st.a });
                 const p = place(st.a);
                 badge.textContent = Math.round(st.a) + '°';
                 anime.set(cursor, { translateX: p.x, translateY: p.y });
               } }, 600);
      tl.add({ targets: [knob, badge], opacity: 0, duration: 300, easing: 'easeOutQuad' }, 1560);
      S.flyOut(tl, cursor, entry, 1560);
    },
  });

  // ── .add-item ─────────────────────────────────────────────────────────────
  // A cursor appends a new entry to a list and types it out. The counterpart
  // to `.delete-items`: the list grows a row that was never in the markup.
  //
  //   ::: {.fragment .add-item for="#cons" text="we are all alone"}
  //   :::

  S.define('add-item', {
    show(ctx) {
      const text = ctx.attr('text');
      if (!text) return;

      const list = ctx.el.querySelector('ul, ol') || ctx.el;
      const items = S.lines(list);
      const last = items[items.length - 1];

      // Clone the last entry so the new one inherits its markup and styling,
      // then empty it: measuring it full gives the height the slot opens to.
      const row = last ? last.cloneNode(false) : document.createElement('li');
      row.textContent = text;
      list.appendChild(row);
      const open = row.offsetHeight + 'px';
      const mb = getComputedStyle(row).marginBottom;
      row.textContent = '';
      row.style.overflow = 'hidden';
      row.style.boxSizing = 'border-box';
      row.style.height = '0px';
      row.style.marginBottom = '0px';

      const cursor = ctx.cursor();
      const tl = ctx.tl();

      // Aim at where the row will be, which is the bottom of the list as it
      // stands: the slot opens downward from there.
      const c = S.posIn(list, ctx.section);
      const at = { x: c.x + 24, y: c.y + c.h + 8 };
      const entry = S.flyIn(tl, cursor, ctx.from(), at, 0);

      tl.add({ targets: row, height: open, marginBottom: mb,
               duration: 320, easing: 'easeOutQuad' }, 600);

      let t = 940;
      t += S.typeInto(tl, {
        section: ctx.section, host: row, text, cursor,
        offset: t, speed: ctx.num('speed', 55),
      });

      tl.add({ targets: row, opacity: [1, 1], duration: 1, easing: 'linear',
               begin: () => { row.style.height = ''; row.style.overflow = ''; } }, t);

      S.flyOut(tl, cursor, entry, t + 240);
    },
  });

  // ── .marquee-select ───────────────────────────────────────────────────────

  S.define('marquee-select', {
    show(ctx) {
      const items = S.lines(ctx.el);
      if (!items.length) return;

      const c = ctx.box();
      const rect = ctx.chrome('marquee', 'fx-marquee');
      const pad = 10;
      const box = { x: c.x - pad, y: c.y - pad, w: c.w + pad * 2, h: c.h + pad * 2 };
      S.placeAt(rect, box.x, box.y);

      const st = { w: 0, h: 0 };
      const apply = () => {
        rect.style.width = st.w + 'px';
        rect.style.height = st.h + 'px';
      };
      apply();

      const cursor = ctx.cursor();
      const by = ctx.pair('by', { x: 70, y: 0 });

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), { x: box.x, y: box.y }, 0);

      tl.add({ targets: st, w: box.w, h: box.h, duration: 620, easing: 'easeOutQuad',
               update: () => {
                 apply();
                 anime.set(cursor, { translateX: box.x + st.w, translateY: box.y + st.h });
               } }, 600);

      tl.add({ targets: rect, opacity: [1, 1], duration: 1, easing: 'linear',
               begin: () => items.forEach(i => i.classList.add('fx-selected')) }, 1240);

      tl.add({ targets: items, translateX: by.x, translateY: by.y,
               duration: 520, easing: 'easeInOutQuad' }, 1420);
      tl.add({ targets: rect, translateX: by.x, translateY: by.y,
               duration: 520, easing: 'easeInOutQuad' }, 1420);
      tl.add({ targets: cursor, translateX: box.x + box.w + by.x,
               translateY: box.y + box.h + by.y,
               duration: 520, easing: 'easeInOutQuad' }, 1420);

      tl.add({ targets: rect, opacity: 0, duration: 300, easing: 'easeOutQuad' }, 2000);
      S.flyOut(tl, cursor, entry, 2000);
    },
  });

  // ── .delete-items ─────────────────────────────────────────────────────────
  // A cursor drags a selection over several entries in a list and deletes
  // them; the list closes up around the survivors. `keep` names the entries
  // that stay, `items` the ones that go — give one or the other.
  //
  //   ::: {.fragment .delete-items for="#cons" keep="6"}
  //   :::

  S.define('delete-items', {
    show(ctx) {
      const list = ctx.el.querySelector('ul, ol') || ctx.el;
      const items = S.lines(list);
      if (!items.length) return;

      const nums = (n) => ctx.list(n).map(Number).filter((v) => v >= 1);
      const pick = nums('items');
      const keep = nums('keep');
      const doomed = items.filter((_, i) => (pick.length ? pick.includes(i + 1)
                                                         : !keep.includes(i + 1)));
      if (!doomed.length) return;

      // Bounding box of everything being removed, so one sweep covers the lot
      // even when the doomed entries are not contiguous.
      const boxes = doomed.map((el) => S.posIn(el, ctx.section));
      const pad = 8;
      const x = Math.min(...boxes.map(b => b.x)) - pad;
      const y = Math.min(...boxes.map(b => b.y)) - pad;
      const w = Math.max(...boxes.map(b => b.x + b.w)) - x + pad;
      const h = Math.max(...boxes.map(b => b.y + b.h)) - y + pad;

      const rect = ctx.chrome('marquee', 'fx-marquee');
      S.placeAt(rect, x, y);
      const st = { w: 0, h: 0 };
      const apply = () => { rect.style.width = st.w + 'px'; rect.style.height = st.h + 'px'; };
      apply();

      const badge = ctx.chrome('badge', 'fx-badge', ctx.attr('badge') || '⌫');
      badge.style.width = '';
      badge.style.height = '';
      S.placeAt(badge, x + w + 16, y + h - 20);
      anime.set(badge, { opacity: 0, scale: 0.85 });

      const cursor = ctx.cursor();
      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), { x, y }, 0);

      // drag the selection open, cursor pinned to the trailing corner
      tl.add({ targets: st, w, h, duration: 620, easing: 'easeOutQuad',
               update: () => {
                 apply();
                 anime.set(cursor, { translateX: x + st.w, translateY: y + st.h });
               } }, 600);

      tl.add({ targets: rect, opacity: [1, 1], duration: 1, easing: 'linear',
               begin: () => doomed.forEach(el => el.classList.add('fx-selected')) }, 1240);

      tl.add({ targets: badge, opacity: 1, scale: 1,
               duration: 220, easing: 'easeOutBack' }, 1340);

      // The entries collapse their own height, so the survivors reflow upward
      // on their own rather than needing transforms of their own.
      tl.add({ targets: doomed, opacity: 0, duration: 240, easing: 'easeInQuad',
               begin: () => doomed.forEach((el) => {
                 el.style.overflow = 'hidden';
                 el.style.boxSizing = 'border-box';
                 el.style.height = el.offsetHeight + 'px';
               }) }, 1560);

      tl.add({ targets: doomed, height: 0, marginTop: 0, marginBottom: 0,
               paddingTop: 0, paddingBottom: 0,
               duration: 480, easing: 'easeInOutQuad',
               delay: anime.stagger(40) }, 1660);

      tl.add({ targets: rect, opacity: 0, duration: 240, easing: 'easeOutQuad' }, 1660);
      tl.add({ targets: badge, opacity: 0, duration: 240, easing: 'easeInQuad' }, 1760);
      S.flyOut(tl, cursor, entry, 1860);
    },
  });

  // ── .reorder ──────────────────────────────────────────────────────────────
  // A cursor drags one item up the list and the others move aside. Visual
  // only: the DOM order is untouched, and the transforms are reset on hide.

  S.define('reorder', {
    show(ctx) {
      const items = S.lines(ctx.el);
      const fromI = Math.max(1, ctx.num('item', items.length)) - 1;
      const toI = Math.max(1, ctx.num('to', 1)) - 1;
      if (!items[fromI] || !items[toI] || fromI === toI) return;

      const moving = items[fromI];
      // offsetHeight alone omits the gap list items sit in (margin-bottom),
      // so a moved item would land short and overlap its new neighbor.
      const h = items.map(i => i.offsetHeight + (parseFloat(getComputedStyle(i).marginBottom) || 0));

      let dist = 0;
      const others = [];
      if (toI > fromI) {
        for (let k = fromI + 1; k <= toI; k++) { dist += h[k]; others.push(items[k]); }
      } else {
        for (let k = toI; k < fromI; k++) { dist -= h[k]; others.push(items[k]); }
      }
      const shift = h[fromI] * (toI > fromI ? -1 : 1);

      const mc = S.posIn(moving, ctx.section);
      const grab = S.grabPoint(mc);
      const cursor = ctx.cursor();

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), grab, 0);
      let t = S.squeeze(tl, moving, 580);

      // Lifted above the others for the length of the travel, so it reads as
      // one row passing over another rather than raw overlapping text.
      tl.add({ targets: moving, opacity: [1, 1], duration: 1, easing: 'linear',
               begin: () => moving.classList.add('fx-reorder-lifted') }, t);
      tl.add({ targets: moving, translateY: dist, duration: 700,
               easing: 'easeInOutQuad' }, t);
      tl.add({ targets: cursor, translateY: grab.y + dist, duration: 700,
               easing: 'easeInOutQuad' }, t);
      tl.add({ targets: others, translateY: shift, duration: 700,
               easing: 'easeInOutQuad', delay: anime.stagger(40) }, t);
      tl.add({ targets: moving, opacity: [1, 1], duration: 1, easing: 'linear',
               begin: () => moving.classList.remove('fx-reorder-lifted') }, t + 760);

      S.flyOut(tl, cursor, entry, t + 820);
    },
  });

  // ── .duplicate ────────────────────────────────────────────────────────────
  // Option-drag, repeatedly, until a single plot has become a facet grid.

  S.define('duplicate', {
    show(ctx) {
      const el = ctx.el;
      const times = Math.max(1, ctx.num('times', 3));
      const gap = ctx.num('gap', 20);
      const c = ctx.box();
      const grab = S.grabPoint(c);
      const cursor = ctx.cursor();

      const perRow = Math.max(1, Math.floor((S.SLIDE_W - c.x - 20) / (c.w + gap)));

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), grab, 0);
      let t = 580;

      for (let i = 1; i <= times; i++) {
        const clone = ctx.chrome('clone-' + i, 'fx-clone');
        // `el.innerHTML` is empty when `el` is the image itself rather than a
        // wrapper around one (e.g. `.fragment .duplicate` on an `<img>`
        // directly), so clone the element's own markup instead. The clone
        // carries over the `fragment` class from `el`'s outerHTML, which
        // Reveal would otherwise hide forever (it never marks an untracked
        // clone `.visible`), so that class is stripped once copied in.
        clone.innerHTML = el.outerHTML;
        const inner = clone.firstElementChild;
        if (inner) inner.className = '';
        S.placeAt(clone, c.x, c.y);
        clone.style.width = c.w + 'px';
        clone.style.height = '';

        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const dx = col * (c.w + gap);
        const dy = row * (c.h + gap);

        anime.set(clone, { translateX: 0, translateY: 0, opacity: 0, scale: 0.98 });
        tl.add({ targets: clone, opacity: 1, duration: 140, easing: 'linear' }, t);
        tl.add({ targets: clone, translateX: dx, translateY: dy, scale: 1,
                 duration: 560, easing: 'easeOutQuad' }, t);
        tl.add({ targets: cursor, translateX: grab.x + dx, translateY: grab.y + dy,
                 duration: 560, easing: 'easeOutQuad' }, t);
        t += 640;
      }

      S.flyOut(tl, cursor, entry, t);
    },
  });

  // ── .diff-in ──────────────────────────────────────────────────────────────
  // Old text struck through, new text in green, then it settles to just new.

  S.define('diff-in', {
    show(ctx) {
      const el = ctx.el;
      const to = ctx.attr('to');
      if (!to) return;

      // Matches .retype's interface: el's own text is the starting ("was")
      // value, shown as-is before the fragment fires; `to` is what it becomes.
      const was = el._fxText || el.textContent.trim();
      el.dataset.fxWas = was;
      el.dataset.fxTo = to;
      const del = document.createElement('span');
      del.className = 'fx-del';
      del.textContent = was;
      const strike = document.createElement('span');
      strike.className = 'fx-strike';
      del.appendChild(strike);
      const ins = document.createElement('span');
      ins.className = 'fx-ins';
      ins.textContent = to;

      const sep = document.createTextNode(' ');
      el.innerHTML = '';
      el.appendChild(del);
      el.appendChild(sep);
      el.appendChild(ins);

      anime.set(del, { opacity: 0 });
      anime.set(strike, { scaleX: 0 });
      anime.set(ins, { opacity: 0, translateY: 8 });

      const tl = ctx.tl();
      // del fades in, then the strike line draws across it left to right
      tl.add({ targets: del, opacity: 1, duration: 220, easing: 'easeOutQuad' }, 0);
      tl.add({ targets: strike, scaleX: 1, duration: 380, easing: 'easeInOutQuad' }, 260);
      // ins appears right next to del while del is still on screen, struck through
      tl.add({ targets: ins, opacity: 1, translateY: 0, duration: 360, easing: 'easeOutQuad' }, 700);
      // del fades away and is removed; capture the gap it leaves so ins can
      // visibly slide into the space rather than snapping to its new layout position.
      // This has to be a fresh anime() instance rather than a tl.add() queued up
      // front: a timeline tween resolves its start value at build time, long before
      // the gap left by del is known, so a pre-added translateX tween would just
      // animate 0 -> 0 and the anime.set() jump would look like a snap.
      tl.add({ targets: del, opacity: 0, duration: 320, easing: 'easeInQuad',
               complete: () => {
                 if (!del.isConnected) { settle(); return; }
                 const before = ins.getBoundingClientRect();
                 del.remove();
                 sep.remove();
                 const after = ins.getBoundingClientRect();
                 const dx = before.left - after.left;
                 if (!dx) { settle(); return; }
                 // A plain CSS transition rather than a JS-driven anime tween: the
                 // browser can run this on the compositor, which reads smoother
                 // than a per-frame anime tick for a single transform property.
                 // The jump to translateX(dx) and the transition-start both need
                 // to land in the DOM before the next paint but after a forced
                 // reflow, or the browser coalesces them and nothing animates —
                 // hence set + reflow + rAF before flipping to the end value.
                 ins.style.transition = 'none';
                 ins.style.transform = `translateX(${dx}px)`;
                 void ins.offsetWidth;
                 requestAnimationFrame(() => {
                   ins.style.transition = 'transform 420ms cubic-bezier(.45,0,.2,1)';
                   ins.style.transform = 'translateX(0px)';
                 });
                 ins.addEventListener('transitionend', function onEnd(e) {
                   if (e.propertyName !== 'transform') return;
                   ins.removeEventListener('transitionend', onEnd);
                   ins.style.transition = '';
                   settle();
                 });
               } }, 1300);

      function settle() {
        setTimeout(() => { ins.className = 'fx-ins fx-ins--settled'; }, 300);
      }
    },
    // The forward run ends with a lot of manual DOM surgery (del and its
    // separating space removed, ins's position corrected via a raw CSS
    // transition) that a generic `tl.reverse()` has no way to undo, so this
    // rebuilds del from scratch and plays the same beats back to front.
    hide(ctx) {
      const el = ctx.el;
      const was = el.dataset.fxWas;
      const to = el.dataset.fxTo;
      const ins = el.querySelector('.fx-ins');
      if (was == null || to == null || !ins) { S.teardown(el); return; }

      const del = document.createElement('span');
      del.className = 'fx-del';
      del.textContent = was;
      const strike = document.createElement('span');
      strike.className = 'fx-strike';
      del.appendChild(strike);
      const sep = document.createTextNode(' ');

      anime.set(del, { opacity: 0 });
      anime.set(strike, { scaleX: 1 });

      // Reinsert del + sep ahead of ins, then compensate for the reflow the
      // same way the forward run does, so ins doesn't jump before the slide
      // carries it back into place next to the reborn del.
      const before = ins.getBoundingClientRect();
      el.insertBefore(sep, ins);
      el.insertBefore(del, sep);
      const after = ins.getBoundingClientRect();
      const dx = before.left - after.left;
      ins.style.transition = 'none';
      ins.style.transform = dx ? `translateX(${dx}px)` : '';
      void ins.offsetWidth;

      // undo the color settle first, mirroring the forward run's last step
      ins.classList.remove('fx-ins--settled');

      requestAnimationFrame(() => {
        ins.style.transition = 'transform 420ms cubic-bezier(.45,0,.2,1)';
        ins.style.transform = 'translateX(0px)';
      });

      const tl = ctx.tl();
      tl.add({ targets: del, opacity: 1, duration: 320, easing: 'easeOutQuad' }, 300);
      tl.add({ targets: ins, opacity: 0, duration: 360, easing: 'easeInQuad' }, 780);
      tl.add({ targets: strike, scaleX: 0, duration: 380, easing: 'easeInOutQuad' }, 1160);
      tl.add({ targets: del, opacity: 0, duration: 220, easing: 'easeInQuad',
               complete: () => S.teardown(el) }, 1560);
    },
  });

  // ── .undo ─────────────────────────────────────────────────────────────────
  // Something visibly wrong, then the shortcut, then it snaps back.

  S.define('undo', {
    show(ctx) {
      const el = ctx.el;
      const c = ctx.box();
      const grab = S.grabPoint(c);
      const by = ctx.pair('by', { x: 90, y: 28 });
      const cursor = ctx.cursor();

      const badge = ctx.chrome('badge', 'fx-badge', ctx.attr('badge') || '⌘Z');
      badge.style.width = '';
      badge.style.height = '';
      S.placeAt(badge, c.x + c.w * 0.5 - 24, c.y - 46);
      anime.set(badge, { opacity: 0, scale: 0.85 });

      const tl = ctx.tl();
      const entry = S.flyIn(tl, cursor, ctx.from(), grab, 0);
      let t = S.squeeze(tl, el, 580);

      tl.add({ targets: el, translateX: by.x, translateY: by.y, rotate: ctx.num('tilt', 3),
               duration: 520, easing: 'easeOutQuad' }, t);
      tl.add({ targets: cursor, translateX: grab.x + by.x, translateY: grab.y + by.y,
               duration: 520, easing: 'easeOutQuad' }, t);
      t += 740;

      tl.add({ targets: badge, opacity: 1, scale: 1, duration: 220, easing: 'easeOutBack' }, t);
      tl.add({ targets: el, translateX: 0, translateY: 0, rotate: 0,
               duration: 440, easing: 'easeOutQuad' }, t + 140);
      tl.add({ targets: cursor, translateX: grab.x, translateY: grab.y,
               duration: 440, easing: 'easeOutQuad' }, t + 140);
      tl.add({ targets: badge, opacity: 0, duration: 280, easing: 'easeInQuad' }, t + 700);

      S.flyOut(tl, cursor, entry, t + 820);
    },
  });

  // ── .comment ──────────────────────────────────────────────────────────────

  // Anchors to the last word of `root`'s text, so the arrow points at what was
  // actually said rather than the whole block. Falls back to `root` itself
  // when there is no plain text to grab (e.g. an image-only element).
  function lastWordSpan(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let last = null;
    while ((node = walker.nextNode())) {
      if (node.data.trim()) last = node;
    }
    if (!last) return root;

    const m = /\S+\s*$/.exec(last.data);
    if (!m) return root;

    const start = last.splitText(m.index);
    const span = document.createElement('span');
    span.className = 'fx-comment-anchor';
    span.textContent = start.data;
    start.replaceWith(span);
    return span;
  }

  S.define('comment', {
    show(ctx) {
      const anchor = lastWordSpan(ctx.el);
      const c = S.posIn(anchor, ctx.section);
      // No `cursor` name means an anonymous comment: bare arrow, and the
      // bubble drops its author line rather than inventing a collaborator.
      const author = ctx.attr('cursor');
      const text = ctx.attr('text') || 'Can we tighten this?';
      const bubble = ctx.chrome('bubble', 'fx-comment',
        (author ? `<span class="fx-comment-author">${author}</span>` : '') +
        `<span class="fx-comment-text">${text}</span>`);
      bubble.style.width = '';
      bubble.style.height = '';

      const bx = Math.min(c.right + 24, S.SLIDE_W - 300);
      S.placeAt(bubble, bx, Math.max(8, c.y - 8));

      const cursor = ctx.cursor();
      anime.set(bubble, { opacity: 0, scale: 0.9 });

      const tl = ctx.tl();
      const at = { x: bx - 16, y: c.y + 18 };
      const entry = S.flyIn(tl, cursor, ctx.from() || 'right', at, 0);
      tl.add({ targets: bubble, opacity: 1, scale: 1,
               duration: 400, easing: 'easeOutBack' }, 580);
      S.flyOut(tl, cursor, entry, 1240);
    },
  });

  // ── .argue ────────────────────────────────────────────────────────────────
  // Two cursors drag the same thing in opposite directions. One wins.

  S.define('argue', {
    show(ctx) {
      const el = ctx.el;
      const c = ctx.box();
      const names = ctx.list('cursors');
      // Names are optional: an unnamed cursor is a bare arrow. `names[0]` is
      // left undefined when absent so a lone `cursor="Kari"` still labels the
      // first arguer, while the second stays explicitly bare rather than
      // picking up the same name.
      const left = ctx.cursor('a', names[0], null);
      const right = ctx.cursor('b', names.length > 1 ? names[1] : null, null);
      const amp = ctx.num('amp', 46);

      const lg = { x: c.x + 30, y: c.y + c.h * 0.5 };
      const rg = { x: c.right - 30, y: c.y + c.h * 0.5 };

      const tl = ctx.tl();
      const le = S.flyIn(tl, left, 'left', lg, 0);
      const re = S.flyIn(tl, right, 'right', rg, 120);

      let t = 720;
      [-amp, amp * 0.9, -amp * 0.7, amp * 0.55, -amp * 0.35].forEach((p) => {
        const d = 300;
        tl.add({ targets: el, translateX: p, duration: d, easing: 'easeInOutQuad' }, t);
        tl.add({ targets: left, translateX: lg.x + p, duration: d, easing: 'easeInOutQuad' }, t);
        tl.add({ targets: right, translateX: rg.x + p, duration: d, easing: 'easeInOutQuad' }, t);
        t += d;
      });

      const rightWins = (ctx.attr('winner') || 'left') === 'right';
      const finalX = rightWins ? amp * 1.15 : -amp * 1.15;
      tl.add({ targets: el, translateX: finalX, duration: 440, easing: 'easeOutQuad' }, t);
      tl.add({ targets: left, translateX: lg.x + finalX, duration: 440, easing: 'easeOutQuad' }, t);
      tl.add({ targets: right, translateX: rg.x + finalX, duration: 440, easing: 'easeOutQuad' }, t);
      t += 540;

      S.flyOut(tl, rightWins ? left : right, rightWins ? le : re, t);
      S.flyOut(tl, rightWins ? right : left, rightWins ? re : le, t + 340);
    },
  });

  // ── .drag-from-folder ─────────────────────────────────────────────────────
  // A folder window opens, a cursor drags a thumbnail out of it, and the drop
  // becomes the real image. The gesture the audience already knows.

  S.define('drag-from-folder', {
    show(ctx) {
      const el = ctx.el;
      const section = ctx.section;
      const img = el.tagName === 'IMG' ? el : el.querySelector('img');
      const src = ctx.attr('src') || (img ? img.getAttribute('src') : null);

      const files = ctx.list('files');
      const names = files.length ? files : ['plot.png', 'lizard.gif', 'logo.svg'];
      const pick = Math.min(Math.max(1, ctx.num('pick', 2)) - 1, names.length - 1);

      const c = ctx.box();
      anime.set(el, { opacity: 0 });

      const items = names.map((n, i) => {
        const bg = src && i === pick ? ` style="background-image:url(${src})"` : '';
        return `<div class="fx-folder-item${i === pick ? ' fx-folder-item--pick' : ''}">
                  <div class="fx-folder-thumb"${bg}></div>
                  <span class="fx-folder-name">${n}</span>
                </div>`;
      }).join('');

      const win = ctx.chrome('folder', 'fx-folder',
        `<div class="fx-folder-bar">
           <span class="fx-dot"></span><span class="fx-dot"></span><span class="fx-dot"></span>
           <span class="fx-folder-title">${ctx.attr('folder') || 'images'}</span>
         </div>
         <div class="fx-folder-body">${items}</div>`);
      win.style.width = '';
      win.style.height = '';
      // Keep the window clear of the slide heading.
      S.placeAt(win, ctx.num('folder-x', 70), ctx.num('folder-y', Math.max(112, c.y - 30)));
      anime.set(win, { opacity: 0, translateY: -26 });

      // The window is already in the DOM and absolutely positioned, so the
      // thumbnail's box can be measured now. It has to be measured now: anime
      // resolves tween values at build time, so deferring this to a callback
      // would leave the ghost animating to a stale origin.
      const thumb = win.querySelectorAll('.fx-folder-item')[pick];
      const tb = S.posIn(thumb, section);

      const ghost = ctx.chrome('ghost', 'fx-ghost');
      if (src) ghost.style.backgroundImage = `url(${src})`;
      S.placeAt(ghost, tb.x, tb.y);
      ghost.style.width = tb.w + 'px';
      ghost.style.height = tb.h + 'px';
      anime.set(ghost, { opacity: 0, translateX: 0, translateY: 0 });

      const cursor = ctx.cursor();
      const grabAt = { x: tb.x + tb.w * 0.5, y: tb.y + tb.h * 0.55 };
      anime.set(cursor, { translateX: grabAt.x, translateY: grabAt.y, opacity: 0 });

      const tl = ctx.tl();
      tl.add({ targets: win, opacity: 1, translateY: 0,
               duration: 440, easing: 'easeOutCubic' }, 0);

      // the cursor arrives at the thumbnail
      tl.add({ targets: cursor, opacity: [0, 1],
               translateX: [grabAt.x - 150, grabAt.x],
               translateY: [grabAt.y + 90, grabAt.y],
               duration: 480, easing: 'easeOutCubic' }, 420);

      // grab, then drag the ghost out of the window and onto the slide
      tl.add({ targets: ghost, opacity: 0.8, duration: 200, easing: 'linear' }, 860);
      tl.add({ targets: ghost, translateX: c.x - tb.x, translateY: c.y - tb.y,
               duration: 900, easing: 'easeInOutQuad' }, 900);
      // The cursor travels exactly the ghost's delta, so it keeps holding the
      // file at the point it grabbed rather than sliding out of its grip.
      tl.add({ targets: cursor,
               translateX: grabAt.x + (c.x - tb.x),
               translateY: grabAt.y + (c.y - tb.y),
               duration: 900, easing: 'easeInOutQuad' }, 900);

      // drop: the ghost grows into the real element's footprint and hands over
      tl.add({ targets: ghost, width: c.w + 'px', height: c.h + 'px', opacity: 0,
               duration: 440, easing: 'easeOutQuad' }, 1840);
      tl.add({ targets: el, opacity: [0, 1], scale: [0.94, 1],
               duration: 440, easing: 'easeOutQuad' }, 1880);
      tl.add({ targets: win, opacity: 0, translateY: -26,
               duration: 440, easing: 'easeInQuad' }, 2160);
      tl.add({ targets: cursor, translateX: c.x - 220, opacity: 0,
               duration: 520, easing: 'easeInQuad' }, 2260);
    },
  });

  // ── .move-item ────────────────────────────────────────────────────────────
  // A cursor lifts one item out of a list and drops it into another list. Built
  // for the pros/cons slide: an entry that used to be a con turns out to be a
  // pro. The source list closes the gap, the destination opens one.
  //
  //   ::: {.fragment .move-item for="#cons" to="#pros" item="3"}
  //   :::
  //
  // With `text`, the item is also rewritten once it lands, so an entry can
  // change its wording along with its column.

  function clearMove(el) {
    const st = el._fxMove;
    if (!st) return;
    if (typeof anime !== 'undefined') {
      anime.remove(st.shifted.concat([st.landed, st.moving]));
    }
    st.shifted.forEach((n) => { n.style.transform = ''; n.style.opacity = ''; });
    st.moving.style.height = '';
    st.moving.style.marginBottom = '';
    st.moving.style.overflow = '';
    st.moving.style.boxSizing = '';
    st.moving.style.opacity = '';
    st.landed.remove();
    el._fxMove = null;
  }

  // One hop of the gesture: a cursor grabs `hold`, a ghost carries it across,
  // and `park` — an element already sitting in the flow at zero opacity — takes
  // over on landing. Both directions are the same motion with the two ends
  // swapped, so forward and reverse share this.
  //
  //   shiftTo   where the entries below the source slot should end up
  //   slotTo    the destination slot's height at rest (opens or closes in step)
  function carryItem(ctx, o) {
    const section = ctx.section;
    const tl = ctx.tl();

    const from = S.posIn(o.hold, section);
    const to = S.posIn(o.park, section);

    const ghost = ctx.chrome('move-ghost', 'fx-move-ghost', o.hold.innerHTML);
    S.placeAt(ghost, from.x, from.y);
    ghost.style.width = from.w + 'px';
    ghost.style.height = '';
    ghost.style.fontSize = getComputedStyle(o.hold).fontSize;
    anime.set(ghost, { opacity: 0, translateX: 0, translateY: 0 });

    const grab = S.grabPoint(from);
    const cursor = ctx.cursor();

    const entry = S.flyIn(tl, cursor, ctx.from(), grab, 0);
    const t = S.squeeze(tl, o.hold, 560);

    // lift: the ghost takes over from the real element
    tl.add({ targets: ghost, opacity: 1, duration: 140, easing: 'linear' }, t);
    tl.add({ targets: o.hold, opacity: 0, duration: 140, easing: 'linear' }, t);

    // carry — the cursor travels the ghost's exact delta so it keeps its grip
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    tl.add({ targets: ghost, translateX: dx, translateY: dy, width: to.w + 'px',
             duration: o.dur, easing: 'easeInOutQuad' }, t + 140);
    tl.add({ targets: cursor, translateX: grab.x + dx, translateY: grab.y + dy,
             duration: o.dur, easing: 'easeInOutQuad' }, t + 140);

    // The destination list reflows while the item is in the air. The source
    // list's siblings need no transform of their own: `altSlot` collapsing (or
    // growing) the moved item's real box already pushes them via normal
    // layout, animated smoothly because it happens one frame at a time.
    tl.add({ targets: o.slot, height: o.slotTo.h, marginBottom: o.slotTo.mb,
             duration: o.dur * 0.7, easing: 'easeInOutQuad' }, t + 200);
    if (o.altSlot) {
      tl.add({ targets: o.altSlot, height: o.altTo.h, marginBottom: o.altTo.mb,
               duration: o.dur * 0.7, easing: 'easeInOutQuad' }, t + 200);
    }

    // drop: the parked element fades up and the ghost bows out
    const land = t + 140 + o.dur;
    tl.add({ targets: ghost, opacity: 0, duration: 200, easing: 'easeOutQuad' }, land);
    tl.add({ targets: o.park, opacity: [0, 1], scale: [0.96, 1], duration: 300,
             easing: 'easeOutQuad', complete: o.onDone }, land);

    let out = land + 240;

    // The item lands, then gets rewritten in place: the same cursor deletes the
    // wording it arrived with and types the wording it deserves in its new home.
    if (o.retext) {
      const old = (o.park.textContent || '').trim();
      let t2 = land + 340;

      // The slot was animated to a measured height with overflow hidden; the
      // replacement wording is a different length, so hand the box back to the
      // layout before touching the text.
      tl.add({ targets: o.park, opacity: 1, duration: 1, begin: () => {
        o.park.style.height = '';
        o.park.style.marginBottom = '';
        o.park.style.overflow = '';
      } }, land + 300);

      t2 += S.deleteFrom(tl, { section, host: o.park, text: old, cursor,
                               offset: t2, speed: 26 });
      t2 += 100;
      t2 += S.typeInto(tl, { section, host: o.park, text: o.retext, cursor,
                             offset: t2, speed: 45 });
      out = t2 + 240;
    }

    S.flyOut(tl, cursor, entry, out);
  }

  S.define('move-item', {
    show(ctx) {
      const section = ctx.section;
      const src = ctx.el;
      clearMove(src);                     // a re-show gets the default teardown,
                                          // which knows nothing about the clone
                                          // we parked in the other list
      const sel = ctx.attr('to');
      const dst = sel && (section.querySelector(sel) || document.querySelector(sel));
      if (!dst) return;

      // Aim at the list itself: a card that also holds a title would otherwise
      // resolve to [title, list] rather than to the entries.
      const items = S.lines(src.querySelector('ul, ol') || src);
      const i = Math.min(Math.max(1, ctx.num('item', items.length)), items.length) - 1;
      const moving = items[i];
      if (!moving) return;

      const dur = ctx.num('duration', 820);

      // Park a real clone in the destination list. It inherits that list's
      // bullet styling — a con arriving as a pro is the whole point — and being
      // in the flow means the landing box can be *measured* rather than guessed.
      const dstList = dst.querySelector('ul, ol') || dst;
      const landed = moving.cloneNode(true);
      dstList.appendChild(landed);

      // Measured at natural size, then collapsed: the slot opens during the
      // carry instead of popping into existence when the fragment fires. Its
      // top does not depend on its own height, so `to` stays valid.
      const open = { h: landed.offsetHeight + 'px',
                     mb: getComputedStyle(landed).marginBottom };
      landed.style.overflow = 'hidden';
      landed.style.boxSizing = 'border-box';   // offsetHeight is a border box
      landed.style.height = '0px';
      landed.style.marginBottom = '0px';
      anime.set(landed, { opacity: 0 });

      // The gap the item leaves behind: everything below it in the source.
      const shifted = items.slice(i + 1);
      const gap = moving.offsetHeight;

      // Measured before it is hidden, so the source slot can be collapsed in
      // step with the destination opening, instead of leaving a dead gap the
      // size of the moved item behind in the source list.
      const movingOpen = { h: moving.offsetHeight + 'px',
                            mb: getComputedStyle(moving).marginBottom };
      moving.style.overflow = 'hidden';
      moving.style.boxSizing = 'border-box';

      src._fxMove = { moving, landed, shifted, gap, dur, open, movingOpen };

      carryItem(ctx, {
        hold: moving, park: landed, shifted, shiftTo: -gap,
        slot: landed, slotTo: open,
        altSlot: moving, altTo: { h: '0px', mb: '0px' },
        dur, retext: ctx.attr('text'),
      });
    },

    // Stepping back re-runs the gesture the other way: the cursor comes back
    // for the item and carries it home. `reverse="off"` snaps instead.
    hide(ctx) {
      const st = ctx.el._fxMove;
      const done = () => { clearMove(ctx.el); S.teardown(ctx.el); };
      if (!st || typeof anime === 'undefined' || ctx.attr('reverse') === 'off') {
        done();
        return;
      }

      // Cancel the forward timeline but keep the markup as it stands: the
      // reverse starts from wherever the item actually is, and the default
      // teardown would restore the source list out from under it.
      S.stop(ctx.el);

      carryItem(ctx, {
        hold: st.landed, park: st.moving, shifted: st.shifted, shiftTo: 0,
        slot: st.landed, slotTo: { h: '0px', mb: '0px' },
        altSlot: st.moving, altTo: st.movingOpen,
        dur: st.dur,
        onDone: done,
      });
    },
  });
})();
