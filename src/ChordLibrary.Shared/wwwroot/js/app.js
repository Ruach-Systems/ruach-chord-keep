/**
 * Chord Library - A mobile-first offline chord library application
 * Features: Song management, Chord transposition, Setlists, Swipe navigation
 */

(function() {
  'use strict';

  // ================================================
  // Constants & Helpers
  // ================================================

  const TOUR_VERSION = '2.4';
  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 24;
  const SHEET_SCROLL_TOP_THRESHOLD = 20;
  // Rollback switch: set to 'legacy' to restore the full textarea editor.
  const INLINE_EDIT_IMPLEMENTATION = 'contenteditable';

  const STORAGE_KEYS = {
    SONGS: 'chord-library-songs',
    SETLISTS: 'chord-library-setlists',
    FONT_SIZE: 'chord-library-font-size',
    THEME: 'chord-library-theme',
    SIDEBAR_SCROLL: 'chord-library-sidebar-scroll',
    SIDEBAR_COLLAPSED: 'chord-library-sidebar-collapsed',
    NOTATION: 'chord-library-notation',
    TOUR_SEEN: 'chord-library-tour-seen',
    TOUR_FEATURES_SEEN: 'chord-library-tour-features-seen'
  };

  // Read once during upgrades, then remove after a successful local migration.
  const LEGACY_STORAGE_KEYS = {
    SETLISTS: 'chord-library-playlists'
  };

  // Musical notes for transposition
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Regex for matching chord patterns
  // Recognize chord suffixes, not arbitrary words beginning with a note plus "m".
  // The old [a-z0-9]* suffix transposed lyrics such as "Amazing" into "C#mazing".
  const QUALITY = '(?:(?:maj|Maj|min|dim|aug|sus[24]?|add|m|M)\\d*|\\d+)(?:(?:maj|Maj|min|dim|aug|sus[24]?|add)\\d*|[#b]\\d+)*';
  const CHORD_RE = () => new RegExp(
    `(?<![A-Za-z])([A-G][#b]?)(${QUALITY})?(\\/[A-G][#b]?(?:${QUALITY})?)?(?![a-zA-Z0-9#b])`,
    'g'
  );
  const CHORD_TOKEN_RE = () => new RegExp(
    `^[A-G][#b]?(?:${QUALITY})?(?:\\/[A-G][#b]?(?:${QUALITY})?)?$`
  );
  const SONG_QR_TYPE = 'cl-song';
  const SONG_QR_VERSION = 1;

  /**
   * Generate a unique ID
   */
  function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'id-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
  }

  /**
   * Shorthand for document.getElementById
   */
  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Shorthand for querySelectorAll
   */
  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  function clampFontSize(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 14;
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, parsed));
  }

  // ================================================
  // State Management
  // ================================================

  let songs = [];
  let setlists = [];
  let selectedSongId = null;
  let selectedSetlistId = null;
  let viewingSetlistSongIndex = -1;
  let transposeSteps = 0;
  let editingSongId = null;
  let inlineEditingSongId = null;
  let inlineEditingMode = null;
  let inlineEditDraft = '';
  let editingSetlistId = null;
  let confirmCallback = null;
  let currentFontSize = 14; // Default font size for chord content
  let viewingFromSetlistId = null; // Track which setlist we're viewing from (for auto-add)
  let undoTimer = null;
  let undoData = null; // { type, item, setlists?, songs? }
  let undoCleanup = null;
  let qrScannerStream = null;
  let qrScannerActive = false;
  let qrScannerRafId = null;
  let qrDetector = null;
  let qrCodeLoadPromise = null;
  let notationPref = 'original'; // 'original', 'sharp', or 'flat'
  let autoScrollInterval = null;
  let autoScrollSpeed = 1; // 0=slow, 1=medium, 2=fast
  let desktopSidebarCollapsed = false;
  let persistentSidebarLayout = null;
  let navigationHistory = [];
  let restoringNavigation = false;
  let modalLayers = [];
  let songFormBaseline = '', setlistFormBaseline = '';
  const AUTO_SCROLL_SPEEDS = [0.5, 1, 2]; // px per tick

  // ================================================
  // DOM Elements
  // ================================================

  const dom = {
    // Sidebar
    sidebar: $('sidebar'),
    menuToggle: $('menu-toggle'),
    searchInput: $('search-input'),
    setlistSearchInput: $('setlist-search-input'),
    songList: $('song-list'),
    setlistList: $('setlist-list'),
    songListSummary: $('song-list-summary'),
    setlistListSummary: $('setlist-list-summary'),
    songsTabCount: $('songs-tab-count'),
    setlistsTabCount: $('setlists-tab-count'),
    songsSort: $('songs-sort'),
    setlistsSort: $('setlists-sort'),

    // Content
    content: $('content'),
    emptyState: $('empty-state'),
    songDetail: $('song-detail'),
    setlistDetail: $('setlist-detail'),

    // Song Navigation Hint
    songNavHint: $('song-nav-hint'),
    navHintInfo: $('nav-hint-info'),

    // Song Toolbar
    fontSizeSelect: $('font-size-select'),
    transposeUp: $('btn-transpose-up'),
    transposeDown: $('btn-transpose-down'),
    transposeReset: $('btn-transpose-reset'),
    transposeAccept: $('btn-transpose-accept'),
    transposeValue: $('transpose-value'),
    twoColumnToggle: $('two-column-toggle'),
    songActionsButton: $('btn-song-actions'),
    songActionsMenu: $('song-actions-menu'),

    // Header
    appTitle: $('app-title'),

    // Song Detail
    songContent: $('song-content'),
    songContentSection: $('song-content-section'),
    sheetScrollTopButton: $('btn-sheet-scroll-top'),
    inlineEditButton: $('btn-inline-edit'),
    contentEditableActions: $('contenteditable-actions'),
    contentEditableCharButtons: $('contenteditable-char-buttons'),
    contentEditableHighlight: $('contenteditable-highlight'),
    inlineSongEditor: $('inline-song-editor'),
    inlineSongHighlight: $('inline-song-highlight'),
    inlineSongContent: $('inline-song-content'),
    inlineEditorNote: $('inline-editor-note'),

    // Setlist Detail
    setlistTitle: $('setlist-title'),
    setlistDescription: $('setlist-description'),
    setlistSongCount: $('setlist-song-count'),
    setlistUpdated: $('setlist-updated'),
    setlistReorderHint: $('setlist-reorder-hint'),
    setlistSongs: $('setlist-songs'),

    // Modals
    songModal: $('song-modal'),
    songForm: $('song-form'),
    songModalTitle: $('song-modal-title'),
    songModalSubtitle: $('song-modal-subtitle'),
    songImportPanel: $('song-import-panel'),
    songContentField: $('song-content-field'),
    editSongInfoNote: $('edit-song-info-note'),
    saveSongLabel: $('btn-save-song-label'),
    songTitleInput: $('song-title-input'),
    songArtistInput: $('song-artist-input'),
    songContentInput: $('song-content-input'),
    shareQrModal: $('share-qr-modal'),
    shareQrCanvas: $('share-qr-canvas'),
    shareQrHelp: $('share-qr-help'),
    shareQrSongName: $('share-qr-song-name'),
    scanQrOverlay: $('qr-scanner-overlay'),
    scanQrVideo: $('scan-qr-video'),
    scanQrStatus: $('qr-scanner-status-text'),

    setlistModal: $('setlist-modal'),
    setlistForm: $('setlist-form'),
    setlistModalTitle: $('setlist-modal-title'),
    setlistModalSubtitle: $('setlist-modal-subtitle'),
    setlistSaveLabel: $('btn-save-setlist-label'),
    setlistNameInput: $('setlist-name-input'),
    setlistDescriptionInput: $('setlist-description-input'),

    addSongsModal: $('add-songs-modal'),
    songSelector: $('song-selector'),

    confirmModal: $('confirm-modal'),
    confirmMessage: $('confirm-message')
  };

  // ================================================
  // Storage Functions
  // ================================================

  function loadData() {
    try {
      const songsData = LibraryStorage.getItem(STORAGE_KEYS.SONGS);
      let setlistsData = LibraryStorage.getItem(STORAGE_KEYS.SETLISTS);
      if (setlistsData === null) {
        const legacySetlistsData = LibraryStorage.getItem(LEGACY_STORAGE_KEYS.SETLISTS);
        if (legacySetlistsData !== null) {
          JSON.parse(legacySetlistsData);
          LibraryStorage.setItem(STORAGE_KEYS.SETLISTS, legacySetlistsData);
          LibraryStorage.removeItem(LEGACY_STORAGE_KEYS.SETLISTS);
          setlistsData = legacySetlistsData;
        }
      }
      songs = songsData ? JSON.parse(songsData) : [];
      setlists = setlistsData ? JSON.parse(setlistsData) : [];
    } catch (e) {
      console.error('Error loading data:', e);
      songs = [];
      setlists = [];
    }
  }

  function saveSongs() {
    try {
      LibraryStorage.setItem(STORAGE_KEYS.SONGS, JSON.stringify(songs));
      if (typeof SyncService !== 'undefined') {
        SyncService.onDataChanged('songs', songs);
      }
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        showToast('Storage full — unable to save. Delete some songs to free space.', 'error');
      } else {
        console.error('Error saving songs:', e);
      }
    }
  }

  function saveSetlists() {
    try {
      LibraryStorage.setItem(STORAGE_KEYS.SETLISTS, JSON.stringify(setlists));
      if (typeof SyncService !== 'undefined') {
        SyncService.onDataChanged('setlists', setlists);
      }
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        showToast('Storage full — unable to save. Delete some items to free space.', 'error');
      } else {
        console.error('Error saving setlists:', e);
      }
    }
  }

  // ================================================
  // Transposition Functions
  // ================================================

  /**
   * Transpose a single note by the given number of steps
   */
  function transposeNote(note, steps) {
    let index = NOTES.indexOf(note);
    const useFlat = index === -1;
    if (useFlat) index = NOTES_FLAT.indexOf(note);
    if (index === -1) return note;
    const newIndex = ((index + steps) % 12 + 12) % 12;
    return useFlat ? NOTES_FLAT[newIndex] : NOTES[newIndex];
  }

  /**
   * Transpose all chords in a text string
   */
  function transposeText(text, steps) {
    if (!text || steps === 0) return text || '';
    return text.replace(CHORD_RE(), (_, root, quality, slash) => {
      const newRoot = transposeNote(root, steps);
      let result = newRoot + (quality || '');
      if (slash) {
        const match = slash.match(/^\/([A-G][#b]?)(.*)/);
        if (match) {
          result += '/' + transposeNote(match[1], steps) + (match[2] || '');
        } else {
          result += slash;
        }
      }
      return result;
    });
  }

  /**
   * Convert a note to the preferred notation (sharp/flat/original)
   */
  function convertNoteNotation(note) {
    if (notationPref === 'original') return note;
    let index = NOTES.indexOf(note);
    if (index === -1) index = NOTES_FLAT.indexOf(note);
    if (index === -1) return note;
    return notationPref === 'sharp' ? NOTES[index] : NOTES_FLAT[index];
  }

  /**
   * Apply notation preference to all chords in text
   */
  function applyNotationPreference(text) {
    if (!text || notationPref === 'original') return text || '';
    return text.replace(CHORD_RE(), (match, root, quality, slash) => {
      let result = convertNoteNotation(root) + (quality || '');
      if (slash) {
        const m = slash.match(/^\/([A-G][#b]?)(.*)/);
        if (m) {
          result += '/' + convertNoteNotation(m[1]) + (m[2] || '');
        } else {
          result += slash;
        }
      }
      return result;
    });
  }

  /**
   * Highlight chords in text with HTML spans
   */
  function highlightChords(text, preserveNotation = false) {
    if (!text) return '';
    const converted = preserveNotation ? text : applyNotationPreference(text);
    const escaped = converted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Protect bracketed directions before chord matching. A strict full-token
    // check prevents labels such as [Chorus] and [Bridge] from being mistaken
    // for short chords simply because they begin with C or B.
    const bracketCommands = [];
    const protectedText = escaped.replace(/\[([^\]]+)\]/g, (match, inner) => {
      if (CHORD_TOKEN_RE().test(inner)) return match;
      const index = bracketCommands.push('<span class="bracket-command">' + match + '</span>') - 1;
      return '\uE000' + index + '\uE001';
    });

    // Highlight chords outside protected bracket commands.
    let result = protectedText.replace(CHORD_RE(), (match) => {
      return '<span class="chord">' + match + '</span>';
    });

    result = result.replace(/\uE000(\d+)\uE001/g, (_, index) => bracketCommands[Number(index)]);
    return result;
  }

  function startAutoScroll() {
    stopAutoScroll();
    const btn = $('btn-autoscroll');
    btn.classList.add('autoscroll-active');
    btn.textContent = '⏸';
    const speed = AUTO_SCROLL_SPEEDS[autoScrollSpeed];
    autoScrollInterval = setInterval(() => {
      const scrollSurface = selectedSongId ? dom.songContentSection : dom.content;
      scrollSurface.scrollTop += speed;
    }, 30);
  }

  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
    const btn = $('btn-autoscroll');
    if (btn) {
      btn.classList.remove('autoscroll-active');
      btn.textContent = '▶';
    }
  }

  function toggleAutoScroll() {
    if (autoScrollInterval) {
      stopAutoScroll();
    } else {
      startAutoScroll();
    }
  }

  function cycleAutoScrollSpeed() {
    autoScrollSpeed = (autoScrollSpeed + 1) % AUTO_SCROLL_SPEEDS.length;
    if (autoScrollInterval) {
      startAutoScroll(); // Restart with new speed
    }
    const labels = ['Slow', 'Medium', 'Fast'];
    showToast(`Scroll speed: ${labels[autoScrollSpeed]}`, 'success');
  }

  function updateSheetScrollTopButton() {
    if (!dom.sheetScrollTopButton || !dom.songContentSection) return;
    const shouldShow = Boolean(selectedSongId)
      && !dom.songDetail.classList.contains('hidden')
      && dom.songContentSection.scrollTop > SHEET_SCROLL_TOP_THRESHOLD;
    dom.sheetScrollTopButton.classList.toggle('hidden', !shouldShow);
  }

  function scrollSongSheetToTop() {
    if (!dom.songContentSection) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    dom.songContentSection.scrollTo({ top: 0, behavior });
    announce('Chord sheet scrolled to top');
  }

  // ================================================
  // Sidebar Functions
  // ================================================

  let sidebarOverlay = null;

  function isPersistentSidebarLayout() {
    return window.matchMedia('(min-width: 768px)').matches;
  }

  function updateSidebarToggleAccessibility() {
    const isPersistent = isPersistentSidebarLayout();
    const expanded = isPersistent
      ? !desktopSidebarCollapsed
      : dom.sidebar.classList.contains('open');
    const action = expanded ? 'Hide library panel' : 'Show library panel';
    dom.menuToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    dom.menuToggle.setAttribute('aria-label', action);
    dom.menuToggle.title = action;
  }

  function setDesktopSidebarCollapsed(collapsed, persist = true) {
    desktopSidebarCollapsed = Boolean(collapsed);
    document.body.classList.toggle('sidebar-collapsed', desktopSidebarCollapsed);
    if (persist) {
      LibraryStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, desktopSidebarCollapsed ? 'true' : 'false');
    }
    updateSidebarToggleAccessibility();
  }

  function syncSidebarLayout() {
    const isPersistent = isPersistentSidebarLayout();
    if (persistentSidebarLayout === isPersistent) {
      updateSidebarToggleAccessibility();
      return;
    }
    persistentSidebarLayout = isPersistent;

    if (isPersistent) {
      dom.sidebar.classList.remove('open');
      dom.menuToggle.classList.remove('active');
      if (sidebarOverlay) sidebarOverlay.classList.remove('visible');
      document.body.classList.toggle('sidebar-collapsed', desktopSidebarCollapsed);
    } else {
      document.body.classList.remove('sidebar-collapsed');
      dom.sidebar.classList.remove('open');
      dom.menuToggle.classList.remove('active');
      if (sidebarOverlay) sidebarOverlay.classList.remove('visible');
    }
    updateSidebarToggleAccessibility();
  }

  function createSidebarOverlay() {
    if (!sidebarOverlay) {
      sidebarOverlay = document.createElement('div');
      sidebarOverlay.className = 'sidebar-overlay';
      document.querySelector('.app-main').appendChild(sidebarOverlay);
      sidebarOverlay.addEventListener('click', closeSidebar);
    }
  }

  function openSidebar() {
    if (isPersistentSidebarLayout()) {
      setDesktopSidebarCollapsed(false);
      return;
    }
    createSidebarOverlay();
    dom.sidebar.classList.add('open');
    dom.menuToggle.classList.add('active');
    sidebarOverlay.classList.add('visible');
    updateSidebarToggleAccessibility();
  }

  function closeSidebar() {
    if (isPersistentSidebarLayout()) return;
    dom.sidebar.classList.remove('open');
    dom.menuToggle.classList.remove('active');
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove('visible');
    }
    updateSidebarToggleAccessibility();
  }

  function toggleSidebar() {
    if (isPersistentSidebarLayout()) {
      setDesktopSidebarCollapsed(!desktopSidebarCollapsed);
      announce(desktopSidebarCollapsed ? 'Library panel hidden' : 'Library panel shown');
      return;
    }
    if (dom.sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  function setSidebarTab(tab) {
    if (tab !== 'songs' && tab !== 'setlists') return;
    $$('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
    });
    $$('.sidebar-content').forEach(content => content.classList.toggle('active', content.id === `${tab}-tab`));
  }

  function openSidebarTab(tab) {
    setSidebarTab(tab);
    openSidebar();
    announce(`Showing all ${tab}`);
  }

  // ================================================
  // Render Functions
  // ================================================

  /**
   * Sort items by the given sort option
   */
  function sortItems(items, sortOption, nameKey = 'title') {
    const sorted = [...items];
    switch (sortOption) {
      case 'name-asc':
        sorted.sort((a, b) => (a[nameKey] || '').localeCompare(b[nameKey] || ''));
        break;
      case 'name-desc':
        sorted.sort((a, b) => (b[nameKey] || '').localeCompare(a[nameKey] || ''));
        break;
      case 'updated-asc':
        sorted.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        break;
      case 'updated-desc':
      default:
        sorted.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        break;
    }
    return sorted;
  }

  function renderSongList() {
    const query = dom.searchInput.value.trim().toLowerCase();
    const sortOption = dom.songsSort ? dom.songsSort.value : 'updated-desc';
    dom.songsTabCount.textContent = songs.length;

    let filtered = query
      ? songs.filter(s =>
          s.title.toLowerCase().includes(query) ||
          (s.artist && s.artist.toLowerCase().includes(query)))
      : songs;

    // Apply sorting
    filtered = sortItems(filtered, sortOption, 'title');
    dom.songListSummary.textContent = query
      ? `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`
      : `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`;

    if (filtered.length === 0) {
      LibraryView.patchList(dom.songList, `
        <li class="drawer-empty-state">
          ${getHomeItemIcon('song')}
          <strong>${query ? 'No matching songs' : 'Your song library is empty'}</strong>
          <span>${query ? 'Try a different title, artist, or lyric.' : 'Use New to add your first song.'}</span>
        </li>
      `);
      return;
    }

    LibraryView.patchList(dom.songList, filtered.map((song, i) => `
      <li style="animation-delay:${Math.min(i * 30, 300)}ms">
        <button class="song-item ${song.id === selectedSongId ? 'active' : ''}" type="button" data-id="${escapeHtml(String(song.id))}"
          ${song.id === selectedSongId ? 'aria-current="true"' : ''}>
          <span class="drawer-item-icon" aria-hidden="true">${getHomeItemIcon('song')}</span>
          <span class="drawer-item-content">
            <strong class="song-item-title">${escapeHtml(song.title)}</strong>
            <span class="drawer-item-meta">
              ${song.artist ? `<span>${escapeHtml(song.artist)}</span><span class="drawer-item-separator" aria-hidden="true">•</span>` : ''}
              <span class="drawer-item-updated">${formatRelativeUpdate(song.updatedAt || song.createdAt)}</span>
            </span>
          </span>
          <svg class="drawer-item-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </li>
    `).join(''));
  }

  function renderSetlistList() {
    const query = dom.setlistSearchInput.value.trim().toLowerCase();
    const sortOption = dom.setlistsSort ? dom.setlistsSort.value : 'updated-desc';
    dom.setlistsTabCount.textContent = setlists.length;

    let filtered = query
      ? setlists.filter(setlist =>
          setlist.name.toLowerCase().includes(query) ||
          (setlist.description && setlist.description.toLowerCase().includes(query)))
      : setlists;

    filtered = sortItems(filtered, sortOption, 'name');
    dom.setlistListSummary.textContent = query
      ? `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`
      : `${setlists.length} ${setlists.length === 1 ? 'setlist' : 'setlists'}`;

    if (filtered.length === 0) {
      LibraryView.patchList(dom.setlistList, `
        <li class="drawer-empty-state">
          ${getHomeItemIcon('setlist')}
          <strong>${query ? 'No matching setlists' : 'No setlists yet'}</strong>
          <span>${query ? 'Try a different setlist name or description.' : 'Use New to build your first setlist.'}</span>
        </li>
      `);
      return;
    }

    LibraryView.patchList(dom.setlistList, filtered.map((setlist, i) => {
      const isActive = setlist.id === selectedSetlistId && viewingSetlistSongIndex === -1;
      return `
      <li style="animation-delay:${Math.min(i * 30, 300)}ms">
        <button class="setlist-item ${isActive ? 'active' : ''}" type="button" data-id="${escapeHtml(String(setlist.id))}"
          ${isActive ? 'aria-current="true"' : ''}>
          <span class="drawer-item-icon" aria-hidden="true">${getHomeItemIcon('setlist')}</span>
          <span class="drawer-item-content">
            <strong class="setlist-item-name">${escapeHtml(setlist.name)}</strong>
            <span class="drawer-item-meta">
              <span>${setlist.songIds.length} ${setlist.songIds.length === 1 ? 'song' : 'songs'}</span>
              <span class="drawer-item-separator" aria-hidden="true">•</span>
              <span class="drawer-item-updated">${formatRelativeUpdate(setlist.updatedAt || setlist.createdAt)}</span>
            </span>
          </span>
          <svg class="drawer-item-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </li>
    `;
    }).join(''));
  }

  function formatRelativeUpdate(timestamp) {
    const updatedAt = Number(timestamp);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 'recently';

    const elapsed = Math.max(0, Date.now() - updatedAt);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;

    return new Date(updatedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: new Date(updatedAt).getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
    });
  }

  function getHomeItemIcon(type) {
    if (type === 'setlist') {
      return `
        <svg class="setlist-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 6h16M4 12h7M4 18h7"></path>
          <path d="M17 18v-8l4-1"></path>
          <circle cx="15" cy="18" r="2"></circle>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 18V5l11-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="17" cy="16" r="3"></circle>
      </svg>
    `;
  }

  function renderHomeDashboard() {
    const dashboard = $('home-dashboard');
    const fallback = $('empty-state-fallback');
    const homeSongsList = $('home-songs-list');
    const homeSetlistsList = $('home-setlists-list');

    if (songs.length === 0 && setlists.length === 0) {
      dashboard.classList.add('hidden');
      fallback.style.display = '';
      return;
    }

    dashboard.classList.remove('hidden');
    fallback.style.display = 'none';

    const recentSongs = [...songs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
    const recentSetlists = [...setlists].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);

    $('home-recent-songs').style.display = recentSongs.length ? '' : 'none';
    $('home-recent-setlists').style.display = recentSetlists.length ? '' : 'none';

    LibraryView.patchList(homeSongsList, recentSongs.map((song, i) => `
      <li style="--home-item-delay:${i * 50}ms">
        <button class="home-recent-item" type="button" data-home-type="song" data-id="${escapeHtml(String(song.id))}">
          <span class="home-item-icon" aria-hidden="true">${getHomeItemIcon('song')}</span>
          <span class="home-item-content">
            <strong class="home-item-title">${escapeHtml(song.title)}</strong>
            <span class="home-item-meta">
              ${song.artist ? `<span>${escapeHtml(song.artist)}</span><span class="home-item-separator" aria-hidden="true">•</span>` : ''}
              <span class="home-item-updated">Updated ${formatRelativeUpdate(song.updatedAt || song.createdAt)}</span>
            </span>
          </span>
          <svg class="home-item-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </li>
    `).join(''));

    LibraryView.patchList(homeSetlistsList, recentSetlists.map((setlist, i) => `
      <li style="--home-item-delay:${i * 50}ms">
        <button class="home-recent-item" type="button" data-home-type="setlist" data-id="${escapeHtml(String(setlist.id))}">
          <span class="home-item-icon" aria-hidden="true">${getHomeItemIcon('setlist')}</span>
          <span class="home-item-content">
            <strong class="home-item-title">${escapeHtml(setlist.name)}</strong>
            <span class="home-item-meta">
              <span>${setlist.songIds.length} ${setlist.songIds.length === 1 ? 'song' : 'songs'}</span>
              <span class="home-item-separator" aria-hidden="true">•</span>
              <span class="home-item-updated">Updated ${formatRelativeUpdate(setlist.updatedAt || setlist.createdAt)}</span>
            </span>
          </span>
          <svg class="home-item-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 18 6-6-6-6"></path>
          </svg>
        </button>
      </li>
    `).join(''));

    dashboard.onclick = (e) => {
      const viewAll = e.target.closest('.home-view-all');
      if (viewAll) {
        openSidebarTab(viewAll.dataset.homeTab);
        return;
      }

      const item = e.target.closest('.home-recent-item');
      if (!item) return;
      if (item.dataset.homeType === 'setlist') {
        selectSetlist(item.dataset.id);
      } else {
        selectSong(item.dataset.id);
      }
    };
  }

  function renderSongDetail() {
    const song = songs.find(s => s.id === selectedSongId);
    if (!song) {
      inlineEditingSongId = null;
      inlineEditingMode = null;
      inlineEditDraft = '';
      clearInlineEditorPosition();
      dom.emptyState.classList.remove('hidden');
      dom.songDetail.classList.add('hidden');
      dom.setlistDetail.classList.add('hidden');
      dom.appTitle.textContent = 'Chord Library';
      stopAutoScroll();
      setSongActionsVisible(false);
      renderHomeDashboard();
      return;
    }

    dom.emptyState.classList.add('hidden');
    dom.songDetail.classList.remove('hidden');
    dom.setlistDetail.classList.add('hidden');

    // Move song title into header bar for compact view
    const transposedTitle = transposeSteps !== 0
      ? `${song.title} (${transposeSteps > 0 ? '+' : ''}${transposeSteps})`
      : song.title;
    const artistSuffix = song.artist ? ` — ${song.artist}` : '';
    dom.appTitle.textContent = transposedTitle + artistSuffix;
    dom.appTitle.title = transposedTitle + artistSuffix;

    // Update transpose display
    dom.transposeValue.textContent = transposeSteps;
    dom.transposeValue.className = 'transpose-value';
    if (transposeSteps > 0) dom.transposeValue.classList.add('positive');
    else if (transposeSteps < 0) dom.transposeValue.classList.add('negative');
    dom.transposeAccept.classList.toggle('hidden', transposeSteps === 0);

    // Apply font size to song content
    const lineHeight = Math.round(currentFontSize * 1.6);
    dom.songContent.style.fontSize = currentFontSize + 'px';
    dom.songContent.style.lineHeight = lineHeight + 'px';
    dom.contentEditableHighlight.style.fontSize = currentFontSize + 'px';
    dom.contentEditableHighlight.style.lineHeight = lineHeight + 'px';
    dom.inlineSongContent.style.fontSize = currentFontSize + 'px';
    dom.inlineSongContent.style.lineHeight = lineHeight + 'px';
    dom.inlineSongHighlight.style.fontSize = currentFontSize + 'px';
    dom.inlineSongHighlight.style.lineHeight = lineHeight + 'px';

    const isInlineEditing = inlineEditingSongId === song.id;
    const isLegacyInlineEditing = isInlineEditing && inlineEditingMode === 'legacy';
    const isContentEditableEditing = isInlineEditing && inlineEditingMode === 'contenteditable';

    // Direct editing stays single-column so caret movement remains predictable.
    const twoColumnEnabled = song.twoColumn === true && !isContentEditableEditing;
    dom.songContent.classList.toggle('two-column', twoColumnEnabled);
    if (dom.twoColumnToggle) {
      dom.twoColumnToggle.checked = twoColumnEnabled;
    }

    // Transpose and highlight chords
    const transposedContent = transposeText(song.content, transposeSteps);
    if (!isContentEditableEditing) {
      LibraryView.patchHtml(dom.songContent, highlightChords(transposedContent));
    }

    // Keep inline editing stable when display preferences are changed.
    document.body.classList.toggle('inline-edit-active', isInlineEditing);
    dom.songContentSection.classList.toggle('is-editing', isLegacyInlineEditing);
    dom.songContentSection.classList.toggle('is-content-editing', isContentEditableEditing);
    dom.songContent.classList.toggle('hidden', isLegacyInlineEditing);
    dom.songContent.classList.toggle('is-content-editing', isContentEditableEditing);
    dom.inlineSongEditor.classList.toggle('hidden', !isLegacyInlineEditing);
    dom.contentEditableActions.classList.toggle('hidden', !isContentEditableEditing);
    dom.contentEditableCharButtons.classList.toggle('hidden', !isContentEditableEditing);
    dom.contentEditableHighlight.classList.toggle('hidden', !isContentEditableEditing);
    dom.inlineEditButton.classList.toggle('hidden', isInlineEditing);
    dom.inlineEditorNote.classList.toggle('hidden', !isLegacyInlineEditing || transposeSteps === 0);

    if (isContentEditableEditing) {
      dom.songContent.setAttribute('contenteditable', 'plaintext-only');
      dom.songContent.setAttribute('role', 'textbox');
      dom.songContent.setAttribute('aria-multiline', 'true');
      dom.songContent.setAttribute('aria-label', 'Editing original lyrics and chords');
      dom.songContent.setAttribute('spellcheck', 'false');
    } else {
      dom.songContent.removeAttribute('contenteditable');
      dom.songContent.removeAttribute('role');
      dom.songContent.removeAttribute('aria-multiline');
      dom.songContent.removeAttribute('aria-label');
      dom.songContent.removeAttribute('spellcheck');
    }

    // Update navigation hint if viewing from setlist
    updateSongNavigation();
  }

  function renderSetlistDetail() {
    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist) {
      dom.emptyState.classList.remove('hidden');
      dom.songDetail.classList.add('hidden');
      dom.setlistDetail.classList.add('hidden');
      // Reset header title
      dom.appTitle.textContent = 'Chord Library';
      renderHomeDashboard();
      return;
    }

    dom.emptyState.classList.add('hidden');
    dom.songDetail.classList.add('hidden');
    dom.setlistDetail.classList.remove('hidden');

    dom.appTitle.textContent = 'Chord Library';

    dom.setlistTitle.textContent = setlist.name;
    dom.setlistSongs.dataset.setlistId = setlist.id;
    dom.setlistDescription.textContent = setlist.description || '';
    dom.setlistDescription.classList.toggle('hidden', !setlist.description);

    const setlistSongs = setlist.songIds
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean);

    dom.setlistSongCount.textContent = `${setlistSongs.length} ${setlistSongs.length === 1 ? 'song' : 'songs'}`;
    dom.setlistUpdated.textContent = `Updated ${formatRelativeUpdate(setlist.updatedAt || setlist.createdAt)}`;
    dom.setlistReorderHint.classList.toggle('hidden', setlistSongs.length < 2);

    if (setlistSongs.length === 0) {
      LibraryView.patchList(dom.setlistSongs, `
        <li class="setlist-empty-state">
          ${getHomeItemIcon('song')}
          <strong>This setlist is ready for songs</strong>
          <span>Choose Add songs to start building your set.</span>
        </li>
      `);
      return;
    }

    LibraryView.patchList(dom.setlistSongs, setlistSongs.map((song, index) => `
      <li class="setlist-song-item" data-id="${escapeHtml(String(song.id))}" data-index="${index}" style="animation-delay:${index * 40}ms">
        <button class="drag-handle" type="button" aria-label="Move ${escapeHtml(song.title)}" aria-pressed="false"
          aria-describedby="setlist-sort-instructions" title="Drag, or press Space to reorder">
          <span class="setlist-song-number" aria-hidden="true">${index + 1}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 9h12M6 15h12"></path>
          </svg>
        </button>
        <button class="setlist-song-open" type="button" aria-label="Open ${escapeHtml(song.title)}">
          <span class="setlist-song-info">
            <strong class="setlist-song-title">${escapeHtml(song.title)}</strong>
            ${song.artist ? `<span class="setlist-song-artist">${escapeHtml(song.artist)}</span>` : ''}
          </span>
        </button>
        <button class="btn-remove-song" type="button" data-id="${escapeHtml(String(song.id))}"
          aria-label="Remove ${escapeHtml(song.title)} from setlist" title="Remove from setlist">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M8 12h8"></path>
          </svg>
        </button>
      </li>
    `).join(''));

    setupSetlistDragDrop();
  }

  function setupSetlistDragDrop() {
    SetlistSort.attach(dom.setlistSongs, {
      scroller: dom.content,
      status: $('setlist-sort-status'),
      onCommit: reorderSetlistSong,
      onIdle: () => NativeBridge.notifyUiReady?.()
    });
  }

  function rememberNavigation() {
    if (restoringNavigation) return;
    navigationHistory.push({
      songId: selectedSongId, setlistId: selectedSetlistId, index: viewingSetlistSongIndex,
      scroll: dom.content.scrollTop, sheetScroll: dom.songContentSection.scrollTop,
      textScroll: dom.songContent.scrollTop,
      tab: document.querySelector('.tab-btn.active')?.dataset.tab || 'songs'
    });
  }

  function restoreNavigation(state) {
    const song = songs.find(item => item.id === state.songId);
    const setlist = setlists.find(item => item.id === state.setlistId);
    // A background deletion must not bring back an unavailable screen.
    if ((state.songId && !song) || (!state.songId && state.setlistId && !setlist)) return false;
    restoringNavigation = true;
    try {
      if (song) {
        const members = setlist?.songIds.filter(id => songs.some(item => item.id === id)) || [];
        const index = members[state.index] === song.id ? state.index : members.indexOf(song.id);
        selectedSetlistId = setlist?.id || null;
        selectSong(song.id, !!setlist && index >= 0, index);
      } else if (setlist) selectSetlist(setlist.id);
      else goHome();
      setSidebarTab(state.tab);
      requestAnimationFrame(() => {
        dom.content.scrollTop = state.scroll || 0;
        dom.songContentSection.scrollTop = state.sheetScroll || 0;
        dom.songContent.scrollTop = state.textScroll || 0;
        updateSheetScrollTopButton();
      });
      return true;
    } finally { restoringNavigation = false; }
  }

  function returnToSetlist() {
    if (!selectedSetlistId || !requestDiscardInlineEdit()) return;
    const previous = navigationHistory[navigationHistory.length - 1];
    if (previous && !previous.songId && previous.setlistId === selectedSetlistId) {
      navigationHistory.pop();
      restoreNavigation(previous);
    } else {
      restoringNavigation = true;
      try { selectSetlist(selectedSetlistId); }
      finally { restoringNavigation = false; }
    }
  }

  function songFormValues() {
    return JSON.stringify([dom.songTitleInput.value, dom.songArtistInput.value, dom.songContentInput.value]);
  }

  function setlistFormValues() {
    return JSON.stringify([dom.setlistNameInput.value, dom.setlistDescriptionInput.value]);
  }

  function handleAppBack() {
    if (dom.setlistSongs?._sorter?.cancel()) return true;
    const visible = element => element && !element.classList.contains('hidden');
    if (visible(dom.scanQrOverlay)) { closeScannerOverlay(); return true; }
    if (visible($('tour-overlay'))) { dismissTour(); return true; }
    const modal = modalLayers.slice().reverse().find(visible);
    if (modal) {
      if (modal === dom.songModal) {
        if (songFormValues() === songFormBaseline || window.confirm('Discard your unsaved song changes?')) closeSongModal();
      } else if (modal === dom.setlistModal) {
        if (setlistFormValues() === setlistFormBaseline || window.confirm('Discard your unsaved setlist changes?')) closeSetlistModal();
      } else if (modal === dom.confirmModal) closeConfirmModal();
      else if (modal === dom.addSongsModal) closeAddSongsModal();
      else if (modal === dom.shareQrModal) closeShareQrModal();
      else if (modal === $('preferences-modal')) closePreferencesModal();
      return true;
    }
    if (visible(dom.songActionsMenu)) { closeSongActionsMenu(); return true; }
    const dropdown = $('user-dropdown');
    if (dropdown?.classList.contains('visible')) { dropdown.classList.remove('visible'); return true; }
    if (dom.sidebar.classList.contains('open')) { closeSidebar(); return true; }
    if (inlineEditingSongId) {
      if (requestDiscardInlineEdit()) renderSongDetail();
      return true;
    }
    while (navigationHistory.length) {
      if (restoreNavigation(navigationHistory.pop())) return true;
    }
    // Newly created/imported songs may open directly without a recorded parent.
    if (selectedSongId && selectedSetlistId) { returnToSetlist(); return true; }
    if (selectedSongId || selectedSetlistId) { goHome(); return true; }
    return false;
  }

  function goHome() {
    if (!requestDiscardInlineEdit()) return;
    navigationHistory = [];
    selectedSongId = null;
    selectedSetlistId = null;
    viewingSetlistSongIndex = -1;
    viewingFromSetlistId = null;
    transposeSteps = 0;
    stopAutoScroll();

    dom.emptyState.classList.remove('hidden');
    dom.songDetail.classList.add('hidden');
    dom.setlistDetail.classList.add('hidden');
    dom.appTitle.textContent = 'Chord Library';
    $('btn-home').classList.add('hidden');
    $('btn-autoscroll').classList.add('hidden');
    setSongActionsVisible(false);

    renderSongList();
    renderSetlistList();
    renderHomeDashboard();
  }

  function reorderSetlistSong(fromIndex, toIndex) {
    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist || fromIndex === toIndex) return;
    const visibleIndices = setlist.songIds.map((id, index) => songs.some(song => song.id === id) ? index : -1).filter(index => index >= 0);
    setlist.songIds = SetlistSort.reorderMembers(setlist.songIds, visibleIndices, fromIndex, toIndex);
    setlist.updatedAt = Date.now();

    saveSetlists();
    renderSetlistDetail();
    renderSetlistList();
  }

  function updateSongNavigation() {
    // Show/hide back-to-setlist button
    const backBtn = document.getElementById('btn-back-setlist');
    const backLabel = document.getElementById('btn-back-setlist-label');
    if (selectedSetlistId && viewingSetlistSongIndex >= 0) {
      const setlist = setlists.find(p => p.id === selectedSetlistId);
      if (backBtn) {
        backBtn.classList.remove('hidden');
        if (backLabel) backLabel.textContent = setlist ? setlist.name : 'Setlist';
      }
    } else {
      if (backBtn) backBtn.classList.add('hidden');
    }

    const setlist = setlists.find(p => p.id === selectedSetlistId);

    if (!setlist || viewingSetlistSongIndex < 0) {
      dom.songNavHint.classList.add('hidden');
      return;
    }

    const setlistSongs = setlist.songIds
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean);

    if (setlistSongs.length <= 1) {
      dom.songNavHint.classList.add('hidden');
      return;
    }

    dom.songNavHint.classList.remove('hidden');
    dom.navHintInfo.textContent = `${viewingSetlistSongIndex + 1} / ${setlistSongs.length}`;
  }

  // ================================================
  // Song Actions
  // ================================================

  function selectSong(id, fromSetlist = false, index = -1) {
    if (id !== inlineEditingSongId && !requestDiscardInlineEdit()) return;
    if (selectedSongId !== id || (!fromSetlist && selectedSetlistId) || viewingSetlistSongIndex !== index)
      rememberNavigation();
    selectedSongId = id;
    stopAutoScroll();

    // Load persistent transpose value for this song
    const song = songs.find(s => s.id === id);
    transposeSteps = song && typeof song.transposeSteps === 'number' ? song.transposeSteps : 0;

    if (fromSetlist) {
      viewingSetlistSongIndex = index;
      viewingFromSetlistId = selectedSetlistId;
    } else {
      selectedSetlistId = null;
      viewingSetlistSongIndex = -1;
      viewingFromSetlistId = null;
    }

    saveSidebarScroll();
    renderSongList();
    renderSongDetail();
    dom.songContentSection.scrollTop = 0;
    updateSheetScrollTopButton();
    closeSidebar();
    $('btn-home').classList.remove('hidden');
    setSongActionsVisible(true);

    // Announce to screen readers
    if (song) announce(`Viewing ${song.title}`);
  }

  function openSongModal(songId = null) {
    const wasInlineEditing = Boolean(inlineEditingSongId);
    if (!requestDiscardInlineEdit()) return;
    if (wasInlineEditing && selectedSongId) {
      renderSongDetail();
      announce('Inline editing cancelled');
    }
    editingSongId = songId;
    stopQrScan();
    closeScannerOverlay();

    const isEditingInfo = Boolean(songId);
    dom.songImportPanel.classList.toggle('hidden', isEditingInfo);
    dom.songContentField.classList.toggle('hidden', isEditingInfo);
    dom.editSongInfoNote.classList.toggle('hidden', !isEditingInfo);
    dom.songContentInput.required = !isEditingInfo;
    dom.songContentInput.disabled = isEditingInfo;
    dom.songForm.classList.toggle('is-info-edit', isEditingInfo);

    if (songId) {
      const song = songs.find(s => s.id === songId);
      if (song) {
        dom.songModalTitle.textContent = 'Edit song info';
        dom.songModalSubtitle.textContent = 'Update how this song appears in your library.';
        dom.saveSongLabel.textContent = 'Save info';
        dom.songTitleInput.value = song.title.toUpperCase();
        dom.songArtistInput.value = song.artist || '';
        dom.songContentInput.value = song.content;
      }
    } else {
      dom.songForm.reset();
      dom.songModalTitle.textContent = 'Add a song';
      dom.songModalSubtitle.textContent = 'Create a clear, searchable chord sheet.';
      dom.saveSongLabel.textContent = 'Add song';
    }

    songFormBaseline = songFormValues();
    openModalWithFocusTrap(dom.songModal);
    setTimeout(() => dom.songTitleInput.focus(), 100);
  }

  function closeSongModal() {
    stopQrScan();
    closeScannerOverlay();
    closeModalWithFocusTrap(dom.songModal);
    editingSongId = null;
    dom.songContentInput.disabled = false;
    dom.songContentInput.required = true;
    dom.songForm.classList.remove('is-info-edit');
    dom.songForm.reset();
  }

  function saveSong(e) {
    e.preventDefault();

    const title = dom.songTitleInput.value.trim().toUpperCase();
    const artist = dom.songArtistInput.value.trim();
    const content = dom.songContentInput.value;

    if (!title || (!editingSongId && !content)) return;

    if (editingSongId) {
      const song = songs.find(s => s.id === editingSongId);
      if (song) {
        song.title = title;
        song.artist = artist;
        song.updatedAt = Date.now();
      }
    } else {
      const newSong = {
        id: generateId(),
        title,
        artist,
        content,
        transposeSteps: 0,
        twoColumn: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      songs.push(newSong);
      selectedSongId = newSong.id;
      transposeSteps = 0; // Reset transpose for new song

      // Auto-add new song to current setlist if viewing from setlist
      if (viewingFromSetlistId) {
        const setlist = setlists.find(p => p.id === viewingFromSetlistId);
        if (setlist) {
          setlist.songIds.push(newSong.id);
          setlist.updatedAt = Date.now();
          // Update the index to point to the new song (last in setlist)
          viewingSetlistSongIndex = setlist.songIds.length - 1;
          saveSetlists();
          renderSetlistList();
        }
      } else {
        // Not from setlist, reset the index
        viewingSetlistSongIndex = -1;
      }
    }

    saveSongs();
    closeSongModal();
    renderSongList();
    renderSongDetail();
  }

  function deleteSong(id) {
    const song = songs.find(s => s.id === id);
    if (!song) return;

    openConfirmModal(
      `Are you sure you want to delete "${song.title}"?`,
      () => {
        // Store undo data before deleting
        const removedSong = { ...song };
        const setlistBackups = setlists.map(p => ({ id: p.id, songIds: [...p.songIds] }));

        songs = songs.filter(s => s.id !== id);

        // Remove from all setlists
        setlists.forEach(setlist => {
          setlist.songIds = setlist.songIds.filter(songId => songId !== id);
        });

        saveSongs();
        saveSetlists();

        if (selectedSongId === id) {
          selectedSongId = null;
          viewingSetlistSongIndex = -1;
        }

        renderSongList();
        renderSongDetail();
        renderSetlistList();

        // Show undo toast
        showUndoToast(`"${removedSong.title}" deleted`, () => {
          // Undo: restore song and setlist references
          songs.push(removedSong);
          setlistBackups.forEach(backup => {
            const setlist = setlists.find(p => p.id === backup.id);
            if (setlist) setlist.songIds = backup.songIds;
          });
          saveSongs();
          saveSetlists();
          selectedSongId = removedSong.id;
          transposeSteps = removedSong.transposeSteps || 0;
          renderSongList();
          renderSongDetail();
          renderSetlistList();
        });

        // Sync tombstone after undo window expires
        setTimeout(() => {
          if (!songs.find(s => s.id === id)) {
            if (typeof SyncService !== 'undefined') {
              SyncService.onItemDeleted('songs', removedSong);
            }
          }
        }, 6000);
      }
    );
  }

  // ================================================
  // Setlist Actions
  // ================================================

  function selectSetlist(id) {
    if (!requestDiscardInlineEdit()) return;
    if (selectedSetlistId !== id || selectedSongId) rememberNavigation();
    selectedSetlistId = id;
    selectedSongId = null;
    viewingSetlistSongIndex = -1;
    viewingFromSetlistId = id; // Track for auto-add feature
    transposeSteps = 0;
    stopAutoScroll();

    renderSetlistList();
    renderSetlistDetail();
    closeSidebar();
    $('btn-home').classList.remove('hidden');
    $('btn-autoscroll').classList.add('hidden');
    setSongActionsVisible(false);
  }

  function openSetlistModal(setlistId = null) {
    editingSetlistId = setlistId;

    if (setlistId) {
      const setlist = setlists.find(p => p.id === setlistId);
      if (setlist) {
        dom.setlistModalTitle.textContent = 'Edit setlist';
        dom.setlistModalSubtitle.textContent = 'Update this setlist’s name or supporting details.';
        dom.setlistSaveLabel.textContent = 'Save changes';
        dom.setlistNameInput.value = setlist.name;
        dom.setlistDescriptionInput.value = setlist.description || '';
      }
    } else {
      dom.setlistModalTitle.textContent = 'Create setlist';
      dom.setlistModalSubtitle.textContent = 'Build a setlist for services, rehearsals, or events.';
      dom.setlistSaveLabel.textContent = 'Create setlist';
      dom.setlistForm.reset();
    }

    setlistFormBaseline = setlistFormValues();
    openModalWithFocusTrap(dom.setlistModal);
    setTimeout(() => dom.setlistNameInput.focus(), 100);
  }

  function closeSetlistModal() {
    closeModalWithFocusTrap(dom.setlistModal);
    editingSetlistId = null;
    dom.setlistForm.reset();
  }

  function saveSetlist(e) {
    e.preventDefault();

    const name = dom.setlistNameInput.value.trim();
    const description = dom.setlistDescriptionInput.value.trim();

    if (!name) return;

    if (editingSetlistId) {
      const setlist = setlists.find(p => p.id === editingSetlistId);
      if (setlist) {
        setlist.name = name;
        setlist.description = description;
        setlist.updatedAt = Date.now();
      }
    } else {
      const newSetlist = {
        id: generateId(),
        name,
        description,
        songIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setlists.push(newSetlist);
      selectedSetlistId = newSetlist.id;
    }

    saveSetlists();
    closeSetlistModal();
    renderSetlistList();
    renderSetlistDetail();
    $('btn-home').classList.remove('hidden');
    $('btn-autoscroll').classList.add('hidden');
    setSongActionsVisible(false);
  }

  function deleteSetlist(id) {
    const setlist = setlists.find(p => p.id === id);
    if (!setlist) return;

    openConfirmModal(
      `Are you sure you want to delete setlist "${setlist.name}"?`,
      () => {
        const removedSetlist = { ...setlist, songIds: [...setlist.songIds] };

        setlists = setlists.filter(p => p.id !== id);
        saveSetlists();

        if (selectedSetlistId === id) {
          selectedSetlistId = null;
        }

        renderSetlistList();
        dom.emptyState.classList.remove('hidden');
        dom.setlistDetail.classList.add('hidden');

        // Show undo toast
        showUndoToast(`"${removedSetlist.name}" deleted`, () => {
          setlists.push(removedSetlist);
          saveSetlists();
          selectedSetlistId = removedSetlist.id;
          renderSetlistList();
          renderSetlistDetail();
        });

        // Sync tombstone after undo window expires
        setTimeout(() => {
          if (!setlists.find(p => p.id === id)) {
            if (typeof SyncService !== 'undefined') {
              SyncService.onItemDeleted('setlists', removedSetlist);
            }
          }
        }, 6000);
      }
    );
  }

  function openAddSongsModal() {
    if (!selectedSetlistId) return;

    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist) return;

    const sortedSongs = [...songs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    dom.songSelector.innerHTML = sortedSongs.map(song => `
      <label class="song-selector-item">
        <input type="checkbox" value="${escapeHtml(String(song.id))}" ${setlist.songIds.includes(song.id) ? 'checked' : ''}>
        <div class="song-selector-info">
          <div class="song-selector-title">${escapeHtml(song.title)}</div>
          ${song.artist ? `<div class="song-selector-artist">${escapeHtml(song.artist)}</div>` : ''}
        </div>
      </label>
    `).join('');

    openModalWithFocusTrap(dom.addSongsModal);
  }

  function closeAddSongsModal() {
    closeModalWithFocusTrap(dom.addSongsModal);
  }

  function confirmAddSongs() {
    if (!selectedSetlistId) return;

    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist) return;

    const checkboxes = dom.songSelector.querySelectorAll('input[type="checkbox"]');
    const selectedIds = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    // Preserve existing order (oldest first), append newly added at the end
    const existing = setlist.songIds.filter(id => selectedIds.includes(id));
    const added = selectedIds.filter(id => !setlist.songIds.includes(id));
    setlist.songIds = [...existing, ...added];
    setlist.updatedAt = Date.now();

    saveSetlists();
    closeAddSongsModal();
    renderSetlistDetail();
    renderSetlistList();
  }

  function removeSongFromSetlist(songId) {
    if (!selectedSetlistId) return;

    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist) return;

    setlist.songIds = setlist.songIds.filter(id => id !== songId);
    setlist.updatedAt = Date.now();

    saveSetlists();
    renderSetlistDetail();
    renderSetlistList();
  }

  // ================================================
  // Setlist Navigation
  // ================================================

  function navigateToPreviousSong() {
    if (inlineEditingSongId) return;
    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist || viewingSetlistSongIndex <= 0) return;

    const setlistSongs = setlist.songIds
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean);

    viewingSetlistSongIndex--;
    const song = setlistSongs[viewingSetlistSongIndex];
    if (song) {
      selectedSongId = song.id;
      // Load persistent transpose value for this song
      transposeSteps = typeof song.transposeSteps === 'number' ? song.transposeSteps : 0;
      renderSongDetail();
      dom.songContentSection.scrollTop = 0;
      updateSheetScrollTopButton();
    }
  }

  function navigateToNextSong() {
    if (inlineEditingSongId) return;
    const setlist = setlists.find(p => p.id === selectedSetlistId);
    if (!setlist) return;

    const setlistSongs = setlist.songIds
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean);

    if (viewingSetlistSongIndex >= setlistSongs.length - 1) return;

    viewingSetlistSongIndex++;
    const song = setlistSongs[viewingSetlistSongIndex];
    if (song) {
      selectedSongId = song.id;
      // Load persistent transpose value for this song
      transposeSteps = typeof song.transposeSteps === 'number' ? song.transposeSteps : 0;
      renderSongDetail();
      dom.songContentSection.scrollTop = 0;
      updateSheetScrollTopButton();
    }
  }

  // ================================================
  // Swipe Navigation (Mobile)
  // ================================================

  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  let isSwiping = false;
  let swipeIndicatorLeft = null;
  let swipeIndicatorRight = null;

  function createSwipeIndicators() {
    swipeIndicatorLeft = document.createElement('div');
    swipeIndicatorLeft.className = 'swipe-indicator left';
    swipeIndicatorLeft.innerHTML = '‹';
    document.body.appendChild(swipeIndicatorLeft);

    swipeIndicatorRight = document.createElement('div');
    swipeIndicatorRight.className = 'swipe-indicator right';
    swipeIndicatorRight.innerHTML = '›';
    document.body.appendChild(swipeIndicatorRight);
  }

  function handleTouchStart(e) {
    // Only enable swipe when viewing a song from a setlist
    if (viewingSetlistSongIndex < 0 || inlineEditingSongId) return;

    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isSwiping = true;
  }

  function handleTouchMove(e) {
    if (!isSwiping || viewingSetlistSongIndex < 0) return;

    const currentX = e.changedTouches[0].screenX;
    const currentY = e.changedTouches[0].screenY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;

    // Only show indicators if horizontal swipe is significant
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      const setlist = setlists.find(p => p.id === selectedSetlistId);
      if (!setlist) return;

      const setlistSongs = setlist.songIds.filter(id => songs.find(s => s.id === id));

      if (diffX > 0 && viewingSetlistSongIndex > 0) {
        swipeIndicatorLeft.classList.add('visible');
        swipeIndicatorRight.classList.remove('visible');
      } else if (diffX < 0 && viewingSetlistSongIndex < setlistSongs.length - 1) {
        swipeIndicatorRight.classList.add('visible');
        swipeIndicatorLeft.classList.remove('visible');
      }
    }
  }

  function handleTouchEnd(e) {
    if (!isSwiping || viewingSetlistSongIndex < 0) {
      isSwiping = false;
      return;
    }

    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;

    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Hide indicators
    swipeIndicatorLeft.classList.remove('visible');
    swipeIndicatorRight.classList.remove('visible');

    // Minimum swipe distance: 80px, and more horizontal than vertical
    if (Math.abs(diffX) > 80 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) {
        navigateToPreviousSong();
      } else {
        navigateToNextSong();
      }
    }

    isSwiping = false;
  }

  // ================================================
  // Confirm Modal
  // ================================================

  function openConfirmModal(message, callback) {
    dom.confirmMessage.textContent = message;
    confirmCallback = callback;
    openModalWithFocusTrap(dom.confirmModal);
  }

  function closeConfirmModal() {
    closeModalWithFocusTrap(dom.confirmModal);
    confirmCallback = null;
  }

  function executeConfirm() {
    if (confirmCallback) {
      confirmCallback();
    }
    closeConfirmModal();
  }

  // ================================================
  // Utility Functions
  // ================================================

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Show a toast notification (used when SyncService is not available)
   */
  function showToast(message, type) {
    if (typeof SyncService !== 'undefined' && SyncService.showToast) {
      SyncService.showToast(message, type);
      return;
    }
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3000);
  }

  /**
   * Show undo toast with a callback
   */
  function showUndoToast(message, undoCallback) {
    const toast = document.getElementById('undo-toast');
    const msgEl = document.getElementById('undo-toast-message');
    const undoBtn = document.getElementById('btn-undo');
    if (!toast) return;

    // Remove the previous callback as well as its timer before offering a new undo.
    if (undoCleanup) undoCleanup();
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }

    msgEl.textContent = message;
    toast.classList.remove('hidden');

    const cleanup = () => {
      if (undoTimer) clearTimeout(undoTimer);
      toast.classList.add('hidden');
      undoBtn.removeEventListener('click', handleUndo);
      undoTimer = null;
      undoCleanup = null;
      NativeBridge.notifyUiReady?.();
    };

    const handleUndo = () => {
      if (undoTimer) clearTimeout(undoTimer);
      undoCallback();
      cleanup();
      showToast('Restored', 'success');
    };

    undoBtn.addEventListener('click', handleUndo, { once: true });
    undoCleanup = cleanup;
    undoTimer = setTimeout(cleanup, 5000);
  }

  /**
   * Export all data as JSON download
   */
  async function exportData() {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      songs: songs,
      setlists: setlists
    };
    try {
      await NativeBridge.exportFile(
        `chord-library-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(data, null, 2));
      showToast('Backup prepared', 'success');
    } catch (error) {
      showToast('Export failed: ' + error.message, 'error');
    }
  }

  /**
   * Export a single song as JSON download
   */
  async function exportSingleSong(songId) {
    const song = songs.find(s => s.id === songId);
    if (!song) return;
    const data = {
      version: 1,
      type: 'single-song',
      exportedAt: new Date().toISOString(),
      song: song
    };
    const safeName = song.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    try {
      await NativeBridge.exportFile(`${safeName}.chord.json`, JSON.stringify(data, null, 2));
      showToast(`"${song.title}" export prepared`, 'success');
    } catch (error) {
      showToast('Export failed: ' + error.message, 'error');
    }
  }

  function normalizeSongPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || raw.n || '').trim();
    const artist = String(raw.artist || raw.a || '').trim();
    const content = String(raw.content || raw.c || '');
    if (!title || !content) return null;
    return { title, artist, content };
  }

  function extractSongFromParsedData(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.type === 'single-song' && data.song) {
      return normalizeSongPayload(data.song);
    }
    if (data.t === SONG_QR_TYPE && Number(data.v) === SONG_QR_VERSION) {
      return normalizeSongPayload(data);
    }
    if (Array.isArray(data.songs) && data.songs.length > 0) {
      return normalizeSongPayload(data.songs[0]);
    }
    return normalizeSongPayload(data);
  }

  function populateSongForm(song) {
    dom.songTitleInput.value = song.title || '';
    dom.songArtistInput.value = song.artist || '';
    dom.songContentInput.value = song.content || '';
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-qr-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.dataset.qrSrc = src;
      script.onload = () => {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(script);
    });
  }

  async function ensureQrGeneratorLoaded() {
    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      return true;
    }

    if (qrCodeLoadPromise) {
      return qrCodeLoadPromise;
    }

    qrCodeLoadPromise = (async () => {
      const candidates = ['_content/ChordLibrary.Shared/js/qrcode.js'];

      for (const src of candidates) {
        try {
          await loadScriptOnce(src);
          if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
            return true;
          }
        } catch (err) {
          // Try next source.
        }
      }

      return false;
    })();

    const loaded = await qrCodeLoadPromise;
    if (!loaded) {
      qrCodeLoadPromise = null;
    }
    return loaded;
  }

  async function shareSongViaQr(songId) {
    const song = songs.find(s => s.id === songId);
    if (!song) return;
    const loaded = await ensureQrGeneratorLoaded();
    if (!loaded || !window.QRCode || typeof window.QRCode.toCanvas !== 'function') {
      showToast('QR generator unavailable. Check connection and try again.', 'error');
      return;
    }

    const payload = JSON.stringify({
      t: SONG_QR_TYPE,
      v: SONG_QR_VERSION,
      n: song.title,
      a: song.artist || '',
      c: compressForQr(song.content || '')
    });

    try {
      await window.QRCode.toCanvas(dom.shareQrCanvas, payload, {
        width: 260,
        margin: 1,
        errorCorrectionLevel: 'L'
      });
      if (dom.shareQrSongName) {
        dom.shareQrSongName.textContent = song.artist
          ? `${song.title} — ${song.artist}`
          : song.title;
      }
      dom.shareQrCanvas.setAttribute('aria-label', `Generated QR code for ${song.title}`);
      if (dom.shareQrHelp) {
        const helpText = dom.shareQrHelp.querySelector('span');
        if (helpText) helpText.textContent = 'On the other device, open Add Song and choose QR code.';
      }
      openModalWithFocusTrap(dom.shareQrModal);
    } catch (err) {
      const message = String((err && err.message) || err || 'QR generation failed');
      if (message.toLowerCase().includes('code length overflow')) {
        showToast('Song is too large for a single QR. Use Export Song file instead.', 'error');
      } else {
        showToast('Failed to generate QR: ' + message, 'error');
      }
    }
  }

  function compressForQr(content) {
    if (!content) return '';
    const sectionRe = /^\s*\[.+\]\s*$/;
    const headerRe = /^(INTRO|VERSE|CHORUS|BRIDGE|OUTRO|INSTRUMENTAL|PRE-CHORUS|INTERLUDE|TAG|ENDING|KEY:)/i;
    const lines = content.split('\n');
    const kept = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { kept.push(''); continue; }
      if (sectionRe.test(trimmed) || headerRe.test(trimmed)) { kept.push(trimmed); continue; }
      const chordRe = CHORD_RE();
      if (chordRe.test(trimmed)) {
        kept.push(stripLyricsFromLine(trimmed));
        continue;
      }
      if (/^[-|/\\=_~]+$/.test(trimmed)) { kept.push(trimmed); continue; }
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function stripLyricsFromLine(line) {
    const re = CHORD_RE();
    let lastChordEnd = 0;
    let m;
    while ((m = re.exec(line)) !== null) { lastChordEnd = m.index + m[0].length; }
    if (lastChordEnd === 0) return line;
    const after = line.substring(lastChordEnd);
    // Keep trailing separators and any bracketed commands like [to instrumental]
    const keepMatch = after.match(/^[\s|/\\()\-_~]*(\[.+\])?\s*/);
    return line.substring(0, lastChordEnd) + (keepMatch ? keepMatch[0].trimEnd() : '');
  }

  function closeShareQrModal() {
    if (!dom.shareQrModal || dom.shareQrModal.classList.contains('hidden')) return;
    closeModalWithFocusTrap(dom.shareQrModal);
  }

  function getQrDetector() {
    if (!('BarcodeDetector' in window)) return null;
    if (qrDetector) return qrDetector;
    try {
      qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      qrDetector = new BarcodeDetector();
    }
    return qrDetector;
  }

  function handleScannedSongQr(rawValue) {
    if (!rawValue) return false;
    let parsed;
    try {
      parsed = JSON.parse(rawValue);
    } catch (err) {
      showToast('QR does not contain valid song data.', 'error');
      return false;
    }

    const song = extractSongFromParsedData(parsed);
    if (!song) {
      showToast('QR does not contain a compatible song.', 'error');
      return false;
    }

    populateSongForm(song);
    showToast('Song loaded from QR. Review and save.', 'success');
    return true;
  }

  function stopQrScan() {
    qrScannerActive = false;
    if (qrScannerRafId) {
      cancelAnimationFrame(qrScannerRafId);
      qrScannerRafId = null;
    }
    if (qrScannerStream) {
      qrScannerStream.getTracks().forEach(track => track.stop());
      qrScannerStream = null;
    }
    if (dom.scanQrVideo) {
      dom.scanQrVideo.srcObject = null;
    }
  }

  function openScannerOverlay() {
    if (!dom.scanQrOverlay) return;
    dom.scanQrOverlay.classList.remove('hidden');
    dom.scanQrOverlay.classList.remove('is-ready');
    if (dom.scanQrStatus) dom.scanQrStatus.textContent = 'Requesting camera access…';
    setTimeout(() => $('btn-close-scanner').focus(), 50);
  }

  function closeScannerOverlay() {
    stopQrScan();
    if (dom.scanQrOverlay) dom.scanQrOverlay.classList.add('hidden');
    if (dom.scanQrStatus) dom.scanQrStatus.textContent = 'Camera ready';
    if (dom.scanQrOverlay) dom.scanQrOverlay.classList.remove('is-ready');
  }

  async function scanQrFrameLoop() {
    if (!qrScannerActive || !dom.scanQrVideo) return;
    try {
      const detector = getQrDetector();
      if (!detector) return;
      const barcodes = await detector.detect(dom.scanQrVideo);
      if (barcodes && barcodes.length > 0) {
        const rawValue = barcodes[0].rawValue || '';
        if (rawValue) {
          let parsed = null;
          try {
            parsed = JSON.parse(rawValue);
          } catch (err) {
            parsed = null;
          }
          if (parsed) {
            const song = extractSongFromParsedData(parsed);
            if (song) {
              populateSongForm(song);
              showToast('Song loaded from QR. Review and save.', 'success');
              stopQrScan();
              closeScannerOverlay();
              return;
            }
          }
        }
      }
    } catch (err) {
      // Ignore transient frame-read errors.
    }
    qrScannerRafId = requestAnimationFrame(scanQrFrameLoop);
  }

  async function startQrScan() {
    if (!NativeBridge.supportsQrImport) return;
    if (NativeBridge.isNative) {
      try {
        const payload = await NativeBridge.scanQr();
        if (payload) handleScannedSongQr(payload);
      } catch (error) {
        showToast('Unable to scan QR code: ' + error.message, 'error');
      }
      return;
    }
    const detector = getQrDetector();
    if (!detector) {
      showToast('QR scan not supported on this browser.', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Camera access is unavailable in this browser.', 'error');
      return;
    }

    stopQrScan();
    openScannerOverlay();
    try {
      qrScannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      if (!dom.scanQrVideo) return;
      dom.scanQrVideo.srcObject = qrScannerStream;
      await dom.scanQrVideo.play();
      qrScannerActive = true;
      dom.scanQrOverlay.classList.add('is-ready');
      if (dom.scanQrStatus) dom.scanQrStatus.textContent = 'Camera ready';
      qrScannerRafId = requestAnimationFrame(scanQrFrameLoop);
    } catch (err) {
      showToast('Unable to start camera scan.', 'error');
      stopQrScan();
      closeScannerOverlay();
    }
  }

  async function scanQrFromImageFile(file) {
    if (!file) return;
    closeScannerOverlay();
    const detector = getQrDetector();
    if (!detector) {
      showToast('QR scan not supported on this browser.', 'error');
      return;
    }

    try {
      let detected = [];
      if ('createImageBitmap' in window) {
        const bitmap = await createImageBitmap(file);
        detected = await detector.detect(bitmap);
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      } else {
        const img = new Image();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });
        detected = await detector.detect(img);
      }

      if (!detected || detected.length === 0) {
        showToast('No QR code detected in image.', 'error');
        return;
      }

      const rawValue = detected[0].rawValue || '';
      handleScannedSongQr(rawValue);
    } catch (err) {
      showToast('Failed to scan QR image.', 'error');
    }
  }

  /**
   * Import a single song from a JSON file
   */
  function importSingleSong(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const imported = extractSongFromParsedData(data);
        if (!imported) {
          showToast('Invalid song file', 'error');
          return;
        }

        populateSongForm(imported);
        showToast('Song loaded into form — review and save', 'success');
      } catch (err) {
        showToast('Failed to parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /**
   * Import data from a JSON file
   */
  async function importData(file) {
    try {
      await NativeBridge.previewImport(await file.text());
    } catch (error) {
      showToast('Import failed: ' + error.message, 'error');
    }
  }

  /**
   * Toggle between light and dark themes
   */
  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    LibraryStorage.setItem(STORAGE_KEYS.THEME, next);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = next === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  }

  /**
   * Load saved theme preference
   */
  function loadTheme() {
    const saved = LibraryStorage.getItem(STORAGE_KEYS.THEME);
    const theme = saved === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    LibraryStorage.setItem(STORAGE_KEYS.THEME, theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'light' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    updatePreferencesUI();
  }

  function setNotationPref(pref) {
    notationPref = pref;
    LibraryStorage.setItem(STORAGE_KEYS.NOTATION, pref);
    updatePreferencesUI();
    if (selectedSongId) renderSongDetail();
  }

  function loadNotationPref() {
    const saved = LibraryStorage.getItem(STORAGE_KEYS.NOTATION);
    notationPref = ['original', 'sharp', 'flat'].includes(saved) ? saved : 'original';
  }

  function openPreferencesModal() {
    document.getElementById('user-dropdown').classList.remove('visible');
    updatePreferencesUI();
    openModalWithFocusTrap($('preferences-modal'));
  }

  function closePreferencesModal() {
    closeModalWithFocusTrap($('preferences-modal'));
  }

  function updatePreferencesUI() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    $('pref-theme-dark').classList.toggle('active', theme === 'dark');
    $('pref-theme-light').classList.toggle('active', theme === 'light');
    $('pref-notation-original').classList.toggle('active', notationPref === 'original');
    $('pref-notation-sharp').classList.toggle('active', notationPref === 'sharp');
    $('pref-notation-flat').classList.toggle('active', notationPref === 'flat');
    $('pref-theme-dark').setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    $('pref-theme-light').setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    $('pref-notation-original').setAttribute('aria-pressed', notationPref === 'original' ? 'true' : 'false');
    $('pref-notation-sharp').setAttribute('aria-pressed', notationPref === 'sharp' ? 'true' : 'false');
    $('pref-notation-flat').setAttribute('aria-pressed', notationPref === 'flat' ? 'true' : 'false');
  }

  /**
   * Focus trap for modal dialogs
   */
  function trapFocus(modalEl) {
    const focusableSelectors = 'button:not([disabled]):not(.hidden), input:not([disabled]):not(.hidden), select:not([disabled]):not(.hidden), textarea:not([disabled]):not(.hidden), [tabindex]:not([tabindex=\"-1\"])';
    const focusables = modalEl.querySelectorAll(focusableSelectors);
    if (focusables.length === 0) return null;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    function handler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    modalEl.addEventListener('keydown', handler);
    first.focus();
    return handler; // return so we can remove it later
  }

  let activeFocusTrapHandler = null;
  let previouslyFocusedElement = null;

  function openModalWithFocusTrap(modalEl) {
    modalLayers = modalLayers.filter(layer => layer !== modalEl);
    modalLayers.push(modalEl);
    previouslyFocusedElement = document.activeElement;
    modalEl.classList.remove('hidden');
    // Small delay to allow DOM to render
    setTimeout(() => {
      activeFocusTrapHandler = trapFocus(modalEl.querySelector('.modal-content'));
    }, 50);
  }

  function closeModalWithFocusTrap(modalEl) {
    modalLayers = modalLayers.filter(layer => layer !== modalEl);
    modalEl.classList.add('hidden');
    if (activeFocusTrapHandler && modalEl.querySelector('.modal-content')) {
      modalEl.querySelector('.modal-content').removeEventListener('keydown', activeFocusTrapHandler);
      activeFocusTrapHandler = null;
    }
    if (previouslyFocusedElement) {
      previouslyFocusedElement.focus();
      previouslyFocusedElement = null;
    }
    NativeBridge.notifyUiReady?.();
  }

  /**
   * Save sidebar scroll position
   */
  function saveSidebarScroll() {
    try {
      const scrollTop = dom.songList.scrollTop;
      sessionStorage.setItem(STORAGE_KEYS.SIDEBAR_SCROLL, scrollTop.toString());
    } catch(e) { /* ignore */ }
  }

  /**
   * Restore sidebar scroll position
   */
  function restoreSidebarScroll() {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEYS.SIDEBAR_SCROLL);
      if (saved) dom.songList.scrollTop = parseInt(saved, 10);
    } catch(e) { /* ignore */ }
  }

  /**
   * Announce to screen readers
   */
  function announce(message) {
    const el = document.getElementById('sr-announcements');
    if (el) {
      el.textContent = '';
      setTimeout(() => { el.textContent = message; }, 100);
    }
  }

  /**
   * Save current transpose value to the song (persistent)
   */
  function saveTransposeForSong() {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    if (song) {
      song.transposeSteps = transposeSteps;
      song.updatedAt = Date.now();
      saveSongs();
    }
  }

  /**
   * Replace the song's source chords with the currently displayed transposition.
   */
  function acceptTranspositionAsBase() {
    if (!selectedSongId || transposeSteps === 0) return;
    const song = songs.find(s => s.id === selectedSongId);
    if (!song) return;

    const previous = {
      content: song.content,
      transposeSteps: song.transposeSteps || 0,
      updatedAt: song.updatedAt
    };
    const acceptedSteps = transposeSteps;

    song.content = transposeText(song.content, acceptedSteps);
    song.transposeSteps = 0;
    song.updatedAt = Date.now();
    transposeSteps = 0;
    saveSongs();
    renderSongList();
    renderSongDetail();
    dom.transposeReset.focus();
    announce('Transposed chords set as the new base');

    showUndoToast('Transposed chords saved as new base', () => {
      const savedSong = songs.find(s => s.id === song.id);
      if (!savedSong) return;
      savedSong.content = previous.content;
      savedSong.transposeSteps = previous.transposeSteps;
      savedSong.updatedAt = previous.updatedAt;
      if (selectedSongId === savedSong.id) transposeSteps = previous.transposeSteps;
      saveSongs();
      renderSongList();
      renderSongDetail();
    });
  }

  /**
   * Save the two-column display preference to the current song.
   */
  function saveTwoColumnForSong(enabled) {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    if (song) {
      song.twoColumn = enabled;
      song.updatedAt = Date.now();
      saveSongs();
      renderSongDetail();
      announce(enabled ? 'Two-column view enabled' : 'Single-column view enabled');
    }
  }

  function startInlineEdit() {
    if (INLINE_EDIT_IMPLEMENTATION === 'contenteditable') {
      startContentEditableInlineEdit();
    } else {
      startLegacyInlineEdit();
    }
  }

  function startContentEditableInlineEdit() {
    const song = songs.find(s => s.id === selectedSongId);
    if (!song) return;

    stopAutoScroll();
    closeSongActionsMenu();
    inlineEditingSongId = song.id;
    inlineEditingMode = 'contenteditable';
    inlineEditDraft = song.content || '';
    dom.songContent.textContent = inlineEditDraft;
    renderContentEditableHighlight();
    renderSongDetail();

    requestAnimationFrame(() => {
      dom.songContent.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.selectAllChildren(dom.songContent);
        selection.collapseToStart();
      }
    });
    announce(`Directly editing ${song.title}`);
  }

  function startLegacyInlineEdit() {
    const song = songs.find(s => s.id === selectedSongId);
    if (!song) return;

    stopAutoScroll();
    closeSongActionsMenu();
    positionInlineEditor();
    inlineEditingSongId = song.id;
    inlineEditingMode = 'legacy';
    inlineEditDraft = '';
    dom.inlineSongContent.value = song.content || '';
    renderInlineEditHighlight();
    renderSongDetail();

    requestAnimationFrame(() => {
      dom.inlineSongContent.focus();
      dom.inlineSongContent.setSelectionRange(0, 0);
    });
    announce(`Inline editing ${song.title}`);
  }

  function readContentEditableDraft() {
    return dom.songContent.innerText.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  }

  function updateContentEditableDraft() {
    if (inlineEditingMode !== 'contenteditable') return;
    inlineEditDraft = readContentEditableDraft();
    renderContentEditableHighlight();
  }

  function renderContentEditableHighlight() {
    dom.contentEditableHighlight.innerHTML = highlightChords(inlineEditDraft, true);
    syncContentEditableHighlightScroll();
  }

  function syncContentEditableHighlightScroll() {
    dom.contentEditableHighlight.scrollTop = dom.songContent.scrollTop;
    dom.contentEditableHighlight.scrollLeft = dom.songContent.scrollLeft;
  }

  function insertPlainTextIntoContentEditable(text) {
    if (document.activeElement !== dom.songContent) dom.songContent.focus({ preventScroll: true });
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dom.songContent.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertPairIntoContentEditable(pair) {
    const open = pair.charAt(0);
    const close = pair.charAt(pair.length - 1);
    if (document.activeElement !== dom.songContent) dom.songContent.focus({ preventScroll: true });

    const selection = window.getSelection();
    if (!selection) return;
    if (!selection.rangeCount || !dom.songContent.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      const endRange = document.createRange();
      endRange.selectNodeContents(dom.songContent);
      endRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(endRange);
    }

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    range.deleteContents();
    const textNode = document.createTextNode(open + selectedText + close);
    range.insertNode(textNode);
    range.setStart(textNode, open.length + selectedText.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dom.songContent.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function saveContentEditableInlineEdit() {
    if (!inlineEditingSongId || inlineEditingMode !== 'contenteditable') return;
    const song = songs.find(s => s.id === inlineEditingSongId);
    if (!song) return;

    updateContentEditableDraft();
    if (!inlineEditDraft.trim()) {
      showToast('Lyrics and chords cannot be empty.', 'error');
      dom.songContent.focus();
      return;
    }

    song.content = inlineEditDraft;
    song.updatedAt = Date.now();
    finishInlineEditState();
    saveSongs();
    renderSongList();
    renderSongDetail();
    showToast('Song chords updated', 'success');
    announce('Song chords saved');
    dom.inlineEditButton.focus();
  }

  function cancelContentEditableInlineEdit() {
    if (!requestDiscardInlineEdit()) return;
    renderSongDetail();
    announce('Direct editing cancelled');
    dom.inlineEditButton.focus();
  }

  function saveInlineEdit() {
    if (!inlineEditingSongId) return;
    const song = songs.find(s => s.id === inlineEditingSongId);
    if (!song) return;

    const content = dom.inlineSongContent.value;
    if (!content.trim()) {
      showToast('Lyrics and chords cannot be empty.', 'error');
      dom.inlineSongContent.focus();
      return;
    }

    song.content = content;
    song.updatedAt = Date.now();
    finishInlineEditState();
    saveSongs();
    renderSongList();
    renderSongDetail();
    showToast('Song chords updated', 'success');
    announce('Song chords saved');
    dom.inlineEditButton.focus();
  }

  function requestDiscardInlineEdit() {
    if (!inlineEditingSongId) return true;
    const song = songs.find(s => s.id === inlineEditingSongId);
    if (inlineEditingMode === 'contenteditable') updateContentEditableDraft();
    const draft = inlineEditingMode === 'contenteditable' ? inlineEditDraft : dom.inlineSongContent.value;
    const hasChanges = song && draft !== song.content;
    if (hasChanges && !window.confirm('Discard your unsaved chord changes?')) return false;

    finishInlineEditState();
    return true;
  }

  function finishInlineEditState() {
    inlineEditingSongId = null;
    inlineEditingMode = null;
    inlineEditDraft = '';
    clearInlineEditorPosition();
    if (typeof NativeBridge !== 'undefined') NativeBridge.notifyUiReady?.();
  }

  function positionInlineEditor() {
    const sectionRect = dom.songContentSection.getBoundingClientRect();
    const detailRect = dom.songDetail.getBoundingClientRect();
    const savedTop = parseFloat(dom.songContentSection.style.getPropertyValue('--inline-editor-top'));
    const top = dom.songContentSection.classList.contains('is-editing') && Number.isFinite(savedTop)
      ? savedTop
      : sectionRect.top;

    dom.songContentSection.style.setProperty('--inline-editor-top', Math.max(0, top) + 'px');
    dom.songContentSection.style.setProperty('--inline-editor-left', Math.max(0, detailRect.left) + 'px');
    dom.songContentSection.style.setProperty('--inline-editor-right', Math.max(0, window.innerWidth - detailRect.right) + 'px');
  }

  function clearInlineEditorPosition() {
    document.body.classList.remove('inline-edit-active');
    dom.songContentSection.classList.remove('is-editing');
    dom.songContentSection.classList.remove('is-content-editing');
    dom.songContent.classList.remove('is-content-editing');
    dom.songContent.removeAttribute('contenteditable');
    dom.songContent.removeAttribute('role');
    dom.songContent.removeAttribute('aria-multiline');
    dom.songContent.removeAttribute('aria-label');
    dom.songContent.removeAttribute('spellcheck');
    dom.contentEditableActions.classList.add('hidden');
    dom.contentEditableCharButtons.classList.add('hidden');
    dom.contentEditableHighlight.classList.add('hidden');
    dom.songContentSection.style.removeProperty('--inline-editor-top');
    dom.songContentSection.style.removeProperty('--inline-editor-left');
    dom.songContentSection.style.removeProperty('--inline-editor-right');
  }

  function syncInlineEditHighlightScroll() {
    dom.inlineSongHighlight.scrollTop = dom.inlineSongContent.scrollTop;
    dom.inlineSongHighlight.scrollLeft = dom.inlineSongContent.scrollLeft;
  }

  function renderInlineEditHighlight() {
    // Preserve the user's exact notation in edit mode so the highlighted
    // layer stays character-for-character aligned with the textarea.
    dom.inlineSongHighlight.innerHTML = highlightChords(dom.inlineSongContent.value, true);
    syncInlineEditHighlightScroll();
  }

  function cancelInlineEdit() {
    if (!requestDiscardInlineEdit()) return;
    renderSongDetail();
    announce('Inline editing cancelled');
    dom.inlineEditButton.focus();
  }

  function closeSongActionsMenu() {
    if (!dom.songActionsMenu || !dom.songActionsButton) return;
    dom.songActionsMenu.classList.add('hidden');
    dom.songActionsButton.setAttribute('aria-expanded', 'false');
    dom.songActionsButton.setAttribute('aria-label', 'Open song actions');
  }

  function toggleSongActionsMenu() {
    if (!dom.songActionsMenu || !dom.songActionsButton) return;
    const willOpen = dom.songActionsMenu.classList.contains('hidden');
    dom.songActionsMenu.classList.toggle('hidden', !willOpen);
    dom.songActionsButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    dom.songActionsButton.setAttribute('aria-label', willOpen ? 'Close song actions' : 'Open song actions');
    if (willOpen) {
      const firstAction = dom.songActionsMenu.querySelector('[role="menuitem"]');
      if (firstAction) firstAction.focus();
    }
  }

  function setSongActionsVisible(visible) {
    if (!dom.songActionsButton) return;
    dom.songActionsButton.classList.toggle('hidden', !visible);
    if (!visible) {
      closeSongActionsMenu();
      if (dom.sheetScrollTopButton) dom.sheetScrollTopButton.classList.add('hidden');
    }
  }

  /**
   * Insert a character at the current cursor position in a textarea
   */
  function insertCharAtCursor(textarea, char) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, char)) return;
    textarea.setRangeText(char, start, end, 'end');
    textarea.selectionStart = textarea.selectionEnd = start + char.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertPairAtCursor(textarea, pair) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const open = pair.charAt(0);
    const close = pair.charAt(pair.length - 1);
    if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
    if (!(typeof document.execCommand === 'function' && document.execCommand('insertText', false, open + selectedText + close)))
      textarea.setRangeText(open + selectedText + close, start, end, 'end');
    const caretPosition = start + open.length + selectedText.length;
    textarea.selectionStart = textarea.selectionEnd = caretPosition;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ================================================
  // Event Listeners
  // ================================================

  function initEventListeners() {
    // Home FAB button
    $('btn-home').addEventListener('click', goHome);
    dom.songContentSection.addEventListener('scroll', updateSheetScrollTopButton, { passive: true });
    dom.sheetScrollTopButton.addEventListener('click', scrollSongSheetToTop);

    // Floating song actions menu
    if (dom.songActionsButton && dom.songActionsMenu) {
      dom.songActionsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSongActionsMenu();
      });
      dom.songActionsMenu.addEventListener('click', (e) => e.stopPropagation());
      dom.songActionsMenu.addEventListener('keydown', (e) => {
        const items = Array.from(dom.songActionsMenu.querySelectorAll('[role="menuitem"]'));
        const currentIndex = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const direction = e.key === 'ArrowDown' ? 1 : -1;
          const nextIndex = (currentIndex + direction + items.length) % items.length;
          items[nextIndex].focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeSongActionsMenu();
          dom.songActionsButton.focus();
        }
      });
      document.addEventListener('click', closeSongActionsMenu);
    }

    // Menu toggle
    dom.menuToggle.addEventListener('click', toggleSidebar);

    // Tab switching
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setSidebarTab(btn.dataset.tab);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const nextTab = btn.dataset.tab === 'songs' ? 'setlists' : 'songs';
        setSidebarTab(nextTab);
        document.querySelector(`.tab-btn[data-tab="${nextTab}"]`).focus();
      });
    });

    // Search (debounced)
    let searchTimer = null;
    dom.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderSongList, 150);
    });
    dom.setlistSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderSetlistList, 150);
    });

    // Sort selects
    if (dom.songsSort) {
      dom.songsSort.addEventListener('change', renderSongList);
    }
    if (dom.setlistsSort) {
      dom.setlistsSort.addEventListener('change', renderSetlistList);
    }

    // Song list click
    dom.songList.addEventListener('click', (e) => {
      const item = e.target.closest('.song-item');
      if (item) {
        selectSong(item.dataset.id);
      }
    });

    // Setlist list click
    dom.setlistList.addEventListener('click', (e) => {
      const item = e.target.closest('.setlist-item');
      if (item) {
        selectSetlist(item.dataset.id);
      }
    });

    // Setlist songs click
    dom.setlistSongs.addEventListener('click', (e) => {
      // Handle remove button
      const removeBtn = e.target.closest('.btn-remove-song');
      if (removeBtn) {
        e.stopPropagation();
        removeSongFromSetlist(removeBtn.dataset.id);
        return;
      }

      // Ignore clicks on drag handle
      if (e.target.closest('.drag-handle')) return;

      // Handle song click
      const item = e.target.closest('.setlist-song-item');
      if (item) {
        const songId = item.dataset.id;
        const index = parseInt(item.dataset.index, 10);
        selectSong(songId, true, index);
      }
    });

    // Font size selector with persistence
    dom.fontSizeSelect.addEventListener('change', (e) => {
      currentFontSize = clampFontSize(e.target.value);
      e.target.value = currentFontSize.toString();
      LibraryStorage.setItem(STORAGE_KEYS.FONT_SIZE, currentFontSize.toString());
      if (selectedSongId) {
        renderSongDetail();
      }
    });

    // Per-song two-column display preference
    if (dom.twoColumnToggle) {
      dom.twoColumnToggle.addEventListener('change', (e) => {
        saveTwoColumnForSong(e.target.checked);
      });
    }

    // Transpose buttons with persistent saving
    dom.transposeUp.addEventListener('click', () => {
      if (transposeSteps < 11) {
        transposeSteps++;
        saveTransposeForSong();
        renderSongDetail();
      }
    });

    dom.transposeDown.addEventListener('click', () => {
      if (transposeSteps > -11) {
        transposeSteps--;
        saveTransposeForSong();
        renderSongDetail();
      }
    });

    dom.transposeReset.addEventListener('click', () => {
      transposeSteps = 0;
      saveTransposeForSong();
      renderSongDetail();
    });

    dom.transposeAccept.addEventListener('click', acceptTranspositionAsBase);

    // Add song button
    $('btn-add-song').addEventListener('click', () => openSongModal());
    $('btn-add-song-sidebar').addEventListener('click', () => {
      closeSidebar();
      openSongModal();
    });

    // Edit lyrics and chords directly in the song viewer.
    dom.inlineEditButton.addEventListener('click', startInlineEdit);
    $('btn-save-content-edit').addEventListener('click', saveContentEditableInlineEdit);
    $('btn-cancel-content-edit').addEventListener('click', cancelContentEditableInlineEdit);
    dom.songContent.addEventListener('input', updateContentEditableDraft);
    dom.songContent.addEventListener('scroll', syncContentEditableHighlightScroll);
    dom.songContent.addEventListener('keydown', (e) => {
      if (inlineEditingMode !== 'contenteditable') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveContentEditableInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelContentEditableInlineEdit();
      }
    });
    dom.songContent.addEventListener('beforeinput', (e) => {
      if (inlineEditingMode !== 'contenteditable') return;
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();
        insertPlainTextIntoContentEditable('\n');
      }
    });
    dom.songContent.addEventListener('paste', (e) => {
      if (inlineEditingMode !== 'contenteditable') return;
      e.preventDefault();
      insertPlainTextIntoContentEditable(e.clipboardData.getData('text/plain'));
    });
    $('btn-save-inline-edit').addEventListener('click', saveInlineEdit);
    $('btn-cancel-inline-edit').addEventListener('click', cancelInlineEdit);
    dom.inlineSongContent.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelInlineEdit();
      }
    });
    dom.inlineSongContent.addEventListener('input', renderInlineEditHighlight);
    dom.inlineSongContent.addEventListener('scroll', syncInlineEditHighlightScroll);
    window.addEventListener('resize', () => {
      if (inlineEditingMode === 'legacy') positionInlineEditor();
      syncSidebarLayout();
    });

    // Back to setlist button
    $('btn-back-setlist').addEventListener('click', () => {
      returnToSetlist();
    });

    // Export song button
    $('btn-export-song').addEventListener('click', () => {
      closeSongActionsMenu();
      if (selectedSongId) exportSingleSong(selectedSongId);
    });

    // Auto-scroll: click to toggle, long-press to cycle speed
    let autoScrollLongPress = null;
    $('btn-autoscroll').addEventListener('pointerdown', () => {
      autoScrollLongPress = setTimeout(() => {
        autoScrollLongPress = null;
        cycleAutoScrollSpeed();
      }, 500);
    });
    $('btn-autoscroll').addEventListener('pointerup', () => {
      if (autoScrollLongPress) {
        clearTimeout(autoScrollLongPress);
        autoScrollLongPress = null;
        toggleAutoScroll();
      }
    });
    $('btn-autoscroll').addEventListener('pointerleave', () => {
      if (autoScrollLongPress) {
        clearTimeout(autoScrollLongPress);
        autoScrollLongPress = null;
      }
    });

    // Share song via QR button
    $('btn-share-song').addEventListener('click', () => {
      closeSongActionsMenu();
      if (selectedSongId) shareSongViaQr(selectedSongId);
    });

    // Edit song button
    $('btn-edit-song').addEventListener('click', () => {
      closeSongActionsMenu();
      if (selectedSongId) openSongModal(selectedSongId);
    });

    // Delete song button
    $('btn-delete-song').addEventListener('click', () => {
      closeSongActionsMenu();
      if (selectedSongId) deleteSong(selectedSongId);
    });

    // Song form
    dom.songForm.addEventListener('submit', saveSong);
    dom.songTitleInput.addEventListener('input', (e) => {
      const cursorStart = e.target.selectionStart;
      const cursorEnd = e.target.selectionEnd;
      e.target.value = e.target.value.toUpperCase();
      if (cursorStart !== null && cursorEnd !== null) {
        e.target.setSelectionRange(cursorStart, cursorEnd);
      }
    });
    $('btn-cancel-song').addEventListener('click', closeSongModal);
    $('btn-close-song-modal').addEventListener('click', closeSongModal);
    // Note: Backdrop click intentionally not added to prevent accidental closure

    // Import single song in song modal
    const btnImportSong = $('btn-import-song');
    const importSongFile = $('import-song-file');
    const btnScanQr = $('btn-scan-qr');
    const btnStopScanQr = $('btn-stop-scan-qr');
    const btnScanQrImage = $('btn-scan-qr-image');
    const scanQrImageFile = $('scan-qr-image-file');
    if (btnImportSong && importSongFile) {
      btnImportSong.addEventListener('click', async () => {
        if (!NativeBridge.isNative) {
          importSongFile.click();
          return;
        }
        try {
          const json = await NativeBridge.pickSongFile();
          if (!json) return;
          const imported = extractSongFromParsedData(JSON.parse(json));
          if (!imported) throw new Error('The file does not contain a compatible song.');
          populateSongForm(imported);
          showToast('Song loaded into form — review and save', 'success');
        } catch (error) {
          showToast('Import failed: ' + error.message, 'error');
        }
      });
      importSongFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          importSingleSong(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
    if (btnScanQr) {
      if (NativeBridge.isNative) {
        btnScanQr.title = 'Scan a song QR code or choose a QR image';
        btnScanQr.setAttribute('aria-label', 'Scan a song QR code or choose a QR image');
      }
      btnScanQr.addEventListener('click', startQrScan);
    }
    if (btnStopScanQr) {
      btnStopScanQr.addEventListener('click', closeScannerOverlay);
    }
    const btnCloseScanner = $('btn-close-scanner');
    if (btnCloseScanner) {
      btnCloseScanner.addEventListener('click', closeScannerOverlay);
    }
    if (btnScanQrImage && scanQrImageFile) {
      btnScanQrImage.addEventListener('click', async () => {
        if (!NativeBridge.isNative) {
          scanQrImageFile.click();
          return;
        }
        try {
          const payload = await NativeBridge.pickQrImage();
          if (payload) handleScannedSongQr(payload);
        } catch (error) {
          showToast('Unable to read QR image: ' + error.message, 'error');
        }
      });
      scanQrImageFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          scanQrFromImageFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Share QR modal
    const btnCloseShareQr = $('btn-close-share-qr');
    if (btnCloseShareQr) {
      btnCloseShareQr.addEventListener('click', closeShareQrModal);
    }
    const btnCloseShareQrX = $('btn-close-share-qr-x');
    if (btnCloseShareQrX) {
      btnCloseShareQrX.addEventListener('click', closeShareQrModal);
    }
    if (dom.shareQrModal) {
      const shareBackdrop = dom.shareQrModal.querySelector('.modal-backdrop');
      if (shareBackdrop) {
        shareBackdrop.addEventListener('click', closeShareQrModal);
      }
    }

    // Character insert buttons
    // Touching these controls must not blur/reopen the IME and reset Caps Lock or its selection.
    $$('.char-btn').forEach(btn => {
      btn.addEventListener('pointerdown', event => {
        const editor = btn.closest('#song-modal') ? dom.songContentInput
          : btn.hasAttribute('data-legacy-inline-char') || btn.hasAttribute('data-legacy-inline-pair') ? dom.inlineSongContent : dom.songContent;
        if (event.isPrimary && document.activeElement === editor) event.preventDefault();
      });
    });
    $$('#song-modal .char-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.pair) {
          insertPairAtCursor(dom.songContentInput, btn.dataset.pair);
        } else {
          insertCharAtCursor(dom.songContentInput, btn.dataset.char);
        }
      });
    });

    $$('[data-inline-char], [data-inline-pair]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (inlineEditingMode !== 'contenteditable') return;
        if (btn.dataset.inlinePair) {
          insertPairIntoContentEditable(btn.dataset.inlinePair);
        } else {
          insertPlainTextIntoContentEditable(btn.dataset.inlineChar);
        }
      });
    });

    $$('[data-legacy-inline-char], [data-legacy-inline-pair]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (inlineEditingMode !== 'legacy') return;
        if (btn.dataset.legacyInlinePair) {
          insertPairAtCursor(dom.inlineSongContent, btn.dataset.legacyInlinePair);
        } else {
          insertCharAtCursor(dom.inlineSongContent, btn.dataset.legacyInlineChar);
        }
      });
    });

    // Add setlist button
    $('btn-add-setlist').addEventListener('click', () => {
      closeSidebar();
      openSetlistModal();
    });

    // Edit setlist button
    $('btn-edit-setlist').addEventListener('click', () => {
      if (selectedSetlistId) openSetlistModal(selectedSetlistId);
    });

    // Delete setlist button
    $('btn-delete-setlist').addEventListener('click', () => {
      if (selectedSetlistId) deleteSetlist(selectedSetlistId);
    });

    // Setlist form
    dom.setlistForm.addEventListener('submit', saveSetlist);
    $('btn-cancel-setlist').addEventListener('click', closeSetlistModal);
    $('btn-close-setlist').addEventListener('click', closeSetlistModal);
    dom.setlistModal.querySelector('.modal-backdrop').addEventListener('click', closeSetlistModal);

    // Add songs to setlist
    $('btn-add-songs-to-setlist').addEventListener('click', openAddSongsModal);
    $('btn-cancel-add-songs').addEventListener('click', closeAddSongsModal);
    $('btn-confirm-add-songs').addEventListener('click', confirmAddSongs);
    dom.addSongsModal.querySelector('.modal-backdrop').addEventListener('click', closeAddSongsModal);

    // Confirm modal
    $('btn-cancel-confirm').addEventListener('click', closeConfirmModal);
    $('btn-confirm-delete').addEventListener('click', executeConfirm);
    dom.confirmModal.querySelector('.modal-backdrop').addEventListener('click', closeConfirmModal);

    // Touch events for swipe navigation
    dom.content.addEventListener('touchstart', handleTouchStart, { passive: true });
    dom.content.addEventListener('touchmove', handleTouchMove, { passive: true });
    dom.content.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      // Close modals on Escape (except song modal to prevent accidental loss of input)
      if (e.key === 'Escape') {
        closeSongActionsMenu();
        // Song modal is excluded - only Cancel and Save buttons close it
        if (!dom.setlistModal.classList.contains('hidden')) closeSetlistModal();
        if (!dom.addSongsModal.classList.contains('hidden')) closeAddSongsModal();
        if (!dom.confirmModal.classList.contains('hidden')) closeConfirmModal();
        if (dom.shareQrModal && !dom.shareQrModal.classList.contains('hidden')) closeShareQrModal();
        if (dom.scanQrOverlay && !dom.scanQrOverlay.classList.contains('hidden')) closeScannerOverlay();
        if (!$('preferences-modal').classList.contains('hidden')) closePreferencesModal();
      }

      // Arrow key navigation for setlist songs
      if (!e.defaultPrevented && viewingSetlistSongIndex >= 0 && !e.target.matches('input, textarea') && !e.target.isContentEditable) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateToPreviousSong();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateToNextSong();
        }
      }
    });

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', toggleTheme);
    }

    // Preferences
    $('btn-preferences').addEventListener('click', openPreferencesModal);
    $('btn-close-preferences').addEventListener('click', closePreferencesModal);
    $('btn-close-preferences-x').addEventListener('click', closePreferencesModal);
    $('preferences-modal').querySelector('.modal-backdrop').addEventListener('click', closePreferencesModal);
    $('pref-theme-dark').addEventListener('click', () => setTheme('dark'));
    $('pref-theme-light').addEventListener('click', () => setTheme('light'));
    $('pref-notation-original').addEventListener('click', () => setNotationPref('original'));
    $('pref-notation-sharp').addEventListener('click', () => setNotationPref('sharp'));
    $('pref-notation-flat').addEventListener('click', () => setNotationPref('flat'));

    // Export data
    const btnExport = document.getElementById('btn-export-data');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.remove('visible');
        exportData();
      });
    }

    // Import data
    const btnImport = document.getElementById('btn-import-data');
    const importFileInput = document.getElementById('import-file-input');
    if (btnImport && importFileInput) {
      btnImport.addEventListener('click', () => {
        document.getElementById('user-dropdown').classList.remove('visible');
        importFileInput.click();
      });
      importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          importData(e.target.files[0]);
          e.target.value = ''; // Reset so same file can be imported again
        }
      });
    }

    // SW update banner
    const btnUpdateRefresh = document.getElementById('btn-update-refresh');
    const btnUpdateDismiss = document.getElementById('btn-update-dismiss');
    if (btnUpdateRefresh) {
      btnUpdateRefresh.addEventListener('click', () => location.reload());
    }
    if (btnUpdateDismiss) {
      btnUpdateDismiss.addEventListener('click', () => {
        document.getElementById('update-banner').classList.add('hidden');
      });
    }

    // Save sidebar scroll position on scroll
    dom.songList.addEventListener('scroll', () => {
      saveSidebarScroll();
    }, { passive: true });
  }

  // ================================================
  // Feature Tour
  // ================================================

  function compareTourVersions(a, b) {
    const aParts = String(a || '0').split('.').map(Number);
    const bParts = String(b || '0').split('.').map(Number);
    const length = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < length; i++) {
      const difference = (aParts[i] || 0) - (bParts[i] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function getSeenTourFeatures() {
    try {
      const saved = JSON.parse(LibraryStorage.getItem(STORAGE_KEYS.TOUR_FEATURES_SEEN) || '[]');
      const seenFeatures = new Set(Array.isArray(saved) ? saved : []);
      if (seenFeatures.delete('playlist-reorder')) {
        seenFeatures.add('setlist-reorder');
        saveSeenTourFeatures(seenFeatures);
      }
      return seenFeatures;
    } catch (e) {
      return new Set();
    }
  }

  function saveSeenTourFeatures(seenFeatures) {
    LibraryStorage.setItem(
      STORAGE_KEYS.TOUR_FEATURES_SEEN,
      JSON.stringify(Array.from(seenFeatures).sort())
    );
  }

  function migrateLegacyTourProgress(slides, seenFeatures) {
    const legacyVersion = LibraryStorage.getItem(STORAGE_KEYS.TOUR_SEEN);
    if (!legacyVersion) return;

    let changed = false;
    slides.forEach(slide => {
      const featureId = slide.dataset.feature;
      const introducedVersion = slide.dataset.introduced || TOUR_VERSION;
      if (featureId && compareTourVersions(introducedVersion, legacyVersion) <= 0 && !seenFeatures.has(featureId)) {
        seenFeatures.add(featureId);
        changed = true;
      }
    });
    if (changed) saveSeenTourFeatures(seenFeatures);
  }

  function showTourIfNeeded() {
    const overlay = $('tour-overlay');
    if (!overlay) return;

    const allSlides = Array.from(document.querySelectorAll('.tour-slide'));
    const seenFeatures = getSeenTourFeatures();
    migrateLegacyTourProgress(allSlides, seenFeatures);

    const unseenSlides = allSlides.filter(slide => {
      const featureId = slide.dataset.feature;
      return featureId && !seenFeatures.has(featureId);
    });
    if (unseenSlides.length === 0) return;

    overlay.classList.remove('hidden');
    initTour(unseenSlides, seenFeatures);
  }

  function initTour(slides, seenFeatures) {
    const dotsContainer = $('tour-dots');
    const btnNext = $('tour-next');
    const btnSkip = $('tour-skip');
    let current = 0;

    dotsContainer.innerHTML = slides.map((_, i) =>
      '<span class="tour-dot ' + (i === 0 ? 'active' : '') + '"></span>'
    ).join('');

    function goTo(index) {
      document.querySelectorAll('.tour-slide').forEach(s => s.classList.remove('active'));
      slides[index].classList.add('active');
      dotsContainer.querySelectorAll('.tour-dot').forEach((d, i) => {
        d.classList.toggle('active', i === index);
      });
      current = index;
      btnNext.textContent = current === slides.length - 1 ? 'Done' : 'Next';

      const featureId = slides[index].dataset.feature;
      if (featureId && !seenFeatures.has(featureId)) {
        seenFeatures.add(featureId);
        saveSeenTourFeatures(seenFeatures);
      }
    }

    btnNext.onclick = () => {
      if (current < slides.length - 1) {
        goTo(current + 1);
      } else {
        dismissTour();
      }
    };

    btnSkip.onclick = () => {
      slides.forEach(slide => {
        if (slide.dataset.feature) seenFeatures.add(slide.dataset.feature);
      });
      saveSeenTourFeatures(seenFeatures);
      dismissTour();
    };

    goTo(0);
  }

  function dismissTour() {
    LibraryStorage.setItem(STORAGE_KEYS.TOUR_SEEN, TOUR_VERSION);
    $('tour-overlay').classList.add('hidden');
    NativeBridge.notifyUiReady?.();
  }

  // ================================================
  // Initialization
  // ================================================

  function refreshNativeSettings() {
    loadTheme();
    loadNotationPref();
    currentFontSize = clampFontSize(LibraryStorage.getItem(STORAGE_KEYS.FONT_SIZE));
    dom.fontSizeSelect.value = currentFontSize.toString();
    desktopSidebarCollapsed = LibraryStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true';
    persistentSidebarLayout = null;
    syncSidebarLayout();
    updatePreferencesUI();
  }

  function canSwitchNativeAccount() {
    if (!requestDiscardInlineEdit()) return false;
    const hasSongForm = !dom.songModal.classList.contains('hidden') &&
      (dom.songTitleInput.value || dom.songArtistInput.value || dom.songContentInput.value);
    const hasSetlistForm = !dom.setlistModal.classList.contains('hidden') &&
      (dom.setlistNameInput.value || dom.setlistDescriptionInput.value);
    if ((hasSongForm || hasSetlistForm) &&
      !window.confirm('Discard the open form before changing accounts?')) {
      if (selectedSongId) renderSongDetail();
      return false;
    }
    if (selectedSongId) renderSongDetail();
    return true;
  }

  function applyNativeSnapshot(data) {
    const songChanges = LibraryView.changes(songs, data.songs);
    const setlistChanges = LibraryView.changes(setlists, data.setlists);
    const previousSongId = selectedSongId;
    const previousSetlistId = selectedSetlistId;
    if (!data.reset && !data.settingsChanged && !songChanges.changed && !setlistChanges.changed) return;

    LibraryView.preserveView(() => {
      songs = data.songs;
      setlists = data.setlists;
      const selectedSong = songs.find(song => song.id === selectedSongId);
      const selectedSetlist = setlists.find(setlist => setlist.id === selectedSetlistId);
      const songRemoved = !!selectedSongId && !selectedSong;
      const setlistRemoved = !!selectedSetlistId && !selectedSetlist;
      if (songRemoved) {
        selectedSongId = null;
        finishInlineEditState();
        stopAutoScroll();
        setSongActionsVisible(false);
        $('btn-autoscroll').classList.add('hidden');
        if (!selectedSetlist) $('btn-home').classList.add('hidden');
      }
      if (setlistRemoved) selectedSetlistId = null;
      if (viewingSetlistSongIndex >= 0) {
        const visibleIds = selectedSetlist?.songIds.filter(id => songs.some(song => song.id === id)) || [];
        // Preserve the occurrence when a setlist contains a song more than once.
        if (visibleIds[viewingSetlistSongIndex] !== selectedSongId) viewingSetlistSongIndex = visibleIds.indexOf(selectedSongId);
        if (viewingSetlistSongIndex < 0) viewingFromSetlistId = null;
      }
      if (songChanges.changed || songRemoved || data.reset) renderSongList();
      if (setlistChanges.changed || songRemoved || setlistRemoved || data.reset) renderSetlistList();

      if (selectedSongId) {
        // An unrelated library change must never rebuild the open chord sheet.
        if (songChanges.ids.has(selectedSongId) || setlistRemoved || data.settingsChanged || data.reset) {
          transposeSteps = typeof selectedSong.transposeSteps === 'number' ? selectedSong.transposeSteps : 0;
          renderSongDetail();
        } else if (setlistChanges.ids.has(selectedSetlistId) || songChanges.changed) {
          updateSongNavigation();
        }
      } else if (selectedSetlistId) {
        const affectedMember = selectedSetlist.songIds.some(id => songChanges.ids.has(id));
        if (setlistChanges.ids.has(selectedSetlistId) || affectedMember || songRemoved || data.reset) renderSetlistDetail();
      } else if (previousSongId || previousSetlistId || data.reset) {
        renderSongDetail();
      } else if (songChanges.changed || setlistChanges.changed) {
        renderHomeDashboard();
      }
    });
    const count = songChanges.ids.size + setlistChanges.ids.size;
    if (count && !data.reset) LibraryView.announceSync(count);
  }

  function canRefreshNativeSnapshot() {
    if (inlineEditingSongId || undoCleanup || dom.setlistSongs?._syncInteraction) return false;
    const dialogs = [dom.songModal, dom.setlistModal, dom.addSongsModal, dom.confirmModal,
      dom.shareQrModal, dom.scanQrOverlay, $('preferences-modal'), $('tour-overlay')];
    return !dialogs.some(dialog => dialog && !dialog.classList.contains('hidden'));
  }

  function resetNativeAccount() {
    dom.setlistSongs?._sorter?.cancel();
    navigationHistory = [];
    stopAutoScroll();
    finishInlineEditState();
    selectedSongId = null;
    selectedSetlistId = null;
    viewingSetlistSongIndex = -1;
    viewingFromSetlistId = null;
    editingSongId = null;
    editingSetlistId = null;
    transposeSteps = 0;
    closeSongModal();
    closeSetlistModal();
    closeAddSongsModal();
    closeConfirmModal();
    closeShareQrModal();
    closePreferencesModal();
    closeSongActionsMenu();
    closeSidebar();
    if (undoCleanup) undoCleanup();
    clearTimeout(undoTimer);
    undoTimer = null;
    undoData = null;
    $('undo-toast')?.classList.add('hidden');
    dom.searchInput.value = '';
    dom.setlistSearchInput.value = '';
    if (dom.songContent) dom.songContent.textContent = '';
    if (dom.contentEditableHighlight) dom.contentEditableHighlight.textContent = '';
    if (dom.inlineSongContent) dom.inlineSongContent.value = '';
    if (dom.inlineSongHighlight) dom.inlineSongHighlight.textContent = '';
    if (dom.songSelector) dom.songSelector.textContent = '';
    if (dom.setlistSongs) dom.setlistSongs.textContent = '';
    $('btn-home').classList.add('hidden');
    $('btn-autoscroll').classList.add('hidden');
    $('btn-sheet-scroll-top').classList.add('hidden');
    document.body.classList.remove('inline-edit-active');
    setSongActionsVisible(false);
  }

  function init() {
    NativeBridge.registerAppLifecycle({
      handleBack: handleAppBack,
      canSwitchAccount: canSwitchNativeAccount,
      canRefresh: canRefreshNativeSnapshot,
      resetForAccount: resetNativeAccount,
      refreshSettings: refreshNativeSettings
    });
    window.addEventListener('library-native-message', event => {
      showToast(event.detail.message, event.detail.type);
    });
    loadData();
    loadTheme();
    loadNotationPref();
    desktopSidebarCollapsed = LibraryStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true';
    syncSidebarLayout();
    createSwipeIndicators();
    renderSongList();
    renderSetlistList();
    initEventListeners();

    // Load persisted font size
    const savedFontSize = LibraryStorage.getItem(STORAGE_KEYS.FONT_SIZE);
    if (savedFontSize) {
      currentFontSize = clampFontSize(savedFontSize);
      LibraryStorage.setItem(STORAGE_KEYS.FONT_SIZE, currentFontSize.toString());
      if (dom.fontSizeSelect) {
        dom.fontSizeSelect.value = currentFontSize.toString();
      }
    } else if (dom.fontSizeSelect) {
      currentFontSize = clampFontSize(dom.fontSizeSelect.value);
    }

    // Restore sidebar scroll position
    restoreSidebarScroll();

    // Show empty state initially
    dom.emptyState.classList.remove('hidden');
    dom.songDetail.classList.add('hidden');
    dom.setlistDetail.classList.add('hidden');
    renderHomeDashboard();

    // Initialize native Supabase synchronization
    if (typeof SyncService !== 'undefined') {
      SyncService.init();
      SyncService.initDropdown();
      SyncService.onRemoteUpdate((type, data) => {
        if (type === 'snapshot') applyNativeSnapshot(data);
      });
    }

    showTourIfNeeded();
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
