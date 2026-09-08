import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === '/forms-documents') {
      window.scrollTo({ top: 0, behavior: 'auto' as ScrollBehavior });
      return;
    }

    if (pathname.startsWith('/forms-documents/')) {
      return;
    }

    window.scrollTo({ top: 0, behavior: 'auto' as ScrollBehavior });
  }, [pathname]);

  return null;
}
