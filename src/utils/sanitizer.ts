/**
 * Global Input Sanitization Utility
 * 
 * Provides comprehensive sanitization for all user inputs across the application:
 * - Trims leading/trailing whitespace from strings (preserves internal spaces)
 * - Sanitizes object keys to prevent invalid characters
 * - Maps display labels to internal field names
 * - Handles nested objects and arrays
 * 
 * Use before: saving, validating, submitting, or sending ANY form data to:
 * - Database writes
 * - Payment gateways (Razorpay)
 * - APIs
 * - Email services
 */

/**
 * Invalid characters that can never be used in database/object keys
 * These characters from display labels will be stripped to create valid keys
 */
const INVALID_KEY_CHARACTERS = /[\/\.#$\[\]]/g;

/**
 * Trim leading and trailing whitespace from a string while preserving internal spaces
 * Examples:
 * "  hello world  " → "hello world"
 * "Ramesh  Kumar Sahu " → "Ramesh  Kumar Sahu"
 * "  " → ""
 */
export function trimWhitespace(value: string): string {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
}

/**
 * Sanitize a string to be used as an object key
 * Removes invalid characters that could cause issues in database/object keys
 * 
 * Examples:
 * "User.Name" → "UserName"
 * "Category/Type" → "CategoryType"
 * "Field[0]" → "Field0"
 * "Price.Amount$USD" → "PriceAmountUSD"
 */
export function sanitizeKey(label: string): string {
  if (typeof label !== 'string') {
    return String(label);
  }
  // Remove invalid characters and convert to camelCase format
  return label.replace(INVALID_KEY_CHARACTERS, '').trim();
}

/**
 * Create a mapping from display label to internal field name
 * This ensures the internal key is always used, never the display label
 * 
 * Example:
 * { label: "First Name", internalName: "firstName" }
 * → Uses "firstName" as the key, never "First Name"
 */
export interface FieldNameMapping {
  label: string;
  internalName?: string;
}

/**
 * Sanitize a single form field value
 * Handles strings (trim), booleans, numbers, and null/undefined
 */
export function sanitizeFieldValue(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  
  if (typeof value === 'string') {
    return trimWhitespace(value);
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  
  // For complex types, return as-is (arrays, objects handled separately)
  return value;
}

/**
 * Sanitize a form data object
 * 
 * Trims all string values and ensures keys are valid
 * 
 * Example:
 * {
 *   name: "  John Doe  ",
 *   email: "john@example.com  ",
 *   phone: "1234567890"
 * }
 * →
 * {
 *   name: "John Doe",
 *   email: "john@example.com",
 *   phone: "1234567890"
 * }
 */
export function sanitizeFormData(
  data: Record<string, any>,
  fieldMappings?: Record<string, string>
): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [originalKey, value] of Object.entries(data)) {
    // Use internal field name from mapping if available, otherwise use sanitized key
    const key = fieldMappings?.[originalKey] || sanitizeKey(originalKey);
    
    // Skip invalid keys
    if (!key) {
      console.warn(`Skipping invalid key: ${originalKey}`);
      continue;
    }

    sanitized[key] = sanitizeFieldValue(value);
  }

  return sanitized;
}

/**
 * Sanitize an array of objects (e.g., order items, application details)
 */
export function sanitizeArrayOfObjects(
  data: any[],
  fieldMappings?: Record<string, string>
): any[] {
  return data.map(item => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      return sanitizeFormData(item, fieldMappings);
    }
    return sanitizeFieldValue(item);
  });
}

/**
 * Deep sanitize a nested object structure (handles nested objects and arrays)
 * 
 * Example:
 * {
 *   user: { name: "  John  ", email: "john@test.com  " },
 *   addresses: [
 *     { line1: "  123 Main St  ", city: "  NYC  " }
 *   ]
 * }
 * →
 * {
 *   user: { name: "John", email: "john@test.com" },
 *   addresses: [
 *     { line1: "123 Main St", city: "NYC" }
 *   ]
 * }
 */
export function deepSanitize(
  data: any,
  fieldMappings?: Record<string, string>,
  depth: number = 0,
  maxDepth: number = 10
): any {
  // Prevent infinite recursion
  if (depth > maxDepth) {
    console.warn(`Maximum sanitization depth (${maxDepth}) exceeded`);
    return data;
  }

  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitives
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return sanitizeFieldValue(data);
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => deepSanitize(item, fieldMappings, depth + 1, maxDepth));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    
    for (const [originalKey, value] of Object.entries(data)) {
      // Use internal field name from mapping if available
      const key = fieldMappings?.[originalKey] || sanitizeKey(originalKey);
      
      if (!key) {
        console.warn(`Skipping invalid key: ${originalKey}`);
        continue;
      }

      sanitized[key] = deepSanitize(value, fieldMappings, depth + 1, maxDepth);
    }
    
    return sanitized;
  }

  return data;
}

/**
 * Sanitize address object with specific field handling
 * Ensures all address fields are properly trimmed
 */
export function sanitizeAddress(address: any): any {
  if (!address || typeof address !== 'object') {
    return address;
  }

  const addressKeys = [
    'name', 'email', 'phone', 'addressLine1', 'addressLine2',
    'city', 'state', 'pincode', 'country'
  ];

  const sanitized: Record<string, any> = {};
  
  for (const key of addressKeys) {
    if (key in address) {
      const value = address[key];
      sanitized[key] = sanitizeFieldValue(value);
    }
  }

  // Include any additional properties not in the standard list
  for (const key of Object.keys(address)) {
    if (!addressKeys.includes(key)) {
      sanitized[key] = sanitizeFieldValue(address[key]);
    }
  }

  return sanitized;
}

/**
 * Sanitize application details object
 * Ensures all application field values are properly trimmed
 * Preserves the structure for database compatibility
 */
export function sanitizeApplicationDetails(details: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(details)) {
    // Keep key as-is (should already be internal name from field mapping)
    // Only sanitize the value
    if (Array.isArray(value)) {
      sanitized[key] = sanitizeArrayOfObjects(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = deepSanitize(value);
    } else {
      sanitized[key] = sanitizeFieldValue(value);
    }
  }
  
  return sanitized;
}

/**
 * Sanitize order items
 */
export function sanitizeOrderItems(items: any[]): any[] {
  return items.map(item => ({
    ...item,
    productName: sanitizeFieldValue(item.productName),
    specialInstructions: sanitizeFieldValue(item.specialInstructions),
  }));
}

/**
 * Sanitize user profile data
 */
export function sanitizeUserProfile(profile: any): any {
  if (!profile) return profile;

  const sanitized: Record<string, any> = {};
  const profileKeys = ['uid', 'name', 'email', 'phone', 'password', 'role', 'avatar', 'address', 'createdAt'];
  
  for (const key of profileKeys) {
    if (key in profile) {
      const value = profile[key];
      if (key === 'address' && typeof value === 'object') {
        sanitized[key] = sanitizeAddress(value);
      } else {
        sanitized[key] = sanitizeFieldValue(value);
      }
    }
  }

  return sanitized;
}

/**
 * Validate and sanitize email
 * Trims whitespace and converts to lowercase (standard for emails)
 */
export function sanitizeEmail(email: string): string {
  const trimmed = trimWhitespace(email);
  return trimmed.toLowerCase();
}

/**
 * Validate and sanitize phone number
 * Removes leading/trailing whitespace
 * Optionally removes non-digit characters
 */
export function sanitizePhone(phone: string, removeNonDigits: boolean = false): string {
  let sanitized = trimWhitespace(phone);
  if (removeNonDigits) {
    sanitized = sanitized.replace(/\D/g, '');
  }
  return sanitized;
}

/**
 * Create field name mappings from an array of service fields
 * This ensures display labels are never used as object keys
 * 
 * Example:
 * Service fields:
 * [
 *   { label: "First Name", type: "text" },
 *   { label: "Last Name", type: "text" }
 * ]
 * → Mappings:
 * {
 *   "First Name": "firstName",
 *   "Last Name": "lastName"
 * }
 */
export function createFieldNameMappings(
  fields: Array<{ label: string; type?: string; internalName?: string }>
): Record<string, string> {
  const mappings: Record<string, string> = {};
  
  for (const field of fields) {
    if (field.internalName) {
      // Use explicit internal name if provided
      mappings[field.label] = field.internalName;
    } else {
      // Generate internal name from label by removing invalid characters
      const internalName = sanitizeKey(field.label)
        .replace(/\s+/g, '') // Remove spaces
        .replace(/^./, str => str.toLowerCase()); // Lowercase first letter
      
      mappings[field.label] = internalName;
    }
  }
  
  return mappings;
}

/**
 * Apply field name mappings to form data
 * Converts display field names to internal field names
 * 
 * Example:
 * Input: { "First Name": "John", "Last Name": "Doe" }
 * Mappings: { "First Name": "firstName", "Last Name": "lastName" }
 * Output: { firstName: "John", lastName: "Doe" }
 */
export function applyFieldNameMappings(
  formData: Record<string, any>,
  mappings: Record<string, string>
): Record<string, any> {
  const mapped: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(formData)) {
    const internalName = mappings[key] || sanitizeKey(key);
    
    if (!internalName) {
      console.warn(`Unable to map field: ${key}`);
      continue;
    }
    
    mapped[internalName] = value;
  }
  
  return mapped;
}

/**
 * Comprehensive sanitization pipeline for all user inputs
 * This is the main function to call before database/API operations
 * 
 * Steps:
 * 1. Deep sanitize all values (trim strings)
 * 2. Apply field name mappings (display labels → internal names)
 * 3. Ensure no invalid characters in keys
 * 
 * Example:
 * const sanitized = sanitizeInput(
 *   { "First Name": "  John  ", email: "john@test.com  " },
 *   { "First Name": "firstName" }
 * );
 * → { firstName: "John", email: "john@test.com" }
 */
export function sanitizeInput(
  data: any,
  fieldMappings?: Record<string, string>,
  useEmailSanitization: boolean = false,
  usePhoneSanitization: boolean = false
): any {
  // Step 1: Deep sanitize all values
  let sanitized = deepSanitize(data);

  // Step 2: Apply field name mappings if provided
  if (fieldMappings && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    sanitized = applyFieldNameMappings(sanitized, fieldMappings);
  }

  // Step 3: Apply specialized sanitization if needed
  if (useEmailSanitization && sanitized.email) {
    sanitized.email = sanitizeEmail(sanitized.email);
  }
  if (usePhoneSanitization && sanitized.phone) {
    sanitized.phone = sanitizePhone(sanitized.phone);
  }

  return sanitized;
}
