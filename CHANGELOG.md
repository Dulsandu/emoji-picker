# Changelog

## 1.2.0-p2 — 2026-10-06 (v1.2 P2 prerelease)

- Restore the previously focused child control once per picker opening before sending paste input, preserving ordered repeated insertion in Windows Settings/XAML and Chromium/Electron editors, while retaining the fixed destination, integrity checks, foreground validation, clipboard fallback, and external-typing dismissal behavior.
- Removed application-title exclusions from the native helper and added regression coverage for standard inputs, textareas, and contenteditable rich editors.
- Reject common editing and window-management combinations when choosing a global shortcut, without dropping the currently registered shortcut after an invalid choice.
- Added a separate P2 application identity, profile, startup entry, installer, portable executable, public release directory, and end-user guide.
- Added restrained TechKey and Cryptic Sheep attribution in Settings and Windows executable metadata.
- Reduced packaged Koffi files to its required Windows runtime components and excluded internal tests, scripts, reports, evidence, source maps, logs, and build notes from the public artifact set.

## 1.2.0-p1 — 2026-10-05 (v1.2 P1 prerelease)

- Added buffered row virtualization, reused grid cells, bounded local artwork loading, and suspension of visual observers while hidden. Settings changes no longer rebuild unrelated grid content.
- Bundled Twemoji 17.0.3 under CC BY 4.0 with full attribution, covering all 3,979 emoji/variant entries. Unicode insertion values are unchanged.
- Added searchable codes for all 259 country/territory flags and common English aliases; all 270 Flags entries use artwork independent of Windows fonts.
- Fixed native Settings Back hit testing by disabling the underlying drag region while a dialog is open. Preserve category, search, and scroll position when returning.
- Refined search, category, and grid density; removed the emoji press scale animation. Preserve Light, Dark, System and all v1.1 interaction behavior.
- P1 has separate installation/preferences/startup identity and versioned artifacts. Preserved v1.1 in the “v1.2 P1 - Start” checkpoint. No P2 or P3 features.

## 1.1.0 — 2026-10-05

- Added a small Windows .NET Framework helper for original-window capture, focus restoration, clipboard-based Ctrl+V insertion, outside-click detection, and pass-through external typing detection.
- Keep the same picker window visible and inactive above the target after insertion; retain one fixed destination throughout an opening.
- Serialize selections and await Electron's asynchronous clipboard write. Preserve all original Unicode sequences and recents even when automatic paste is blocked.
- Added an explicit picker session state machine with generation checks for queued requests and delayed dismissal events.
- Restrict dismissal to shortcut toggle, X, outside clicks, and resumed external typing. Escape only dismisses dialogs. Removed the auto-hide preference and migrate v1.0 settings to always stay open.
- Respect foreground/integrity restrictions. No admin requirement, elevation, key logging, telemetry, runtime network, or runtime downloads. Added pinned Koffi 3.3.2 solely for the documented foreground-permission handoff.
- Preserved the complete v1.0 release and source before changes; build v1.1 artifacts into a separate versioned output directory.

## 1.0.0

Initial offline picker with local emoji data, search, categories, variants, recents, themes, configurable global shortcut, startup preference, NSIS installer, and portable executable.
