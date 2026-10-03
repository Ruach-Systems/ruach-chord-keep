# Source provenance

Mirrored source: https://github.com/louieje-g/chordlibrary

Inspected revision: `230ad36e863f3175438a92520b3a567d516c2afe` (main, feat: refresh library UI and rename setlists).

- `src/ChordLibrary.Shared/Assets/library.html` is the source body, without external Firebase/script tags; account action text is adapted.
- `src/ChordLibrary.Shared/wwwroot/css/style.css` is the original stylesheet, unchanged.
- `src/ChordLibrary.Shared/wwwroot/js/app.js` retains the original interaction/music code with native service adapters and documented fixes.
- `src/ChordLibrary.Shared/wwwroot/js/qrcode.js` retains the bundled QR library, including its existing MIT notice.
- `src/ChordLibrary.Native/Resources/AppIcon/appicon.png` is `icons/icon-512-v2.png` from the source.

The source repository did not contain a top-level license file at the inspected revision. This implementation follows the repository owner's request to mirror their application; it does not add a new license grant for the original assets. Third-party dependencies retain their respective package licenses.
