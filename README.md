# SiteLock

A premium, highly secure site lock utility for Google Chrome and Chromium-based browsers. Lock distracting or sensitive domains behind a secure 4-digit passcode, helping you stay focused and productive.

Designed and built with premium modern web design aesthetics, smooth animations, and rich theme choices.

---

## Features

- **Secure Passcode Protection**: Lock specific domains with a SHA-256 encrypted 4-digit PIN.
- **Onboarding Setup Wizard**: Beautiful, clean, step-by-step setup to set up a passcode, copy a recovery seed phrase, and choose a theme.
- **Dynamic Themes**: Support for 6 distinct visual styles:
  - **Light Minimal** (Aesthetic glowing indigo & rose light mode)
  - **Dark Modern**
  - **Ocean Blue**
  - **Forest Green**
  - **Sunset Purple**
  - **Monochrome** (High contrast dark theme)
- **PIN-Gated Locked Sites**: Protect your list of locked domains so they can't be modified or viewed without verification.
- **Procedural Sound Effects**: Native Web Audio synthesizer generating premium click and error sounds on-device without fetching external files.
- **Focus Mode (Pomodoro)**: Restrict access to distracting domains for a set period with a countdown timer that cannot be bypassed.
- **Seed Phrase Recovery**: Backup 8-word seed phrase system in case you forget your passcode.

---

## Installation (Developer Mode)

To run this extension locally or prepare it for upload:

1. Clone or download this repository to your computer.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the `Lock` directory containing the extension files.
6. Pin the extension in your toolbar to see the clean outline lock icon!

---

## Project Structure

```text
Lock/
├── audio/
│   └── audio.js                 # High-performance Web Audio synthesizer
├── icons/
│   ├── icon.svg                 # Vector source asset
│   ├── icon16.png               # Toolbar icon (16x16)
│   ├── icon48.png               # Extension page icon (48x48)
│   └── icon128.png              # Store icon (128x128)
├── background.js                # Extension service worker (tab and locking rules)
├── content.css                  # Lock screen page styling
├── content.js                   # Dom injection and lock page controller
├── manifest.json                # Extension MV3 configuration
├── popup.css                    # Control panel CSS styles
├── popup.html                   # Control panel layout
├── popup.js                     # Onboarding, focus timer & settings controller
├── security.js                  # SHA-256 passcode verification & crypto storage
└── .gitignore                   # Standard git file exclusion list
```

---

## License & Credits

Made by **Abhishek** with love. Feel free to clone, edit, or customize it for your personal use.
