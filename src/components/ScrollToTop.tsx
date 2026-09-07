import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === '/forms-documents' || pathname.startsWith('/forms-documents/')) {
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
