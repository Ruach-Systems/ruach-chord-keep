// Stable DOM updates for local edits and background synchronization.
(function () {
  'use strict';
  let preserving = false;

  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }

  function changes(before, after) {
    const previous = new Map(before.map(item => [item.id, item]));
    const next = new Map(after.map(item => [item.id, item]));
    const ids = new Set();
    for (const [id, item] of previous) if (!equal(item, next.get(id))) ids.add(id);
    for (const id of next.keys()) if (!previous.has(id)) ids.add(id);
    return { ids, changed: ids.size > 0 || !equal(before.map(item => item.id), after.map(item => item.id)) };
  }

  function rowId(row) {
    return row.getAttribute('data-id') ?? row.querySelector('[data-id]')?.getAttribute('data-id') ?? '$empty';
  }

  function keyedRows(rows) {
    const occurrences = new Map();
    return rows.map(row => {
      const id = rowId(row);
      const occurrence = occurrences.get(id) || 0;
      occurrences.set(id, occurrence + 1);
      return [JSON.stringify([id, occurrence]), row];
    });
  }

  function preserveView(update) {
    if (preserving) return update();
    preserving = true;
    const focus = document.activeElement;
    const containers = Array.from(document.querySelectorAll('#song-list, #setlist-list, #content, #empty-state, #song-content-section'));
    const positions = containers.map(element => {
      const top = element.getBoundingClientRect().top;
      // Keep the first visible surviving row in place when sorting or inserting above it.
      const anchors = element.scrollTop > 0 ? Array.from(element.querySelectorAll('li')).filter(row =>
        row.getBoundingClientRect().bottom > top).map(row => ({ row, offset: row.getBoundingClientRect().top - top })) : [];
      return { element, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft, anchors };
    });
    try { return update(); }
    finally {
      preserving = false;
      if (focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true });
      for (const position of positions) {
        const { element, anchors } = position;
        element.scrollLeft = position.scrollLeft;
        element.scrollTop = position.scrollTop;
        const anchor = anchors.find(item => item.row.isConnected && element.contains(item.row));
        if (anchor && position.scrollTop > 0) {
          element.scrollTop += anchor.row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
        }
      }
    }
  }

  function patchNode(current, next) {
    if (current.isEqualNode(next)) return;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next);
      return;
    }
    if (current.nodeType !== 1) {
      current.nodeValue = next.nodeValue;
      return;
    }
    for (const attribute of Array.from(current.attributes)) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    patchChildren(current, next);
  }

  function patchChildren(current, next) {
    const existing = Array.from(current.childNodes);
    const desired = Array.from(next.childNodes);
    desired.forEach((child, index) => {
      if (existing[index]) patchNode(existing[index], child);
      else current.appendChild(child);
    });
    existing.slice(desired.length).forEach(child => child.remove());
  }

  function fragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
  }

  function patchHtml(element, html) {
    patchChildren(element, fragment(html));
  }

  function patchList(element, html) {
    preserveView(() => {
      const desired = Array.from(fragment(html).children);
      desired.forEach(row => row.setAttribute('data-library-row', ''));
      const existing = Array.from(element.children);
      const rows = new Map(keyedRows(existing));
      const wanted = keyedRows(desired);
      const focused = document.activeElement;
      const focusedRow = existing.find(row => row.contains(focused));
      const focusIndex = existing.indexOf(focusedRow);
      const keep = new Set();
      let cursor = element.firstElementChild;
      for (const [key, next] of wanted) {
        const row = rows.get(key) || next;
        keep.add(row);
        if (row !== next) patchNode(row, next);
        if (row !== cursor) {
          // Newer WebViews can move connected nodes without disturbing focus.
          if (row.parentElement === element && element.moveBefore && element.isConnected) element.moveBefore(row, cursor);
          else element.insertBefore(row, cursor);
        }
        cursor = row.nextElementSibling;
      }
      existing.filter(row => !keep.has(row)).forEach(row => row.remove());
      // If the focused record was removed, continue at its nearest remaining row.
      if (focusedRow && !focused.isConnected) {
        const neighbor = element.children[Math.min(focusIndex, element.children.length - 1)];
        const target = neighbor?.querySelector('button') || element;
        if (target === element) element.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }

  function announceSync(count) {
    const status = document.getElementById('sync-announcements');
    if (status) status.textContent = `Library updated: ${count} ${count === 1 ? 'item' : 'items'} changed.`;
  }

  window.LibraryView = { equal, changes, patchHtml, patchList, preserveView, announceSync };
})();
