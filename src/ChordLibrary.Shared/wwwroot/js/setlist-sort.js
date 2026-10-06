// Long-press sorting with a live gap, native touch scrolling before activation,
// keyboard controls and a single durable reorder on drop.
(function () {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function insertionIndex(midpoints, y) {
    const index = midpoints.findIndex(midpoint => y < midpoint);
    return index < 0 ? midpoints.length : index;
  }

  function edgeVelocity(y, top, bottom) {
    const band = Math.min(72, (bottom - top) / 4);
    if (y < top - 24 || y > bottom + 24 || band <= 0) return 0;
    if (y < top + band) return -600 * clamp((top + band - y) / band, 0, 1);
    if (y > bottom - band) return 600 * clamp((y - bottom + band) / band, 0, 1);
    return 0;
  }

  // Visible indices are not necessarily membership indices: unresolved songs and
  // repeated occurrences must survive a reorder without moving the wrong entry.
  function reorderMembers(ids, visibleIndices, from, to) {
    if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value < visibleIndices.length)) return ids.slice();
    if (from === to) return ids.slice();
    const source = visibleIndices[from];
    const remaining = visibleIndices.filter((_, index) => index !== from);
    let destination = to < remaining.length ? remaining[to] : remaining[remaining.length - 1] + 1;
    if (destination > source) destination--;
    const result = ids.slice();
    const [moved] = result.splice(source, 1);
    result.splice(destination, 0, moved);
    return result;
  }

  function attach(list, { scroller, status, onCommit, onIdle }) {
    if (list._sorter) return list._sorter;
    let session = null, timer = null, frame = null, swallowClick = false, clickUntil = 0;
    const animations = new Map();
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const rows = () => Array.from(list.querySelectorAll('.setlist-song-item'));
    const announce = message => { if (status) status.textContent = message; };
    const stopAnimations = () => { animations.forEach(animation => animation.cancel()); animations.clear(); };
    const eligible = target => {
      if (target.closest?.('.btn-remove-song')) return null;
      const item = target.closest?.('.setlist-song-item');
      return item?.parentElement === list && rows().length > 1 ? item : null;
    };
    const valid = state => state.item.isConnected && list.dataset.setlistId === state.setlistId && list.getClientRects().length > 0;

    function preview(to) {
      const state = session;
      if (!state?.active || state.to === to) return;
      // Start each animation at its current visual position, even if the user
      // reverses direction before the previous transition has finished.
      const before = new Map(rows().map(item => [item, item.getBoundingClientRect().top]));
      stopAnimations();
      const others = rows().filter(item => item !== state.item);
      list.insertBefore(state.item, others[to] || null);
      state.to = to;
      rows().forEach((item, index) => {
        item.querySelector('.setlist-song-number').textContent = index + 1;
        const delta = before.get(item) - item.getBoundingClientRect().top;
        if (delta && item !== state.item && !reducedMotion() && item.animate) {
          animations.set(item, item.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)' }));
        }
      });
      if (state.caption) state.caption.textContent = `Position ${to + 1} of ${state.original.length}`;
      if (state.ghost) state.ghost.querySelector('.setlist-song-number').textContent = to + 1;
      announce(`${state.title}, position ${to + 1} of ${state.original.length}. Release to place.`);
    }

    function update() {
      const state = session;
      if (!state?.active || state.kind === 'keyboard') return;
      const { x, y } = state.point;
      state.ghost.style.left = clamp(x - state.offsetX, 8, Math.max(8, innerWidth - state.width - 8)) + 'px';
      state.ghost.style.top = clamp(y - state.offsetY - (state.kind === 'touch' ? 44 : 0), 8,
        Math.max(8, innerHeight - state.height - 8)) + 'px';
      const bounds = scroller.getBoundingClientRect();
      if (x < bounds.left - 56 || x > bounds.right + 56) return;
      const listTop = list.getBoundingClientRect().top;
      // Layout offsets ignore the sibling animations; transforms cannot jitter
      // the hit test. Every gap and horizontal point uses the same broad target.
      const midpoints = rows().filter(item => item !== state.item)
        .map(item => listTop + item.offsetTop + item.offsetHeight / 2);
      preview(insertionIndex(midpoints, y));
    }

    function tick(time) {
      frame = null;
      const state = session;
      if (!state?.active || state.kind === 'keyboard') return;
      if (!valid(state)) { finish(false); return; }
      const bounds = scroller.getBoundingClientRect();
      const elapsed = Math.min(32, time - (state.lastFrame || time)) / 1000;
      state.lastFrame = time;
      if (state.point.x >= bounds.left - 56 && state.point.x <= bounds.right + 56)
        scroller.scrollTop += edgeVelocity(state.point.y, bounds.top, bounds.bottom) * elapsed;
      update();
      frame = requestAnimationFrame(tick);
    }

    function activate() {
      timer = null;
      const state = session;
      if (!state || !valid(state)) { finish(false); return; }
      state.active = true;
      state.item.classList.remove('sort-pressing'); state.item.classList.add('dragging');
      state.handle.setAttribute('aria-pressed', 'true');
      list.classList.add('is-sorting');
      scroller.classList.add('setlist-sort-scroller');
      document.body.classList.add('setlist-sort-active');
      announce(`${state.title} picked up. Position ${state.from + 1} of ${state.original.length}.`);
      if (state.kind === 'keyboard') return;
      const rect = state.item.getBoundingClientRect();
      state.width = Math.min(rect.width, 560); state.height = rect.height;
      state.offsetX = clamp(state.point.x - rect.left, 0, state.width);
      state.offsetY = clamp(state.point.y - rect.top, 0, rect.height);
      state.ghost = state.item.cloneNode(true);
      state.ghost.className = 'setlist-song-item setlist-drag-ghost';
      state.ghost.removeAttribute('data-library-row');
      state.ghost.setAttribute('aria-hidden', 'true');
      state.ghost.style.width = state.width + 'px';
      state.ghost.querySelectorAll('button').forEach(button => { button.tabIndex = -1; button.disabled = true; });
      state.caption = document.createElement('span'); state.caption.className = 'setlist-sort-caption';
      state.caption.textContent = `Position ${state.from + 1} of ${state.original.length}`;
      state.ghost.appendChild(state.caption); document.body.appendChild(state.ghost);
      if (state.kind === 'mouse' || state.kind === 'pen') {
        try { list.setPointerCapture(state.id); } catch { /* Synthetic events / old WebViews. */ }
      }
      if (state.kind === 'touch') { try { navigator.vibrate?.(20); } catch { /* Optional feedback. */ } }
      update(); frame = requestAnimationFrame(tick);
    }

    function begin(item, kind, id, x, y, fromHandle = false) {
      if (session) return;
      swallowClick = false;
      const original = rows(), from = original.indexOf(item);
      if (original.length < 2 || from < 0) return;
      session = { item, kind, id, original, from, to: from, fromHandle,
        setlistId: list.dataset.setlistId, point: { x, y }, start: { x, y }, active: false,
        handle: item.querySelector('.drag-handle'), title: item.querySelector('.setlist-song-title').textContent };
      list._syncInteraction = true;
      if (kind === 'keyboard') activate();
      else { item.classList.add('sort-pressing'); timer = setTimeout(activate, 350); }
    }

    function move(x, y, event) {
      const state = session;
      if (!state) return;
      state.point = { x, y };
      if (!state.active) {
        if (Math.hypot(x - state.start.x, y - state.start.y) > 9) {
          if (state.fromHandle && (state.kind === 'mouse' || state.kind === 'pen')) {
            clearTimeout(timer); activate();
          } else { finish(false); return; }
        }
      }
      if (session?.active && event.cancelable) event.preventDefault();
      update();
    }

    function finish(commit) {
      const state = session;
      if (!state) return false;
      if (commit && state.active) update();
      session = null;
      clearTimeout(timer); timer = null;
      cancelAnimationFrame(frame); frame = null;
      stopAnimations();
      const changed = commit && state.active && valid(state) && state.to !== state.from;
      if (state.active && !changed) state.original.forEach(item => { if (item.parentElement === list) list.appendChild(item); });
      state.item.classList.remove('sort-pressing');
      if (state.active) rows().forEach((item, index) => {
        item.classList.remove('dragging', 'sort-pressing');
        item.querySelector('.setlist-song-number').textContent = index + 1;
        item.querySelector('.drag-handle').setAttribute('aria-pressed', 'false');
      });
      state.ghost?.remove();
      list.classList.remove('is-sorting'); document.body.classList.remove('setlist-sort-active');
      scroller.classList.remove('setlist-sort-scroller');
      if (state.active && state.kind !== 'keyboard') { swallowClick = true; clickUntil = Date.now() + 600; }
      try { if (list.hasPointerCapture(state.id)) list.releasePointerCapture(state.id); } catch { /* No capture. */ }
      // Keep sync guarded through the commit/render; only then deliver waiting
      // cloud data. A canceled drag never writes a song order.
      try {
        if (changed) onCommit(state.from, state.to);
        if (state.active) announce(changed ? `${state.title} moved to position ${state.to + 1} of ${state.original.length}.`
          : `${state.title} kept at position ${state.from + 1}. Reorder canceled.`);
        if (state.kind === 'keyboard') {
          const item = rows()[changed ? state.to : state.from];
          item?.querySelector('.drag-handle').focus({ preventScroll: true });
          item?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      } finally { list._syncInteraction = false; onIdle?.(); }
      return true;
    }

    list.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || (event.pointerType === 'touch' && 'ontouchstart' in window)) return;
      const item = eligible(event.target);
      if (item) begin(item, event.pointerType || 'mouse', event.pointerId, event.clientX, event.clientY, !!event.target.closest('.drag-handle'));
    });
    window.addEventListener('pointermove', event => {
      if (session && session.kind !== 'keyboard' && session.id === event.pointerId && !(session.kind === 'touch' && 'ontouchstart' in window))
        move(event.clientX, event.clientY, event);
    }, { passive: false });
    window.addEventListener('pointerup', event => {
      if (!session || session.kind === 'keyboard' || session.id !== event.pointerId || (session.kind === 'touch' && 'ontouchstart' in window)) return;
      session.point = { x: event.clientX, y: event.clientY };
      const bounds = scroller.getBoundingClientRect();
      finish(event.clientX >= bounds.left - 56 && event.clientX <= bounds.right + 56 && event.clientY >= bounds.top && event.clientY <= bounds.bottom);
    });
    window.addEventListener('pointercancel', event => { if (session?.id === event.pointerId && session.kind !== 'keyboard' && session.sensor !== 'touch') finish(false); });
    list.addEventListener('lostpointercapture', event => { if (session?.id === event.pointerId && session.kind !== 'keyboard' && session.sensor !== 'touch') finish(false); });

    // A non-passive touchmove listener can prevent scrolling AFTER activation.
    // Changing touch-action mid-gesture cannot do that; pointer-only touch
    // sorters get canceled by Android WebView as soon as the finger moves.
    list.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { finish(false); return; }
      if (session) { const compatible = session.kind === 'touch' && !session.sensor && !session.active; finish(false); if (!compatible) return; }
      const item = eligible(event.target), touch = event.touches[0];
      if (item) { begin(item, 'touch', touch.identifier, touch.clientX, touch.clientY); if (session) session.sensor = 'touch'; }
    }, { passive: true });
    window.addEventListener('touchstart', event => { if (event.touches.length > 1) finish(false); }, { passive: true });
    window.addEventListener('touchmove', event => {
      if (session?.sensor !== 'touch') return;
      const touch = Array.from(event.touches).find(touch => touch.identifier === session.id);
      if (!touch || event.touches.length !== 1) { finish(false); return; }
      move(touch.clientX, touch.clientY, event);
    }, { passive: false });
    window.addEventListener('touchend', event => {
      if (session?.sensor !== 'touch') return;
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === session.id);
      if (!touch) return;
      session.point = { x: touch.clientX, y: touch.clientY };
      const bounds = scroller.getBoundingClientRect();
      finish(touch.clientX >= bounds.left - 56 && touch.clientX <= bounds.right + 56 && touch.clientY >= bounds.top && touch.clientY <= bounds.bottom);
    }, { passive: true });
    window.addEventListener('touchcancel', () => { if (session?.sensor === 'touch') finish(false); }, { passive: true });

    list.addEventListener('click', event => {
      if (session?.active || (swallowClick && Date.now() < clickUntil && (event.detail > 0 || event.pointerType))) {
        event.preventDefault(); event.stopImmediatePropagation(); swallowClick = false;
      }
    }, true);
    list.addEventListener('contextmenu', event => { if (session || eligible(event.target)) event.preventDefault(); });
    list.addEventListener('dragstart', event => { if (eligible(event.target)) event.preventDefault(); });
    window.addEventListener('keydown', event => {
      if (session && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); return; }
      const handle = event.target.closest?.('.drag-handle');
      if (!handle || !list.contains(handle)) return;
      const toggle = event.key === ' ' || event.key === 'Enter';
      if (!session && toggle && !event.repeat) {
        event.preventDefault(); begin(handle.closest('.setlist-song-item'), 'keyboard', null, 0, 0); return;
      }
      if (session?.kind !== 'keyboard') return;
      if (toggle) { event.preventDefault(); if (!event.repeat) finish(true); return; }
      const to = { ArrowUp: session.to - 1, ArrowDown: session.to + 1, Home: 0, End: session.original.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault(); preview(clamp(to, 0, session.original.length - 1));
      session.item.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, true);
    window.addEventListener('blur', () => finish(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(false); });
    list._sorter = { cancel: () => finish(false) };
    return list._sorter;
  }

  window.SetlistSort = { attach, reorderMembers, insertionIndex, edgeVelocity };
})();
