import { useEffect, useState } from 'react';
import { auth, rtdb } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ref, onValue } from 'firebase/database';
import { UserProfile } from '../types';

/**
 * Hook that separates auth identity from profile data
 * Returns:
 * - authUser: Firebase Auth identity (uid, email) - available immediately
 * - user: Full profile data - loads separately in background
 * - loading: authUser loading status (profile loading is separate)
 *
 * This prevents Home from being blocked while waiting for user profile
 */
export function useAuth() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<Error | null>(null);

  useEffect(() => {
    let userUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // STEP 1: Set auth identity immediately (uid, email)
      // This completes auth loading, allowing Home to render
      setAuthUser(firebaseUser);
      setLoading(false);

      // Clean up previous profile listener if it exists
      if (userUnsubscribe) {
        userUnsubscribe();
        userUnsubscribe = null;
      }

      // STEP 2: Always load the profile separately in the background.
      if (firebaseUser) {
        setProfileError(null);
        setProfileLoading(true);
        const userRef = ref(rtdb, `users/${firebaseUser.uid}`);

        // Use onValue for real-time profile updates (fixes race condition during registration)
        userUnsubscribe = onValue(
          userRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const userData = snapshot.val() as UserProfile;

              // Ensure uid is always set from Firebase Auth
              const userWithUid: UserProfile = {
                ...userData,
                uid: firebaseUser.uid,
              };

              // Security: Hardcoded check for Super Admin email
              if (
                userWithUid.email?.toLowerCase() ===
                'indiacybercafe.com@gmail.com'
              ) {
                userWithUid.role = 'admin';
              }

              setUser(userWithUid);
            } else {
              // Fallback for Admin email if profile doesn't exist yet
              if (
                firebaseUser.email?.toLowerCase() ===
                'indiacybercafe.com@gmail.com'
              ) {
                setUser({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  name: 'Super Admin',
                  role: 'admin',
                  avatar:
                    'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                  createdAt: Date.now(),
                });
              } else {
                setUser(null);
              }
            }
            setProfileLoading(false);
          },
          (error) => {
            console.error('Profile listener error:', error);
            setProfileError(error);
            setProfileLoading(false);
          }
        );
      } else {
        // Only a real Firebase sign-out clears the application profile.
        setUser(null);
        setProfileError(null);
        setProfileLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      if (userUnsubscribe) userUnsubscribe();
    };
  }, []);

  return { user, authUser, loading, profileLoading, profileError };
}
