/**
 * SiteLock Service Worker
 * Handles extension lifecycle events, tracks tab-specific unlocked states,
 * and manages Focus Mode timers.
 */

// Memory storage for tab-specific unlock states: tabId -> { domain: string, timestamp: number }
const unlockedTabs = {};

// Match domain helper
function isDomainMatched(hostname, lockedDomain) {
  const normHostname = hostname.replace(/^www\./, '').toLowerCase();
  const normLocked = lockedDomain.replace(/^www\./, '').toLowerCase();
  
  if (normHostname === normLocked) return true;
  if (normHostname.endsWith('.' + normLocked)) return true;
  return false;
}

// Track tab updates to enforce auto-lock and domain change policies
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const url = new URL(tab.url);
      const domain = url.hostname.replace(/^www\./, '').toLowerCase();
      const state = unlockedTabs[tabId];
      
      if (state) {
        // 1. If the tab has navigated to a different domain, revoke unlock status
        if (!isDomainMatched(domain, state.domain)) {
          delete unlockedTabs[tabId];
        } 
        // 2. If it's the same domain but auto-lock on refresh is enabled, revoke on reload
        else {
          // If the unlock happened extremely recently (within 2 seconds), this is the programmatic reload
          // triggered by content.js after a successful PIN entry. We must NOT relock the tab.
          const isProgrammaticReload = (Date.now() - state.timestamp) < 2000;
          
          if (!isProgrammaticReload) {
            chrome.storage.local.get({ autoLockOnRefresh: false }, (result) => {
              if (result.autoLockOnRefresh) {
                delete unlockedTabs[tabId];
                // Notify the content script that it should lock again
                chrome.tabs.sendMessage(tabId, { type: 'enforceRelock' }).catch(() => {
                  // Content script might not be loaded yet, which is fine
                });
              }
            });
          }
        }
      }
    } catch (e) {
      // Ignore non-http/https URLs (e.g. chrome://, about:blank)
    }
  }
});

// Clean up memory when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete unlockedTabs[tabId];
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.type === 'checkLockState') {
    const domain = message.domain;
    
    // Fetch settings and locked list
    chrome.storage.local.get({ lockedDomains: [], focusModeEnd: 0 }, (result) => {
      const isLocked = result.lockedDomains.some(d => isDomainMatched(domain, d));
      
      // Check Focus Mode status
      const now = Date.now();
      const focusModeActive = result.focusModeEnd > now;
      const focusRemainingTime = focusModeActive ? result.focusModeEnd - now : 0;
      
      // Check if this specific tab is unlocked for this domain
      let isTabUnlocked = false;
      if (tabId && unlockedTabs[tabId]) {
        const state = unlockedTabs[tabId];
        if (isDomainMatched(domain, state.domain)) {
          isTabUnlocked = true;
        }
      }
      
      sendResponse({
        locked: isLocked,
        unlocked: isTabUnlocked,
        focusModeActive: focusModeActive,
        focusRemainingTime: focusRemainingTime
      });
    });
    return true; // Keeps channel open for async sendResponse
  }
  
  if (message.type === 'setTabUnlocked') {
    if (tabId && message.domain) {
      unlockedTabs[tabId] = {
        domain: message.domain.toLowerCase(),
        timestamp: Date.now()
      };
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No active tab or domain specified' });
    }
  }
  
  if (message.type === 'lockTabImmediately') {
    if (tabId) {
      delete unlockedTabs[tabId];
      sendResponse({ success: true });
    }
  }
});
