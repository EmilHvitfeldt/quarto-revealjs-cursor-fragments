# Cursor Fragments

Cursor-driven RevealJS fragment animations for Quarto. Mark a fragment with a class like `.nudge` or `.drag-from-folder`, add a few attributes, and it animates as if a named collaborator's cursor were doing the edit live.

## Install

```bash
quarto add EmilHvitfeldt/quarto-revealjs-cursor-fragments
```

Then in a revealjs document's YAML:

```yaml
format:
  revealjs:
    revealjs-plugins:
      - cursor-fragments
```

See `gallery.qmd` for a full demo of every style, or preview it with:

```bash
quarto preview gallery.qmd
```

## Styles

Every style is a `.fragment` with a marker class. Attributes need no `data-` prefix; Quarto rewrites them and CursorFragments reads either spelling. `cursor="Name"` labels the cursor; omit it for a bare, anonymous arrow. `for="#selector"` lets an empty fragment act on content already on screen.

**Text edits**

- **retype** — `for`, `word`, `to`, `cursor`, `speed`: selects a word, deletes it, types the replacement.
- **nudge** — `for`, `by="x,y"`, `cursor`: shifts an element, then partway back.
- **approve** — `for`, `mark`, `cursor`: a checkmark badge lands beside the target.
- **diff-in** — `to`: old text struck through, new text settles in.
- **undo** — `for`, `by="x,y"`, `tilt`, `cursor`: a change is made, then undone with a shortcut badge.

**Annotation**

- **comment** — `for`, `text`, `cursor`: a comment bubble drops in (omit `cursor` for an anonymous note).
- **argue** — `for`, `cursors="A,B"`, `winner`, `amp`: two cursors drag an element back and forth; one wins (omit `cursors` for anonymous ones).

**Lists**

- **race-in** — `cursors`, `stagger`, `duration`: every line arrives from a different edge at once.
- **marquee-select** — `for`, `by="x,y"`, `cursor`: a marquee selects items, then drags them.
- **delete-items** — `for`, `keep` or `items`, `cursor`: a selection sweeps doomed rows away and the list closes up.
- **add-item** — `for`, `text`, `cursor`, `speed`: a new list row opens and types itself in.
- **reorder** — `item`, `to`, `cursor`: one item is dragged to a new position; others shift to make room.
- **move-item** — `for`, `to`, `item`, `text`, `cursor`: an item is carried from one list to another, optionally reworded on arrival; stepping back reverses the carry.

**Images**

- **paste-in** — `badge`: a shortcut badge pops and the content appears.
- **resize** — `from-width`, `cursor`: a corner-handle drag resizes an image up to size.
- **crop** — `inset="t r b l"`, `cursor`: a crop frame drags an edge inward.
- **rotate-handle** — `angle`, `cursor`: a handle orbits the element as it rotates.
- **duplicate** — `times`, `gap`, `cursor`: an element is option-dragged into a grid of copies.
- **drag-from-folder** — `files`, `pick`, `folder`, `src`: a folder window opens and a thumbnail is dragged out onto the slide.

**Ambient**

- **cursor-idle** — `cursors="A,B,C"`: named cursors drift in place, looping until hidden.

## Not yet ported

The talk this was extracted from also demos `drag-in`, `type-in`, `find-replace` and `multi-cursor`, but those run on an older, separate script tangled up with unrelated collab-slide code, and weren't brought over. They may get a clean port later.
