/** Randomise an integer between min and max (inclusive). */
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface AutoScrollStatus {
  running: boolean;
  userPaused: boolean;
  tweetsCollected: number;
}

type StatusListener = (status: AutoScrollStatus) => void;

const SCROLL_ACTIVE_MS = 8_000;  // scroll for 8 seconds
const SCROLL_BREAK_MS  = 2_000;  // then pause for 2 seconds

export class AutoScroller {
  private running = false;
  private userPaused = false;
  private interactionPaused = false;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private breakTimer: ReturnType<typeof setTimeout> | null = null;
  private cycleStartedAt = 0;   // when the current 8-second active window began
  private onBreak = false;
  private tweetsCollected = 0;
  private readonly listeners = new Set<StatusListener>();

  constructor() {
    this.setupInteractionListeners();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.userPaused = false;
    this.onBreak = false;
    this.tweetsCollected = 0;
    this.cycleStartedAt = Date.now();
    this.scheduleNext();
    this.notify();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.notify();
  }

  toggleUserPause(): void {
    if (!this.running) return;
    this.userPaused = !this.userPaused;
    if (!this.userPaused && !this.interactionPaused && !this.onBreak) {
      this.cycleStartedAt = Date.now();
      this.scheduleNext();
    } else {
      if (this.scrollTimer) { clearTimeout(this.scrollTimer); this.scrollTimer = null; }
    }
    this.notify();
  }

  /** Called by the content script each time a new tweet lands in the sidebar. */
  incrementCollected(): void {
    if (!this.running) return;
    this.tweetsCollected++;
    this.notify();
  }

  getStatus(): AutoScrollStatus {
    return {
      running: this.running,
      userPaused: this.userPaused,
      tweetsCollected: this.tweetsCollected,
    };
  }

  subscribe(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private clearTimers(): void {
    if (this.scrollTimer) { clearTimeout(this.scrollTimer); this.scrollTimer = null; }
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
    if (this.breakTimer)  { clearTimeout(this.breakTimer);  this.breakTimer  = null; }
  }

  private scheduleNext(): void {
    if (!this.running || this.userPaused || this.interactionPaused || this.onBreak) return;

    // If 8 seconds of active scrolling have elapsed, take a 2-second break.
    if (Date.now() - this.cycleStartedAt >= SCROLL_ACTIVE_MS) {
      this.startBreak();
      return;
    }

    // Fast cadence: scroll every 200–500 ms
    this.scrollTimer = setTimeout(() => this.doScroll(), rand(200, 500));
  }

  private startBreak(): void {
    this.onBreak = true;
    this.breakTimer = setTimeout(() => {
      this.breakTimer = null;
      this.onBreak = false;
      this.cycleStartedAt = Date.now();
      if (this.running && !this.userPaused && !this.interactionPaused) {
        this.scheduleNext();
      }
    }, SCROLL_BREAK_MS);
  }

  private doScroll(): void {
    this.scrollTimer = null;
    if (!this.running || this.userPaused || this.interactionPaused || this.onBreak) return;

    // ~8% chance of a tiny back-scroll before continuing (mimics eye tracking)
    if (Math.random() < 0.08) {
      window.scrollBy({ top: -rand(10, 30), behavior: 'smooth' });
      this.scrollTimer = setTimeout(() => this.scrollDown(), rand(150, 350));
    } else {
      this.scrollDown();
    }
  }

  private scrollDown(): void {
    this.scrollTimer = null;
    if (!this.running || this.userPaused || this.interactionPaused || this.onBreak) return;
    window.scrollBy({ top: rand(50, 100), behavior: 'smooth' });
    this.scheduleNext();
  }

  private setupInteractionListeners(): void {
    // Any genuine user interaction pauses scrolling; we resume after a quiet period.
    const onInteraction = (): void => {
      if (!this.running) return;

      if (!this.interactionPaused) {
        this.interactionPaused = true;
        // Stop the next scheduled scroll — we'll re-schedule after quiet period.
        if (this.scrollTimer) { clearTimeout(this.scrollTimer); this.scrollTimer = null; }
      }

      // Reset the resume countdown on every new interaction event (debounce).
      if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        this.interactionPaused = false;
        if (this.running && !this.userPaused) {
          this.cycleStartedAt = Date.now(); // fresh 8-second window after user stops interacting
          this.scheduleNext();
        }
      }, rand(2_000, 4_000));
    };

    // Passive listeners so we never block scroll performance.
    // Note: we intentionally omit 'scroll' — our own scrollBy() would trigger it.
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener('mousemove', onInteraction, opts);
    window.addEventListener('click', onInteraction, opts);
    window.addEventListener('keydown', onInteraction, opts);
    window.addEventListener('wheel', onInteraction, opts);
    window.addEventListener('touchstart', onInteraction, opts);

    // Pause when the tab is hidden; resume (with delay) when it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.running) {
          this.interactionPaused = true;
          if (this.scrollTimer) { clearTimeout(this.scrollTimer); this.scrollTimer = null; }
        }
      } else {
        if (this.running && !this.userPaused) {
          setTimeout(() => {
            this.interactionPaused = false;
            if (this.running && !this.userPaused) this.scheduleNext();
          }, rand(1_500, 3_000));
        }
      }
    });
  }

  private notify(): void {
    const status = this.getStatus();
    for (const fn of this.listeners) fn(status);
  }
}

/** Singleton used across content script modules. */
export const autoScroller = new AutoScroller();
