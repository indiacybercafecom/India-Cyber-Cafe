import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'dotlottie-wc': Record<string, unknown>;
    }
  }
}