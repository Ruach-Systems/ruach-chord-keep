(function (root) {
  'use strict';
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + {
    play:'<path d="m9 5 11 7-11 7Z"/>', pause:'<path d="M8 5v14M16 5v14"/>',
    exit:'<path d="M9 4H4v16h5M10 12h10m-5-5 5 5-5 5"/>',
    settings:'<path d="m9 3-.6 2-2 .8-1.8-1L2.4 8.6 4 10v4l-1.6 1.4 2.2 3.8 1.8-1 2 .8.6 2h6l.6-2 2-.8 1.8 1 2.2-3.8L20 14v-4l1.6-1.4-2.2-3.8-1.8 1-2-.8-.6-2Z"/><circle cx="12" cy="12" r="3"/>',
    previous:'<path d="m15 6-6 6 6 6"/>', next:'<path d="m9 6 6 6-6 6"/>'
  }[name] + '</svg>';
  const speeds = [8, 16, 24, 36, 52];
  class PerformanceSession {
    constructor(songs, ids, index = 0) {
      const byId = new Map(songs.map(song => [song.id, song]));
      this.entries = ids.filter(id => byId.has(id)).map(id => ({
        song: JSON.parse(JSON.stringify(byId.get(id))), scroll: 0
      }));
      this.missing = ids.length - this.entries.length;
      this.index = Math.max(0, Math.min(index, this.entries.length - 1));
    }
    get current() { return this.entries[this.index]; }
    move(delta, scroll) {
      const next = this.index + delta;
      if (next < 0 || next >= this.entries.length) return false;
      this.current.scroll = scroll;
      this.index = next; return true;
    }
    patch(fields) {
      const id = this.current.song.id;
      for (const entry of this.entries) if (entry.song.id === id) Object.assign(entry.song, fields);
    }
  }
  function advanceScroll(position, elapsed, speed, maximum) {
    return Math.min(maximum, position + speeds[speed] * Math.min(Math.max(elapsed, 0), 100) / 1000);
  }
  root.ChordPerformance = { PerformanceSession, advanceScroll, create };
  if (typeof module !== 'undefined') module.exports = root.ChordPerformance;

  function create(options) {
    let session = null, panel, sheet, content, settings, play, pending = Promise.resolve();
    let frame = null, previousTime = null, position = 0, exiting = false;
    let speed = 2;
    const unsavedFields = new Set();
    try { const stored = localStorage.getItem('chordkeep.performance.speed'); if (stored !== null && /^[0-4]$/.test(stored)) speed = Number(stored); } catch {}
    const el = id => panel.querySelector('#perf-' + id);
    const pause = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null; previousTime = null;
      if (play) { play.innerHTML = icon('play'); play.title = 'Start auto-scroll'; play.setAttribute('aria-label', 'Start auto-scroll'); play.setAttribute('aria-pressed', 'false'); }
    };
    function tick(time) {
      const max = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
      if (previousTime !== null) {
        position = advanceScroll(position, time - previousTime, speed, max);
        sheet.scrollTop = position;
      }
      previousTime = time;
      if (position >= max) { pause(); return; }
      frame = requestAnimationFrame(tick);
    }
    function toggle() {
      if (frame !== null) { pause(); return; }
      if (sheet.scrollHeight <= sheet.clientHeight + sheet.scrollTop + 1) return;
      position = sheet.scrollTop; previousTime = null;
      play.innerHTML = icon('pause'); play.title = 'Pause auto-scroll'; play.setAttribute('aria-label', 'Pause auto-scroll'); play.setAttribute('aria-pressed', 'true');
      frame = requestAnimationFrame(tick);
    }
    function render() {
      const song = session.current.song;
      const fontSize = Math.max(10, Math.min(24, parseInt(song.fontSize || options.fontSize, 10) || 14));
      el('title').textContent = song.title;
      el('context').textContent = options.setlist
        ? `${session.index + 1} / ${session.entries.length} · ${options.setlist.name}${session.entries[session.index + 1] ? ' · Next: ' + session.entries[session.index + 1].song.title : ' · Last song'}`
        : '';
      el('context').hidden = !options.setlist;
      content.innerHTML = options.render(song.content, song.transposeSteps || 0);
      content.style.fontSize = fontSize + 'px';
      content.style.lineHeight = '1.6';
      content.classList.toggle('two-column', song.twoColumn === true);
      el('previous').disabled = session.index === 0;
      el('next').disabled = session.index === session.entries.length - 1;
      el('transpose').value = song.transposeSteps || 0;
      el('font').value = fontSize;
      el('columns').checked = song.twoColumn === true;
      sheet.scrollTop = session.current.scroll;
    }
    function setSettingsOpen(open) {
      settings.hidden = !open;
      sheet.inert = open;
      el('display').setAttribute('aria-expanded', String(open));
    }
    function navigate(delta) {
      pause();
      if (session.move(delta, sheet.scrollTop)) { setSettingsOpen(false); render(); }
    }
    function patch(fields) {
      session.current.scroll = sheet.scrollTop;
      session.patch(fields); render();
      const id = session.current.song.id;
      el('notice').textContent = 'Saving display settings…';
      pending = pending.then(async () => {
        try {
          const saved = await NativeBridge.savePerformanceDisplay(id, fields);
          for (const field of Object.keys(fields)) unsavedFields.delete(id + ':' + field);
          el('notice').textContent = saved ? 'Display settings saved on this device.' : 'This song was removed from the library. Adjustments apply only to this performance.';
        } catch {
          for (const field of Object.keys(fields)) unsavedFields.add(id + ':' + field);
          el('notice').textContent = 'Could not save display settings. Adjust them again to retry; this performance is unchanged.';
        }
      });
    }
    async function exit() {
      if (exiting || !session) return;
      exiting = true; pause();
      await pending;
      const id = session.current.song.id;
      const scroll = sheet.scrollTop;
      // Unblock snapshot delivery only after the session's last patch is durable.
      session = null;
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', pause);
      window.removeEventListener('performance-suspend', pause);
      panel.remove(); options.background.inert = false;
      document.body.classList.remove('performance-active');
      try { await NativeBridge.setPerformanceActive(false); }
      catch { NativeBridge.showToast('Latest library could not be displayed. Refresh the library to retry.', 'error'); }
      options.exit(id, scroll);
      if (unsavedFields.size) NativeBridge.showToast('Some performance display settings could not be saved. Your song content was not changed.', 'error');
    }
    function back() {
      if (!session) return false;
      if (!settings.hidden) { setSettingsOpen(false); el('display').focus(); }
      else void exit();
      return true;
    }
    function keydown(event) {
      if (!session) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); back(); return; }
      if (event.key === 'Tab') {
        const focusScope = settings.hidden ? panel : settings;
        const controls = [...focusScope.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(x => !x.closest('[hidden]') && x.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.target.closest('button,input,select,textarea,[contenteditable]')) return;
      if (['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === ' ') toggle();
        else if (options.setlist) navigate(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pause();
    }
    function visibility() { if (document.hidden) pause(); }
    return {
      get active() { return !!session; }, back,
      async start(next) {
        await NativeBridge.setPerformanceActive(true);
        session = next;
        panel = document.createElement('section');
        panel.className = 'performance-view'; panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'perf-title');
        panel.innerHTML = `<header class="performance-heading"><h2 id="perf-title"></h2><p id="perf-context"></p></header>
          <div id="perf-sheet" class="performance-sheet" tabindex="0" aria-label="Performance chord sheet"><pre id="perf-content" class="song-content"></pre></div>
          <div id="perf-settings-backdrop" class="performance-settings-backdrop" aria-hidden="true"></div>
          <section id="perf-settings" class="performance-settings" role="dialog" aria-modal="true" aria-label="Display settings" hidden>
            <header class="performance-settings-heading"><h3>Display settings</h3><button id="perf-close-settings" type="button" aria-label="Close display settings" title="Close display settings">×</button></header>
            <div class="performance-setting-row"><label for="perf-transpose">Transpose</label><div class="performance-transpose-controls"><select id="perf-transpose" aria-label="Transpose">${Array.from({length:23}, (_, i) => `<option value="${i-11}">${i-11 > 0 ? '+' : ''}${i-11}</option>`).join('')}</select><button id="perf-reset" type="button" aria-label="Reset transpose" title="Reset transpose"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/></svg></button></div></div>
            <label>Font size <select id="perf-font">${Array.from({length:8}, (_, i) => `<option>${10+i*2}</option>`).join('')}</select></label>
            <label class="performance-columns"><span>Two columns</span><input id="perf-columns" type="checkbox" role="switch"><span class="performance-switch" aria-hidden="true"></span></label>
            <label>Scroll speed <select id="perf-speed">${['Very slow','Slow','Medium','Fast','Very fast'].map((s,i) => `<option value="${i}">${s}</option>`).join('')}</select></label>
            <p id="perf-notice" role="status">Changes saved automatically.</p>
          </section>
          <nav class="performance-controls" aria-label="Performance controls">
            <button id="perf-exit" type="button" aria-label="Exit performance" title="Exit performance">${icon('exit')}</button>
            <button id="perf-previous" type="button" aria-label="Previous song" title="Previous song">${icon('previous')}</button>
            <button id="perf-play" type="button" aria-label="Start auto-scroll" title="Start auto-scroll" aria-pressed="false">${icon('play')}</button>
            <button id="perf-next" type="button" aria-label="Next song" title="Next song">${icon('next')}</button>
            <button id="perf-display" type="button" aria-label="Display settings" title="Display settings" aria-expanded="false" aria-controls="perf-settings">${icon('settings')}</button>
          </nav>`;
        options.background.inert = true; options.background.after(panel);
        document.body.classList.add('performance-active');
        sheet = el('sheet'); content = el('content'); settings = el('settings'); play = el('play');
        el('previous').hidden = el('next').hidden = !options.setlist;
        el('exit').onclick = exit; play.onclick = toggle;
        el('previous').onclick = () => navigate(-1); el('next').onclick = () => navigate(1);
        el('display').onclick = () => {
          pause(); setSettingsOpen(settings.hidden);
          if (!settings.hidden) el('close-settings').focus();
        };
        el('close-settings').onclick = back;
        el('settings-backdrop').onclick = back;
        el('transpose').onchange = e => patch({transposeSteps:Number(e.target.value)});
        el('reset').onclick = () => patch({transposeSteps:0});
        el('font').onchange = e => patch({fontSize:Number(e.target.value)});
        el('columns').onchange = e => patch({twoColumn:e.target.checked});
        el('speed').value = speed;
        el('speed').onchange = e => { speed = Number(e.target.value); try { localStorage.setItem('chordkeep.performance.speed', String(speed)); } catch {} };
        sheet.addEventListener('wheel', pause, {passive:true});
        let touch = null;
        sheet.addEventListener('pointerdown', pause, {passive:true});
        sheet.addEventListener('touchstart', e => { pause(); touch = e.touches.length === 1 ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : null; }, {passive:true});
        sheet.addEventListener('touchcancel', () => { touch = null; });
        sheet.addEventListener('touchend', e => {
          // Horizontal gestures pan long chord lines instead of changing songs.
          if (!touch || !options.setlist || !e.changedTouches.length || sheet.scrollWidth > sheet.clientWidth + 1) return;
          const dx = e.changedTouches[0].clientX-touch.x, dy = e.changedTouches[0].clientY-touch.y;
          touch = null;
          if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)*1.5) navigate(dx < 0 ? 1 : -1);
        }, {passive:true});
        document.addEventListener('keydown', keydown, true);
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('blur', pause);
        window.addEventListener('performance-suspend', pause);
        render(); sheet.focus();
      }
    };
  }
})(typeof window === 'undefined' ? globalThis : window);
