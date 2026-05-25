/**
 * SiteLock Audio Synthesizer
 * Uses the Web Audio API to dynamically generate premium lock, unlock, and error sounds.
 * No external media file requests required, ensuring maximum reliability and security.
 */

const SiteLockAudio = {
  ctx: null,

  /**
   * Initializes the AudioContext if not already created.
   * Resumes if suspended by browser autoplay policies.
   */
  initContext() {
    if (!this.ctx) {
      // Support standard and prefixed AudioContext
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  /**
   * Checks if sound effects are enabled in user storage.
   * @returns {Promise<boolean>}
   */
  async isEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ soundsEnabled: true }, (result) => {
        resolve(result.soundsEnabled);
      });
    });
  },

  /**
   * Plays a crisp double-click mechanical padlock sound or a retro click.
   */
  async playLock() {
    if (!(await this.isEnabled())) return;
    this.initContext();
    if (!this.ctx) return;

    const theme = await this.getTheme();
    const t = this.ctx.currentTime;
    
    if (theme === 'light') {
      // Crisp digital click
      this.playTone(t, 1100, 0.04, 'sine', 0.15);
    } else if (theme === 'ocean') {
      // Fluid triangle pop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(450, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    } else if (theme === 'forest') {
      // Woodblock tap
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(680, t);
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.05);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    } else if (theme === 'sunset') {
      // Retro square sweep
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1000, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.07);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } else if (theme === 'mono') {
      // Dry mechanical keyboard keypress click
      this.playTick(t, 450, 0.02);
      this.playTick(t + 0.02, 350, 0.025);
    } else {
      // Dark Modern default: mechanical padlock click
      this.playTick(t, 850, 0.025);
      this.playTick(t + 0.04, 700, 0.035);
    }
  },

  /**
   * Plays a premium, uplifting arpeggio chime when successfully unlocked.
   */
  async playUnlock() {
    if (!(await this.isEnabled())) return;
    this.initContext();
    if (!this.ctx) return;

    const theme = await this.getTheme();
    const t = this.ctx.currentTime;
    
    if (theme === 'light') {
      // Bright rising digital chirp
      const notes = [880.00, 1174.66, 1567.98];
      notes.forEach((freq, index) => {
        this.playTone(t + index * 0.04, freq, 0.12, 'sine', 0.1);
      });
    } else if (theme === 'ocean') {
      // Ocean wave wet chimes
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, index) => {
        this.playTone(t + index * 0.06, freq, 0.28, 'triangle', 0.08);
        this.playTone(t + index * 0.06 + 0.03, freq * 1.5, 0.18, 'sine', 0.04);
      });
    } else if (theme === 'forest') {
      // Wooden chimes: E5, A5, C#6
      const notes = [659.25, 880.00, 1109.73];
      notes.forEach((freq, index) => {
        this.playTone(t + index * 0.07, freq, 0.2, 'sine', 0.15);
      });
    } else if (theme === 'sunset') {
      // Warm square retro chiptune arpeggio
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, index) => {
        this.playTone(t + index * 0.06, freq, 0.18, 'square', 0.06);
      });
    } else if (theme === 'mono') {
      // Industrial keyboard chime
      this.playTone(t, 600, 0.08, 'triangle', 0.12);
      this.playTone(t + 0.05, 800, 0.08, 'triangle', 0.12);
    } else {
      // Dark Modern default: ascending chord chimes
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, index) => {
        this.playTone(t + index * 0.05, freq, 0.22, 'sine', 0.12);
      });
    }
  },

  /**
   * Plays a dual low-buzz frequency when validation fails.
   */
  async playError() {
    if (!(await this.isEnabled())) return;
    this.initContext();
    if (!this.ctx) return;

    const theme = await this.getTheme();
    const t = this.ctx.currentTime;
    
    if (theme === 'light') {
      // Digital double beep
      this.playTone(t, 880, 0.06, 'sine', 0.15);
      this.playTone(t + 0.08, 880, 0.06, 'sine', 0.15);
    } else if (theme === 'ocean') {
      // Low bubble gurgle
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, t);
      osc.frequency.linearRampToValueAtTime(30, t + 0.25);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    } else if (theme === 'forest') {
      // Muted organic tap error
      this.playTone(t, 180, 0.15, 'triangle', 0.18);
      this.playTone(t + 0.1, 140, 0.15, 'triangle', 0.18);
    } else if (theme === 'sunset') {
      // Retro 8-bit arcade buzzer
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(80, t + 0.24);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.linearRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    } else if (theme === 'mono') {
      // Industrial keyboard key clicks error
      this.playTone(t, 120, 0.1, 'sawtooth', 0.15);
      this.playTone(t + 0.12, 120, 0.1, 'sawtooth', 0.15);
    } else {
      // Dark Modern default: play two low buzzes
      this.playTone(t, 130, 0.12, 'triangle', 0.2);
      this.playTone(t + 0.15, 130, 0.12, 'triangle', 0.2);
    }
  },

  /**
   * Helper to retrieve active theme
   */
  async getTheme() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ theme: 'dark' }, (result) => {
        resolve(result.theme || 'dark');
      });
    });
  },

  /**
   * Synthesizes a fast mechanical decay tick.
   */
  playTick(time, frequency, duration) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, time);
    // Fast frequency sweep down
    osc.frequency.exponentialRampToValueAtTime(100, time + duration);
    
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(time);
    osc.stop(time + duration);
  },

  /**
   * Synthesizes a clean tone at a given frequency, start time, and duration.
   */
  playTone(time, frequency, duration, type = 'sine', maxVolume = 0.15) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    
    // Smoother envelope
    gain.gain.setValueAtTime(maxVolume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(time);
    osc.stop(time + duration);
  }
};
