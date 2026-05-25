/**
 * SiteLock Content Script
 * Acts as the gatekeeper. Blocks page load immediately if the domain is locked,
 * creates a Shadow DOM overlay to isolate the lock screen, intercepts keyboard shortcuts,
 * disables page interaction, and validates the PIN.
 */

(async () => {
  const currentHostname = window.location.hostname.replace(/^www\./, '').toLowerCase();

  // Helper: Matches hostnames to locked domains (subdomain support)
  function isDomainMatched(hostname, lockedDomain) {
    const normLocked = lockedDomain.replace(/^www\./, '').toLowerCase();
    return hostname === normLocked || hostname.endsWith('.' + normLocked);
  }

  // 1. Immediately inject early styling to hide page rendering ASAP
  const earlyStyle = document.createElement('style');
  earlyStyle.id = 'sitelock-early-hide';
  earlyStyle.textContent = `
    html {
      display: none !important;
      background: #030712 !important;
    }
  `;
  document.documentElement.appendChild(earlyStyle);

  function removeEarlyStyle() {
    const el = document.getElementById('sitelock-early-hide');
    if (el) el.remove();
  }

  // 2. Check if current domain is locked in local storage first (fastest check)
  chrome.storage.local.get({ lockedDomains: [] }, async (storageData) => {
    const isLocked = storageData.lockedDomains.some(d => isDomainMatched(currentHostname, d));
    
    if (!isLocked) {
      removeEarlyStyle();
      return;
    }
    
    // 3. Query background script to check if this tab is temporarily unlocked
    chrome.runtime.sendMessage({ type: 'checkLockState', domain: currentHostname }, async (response) => {
      if (response && response.unlocked) {
        removeEarlyStyle();
      } else {
        // Enforce lock overlay
        await initLockScreen(response || {});
      }
    });
  });

  // Global variables inside content script context
  let shadowRoot = null;
  let scrollObserver = null;
  let currentInput = [];
  let focusInterval = null;
  let lockoutInterval = null;
  let lockScreenState = 'verify_pin';
  let newPinEntered = '';
  let recoveryWordsList = [];
  let recoveryScrambledWords = [];
  let recoverySelectedWords = [];

  /**
   * Initializes and renders the Shadow DOM lock screen.
   */
  async function initLockScreen(lockState) {
    // Block scroll immediately
    applyScrollBlock();

    // Create the host container
    const host = document.createElement('div');
    host.id = 'sitelock-root';
    host.style.all = 'initial';
    
    // Closed Shadow DOM for security and styling isolation
    shadowRoot = host.attachShadow({ mode: 'closed' });

    // Load full styles
    const styleEl = document.createElement('style');
    try {
      const cssUrl = chrome.runtime.getURL('content.css');
      const cssRes = await fetch(cssUrl);
      styleEl.textContent = await cssRes.text();
    } catch (e) {
      console.error('SiteLock failed to load css resource', e);
      // Minimal fallback styling in case of fetch failure
      styleEl.textContent = `
        .sitelock-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #0c0f17; display: flex; align-items: center; justify-content: center; z-index: 2147483647; font-family: sans-serif; color: #fff; }
        .sitelock-card { text-align: center; background: rgba(255,255,255,0.05); padding: 40px; border-radius: 20px; max-width: 320px; }
      `;
    }
    shadowRoot.appendChild(styleEl);

    // Build lock screen HTML
    const overlay = document.createElement('div');
    overlay.className = 'sitelock-overlay active';
    
    // Set theme class on load
    chrome.storage.local.get({ theme: 'light' }, (res) => {
      const activeTheme = res.theme || 'light';
      overlay.classList.add(`sitelock-theme-${activeTheme}`);
    });
    
    // Actions Panel (Mute Button)
    const topBar = document.createElement('div');
    topBar.className = 'sitelock-top-bar';
    
    const muteBtn = document.createElement('button');
    muteBtn.className = 'sitelock-icon-btn';
    muteBtn.title = 'Toggle Sound Effects';
    
    // Audio icons
    const soundOnIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
    const soundOffIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
    
    // Set initial sound icon
    chrome.storage.local.get({ soundsEnabled: true }, (res) => {
      muteBtn.innerHTML = res.soundsEnabled ? soundOnIcon : soundOffIcon;
    });
    
    muteBtn.addEventListener('click', () => {
      chrome.storage.local.get({ soundsEnabled: true }, (res) => {
        const newState = !res.soundsEnabled;
        chrome.storage.local.set({ soundsEnabled: newState }, () => {
          muteBtn.innerHTML = newState ? soundOnIcon : soundOffIcon;
        });
      });
    });
    
    topBar.appendChild(muteBtn);
    overlay.appendChild(topBar);

    // Lock Card
    const card = document.createElement('div');
    card.className = 'sitelock-card';

    // Header
    const header = document.createElement('div');
    header.className = 'sitelock-header';

    const logoWrapper = document.createElement('div');
    logoWrapper.className = 'sitelock-logo-wrapper';
    logoWrapper.innerHTML = `
      <svg class="sitelock-logo-icon" viewBox="0 0 24 24">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    `;

    const titleEl = document.createElement('h1');
    titleEl.className = 'sitelock-title';
    titleEl.textContent = 'SiteLock';

    const domainText = document.createElement('p');
    domainText.className = 'sitelock-subtitle';
    domainText.textContent = currentHostname;

    header.appendChild(logoWrapper);
    header.appendChild(titleEl);
    header.appendChild(domainText);
    card.appendChild(header);

    // Passcode Section Container
    const passcodeSection = document.createElement('div');
    passcodeSection.className = 'sitelock-passcode-section';

    // Check if a PIN is set at all and get recovery words
    const hasPin = await SiteLockSecurity.isPinSet();
    const recoveryWords = await SiteLockSecurity.getRecoveryWords();
    if (!hasPin) {
      // Prompt user to configure extension
      const setupPrompt = document.createElement('p');
      setupPrompt.style.fontSize = '15px';
      setupPrompt.style.lineHeight = '1.6';
      setupPrompt.style.color = 'rgba(255, 255, 255, 0.7)';
      setupPrompt.style.margin = '20px 0';
      setupPrompt.innerHTML = 'This website is locked. However, you have <strong>not set a PIN</strong> yet.<br><br>Please click the <strong>SiteLock Extension Icon</strong> in your toolbar to configure your 4-digit PIN and access this site.';
      passcodeSection.appendChild(setupPrompt);
      card.appendChild(passcodeSection);
      overlay.appendChild(card);
      shadowRoot.appendChild(overlay);
      document.documentElement.appendChild(host);
      removeEarlyStyle();
      return;
    }

    // Passcode Dots
    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'sitelock-dots';
    const dotElements = [];
    for (let i = 0; i < 4; i++) {
      const dot = document.createElement('div');
      dot.className = 'sitelock-dot';
      dotsContainer.appendChild(dot);
      dotElements.push(dot);
    }
    passcodeSection.appendChild(dotsContainer);

    // Keypad Grid
    const keypad = document.createElement('div');
    keypad.className = 'sitelock-keypad';

    const keys = [
      { key: '1', letters: '' },
      { key: '2', letters: 'A B C' },
      { key: '3', letters: 'D E F' },
      { key: '4', letters: 'G H I' },
      { key: '5', letters: 'J K L' },
      { key: '6', letters: 'M N O' },
      { key: '7', letters: 'P Q R S' },
      { key: '8', letters: 'T U V' },
      { key: '9', letters: 'W X Y Z' },
      { key: 'cancel', action: true }, // Empty spacer / Cancel option (which locks tab or navigates back)
      { key: '0', letters: '+' },
      { key: 'backspace', action: true }
    ];

    keys.forEach(k => {
      const btn = document.createElement('button');
      
      if (k.key === 'cancel') {
        btn.className = 'sitelock-key action-btn';
        btn.id = 'sitelock-key-cancel';
        btn.innerHTML = `<span class="sitelock-cancel-text" style="font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; opacity: 0.7;">Back</span>`;
        btn.title = 'Go back to previous page';
        btn.addEventListener('click', () => {
          if (lockScreenState === 'new_pin' || lockScreenState === 'confirm_pin') {
            resetToVerifyPinState();
          } else {
            if (history.length > 1) {
              history.back();
            } else {
              window.close();
            }
          }
        });
      } else if (k.key === 'backspace') {
        btn.className = 'sitelock-key action-btn';
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
            <line x1="18" y1="9" x2="12" y2="15"></line>
            <line x1="12" y1="9" x2="18" y2="15"></line>
          </svg>
        `;
        btn.title = 'Delete';
        btn.addEventListener('click', () => deleteDigit(dotElements));
      } else {
        btn.className = 'sitelock-key';
        
        const numSpan = document.createElement('span');
        numSpan.className = 'sitelock-key-number';
        numSpan.textContent = k.key;
        btn.appendChild(numSpan);

        if (k.letters) {
          const lettersSpan = document.createElement('span');
          lettersSpan.className = 'sitelock-key-letters';
          lettersSpan.textContent = k.letters;
          btn.appendChild(lettersSpan);
        }

        btn.addEventListener('click', () => inputDigit(k.key, dotElements, card));
      }

      keypad.appendChild(btn);
    });

    passcodeSection.appendChild(keypad);

    // Recovery / Forgot PIN link
    if (recoveryWords && recoveryWords.length > 0) {
      recoveryWordsList = recoveryWords;
      const forgotPinLink = document.createElement('a');
      forgotPinLink.className = 'sitelock-forgot-pin';
      forgotPinLink.textContent = 'Forgot PIN?';
      forgotPinLink.href = '#';
      forgotPinLink.addEventListener('click', (e) => {
        e.preventDefault();
        switchToRecoveryMode();
      });
      passcodeSection.appendChild(forgotPinLink);
    }

    card.appendChild(passcodeSection);

    // Recovery Section Container
    const recoverySection = document.createElement('div');
    recoverySection.className = 'sitelock-recovery-section';
    
    const recoveryTitle = document.createElement('h2');
    recoveryTitle.className = 'sitelock-recovery-title';
    recoveryTitle.textContent = 'Recover PIN';
    
    const recoveryPrompt = document.createElement('p');
    recoveryPrompt.className = 'sitelock-recovery-prompt';
    recoveryPrompt.textContent = 'Select the 8 words in their original order.';
    
    // Selected Words Sequence Slots
    const selectedSeq = document.createElement('div');
    selectedSeq.id = 'sitelock-recovery-selected-seq';
    selectedSeq.className = 'sitelock-recovery-selected-seq';
    
    // Scrambled Words Grid
    const wordsGrid = document.createElement('div');
    wordsGrid.id = 'sitelock-recovery-words-grid';
    wordsGrid.className = 'sitelock-recovery-words-grid';
    
    const errorMsg = document.createElement('p');
    errorMsg.id = 'sitelock-recovery-error';
    errorMsg.className = 'sitelock-recovery-error';
    errorMsg.style.display = 'none';
    
    const btnRow = document.createElement('div');
    btnRow.className = 'sitelock-recovery-buttons';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sitelock-btn secondary-btn';
    cancelBtn.id = 'sitelock-recovery-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      resetToVerifyPinState();
    });
    
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'sitelock-btn secondary-btn';
    resetBtn.id = 'sitelock-recovery-reset';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      SiteLockAudio.playLock().catch(() => {});
      recoverySelectedWords = [];
      renderLockRecoveryGrid();
    });
    
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(resetBtn);
    
    recoverySection.appendChild(recoveryTitle);
    recoverySection.appendChild(recoveryPrompt);
    recoverySection.appendChild(selectedSeq);
    recoverySection.appendChild(wordsGrid);
    recoverySection.appendChild(errorMsg);
    recoverySection.appendChild(btnRow);
    
    card.appendChild(recoverySection);

    // Focus Mode Container
    const focusContainer = document.createElement('div');
    focusContainer.className = 'sitelock-focus-container';
    
    // Focus SVG Progress Ring
    focusContainer.innerHTML = `
      <svg class="sitelock-timer-svg">
        <defs>
          <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#4f46e5" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <circle class="sitelock-timer-bg" cx="100" cy="100" r="90"></circle>
        <circle id="sitelock-progress-ring" class="sitelock-timer-progress" cx="100" cy="100" r="90"></circle>
      </svg>
      <div class="sitelock-timer-text-container">
        <span id="sitelock-countdown-text" class="sitelock-timer-countdown">00:00</span>
        <span class="sitelock-timer-label">Remaining</span>
      </div>
      <p class="sitelock-focus-msg">Focus Mode is active. Distracting websites are temporarily blocked to help you stay productive.</p>
      <div class="sitelock-timer-badge">
        <div class="sitelock-pulse-dot"></div>
        Strict Lockout
      </div>
    `;

    // Lockout Mode Container
    const lockoutContainer = document.createElement('div');
    lockoutContainer.className = 'sitelock-lockout-container';
    lockoutContainer.innerHTML = `
      <div style="width: 64px; height: 64px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 20px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; box-shadow: 0 10px 25px -5px rgba(239, 68, 68, 0.2);">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          <line x1="12" y1="15" x2="12" y2="17"></line>
        </svg>
      </div>
      <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 8px 0; color: #ef4444;">Security Lockout</h2>
      <p class="sitelock-lockout-msg" style="font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.7); margin: 10px 0 5px 0;">Too many failed passcode attempts. Site access is temporarily suspended.</p>
      <div id="sitelock-lockout-time" class="sitelock-lockout-countdown" style="font-size: 32px; font-weight: 700; color: #ef4444; margin: 10px 0; font-variant-numeric: tabular-nums;">00s</div>
      <p style="font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 10px;">Please try again later</p>
    `;

    card.appendChild(lockoutContainer);
    card.appendChild(focusContainer);
    overlay.appendChild(card);
    shadowRoot.appendChild(overlay);

    // Append to document
    document.documentElement.appendChild(host);

    // Sound: Play Lock Tone on start
    SiteLockAudio.playLock().catch(() => {});

    // Check Lockout or Focus Mode
    chrome.storage.local.get({ lockoutUntil: 0 }, (storageResult) => {
      const now = Date.now();
      const lockoutUntil = storageResult.lockoutUntil || 0;
      
      if (lockoutUntil > now) {
        activateLockoutMode(lockoutUntil - now, shadowRoot);
      } else {
        if (lockState.focusModeActive) {
          activateFocusMode(lockState.focusRemainingTime, shadowRoot);
        }
      }
    });

    // Reveal the overlay
    removeEarlyStyle();

    // 4. Intercept Keyboard inputs
    const handleKeyDown = (e) => {
      // Ignore key events if focus mode or security lockout is active
      if (focusInterval || lockoutInterval) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (lockScreenState === 'recovery') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const key = e.key;
      if (key >= '0' && key <= '9') {
        e.preventDefault();
        e.stopPropagation();
        inputDigit(key, dotElements, card);
      } else if (key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        deleteDigit(dotElements);
      } else {
        // Block other keys (e.g. Tab, Space, scroll keys) to prevent bypass
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    
    // Clicks are naturally captured inside the Shadow DOM overlay because it spans the fullscreen viewport

  }

  /**
   * Enforces Focus Mode styling and initializes countdown loop.
   */
  function activateFocusMode(remainingTimeMs, sRoot) {
    const passcodeSec = sRoot.querySelector('.sitelock-passcode-section');
    const focusSec = sRoot.querySelector('.sitelock-focus-container');
    const ring = sRoot.querySelector('#sitelock-progress-ring');
    const timerText = sRoot.querySelector('#sitelock-countdown-text');
    
    if (passcodeSec) passcodeSec.style.display = 'none';
    if (focusSec) focusSec.className = 'sitelock-focus-container active';

    const totalDuration = remainingTimeMs;
    const startTime = Date.now();
    const circumference = 2 * Math.PI * 90; // r=90

    // Set initial dashoffset
    if (ring) {
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = 0;
    }

    const updateTimer = () => {
      const elapsed = Date.now() - startTime;
      const timeLeft = Math.max(0, totalDuration - elapsed);

      if (timeLeft <= 0) {
        clearInterval(focusInterval);
        focusInterval = null;
        // Focus Mode completed, restore password screen
        if (passcodeSec) passcodeSec.style.display = 'block';
        if (focusSec) focusSec.className = 'sitelock-focus-container';
        // Play success chime
        SiteLockAudio.playUnlock().catch(() => {});
        return;
      }

      // Format time
      const minutes = Math.floor(timeLeft / 60000);
      const seconds = Math.floor((timeLeft % 60000) / 1000);
      if (timerText) {
        timerText.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }

      // Update circular ring progress
      if (ring) {
        const progress = timeLeft / totalDuration;
        const offset = circumference - (progress * circumference);
        ring.style.strokeDashoffset = offset;
      }
    };

    updateTimer();
    focusInterval = setInterval(updateTimer, 1000);
  }

  /**
   * Activates Security Lockout screen and countdown timer.
   */
  function activateLockoutMode(remainingTimeMs, sRoot) {
    const passcodeSec = sRoot.querySelector('.sitelock-passcode-section');
    const focusSec = sRoot.querySelector('.sitelock-focus-container');
    const lockoutSec = sRoot.querySelector('.sitelock-lockout-container');
    const timerText = sRoot.querySelector('#sitelock-lockout-time');
    
    if (passcodeSec) passcodeSec.style.display = 'none';
    if (focusSec) focusSec.className = 'sitelock-focus-container';
    if (lockoutSec) lockoutSec.className = 'sitelock-lockout-container active';

    const totalDuration = remainingTimeMs;
    const startTime = Date.now();

    const updateTimer = () => {
      const elapsed = Date.now() - startTime;
      const timeLeft = Math.max(0, totalDuration - elapsed);

      if (timeLeft <= 0) {
        clearInterval(lockoutInterval);
        lockoutInterval = null;
        
        chrome.storage.local.set({ lockoutUntil: 0, failedAttempts: 0 }, () => {
          if (passcodeSec) passcodeSec.style.display = 'block';
          if (lockoutSec) lockoutSec.className = 'sitelock-lockout-container';
          
          currentInput = [];
          const dots = sRoot.querySelectorAll('.sitelock-dot');
          dots.forEach(d => d.classList.remove('filled'));
        });
        return;
      }

      const seconds = Math.ceil(timeLeft / 1000);
      if (timerText) {
        timerText.textContent = `${seconds}s`;
      }
    };

    updateTimer();
    lockoutInterval = setInterval(updateTimer, 1000);
  }

  /**
   * Handles digit entries
   */
  function inputDigit(digit, dotElements, card) {
    if (currentInput.length >= 4) return;
    
    currentInput.push(digit);
    
    // Highlight dots
    dotElements[currentInput.length - 1].classList.add('filled');

    // Once 4 digits are entered, verify the PIN
    if (currentInput.length === 4) {
      // Delay verification slightly to let the last dot fill animation run
      setTimeout(() => {
        verifyEnteredPIN(dotElements, card);
      }, 150);
    }
  }

  /**
   * Deletes the last entered digit
   */
  function deleteDigit(dotElements) {
    if (currentInput.length === 0) return;
    
    currentInput.pop();
    dotElements[currentInput.length].classList.remove('filled');
  }

  /**
   * Verifies the full PIN entry.
   */
  async function verifyEnteredPIN(dotElements, card) {
    if (lockScreenState === 'verify_pin') {
      const pinString = currentInput.join('');
      const isValid = await SiteLockSecurity.verifyPIN(pinString);

      if (isValid) {
        // SUCCESS: Play sound, fade out, reset attempts, and unlock tab
        SiteLockAudio.playUnlock().catch(() => {});
        
        chrome.storage.local.set({ failedAttempts: 0, lockoutUntil: 0 });
        
        const overlay = shadowRoot.querySelector('.sitelock-overlay');
        if (overlay) {
          overlay.classList.add('fade-out');
        }

        // Send unlock message to background service worker
        chrome.runtime.sendMessage({
          type: 'setTabUnlocked',
          domain: currentHostname
        });

        // Cleanup overlay from DOM after transitions
        setTimeout(() => {
          removeScrollBlock();
          const root = document.getElementById('sitelock-root');
          if (root) root.remove();
          
          // Remove click/key blockers by reloading extension contexts
          window.location.reload();
        }, 400);

      } else {
        // FAIL: Shake, play buzzer, clear inputs, check failed attempts
        SiteLockAudio.playError().catch(() => {});
        
        card.classList.add('shake');
        if (navigator.vibrate) {
          navigator.vibrate(200);
        }

        chrome.storage.local.get({ failedAttempts: 0 }, (res) => {
          const nextAttempts = res.failedAttempts + 1;
          
          if (nextAttempts >= 3) {
            // Locked out for 1 minute (60,000 milliseconds)
            const lockTime = Date.now() + 60000;
            chrome.storage.local.set({ failedAttempts: 0, lockoutUntil: lockTime }, () => {
              setTimeout(() => {
                card.classList.remove('shake');
                activateLockoutMode(60000, shadowRoot);
              }, 500);
            });
          } else {
            // Increment attempts and reset dots
            chrome.storage.local.set({ failedAttempts: nextAttempts }, () => {
              setTimeout(() => {
                card.classList.remove('shake');
                currentInput = [];
                dotElements.forEach(d => d.classList.remove('filled'));
              }, 500);
            });
          }
        });
      }
    } else if (lockScreenState === 'new_pin') {
      newPinEntered = currentInput.join('');
      lockScreenState = 'confirm_pin';
      currentInput = [];
      dotElements.forEach(d => d.classList.remove('filled'));
      
      const subtitleEl = shadowRoot.querySelector('.sitelock-subtitle');
      if (subtitleEl) subtitleEl.textContent = 'Confirm New 4-Digit PIN';
      
      SiteLockAudio.playLock().catch(() => {});
      
    } else if (lockScreenState === 'confirm_pin') {
      const confirmPin = currentInput.join('');
      
      if (confirmPin === newPinEntered) {
        SiteLockAudio.playUnlock().catch(() => {});
        
        await SiteLockSecurity.setPIN(confirmPin);
        
        chrome.storage.local.set({ failedAttempts: 0, lockoutUntil: 0 });
        
        const overlay = shadowRoot.querySelector('.sitelock-overlay');
        if (overlay) {
          overlay.classList.add('fade-out');
        }

        chrome.runtime.sendMessage({
          type: 'setTabUnlocked',
          domain: currentHostname
        });

        setTimeout(() => {
          removeScrollBlock();
          const root = document.getElementById('sitelock-root');
          if (root) root.remove();
          window.location.reload();
        }, 400);
        
      } else {
        SiteLockAudio.playError().catch(() => {});
        card.classList.add('shake');
        
        const subtitleEl = shadowRoot.querySelector('.sitelock-subtitle');
        if (subtitleEl) subtitleEl.textContent = 'PINs do not match. Try again.';
        
        setTimeout(() => {
          card.classList.remove('shake');
          lockScreenState = 'new_pin';
          newPinEntered = '';
          currentInput = [];
          dotElements.forEach(d => d.classList.remove('filled'));
          if (subtitleEl) subtitleEl.textContent = 'Enter New 4-Digit PIN';
        }, 800);
      }
    }
  }

  /**
   * Switches the lock overlay card to security recovery mode using seed phrase selection.
   */
  function switchToRecoveryMode() {
    lockScreenState = 'recovery';
    currentInput = [];
    recoverySelectedWords = [];
    recoveryScrambledWords = [...recoveryWordsList].sort(() => Math.random() - 0.5);
    
    const dots = shadowRoot.querySelectorAll('.sitelock-dot');
    dots.forEach(d => d.classList.remove('filled'));
    
    const passcodeSec = shadowRoot.querySelector('.sitelock-passcode-section');
    if (passcodeSec) passcodeSec.style.display = 'none';
    
    const recoverySec = shadowRoot.querySelector('.sitelock-recovery-section');
    if (recoverySec) {
      recoverySec.classList.add('active');
      renderLockRecoveryGrid();
      
      const errorMsgEl = shadowRoot.getElementById('sitelock-recovery-error');
      if (errorMsgEl) errorMsgEl.style.display = 'none';
    }
  }

  /**
   * Renders the interactive word grid and selection slots in the gatekeeper card.
   */
  function renderLockRecoveryGrid() {
    const selectedSeqContainer = shadowRoot.getElementById('sitelock-recovery-selected-seq');
    const wordsGrid = shadowRoot.getElementById('sitelock-recovery-words-grid');
    
    if (!selectedSeqContainer || !wordsGrid) return;
    
    selectedSeqContainer.innerHTML = '';
    wordsGrid.innerHTML = '';
    
    // 8 Slots
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'sitelock-recovery-slot';
      if (recoverySelectedWords[i]) {
        slot.classList.add('filled');
        slot.textContent = recoverySelectedWords[i];
      } else {
        slot.textContent = '';
      }
      selectedSeqContainer.appendChild(slot);
    }
    
    // Scrambled buttons
    recoveryScrambledWords.forEach(word => {
      const btn = document.createElement('button');
      btn.className = 'sitelock-recovery-word-btn';
      btn.textContent = word;
      
      if (recoverySelectedWords.includes(word)) {
        btn.disabled = true;
        btn.classList.add('selected');
      }
      
      btn.addEventListener('click', () => {
        SiteLockAudio.playLock().catch(() => {});
        recoverySelectedWords.push(word);
        renderLockRecoveryGrid();
        
        if (recoverySelectedWords.length === 8) {
          setTimeout(verifyLockRecoveryOrder, 150);
        }
      });
      
      wordsGrid.appendChild(btn);
    });
  }

  /**
   * Verifies if selected words sequence matches the correct order.
   * If correct, transitions lock screen to PIN Reset keypad flow.
   */
  async function verifyLockRecoveryOrder() {
    const isCorrect = await SiteLockSecurity.verifyRecoveryWordsOrder(recoverySelectedWords);
    const cardEl = shadowRoot.querySelector('.sitelock-card');
    
    if (isCorrect) {
      const recoverySec = shadowRoot.querySelector('.sitelock-recovery-section');
      if (recoverySec) recoverySec.classList.remove('active');
      
      SiteLockAudio.playUnlock().catch(() => {});
      
      lockScreenState = 'new_pin';
      newPinEntered = '';
      currentInput = [];
      
      const subtitleEl = shadowRoot.querySelector('.sitelock-subtitle');
      if (subtitleEl) subtitleEl.textContent = 'Enter New 4-Digit PIN';
      
      const cancelTextEl = shadowRoot.querySelector('.sitelock-cancel-text');
      if (cancelTextEl) cancelTextEl.textContent = 'Cancel';
      
      const passcodeSec = shadowRoot.querySelector('.sitelock-passcode-section');
      if (passcodeSec) passcodeSec.style.display = 'block';
    } else {
      const errorMsgEl = shadowRoot.getElementById('sitelock-recovery-error');
      if (errorMsgEl) {
        errorMsgEl.textContent = 'Incorrect order. Please try again.';
        errorMsgEl.style.display = 'block';
      }
      cardEl.classList.add('shake');
      SiteLockAudio.playError().catch(() => {});
      
      setTimeout(() => {
        cardEl.classList.remove('shake');
        recoverySelectedWords = [];
        renderLockRecoveryGrid();
      }, 500);
    }
  }

  /**
   * Restores the standard PIN verification keypad mode.
   */
  function resetToVerifyPinState() {
    lockScreenState = 'verify_pin';
    currentInput = [];
    newPinEntered = '';
    
    const dots = shadowRoot.querySelectorAll('.sitelock-dot');
    dots.forEach(d => d.classList.remove('filled'));
    
    const subtitleEl = shadowRoot.querySelector('.sitelock-subtitle');
    if (subtitleEl) subtitleEl.textContent = currentHostname;
    
    const cancelTextEl = shadowRoot.querySelector('.sitelock-cancel-text');
    if (cancelTextEl) cancelTextEl.textContent = 'Back';
    
    const recoverySec = shadowRoot.querySelector('.sitelock-recovery-section');
    if (recoverySec) recoverySec.classList.remove('active');
    
    const passcodeSec = shadowRoot.querySelector('.sitelock-passcode-section');
    if (passcodeSec) passcodeSec.style.display = 'block';
  }

  /**
   * Enforces page-scrolling locking.
   */
  function applyScrollBlock() {
    const block = () => {
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      if (document.body) {
        document.body.style.setProperty('overflow', 'hidden', 'important');
      }
    };
    
    block();
    
    scrollObserver = new MutationObserver(() => {
      scrollObserver.disconnect();
      block();
      scrollObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
      if (document.body) {
        scrollObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
      }
    });
    
    scrollObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    // Body might load later
    if (document.body) {
      scrollObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          scrollObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
        }
      });
    }
  }

  function removeScrollBlock() {
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    document.documentElement.style.removeProperty('overflow');
    if (document.body) {
      document.body.style.removeProperty('overflow');
    }
  }

  // Handle messages sent from background worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'enforceRelock') {
      // Re-trigger location check and lock if needed
      window.location.reload();
    }
  });

  // Dynamically lock/unlock page if configuration updates in popup while on page
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.theme) {
      const newTheme = changes.theme.newValue || 'light';
      const overlay = shadowRoot ? shadowRoot.querySelector('.sitelock-overlay') : null;
      if (overlay) {
        const themeClasses = [
          'sitelock-theme-dark',
          'sitelock-theme-light',
          'sitelock-theme-ocean',
          'sitelock-theme-forest',
          'sitelock-theme-sunset',
          'sitelock-theme-mono'
        ];
        themeClasses.forEach(c => overlay.classList.remove(c));
        overlay.classList.add(`sitelock-theme-${newTheme}`);
      }
    }

    if (changes.lockedDomains) {
      const oldVal = changes.lockedDomains.oldValue || [];
      const newVal = changes.lockedDomains.newValue || [];
      
      const wasLocked = oldVal.some(d => isDomainMatched(currentHostname, d));
      const isNowLocked = newVal.some(d => isDomainMatched(currentHostname, d));
      
      if (!wasLocked && isNowLocked) {
        // Site was locked, trigger reload to lock screen
        window.location.reload();
      } else if (wasLocked && !isNowLocked) {
        // Site was unlocked, reload to show page content
        removeScrollBlock();
        const root = document.getElementById('sitelock-root');
        if (root) root.remove();
        window.location.reload();
      }
    }
  });

})();
