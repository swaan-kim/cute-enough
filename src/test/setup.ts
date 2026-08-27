import '@testing-library/jest-dom/vitest';

Object.assign(window, {
  __appsInTossConstants: {
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
