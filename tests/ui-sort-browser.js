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
    document.querySelector('.app-product-logo').src='../src/ChordLibrary.Shared/wwwroot/images/chordkeep.svg';
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
    await check('removal requires confirmation and Cancel or native Back leaves data unchanged', async () => {
      const original = stored(); rows()[0].querySelector('.btn-remove-song').click(); await wait(60);
      assert(!$('confirm-modal').classList.contains('hidden') && $('btn-confirm-delete').textContent === 'Remove', 'Removal confirmation missing');
      assert($('confirm-message').textContent.includes('Song 0') && $('confirm-message').textContent.includes('remain in your song library'), 'Unclear removal message');
      assert(equal(stored(), original) && saves.length === 0 && !NativeBridge.canRefresh(), 'Removal saved early or cloud allowed behind dialog');
      $('btn-cancel-confirm').click(); assert(equal(stored(), original), 'Cancel removed song');
      const remove = rows()[0].querySelector('.btn-remove-song'); remove.focus(); remove.click(); NativeBridge.handleBack(); await wait(70);
      assert($('confirm-modal').classList.contains('hidden') && equal(stored(), original) && saves.length === 0, 'Back removed song or failed to dismiss');
      assert(document.activeElement === remove, 'A dismissed confirmation stole focus');
    });
    await check('confirmed removal affects only the clicked occurrence and retains library songs', async () => {
      await reset(['missing-before', 'song-0', 'song-1', 'song-0', 'missing-after']);
      rows()[2].querySelector('.btn-remove-song').click(); await wait(60); $('btn-confirm-delete').click();
      await NativeBridge.flush(); await settled();
      assert(equal(stored(), ['missing-before', 'song-0', 'song-1', 'missing-after']), 'Other duplicate or unresolved reference removed');
      assert(JSON.parse(LibraryStorage.getItem('chord-library-songs')).some(song => song.id === 'song-0'), 'Song deleted from library');
      assert(saves.length === 1 && $('undo-toast').classList.contains('hidden'), 'Removal saved repeatedly or used undo toast');
      assert(document.activeElement === rows()[1].querySelector('.setlist-song-open'), 'Focus not restored to a remaining song');
    });
    await check('plus adds immediately in click order and prevents duplicate additions', async () => {
      const original = ['missing-before', 'song-0', 'song-1', 'song-0', 'missing-after']; await reset(original);
      $('btn-add-songs-to-setlist').click();
      const add = id => $('song-selector').querySelector('.song-add-button[data-id="' + id + '"]');
      assert(!$('song-selector').querySelector('input[type="checkbox"]') && !$('btn-confirm-add-songs'), 'Checkbox/bulk selection remains');
      assert(add('song-0').disabled && !add('song-0').textContent.trim() && add('song-0').getAttribute('aria-label').includes('already in this setlist') && add('song-0').querySelector('svg path').getAttribute('d') === 'm5 12 4 4L19 6', 'Existing song needs an accessible icon-only check');
      const unchanged = add('song-3').closest('.song-selector-item'), first = add('song-8');
      first.click(); assert(equal(stored(), [...original, 'song-8']), 'First plus did not save immediately');
      add('song-2').click(); await NativeBridge.flush();
      assert(equal(stored(), [...original, 'song-8', 'song-2']), 'Option order replaced click order');
      assert(!$('add-songs-modal').classList.contains('hidden') && add('song-3').closest('.song-selector-item') === unchanged, 'Picker closed or neighboring row replaced');
      assert(first === add('song-8') && first.disabled && !first.textContent.trim() && first.getAttribute('aria-label').includes('already in this setlist') && first.querySelector('svg path').getAttribute('d') === 'm5 12 4 4L19 6', 'Added button state/identity stale');
      const writes = saves.length; first.click(); first.dispatchEvent(new MouseEvent('click', { bubbles: true })); await NativeBridge.flush();
      assert(equal(stored(), [...original, 'song-8', 'song-2']) && saves.length === writes, 'Repeated add created duplicate or extra write');
    });
    await check('picker search matches title/artist, keeps its focus and can show an empty result', async () => {
      $('btn-add-songs-to-setlist').click(); const input = $('song-selector-search'); input.focus();
      for (const [query, count] of [['  Artist 8  ', 1], ['song 12', 1], ['Test lyrics', 0], ['', 35]]) {
        input.value = query; input.dispatchEvent(new Event('input')); await settled();
        assert($('song-selector').querySelectorAll('.song-selector-item').length === count, 'Incorrect picker matches for ' + query);
        assert(document.activeElement === input, 'Search lost focus');
      }
      assert(saves.length === 0, 'Searching wrote setlist data');
    });
    await check('Done and native Back retain immediate additions; reopen shows them as Added', async () => {
      const original = stored(); $('btn-add-songs-to-setlist').click();
      $('song-selector').querySelector('.song-add-button[data-id="song-8"]').click(); $('btn-cancel-add-songs').click();
      assert(equal(stored(), [...original, 'song-8']), 'Done discarded addition');
      $('btn-add-songs-to-setlist').click();
      assert($('song-selector').querySelector('.song-add-button[data-id="song-8"]').disabled, 'Reopened picker allows duplicate');
      $('song-selector').querySelector('.song-add-button[data-id="song-9"]').click(); NativeBridge.handleBack();
      assert($('add-songs-modal').classList.contains('hidden') && equal(stored(), [...original, 'song-8', 'song-9']), 'Back discarded additions or failed to dismiss');
      await NativeBridge.flush();
    });
    await check('keyboard additions retain list scroll and move focus to another available song', async () => {
      $('btn-add-songs-to-setlist').click(); await wait(70);
      const picker = $('song-selector'), button = picker.querySelector('.song-add-button[data-id="song-8"]');
      picker.scrollTop = 180; const scroll = picker.scrollTop; button.focus({ preventScroll: true }); button.click(); await settled();
      assert(document.activeElement === picker.querySelector('.song-add-button[data-id="song-9"]'), 'Focus stranded on a disabled button');
      assert(picker.scrollTop === scroll, 'Picker scrolled unexpectedly');
      assert($('add-songs-status').textContent.includes('Song 8') && $('add-songs-status').textContent.includes('end'), 'Addition not announced');
      $('btn-cancel-add-songs').click(); $('btn-add-songs-to-setlist').click();
      assert(picker.scrollTop === 0, 'A fresh picker opening retained an old scroll position');
      await reset(Array.from({ length: 34 }, (_, i) => 'song-' + i)); $('btn-add-songs-to-setlist').click(); await wait(70);
      const last = $('song-selector').querySelector('.song-add-button[data-id="song-34"]'); last.focus({ preventScroll: true }); last.click(); await settled();
      assert(document.activeElement === $('btn-cancel-add-songs'), 'No available songs left, but focus did not move to Done');
      key($('btn-cancel-add-songs'), 'Tab');
      assert(document.activeElement === $('btn-close-add-songs'), 'Picker focus escaped after the last addition');
    });
    await reset(Array.from({ length: 35 }, (_, i) => 'song-' + i));
    addEventListener('message', async event => {
      if (event.source !== parent || event.origin !== location.origin) return;
      if (event.data === 'preview-layout') {
        await reset();
        const songs = JSON.parse(LibraryStorage.getItem('chord-library-songs'));
        const samples = [['Morning Light', 'Studio Collective'], ['A Longer Song Title That Fits Cleanly', 'An artist with a longer name'],
          ['Instrumental Interlude', ''], ['Evening Sky', 'Northside Ensemble'], ['Finale', 'Studio Collective']];
        samples.forEach(([title, artist], i) => Object.assign(songs[i], { title, artist }));
        NativeBridge.replaceSnapshot({ 'chord-library-songs': JSON.stringify(songs), 'chord-library-setlists': LibraryStorage.getItem('chord-library-setlists') });
        return;
      }
      if (event.data !== 'preview-reorder') return;
      await reset(); const row = rows()[0], p = await hold(row);
      touch('touchmove', window, { x: p.x, y: point(rows()[3]).y + 8 });
    });
    results.push(results.every(line => line.startsWith('PASS')) ? `ALL ${results.length} CHECKS PASSED; interactive preview ready.` : 'CHECKS FAILED');
  } catch (error) { results.push('FATAL ' + error.stack); }
  parent.postMessage(results.join('\n'), location.origin);
})();
