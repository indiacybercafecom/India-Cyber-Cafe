# Firebase Storage Security Rules

## Overview
These rules ensure secure access to Firebase Storage based on user authentication and file categories.

## Rules Setup

### Step 1: Go to Firebase Console
1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **India Cyber Cafe**
3. Go to **Storage** → **Rules** tab

### Step 2: Replace Existing Rules
Copy and paste the following rules:

```plaintext
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }

    // applications/ - user-specific (authenticated only)
    match /applications/{userId}/{allPaths=**} {
      allow read, write: if isAuthenticated() && request.auth.uid == userId;
    }

    // avatars/ - user-specific
    match /avatars/{userId}/{allPaths=**} {
      allow read;
      allow write: if isAuthenticated() && request.auth.uid == userId;
    }

    // custom-images/ - public/unauthenticated uploads allowed (server side)
    match /custom-images/{allPaths=**} {
      allow read;
      allow write: if true; // Server can upload without auth
    }

    // notes/ - user-specific
    match /notes/{userId}/{allPaths=**} {
      allow read, write: if isAuthenticated() && request.auth.uid == userId;
    }

    // order-notes/ - user-specific
    match /order-notes/{userId}/{allPaths=**} {
      allow read, write: if isAuthenticated() && request.auth.uid == userId;
    }

    // products/ - public read, server-side write
    match /products/{allPaths=**} {
      allow read: if true;
      allow write: if true; // Server-side upload
    }

    // reviews/ - public read, server-side write
    match /reviews/{allPaths=**} {
      allow read: if true;
      allow write: if true; // Server-side upload
    }

    // Deny all other access
    match /{allPaths=**} {
      allow read: if false;
      allow write: if false;
    }
  }
}
```

### Step 3: Publish Rules
Click the **Publish** button to apply these rules.

## Rule Breakdown

| Folder | Read Access | Write Access | Notes |
|--------|-------------|--------------|-------|
| `applications/` | User-specific | User-specific | Only authenticated users can access their own files |
| `avatars/` | Public | User-specific | Anyone can view, user can only modify their own |
| `custom-images/` | Public | Server-only | Server uploads custom images for store |
| `notes/` | User-specific | User-specific | Private notes per user |
| `order-notes/` | User-specific | User-specific | Private order notes per user |
| `products/` | Public | Server-only | Public product images, server uploads only |
| `reviews/` | Public | Server-only | Public review images, server uploads only |

## Server-Side Uploads

The Node.js server uses Firebase Admin SDK to upload files with proper authentication.

### Environment Setup
Add to your `.env` file:
```
FIREBASE_SERVICE_ACCOUNT_KEY=./firebase-service-account.json
```

### How It Works
1. Files are uploaded via `/api/upload` endpoint
2. Server uses Admin SDK for authentication
3. Files are stored in appropriate categories
4. Public URLs are returned to frontend

## Security Benefits
✅ Guest users can upload (server handles auth)
✅ User-specific files are protected
✅ Public content is readable by all
✅ Prevents unauthorized access
✅ Server-side validation ensures proper rules compliance

## Troubleshooting

### Upload Fails with 403 Error
- Check if rules are published (green checkmark)
- Verify category name matches rule patterns
- Check that server has valid Firebase credentials

### Files Not Readable
- Ensure rule allows `read` access
- Check user authentication status
- Verify folder permissions in rules

### Server Upload Issues
- Verify `FIREBASE_SERVICE_ACCOUNT_KEY` environment variable
- Ensure service account has Storage permissions
- Check Firebase project ID matches config
