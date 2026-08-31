/**
 * Console Error Handler Utility
 * Suppresses non-critical errors from third-party libraries while keeping important errors visible
 */

const SUPPRESS_PATTERNS = [
  /Firebase/i,
  /Razorpay/i,
  /google-analytics/i,
  /You provided a `value` prop to a form field/,
  /react-dom\.development\.js/,
  /Warning: Non-interactive elements should not be assigned mouse/,
  /Warning: Each child in a list should have a unique/,
  /ReactDOM\.render is no longer supported/,
  /Warning: useLayoutEffect does nothing on the server/,
  /Can't perform a React state update on an unmounted component/,
];

/**
 * Initialize console error handling
 * Filters out non-critical errors from third-party libraries
 */
export const initializeConsoleHandler = () => {
  const originalError = console.error;
  const originalWarn = console.warn;

  // Handle console.error
  console.error = (...args: any[]) => {
    const message = args[0]?.toString?.() || '';
    
    // Check if error should be suppressed
    const shouldSuppress = SUPPRESS_PATTERNS.some(pattern => pattern.test(message));
    
    if (!shouldSuppress) {
      originalError.apply(console, args);
    }
  };

  // Handle console.warn
  console.warn = (...args: any[]) => {
    const message = args[0]?.toString?.() || '';
    
    // Check if warning should be suppressed
    const shouldSuppress = SUPPRESS_PATTERNS.some(pattern => pattern.test(message));
    
    if (!shouldSuppress) {
      originalWarn.apply(console, args);
    }
  };

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.toString?.() || '';
    
    // Suppress non-critical rejections from third-party services
    if (SUPPRESS_PATTERNS.some(pattern => pattern.test(message))) {
      event.preventDefault();
    }
  });
};

/**
 * Create a safe console logger for debugging
 */
export const safeLog = (message: string, data?: any) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[ICC] ${message}`, data || '');
  }
};

/**
 * Create a safe console error logger for actual errors
 */
export const safeError = (message: string, error?: any) => {
  const originalError = console.error;
  originalError.apply(console, [`[ICC Error] ${message}`, error || '']);
};
