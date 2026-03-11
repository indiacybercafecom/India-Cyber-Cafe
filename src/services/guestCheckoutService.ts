import { rtdb } from '../firebase';
import { ref as dbRef, query, equalTo, orderByChild, get } from 'firebase/database';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

/**
 * Generate a random password
 * @param length - Length of password (default 6)
 * @returns Random password with mix of letters and numbers
 */
export function generateRandomPassword(length: number = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Find user by email in database
 */
export async function findUserByEmail(email: string) {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    console.log('🔎 Searching for email in database:', normalizedEmail);
    
    const usersRef = dbRef(rtdb, 'users');
    const snapshot = await get(usersRef);
    
    if (!snapshot.exists()) {
      console.log('❌ No users found in database');
      return null;
    }
    
    const users = snapshot.val() as Record<string, any>;
    console.log('📋 Total users in database:', Object.keys(users).length);
    
    for (const [uid, userData] of Object.entries(users)) {
      const userEmail = userData.email ? userData.email.toLowerCase().trim() : '';
      console.log('🔍 Comparing:', userEmail, '===', normalizedEmail, '→', userEmail === normalizedEmail);
      
      if (userEmail === normalizedEmail) {
        console.log('✅ Found matching user:', uid);
        return { uid, ...userData };
      }
    }
    
    console.log('❌ No matching user found');
    return null;
  } catch (error) {
    console.error('❌ Error finding user by email:', error);
    return null;
  }
}

/**
 * Find user by phone in database
 */
export async function findUserByPhone(phone: string) {
  try {
    const normalizedPhone = phone.replace(/\D/g, ''); // Remove all non-digits
    console.log('🔎 Searching for phone in database:', normalizedPhone);
    
    const usersRef = dbRef(rtdb, 'users');
    const snapshot = await get(usersRef);
    
    if (!snapshot.exists()) {
      console.log('❌ No users found in database');
      return null;
    }
    
    const users = snapshot.val() as Record<string, any>;
    console.log('📋 Total users in database:', Object.keys(users).length);
    
    for (const [uid, userData] of Object.entries(users)) {
      const userPhone = userData.phone ? userData.phone.replace(/\D/g, '') : '';
      console.log('🔍 Comparing:', userPhone, '===', normalizedPhone, '→', userPhone === normalizedPhone);
      
      if (userPhone === normalizedPhone) {
        console.log('✅ Found matching user:', uid);
        return { uid, ...userData };
      }
    }
    
    console.log('❌ No matching user found');
    return null;
  } catch (error) {
    console.error('❌ Error finding user by phone:', error);
    return null;
  }
}

/**
 * Create guest user account during checkout
 */
export async function createGuestAccount(
  email: string,
  name: string,
  phone: string
): Promise<{ success: boolean; user?: any; password?: string; error?: string }> {
  try {
    // Generate random password
    const randomPassword = generateRandomPassword(6);
    
    // Create Firebase auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, randomPassword);
    const user = userCredential.user;
    
    // Update profile with name
    await updateProfile(user, { displayName: name });
    
    // Create user document in database
    const userRef = dbRef(rtdb, `users/${user.uid}`);
    const newUser = {
      uid: user.uid,
      email: email,
      name: name,
      phone: phone,
      role: 'user',
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isGuestCheckout: true // Mark as created from guest checkout
    };
    
    // Save to database
    const { set } = await import('firebase/database');
    await set(userRef, newUser);
    
    return {
      success: true,
      user: { ...newUser, password: randomPassword },
      password: randomPassword
    };
  } catch (error: any) {
    console.error('Error creating guest account:', error);
    return {
      success: false,
      error: error.message || 'Failed to create account'
    };
  }
}
