// Runs the shipped UI/controller with disposable data, not a copied implementation.
(async () => {
  const results = [], saves = [], $ = id => document.getElementById(id);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const until = async predicate => { const deadline = Date.now() + 1800; while (!predicate() && Date.now() < deadline) await wait(30); };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const list = () => $('setlist-songs'), rows = () => Array.from(list().children);
  const ids = () => rows().map(row => row.dataset.id);
  const stored = () => JSON.parse(LibraryStorage.getItem('chord-library-setlists'))[0].songIds;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const point = row => { const r = row.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const touch = (type, target, p, multi = false) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const finger = { identifier: 42, clientX: p.x, clientY: p.y };
    Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : multi ? [finger, { ...finger, identifier: 43 }] : [finger] }, changedTouches: { value: [finger] } });
    target.dispatchEvent(event); return event;
  };
  const key = (handle, value) => handle.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  const hold = async (row, selector = '.setlist-song-title') => {
    const p = point(row); touch('touchstart', row.querySelector(selector) || row, p); await wait(380); return p;
  };
  const clean = () => !list()._syncInteraction && !document.querySelector('.setlist-drag-ghost') && !document.body.classList.contains('setlist-sort-active');
  const reset = async (members = ['song-0', 'song-1', 'song-2', 'song-3', 'song-4']) => {
    list()?._sorter?.cancel(); await NativeBridge.flush();
    const now = Date.now(), songs = Array.from({ length: 35 }, (_, i) => ({ id: 'song-' + i, title: 'Song ' + i, artist: 'Artist ' + i, content: 'C G\nTest lyrics', createdAt: now, updatedAt: now - i, transposeSteps: 0 }));
    NativeBridge.replaceSnapshot({ 'chord-library-tour-seen': '2.4', 'chord-library-tour-features-seen': '[]', 'chord-library-theme': 'dark',
      'chord-library-songs': JSON.stringify(songs), 'chord-library-setlists': JSON.stringify([{ id: 'set', name: 'Practice', songIds: members, updatedAt: now }]) }, true);
    await settled(); $('home-setlists-list').querySelector('[data-id="set"]').click(); await settled();
    $('content').scrollTop = 0; saves.length = 0;
  };
  const check = async (name, run) => {
    try { await reset(); await run(); results.push('PASS ' + name); }
    catch (error) { results.push('FAIL ' + name + ': ' + error.message); list()?._sorter?.cancel(); }
    parent.postMessage(results.join('\n'), location.origin);
  };
  try {
    $('app').innerHTML = await (await fetch('../src/ChordLibrary.Shared/Assets/library.html')).text();
    await NativeBridge.initialize({ invokeMethodAsync: async (method, data) => { if (method === 'SaveStorage') saves.push(data); } }, { 'chord-library-tour-seen': '2.4' });
    NativeBridge.configure({ native: false });
    for (const file of ['qrcode.js', 'setlist-sort.js', 'app.js']) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '../src/ChordLibrary.Shared/wwwroot/js/' + file + '?fixture=' + Date.now();
      script.onload = resolve; script.onerror = reject; document.body.appendChild(script);
    });
    await check('hold on title, artist, number or row padding activates; delete is excluded', async () => {
      for (const selector of ['.setlist-song-title', '.setlist-song-artist', '.setlist-song-number', '.row-padding']) {
        const p = await hold(rows()[0], selector);
        assert(list().classList.contains('is-sorting'), 'No activation from ' + selector);
        assert(!NativeBridge.canRefresh(), 'Cloud refresh allowed during drag');
        touch('touchcancel', window, p); assert(clean(), 'Cancellation leaked state');
      }
      const row = rows()[0], p = point(row); touch('touchstart', row.querySelector('.btn-remove-song'), p); await wait(380);
      assert(clean(), 'Delete activated dragging'); assert(saves.length === 0, 'Hold saved data');
    });
    await check('ordinary scroll cancels pending hold without preventing scrolling', async () => {
      const row = rows()[0], p = point(row); touch('touchstart', row, p);
      const event = touch('touchmove', window, { ...p, y: p.y + 20 }); await wait(380);
      assert(!event.defaultPrevented && clean(), 'Normal scrolling blocked');
    });
    await check('live siblings move and full-height gap previews before a single saved drop', async () => {
      const original = stored(), row = rows()[0], sibling = rows()[1], top = sibling.offsetTop;
      const p = await hold(row), destination = point(rows()[3]);
      const event = touch('touchmove', window, { x: p.x, y: destination.y + 8 });
      assert(event.defaultPrevented, 'Active touch did not lock scrolling');
      assert(ids()[3] === 'song-0' && sibling.offsetTop < top, 'Siblings did not move into preview order');
      assert(row.offsetHeight > 40 && row.classList.contains('dragging'), 'Gap collapsed');
      assert(equal(stored(), original) && saves.length === 0, 'Preview saved too early');
      assert(document.querySelector('.setlist-sort-caption').textContent.includes('4 of 5'), 'Position feedback stale');
      const ghostStyle = getComputedStyle(document.querySelector('.setlist-drag-ghost'));
      assert(ghostStyle.animationName === 'none' && ghostStyle.borderTopColor !== 'rgba(0, 0, 0, 0)', 'Base row styles override the floating card');
      touch('touchend', window, { x: p.x, y: destination.y + 8 }); await NativeBridge.flush();
      assert(equal(stored(), ['song-1', 'song-2', 'song-3', 'song-0', 'song-4']), 'Wrong dropped order');
      assert(saves.length === 1 && clean(), 'Drop saved more than once or leaked state');
      row.querySelector('.setlist-song-title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
      assert(!$('setlist-detail').classList.contains('hidden'), 'Drop opened song');
    });
    await check('drop in list gap and near the row edge works without a precise target', async () => {
      const row = rows()[4], p = await hold(row), first = rows()[0].getBoundingClientRect();
      const destination = { x: $('content').getBoundingClientRect().right - 5, y: first.top - 4 };
      touch('touchmove', window, destination); touch('touchend', window, destination); await NativeBridge.flush();
      assert(stored()[0] === 'song-4' && clean(), 'Wide gap drop failed');
    });
    await check('outside drop, touch cancellation, Escape, Back and multi-touch restore order', async () => {
      for (const cancel of ['outside', 'touchcancel', 'Escape', 'Back', 'multi']) {
        await reset(); const original = stored(), row = rows()[0], p = await hold(row), end = point(rows()[3]);
        touch('touchmove', window, end);
        if (cancel === 'outside') touch('touchend', window, { x: p.x, y: 0 });
        else if (cancel === 'touchcancel') touch('touchcancel', window, end);
        else if (cancel === 'Escape') key(row.querySelector('.drag-handle'), 'Escape');
        else if (cancel === 'Back') assert(NativeBridge.handleBack(), 'Back not consumed');
        else touch('touchstart', window, end, true);
        assert(equal(ids(), original) && equal(stored(), original) && saves.length === 0 && clean(), 'Failed ' + cancel);
      }
    });
    await check('keyboard previews, commits, announces placement and retains focus', async () => {
      const handle = rows()[0].querySelector('.drag-handle'); handle.focus(); key(handle, ' '); key(handle, 'End');
      assert(ids()[4] === 'song-0' && stored()[0] === 'song-0', 'Keyboard preview saved or failed');
      key(handle, 'Enter'); await NativeBridge.flush();
      assert(stored()[4] === 'song-0' && document.activeElement === rows()[4].querySelector('.drag-handle') && clean(), 'Keyboard drop/focus failed');
      assert($('setlist-sort-status').textContent.includes('moved to position 5'), 'Placement not announced');
      key(handle, ' '); key(handle, 'Home'); key(handle, 'Escape');
      assert(stored()[4] === 'song-0' && ids()[4] === 'song-0' && clean(), 'Keyboard cancel changed order');
    });
    await check('mouse grip drag activates on movement and pointer cancellation restores', async () => {
      const row = rows()[0], p = point(row), end = point(rows()[3]);
      row.querySelector('.drag-handle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true, clientX: p.x, clientY: p.y }));
      window.dispatchEvent(new PointerEvent('pointermove', { cancelable: true, pointerId: 7, pointerType: 'mouse', clientX: end.x, clientY: end.y }));
      assert(list().classList.contains('is-sorting'), 'Mouse grip did not activate');
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 }));
      assert(ids()[0] === 'song-0' && clean() && saves.length === 0, 'Mouse cancellation failed');
    });
    await check('stationary finger at either viewport edge scrolls through long setlists', async () => {
      await reset(Array.from({ length: 35 }, (_, i) => 'song-' + i));
      const row = rows()[0], p = await hold(row), content = $('content'), bounds = content.getBoundingClientRect();
      touch('touchmove', window, { x: p.x, y: bounds.bottom - 8 }); await until(() => content.scrollTop > 180);
      assert(content.scrollTop > 180, 'Bottom edge did not scroll');
      const down = content.scrollTop; touch('touchmove', window, { x: p.x, y: bounds.top + 8 }); await until(() => content.scrollTop < down - 100);
      assert(content.scrollTop < down - 100, 'Top edge did not scroll');
      touch('touchcancel', window, p); assert(stored()[0] === 'song-0' && clean() && saves.length === 0, 'Auto-scroll persisted preview');
    });
    await check('duplicates and unresolved references survive the actual saved reorder', async () => {
      await reset(['missing-before', 'song-0', 'missing-middle', 'song-1', 'song-0', 'song-2', 'missing-after']);
      const handle = rows()[2].querySelector('.drag-handle'); key(handle, ' '); key(handle, 'Home'); key(handle, 'Enter'); await NativeBridge.flush();
      assert(equal(stored(), ['missing-before', 'song-0', 'song-0', 'missing-middle', 'song-1', 'song-2', 'missing-after']), 'Membership changed incorrectly');
    });
    await check('rapid direction changes stay stable and account replacement cancels the drag', async () => {
      const row = rows()[0], p = await hold(row);
      touch('touchmove', window, point(rows()[3]));
      touch('touchmove', window, { x: p.x, y: list().getBoundingClientRect().top + 2 });
      assert(ids()[0] === 'song-0', 'Reverse preview did not return to start');
      touch('touchmove', window, point(rows()[3]));
      NativeBridge.replaceSnapshot({ 'chord-library-songs': LibraryStorage.getItem('chord-library-songs'),
        'chord-library-setlists': JSON.stringify([{ id: 'set', name: 'Replacement', songIds: ['song-4', 'song-3'], updatedAt: Date.now() }]) }, true);
      await settled();
      assert(clean() && equal(stored(), ['song-4', 'song-3']) && saves.length === 0, 'Account replacement retained old drag');
    });
    await check('tap still opens song and a single-song list cannot activate sorting', async () => {
      const row = rows()[0], p = point(row); touch('touchstart', row, p); touch('touchend', window, p); row.querySelector('.setlist-song-open').click();
      assert(!$('song-detail').classList.contains('hidden'), 'Quick tap no longer opens');
      await reset(['song-0']); key(rows()[0].querySelector('.drag-handle'), ' '); await hold(rows()[0]);
      assert(clean(), 'Single-row sort activated');
    });
    await reset(Array.from({ length: 35 }, (_, i) => 'song-' + i));
    addEventListener('message', async event => {
      if (event.source !== parent || event.origin !== location.origin || event.data !== 'preview-reorder') return;
      await reset(); const row = rows()[0], p = await hold(row);
      touch('touchmove', window, { x: p.x, y: point(rows()[3]).y + 8 });
    });
    results.push(results.every(line => line.startsWith('PASS')) ? 'ALL 11 CHECKS PASSED; interactive preview ready.' : 'CHECKS FAILED');
  } catch (error) { results.push('FATAL ' + error.stack); }
  parent.postMessage(results.join('\n'), location.origin);
})();
