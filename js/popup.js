/**
 * SiteLock Popup Logic
 * Coordinates locking/unlocking the current website, managing settings,
 * starting focus timer, and importing/exporting configurations.
 */

document.addEventListener('DOMContentLoaded', async () => {
  let currentDomain = null;
  let isCurrentDomainLocked = false;
  let focusInterval = null;
  let selectedFocusDuration = 5; // Default 5 minutes
  let pendingModalAction = null; // Callback for when modal verification succeeds
  let isListUnlocked = false; // Whether the locked sites list has been unlocked this session

  const themeClasses = [
    'sitelock-theme-dark',
    'sitelock-theme-light',
    'sitelock-theme-ocean',
    'sitelock-theme-forest',
    'sitelock-theme-sunset',
    'sitelock-theme-mono'
  ];

  function applyThemeClass(themeName) {
    themeClasses.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`sitelock-theme-${themeName}`);
    
    const themeGridItems = document.querySelectorAll('.theme-grid-item');
    themeGridItems.forEach(item => {
      if (item.getAttribute('data-theme') === themeName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  function updateGreeting() {
    const greetingTitle = document.getElementById('dashboard-greeting-title');
    const greetingSub = document.getElementById('dashboard-greeting-sub');
    if (!greetingTitle || !greetingSub) return;

    const hour = new Date().getHours();
    let title = "Good evening";
    let sub = "Reviewing your progress.";

    if (hour < 5) {
      title = "Good night";
      sub = "Rest well, lock up distractions.";
    } else if (hour < 12) {
      title = "Good morning";
      sub = "Let's accomplish your goals today.";
    } else if (hour < 17) {
      title = "Good afternoon";
      sub = "Stay in the zone and keep going.";
    } else if (hour < 22) {
      title = "Good evening";
      sub = "Reviewing your progress.";
    } else {
      title = "Good night";
      sub = "Rest well, lock up distractions.";
    }

    greetingTitle.textContent = title;
    greetingSub.textContent = sub;
  }

  // --- INITIALIZATION ---
  async function init() {
    setupNavigation();
    setupSoundToggle();
    
    // Load and apply current theme aesthetic on start
    chrome.storage.local.get({ theme: 'light' }, (res) => {
      applyThemeClass(res.theme || 'light');
    });

    const pinSet = await SiteLockSecurity.isPinSet();
    if (!pinSet) {
      showScreen('screen-setup');
      setupPINCreationFlow();
    } else {
      showScreen('screen-main');
      updateGreeting();
      await detectCurrentTab();
      setupFocusModeUI();
      setupSettingsUI();
    }
  }

  // --- SCREEN SWITCHER ---
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
  }

  // --- NAVIGATION TABS ---
  function setupNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => {
      t.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        t.classList.add('active');
        
        const targetTab = t.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(targetTab).classList.remove('hidden');
        
        // Refresh content depending on tab
        if (targetTab === 'tab-list') {
          if (isListUnlocked) {
            loadLockedList();
          } else {
            showListPinGate();
          }
        } else if (targetTab === 'tab-lock') {
          detectCurrentTab();
        }
      });
    });
  }

  // --- SOUND TOGGLE ---
  const muteBtn = document.getElementById('header-mute-btn');
  const soundOnIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
  const soundOffIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

  function setupSoundToggle() {
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
  }

  // --- DOMAIN MATCHING HELPERS ---
  function isDomainMatched(hostname, lockedDomain) {
    const normLocked = lockedDomain.replace(/^www\./, '').toLowerCase();
    return hostname === normLocked || hostname.endsWith('.' + normLocked);
  }

  // --- DETECT CURRENT TAB ---
  async function detectCurrentTab() {
    const domainText = document.getElementById('current-domain-text');
    const toggleBtn = document.getElementById('btn-toggle-lock');
    const statusTag = document.getElementById('site-status-tag');
    const visualBox = document.getElementById('lock-state-visual');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].url) {
        domainText.textContent = 'System Page';
        toggleBtn.disabled = true;
        toggleBtn.textContent = 'SiteLock Restricted';
        return;
      }

      try {
        const url = new URL(tabs[0].url);
        
        // Block extension configurations or local system pages from being locked
        if (!url.protocol.startsWith('http')) {
          domainText.textContent = 'System Page';
          toggleBtn.disabled = true;
          toggleBtn.textContent = 'SiteLock Restricted';
          return;
        }

        currentDomain = url.hostname.replace(/^www\./, '').toLowerCase();
        domainText.textContent = currentDomain;
        toggleBtn.disabled = false;

        // Check if currently locked
        chrome.storage.local.get({ lockedDomains: [] }, (result) => {
          isCurrentDomainLocked = result.lockedDomains.some(d => isDomainMatched(currentDomain, d));
          
          if (isCurrentDomainLocked) {
            statusTag.textContent = 'Locked';
            statusTag.classList.add('locked');
            visualBox.classList.add('locked');
            toggleBtn.textContent = 'Unlock Website';
            toggleBtn.className = 'btn-secondary w-full py-3';
          } else {
            statusTag.textContent = 'Unlocked';
            statusTag.classList.remove('locked');
            visualBox.classList.remove('locked');
            toggleBtn.textContent = 'Lock This Website';
            toggleBtn.className = 'btn-primary w-full py-3';
          }
        });

      } catch (e) {
        domainText.textContent = 'Unsupported URL';
        toggleBtn.disabled = true;
      }
    });
  }

  // Lock Toggle Button Listener
  document.getElementById('btn-toggle-lock').addEventListener('click', () => {
    if (!currentDomain) return;

    if (isCurrentDomainLocked) {
      // Unlock: Require security PIN verification
      openPinConfirmModal(() => {
        chrome.storage.local.get({ lockedDomains: [] }, (result) => {
          const lockedList = result.lockedDomains.filter(d => !isDomainMatched(currentDomain, d));
          chrome.storage.local.set({ lockedDomains: lockedList }, () => {
            SiteLockAudio.playUnlock().catch(() => {});
            // Also revoke tab unlocked status from background script memory
            chrome.runtime.sendMessage({ type: 'lockTabImmediately' });
            detectCurrentTab();
          });
        });
      });
    } else {
      // Lock: Add domain to list directly (no PIN required to lock)
      chrome.storage.local.get({ lockedDomains: [] }, (result) => {
        const lockedList = result.lockedDomains;
        if (!lockedList.includes(currentDomain)) {
          lockedList.push(currentDomain);
        }
        SiteLockAudio.playLock().catch(() => {});
        chrome.storage.local.set({ lockedDomains: lockedList }, () => {
          detectCurrentTab();
        });
      });
    }
  });

  // --- PIN BOXES AUTOFOCUS SYSTEM ---
  function setupPinAutofocus(containerId, onComplete, onIncomplete) {
    const container = document.getElementById(containerId);
    const inputs = container.querySelectorAll('.pin-box');
    
    inputs.forEach((input, index) => {
      input.value = '';
      
      // Enforce only digits during input
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^0-9]/g, '').slice(-1);
        
        if (input.value.length === 1) {
          if (index < inputs.length - 1) {
            inputs[index + 1].disabled = false;
            inputs[index + 1].focus();
          }
        }
        
        const pin = Array.from(inputs).map(i => i.value).join('');
        if (pin.length === 4) {
          if (onComplete) onComplete(pin);
        } else {
          if (onIncomplete) onIncomplete();
        }
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (input.value.length === 0 && index > 0) {
            inputs[index - 1].focus();
            inputs[index - 1].value = '';
            // Auto disable inputs forward to maintain strict linear input
            for (let j = index; j < inputs.length; j++) {
              inputs[j].value = '';
              if (j > 0) inputs[j].disabled = true;
            }
            if (onIncomplete) onIncomplete();
          } else {
            input.value = '';
            if (onIncomplete) onIncomplete();
          }
        }
      });
    });
  }

  function resetPinContainer(containerId) {
    const container = document.getElementById(containerId);
    const inputs = container.querySelectorAll('.pin-box');
    inputs.forEach((input, index) => {
      input.value = '';
      if (index > 0) input.disabled = true;
    });
  }

  // --- SCREEN 1: PIN CREATION ---
  function setupPINCreationFlow() {
    let pin1 = '';
    let generatedRecoveryWords = [];
    const saveBtn = document.getElementById('btn-save-pin');
    const confirmSection = document.getElementById('setup-confirm-section');
    const setupLabel = document.getElementById('setup-label');
    const nextBtn1 = document.getElementById('btn-next-step-1');
    const nextBtn2 = document.getElementById('btn-next-step-2');

    function setActiveStep(stepNumber) {
      document.querySelectorAll('.setup-step-container').forEach(c => c.classList.add('hidden'));
      document.getElementById(`setup-step-${stepNumber}`).classList.remove('hidden');

      // Update dot styles
      for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`dot-step-${i}`);
        if (dot) {
          if (i === stepNumber) {
            dot.style.width = '24px';
            dot.style.background = '#6366f1';
          } else {
            dot.style.width = '8px';
            dot.style.background = 'rgba(0, 0, 0, 0.12)';
          }
        }
      }
    }

    // First setup input
    setupPinAutofocus('setup-pin-container', 
      // Complete
      (val) => {
        pin1 = val;
        confirmSection.classList.remove('hidden');
        setupLabel.textContent = 'PIN Entered';
        // Focus confirm boxes
        resetPinContainer('confirm-pin-container');
        document.getElementById('confirm-1').disabled = false;
        document.getElementById('confirm-1').focus();
      },
      // Incomplete
      () => {
        confirmSection.classList.add('hidden');
        nextBtn1.style.display = 'none';
        setupLabel.textContent = 'Enter 4-digit PIN';
        generatedRecoveryWords = [];
      }
    );

    // Second confirm input
    setupPinAutofocus('confirm-pin-container',
      // Complete
      (val) => {
        if (val === pin1) {
          nextBtn1.style.display = 'block';
          
          if (generatedRecoveryWords.length === 0) {
            generatedRecoveryWords = SiteLockSecurity.generateRecoveryWords();
            const grid = document.getElementById('setup-phrase-grid');
            grid.innerHTML = '';
            generatedRecoveryWords.forEach((word, index) => {
              const badge = document.createElement('div');
              badge.className = 'recovery-word-badge';
              badge.style.cssText = 'background: rgba(0, 0, 0, 0.02); border: 1px solid var(--panel-border); padding: 8px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; text-align: center; display: flex; align-items: center; justify-content: flex-start; gap: 6px; color: var(--text-primary);';
              badge.innerHTML = `<span style="opacity: 0.4; font-size: 10px;">${index + 1}</span> <span>${word}</span>`;
              grid.appendChild(badge);
            });
          }
        } else {
          nextBtn1.style.display = 'none';
          shakeElement(document.getElementById('confirm-pin-container'));
          resetPinContainer('confirm-pin-container');
          document.getElementById('confirm-1').focus();
          SiteLockAudio.playError().catch(() => {});
        }
      },
      // Incomplete
      () => {
        nextBtn1.style.display = 'none';
      }
    );

    // Transition buttons
    nextBtn1.addEventListener('click', () => {
      setActiveStep(2);
      SiteLockAudio.playUnlock().catch(() => {});
    });

    nextBtn2.addEventListener('click', () => {
      setActiveStep(3);
      SiteLockAudio.playUnlock().catch(() => {});
      
      // Select/mark active theme in onboarding grid
      chrome.storage.local.get({ theme: 'light' }, (res) => {
        const activeTheme = res.theme || 'light';
        const setupThemeGridItems = document.querySelectorAll('#setup-theme-grid .theme-grid-item');
        setupThemeGridItems.forEach(btn => {
          if (btn.getAttribute('data-theme') === activeTheme) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      });
      saveBtn.disabled = false;
    });

    // Setup Onboarding Theme Selector listeners
    const setupThemeGridItems = document.querySelectorAll('#setup-theme-grid .theme-grid-item');
    setupThemeGridItems.forEach(item => {
      item.addEventListener('click', () => {
        const selectedTheme = item.getAttribute('data-theme');
        chrome.storage.local.set({ theme: selectedTheme }, () => {
          applyThemeClass(selectedTheme);
          SiteLockAudio.playUnlock().catch(() => {});
          
          setupThemeGridItems.forEach(btn => {
            if (btn.getAttribute('data-theme') === selectedTheme) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
        });
      });
    });

    const copyBtn = document.getElementById('btn-copy-phrase');
    copyBtn.addEventListener('click', () => {
      const textToCopy = generatedRecoveryWords.join(' ');
      navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.textContent = 'Copied!';
        SiteLockAudio.playUnlock().catch(() => {});
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
        }, 1500);
      });
    });

    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      await SiteLockSecurity.setPIN(pin1);
      await SiteLockSecurity.setRecoveryWords(generatedRecoveryWords);
      SiteLockAudio.playUnlock().catch(() => {});
      
      confirmSection.classList.add('hidden');
      generatedRecoveryWords = [];

      // Reset setup screen states back to Step 1 for future runs
      setActiveStep(1);

      showScreen('screen-main');
      await detectCurrentTab();
      setupFocusModeUI();
      setupSettingsUI();
      loadLockedList();
    });
  }

  function shakeElement(el) {
    el.classList.add('shake-element');
    setTimeout(() => el.classList.remove('shake-element'), 500);
  }

  // --- TAB 2: LOCKED DOMAINS LIST ---
  const listSearch = document.getElementById('locked-list-search');
  const domainsList = document.getElementById('locked-domains-list');
  const listEmpty = document.getElementById('locked-list-empty');

  function loadLockedList() {
    chrome.storage.local.get({ lockedDomains: [] }, (result) => {
      const locked = result.lockedDomains;
      renderList(locked);
    });
  }

  function renderList(list) {
    domainsList.innerHTML = '';
    const query = listSearch.value.trim().toLowerCase();
    
    const filtered = list.filter(domain => domain.includes(query));

    if (filtered.length === 0) {
      listEmpty.classList.remove('hidden');
      return;
    }
    listEmpty.classList.add('hidden');

    filtered.forEach(domain => {
      const li = document.createElement('li');
      li.className = 'locked-list-item';
      
      const span = document.createElement('span');
      span.textContent = domain;
      li.appendChild(span);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.title = 'Remove Lock';
      delBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
      
      delBtn.addEventListener('click', () => {
        // Require security PIN verification before removing
        openPinConfirmModal(() => {
          chrome.storage.local.get({ lockedDomains: [] }, (res) => {
            const newList = res.lockedDomains.filter(d => d !== domain);
            chrome.storage.local.set({ lockedDomains: newList }, () => {
              SiteLockAudio.playUnlock().catch(() => {});
              loadLockedList();
              detectCurrentTab();
            });
          });
        });
      });

      li.appendChild(delBtn);
      domainsList.appendChild(li);
    });
  }

  listSearch.addEventListener('input', () => {
    loadLockedList();
  });

  // --- LIST PIN GATE ---
  function showListPinGate() {
    const gate = document.getElementById('list-pin-gate');
    const contentArea = document.getElementById('list-content-area');
    const gateError = document.getElementById('list-gate-error');

    gate.classList.remove('hidden');
    contentArea.classList.add('hidden');
    gateError.classList.add('hidden');

    // Reset PIN inputs
    resetPinContainer('list-gate-pin-container');

    // Setup autofocus for the gate PIN boxes
    setupPinAutofocus('list-gate-pin-container',
      async (pin) => {
        // All 4 digits entered — verify
        const isValid = await SiteLockSecurity.verifyPIN(pin);

        if (isValid) {
          SiteLockAudio.playUnlock().catch(() => {});
          isListUnlocked = true;
          gate.classList.add('hidden');
          contentArea.classList.remove('hidden');
          loadLockedList();
        } else {
          SiteLockAudio.playError().catch(() => {});
          gateError.classList.remove('hidden');
          shakeElement(gate.querySelector('.list-pin-gate-content'));
          resetPinContainer('list-gate-pin-container');
          // Re-focus first input after shake
          setTimeout(() => {
            const first = document.getElementById('list-gate-1');
            if (first) first.focus();
          }, 350);
        }
      },
      () => {} // onIncomplete — nothing needed
    );

    // Focus the first input
    setTimeout(() => {
      const first = document.getElementById('list-gate-1');
      if (first) first.focus();
    }, 50);
  }

  // --- TAB 3: FOCUS MODE ---
  const focusSetupView = document.getElementById('focus-setup-view');
  const focusActiveView = document.getElementById('focus-active-view');
  const focusTimeDisplay = document.getElementById('focus-time-left');

  function setupFocusModeUI() {
    // Duration buttons click
    const durBtns = document.querySelectorAll('.duration-btn');
    durBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        durBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedFocusDuration = parseInt(btn.getAttribute('data-duration'));
      });
    });

    // Start Focus
    document.getElementById('btn-start-focus').addEventListener('click', () => {
      const endTimestamp = Date.now() + selectedFocusDuration * 60 * 1000;
      
      chrome.storage.local.set({
        focusModeEnd: endTimestamp,
        focusModeDuration: selectedFocusDuration * 60 * 1000
      }, () => {
        SiteLockAudio.playLock().catch(() => {});
        startFocusTimer(endTimestamp);
      });
    });

    // Check if Focus Mode already active
    chrome.storage.local.get({ focusModeEnd: 0 }, (res) => {
      if (res.focusModeEnd > Date.now()) {
        startFocusTimer(res.focusModeEnd);
      }
    });

    // Stop Focus click
    document.getElementById('btn-stop-focus').addEventListener('click', () => {
      // Require security PIN modal to stop session
      openPinConfirmModal(() => {
        chrome.storage.local.set({ focusModeEnd: 0 }, () => {
          clearInterval(focusInterval);
          focusInterval = null;
          focusActiveView.classList.add('hidden');
          focusSetupView.classList.remove('hidden');
          SiteLockAudio.playUnlock().catch(() => {});
        });
      });
    });
  }

  function startFocusTimer(endTimestamp) {
    focusSetupView.classList.add('hidden');
    focusActiveView.classList.remove('hidden');

    if (focusInterval) clearInterval(focusInterval);

    const updateDisplay = () => {
      const remaining = endTimestamp - Date.now();
      if (remaining <= 0) {
        clearInterval(focusInterval);
        focusInterval = null;
        focusActiveView.classList.add('hidden');
        focusSetupView.classList.remove('hidden');
        SiteLockAudio.playUnlock().catch(() => {});
        return;
      }

      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      focusTimeDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    updateDisplay();
    focusInterval = setInterval(updateDisplay, 1000);
  }

  // --- TAB 3: SETTINGS CONFIG & PIN CHANGE ---
  const settingAutoLock = document.getElementById('setting-auto-lock');
  const settingVibrate = document.getElementById('setting-vibrate');
  const btnOpenChangePin = document.getElementById('btn-open-change-pin');
  const changePinPanel = document.getElementById('change-pin-panel');
  const btnSubmitChangePin = document.getElementById('btn-submit-change-pin');

  function setupSettingsUI() {
    // Load setting checks
    chrome.storage.local.get({ autoLockOnRefresh: false, vibrateEnabled: true }, (res) => {
      settingAutoLock.checked = res.autoLockOnRefresh;
      settingVibrate.checked = res.vibrateEnabled;
    });

    settingAutoLock.addEventListener('change', () => {
      chrome.storage.local.set({ autoLockOnRefresh: settingAutoLock.checked });
    });

    settingVibrate.addEventListener('change', () => {
      chrome.storage.local.set({ vibrateEnabled: settingVibrate.checked });
    });

    // Theme selector listeners
    const themeGridItems = document.querySelectorAll('.theme-grid-item');

    chrome.storage.local.get({ theme: 'light' }, (res) => {
      applyThemeClass(res.theme || 'light');
    });

    themeGridItems.forEach(item => {
      item.addEventListener('click', () => {
        const selectedTheme = item.getAttribute('data-theme');
        setTheme(selectedTheme);
      });
    });

    function setTheme(themeName) {
      chrome.storage.local.set({ theme: themeName }, () => {
        applyThemeClass(themeName);
        SiteLockAudio.playUnlock().catch(() => {});
      });
    }

    // applyThemeClass is declared in the outer scope

    // Change PIN drawer toggle
    btnOpenChangePin.addEventListener('click', () => {
      if (changePinPanel.classList.contains('hidden')) {
        changePinPanel.classList.remove('hidden');
        btnOpenChangePin.textContent = 'Collapse';
        
        // Reset and focus old inputs
        resetPinContainer('change-old-container');
        resetPinContainer('change-new-container');
        document.getElementById('change-old-1').focus();
        
        setupChangePinFlow();
      } else {
        changePinPanel.classList.add('hidden');
        btnOpenChangePin.textContent = 'Change Passcode PIN';
      }
    });
  }

  function setupChangePinFlow() {
    let oldPinVal = '';
    let newPinVal = '';

    setupPinAutofocus('change-old-container', 
      (val) => {
        oldPinVal = val;
        // Verify old PIN immediately to proceed
        SiteLockSecurity.verifyPIN(val).then(isValid => {
          if (isValid) {
            document.getElementById('change-new-1').disabled = false;
            document.getElementById('change-new-1').focus();
          } else {
            shakeElement(document.getElementById('change-old-container'));
            resetPinContainer('change-old-container');
            document.getElementById('change-old-1').focus();
            SiteLockAudio.playError().catch(() => {});
          }
        });
      },
      () => {
        btnSubmitChangePin.disabled = true;
      }
    );

    setupPinAutofocus('change-new-container',
      (val) => {
        newPinVal = val;
        btnSubmitChangePin.disabled = false;
      },
      () => {
        btnSubmitChangePin.disabled = true;
      }
    );

    // Form submit change
    btnSubmitChangePin.addEventListener('click', async () => {
      if (btnSubmitChangePin.disabled) return;
      
      const isOldValid = await SiteLockSecurity.verifyPIN(oldPinVal);
      if (isOldValid && newPinVal.length === 4) {
        await SiteLockSecurity.setPIN(newPinVal);
        SiteLockAudio.playUnlock().catch(() => {});
        changePinPanel.classList.add('hidden');
        btnOpenChangePin.textContent = 'Change Passcode PIN';
        btnSubmitChangePin.disabled = true;
      } else {
        shakeElement(changePinPanel);
        SiteLockAudio.playError().catch(() => {});
      }
    });
  }

  // --- BACKUP & RESTORE ---
  document.getElementById('btn-export').addEventListener('click', () => {
    // Secure export: requires PIN verification first
    openPinConfirmModal(() => {
      chrome.storage.local.get(null, (allData) => {
        const backupStr = JSON.stringify(allData, null, 2);
        const blob = new Blob([backupStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `sitelock-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  });

  const importTrigger = document.getElementById('btn-import-trigger');
  const importFileEl = document.getElementById('import-file-input');

  importTrigger.addEventListener('click', () => {
    importFileEl.click();
  });

  importFileEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importData = JSON.parse(event.target.result);
        
        // Validation check for SiteLock schema
        if (!importData.pinHash || !importData.pinSalt || !Array.isArray(importData.lockedDomains)) {
          alert('Invalid backup schema. Make sure the JSON backup is authentic.');
          return;
        }

        openPinConfirmModal(() => {
          chrome.storage.local.clear(() => {
            chrome.storage.local.set(importData, () => {
              SiteLockAudio.playUnlock().catch(() => {});
              window.location.reload(); // Reload popup fully
            });
          });
        });

      } catch (err) {
        alert('Failed to parse backup JSON file.');
      }
    };
    reader.readAsText(file);
  });

  // --- SECURITY PIN MODAL CONFIRMATION OVERLAY ---
  const modalOverlay = document.getElementById('pin-confirm-overlay');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalVerify = document.getElementById('btn-modal-verify');
  let modalEnteredPin = '';

  function openPinConfirmModal(onSuccessCallback) {
    pendingModalAction = onSuccessCallback;
    modalOverlay.classList.remove('hidden');
    
    resetPinContainer('modal-pin-container');
    document.getElementById('modal-1').focus();
    btnModalVerify.disabled = true;

    setupPinAutofocus('modal-pin-container', 
      (val) => {
        modalEnteredPin = val;
        btnModalVerify.disabled = false;
      },
      () => {
        btnModalVerify.disabled = true;
      }
    );
  }

  btnModalCancel.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    pendingModalAction = null;
  });

  btnModalVerify.addEventListener('click', async () => {
    const isValid = await SiteLockSecurity.verifyPIN(modalEnteredPin);
    
    if (isValid) {
      modalOverlay.classList.add('hidden');
      if (pendingModalAction) {
        pendingModalAction();
        pendingModalAction = null;
      }
    } else {
      shakeElement(document.getElementById('modal-pin-container'));
      resetPinContainer('modal-pin-container');
      document.getElementById('modal-1').focus();
      btnModalVerify.disabled = true;
      SiteLockAudio.playError().catch(() => {});
    }
  });

  // --- PIN CONFIRMATION MODAL FORGOT PIN HANDLERS ---
  const modalPinDesc = document.getElementById('modal-pin-desc');
  const modalPinContainer = document.getElementById('modal-pin-container');
  const modalPinButtons = document.getElementById('modal-pin-buttons');
  const modalForgotPinWrapper = document.getElementById('link-modal-forgot-pin-wrapper');
  const modalForgotPinLink = document.getElementById('link-modal-forgot-pin');
  
  const modalRecoveryView = document.getElementById('modal-recovery-view');
  const btnRecoveryCancel = document.getElementById('btn-recovery-cancel');
  const btnRecoveryReset = document.getElementById('btn-recovery-reset');

  let recoveryWordsOriginal = [];
  let recoveryWordsScrambled = [];
  let recoveryWordsSelected = [];

  modalForgotPinLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const words = await SiteLockSecurity.getRecoveryWords();
    if (!words || words.length === 0) {
      modalRecoveryView.innerHTML = `<p style="font-size: 12px; text-align: center; color: var(--danger-color); margin-bottom: 12px;">No recovery phrase configured. You must reinstall the extension to reset.</p>`;
      modalRecoveryView.appendChild(btnRecoveryCancel);
    } else {
      recoveryWordsOriginal = words;
      recoveryWordsSelected = [];
      recoveryWordsScrambled = [...words].sort(() => Math.random() - 0.5);
      renderModalRecoveryGrid();
    }
    
    modalPinDesc.classList.add('hidden');
    modalPinContainer.classList.add('hidden');
    modalPinButtons.classList.add('hidden');
    modalForgotPinWrapper.classList.add('hidden');
    modalRecoveryView.classList.remove('hidden');
    document.getElementById('modal-title-text').textContent = 'PIN Recovery';
  });

  function renderModalRecoveryGrid() {
    const selectedSeqContainer = document.getElementById('modal-recovery-selected-seq');
    const wordsGrid = document.getElementById('modal-recovery-words-grid');
    
    if (!selectedSeqContainer || !wordsGrid) return;
    
    selectedSeqContainer.innerHTML = '';
    wordsGrid.innerHTML = '';
    
    // Render selection slots
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'recovery-selected-slot';
      slot.style.cssText = 'min-width: 50px; height: 26px; border-radius: 6px; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; padding: 2px 6px; color: var(--text-primary);';
      
      if (recoveryWordsSelected[i]) {
        slot.textContent = recoveryWordsSelected[i];
        slot.style.border = '1px solid var(--accent-color)';
        slot.style.background = 'rgba(59, 130, 246, 0.05)';
      } else {
        slot.textContent = '';
      }
      selectedSeqContainer.appendChild(slot);
    }
    
    // Render scrambled buttons
    recoveryWordsScrambled.forEach((word) => {
      const btn = document.createElement('button');
      btn.className = 'recovery-word-btn btn-secondary';
      btn.textContent = word;
      btn.style.cssText = 'padding: 6px; font-size: 11px; font-weight: 600; border-radius: 8px; cursor: pointer; text-align: center; border: 1.5px solid var(--panel-border); background: var(--panel-bg); color: var(--text-primary);';
      
      if (recoveryWordsSelected.includes(word)) {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.pointerEvents = 'none';
      }
      
      btn.addEventListener('click', () => {
        SiteLockAudio.playLock().catch(() => {});
        recoveryWordsSelected.push(word);
        renderModalRecoveryGrid();
        
        if (recoveryWordsSelected.length === 8) {
          setTimeout(verifyModalRecoveryOrder, 150);
        }
      });
      
      wordsGrid.appendChild(btn);
    });
  }

  async function verifyModalRecoveryOrder() {
    const isCorrect = await SiteLockSecurity.verifyRecoveryWordsOrder(recoveryWordsSelected);
    if (isCorrect) {
      SiteLockAudio.playUnlock().catch(() => {});
      chrome.storage.local.remove(['pinHash', 'pinSalt', 'recoveryWords'], () => {
        modalOverlay.classList.add('hidden');
        resetModalToPinInput();
        showScreen('screen-setup');
        setupPINCreationFlow();
      });
    } else {
      shakeElement(modalRecoveryView);
      SiteLockAudio.playError().catch(() => {});
      recoveryWordsSelected = [];
      renderModalRecoveryGrid();
    }
  }

  function resetModalToPinInput() {
    modalRecoveryView.classList.add('hidden');
    modalPinDesc.classList.remove('hidden');
    modalPinContainer.classList.remove('hidden');
    modalPinButtons.classList.remove('hidden');
    modalForgotPinWrapper.classList.remove('hidden');
    document.getElementById('modal-title-text').textContent = 'Verify Security PIN';
    resetPinContainer('modal-pin-container');
    document.getElementById('modal-1').focus();
  }

  btnRecoveryCancel.addEventListener('click', () => {
    resetModalToPinInput();
  });

  btnRecoveryReset.addEventListener('click', () => {
    SiteLockAudio.playLock().catch(() => {});
    recoveryWordsSelected = [];
    renderModalRecoveryGrid();
  });

  // Start initialization
  init();
});
