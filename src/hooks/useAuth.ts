import { useEffect, useState } from 'react';
import { auth, rtdb } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { ref, onValue } from 'firebase/database';
import { UserProfile } from '../types';
import { checkRedirectAuth, ensureUserProfile } from '../services/authService';

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
    // Check for any redirect authentication completion on initial mount (mobile browsers)
    checkRedirectAuth().catch(err => {
      console.warn('[useAuth] Redirect auth check notice:', err);
    });

    let userUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // STEP 1: Set auth identity immediately (uid, email)
      setAuthUser(firebaseUser);
      setLoading(false);

      // Clean up previous profile listener if it exists
      if (userUnsubscribe) {
        userUnsubscribe();
        userUnsubscribe = null;
      }

      // STEP 2: Load the profile in the background
      if (firebaseUser) {
        setProfileError(null);
        setProfileLoading(true);
        const userRef = ref(rtdb, `users/${firebaseUser.uid}`);

        // Set up real-time listener for profile updates
        userUnsubscribe = onValue(
          userRef,
          async (snapshot) => {
            if (snapshot.exists()) {
              const userData = snapshot.val() as UserProfile;

              // Ensure uid is always set from Firebase Auth
              const userWithUid: UserProfile = {
                ...userData,
                uid: firebaseUser.uid,
                phone: userData.phone || '',
                profileCompleted: Boolean(userData.phone),
              };

              // Security: Hardcoded check for Super Admin email
              if (
                userWithUid.email?.toLowerCase() ===
                'indiacybercafe.com@gmail.com'
              ) {
                userWithUid.role = 'admin';
              }

              setUser(userWithUid);
              setProfileLoading(false);
            } else {
              // Profile does not exist yet (e.g., first-time Google sign-in)
              // Automatically create the initial user profile
              try {
                const { profile } = await ensureUserProfile(firebaseUser, 'google');
                setUser(profile);
              } catch (createErr: any) {
                console.error('[useAuth] Auto profile creation notice:', createErr);
                // Fallback for Admin email if auto creation encounters issue
                if (
                  firebaseUser.email?.toLowerCase() ===
                  'indiacybercafe.com@gmail.com'
                ) {
                  setUser({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    name: firebaseUser.displayName || 'Super Admin',
                    role: 'admin',
                    phone: '',
                    avatar:
                      firebaseUser.photoURL ||
                      'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                    authProvider: 'google',
                    createdAt: Date.now(),
                  });
                } else {
                  setUser(null);
                }
              }
              setProfileLoading(false);
            }
          },
          (error) => {
            console.error('Profile listener error:', error);
            setProfileError(error);
            setProfileLoading(false);
          }
        );
      } else {
        // Sign-out clears the application profile
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
