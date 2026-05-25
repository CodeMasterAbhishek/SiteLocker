/**
 * SiteLock Security Module
 * Handles secure PIN hashing using SHA-256 and Web Crypto API.
 * PINs are salted to protect against rainbow table attacks.
 */

const SiteLockSecurity = {
  /**
   * Generates a secure, cryptographically random salt.
   * @returns {string} Hexadecimal salt string.
   */
  generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Hashes a PIN combined with a salt using SHA-256.
   * @param {string} pin - The 4-digit PIN to hash.
   * @param {string} salt - The unique salt.
   * @returns {Promise<string>} Hexadecimal SHA-256 hash.
   */
  async hashPIN(pin, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Retrieves the existing salt from storage, or creates and saves a new one.
   * @returns {Promise<string>} Hexadecimal salt string.
   */
  async getOrInitializeSalt() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pinSalt'], async (result) => {
        if (result.pinSalt) {
          resolve(result.pinSalt);
        } else {
          const newSalt = SiteLockSecurity.generateSalt();
          chrome.storage.local.set({ pinSalt: newSalt }, () => {
            resolve(newSalt);
          });
        }
      });
    });
  },

  /**
   * Hashes and saves a new PIN to storage.
   * @param {string} pin - The 4-digit PIN to set.
   * @returns {Promise<void>}
   */
  async setPIN(pin) {
    const salt = await SiteLockSecurity.getOrInitializeSalt();
    const hash = await SiteLockSecurity.hashPIN(pin, salt);
    return new Promise((resolve) => {
      chrome.storage.local.set({ pinHash: hash }, () => {
        resolve();
      });
    });
  },

  /**
   * Verifies an entered PIN against the stored hash.
   * @param {string} pin - The entered PIN.
   * @returns {Promise<boolean>} True if correct, false otherwise.
   */
  async verifyPIN(pin) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pinHash', 'pinSalt'], async (result) => {
        if (!result.pinHash || !result.pinSalt) {
          resolve(false);
          return;
        }
        const hash = await SiteLockSecurity.hashPIN(pin, result.pinSalt);
        resolve(hash === result.pinHash);
      });
    });
  },

  /**
   * Checks if a PIN has been set.
   * @returns {Promise<boolean>} True if set, false otherwise.
   */
  async isPinSet() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['pinHash'], (result) => {
        resolve(!!result.pinHash);
      });
    });
  },

  // Word pool containing simple, distinct words
  RECOVERY_WORD_POOL: [
    "amber", "beacon", "citrus", "desert", "echo", "forest", "glacier", "harbor",
    "island", "jungle", "kingdom", "lunar", "meadow", "nomad", "ocean", "pebble",
    "quartz", "river", "safari", "timber", "summit", "canyon", "valley", "vortex",
    "wild", "aurora", "oasis", "zenith", "galaxy", "nebula", "cosmos", "horizon",
    "breeze", "shadow", "fossil", "ripple", "bamboo", "canvas", "sketch", "copper",
    "bronze", "marble", "granite", "velvet", "feather"
  ],

  /**
   * Generates a list of 8 unique random recovery words.
   * @returns {string[]} An array of 8 words.
   */
  generateRecoveryWords() {
    const words = [];
    const pool = [...this.RECOVERY_WORD_POOL];
    for (let i = 0; i < 8; i++) {
      const index = Math.floor(Math.random() * pool.length);
      words.push(pool.splice(index, 1)[0]);
    }
    return words;
  },

  /**
   * Saves the generated recovery words array to storage.
   * @param {string[]} words - Array of 8 words.
   * @returns {Promise<void>}
   */
  async setRecoveryWords(words) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ recoveryWords: words }, () => {
        resolve();
      });
    });
  },

  /**
   * Retrieves the stored recovery words.
   * @returns {Promise<string[]|null>} Array of 8 words, or null if not configured.
   */
  async getRecoveryWords() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['recoveryWords'], (result) => {
        resolve(result.recoveryWords || null);
      });
    });
  },

  /**
   * Verifies if the entered words match the stored order exactly.
   * @param {string[]} enteredWords - The entered words order.
   * @returns {Promise<boolean>}
   */
  async verifyRecoveryWordsOrder(enteredWords) {
    const storedWords = await this.getRecoveryWords();
    if (!storedWords || !enteredWords) return false;
    if (storedWords.length !== enteredWords.length) return false;
    for (let i = 0; i < storedWords.length; i++) {
      if (storedWords[i] !== enteredWords[i]) return false;
    }
    return true;
  }
};
