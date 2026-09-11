import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/**
 * App-wide keyboard inset tracking.
 *
 * Capacitor is configured with Keyboard.resize = "none", so iOS slides the
 * keyboard OVER the webview instead of shrinking it. Nothing in the layout
 * knows the bottom of the screen just became unusable, which is how input
 * fields end up hidden underneath the keyboard.
 *
 * Because the webview is never resized, visualViewport stays at full height on
 * native and cannot see the overlap at all — there, the Capacitor Keyboard
 * plugin's keyboardWillShow/Hide events are the only source of the height.
 * visualViewport remains the fallback for the plain web build.
 *
 * This module is the single source of truth for that overlap:
 *   - exposes it as the `--kb` CSS variable for layout/CSS use
 *   - exposes it to React via useKeyboardOverlap()
 *   - reveals the focused field in scrollable content, since the OS no
 *     longer does it for us
 *
 * Call initKeyboardInsets() once at app startup.
 */

let overlap = 0;
const listeners = new Set();

const setOverlap = (next) => {
  if (next === overlap) return;
  overlap = next;
  document.documentElement.style.setProperty('--kb', `${next}px`);
  listeners.forEach((fn) => fn());
};

// The nearest ancestor that can actually scroll, so we move the panel the
// field lives in rather than the document, which never moves under `resize:
// "none"`.
const scrollParentOf = (el) => {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
};

// Bring the focused field above the keyboard once it has settled.
//
// This used to be scrollIntoView({ block: 'nearest' }), which does nothing
// here: with Keyboard.resize = "none" the webview is never shrunk, so as far
// as the browser is concerned the strip under the keyboard is still on
// screen and a field sitting in it needs no scrolling at all. The overlap has
// to be subtracted by hand.
const revealFocused = () => {
  const el = document.activeElement;
  if (!el) return;
  const editable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  if (!editable) return;

  const gap = 16;                                   // breathing room above the keys
  const usableBottom = window.innerHeight - overlap - gap;
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= usableBottom && rect.top >= gap) return;   // already clear

  const delta = rect.bottom - usableBottom;
  const scroller = scrollParentOf(el);
  if (scroller) {
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  } else {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
};

export function initKeyboardInsets() {
  document.documentElement.style.setProperty('--kb', '0px');
  document.documentElement.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom)');
  document.documentElement.style.setProperty('--modal-pb', '24px');
  document.documentElement.style.setProperty('--chat-pb', '12px');

  const setOpenState = () => {
    document.documentElement.style.setProperty('--safe-area-bottom', '0px');
    document.documentElement.style.setProperty('--modal-pb', '8px');
    document.documentElement.style.setProperty('--chat-pb', '8px');
  };

  const setClosedState = () => {
    document.documentElement.style.setProperty('--safe-area-bottom', 'env(safe-area-inset-bottom)');
    document.documentElement.style.setProperty('--modal-pb', '24px');
    document.documentElement.style.setProperty('--chat-pb', '12px');
  };

  if (Capacitor.isNativePlatform()) {
    document.documentElement.style.setProperty('--vv-height', `${window.innerHeight}px`);
    // `willShow` fires as the keyboard starts animating in, so the composer
    // travels with it rather than snapping up once it has landed.
    Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
      setOverlap(Math.round(keyboardHeight));
      document.documentElement.style.setProperty('--vv-height', `${window.innerHeight - keyboardHeight}px`);
      setOpenState();
      setTimeout(revealFocused, 120);
    });
    Keyboard.addListener('keyboardWillHide', () => {
      setOverlap(0);
      document.documentElement.style.setProperty('--vv-height', `${window.innerHeight}px`);
      setClosedState();
    });
    // Moving from one field to the next while the keyboard is already up
    // fires no willShow of its own, so the second field would stay buried.
    document.addEventListener('focusin', () => {
      if (overlap > 0) setTimeout(revealFocused, 120);
    });
    return;
  }

  const vv = window.visualViewport;
  if (!vv) return;

  const sync = () => {
    document.documentElement.style.setProperty('--vv-height', `${vv.height}px`);
    if (window.screen.height - vv.height > 150) {
      setOpenState();
    } else {
      setClosedState();
    }
    setOverlap(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    if (overlap > 0) setTimeout(revealFocused, 120);
  };

  document.documentElement.style.setProperty('--vv-height', `${vv.height}px`);
  if (window.screen.height - vv.height > 150) setOpenState(); else setClosedState();

  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);

  // Focus can land on a field while the keyboard is already up (tabbing
  // between inputs), which fires no viewport resize of its own.
  document.addEventListener('focusin', () => {
    if (overlap > 0) setTimeout(revealFocused, 120);
  });

  sync();
}

/** Pixels of the viewport currently covered by the keyboard (0 when closed). */
export function useKeyboardOverlap() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => overlap,
    () => 0
  );
}
