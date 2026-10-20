// Disposable native-boundary fixture. Runs the shipped reader, not a UI facsimile.
(async () => {
  const $ = id => document.getElementById(id), results = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async predicate => {
    const end = Date.now()+4000;
    while (!predicate()) { if (Date.now()>end) throw Error('Timed out'); await new Promise(r=>setTimeout(r,20)); }
  };
  const check = async (name, action) => {
    try { await action(); results.push('PASS '+name); } catch(e) { results.push('FAIL '+name+': '+e.message); }
  };
  const theme = new URLSearchParams(location.search).get('theme') || 'dark';
  let songs = [
    {id:'a',title:'Morning Light',artist:'Test artist',content:('VERSE\nC|Am|F|G|\n[Quietly] Words for the song\n\n').repeat(40),createdAt:1,updatedAt:1},
    {id:'b',title:'Steady Ground',artist:'Test artist',content:'CHORUS\nD|G|A|\nA short song',createdAt:1,updatedAt:1}
  ];
  let setlists = [{id:'set',name:'Evening set',songIds:['a','b','a'],updatedAt:1}];
  const settings = {'chord-library-theme':theme,'chord-library-font-size':'14','chord-library-tour-seen':'2.4','chord-library-tour-features-seen':'2.4'};
  const snapshot = () => ({...settings,'chord-library-songs':JSON.stringify(songs),'chord-library-setlists':JSON.stringify(setlists)});
  let active = false, patches = [];
  try {
    $('app').innerHTML = await (await fetch('../src/ChordLibrary.Shared/Assets/library.html',{cache:'no-store'})).text();
    document.querySelector('.app-product-logo').src='../src/ChordLibrary.Shared/wwwroot/images/chordkeep.svg';
    await NativeBridge.initialize({invokeMethodAsync:async (method,...args) => {
      if(method==='ReadPerformanceLibrary') return JSON.parse(JSON.stringify({songs,setlists}));
      if(method==='SetPerformanceActive') {
        active=args[0];
        if(!active) NativeBridge.replaceSnapshot(snapshot());
      }
      if(method==='SavePerformanceDisplay') {
        patches.push(args);
        const song=songs.find(s=>s.id===args[0]); if(!song) return false;
        Object.assign(song,args[1]);return true;
      }
      if(method==='ApplyPendingRefresh' && !active) { NativeBridge.replaceSnapshot(snapshot());NativeBridge.setRefreshPending(false); }
    }},snapshot());
    NativeBridge.configure({native:false});
    for(const file of ['qrcode.js','setlist-sort.js','performance.js','app.js']) await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='../src/ChordLibrary.Shared/wwwroot/js/'+file+'?v='+Date.now();
      script.onload=resolve;script.onerror=reject;document.body.append(script);
    });
    const open = async () => {
      $('home-setlists-list').querySelector('[data-id="set"]').click();
      $('btn-setlist-performance').click();await wait(()=>$('perf-title'));
    };
    await check('setlist entry, layout and stable cloud snapshot',async()=>{
      await open();
      assert($('perf-title').textContent==='Morning Light','Wrong first song');
      assert($('perf-previous').disabled,'Previous should be disabled');
      assert(document.querySelector('.app').inert,'Background remains interactive');
      assert(!NativeBridge.canRefresh(),'Cloud delivery not deferred');
      assert(!await NativeBridge.canSwitchAccount(),'Account switch allowed');
      const content=$('perf-content').innerHTML;
      songs[0].title='Cloud title';songs[0].content='Cloud lyrics';setlists[0].songIds.reverse();
      NativeBridge.setRefreshPending(true);
      assert($('perf-content').innerHTML===content,'Cloud replaced session');
      assert(getComputedStyle($('perf-title')).fontSize==='14px','Title is not compact');
      assert(!document.querySelector('.performance-heading').textContent.includes('Test artist'),'Artist displayed');
      const bar=document.querySelector('.performance-controls').getBoundingClientRect();
      const sheetRect=$('perf-sheet').getBoundingClientRect();
      assert(bar.left>=sheetRect.left && bar.right<=sheetRect.right-16,'Controls are outside the chord sheet or cover its scrollbar');
      for(const btn of document.querySelectorAll('.performance-controls button')) {
        const rect=btn.getBoundingClientRect(); assert(rect.height>=44 && rect.width>=44,'Small touch target');
      }
    });
    await check('display patch changes only requested fields',async()=>{
      $('perf-display').click();
      assert(getComputedStyle(document.querySelector('.performance-controls')).display==='none','Floating controls compete with settings');
      const settingsRect=$('perf-settings').getBoundingClientRect();
      assert(settingsRect.left>=0 && settingsRect.right<=innerWidth && settingsRect.bottom<=innerHeight,'Settings clipped');
      assert(document.activeElement===$('perf-close-settings'),'Settings close button not focused');
      assert($('perf-settings').scrollWidth<=$('perf-settings').clientWidth+1,'Settings overflow horizontally');
      assert(Math.abs(settingsRect.left+settingsRect.width/2-innerWidth/2)<2,'Settings not centered');
      assert($('perf-sheet').inert,'Sheet remains interactive behind modal');
      assert($('perf-columns').getAttribute('role')==='switch','Columns control is not a switch');
      $('perf-transpose').value='2';$('perf-transpose').dispatchEvent(new Event('change'));
      await wait(()=>patches.length===1);
      assert(JSON.stringify(patches[0])===JSON.stringify(['a',{transposeSteps:2}]),'Not a field patch');
      assert(songs[0].content==='Cloud lyrics','New cloud content overwritten');
      assert($('perf-content').textContent.includes('Words for the song'),'Snapshot lost');
      NativeBridge.handleBack();
      assert($('perf-settings').hidden && active,'Back did not close settings first');
      assert(!$('perf-sheet').inert,'Back left scrolling disabled');
      for (const dismiss of ['close', 'escape', 'backdrop']) {
        $('perf-display').click();
        $('perf-font').value='16';$('perf-font').dispatchEvent(new Event('change'));
        if (dismiss==='close') $('perf-close-settings').click();
        if (dismiss==='escape') $('perf-close-settings').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        if (dismiss==='backdrop') $('perf-settings-backdrop').click();
        assert($('perf-settings').hidden && !$('perf-sheet').inert, dismiss+' left scrolling disabled');
        $('perf-sheet').focus();
        assert(document.activeElement===$('perf-sheet'),dismiss+' left sheet unfocusable');
      }

    });
    await check('navigation preserves each occurrence and stops scrolling',async()=>{
      $('perf-sheet').scrollTop=220;
      $('perf-play').click(); assert($('perf-play').getAttribute('aria-pressed')==='true','Did not start');
      $('perf-next').click();
      assert($('perf-title').textContent==='Steady Ground' && $('perf-play').getAttribute('aria-pressed')==='false','Navigation did not pause');
      $('perf-next').click();assert($('perf-next').disabled,'End boundary wraps');
      assert($('perf-sheet').scrollTop===0,'Repeated entry reused position');
      $('perf-previous').click();$('perf-previous').click();
      assert(Math.abs($('perf-sheet').scrollTop-220)<4,'Reading position lost');
    });
    await check('manual input and native suspension pause scrolling',async()=>{
      $('perf-play').click();$('perf-sheet').dispatchEvent(new WheelEvent('wheel'));
      assert($('perf-play').getAttribute('aria-pressed')==='false','Wheel did not pause');
      $('perf-play').click(); NativeBridge.suspendPerformance();
      assert($('perf-play').getAttribute('aria-pressed')==='false','Native suspension did not pause');
      $('perf-sheet').focus();$('perf-sheet').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
      assert($('perf-play').getAttribute('aria-pressed')==='true','Space did not start');
      NativeBridge.suspendPerformance();
    });
    await check('bottom detection, swipe navigation and keyboard focus containment',async()=>{
      $('perf-sheet').scrollTop=$('perf-sheet').scrollHeight-$('perf-sheet').clientHeight-1;
      $('perf-play').click();await wait(()=>$('perf-play').getAttribute('aria-pressed')==='false');
      assert($('perf-title').textContent==='Morning Light','Auto-scroll advanced song');
      const touch=(type,x,y)=>{
        const event=new Event(type,{bubbles:true});
        Object.defineProperty(event,'touches',{value:[{clientX:x,clientY:y}]});
        Object.defineProperty(event,'changedTouches',{value:[{clientX:x,clientY:y}]});
        $('perf-sheet').dispatchEvent(event);
      };
      touch('touchstart',250,100);touch('touchend',240,300);
      assert($('perf-title').textContent==='Morning Light','Vertical scroll changed song');
      touch('touchstart',250,100);touch('touchend',40,110);
      assert($('perf-title').textContent==='Steady Ground','Swipe did not navigate');
      $('perf-display').focus();
      $('perf-display').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      assert(document.activeElement===$('perf-sheet'),'Tab escaped dialog');
      $('perf-display').click();
      $('perf-display').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert($('perf-settings').hidden && active,'Escape did not close settings');
      $('perf-previous').click();
    });
    await check('Back exits, applies cloud updates and releases background',async()=>{
      NativeBridge.handleBack();await wait(()=>!$('perf-title'));
      assert(!active && !document.querySelector('.app').inert,'Session not released');
      assert($('app-title').textContent.includes('Cloud title'),'New cloud title not delivered');
      assert($('song-content').textContent.includes('Cloud lyrics'),'New cloud content not delivered');
    });
    await check('standalone entry hides song navigation and handles removed song',async()=>{
      $('btn-home').click();
      $('home-songs-list').querySelector('[data-id="a"]').click();
      $('btn-song-performance').click();await wait(()=>$('perf-title'));
      assert($('perf-previous').hidden && $('perf-next').hidden,'Standalone navigation visible');
      songs=songs.filter(s=>s.id!=='a');
      $('perf-display').click();$('perf-font').value='20';$('perf-font').dispatchEvent(new Event('change'));
      await wait(()=>$('perf-notice').textContent.includes('removed'));
      $('perf-exit').click();await wait(()=>!$('perf-title'));
      assert(!songs.some(s=>s.id==='a'),'Deleted song resurrected');
      assert($('app-title').textContent==='ChordKeep','Missing song did not return home');
    });
    await check('missing references prompt before starting; empty setlist cannot start',async()=>{
      $('home-setlists-list').querySelector('[data-id="set"]').click();
      $('btn-setlist-performance').click();
      await wait(()=>$('confirm-title').textContent==='Some songs are unavailable');
      assert($('confirm-message').textContent.includes('2 missing'),'Missing reference count incorrect');
      $('btn-confirm-delete').click();await wait(()=>$('perf-title'));
      assert($('perf-title').textContent==='Steady Ground','Missing references not skipped');
      $('perf-exit').click();await wait(()=>!$('perf-title'));
      setlists[0].songIds=['missing'];NativeBridge.replaceSnapshot(snapshot(),true);
      $('home-setlists-list').querySelector('[data-id="set"]').click();
      assert($('btn-setlist-performance').disabled,'Empty performance enabled');
      $('btn-home').click();
    });
    await check('unsaved editing requires explicit discard before entry',async()=>{
      $('home-songs-list').querySelector('[data-id="b"]').click();
      $('btn-inline-edit').click();
      if(!$('song-content').isContentEditable) throw Error('Editor did not open');
      $('song-content').textContent='Unsaved text';$('song-content').dispatchEvent(new Event('input',{bubbles:true}));
      $('btn-song-performance').click();
      await wait(()=>$('confirm-title').textContent==='Discard unsaved changes?');
      assert(!$('perf-title'),'Performance opened over unsaved changes');
      $('btn-cancel-confirm').click();
      assert($('song-content').textContent==='Unsaved text','Cancel discarded draft');
      $('btn-song-performance').click();$('btn-confirm-delete').click();
      await wait(()=>$('perf-title'));
      assert(!$('perf-content').textContent.includes('Unsaved text'),'Draft leaked into session');
      $('perf-exit').click();await wait(()=>!$('perf-title'));
    });
    // Leave a readable long sheet available for manual visual inspection.
    songs[0].content=('VERSE\nD|G|A|\n[Softly] A line for reading\n\n').repeat(35);
    NativeBridge.replaceSnapshot(snapshot(),true);
    $('home-songs-list').querySelector('[data-id="b"]').click();
    $('btn-song-performance').click();await wait(()=>$('perf-title'));
  } catch(e) {results.push('FAIL fixture: '+e.stack);}
  $('results').textContent=results.join('\n');
  if (new URLSearchParams(location.search).has('visual')) $('results').hidden=true;
  document.title=results.some(r=>r.startsWith('FAIL'))?'FAIL performance':'PASS performance';
})();
