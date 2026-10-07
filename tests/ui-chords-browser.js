(async () => {
  const $ = id => document.getElementById(id), results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = async (name, work) => {
    try { await work(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message); }
    parent.postMessage(results.join('\n'), location.origin);
  };
  const key = (palette, root) => $(palette).querySelector(`[data-root="${root}"]`);
  const form = (palette, suffix) => { const select = $(palette).querySelector('select'); select.value = suffix; select.dispatchEvent(new Event('change', { bubbles: true })); };
  const textRange = (start, end = start) => {
    $('song-content').textContent = 'C| verse'; $('song-content').dispatchEvent(new Event('input', { bubbles: true })); $('song-content').focus();
    const range = document.createRange(); range.setStart($('song-content').firstChild, start); range.setEnd($('song-content').firstChild, end);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  };
  const stored = () => JSON.parse(LibraryStorage.getItem('chord-library-songs'));
  const checkKeyboardPalette = async (paletteId, editor) => {
    if (innerWidth >= 768) return; // Mobile-only layout; desktop geometry is checked separately.
    const viewport = window.visualViewport, host = $(paletteId);
    assert(viewport, 'VisualViewport unavailable in this browser fixture');
    const original = ['height', 'offsetTop'].map(name => [name, Object.getOwnPropertyDescriptor(viewport, name)]);
    const saved = JSON.stringify(stored());
    try {
      for (const space of [176, 120]) {
        const bottom = Math.min(innerHeight, host.getBoundingClientRect().top + space + 8);
        Object.defineProperty(viewport, 'height', { configurable: true, value: bottom });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 0 });
        viewport.dispatchEvent(new Event('resize')); await settled(); await settled();
        assert(host.getBoundingClientRect().bottom <= bottom - 7, 'Palette runs under simulated keyboard');
        assert(host.getBoundingClientRect().height <= 280, 'Mobile palette is too tall');
        const scroll = host.classList.contains('has-short-viewport') ? host.querySelector('.chord-palette-body') : host.querySelector('.chord-palette-grid');
        assert(scroll.clientHeight >= 44 && scroll.scrollHeight > scroll.clientHeight, 'No usable scroll area for chord buttons');
        scroll.scrollTop = scroll.scrollHeight; await settled();
        const button = key(paletteId, 'G#'), rect = button.getBoundingClientRect(), bounds = scroll.getBoundingClientRect();
        assert(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, 'Last chord cannot scroll fully into view');
        button.click();
        assert((editor.isContentEditable ? editor.innerText : editor.value).includes('G#|'), 'Scrolled chord did not insert');
        assert(document.activeElement === editor, 'Scrolled chord lost editor focus');
      }
      assert(JSON.stringify(stored()) === saved, 'Keyboard resizing saved an uncommitted draft');
    } finally {
      for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(viewport, name, descriptor); else delete viewport[name]; }
      viewport.dispatchEvent(new Event('resize')); await settled(); await settled();
    }
  };
  try {
    $('app').innerHTML = await (await fetch('../src/ChordLibrary.Shared/Assets/library.html')).text();
    document.querySelector('.app-product-logo').src='../src/ChordLibrary.Shared/wwwroot/images/chordkeep.svg';
    await NativeBridge.initialize({ invokeMethodAsync: async () => {} }, { 'chord-library-tour-seen': '2.4', 'chord-library-tour-features-seen': '2.4' });
    NativeBridge.configure({ native: false });
    for (const file of ['qrcode.js','setlist-sort.js','app.js']) await new Promise((resolve,reject) => {
      const script = document.createElement('script');script.src='../src/ChordLibrary.Shared/wwwroot/js/'+file+'?v='+Date.now();script.onload=resolve;script.onerror=reject;document.body.appendChild(script);
    });
    NativeBridge.replaceSnapshot({ 'chord-library-songs': JSON.stringify([{id:'test',title:'Morning Light',artist:'Studio Collective',content:'C| verse',createdAt:1,updatedAt:1}]),
      'chord-library-setlists':'[]','chord-library-theme':'dark' }, true); await settled();
    $('home-songs-list').querySelector('[data-id="test"]').click(); $('btn-inline-edit').click(); await settled();
    await check('palette only appears while editing and provides every root/form', async () => {
      assert(!$('inline-chord-palette').classList.contains('hidden'), 'Inline palette missing');
      assert($('inline-chord-palette').querySelectorAll('[data-root]').length === 12, 'Missing chromatic roots');
      assert($('inline-chord-palette').querySelectorAll('option').length === 14, 'Missing chord forms');
      for (const option of $('inline-chord-palette').querySelectorAll('option')) {
        form('inline-chord-palette', option.value);
        assert(key('inline-chord-palette','C#').title === 'C#'+option.value+'|', 'Form label mismatch');
      }
    });
    await check('inline insertion replaces selection, appends bar and keeps the caret/focus', async () => {
      form('inline-chord-palette','m7'); textRange(0,2); key('inline-chord-palette','C#').click(); await settled();
      assert($('song-content').innerText === 'C#m7| verse','Wrong replacement/bar');
      assert(document.activeElement === $('song-content'),'Editor focus lost');
      key('inline-chord-palette','D').click(); await settled();
      assert($('song-content').innerText === 'C#m7|Dm7| verse','Repeated insertion moved caret');
      assert(stored()[0].content === 'C| verse','Uncommitted draft was saved');
    });
    await check('choosing a chord form retains the original contenteditable insertion point', async () => {
      textRange(3); $('inline-chord-palette').querySelector('select').focus(); form('inline-chord-palette','dim'); key('inline-chord-palette','A#').click(); await settled();
      assert($('song-content').innerText === 'C| A#dim|verse','Selector lost the caret');
      $('btn-save-content-edit').click(); await settled();
      assert(stored()[0].content === 'C| A#dim|verse','Inline draft not saved');
      assert($('inline-chord-palette').classList.contains('hidden'),'Palette leaked into reader');
    });
    $('btn-add-song').click(); await settled();
    await check('new-song palette preserves selection through forms and supports repeated taps', async () => {
      const editor=$('song-content-input');editor.value='Intro tail';editor.focus();editor.setSelectionRange(6,10);
      $('song-chord-palette').querySelector('select').focus();form('song-chord-palette','maj7');key('song-chord-palette','F#').click();
      assert(editor.value==='Intro F#maj7|','Textarea replacement mismatch');
      assert(editor.selectionStart===editor.value.length && document.activeElement===editor,'Textarea caret/focus lost');
      key('song-chord-palette','G').click();assert(editor.value==='Intro F#maj7|Gmaj7|','Textarea repeat order wrong');
      editor.setSelectionRange(editor.value.length-1,editor.value.length);document.execCommand('insertText',false,'-');
      assert(editor.value.endsWith('Gmaj7-'),'Trailing bar cannot be edited');
    });
    await check('chord taps prevent pointer focus changes without blocking the form selector', async () => {
      const editor=$('song-content-input');editor.focus();
      const down=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'touch'});
      key('song-chord-palette','A').dispatchEvent(down);assert(down.defaultPrevented,'Touch would blur the editor/IME');
      const selectDown=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'touch'});
      $('song-chord-palette').querySelector('select').dispatchEvent(selectDown);assert(!selectDown.defaultPrevented,'Form selector blocked');
    });
    await check('all root/form combinations insert correctly in the new-song editor', async () => {
      const editor=$('song-content-input');
      for(const option of $('song-chord-palette').querySelectorAll('option')) {
        form('song-chord-palette',option.value);
        for(const button of $('song-chord-palette').querySelectorAll('[data-root]')) {
          editor.value='';editor.focus();editor.setSelectionRange(0,0);button.click();
          assert(editor.value===button.dataset.root+option.value+'|','Wrong chord '+button.dataset.root+option.value);
        }
      }
    });
    await check('new-song save retains inserted chords', async () => {
      $('song-title-input').value='Palette composition';$('song-content-input').value='';form('song-chord-palette','aug');key('song-chord-palette','G#').click();
      $('song-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settled();
      assert(stored().some(song=>song.title==='PALETTE COMPOSITION'&&song.content==='G#aug|'),'Composition was not saved');
    });
    await check('a fresh song form resets both chord choice and button labels', async () => {
      $('btn-add-song').click();await settled();
      assert($('song-chord-palette').querySelector('select').value==='' && key('song-chord-palette','A').title==='A|','Reset left stale chord labels');
      const editor=$('song-content-input');editor.value='Before after';editor.focus();editor.setSelectionRange(7,7);key('song-chord-palette','A').click();
      assert(editor.value==='Before A|after','Wrong cursor placement');
      document.execCommand('undo');assert(editor.value==='Before after','Chord insertion cannot be undone');
      editor.value='';$('btn-close-song-modal').click();await settled();
    });
    $('btn-inline-edit').click();await settled();
    await check('light/dark layout reserves text space, uses touch targets and keeps save separate', async () => {
      for(const theme of ['light','dark']) {
        document.documentElement.setAttribute('data-theme',theme);
        const host=$('inline-chord-palette'), palette=host.getBoundingClientRect(), actions=$('contenteditable-actions').getBoundingClientRect();
        const content=$('song-content'), highlight=$('contenteditable-highlight');
        assert(palette.top>=actions.bottom && palette.right<=content.getBoundingClientRect().right,'Palette overlaps Save or exceeds editor');
        assert(palette.bottom<=content.getBoundingClientRect().bottom,'Palette exceeds editor height');
        assert(getComputedStyle(content).paddingRight===getComputedStyle(highlight).paddingRight,'Highlight/text gutter mismatch');
        assert(parseFloat(getComputedStyle(content).paddingRight)>=palette.width+16,'Text runs underneath chords');
        assert(key('inline-chord-palette','A').getBoundingClientRect().height>=44,'Touch button too small');
        assert(host.querySelector('.chord-palette-grid').getBoundingClientRect().height>=44,'Compact palette clips an entire chord button');
        assert(document.documentElement.scrollWidth<=innerWidth,'Horizontal page overflow');
      }
    });
    await check('inline minimize/show preserves draft, caret and form while reclaiming text space', async () => {
      const host=$('inline-chord-palette'), toggle=host.querySelector('.chord-palette-toggle');
      form('inline-chord-palette','m7');textRange(3);const before=JSON.stringify(stored());
      const down=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'touch'});
      toggle.dispatchEvent(down);assert(down.defaultPrevented,'Toggle would blur the mobile editor');toggle.click();
      assert(host.querySelector('.chord-palette-body').hidden && toggle.getAttribute('aria-expanded')==='false','Palette did not minimize');
      assert(toggle.getAttribute('aria-label')==='Show chord palette','Restore action unclear');
      assert(document.activeElement===$('song-content') && getSelection().anchorOffset===3,'Minimize lost caret/focus');
      assert(getComputedStyle($('song-content')).paddingRight==='80px' && getComputedStyle($('contenteditable-highlight')).paddingRight==='80px','Minimize did not reclaim matched text space');
      toggle.focus();toggle.click();assert(document.activeElement===toggle,'Keyboard focus lost on restore');
      assert(!host.querySelector('.chord-palette-body').hidden && toggle.getAttribute('aria-expanded')==='true','Palette did not restore');
      assert(host.querySelector('select').value==='m7' && key('inline-chord-palette','C#').title==='C#m7|','Chord form changed on restore');
      key('inline-chord-palette','C#').click();assert($('song-content').innerText==='C| C#m7|verse','Restore lost insertion point');
      assert(JSON.stringify(stored())===before,'Toggle saved a draft');
    });
    await check('inline palette stays above an overlay keyboard and scrolls to the last chord', async () => {
      form('inline-chord-palette', ''); textRange(0);
      await checkKeyboardPalette('inline-chord-palette', $('song-content'));
    });
    await check('new-song minimize/show preserves text selection and its chord form', async () => {
      $('btn-save-content-edit').click();$('btn-add-song').click();await settled();
      const editor=$('song-content-input'), host=$('song-chord-palette'), toggle=host.querySelector('.chord-palette-toggle');
      editor.value='Intro tail';editor.focus();editor.setSelectionRange(6,10);form('song-chord-palette','dim');toggle.click();
      assert(host.querySelector('.chord-palette-body').hidden && getComputedStyle(editor).paddingRight==='80px','Textarea minimize failed');
      toggle.click();key('song-chord-palette','A#').click();assert(editor.value==='Intro A#dim|','Textarea selection/form lost');
      editor.value='';$('btn-close-song-modal').click();$('btn-inline-edit').click();await settled();
    });
    await check('new-song palette adapts to an overlay keyboard without losing the draft', async () => {
      $('btn-save-content-edit').click(); $('btn-add-song').click(); await new Promise(resolve => setTimeout(resolve, 300));
      const editor = $('song-content-input'); editor.value = 'Intro '; editor.focus(); editor.setSelectionRange(6, 6);
      form('song-chord-palette', ''); editor.scrollIntoView({ block: 'center' }); await settled();
      await checkKeyboardPalette('song-chord-palette', editor);
      editor.value = ''; $('btn-close-song-modal').click(); $('btn-inline-edit').click(); await settled();
    });
    form('inline-chord-palette','');textRange(0);
    results.push(results.some(line=>line.startsWith('FAIL'))?'CHECKS FAILED':`ALL ${results.length} CHECKS PASSED; inline preview ready.`);
  } catch(error) { results.push('BOOT FAILED: '+error.stack); }
  parent.postMessage(results.join('\n'),location.origin);
})();
