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
    await NativeBridge.initialize({ invokeMethodAsync: async () => undefined }, settings);
    NativeBridge.configure({ native: false });
    for (const file of ['qrcode.js', 'app.js']) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src='../src/ChordLibrary.Shared/wwwroot/js/'+file;
      script.onload=resolve;script.onerror=reject;document.body.appendChild(script);
    });
    await reset();
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
  } catch (error) { results.push('FAIL fixture initialization: '+error.stack); }
  const failed=results.filter(result=>result.startsWith('FAIL')).length;
  parent.postMessage(`${results.length-failed}/${results.length} passed at ${innerWidth}px\n`+results.join('\n'),location.origin);
})();
