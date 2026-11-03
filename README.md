# Emoji Picker

A compact, private, and offline-first Windows 11 utility by **TechKey**, developed by **Cryptic Sheep**. 

Emoji Picker brings a fast, modern emoji selection experience to Windows. It runs completely offline with zero telemetry, instant search, full Unicode 17 coverage with local Twemoji artwork, skin tone variations, and direct paste insertion into any active application.

---

## Key Features

- **Offline-First & Private:** Operates entirely locally. No internet connection required, zero telemetry, no background analytics, and no accounts.
- **Global Shortcut:** Press **Ctrl + Shift + E** anywhere in Windows to toggle the picker at your caret position.
- **Full Emoji 17 Coverage:** Powered by **Emojibase 17.0.0** and **Twemoji 17.0.3** artwork (3,979 entries including variants, regional flags, and skin tones) rendered via local WebP files.
- **Seamless Insertion:** Automatically restores focus and pastes the selected Unicode character directly into your active text field.
- **Lightweight & Sandboxed:** Built on Electron with a sandboxed renderer, strict Content Security Policy (CSP), and a lightweight native Win32 input bridge written in C#.
- **Customizable:** Light, Dark, or Windows System theme matching, configurable shortcut chord, and preferred default skin tone.

---

## Installation & Running

Executable builds will be published under [Releases](../../releases):

- **Installer (`Setup.exe`):** Per-user installation with Start Menu and desktop shortcuts. Requires no administrator rights.
- **Portable (`Portable.exe`):** Standalone executable that runs without installation.

Preferences and recent selections are preserved locally in `%APPDATA%\Emoji Picker P2\preferences.json`.

---

## How to Use

1. Place your typing cursor (caret) inside any application or text field.
2. Press **Ctrl + Shift + E** to open Emoji Picker.
3. Search for emojis by name or keyword (e.g., `heart`, `laugh`, `coffee`), or browse category tabs.
4. **Click** an emoji (or navigate with Arrow keys and press **Enter**) to paste it directly into your target app.
5. Right-click any emoji displaying a corner marker to select alternative skin tones.
6. The picker remains visible for multi-emoji selection. Press **Ctrl + Shift + E**, click **X**, or simply resume typing in your app to dismiss it.

---

## Development Setup

### Prerequisites
- Windows 10 / 11 (x64)
- Node.js 22 LTS or newer
- Windows .NET Framework 4.x (for compiling the native C# helper)

### Getting Started

Clone the repository and install dependencies:

```powershell
# Clone the repository
git clone [https://github.com/your-username/emoji-picker.git](https://github.com/your-username/emoji-picker.git)
cd emoji-picker

# Install clean dependencies
npm ci

# Prepare datasets, icons, and build the C# native bridge
npm run data
npm run icons
npm run native

# Launch the app in development mode
npm start
```

### Running Tests & Building

```powershell
# Run unit and helper tests
npm test

# Run UI tests with isolated profiles
npm run test:ui

# Package NSIS installer and portable executables
npm run build
```

---

## Architecture & Security

- **Sandboxed Renderer:** Context isolation is strictly enabled; Node integration is disabled in renderer processes.
- **Secure Native Helper:** The companion C# Win32 helper (`WindowsBridge.exe`) safely identifies the caller's target window, restores focus, and simulates `Ctrl + V` using native Windows `SendInput`. It operates with standard user rights and never intercepts or logs keystrokes, window titles, or clipboard data.
- **Zero Network Activity:** No remote API calls, no third-party CDNs, and no auto-updater background checks.

---

## License & Attributions

- Source code is available under the [MIT License](LICENSE).
- Emoji artwork provided by [Twemoji](https://github.com/twitter/twemoji) licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Emoji metadata provided by [Emojibase](https://emojibase.dev/) (MIT License).