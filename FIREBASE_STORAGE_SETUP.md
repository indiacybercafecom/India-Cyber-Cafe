# Firebase Storage Setup Guide

## Overview
This guide explains how to set up Firebase Storage with proper authentication and security rules for the India Cyber Cafe project.

## Prerequisites
- Firebase project already created
- Node.js installed
- Access to Firebase Console

## Step 1: Install Dependencies

Run the following command to install firebase-admin:

```bash
npm install
```

This will install all dependencies including the newly added `firebase-admin` package.

## Step 2: Get Firebase Service Account Key

### 2a. Go to Firebase Console
1. Visit [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **India Cyber Cafe**
3. Click ⚙️ (Settings) → **Project Settings**

### 2b. Create Service Account
1. Go to **Service Accounts** tab
2. Click **Generate New Private Key** button
3. A JSON file will download (save it safely)

### 2c. Add to Project
1. Rename the downloaded file to `firebase-service-account.json`
2. Place it in your project root directory (same folder as `package.json`)
3. **⚠️ IMPORTANT**: Add to `.gitignore` to prevent accidental upload:

```
# Add this line to .gitignore
firebase-service-account.json
```

## Step 3: Update Environment Variables

### 3a. Update .env file
```bash
FIREBASE_SERVICE_ACCOUNT_KEY=./firebase-service-account.json
```

## Step 4: Update Firebase Storage Rules

### 4a. Go to Storage Rules
1. Firebase Console → **Storage** → **Rules** tab
2. Replace existing rules with the content from [FIREBASE_STORAGE_RULES.md](./FIREBASE_STORAGE_RULES.md)

### 4b. Publish Rules
Click the **Publish** button to apply the rules.

## Step 5: Test the Upload Functionality

### Run the development server:
```bash
npm run dev
```

### Test upload in your app:
- Navigate to the upload section
- Try uploading an image
- Check if it works without errors

### Monitor logs:
Watch the terminal for upload confirmation:
```
[Upload] Starting upload: products/1234567890-abc123.jpg
[Upload] ✅ File uploaded successfully to products/1234567890-abc123.jpg
```

## File Structure

```
project-root/
├── firebase-service-account.json  ← Keep this secret!
├── .env                           ← Add FIREBASE_SERVICE_ACCOUNT_KEY here
├── .gitignore                     ← Add firebase-service-account.json
├── server.ts                      ← Updated with Admin SDK
├── FIREBASE_STORAGE_RULES.md      ← Storage rules documentation
└── FIREBASE_STORAGE_SETUP.md      ← This file
```

## Security Rules Summary

| Folder | Read | Write | Notes |
|--------|------|-------|-------|
| `applications/` | 🔐 User | 🔐 User | Private user data |
| `avatars/` | 🌐 Public | 🔐 User | User profiles |
| `custom-images/` | 🌐 Public | ✅ Server | Admin uploads only |
| `notes/` | 🔐 User | 🔐 User | Private user notes |
| `order-notes/` | 🔐 User | 🔐 User | Private order notes |
| `products/` | 🌐 Public | ✅ Server | Server uploads only |
| `reviews/` | 🌐 Public | ✅ Server | Server uploads only |

## How Upload Works

```
User selects file
        ↓
Frontend sends to /api/upload
        ↓
Server receives file
        ↓
Server validates (size, type, etc)
        ↓
Server uses Firebase Admin SDK to upload
        ↓
Admin SDK has special permissions to bypass rules
        ↓
File stored in Firebase Storage
        ↓
Server returns public URL to frontend
        ↓
Frontend displays image
```

## Troubleshooting

### Error: "FIREBASE_SERVICE_ACCOUNT_KEY not found"
✅ **Solution**: Place `firebase-service-account.json` in project root with correct path in `.env`

### Error: "Firebase Admin not initialized"
✅ **Solution**: Check `.env` file has correct path and file exists

### Error: "Permission denied" (403)
✅ **Solution**: Check Firebase Storage Rules are published correctly

### Upload succeeds but image not displaying
✅ **Solution**: Check if file was made public (check "public" folders in rules)

### Service account not working
✅ **Solution**: 
1. Go to Firebase Console → IAM & Admin
2. Ensure service account has "Storage Admin" or "Storage Object Creator" role
3. Regenerate key if needed

## Common Issues & Fixes

### Issue: Files uploading but not visible
```
Check Firebase Rules - "custom-images", "products", "reviews" 
should have allow read: if true;
```

### Issue: User files not accessible
```
Check that userId is properly matching in rules
Make sure authentication is working in your app
```

### Issue: Large files failing
```
Check MAX_FILE_SIZE in uploadService.ts (currently 5MB)
Firebase limit is 5GB, but you can adjust as needed
```

## Production Deployment

### Before deploying to production:
1. ✅ Test all upload scenarios locally
2. ✅ Ensure service account key is NOT in git
3. ✅ Set environment variable in hosting platform
4. ✅ Test uploads on production domain
5. ✅ Monitor Firebase logs for errors

### Environment variable in production:
- **Vercel**: Add to Project Settings → Environment Variables
- **Google Cloud**: Set in App Engine environment variables
- **Docker**: Set in docker-compose.yml or deployment config

## Next Steps

1. ✅ Place `firebase-service-account.json` in project root
2. ✅ Update `.env` with service account path
3. ✅ Update Firebase Storage Rules
4. ✅ Run `npm install` to add firebase-admin
5. ✅ Test upload functionality
6. ✅ Deploy to production

## References

- [Firebase Admin SDK Documentation](https://firebase.google.com/docs/database/admin/start)
- [Firebase Storage Rules Guide](https://firebase.google.com/docs/storage/security)
- [Service Account Documentation](https://firebase.google.com/docs/admin/setup)
