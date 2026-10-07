// Disposable in-memory design preview. No authentication, database or native storage is used.
(async()=>{
  const params=new URLSearchParams(location.search);
  const proposed=params.get('design')!=='current', theme=params.get('theme')==='light'?'light':'dark';
  document.documentElement.dataset.preview=proposed?'proposed':'current';
  const root=document.getElementById('app');
  root.innerHTML=await(await fetch('../../src/ChordLibrary.Shared/Assets/library.html')).text();
  root.querySelector('.app-product-logo').src='../../branding/chordkeep/assets/app-crimson.svg';
  const now=Date.now();
  const songs=[
    {id:'morning',title:'MORNING LIGHT',artist:'Studio Collective',content:'INTRO\nC|G|Am|F|\n\nVERSE\nC|G| Am|F|\nA new day rises, the sky is clear\nC|G| F|C|\nWe carry hope through every year\n\nCHORUS\nF|C|G|Am|\nStep into the morning light\nF|C|G|C|\nKeep our purpose in our sight\n\nBRIDGE\nDm7|F|C|G|\n\nOUTRO\nF|G|C|',updatedAt:now,createdAt:now-86400000},
    {id:'steady',title:'STEADY GROUND',artist:'Northbound',content:'INTRO\nD|A|Bm|G|\n\nVERSE\nD|A|G|D|\n\nCHORUS\nG|D|A|Bm|',updatedAt:now-600000,createdAt:now-86400000},
    {id:'open',title:'OPEN HORIZONS',artist:'The Daybreak Sessions',content:'INTRO\nG|D|Em|C|\n\nCHORUS\nC|G|D|Em|',updatedAt:now-3600000,createdAt:now-86400000},
    {id:'way',title:'THE WAY AHEAD',artist:'Studio Collective',content:'VERSE\nE|B|C#m|A|',updatedAt:now-7200000,createdAt:now-86400000},
    {id:'quiet',title:'QUIET MOMENTS',artist:'Northbound',content:'VERSE\nF|C|Dm|Bb|',updatedAt:now-86400000,createdAt:now-86400000}
  ];
  const setlists=[{id:'sunday',name:'Sunday gathering',description:'Morning set · 4 songs',songIds:['morning','steady','open','way'],updatedAt:now,createdAt:now},{id:'rehearsal',name:'Midweek rehearsal',description:'Practice and transitions',songIds:['quiet','morning','open'],updatedAt:now-86400000,createdAt:now-86400000}];
  const snapshot={'chord-library-songs':JSON.stringify(songs),'chord-library-setlists':JSON.stringify(setlists),'chord-library-theme':theme,'chord-library-font-size':'16','chord-library-tour-seen':'2.4','chord-library-tour-features-seen':'2.4'};
  await NativeBridge.initialize({invokeMethodAsync:async(method)=>{
    if(method==='OpenAccount'){showAccount();return;}
    if(method==='RefreshLibrary'){NativeBridge.showToast('Preview library is up to date.','success');return;}
    return null;
  }},snapshot);
  NativeBridge.configure({native:false});
  for(const file of ['qrcode.js','setlist-sort.js','app.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='../../src/ChordLibrary.Shared/wwwroot/js/'+file+'?review='+Date.now();script.onload=resolve;script.onerror=reject;document.body.appendChild(script);});
  NativeBridge.setAccount({signedIn:false,status:'offline',displayName:'',email:''});
  const account=document.createElement('div');account.className='review-account';account.hidden=true;
  account.innerHTML=`<section class="native-dialog native-account" role="dialog" aria-modal="true" aria-labelledby="review-account-title"><img class="native-account-logo native-account-logo-light" src="../../branding/chordkeep/assets/horizontal-primary.svg" alt="ChordKeep" />
        <img class="native-account-logo native-account-logo-dark" src="../../branding/chordkeep/assets/horizontal-white.svg" alt="ChordKeep" />
        <div class="native-account-eyebrow">A RUACH product · Governed by the Spirit.</div><h2 id="review-account-title">Your library, wherever you go.</h2><p>Sign in with Google to sync songs and setlists across your devices. Your local and account libraries are kept separate.</p><div class="native-actions"><button class="btn native-google" id="review-google"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3-4.4 3-7.7Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3 7.5l3.3 2.6C7.1 7.7 9.4 5.9 12 5.9Z"/></svg><span>Continue with Google</span></button></div><p class="review-preview-status" id="review-status" role="status"></p><div class="native-actions"><button class="btn btn-secondary" id="review-close">Close</button></div></section>`;document.body.appendChild(account);
  const closeAccount=()=>{account.hidden=true;root.inert=false;document.getElementById('user-btn').focus();};
  function showAccount(){account.hidden=false;root.inert=true;document.getElementById('review-google').focus();}
  document.getElementById('review-close').onclick=closeAccount;
  document.getElementById('review-google').onclick=()=>{document.getElementById('review-status').textContent='Design preview only. Google sign-in is not connected here.';};
  account.addEventListener('keydown',event=>{if(event.key==='Escape')closeAccount();if(event.key==='Tab'){const buttons=account.querySelectorAll('button');if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons[1].focus();}else if(!event.shiftKey&&document.activeElement===buttons[1]){event.preventDefault();buttons[0].focus();}}});
  const screen=params.get('screen')||'home';
  if(['song','edit'].includes(screen)){document.querySelector('#home-songs-list [data-id="morning"]').click();if(screen==='edit')document.getElementById('btn-inline-edit').click();}
  if(screen==='setlist')document.querySelector('#home-setlists-list [data-id="sunday"]').click();
  if(screen==='new')document.getElementById('btn-add-song').click();
  if(screen==='account')showAccount();
  if(params.get('drawer')==='open'&&innerWidth<768)document.getElementById('menu-toggle').click();
  await Promise.all([...document.images].filter(image=>image.getAttribute('src')).map(image=>image.decode()));
  await document.fonts.ready;
  document.documentElement.dataset.screen=screen;
  document.documentElement.dataset.ready='true';
  parent.postMessage({type:'brand-preview-ready',design:proposed?'proposed':'current',theme,screen},location.origin);
})().catch(error=>{if(window.parent!==window&&window.frameElement?.contentDocument!==document)return;document.getElementById('app').textContent='Preview could not load: '+error.message;console.error(error);});
