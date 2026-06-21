import { useState, useEffect } from 'react';

/**
 * Hook to manage loading state with minimum display duration
 * Prevents skeleton loaders from flashing too quickly on fast connections
 * 
 * @param isLoading - The actual loading state from data fetching
 * @param minDuration - Minimum duration to show loading state (in ms), default 1000ms
 * @returns Object with displayLoading state and helper methods
 */
export function useLoadingState(isLoading: boolean, minDuration: number = 1000) {
  const [displayLoading, setDisplayLoading] = useState(isLoading);
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      // Starting to load
      setLoadingStartTime(Date.now());
      setDisplayLoading(true);
    } else if (loadingStartTime !== null) {
      // Loading finished
      const elapsedTime = Date.now() - loadingStartTime;
      const remainingTime = Math.max(0, minDuration - elapsedTime);

      if (remainingTime > 0) {
        // Still need to show skeleton for a bit longer
        const timer = setTimeout(() => {
          setDisplayLoading(false);
        }, remainingTime);
        return () => clearTimeout(timer);
      } else {
        // Enough time has passed, hide skeleton immediately
        setDisplayLoading(false);
      }
    }
  }, [isLoading, loadingStartTime, minDuration]);

  return displayLoading;
}
