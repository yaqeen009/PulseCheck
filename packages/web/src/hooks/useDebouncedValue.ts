import * as React from 'react';

/**
 * Debounced copy of a value.
 *
 * The monitors table sends its search term to the API; debouncing keeps one
 * keystroke from becoming one request.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
