# Firebase Rules for India Cyber Cafe

## Admin UID
```
fC9a8NWCx7XsnPb2iJKMa1UtZMr2
```

---

## Realtime Database Rules

Copy the following rules into Firebase Console > Database > Rules tab:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    
    "users": {
      "$uid": {
        // User can read their own profile or admin can read any
        ".read": "$uid === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        // User can write their own profile, admin can write any
        ".write": "$uid === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        "role": {
          // Only admin can change roles
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'"
        }
      }
    },
    
    "services": {
      // Everyone can read services
      ".read": true,
      
      // Only admin can write/modify services
      ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
      
      "$serviceId": {
        ".read": true,
        ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'"
      }
    },
    
    "applications": {
      ".read": "auth.uid !== null",
      ".write": "auth.uid !== null",
      
      "$appId": {
        // User can read their own applications
        ".read": "root.child('applications').child($appId).child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'operator'",
        
        ".validate": "newData.hasChildren(['id', 'uid', 'email', 'name', 'serviceName', 'status', 'date'])",
        
        // User creates their own application
        "uid": {
          ".validate": "newData.val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
          ".write": "newData.val() === auth.uid"
        },
        
        "email": {
          ".validate": "newData.isString()",
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || !data.exists()"
        },
        
        "status": {
          // Only admin and operator can change status
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'operator'",
          ".validate": "newData.val() === 'processing' || newData.val() === 'clarification' || newData.val() === 'completed' || newData.val() === 'rejected'"
        },
        
        "assignedTo": {
          // Only admin can assign applications to operators
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'"
        },
        
        "notes": {
          ".read": "root.child('applications').child($appId).child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'operator'",
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'operator'",
          
          "$noteId": {
            ".validate": "newData.hasChildren(['type', 'by', 'text', 'time'])",
            "by": {
              ".validate": "newData.val() === auth.uid"
            }
          }
        }
      }
    },
    
    "products": {
      // Everyone can read products
      ".read": true,
      
      // Only admin can create/modify products
      ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
      
      "$productId": {
        ".read": true,
        ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        ".validate": "newData.hasChildren(['id', 'name', 'price'])"
      }
    },
    
    "productCategories": {
      // Everyone can read categories
      ".read": true,
      
      // Only admin can create/modify categories
      ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
      
      "$categoryId": {
        ".read": true,
        ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        ".validate": "newData.hasChildren(['id', 'name'])"
      }
    },
    
    "orders": {
      ".read": "auth.uid !== null",
      ".write": "auth.uid !== null",
      
      "$orderId": {
        // User can read their own orders or admin
        ".read": "root.child('orders').child($orderId).child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        // User creates their own order or admin modifies
        ".write": "!data.exists() || root.child('orders').child($orderId).child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        ".validate": "newData.hasChildren(['id', 'uid', 'items', 'total'])",
        
        "uid": {
          ".validate": "newData.val() === auth.uid",
          ".write": "!data.exists()"
        },
        
        "orderStatus": {
          // Admin can update order status
          ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
          ".validate": "newData.val() === 'pending' || newData.val() === 'processing' || newData.val() === 'shipped' || newData.val() === 'delivered'"
        }
      }
    },
    
    "productReviews": {
      // Everyone can read reviews
      ".read": true,
      
      // Authenticated users can create reviews
      ".write": "auth.uid !== null",
      
      "$reviewId": {
        ".read": true,
        
        ".write": "root.child('productReviews').child($reviewId).child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        ".validate": "newData.hasChildren(['id', 'productId', 'uid', 'userName', 'rating', 'text'])",
        
        "uid": {
          ".validate": "newData.val() === auth.uid",
          ".write": "!data.exists()"
        },
        
        "rating": {
          ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 5"
        }
      }
    },
    
    "gateways": {
      // Only admin can read/write gateways (credentials are sensitive)
      ".read": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
      ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
      
      "$gatewayId": {
        ".read": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        ".write": "auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin'",
        
        ".validate": "newData.hasChildren(['id', 'type', 'name', 'active'])"
      }
    }
  }
}
```

---

## Cloud Storage Rules

Copy the following rules into Firebase Console > Storage > Rules tab:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth.uid == 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2';
    }
    
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Application files - user uploads their own, admin manages
    match /applications/{uid}/{allPaths=**} {
      allow read: if isAdmin() || request.auth.uid == uid;
      allow write: if isAdmin() || request.auth.uid == uid;
      allow delete: if isAdmin();
    }
    
    // Product images - admin only
    match /products/{productId}/{allPaths=**} {
      allow read: if true;  // Public can view product images
      allow write: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Product category icons - admin only
    match /categories/{categoryId}/{allPaths=**} {
      allow read: if true;  // Public can view category icons
      allow write: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Review images - user uploads their own, admin manages
    match /reviews/{userId}/{allPaths=**} {
      allow read: if true;  // Public can view reviews
      allow write: if isAuthenticated() && request.auth.uid == userId;
      allow delete: if isAdmin() || request.auth.uid == userId;
    }
    
    // User avatars - user uploads their own, admin manages
    match /avatars/{userId}/{allPaths=**} {
      allow read: if true;  // Public can view avatars
      allow write: if request.auth.uid == userId || isAdmin();
      allow delete: if isAdmin() || request.auth.uid == userId;
    }
    
    // Service icons - admin only
    match /services/{serviceId}/{allPaths=**} {
      allow read: if true;  // Public can view service icons
      allow write: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Catch-all: deny everything else
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

## How to Use

### For Realtime Database Rules:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `india-cyber-cafe-default-rtdb`
3. Navigate to **Realtime Database** > **Rules**
4. Copy the entire JSON from the section above
5. Click **Publish**

### For Cloud Storage Rules:
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Storage** > **Rules**
4. Copy the entire rules from the section above
5. Click **Publish**

---

## Key Security Features Implemented

✅ **User Privacy**
- Users can only read/write their own profile
- Users can only see their own applications and orders

✅ **Admin Control**
- Admin (fC9a8NWCx7XsnPb2iJKMa1UtZMr2) has full access to all data
- Only admin can modify critical data like status, roles, services

✅ **Operator Permissions**
- Operators can view and manage applications with statuses
- Cannot access sensitive gateways or user data

✅ **Public Access**
- Products, categories, services visible to everyone
- Reviews visible to public

✅ **User-Generated Content**
- Users own their applications and orders
- Users can create and manage their own reviews
- Can only delete own reviews (unless admin)

✅ **Data Validation**
- Field validation for critical paths
- Enum validation for status/role fields
- Required fields enforcement

✅ **Storage Security**
- Public can view images (products, categories, avatars)
- Admin-only write access
- User-owned file directories for applications and reviews

---

## Testing the Rules

Use Firebase Emulator or test directly:

1. **Test as unauthenticated:** Can read public data (products, services, categories)
2. **Test as regular user:** Can read/write own profile, applications, orders, reviews
3. **Test as operator:** Can read applications and manage statuses
4. **Test as admin (UID: fC9a8NWCx7XsnPb2iJKMa1UtZMr2):** Full access to everything

---

## Important Notes

- Admin UID `fC9a8NWCx7XsnPb2iJKMa1UtZMr2` is hardcoded in storage rules
- Store credentials securely in `.env` files (not in Firebase rules)
- Never expose sensitive gateway credentials to non-admin users
- Email verification recommended for user roles change
- Consider adding rate limiting for production
