window.libraryLoader = {
  async load() {
    for (const file of ['qrcode.js', 'app.js']) {
      await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '_content/ChordLibrary.Shared/js/' + file; script.onload = resolve; script.onerror = () => reject(new Error('Could not load ' + file)); document.body.appendChild(script); });
    }
  }
};
