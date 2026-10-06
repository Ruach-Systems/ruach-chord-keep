/* Native storage/authentication boundary for the original Chord Library UI.
 * Secrets and refresh tokens stay in .NET secure storage, never in this dictionary.
 */
(function () {
  'use strict';

  let dotNet = null;
  let values = Object.create(null);
  let revision = 0;
  let savedRevision = 0;
  let saving = null;
  let retryTimer = null;
  let retryAttempt = 0;
  let storageError = null;
  let remoteCallback = null;
  let account = { signedIn: false, status: 'offline', email: '', displayName: '' };
  let dropdownInitialized = false;
  let nativePlatform = false;
  let qrImportSupported = false;
  let avatarSource = '';
  let appLifecycle = null;
  let refreshing = null;
  let refreshPending = false;
  let refreshNotification = false;

  function requireBridge() {
    if (!dotNet) throw new Error('Native storage is not ready. Please reopen the app.');
    return dotNet;
  }

  function showToast(message, type = 'info') {
    window.dispatchEvent(new CustomEvent('library-native-message', {
      detail: { message: String(message), type }
    }));
  }

  function reportError(error) {
    const message = error && error.message ? error.message : String(error);
    showToast(message, 'error');
  }

  function snapshot() {
    return Object.assign({}, values);
  }

  function updateAccountUI() {
    const byId = id => document.getElementById(id);
    const name = byId('user-dropdown-name');
    const email = byId('user-dropdown-email');
    const signIn = byId('btn-sign-in');
    const signOut = byId('btn-sign-out');
    const button = byId('user-btn');
    const indicator = byId('sync-indicator');
    const avatar = byId('user-avatar');
    const icon = byId('user-icon');
    const refreshButton = byId('btn-refresh-library');
    if (refreshButton) {
      const active = !!refreshing || account.status === 'syncing';
      refreshButton.disabled = active;
      refreshButton.setAttribute('aria-busy', String(active));
      refreshButton.title = active ? 'Refreshing library…' : 'Refresh library';
    }
    let nextAvatar = '';
    if (account.signedIn && account.avatarUrl) {
      try {
        const url = new URL(account.avatarUrl);
        if (url.protocol === 'https:' && !url.username && !url.password &&
          (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')))
          nextAvatar = url.href;
      } catch { /* Missing or malformed profile photos use the default icon. */ }
    }
    if (avatar && icon && nextAvatar !== avatarSource) {
      avatarSource = nextAvatar;
      avatar.onload = avatar.onerror = null;
      avatar.classList.add('hidden');
      icon.classList.remove('hidden');
      if (nextAvatar) {
        avatar.onload = () => {
          avatar.classList.remove('hidden');
          icon.classList.add('hidden');
        };
        avatar.onerror = () => {
          avatar.classList.add('hidden');
          icon.classList.remove('hidden');
        };
        avatar.src = nextAvatar;
      } else avatar.removeAttribute('src');
    }
    if (name) name.textContent = account.signedIn ? (account.displayName || 'Your account') : 'Local library';
    if (email) email.textContent = account.email || '';
    if (signIn) {
      signIn.textContent = 'Account & sync';
      signIn.classList.remove('hidden');
    }
    // Sign-out is handled by the account dialog so its impact is clear.
    if (signOut) signOut.classList.add('hidden');
    if (button) button.title = account.signedIn ? (account.email || 'Account & sync') : 'Account & sync';
    if (indicator) {
      const status = storageError ? 'error' : revision > savedRevision ? 'syncing' : (account.status || 'offline');
      indicator.className = 'sync-indicator-mini ' + status;
      const labels = {
        idle: 'Up to date', synced: 'Up to date', syncing: 'Syncing…',
        error: account.message || 'Sync unavailable. Changes remain saved on this device.',
        'sync-error': account.message || 'Sync unavailable. Changes remain saved on this device.',
        offline: account.signedIn ? 'Offline. Changes remain saved on this device.' : 'Saved on this device'
      };
      indicator.title = storageError || (revision > savedRevision ? 'Saving to this device…' : labels[status] || 'Saved on this device');
      if (button) button.setAttribute('aria-label', 'Account & sync. ' + indicator.title);
    }
  }

  function scheduleRetry() {
    if (retryTimer || !dotNet || revision === savedRevision) return;
    const delay = Math.min(30000, 2000 * Math.pow(2, retryAttempt++));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush().catch(() => { /* flush reports and schedules the next retry */ });
    }, delay);
  }

  function changed() {
    revision++;
    updateAccountUI();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    // Coalesce all synchronous song/setlist changes into one durable snapshot.
    queueMicrotask(() => flush().catch(() => { /* errors remain visible and retryable */ }));
  }

  async function flush() {
    requireBridge();
    if (saving) return saving;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    saving = (async () => {
      while (savedRevision < revision) {
        const targetRevision = revision;
        const target = snapshot();
        await dotNet.invokeMethodAsync('SaveStorage', target);
        savedRevision = targetRevision;
        retryAttempt = 0;
        storageError = null;
      }
    })();
    try {
      await saving;
    } catch (error) {
      storageError = 'This device could not save your latest changes. Retrying…';
      showToast(storageError + ' ' + (error.message || String(error)), 'error');
      scheduleRetry();
      throw error;
    } finally {
      saving = null;
      updateAccountUI();
      notifyUiReady();
    }
  }

  function notifyUiReady() {
    if (!refreshPending || refreshNotification || !dotNet) return;
    refreshNotification = true;
    queueMicrotask(async () => {
      try {
        if (refreshPending && window.NativeBridge.canRefresh())
          await dotNet.invokeMethodAsync('ApplyPendingRefresh');
      } catch (error) { reportError(error); }
      finally { refreshNotification = false; }
    });
  }

  async function refreshLibrary() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await flush();
      await requireBridge().invokeMethodAsync('RefreshLibrary');
    })();
    updateAccountUI();
    try { await refreshing; }
    finally { refreshing = null; updateAccountUI(); }
  }

  const storage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      const text = String(value);
      if (values[key] === text) return;
      values[key] = text;
      changed();
    },
    removeItem(key) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return;
      delete values[key];
      changed();
    },
    key(index) { return Object.keys(values)[index] || null; },
    get length() { return Object.keys(values).length; }
  };

  function replaceSnapshot(next, reset = false) {
    // The .NET caller must flush before applying an import/account/sync snapshot.
    if (savedRevision !== revision) {
      throw new Error('The library is still saving. Retry the refresh after NativeBridge.flush().');
    }
    const replacement = Object.assign(Object.create(null), next || {});
    const nextSongs = JSON.parse(replacement['chord-library-songs'] || '[]');
    const nextSetlists = JSON.parse(replacement['chord-library-setlists'] ||
      replacement['chord-library-playlists'] || '[]');
    if (!Array.isArray(nextSongs) || !Array.isArray(nextSetlists)) {
      throw new Error('The native library snapshot must contain song and setlist arrays.');
    }
    // Account changes must call canSwitchAccount before authentication changes.
    // Reset the editor before exposing another account's stored data to the UI.
    if (reset) appLifecycle?.resetForAccount();
    const settingsChanged = ['chord-library-theme', 'chord-library-notation',
      'chord-library-font-size', 'chord-library-sidebar-collapsed'].some(key => values[key] !== replacement[key]);
    values = replacement;
    if (reset || settingsChanged) appLifecycle?.refreshSettings();
    if (remoteCallback) remoteCallback('snapshot', { songs: nextSongs, setlists: nextSetlists, reset, settingsChanged });
    updateAccountUI();
  }

  async function openAccount() {
    document.getElementById('user-dropdown')?.classList.remove('visible');
    await flush();
    await requireBridge().invokeMethodAsync('OpenAccount');
  }

  function initDropdown() {
    if (dropdownInitialized) return;
    dropdownInitialized = true;
    const dropdown = document.getElementById('user-dropdown');
    document.getElementById('user-btn')?.addEventListener('click', event => {
      event.stopPropagation();
      dropdown?.classList.toggle('visible');
    });
    dropdown?.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => dropdown?.classList.remove('visible'));
    document.getElementById('btn-sign-in')?.addEventListener('click', () => openAccount().catch(reportError));
    document.getElementById('btn-sign-out')?.addEventListener('click', () => openAccount().catch(reportError));
    document.getElementById('btn-refresh-library')?.addEventListener('click', () => refreshLibrary().catch(reportError));
    document.getElementById('btn-import-data')?.addEventListener('click', event => {
      if (!nativePlatform) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dropdown?.classList.remove('visible');
      flush().then(() => requireBridge().invokeMethodAsync('PickImport')).catch(reportError);
    }, true);
    updateAccountUI();
  }

  window.LibraryStorage = storage;
  window.NativeBridge = {
    configure(options) {
      nativePlatform = options?.native === true;
      qrImportSupported = nativePlatform && options?.qrImport === true;
      document.getElementById('btn-scan-qr')?.classList.toggle('hidden', !qrImportSupported);
    },
    get isNative() { return nativePlatform; },
    get supportsQrImport() { return qrImportSupported; },
    async initialize(reference, initialSnapshot) {
      dotNet = reference;
      values = Object.assign(Object.create(null), initialSnapshot ||
        await requireBridge().invokeMethodAsync('Initialize'));
      revision = savedRevision = 0;
      refreshPending = false;
      updateAccountUI();
    },
    replaceSnapshot,
    registerAppLifecycle(callbacks) { appLifecycle = callbacks; },
    handleBack() { return appLifecycle?.handleBack ? appLifecycle.handleBack() : true; },
    canSwitchAccount() { return appLifecycle ? appLifecycle.canSwitchAccount() : true; },
    canRefresh() {
      return revision === savedRevision && !saving &&
        (!appLifecycle?.canRefresh || appLifecycle.canRefresh());
    },
    setRefreshPending(pending) { refreshPending = !!pending; if (refreshPending) notifyUiReady(); },
    notifyUiReady,
    refreshLibrary,
    setAccount(next) {
      account = Object.assign({ signedIn: false, status: 'offline', email: '', displayName: '' }, next || {});
      updateAccountUI();
    },
    showToast,
    flush,
    openAccount,
    async exportFile(filename, json) {
      await flush();
      await requireBridge().invokeMethodAsync('ExportFile', filename, json);
    },
    async previewImport(json) {
      await flush();
      return await requireBridge().invokeMethodAsync('PreviewImport', json);
    },
    async pickSongFile() {
      return await requireBridge().invokeMethodAsync('PickSongFile');
    },
    async scanQr() {
      if (!qrImportSupported) return null;
      return await requireBridge().invokeMethodAsync('ScanQr');
    },
    async pickQrImage() {
      if (!qrImportSupported) return null;
      return await requireBridge().invokeMethodAsync('PickQrImage');
    }
  };

  window.SyncService = {
    init: updateAccountUI,
    initDropdown,
    onDataChanged() { /* LibraryStorage mutations already queue durable snapshots. */ },
    onItemDeleted() { /* .NET derives tombstones from saved snapshot differences. */ },
    onRemoteUpdate(callback) { remoteCallback = callback; },
    getUser() { return account.signedIn ? account : null; },
    isSignedIn() { return account.signedIn; }
  };

  window.addEventListener('online', () => flush().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush().catch(() => {});
  });
})();
