import '@testing-library/jest-dom/vitest';

/**
 * Test environment notes:
 *  - `@testing-library/react` cleans up after each test automatically because
 *    `globals: true` gives it an `afterEach` to hook into.
 *  - No test talks to a live server: every `fetch` is stubbed per test.
 *  - jsdom implements neither `ResizeObserver` nor pointer capture, both of which
 *    Radix primitives touch on mount. Minimal, inert shims keep components
 *    renderable without pretending to measure anything.
 */

class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {
    void _callback;
  }

  observe(): void {
    // jsdom has no layout: observing is a no-op.
  }

  unobserve(): void {
    // No-op.
  }

  disconnect(): void {
    // No-op.
  }
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= function scrollIntoViewStub(): void {
    // jsdom does not scroll.
  };
  Element.prototype.hasPointerCapture ??= function hasPointerCaptureStub(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCaptureStub(): void {
    // No pointer capture in jsdom.
  };
  Element.prototype.releasePointerCapture ??= function releasePointerCaptureStub(): void {
    // No pointer capture in jsdom.
  };
}
