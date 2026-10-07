// Browser regression checks against the actual shipped markup and scripts.
(async () => {
  const results = [];
  const byId = id => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const check = async (name, run) => {
    try { await run(); results.push('PASS ' + name); }
    catch (error) { results.push('FAIL ' + name + ': ' + error.message); }
  };
  let songs, setlists;
  const nativeCalls = [];
  let deferredCloudSnapshot = null;
  const settings = { 'chord-library-tour-seen': '2.4', 'chord-library-tour-features-seen': '2.4',
    'chord-library-font-size': '14', 'chord-library-theme': 'dark' };
  const snapshot = () => ({ ...settings, 'chord-library-songs': JSON.stringify(songs), 'chord-library-setlists': JSON.stringify(setlists) });
  const reset = async () => {
    const now = Date.now();
    songs = Array.from({ length: 35 }, (_, index) => ({ id: 'song-' + index, title: 'Song ' + index,
      artist: 'Artist', content: ('C G Am F\nWords for the chord sheet\n').repeat(70),
      createdAt: now - 100000, updatedAt: now - index * 1000, transposeSteps: 0 }));
    setlists = [{ id: 'set', name: 'Practice', description: 'A test set', songIds: ['song-0', 'song-1', 'song-0'], updatedAt: now }];
    await NativeBridge.flush(); NativeBridge.replaceSnapshot(snapshot(), true); await settled();
  };
  const sync = async () => { await NativeBridge.flush(); NativeBridge.replaceSnapshot(snapshot()); await settled(); };
  const button = (root, id) => byId(root).querySelector('[data-id="' + id + '"]');
  const openSidebar = () => { if (innerWidth < 768 && !byId('sidebar').classList.contains('open')) byId('menu-toggle').click(); };
  try {
    byId('app').innerHTML = await (await fetch('../src/ChordLibrary.Shared/Assets/library.html')).text();
    document.querySelector('.app-product-logo').src='../src/ChordLibrary.Shared/wwwroot/images/chordkeep.svg';
    await NativeBridge.initialize({ invokeMethodAsync: async method => {
      nativeCalls.push(method);
      if (method === 'ApplyPendingRefresh' && deferredCloudSnapshot) {
        NativeBridge.replaceSnapshot(deferredCloudSnapshot); deferredCloudSnapshot = null;
        NativeBridge.setRefreshPending(false);
      }
    } }, settings);
    NativeBridge.configure({ native: false });
    for (const file of ['qrcode.js', 'setlist-sort.js', 'app.js']) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src='../src/ChordLibrary.Shared/wwwroot/js/'+file+'?fixture='+Date.now();
      script.onload=resolve;script.onerror=reject;document.body.appendChild(script);
    });
    await reset();
    await check('drawer toggle reflects open and closed state through every dismissal route', async () => {
      const toggle = byId('menu-toggle'), drawer = byId('sidebar');
      const waitForAnimation = () => new Promise(resolve => setTimeout(resolve, 260));
      const verify = async expanded => {
        await waitForAnimation();
        assert(toggle.getAttribute('aria-expanded') === String(expanded), 'Toggle state is stale');
        assert(toggle.getAttribute('aria-label') === (expanded ? 'Hide library panel' : 'Show library panel'), 'Accessible action is stale');
        const middle = getComputedStyle(toggle.querySelector('.menu-toggle-line-middle'));
        assert(Number(middle.opacity) === (expanded ? 0 : 1), 'Icon does not match drawer state');
        const top = new DOMMatrix(getComputedStyle(toggle.querySelector('.menu-toggle-line-top')).transform);
        const bottom = new DOMMatrix(getComputedStyle(toggle.querySelector('.menu-toggle-line-bottom')).transform);
        if (expanded) assert(top.b > 0.7 && bottom.b < -0.7, 'Open icon is not an X');
        else assert(top.f === -6 && bottom.f === 6 && top.b === 0 && bottom.b === 0, 'Closed icon is not a hamburger');
      };
      if (innerWidth >= 768) {
        if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
        await verify(true); toggle.click(); await verify(false);
        assert(document.body.classList.contains('sidebar-collapsed'), 'Desktop panel did not collapse');
        toggle.click(); await verify(true);
      } else {
        if (drawer.classList.contains('open')) toggle.click();
        await verify(false); toggle.click(); await verify(true);
        document.querySelector('.sidebar-overlay').click(); await verify(false);
        toggle.click(); await verify(true); NativeBridge.handleBack(); await verify(false);
        toggle.click(); button('song-list', 'song-0').click(); await verify(false);
        NativeBridge.handleBack(); await settled();
      }
      await reset();
    });
    await check('drawer song search matches only title and artist, including after sync', async () => {
      const input = byId('search-input');
      const search = async value => {
        input.value = value; input.dispatchEvent(new Event('input'));
        await new Promise(resolve => setTimeout(resolve, 180)); await settled();
      };
      songs = [
        { ...songs[0], id: 'title-match', title: 'Morning Grace', artist: 'Other', content: 'Dm7\nonly_in_lyrics' },
        { ...songs[1], id: 'artist-match', title: 'Another Song', artist: 'Grace Ensemble', content: 'Dm7' },
        { ...songs[2], id: 'body-only', title: 'Third Song', artist: '', content: 'Grace\nDm7\nonly_in_lyrics' }
      ];
      await sync(); await search('  gRaCe  ');
      assert(button('song-list', 'title-match') && button('song-list', 'artist-match'), 'Title/artist match missing');
      assert(!button('song-list', 'body-only') && byId('song-list-summary').textContent === '2 results', 'Lyrics included in search');
      songs[2].artist = 'Grace Writer'; await sync();
      assert(button('song-list', 'body-only'), 'New artist match not added after sync');
      songs[2].artist = ''; await sync();
      assert(!button('song-list', 'body-only'), 'Former artist match remains after sync');
      for (const query of ['only_in_lyrics', 'Dm7']) {
        await search(query); assert(!byId('song-list').querySelector('.song-item'), 'Lyrics/chord-only match shown');
      }
      await search('   '); assert(byId('song-list').querySelectorAll('.song-item').length === 3, 'Blank search did not restore all songs');
      await reset();
    });
    await check('no-change snapshot produces zero content mutations', async () => {
      let mutations = 0;
      const observer = new MutationObserver(records => mutations += records.length);
      observer.observe(byId('content'), { subtree: true, childList: true, attributes: true, characterData: true });
      await sync(); observer.disconnect(); assert(mutations === 0, 'Content mutations: ' + mutations);
    });
    await check('home update retains both the changed row and untouched neighboring row', async () => {
      const changed = button('home-songs-list', 'song-0'), unchanged = button('home-songs-list', 'song-1');
      let untouched = 0;
      const observer = new MutationObserver(records => untouched += records.length);
      observer.observe(unchanged, { subtree: true, childList: true, attributes: true, characterData: true });
      songs[0].title = '<New title & chords>'; await sync(); observer.disconnect();
      assert(button('home-songs-list','song-0') === changed, 'Changed button replaced');
      assert(changed.querySelector('strong').textContent === '<New title & chords>', 'Escaping or title update failed');
      assert(button('home-songs-list','song-1') === unchanged && untouched === 0, 'Unchanged row modified');
      assert(getComputedStyle(changed.parentElement).animationName === 'none', 'Entrance animation replayed');
    });
    await check('insert and re-sort preserve keyboard focus and drawer scroll anchor', async () => {
      openSidebar(); await settled();
      const list = byId('song-list'); list.scrollTop = 620; await settled();
      const top = list.getBoundingClientRect().top;
      const row = Array.from(list.children).find(item => item.getBoundingClientRect().bottom > top);
      const offset = row.getBoundingClientRect().top - top;
      const focused = row.querySelector('button'); focused.focus({preventScroll:true});
      songs.push({ ...songs[0], id: 'new', title: 'Newly added', updatedAt: Date.now() + 1000 });
      await sync();
      assert(document.activeElement === focused, 'Keyboard focus lost');
      assert(Math.abs(row.getBoundingClientRect().top - list.getBoundingClientRect().top - offset) < 2, 'Scroll anchor moved');
      assert(button('song-list', 'new'), 'New row absent');
      songs[20].updatedAt = Date.now() + 2000; await sync();
      assert(document.activeElement === focused, 'Focus lost during re-sort');
    });
    await check('filtered library inserts only matching new items', async () => {
      const input = byId('search-input'); input.value='Newly'; input.dispatchEvent(new Event('input'));
      songs.push({ ...songs[0], id: 'match', title: 'Newly matched', updatedAt: Date.now() + 3000 });
      await sync(); assert(button('song-list','match'), 'Matching item absent');
      assert(!button('song-list','song-2'), 'Nonmatching item displayed');
      input.value=''; input.dispatchEvent(new Event('input')); await new Promise(resolve => setTimeout(resolve, 180)); await settled();
    });
    await check('Refresh is wired to native sync, shows progress and leaves existing rows intact', async () => {
      const before = nativeCalls.filter(method => method === 'RefreshLibrary').length;
      const row = button('home-songs-list','song-0');
      const refresh = byId('btn-refresh-library');
      refresh.click(); await settled();
      assert(nativeCalls.filter(method => method === 'RefreshLibrary').length === before + 1, 'Refresh did not request native sync');
      assert(button('home-songs-list','song-0') === row, 'Refresh replaced the displayed page');
      NativeBridge.setAccount({signedIn:true,status:'syncing'});
      assert(refresh.disabled && refresh.getAttribute('aria-busy') === 'true', 'Progress state missing');
      NativeBridge.setAccount({signedIn:true,status:'idle'});
      assert(!refresh.disabled && refresh.getAttribute('aria-busy') === 'false', 'Refresh stayed disabled');
      NativeBridge.setAccount({signedIn:false,status:'offline'});
    });
    await check('cloud changes waiting behind an editor appear on close without another sync', async () => {
      await reset(); button('home-songs-list','song-0').click(); await settled();
      byId('btn-inline-edit').click(); await settled();
      const deliveredBefore = nativeCalls.filter(method => method === 'ApplyPendingRefresh').length;
      const pullsBefore = nativeCalls.filter(method => method === 'RefreshLibrary').length;
      songs[1].title = 'Cloud title received during editing'; deferredCloudSnapshot = snapshot();
      NativeBridge.setRefreshPending(true); await settled();
      assert(nativeCalls.filter(method => method === 'ApplyPendingRefresh').length === deliveredBefore, 'Editor was interrupted');
      NativeBridge.handleBack(); await settled();
      assert(nativeCalls.filter(method => method === 'ApplyPendingRefresh').length === deliveredBefore + 1, 'Deferred update did not arrive on editor close');
      assert(nativeCalls.filter(method => method === 'RefreshLibrary').length === pullsBefore, 'Editor close polled cloud again');
      assert(button('song-list','song-1').querySelector('strong').textContent === songs[1].title, 'Cloud change not displayed');
      await reset();
    });
    await check('quick symbols keep focus and caret in both editors and no key guess is shown', async () => {
      await reset();
      const tap = button => {
        const down = new PointerEvent('pointerdown', {bubbles:true,cancelable:true,isPrimary:true,pointerType:'touch'});
        assert(!button.dispatchEvent(down), 'Touch default focus was not prevented');
        button.click();
      };
      byId('btn-add-song').click(); await settled();
      const textarea = byId('song-content-input'); let blurs = 0;
      const countBlur = () => blurs++;
      textarea.value = 'CG'; textarea.focus(); textarea.setSelectionRange(1,1);
      textarea.addEventListener('blur', countBlur);
      tap(document.querySelector('#song-modal [data-char="#"]'));
      assert(textarea.value === 'C#G' && textarea.selectionStart === 2 && document.activeElement === textarea, 'Textarea symbol/caret/focus changed');
      textarea.setSelectionRange(0,2); tap(document.querySelector('#song-modal [data-pair="[]"]'));
      assert(textarea.value === '[C#]G' && textarea.selectionStart === 3 && blurs === 0, 'Textarea pair insertion reset focus or caret');
      textarea.removeEventListener('blur', countBlur);
      byId('btn-cancel-song').click();
      button('home-songs-list','song-0').click(); await settled();
      assert(!byId('song-key-info') && !byId('key-badge'), 'Automatic key identifier remains');
      byId('btn-inline-edit').click(); await settled();
      const editor = byId('song-content'); editor.textContent = 'CG'; editor.dispatchEvent(new Event('input',{bubbles:true})); editor.focus();
      const range = document.createRange(); range.setStart(editor.firstChild,1); range.collapse(true);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      blurs = 0; editor.addEventListener('blur', countBlur);
      tap(document.querySelector('[data-inline-char="#"]'));
      assert(editor.textContent === 'C#G' && document.activeElement === editor, 'Inline symbol lost selection or focus');
      const pairRange = document.createRange(); pairRange.selectNodeContents(editor);
      getSelection().removeAllRanges(); getSelection().addRange(pairRange);
      tap(document.querySelector('[data-inline-pair="[]"]'));
      assert(editor.textContent === '[C#G]' && blurs === 0 && document.activeElement === editor, 'Inline pair reset focus');
      editor.removeEventListener('blur', countBlur);
      NativeBridge.handleBack(); byId('btn-confirm-delete').click();
      await reset();
    });
    await check('older WebViews preserve focus and scroll without moveBefore', async () => {
      const list=byId('song-list');
      Object.defineProperty(list,'moveBefore',{value:undefined,configurable:true});
      list.scrollTop=450;await settled();
      const row=Array.from(list.children).find(item=>item.getBoundingClientRect().bottom>list.getBoundingClientRect().top);
      const offset=row.getBoundingClientRect().top-list.getBoundingClientRect().top;
      const focused=row.querySelector('button');focused.focus({preventScroll:true});
      songs[30].updatedAt=Date.now()+5000;await sync();
      assert(document.activeElement===focused,'Fallback move lost focus');
      assert(Math.abs(row.getBoundingClientRect().top-list.getBoundingClientRect().top-offset)<2,'Fallback move lost scroll');
      delete list.moveBefore;
    });
    await check('chord patches preserve leading indentation and trailing blank lines', async () => {
      const probe=document.createElement('pre');document.body.appendChild(probe);
      LibraryView.patchHtml(probe,'  <span>C</span> G\n\n');
      assert(probe.textContent==='  C G\n\n','Chord whitespace changed');
      const chord=probe.querySelector('span');LibraryView.patchHtml(probe,'  <span>D</span> G\n\n');
      assert(probe.querySelector('span')===chord && probe.textContent==='  D G\n\n','Changed chord whitespace changed');
      probe.remove();
    });
    await check('unrelated song sync preserves the open sheet, selection and scroll', async () => {
      openSidebar(); button('song-list','song-0').click(); await settled();
      const sheet = byId('song-content'), section = byId('song-content-section');
      section.scrollTop=350; const scrollTop=section.scrollTop;
      const original = sheet.firstChild;
      const range = document.createRange(); range.selectNodeContents(sheet.querySelector('.chord'));
      getSelection().removeAllRanges();getSelection().addRange(range);
      let mutations=0;const observer=new MutationObserver(records => mutations+=records.length);
      observer.observe(sheet,{subtree:true,childList:true,characterData:true});
      songs[3].content='Dm G C';await sync();observer.disconnect();
      assert(sheet.firstChild===original && mutations===0,'Open sheet was redrawn');
      assert(section.scrollTop===scrollTop,'Sheet scroll changed');
      assert(getSelection().toString()==='C','Text selection lost');
    });
    await check('current song metadata updates without replacing chord nodes', async () => {
      const sheet=byId('song-content'), chord=sheet.querySelector('.chord');
      const section=byId('song-content-section'), scrollTop=section.scrollTop;
      songs[0].title='Renamed current song';await sync();
      assert(byId('app-title').textContent.includes('Renamed current song'),'Header did not update');
      assert(sheet.querySelector('.chord')===chord,'Chord node replaced for metadata-only update');
      assert(section.scrollTop===scrollTop,'Sheet position lost');
      songs[0].content=songs[0].content.replace('C G','D A');await sync();
      assert(sheet.querySelector('.chord')===chord && chord.textContent==='D','Changed chord not patched in place');
      assert(section.scrollTop===scrollTop,'Sheet position lost after content change');
    });
    await check('setlist updates preserve duplicate rows and update navigation after reorder', async () => {
      await reset();
      document.querySelector('[data-tab="setlists"]').click(); openSidebar(); button('setlist-list','set').click();await settled();
      const rows=Array.from(byId('setlist-songs').children);
      setlists[0].songIds=['song-0','song-0','song-1'];await sync();
      assert(byId('setlist-songs').children[1]===rows[2],'Repeated song row replaced');
      const open=rows[0].querySelector('.setlist-song-open');open.click();await settled();
      setlists[0].songIds=['song-1','song-0','song-0'];setlists[0].name='Renamed set';await sync();
      assert(byId('nav-hint-info').textContent==='2 / 3','Navigation index stale');
      assert(byId('btn-back-setlist-label').textContent==='Renamed set','Back label stale');
      setlists[0].songIds=['song-1'];await sync();
      assert(byId('song-nav-hint').classList.contains('hidden'),'Removed membership leaves navigation visible');
      assert(byId('btn-back-setlist').classList.contains('hidden'),'Removed membership leaves back action visible');
    });
    await check('drag interaction defers refresh and remote current-song deletion has a valid fallback', async () => {
      byId('setlist-songs')._syncInteraction=true;
      assert(!NativeBridge.canRefresh(),'Sync allowed while dragging');
      byId('setlist-songs')._syncInteraction=false;
      songs=songs.filter(song=>song.id!=='song-0');await sync();
      assert(byId('song-detail').classList.contains('hidden'),'Deleted song remains visible');
      assert(!byId('setlist-detail').classList.contains('hidden'),'Setlist fallback absent');
    });
    await check('focused remote deletion selects a neighbor and account reset clears the old sheet', async () => {
      await reset(); document.querySelector('[data-tab="songs"]').click(); openSidebar(); await settled();
      const focused=button('song-list','song-1');focused.focus({preventScroll:true});
      songs=songs.filter(song=>song.id!=='song-1');await sync();
      assert(!focused.isConnected && byId('song-list').contains(document.activeElement),'Focus did not move to a surviving neighbor');
      button('song-list','song-0').click(); await settled();
      songs=[];setlists=[];await NativeBridge.flush();NativeBridge.replaceSnapshot(snapshot(),true);await settled();
      assert(byId('song-content').textContent==='','Old account sheet retained');
      assert(!byId('empty-state').classList.contains('hidden'),'Empty home absent after reset');
    });
    await check('Back returns song to setlist to home, and only home allows backgrounding', async () => {
      await reset();
      button('home-setlists-list','set').click(); await settled();
      byId('setlist-songs').querySelector('.setlist-song-open').click(); await settled();
      assert(NativeBridge.handleBack() === true, 'Song Back not consumed'); await settled();
      assert(!byId('setlist-detail').classList.contains('hidden'), 'Setlist parent not restored');
      assert(NativeBridge.handleBack() === true, 'Setlist Back not consumed'); await settled();
      assert(!byId('empty-state').classList.contains('hidden'), 'Home not restored');
      assert(NativeBridge.handleBack() === false, 'Home does not allow backgrounding');
    });
    await check('Back restores the previous standalone song and its scroll position', async () => {
      await reset(); button('home-songs-list','song-0').click(); await settled();
      const title = byId('app-title').textContent;
      byId('song-content-section').scrollTop = 240; await settled();
      const scroll = byId('song-content-section').scrollTop;
      assert(scroll > 0, 'Fixture sheet is not scrollable');
      document.querySelector('[data-tab="songs"]').click(); openSidebar();
      button('song-list','song-1').click(); await settled();
      assert(NativeBridge.handleBack(), 'Previous song Back not consumed'); await settled();
      assert(byId('app-title').textContent === title, 'Previous song not restored');
      assert(Math.abs(byId('song-content-section').scrollTop - scroll) < 2, 'Previous song scroll lost');
      NativeBridge.handleBack(); await settled();
      assert(NativeBridge.handleBack() === false, 'Navigation created a Back loop');
    });
    await check('Back closes the top modal, menus and mobile drawer before navigating', async () => {
      await reset(); button('home-songs-list','song-0').click(); await settled();
      byId('btn-preferences').click(); await settled();
      assert(NativeBridge.handleBack(), 'Preferences Back not consumed'); await settled();
      assert(byId('preferences-modal').classList.contains('hidden'), 'Preferences remains open');
      assert(!byId('song-detail').classList.contains('hidden'), 'Back also navigated behind modal');
      byId('btn-song-actions').click();
      assert(NativeBridge.handleBack(), 'Menu Back not consumed');
      assert(byId('song-actions-menu').classList.contains('hidden'), 'Actions menu remains open');
      if (innerWidth < 768) {
        openSidebar(); assert(NativeBridge.handleBack(), 'Drawer Back not consumed');
        assert(!byId('sidebar').classList.contains('open'), 'Drawer remains open');
        assert(!byId('song-detail').classList.contains('hidden'), 'Back navigated behind drawer');
      }
    });
    await check('Back protects unsaved song and setlist forms and inline chords', async () => {
      await reset();
        byId('btn-add-song').click(); await settled();
        byId('song-title-input').value = 'Unsaved song';
        assert(NativeBridge.handleBack(), 'Dirty form Back not consumed');
        assert(!byId('confirm-modal').classList.contains('hidden'), 'Branded prompt missing');
        byId('btn-cancel-confirm').click();
        assert(!byId('song-modal').classList.contains('hidden'), 'Canceled discard lost the form');
        assert(byId('song-title-input').value === 'Unsaved song', 'Draft lost');
        const formSave=byId('song-form').querySelector('button[type="submit"]');formSave.focus();
        formSave.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
        assert(document.activeElement===byId('btn-close-song-modal'),'Nested discard broke parent focus trap');
        NativeBridge.handleBack(); byId('btn-confirm-delete').click(); await settled();
        assert(byId('song-modal').classList.contains('hidden'), 'Accepted discard did not close form');
        button('home-setlists-list','set').click(); await settled();
        byId('btn-edit-setlist').click(); await settled();
        byId('setlist-name-input').value = 'Unsaved set';
        NativeBridge.handleBack();
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
        assert(!byId('setlist-modal').classList.contains('hidden'), 'Canceled setlist discard lost form');
        assert(byId('setlist-name-input').value === 'Unsaved set', 'Escape lost setlist draft');
        NativeBridge.handleBack(); byId('btn-confirm-delete').click(); await settled();
        byId('setlist-songs').querySelector('.setlist-song-open').click(); await settled();
        byId('btn-inline-edit').click(); await settled();
        byId('song-content').textContent = 'Unsaved chords';
        byId('song-content').dispatchEvent(new Event('input', { bubbles: true }));
        NativeBridge.handleBack();
        assert(byId('btn-cancel-confirm').textContent === 'Keep editing' && byId('btn-confirm-delete').textContent === 'Discard changes', 'Discard actions unclear');
        assert(NativeBridge.handleBack(), 'Prompt Back not consumed');
        assert(byId('song-content').isContentEditable, 'Canceled chord discard ended edit');
        assert(byId('song-content').textContent === 'Unsaved chords', 'Prompt Back lost draft');
        NativeBridge.handleBack(); byId('btn-confirm-delete').click(); await settled();
        assert(!byId('song-content').isContentEditable, 'Accepted chord discard did not end edit');
        assert(!byId('song-detail').classList.contains('hidden'), 'Editor Back navigated away from song');
        assert(byId('inline-chord-palette').classList.contains('hidden'), 'Palette remains after discard');
    });
    await check('branded discard defers navigation and resumes only the confirmed action', async () => {
      await reset();button('home-songs-list','song-0').click();await settled();byId('btn-inline-edit').click();await settled();
      const editor=byId('song-content');editor.textContent='Draft chords';editor.dispatchEvent(new Event('input',{bubbles:true}));editor.focus();
      const range=document.createRange();range.setStart(editor.firstChild,5);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);
      byId('btn-cancel-content-edit').click();await settled();
      assert(!NativeBridge.canRefresh(),'Refresh allowed during discard');
      byId('btn-cancel-confirm').click();await settled();
      assert(editor.isContentEditable && editor.textContent==='Draft chords','Keep editing changed draft');
      assert(document.activeElement===editor && getSelection().anchorOffset===5,'Keep editing lost editor focus/caret');
      editor.focus();byId('btn-home').click();
      assert(!byId('song-detail').classList.contains('hidden'),'Navigated before confirmation');
      byId('btn-confirm-delete').click();await settled();
      assert(!byId('empty-state').classList.contains('hidden') && byId('song-detail').classList.contains('hidden'),'Confirmed Home did not resume');
      assert(JSON.parse(LibraryStorage.getItem('chord-library-songs'))[0].content===songs[0].content,'Discard saved draft');
    });
    await check('account change waits for branded confirmation and cancellation settles the request', async () => {
      await reset();button('home-songs-list','song-0').click();await settled();byId('btn-inline-edit').click();await settled();
      const editor=byId('song-content');editor.textContent='Account draft';editor.dispatchEvent(new Event('input',{bubbles:true}));
      let completed=false;const canceled=NativeBridge.canSwitchAccount().then(value=>{completed=true;return value;});
      await settled();assert(!completed,'Account changed before decision');
      assert(await NativeBridge.canSwitchAccount()===false,'Repeated account request replaced pending decision');
      assert(NativeBridge.dismissConfirmation(),'Native Back could not cancel account prompt');
      assert(await canceled===false && editor.isContentEditable && editor.textContent==='Account draft','Cancel lost draft or hung account action');
      const allowed=NativeBridge.canSwitchAccount();await settled();byId('btn-confirm-delete').click();
      assert(await allowed===true && !editor.isContentEditable,'Accepted account change did not resume');
      byId('btn-add-song').click();await settled();
      assert(await NativeBridge.canSwitchAccount()===true,'Unchanged form showed a discard prompt');
      byId('song-title-input').value='Account form draft';
      const canceledForm=NativeBridge.canSwitchAccount();await settled();NativeBridge.dismissConfirmation();
      assert(await canceledForm===false && byId('song-title-input').value==='Account form draft','Form cancellation lost draft or hung');
      const allowedForm=NativeBridge.canSwitchAccount();await settled();byId('btn-confirm-delete').click();
      assert(await allowedForm===true,'Accepted form account change did not resume');
    });
    await check('Back skips remotely deleted history and account changes clear navigation', async () => {
      await reset(); button('home-songs-list','song-0').click(); await settled();
      document.querySelector('[data-tab="songs"]').click(); openSidebar(); button('song-list','song-1').click(); await settled();
      songs = songs.filter(song => song.id !== 'song-0'); await sync();
      NativeBridge.handleBack(); await settled();
      assert(!byId('empty-state').classList.contains('hidden'), 'Deleted historical song reappeared');
      button('home-songs-list','song-1').click(); await settled();
      await reset();
      assert(NativeBridge.handleBack() === false, 'Old account navigation survived reset');
    });
    await check('account badge remains colored above the avatar in both themes and all sync states', async () => {
      await reset();
      const avatar = byId('user-avatar'), icon = byId('user-icon'), dot = byId('sync-indicator');
      const theme = document.documentElement.getAttribute('data-theme');
      dot.style.transition = 'none';
      avatar.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Ccircle cx="16" cy="16" r="16" fill="%232fa59b"/%3E%3C/svg%3E';
      try {
        for (const mode of ['light','dark']) {
          document.documentElement.setAttribute('data-theme', mode);
          for (const state of ['idle','syncing','error','offline']) {
            NativeBridge.setAccount({ signedIn: true, status: state });
            avatar.classList.remove('hidden'); icon.classList.add('hidden');
            const style = getComputedStyle(dot), rect = dot.getBoundingClientRect();
            assert(style.backgroundColor !== 'rgba(0, 0, 0, 0)', mode + '/' + state + ' badge is transparent');
            assert(Number(style.zIndex) > (Number(getComputedStyle(avatar).zIndex) || 0), 'Badge is behind avatar');
            assert(rect.width >= 12 && rect.height >= 12 && rect.right <= innerWidth && rect.top >= 0, 'Badge is clipped');
            assert(byId('user-btn').getAttribute('aria-label').includes(dot.title), 'Status is not accessible');
          }
        }
      } finally {
        document.documentElement.setAttribute('data-theme', theme);
        dot.style.removeProperty('transition');
        avatar.removeAttribute('src'); avatar.classList.add('hidden'); icon.classList.remove('hidden');
        NativeBridge.setAccount({ signedIn: false, status: 'offline' });
      }
    });
  } catch (error) { results.push('FAIL fixture initialization: '+error.stack); }
  const failed=results.filter(result=>result.startsWith('FAIL')).length;
  parent.postMessage(`${results.length-failed}/${results.length} passed at ${innerWidth}px\n`+results.join('\n'),location.origin);
})();
