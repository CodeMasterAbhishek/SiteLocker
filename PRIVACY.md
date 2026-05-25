# Privacy Policy for SiteLocker

Last updated: May 26, 2026

Your privacy is extremely important to us. This Privacy Policy details how **SiteLocker** handles user data and privacy.

---

## 1. Information Collection and Use

**SiteLocker does not collect, transmit, or share any personal data.** 

All configuration details and settings are stored locally on your device within your web browser's isolated local storage sandbox. No information is ever sent to external servers, third-party analytics, or developers.

## 2. Explanation of Permissions Used

To function properly, SiteLocker requests the following permissions from your browser:

- **`storage`**: Used to save your encrypted passcode hash, blocked domain lists, auto-lock timers, and focus mode preferences locally.
- **`tabs`**: Used to detect the active tab's domain name so you can easily toggle locks from the extension popup interface.
- **Host Permissions (`http://*/*` and `https://*/*`)**: Used to inject the local gatekeeper overlay (`content.js`) when you visit a website you have added to your blocked list.

## 3. Data Retention

All data is retained on your local machine. If you uninstall the extension, all stored settings, blocked domain lists, and passcode hashes are automatically deleted by the browser.

## 4. Remote Code and Assets

SiteLocker is 100% self-contained. It does not fetch remote Javascript, external style elements, or media files. 

## 5. Contact

If you have any questions or feedback, feel free to open an issue on our [GitHub Repository](https://github.com/CodeMasterAbhishek/SiteLocker).
