import {
  isPlaceholderAvatar,
  isGooglePhotoUrl,
  isCustomAvatar,
  shouldSyncGooglePhoto,
  resolveAvatarUrl,
  extractAuthPhotoUrl,
  getEmailAvatarUrl,
  DEFAULT_AVATAR
} from '../src/utils/avatar';

function runAvatarTests() {
  console.log('🧪 Starting Profile Photo Synchronization & Recovery Tests...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // --- Scenario 1: Newly registered Google user ---
  const googlePhoto1 = 'https://lh3.googleusercontent.com/a/ACg8ocL_new_user_photo=s96-c';
  const resolvedNew = resolveAvatarUrl(null, { photoURL: googlePhoto1 });
  assert(resolvedNew === googlePhoto1, 'Scenario 1: Newly registered Google user resolves Google photoURL');

  // --- Scenario 2: Photo only available in providerData (Google provider) ---
  const userWithProviderDataOnly = {
    photoURL: null,
    providerData: [
      { providerId: 'google.com', photoURL: googlePhoto1 }
    ]
  };
  const extractedFromProvider = extractAuthPhotoUrl(userWithProviderDataOnly);
  assert(extractedFromProvider === googlePhoto1, 'Scenario 2: Correctly extracts photoURL from providerData when root is null');
  const resolvedFromProvider = resolveAvatarUrl(null, userWithProviderDataOnly);
  assert(resolvedFromProvider === googlePhoto1, 'Scenario 2: resolveAvatarUrl resolves photo from providerData');

  // --- Scenario 3: Existing Google user whose avatar field is empty ---
  const existingEmpty = { avatar: '', authProvider: 'google' as const };
  const shouldSyncEmpty = shouldSyncGooglePhoto(existingEmpty.avatar, googlePhoto1, false);
  const resolvedEmpty = resolveAvatarUrl(existingEmpty, { photoURL: googlePhoto1 });
  assert(shouldSyncEmpty === true, 'Scenario 3: Existing user with empty avatar triggers auto-sync');
  assert(resolvedEmpty === googlePhoto1, 'Scenario 3: Existing user with empty avatar resolves to Google photoURL');

  // --- Scenario 4: Existing Google user whose avatar contains a default placeholder ---
  const flaticonPlaceholder = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  const dicebearPlaceholder = 'https://api.dicebear.com/7.x/avataaars/svg?seed=placeholder';
  assert(isPlaceholderAvatar(flaticonPlaceholder), 'Scenario 4: Correctly identifies flaticon default placeholder');
  assert(isPlaceholderAvatar(dicebearPlaceholder), 'Scenario 4: Correctly identifies dicebear placeholder');
  
  const existingPlaceholderUser = { avatar: flaticonPlaceholder, authProvider: 'google' as const };
  const shouldSyncPlaceholder = shouldSyncGooglePhoto(existingPlaceholderUser.avatar, googlePhoto1, false);
  const resolvedPlaceholder = resolveAvatarUrl(existingPlaceholderUser, { photoURL: googlePhoto1 });
  assert(shouldSyncPlaceholder === true, 'Scenario 4: Placeholder avatar is replaced by Google photo on sync check');
  assert(resolvedPlaceholder === googlePhoto1, 'Scenario 4: Priority ignores placeholder and resolves to Google photoURL');

  // --- Scenario 5: Existing Google user whose avatar contains an outdated URL ---
  const oldGooglePhoto = 'https://lh3.googleusercontent.com/a/ACg8ocL_OLD_PHOTO=s96-c';
  const updatedGooglePhoto = 'https://lh3.googleusercontent.com/a/ACg8ocL_NEW_PHOTO=s96-c';
  const existingOutdatedUser = { avatar: oldGooglePhoto, authProvider: 'google' as const };
  const shouldSyncOutdated = shouldSyncGooglePhoto(existingOutdatedUser.avatar, updatedGooglePhoto, false);
  const resolvedOutdated = resolveAvatarUrl(existingOutdatedUser, { photoURL: updatedGooglePhoto });
  assert(shouldSyncOutdated === true, 'Scenario 5: Outdated Google URL triggers sync update');
  assert(resolvedOutdated === updatedGooglePhoto, 'Scenario 5: Resolves to latest Google photoURL');

  // --- Scenario 6: User with a manually uploaded profile photo ---
  const customUploadUrl = 'https://firebasestorage.googleapis.com/v0/b/project/o/avatars%2Fcustom123.jpg';
  const userWithCustomPhoto = {
    avatar: customUploadUrl,
    customAvatar: true,
    authProvider: 'google' as const
  };
  assert(isCustomAvatar(userWithCustomPhoto), 'Scenario 6: Identifies user with customAvatar: true');
  const shouldSyncCustom = shouldSyncGooglePhoto(userWithCustomPhoto.avatar, googlePhoto1, true);
  const resolvedCustom = resolveAvatarUrl(userWithCustomPhoto, { photoURL: googlePhoto1 });
  assert(shouldSyncCustom === false, 'Scenario 6: NEVER overwrites manually uploaded custom photo with Google photo');
  assert(resolvedCustom === customUploadUrl, 'Scenario 6: Priority 1 returns custom uploaded photo over Google photo');

  // --- Scenario 7: Email-based photo fallback for Google / WordPress / Gravatar user ---
  const email = 'sureshvaishya321@gmail.com';
  const emailAvatar = getEmailAvatarUrl(email);
  assert(Boolean(emailAvatar && emailAvatar.includes('9c6da2bd434362f38ef9380f35e68c7e')), 'Scenario 7: Generates verified MD5 Gravatar URL for sureshvaishya321@gmail.com');
  const userWithEmailOnly = { avatar: flaticonPlaceholder, email: email };
  const resolvedEmail = resolveAvatarUrl(userWithEmailOnly, null);
  assert(resolvedEmail === emailAvatar, 'Scenario 7: Automatically resolves email profile photo when photoURL is null');

  // --- Scenario 8: Fallback to default avatar when no photo or email is available ---
  const userEmptyAll = { avatar: '', email: '' };
  const resolvedFallback = resolveAvatarUrl(userEmptyAll, null);
  assert(resolvedFallback === DEFAULT_AVATAR, 'Scenario 8: Resolves to clean default avatar when everything is empty');

  // --- Scenario 9: Same Google photo already synced (No unnecessary writes) ---
  const alreadySyncedUser = { avatar: googlePhoto1, authProvider: 'google' as const };
  const shouldSyncIdentical = shouldSyncGooglePhoto(alreadySyncedUser.avatar, googlePhoto1, false);
  assert(shouldSyncIdentical === false, 'Scenario 9: Does NOT trigger redundant database write if photo is already identical');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} / ${total} tests passed.`);
  console.log(`========================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runAvatarTests();
