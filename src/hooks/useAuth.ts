import { useEffect, useState } from 'react';
import { auth, rtdb } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, off } from 'firebase/database';
import { UserProfile } from '../types';

export function useAuth() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let userUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // Clean up previous user listener if it exists
      if (userUnsubscribe) {
        userUnsubscribe();
        userUnsubscribe = null;
      }

      if (firebaseUser) {
        const userRef = ref(rtdb, `users/${firebaseUser.uid}`);
        
        // Use onValue for real-time profile updates (fixes race condition during registration)
        userUnsubscribe = onValue(userRef, (snapshot) => {
          if (snapshot.exists()) {
            const userData = snapshot.val() as UserProfile;
            
            // Security: Hardcoded check for Super Admin email
            if (userData.email?.toLowerCase() === 'indiacybercafe.com@gmail.com') {
              userData.role = 'admin';
            }
            
            setUser(userData);
            setLoading(false);
          } else {
            // Fallback for Admin email if profile doesn't exist yet
            if (firebaseUser.email?.toLowerCase() === 'indiacybercafe.com@gmail.com') {
              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                name: 'Super Admin',
                role: 'admin',
                avatar: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
                createdAt: Date.now()
              });
            } else {
              setUser(null);
            }
            setLoading(false);
          }
        }, (error) => {
          console.error("Profile listener error:", error);
          setLoading(false);
        });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      if (userUnsubscribe) userUnsubscribe();
    };
  }, []);

  return { user, loading };
}
