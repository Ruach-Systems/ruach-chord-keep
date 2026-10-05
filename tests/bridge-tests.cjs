// Run with: node --test tests/bridge-tests.cjs
// These tests execute the shipped scripts in isolated VM contexts; no browser is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const scripts = path.join(__dirname, '../src/ChordLibrary.Shared/wwwroot/js');
const appSource = fs.readFileSync(path.join(scripts, 'app.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(scripts, 'native-bridge.js'), 'utf8');
const viewSource = fs.readFileSync(path.join(scripts, 'view-updates.js'), 'utf8');

test('all shipped JavaScript parses, including the loader dependency order', () => {
  for (const file of fs.readdirSync(scripts).filter(file => file.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(path.join(scripts, file), 'utf8'), { filename: file });
  }
  assert.match(fs.readFileSync(path.join(scripts, 'loader.js'), 'utf8'), /'view-updates.js', 'app.js'/);
});

function viewContext() {
  const context = vm.createContext({});
  context.window = context;
  vm.runInContext(viewSource, context);
  return context.LibraryView;
}

test('snapshot differences compare semantic data and preserve membership order', () => {
  const view = viewContext();
  const before = [{ id: 'a', title: 'A', extra: { x: 1, y: 2 } }, { id: 'b', title: 'B' }];
  const same = [{ extra: { y: 2, x: 1 }, title: 'A', id: 'a' }, before[1]];
  assert.equal(view.changes(before, same).changed, false);
  const delta = view.changes(before, [{ ...before[0], title: 'Updated' }, { id: 'c', title: 'New' }]);
  assert.deepEqual(Array.from(delta.ids).sort(), ['a', 'b', 'c']);
  assert.equal(view.changes(before, before.toReversed()).changed, true);
  assert.equal(view.equal({ songIds: ['a', 'b', 'a'] }, { songIds: ['a', 'a', 'b'] }), false);
});

function snapshotContext(songId = null, setlistId = null, index = -1) {
  const calls = [];
  const view = viewContext();
  view.preserveView = callback => callback();
  view.announceSync = count => calls.push('announce:' + count);
  const context = vm.createContext({
    LibraryView: view,
    $: () => ({ classList: { add() {} } }),
    ...Object.fromEntries(['renderSongList', 'renderSetlistList', 'renderSongDetail',
      'renderSetlistDetail', 'renderHomeDashboard', 'updateSongNavigation', 'finishInlineEditState',
      'stopAutoScroll', 'setSongActionsVisible'].map(name => [name, () => calls.push(name)]))
  });
  vm.runInContext('let songs = [], setlists = [], selectedSongId = null, selectedSetlistId = null;\n' +
    'let viewingSetlistSongIndex = -1, viewingFromSetlistId = null, transposeSteps = 0;\n' +
    sourceFunction('applyNativeSnapshot') + '\n' +
    'globalThis.seed = (data, song, setlist, index) => { songs = data.songs; setlists = data.setlists;' +
    'selectedSongId = song; selectedSetlistId = setlist; viewingSetlistSongIndex = index; };\n' +
    'globalThis.state = () => ({selectedSongId, selectedSetlistId, viewingSetlistSongIndex, transposeSteps});', context);
  const data = { songs: [{ id: 'a', title: 'A', content: 'C G' }, { id: 'b', title: 'B', content: 'Dm' }],
    setlists: [{ id: 'set', name: 'Practice', songIds: ['a', 'b'] }] };
  context.seed(data, songId, setlistId, index);
  return { context, calls, data };
}

test('unchanged snapshots are silent and unrelated changes never redraw the open sheet', () => {
  const { context, calls, data } = snapshotContext('a');
  context.applyNativeSnapshot(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(calls, []);
  context.applyNativeSnapshot({ ...data, songs: [data.songs[0], { ...data.songs[1], title: 'New title' }] });
  assert.deepEqual(calls, ['renderSongList', 'updateSongNavigation', 'announce:1']);
});

test('selected songs update in place while setlist reorders update navigation only', () => {
  const { context, calls, data } = snapshotContext('b', 'set', 1);
  context.applyNativeSnapshot({ ...data, setlists: [{ ...data.setlists[0], songIds: ['b', 'a'] }] });
  assert.equal(context.state().viewingSetlistSongIndex, 0);
  assert.deepEqual(calls, ['renderSetlistList', 'updateSongNavigation', 'announce:1']);
  calls.length = 0;
  context.applyNativeSnapshot({ ...data, songs: [data.songs[0], { ...data.songs[1], content: 'Em', transposeSteps: 2 }] });
  assert.ok(calls.includes('renderSongDetail'));
  assert.ok(!calls.includes('stopAutoScroll'));
  assert.equal(context.state().transposeSteps, 2);
});

test('setlist members update the open setlist and remote deletions leave a valid view', () => {
  const { context, calls, data } = snapshotContext(null, 'set');
  context.applyNativeSnapshot({ ...data, songs: [data.songs[0]] });
  assert.ok(calls.includes('renderSetlistDetail'));
  const sheet = snapshotContext('b', 'set', 1);
  sheet.context.applyNativeSnapshot({ ...sheet.data, songs: [sheet.data.songs[0]] });
  assert.equal(sheet.context.state().selectedSongId, null);
  assert.ok(sheet.calls.includes('renderSetlistDetail'));
  assert.ok(sheet.calls.includes('stopAutoScroll'));
  const deletedSet = snapshotContext('a', 'set', 0);
  deletedSet.context.applyNativeSnapshot({ ...deletedSet.data, setlists: [] });
  assert.equal(deletedSet.context.state().selectedSetlistId, null);
  assert.ok(deletedSet.calls.includes('renderSongDetail'));
});

function sourceFunction(name) {
  const match = appSource.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  \\}', 'm'));
  assert.ok(match, 'Shipped function exists: ' + name);
  return match[0];
}

function musicContext() {
  const context = vm.createContext({});
  const constants = appSource.slice(appSource.indexOf('  const NOTES ='),
    appSource.indexOf("  const SONG_QR_VERSION = 1;") + '  const SONG_QR_VERSION = 1;'.length);
  const names = ['transposeNote', 'transposeText', 'convertNoteNotation', 'applyNotationPreference',
    'highlightChords', 'detectKey', 'normalizeSongPayload', 'extractSongFromParsedData',
    'compressForQr', 'stripLyricsFromLine', 'clampFontSize'];
  vm.runInContext(constants + '\nconst MIN_FONT_SIZE = 10, MAX_FONT_SIZE = 24;\n' +
    "let notationPref = 'original';\n" + names.map(sourceFunction).join('\n') +
    '\nglobalThis.setNotation = value => notationPref = value;', context);
  return context;
}

test('transposition preserves quality, slash bass and existing flat spelling', () => {
  const music = musicContext();
  assert.equal(music.transposeText('Cmaj7/G# Dm7 Bb/F F#sus4', 2), 'Dmaj7/A# Em7 C/G G#sus4');
  assert.equal(music.transposeText('Bb Ebm7/Gb', -2), 'Ab Dbm7/E');
  assert.equal(music.transposeText('C B', -1), 'B A#');
  assert.equal(music.transposeText('C Dm G7', 12), 'C Dm G7');
  assert.equal(music.transposeText('Amazing grace [Chorus]', 4), 'Amazing grace [Chorus]');
  assert.equal(music.transposeText('Amen Amigo Bass Daddario', 4), 'Amen Amigo Bass Daddario');
  assert.equal(music.transposeText('CmMaj7 Dm7b5 G7sus4 Cadd9 Fmaj7#11', 2), 'DmMaj7 Em7b5 A7sus4 Dadd9 Gmaj7#11');
  const nonChord = 'C' + '1'.repeat(100) + 'x';
  assert.equal(music.transposeText(nonChord, 2), nonChord);
  assert.equal(music.transposeText(null, 2), '');
  assert.equal(music.detectKey('Lyrics\n[Verse]\nDm7 G C'), 'D');
  assert.equal(music.detectKey('No chord tokens here'), null);
});

test('sharp/flat preference transforms roots and bass without changing source text', () => {
  const music = musicContext();
  const original = 'C#/G# D#m7 A#';
  music.setNotation('flat');
  assert.equal(music.applyNotationPreference(original), 'Db/Ab Ebm7 Bb');
  music.setNotation('sharp');
  assert.equal(music.applyNotationPreference('Db/Ab Ebm7 Bb'), original);
  music.setNotation('original');
  assert.equal(music.applyNotationPreference(original), original);
  assert.equal(music.highlightChords('[Chorus] [Bridge] [C#m7/G#] <script>'),
    '<span class="bracket-command">[Chorus]</span> <span class="bracket-command">[Bridge]</span> ' +
    '[<span class="chord">C#m7/G#</span>] &lt;script&gt;');
});

test('viewer transpose buttons stop at +/-11 and reset persists; font bounds clamp', () => {
  const handlers = {};
  const context = vm.createContext({
    dom: Object.fromEntries(['transposeUp', 'transposeDown', 'transposeReset'].map(name =>
      [name, { addEventListener: (_, handler) => { handlers[name] = handler; } }]))
  });
  const buttons = appSource.slice(appSource.indexOf("    dom.transposeUp.addEventListener('click'"),
    appSource.indexOf("    dom.transposeAccept.addEventListener('click'"));
  vm.runInContext('let transposeSteps = 10, saves = 0;\n' +
    'function saveTransposeForSong() { saves++; }\nfunction renderSongDetail() {}\n' + buttons +
    '\nglobalThis.state = () => ({ steps: transposeSteps, saves });' +
    '\nglobalThis.setSteps = value => transposeSteps = value;', context);
  handlers.transposeUp();
  handlers.transposeUp();
  assert.equal(context.state().steps, 11);
  assert.equal(context.state().saves, 1);
  context.setSteps(-10);
  handlers.transposeDown();
  handlers.transposeDown();
  assert.equal(context.state().steps, -11);
  assert.equal(context.state().saves, 2);
  handlers.transposeReset();
  assert.equal(context.state().steps, 0);
  assert.equal(context.state().saves, 3);
  const music = musicContext();
  assert.equal(music.clampFontSize('999'), 24);
  assert.equal(music.clampFontSize('-1'), 10);
  assert.equal(music.clampFontSize(null), 14);
});

test('setlist keyboard navigation is bounded and does not also run when a sidebar tab handles the key', () => {
  const handlers = {};
  const tabs = ['songs', 'setlists'].map(tab => ({ dataset: { tab },
    addEventListener: (event, callback) => { handlers[tab + '-' + event] = callback; } }));
  const documentStart = appSource.indexOf("    document.addEventListener('keydown', (e) => {",
    appSource.indexOf('// Keyboard navigation'));
  const documentEnd = appSource.indexOf('\n    });', documentStart) + 8;
  const tabsStart = appSource.indexOf("    $$('.tab-btn').forEach(btn => {", appSource.indexOf('function initEventListeners'));
  const tabsEnd = appSource.indexOf('\n    });', tabsStart) + 8;
  let selectedTab = 'songs';
  const context = vm.createContext({
    dom: { songContentSection: { scrollTop: 7 } },
    document: { addEventListener: (event, callback) => { handlers[event] = callback; },
      querySelector: () => ({ focus() {} }) },
    $$: () => tabs,
    renderSongDetail() {}, updateSheetScrollTopButton() {},
    setSidebarTab: tab => { selectedTab = tab; }
  });
  vm.runInContext("let songs = [{id:'first'},{id:'second'},{id:'unrelated'}];\n" +
    "let setlists = [{id:'practice',songIds:['second','first']}], selectedSetlistId = 'practice';\n" +
    "let viewingSetlistSongIndex = 0, selectedSongId = 'second', inlineEditingSongId = null, transposeSteps = 0;\n" +
    sourceFunction('navigateToPreviousSong') + '\n' + sourceFunction('navigateToNextSong') + '\n' +
    appSource.slice(documentStart, documentEnd) + '\n' + appSource.slice(tabsStart, tabsEnd) +
    '\nglobalThis.current = () => selectedSongId;\n' +
    'globalThis.reset = () => { selectedSongId = "second"; viewingSetlistSongIndex = 0; };', context);
  const right = () => ({ key: 'ArrowRight', defaultPrevented: false,
    target: { matches: () => false, isContentEditable: false },
    preventDefault() { this.defaultPrevented = true; } });
  handlers.keydown(right());
  assert.equal(context.current(), 'first');
  handlers.keydown(right());
  assert.equal(context.current(), 'first', 'endpoint cannot enter the general library');
  context.reset();
  const tabKey = right();
  handlers['songs-keydown'](tabKey);
  handlers.keydown(tabKey); // The same event bubbles from the tab to document.
  assert.equal(selectedTab, 'setlists');
  assert.equal(context.current(), 'second', 'a tab-handled key must not also navigate the song sheet');
});

test('compact QR and legacy single-song data remain readable and compression is explicit', () => {
  const music = musicContext();
  const content = '[Verse]\nAmazing grace and mercy\nC   G   Am   F singing here\n\n[Bridge]\nDm G [repeat]\n|---|';
  assert.equal(music.compressForQr(content), '[Verse]\nC   G   Am   F\n\n[Bridge]\nDm G [repeat]\n|---|');
  const compact = music.extractSongFromParsedData({ t: 'cl-song', v: 1, n: 'Example', a: 'Artist', c: 'C G' });
  assert.equal(compact.title, 'Example');
  assert.equal(compact.artist, 'Artist');
  assert.equal(compact.content, 'C G');
  const legacy = music.extractSongFromParsedData({ type: 'single-song', version: 1,
    song: { title: 'Original', artist: '', content } });
  assert.equal(legacy.content, content);
  assert.equal(music.extractSongFromParsedData({ songs: [{ title: 'First', content: 'Dm' }] }).title, 'First');
  assert.equal(music.extractSongFromParsedData({ title: '', content: 'C' }), null);
});

function bridgeContext(save) {
  const events = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    console,
    queueMicrotask,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { getElementById: () => null, addEventListener() {}, visibilityState: 'visible' }
  });
  context.window = context;
  context.addEventListener = () => {};
  context.dispatchEvent = event => events.push(event);
  vm.runInContext(bridgeSource, context);
  const calls = [];
  const reference = {
    async invokeMethodAsync(method, ...args) {
      calls.push({ method, args });
      if (method === 'Initialize') return {};
      if (method === 'SaveStorage') return save ? save(args[0]) : undefined;
    }
  };
  return { context, events, timers, calls, reference };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('data-only sync preserves preferences and account reset always refreshes them', async () => {
  const host = bridgeContext();
  const bridge = host.context.NativeBridge;
  const settings = { 'chord-library-theme': 'dark', 'chord-library-font-size': '16' };
  await bridge.initialize(host.reference, settings);
  let refreshed = 0;
  const payloads = [];
  bridge.registerAppLifecycle({ refreshSettings: () => refreshed++, resetForAccount() {} });
  host.context.SyncService.onRemoteUpdate((_, data) => payloads.push(data));
  bridge.replaceSnapshot({ ...settings, 'chord-library-songs': '[{"id":"new"}]' });
  assert.equal(refreshed, 0);
  assert.equal(payloads.at(-1).settingsChanged, false);
  bridge.replaceSnapshot({ ...settings, 'chord-library-font-size': '18' });
  assert.equal(refreshed, 1);
  assert.equal(payloads.at(-1).settingsChanged, true);
  bridge.replaceSnapshot({ ...settings, 'chord-library-font-size': '18' }, true);
  assert.equal(refreshed, 2);
  assert.equal(payloads.at(-1).reset, true);
});

test('Google avatar loads with icon fallback and clears on sign-out or unsafe URLs', () => {
  const host = bridgeContext();
  host.context.URL = URL;
  function element(hidden = false) {
    return { hidden, classList: {
      add() { this.owner.hidden = true; }, remove() { this.owner.hidden = false; }
    }, removeAttribute(name) { delete this[name]; } };
  }
  const avatar = element(true), icon = element();
  avatar.classList.owner = avatar; icon.classList.owner = icon;
  host.context.document.getElementById = id => ({ 'user-avatar': avatar, 'user-icon': icon })[id] || null;
  const bridge = host.context.NativeBridge;
  bridge.setAccount({ signedIn: true, avatarUrl: 'https://lh3.googleusercontent.com/avatar' });
  assert.equal(avatar.src, 'https://lh3.googleusercontent.com/avatar');
  assert.equal(icon.hidden, false, 'keep fallback while loading');
  avatar.onload();
  assert.equal(avatar.hidden, false);
  assert.equal(icon.hidden, true);
  avatar.onerror();
  assert.equal(icon.hidden, false);
  assert.equal(avatar.hidden, true);
  bridge.setAccount({ signedIn: false });
  assert.equal(avatar.src, undefined);
  assert.equal(avatar.onload, null);
  for (const url of ['javascript:alert(1)', 'http://lh3.googleusercontent.com/a', 'https://googleusercontent.com.evil.test/a']) {
    bridge.setAccount({ signedIn: true, avatarUrl: url });
    assert.equal(avatar.src, undefined);
    assert.equal(icon.hidden, false);
  }
});

test('native save queue serializes concurrent edits and durably writes the newest snapshot', async () => {
  const first = deferred();
  let count = 0;
  let active = 0;
  let maxActive = 0;
  const host = bridgeContext(async () => {
    maxActive = Math.max(maxActive, ++active);
    if (++count === 1) await first.promise;
    active--;
  });
  const { NativeBridge, LibraryStorage } = host.context;
  await NativeBridge.initialize(host.reference);
  LibraryStorage.setItem('chord-library-songs', '[{"id":"a"}]');
  const saving = NativeBridge.flush();
  await Promise.resolve();
  LibraryStorage.setItem('chord-library-songs', '[{"id":"a"},{"id":"b"}]');
  LibraryStorage.setItem('chord-library-setlists', '[{"id":"set","songIds":["b","a"]}]');
  first.resolve();
  await saving;
  await NativeBridge.flush();
  const saves = host.calls.filter(call => call.method === 'SaveStorage');
  assert.equal(maxActive, 1);
  assert.equal(saves.length, 2);
  assert.equal(saves.at(-1).args[0]['chord-library-songs'], '[{"id":"a"},{"id":"b"}]');
  assert.equal(saves.at(-1).args[0]['chord-library-setlists'], '[{"id":"set","songIds":["b","a"]}]');
});

test('failed native write retains unsaved data, reports error and allows a successful retry', async () => {
  const first = deferred();
  let count = 0;
  const host = bridgeContext(() => ++count === 1 ? first.promise : undefined);
  const { NativeBridge, LibraryStorage } = host.context;
  await NativeBridge.initialize(host.reference, {});
  LibraryStorage.setItem('chord-library-songs', '[{"id":"retained"}]');
  const failed = NativeBridge.flush();
  const rejected = assert.rejects(failed, /disk unavailable/);
  await Promise.resolve();
  first.reject(new Error('disk unavailable'));
  await rejected;
  assert.equal(LibraryStorage.getItem('chord-library-songs'), '[{"id":"retained"}]');
  assert.ok(host.events.some(event => event.detail.type === 'error'));
  assert.ok(host.timers.size > 0, 'a retry is scheduled');
  assert.throws(() => NativeBridge.replaceSnapshot({}), /still saving/);
  await NativeBridge.flush();
  NativeBridge.replaceSnapshot({ 'chord-library-songs': '[]' });
  assert.equal(LibraryStorage.getItem('chord-library-songs'), '[]');
});

test('account snapshots clear drafts before replacement and refresh settings atomically', async () => {
  const host = bridgeContext();
  const { NativeBridge, LibraryStorage, SyncService } = host.context;
  await NativeBridge.initialize(host.reference, { 'chord-library-theme': 'light' });
  const order = [];
  let allowSwitch = false;
  NativeBridge.registerAppLifecycle({
    canSwitchAccount: () => allowSwitch,
    resetForAccount: () => order.push('reset:' + LibraryStorage.getItem('chord-library-theme')),
    refreshSettings: () => order.push('settings:' + LibraryStorage.getItem('chord-library-theme'))
  });
  SyncService.onRemoteUpdate((type, payload) => {
    order.push(type);
    assert.equal(payload.songs.length, 1);
    assert.equal(payload.setlists.length, 1);
  });
  assert.equal(NativeBridge.canSwitchAccount(), false);
  allowSwitch = true;
  assert.equal(NativeBridge.canSwitchAccount(), true);
  NativeBridge.replaceSnapshot({
    'chord-library-songs': '[{"id":"other-account-song"}]',
    'chord-library-playlists': '[{"id":"legacy-set"}]'
  }, true);
  assert.deepEqual(order, ['reset:light', 'settings:null', 'snapshot']);
  assert.equal(LibraryStorage.getItem('chord-library-theme'), null);
  assert.throws(() => NativeBridge.replaceSnapshot({ 'chord-library-songs': '{}' }), /arrays/);
  assert.equal(LibraryStorage.getItem('chord-library-songs'), '[{"id":"other-account-song"}]');
});

test('account reset clears source editor, selections and previous undo callback', () => {
  const cleaned = [];
  const classList = { add() {}, remove() {}, toggle() {} };
  const context = vm.createContext({
    clearTimeout() {},
    document: { body: { classList } },
    dom: { searchInput: { value: 'old search' }, setlistSearchInput: { value: 'old setlist' } },
    $: () => ({ classList }),
    stopAutoScroll() {}, clearInlineEditorPosition() {},
    closeSongModal() {}, closeSetlistModal() {}, closeAddSongsModal() {}, closeConfirmModal() {},
    closeShareQrModal() {}, closePreferencesModal() {}, closeSongActionsMenu() {}, closeSidebar() {},
    setSongActionsVisible() {},
    undoCleanup: () => cleaned.push('undo callback removed')
  });
  vm.runInContext("let inlineEditingSongId = 'same-id-in-another-account', inlineEditingMode = 'contenteditable';\n" +
    "let inlineEditDraft = 'private unsaved song', selectedSongId = 'a', selectedSetlistId = 'b';\n" +
    "let viewingSetlistSongIndex = 1, viewingFromSetlistId = 'b', editingSongId = 'a', editingSetlistId = 'b';\n" +
    'let transposeSteps = 7, undoTimer = 123, undoData = {};\n' +
    sourceFunction('finishInlineEditState') + '\n' + sourceFunction('resetNativeAccount') +
    '\nresetNativeAccount();\n' +
    'globalThis.result = { inlineEditingSongId, inlineEditDraft, selectedSongId, selectedSetlistId, ' +
    'viewingSetlistSongIndex, viewingFromSetlistId, editingSongId, editingSetlistId, transposeSteps, undoTimer, undoData };', context);
  for (const key of ['inlineEditingSongId', 'selectedSongId', 'selectedSetlistId', 'viewingFromSetlistId',
    'editingSongId', 'editingSetlistId', 'undoTimer', 'undoData']) assert.equal(context.result[key], null, key);
  assert.equal(context.result.inlineEditDraft, '');
  assert.equal(context.result.viewingSetlistSongIndex, -1);
  assert.equal(context.result.transposeSteps, 0);
  assert.equal(context.dom.searchInput.value, '');
  assert.deepEqual(cleaned, ['undo callback removed']);
});

test('replacing settings resets absent theme/notation/font and updates sidebar layout', () => {
  const attributes = {};
  const context = vm.createContext({
    LibraryStorage: { getItem: () => null },
    document: {
      documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
      getElementById: () => null
    },
    dom: { fontSizeSelect: { value: '24' } },
    syncSidebarLayout() {}, updatePreferencesUI() {}
  });
  vm.runInContext("const STORAGE_KEYS = { THEME: 'theme', NOTATION: 'notation', FONT_SIZE: 'font', SIDEBAR_COLLAPSED: 'sidebar' };\n" +
    'const MIN_FONT_SIZE = 10, MAX_FONT_SIZE = 24;\n' +
    "let notationPref = 'flat', currentFontSize = 24, desktopSidebarCollapsed = true, persistentSidebarLayout = true;\n" +
    ['loadTheme', 'loadNotationPref', 'clampFontSize', 'refreshNativeSettings'].map(sourceFunction).join('\n') +
    '\nrefreshNativeSettings();\n' +
    'globalThis.result = { notationPref, currentFontSize, desktopSidebarCollapsed, persistentSidebarLayout };', context);
  assert.equal(attributes['data-theme'], 'dark');
  assert.equal(context.result.notationPref, 'original');
  assert.equal(context.result.currentFontSize, 14);
  assert.equal(context.result.desktopSidebarCollapsed, false);
  assert.equal(context.result.persistentSidebarLayout, null);
  assert.equal(context.dom.fontSizeSelect.value, '14');
});

test('background refresh waits for native saves, source editor, open modal and undo window', async () => {
  const first = deferred();
  const host = bridgeContext(() => first.promise);
  const { NativeBridge, LibraryStorage } = host.context;
  await NativeBridge.initialize(host.reference, {});
  let editorSafe = false;
  NativeBridge.registerAppLifecycle({ canRefresh: () => editorSafe });
  assert.equal(NativeBridge.canRefresh(), false);
  editorSafe = true;
  assert.equal(NativeBridge.canRefresh(), true);
  LibraryStorage.setItem('chord-library-songs', '[]');
  assert.equal(NativeBridge.canRefresh(), false);
  const saving = NativeBridge.flush();
  first.resolve();
  await saving;
  assert.equal(NativeBridge.canRefresh(), true);

  let hidden = true;
  const modal = { classList: { contains: () => hidden } };
  const context = vm.createContext({
    dom: { songModal: modal, setlistModal: modal, addSongsModal: modal, confirmModal: modal,
      shareQrModal: modal, scanQrOverlay: modal },
    $: () => modal
  });
  vm.runInContext('let inlineEditingSongId = null, undoCleanup = null;\n' +
    sourceFunction('canRefreshNativeSnapshot') +
    '\nglobalThis.setDraft = value => inlineEditingSongId = value;\n' +
    'globalThis.setUndo = value => undoCleanup = value;', context);
  assert.equal(context.canRefreshNativeSnapshot(), true);
  context.setDraft('editing-song');
  assert.equal(context.canRefreshNativeSnapshot(), false);
  context.setDraft(null);
  context.setUndo(() => {});
  assert.equal(context.canRefreshNativeSnapshot(), false);
  context.setUndo(null);
  hidden = false;
  assert.equal(context.canRefreshNativeSnapshot(), false);
});

test('native import/export waits for device persistence and native QR returns decoded payload', async () => {
  const host = bridgeContext();
  const { NativeBridge, LibraryStorage } = host.context;
  await NativeBridge.initialize(host.reference, {});
  NativeBridge.configure({ native: true, qrImport: true });
  assert.equal(NativeBridge.isNative, true);
  LibraryStorage.setItem('chord-library-songs', '[]');
  await NativeBridge.exportFile('backup.json', '{"songs":[]}');
  await NativeBridge.previewImport('{"version":2,"songs":[]}');
  await NativeBridge.scanQr();
  await NativeBridge.pickQrImage();
  assert.deepEqual(host.calls.map(call => call.method),
    ['SaveStorage', 'ExportFile', 'PreviewImport', 'ScanQr', 'PickQrImage']);
  assert.deepEqual(host.calls[1].args, ['backup.json', '{"songs":[]}']);
});

test('QR import is hidden and cannot open a scanner on desktop or browser preview', async () => {
  const host = bridgeContext();
  let hidden = true;
  host.context.document.getElementById = id => id === 'btn-scan-qr'
    ? { classList: { toggle(name, value) { assert.equal(name, 'hidden'); hidden = value; } } } : null;
  const bridge = host.context.NativeBridge;
  await bridge.initialize(host.reference, {});
  for (const configuration of [{ native: true }, { native: true, qrImport: false }, { native: false, qrImport: true }]) {
    bridge.configure(configuration);
    assert.equal(hidden, true);
    assert.equal(bridge.supportsQrImport, false);
    assert.equal(await bridge.scanQr(), null);
    assert.equal(await bridge.pickQrImage(), null);
  }
  assert.equal(host.calls.length, 0);
  bridge.configure({ native: true, qrImport: true });
  assert.equal(hidden, false);
  assert.equal(bridge.supportsQrImport, true);
  await bridge.scanQr();
  await bridge.pickQrImage();
  assert.deepEqual(host.calls.map(call => call.method), ['ScanQr', 'PickQrImage']);
});

test('mobile QR results load a song draft; cancellation and invalid QR do not change it', async () => {
  const music = musicContext();
  const drafts = [], notices = [];
  let payload = JSON.stringify({ t: 'cl-song', v: 1, n: 'From phone', a: 'Artist', c: 'C G Am F' });
  const context = vm.createContext({
    NativeBridge: { supportsQrImport: true, isNative: true, scanQr: async () => payload },
    extractSongFromParsedData: music.extractSongFromParsedData,
    populateSongForm: song => drafts.push(song),
    showToast: (message, type) => notices.push({ message, type })
  });
  vm.runInContext(sourceFunction('handleScannedSongQr') + '\n' + sourceFunction('startQrScan'), context);
  await context.startQrScan();
  assert.equal(drafts[0].title, 'From phone');
  assert.equal(drafts[0].content, 'C G Am F');
  payload = null;
  await context.startQrScan();
  assert.equal(drafts.length, 1);
  payload = 'https://example.org/unrelated';
  await context.startQrScan();
  assert.equal(drafts.length, 1);
  assert.equal(notices.at(-1).type, 'error');
  context.NativeBridge.scanQr = async () => { throw new Error('Camera unavailable'); };
  await context.startQrScan();
  assert.match(notices.at(-1).message, /Unable to scan QR code: Camera unavailable/);
});
