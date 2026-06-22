// ── Modal backdrop-close guard ───────────────────────────────────────────────
// Every modal closes on a click whose target IS the backdrop itself
// (`onclick="if(event.target===this)close()"`). A text-selection drag that
// starts inside a field and ends out on the dim backdrop fires exactly such a
// click — closing the popup mid-selection. This is the app-wide cause of "the
// popup closes when I drag-select text in a field."
//
// Fix once, globally: a capture-phase guard that swallows any click whose
// pointer-press began on a DESCENDANT of the click's target (i.e. a drag that
// ended on an ancestor — the backdrop). Genuine clicks (press + release on the
// same element) are untouched, so "click outside to close" still works. Self-
// installs on import; import it once per page entry point.
let _downEl = null;
document.addEventListener('pointerdown', e => { _downEl = e.target; }, true);
document.addEventListener('click', e => {
  const down = _downEl;
  _downEl = null;
  if (down && down !== e.target && e.target instanceof Element && e.target.contains(down)) {
    e.stopPropagation();   // drag-out click → don't let it reach a backdrop close handler
  }
}, true);
