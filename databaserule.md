{
  "rules": {

    ".read": false,
    ".write": false,

    "users": {
      ".read": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

      "$uid": {
        ".read": "auth != null && ($uid === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

        ".write": "auth != null && ($uid === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

        "role": {
          ".write": "auth != null && auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2'"
        }
      }
    },

    "services": {
      ".read": true,
      ".write": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')"
    },

    "applications": {
      ".read": "auth != null",
      ".write": "auth != null",

      "$appId": {
        ".read": "auth != null && (data.child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin' || root.child('users').child(auth.uid).child('role').val() === 'operator')",

        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')"
      }
    },

    "products": {
      ".read": true,
      ".write": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')"
    },

    "productCategories": {
      ".read": true,
      ".write": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')"
    },

    "documentCategories": {
      ".read": true,
      ".write": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

      "$categoryId": {
        ".validate": "newData.hasChildren(['id', 'name']) && newData.child('id').isString() && newData.child('id').val() === $categoryId && newData.child('name').isString() && newData.child('name').val().length >= 1 && newData.child('name').val().length <= 100 && (!newData.hasChild('description') || newData.child('description').isString()) && (!newData.hasChild('icon') || newData.child('icon').isString()) && (!newData.hasChild('order') || newData.child('order').isNumber())"
      }
    },

    "documents": {
      ".read": "(auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')) || (query.orderByChild === 'active' && query.equalTo === true)",
      ".write": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

      "$documentId": {
        ".validate": "newData.hasChildren(['id', 'name', 'description', 'category', 'previewUrl', 'downloadUrl', 'fileType', 'active']) && newData.child('id').isString() && newData.child('id').val() === $documentId && newData.child('name').isString() && newData.child('name').val().length >= 1 && newData.child('name').val().length <= 200 && newData.child('description').isString() && newData.child('description').val().length <= 1000 && newData.child('category').isString() && newData.child('category').val().length >= 1 && newData.child('category').val().length <= 100 && newData.child('previewUrl').isString() && newData.child('previewUrl').val().matches(/^https:\\/\\/(drive\\.google\\.com|[A-Za-z0-9.-]+)(\\/.*)?$/) && newData.child('downloadUrl').isString() && newData.child('downloadUrl').val().matches(/^https:\\/\\/(drive\\.google\\.com|[A-Za-z0-9.-]+)(\\/.*)?$/) && newData.child('fileType').val() === 'PDF' && newData.child('active').isBoolean() && (!newData.hasChild('thumbnailUrl') || (newData.child('thumbnailUrl').isString() && (newData.child('thumbnailUrl').val() === '' || newData.child('thumbnailUrl').val().matches(/^https:\\/\\/[A-Za-z0-9.-]+(\\/.*)?$/)))) && (!newData.hasChild('createdAt') || newData.child('createdAt').isString()) && (!newData.hasChild('updatedAt') || newData.child('updatedAt').isString())"
      }
    },

    "orders": {
      ".read": "true",
      ".write": "true"

  
    },

    "payments": {
      ".read": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

      "$paymentKey": {
        ".write": "!data.exists() && newData.exists()",
        ".validate": "newData.hasChildren(['id', 'amount', 'currency', 'paymentId', 'orderId', 'status', 'type', 'createdAt']) && newData.child('id').isString() && newData.child('id').val().matches(/^[A-Z0-9]{6}$/) && newData.child('amount').isNumber() && newData.child('amount').val() >= 1 && newData.child('amount').val() <= 100000 && newData.child('currency').val() === 'INR' && newData.child('paymentId').isString() && newData.child('paymentId').val().matches(/^pay_[A-Za-z0-9]+$/) && newData.child('orderId').isString() && newData.child('orderId').val().matches(/^order_[A-Za-z0-9]+$/) && newData.child('status').val() === 'completed' && newData.child('type').val() === 'direct_payment' && newData.child('createdAt').isString()"
      }
    },

    "productReviews": {
      ".read": true,
      ".write": "auth != null",

      "$reviewId": {
        ".read": true,

        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')"
      }
    },

    "gateways": {
      ".read": "auth != null && (auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2' || root.child('users').child(auth.uid).child('role').val() === 'admin')",

      ".write": "auth != null && auth.uid === 'fC9a8NWCx7XsnPb2iJKMa1UtZMr2'"
    }
  }
}