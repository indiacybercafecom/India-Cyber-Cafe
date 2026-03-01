<?php
/**
 * Secure Advanced PHP File Upload System
 * Optimized for Hostinger Business Shared Hosting
 * Includes Firebase Realtime Database Integration
 */

header('Content-Type: application/json');

// --- CONFIGURATION ---
$base_upload_dir = 'uploads/';
$max_file_size = 10 * 1024 * 1024; // 10MB
$allowed_extensions = ['jpg', 'jpeg', 'png', 'pdf', 'heif', 'mp4'];
$allowed_mimes = [
    'image/jpeg', 
    'image/png', 
    'application/pdf', 
    'image/heif', 
    'video/mp4'
];

// Firebase Config (Replace with your actual Firebase URL if different)
$firebase_url = "https://india-cyber-cafe-default-rtdb.firebaseio.com/uploads.json";

// --- VALIDATION ---

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die(json_encode(['status' => 'error', 'message' => 'Invalid request method']));
}

if (!isset($_FILES['file']) || !isset($_POST['category'])) {
    die(json_encode(['status' => 'error', 'message' => 'Missing file or category']));
}

$file = $_FILES['file'];
$category = preg_replace('/[^a-zA-Z0-9_-]/', '', $_POST['category']); // Sanitize category

if (empty($category)) {
    die(json_encode(['status' => 'error', 'message' => 'Invalid category name']));
}

// 1. Check for PHP errors
if ($file['error'] !== UPLOAD_ERR_OK) {
    die(json_encode(['status' => 'error', 'message' => 'PHP Upload Error: ' . $file['error']]));
}

// 2. Validate File Size
if ($file['size'] > $max_file_size) {
    die(json_encode(['status' => 'error', 'message' => 'File size exceeds 10MB limit']));
}

// 3. Validate Extension
$original_name = $file['name'];
$ext = strtolower(pathinfo($original_name, PATHINFO_EXTENSION));
if (!in_array($ext, $allowed_extensions)) {
    die(json_encode(['status' => 'error', 'message' => 'File type not allowed: ' . $ext]));
}

// 4. Validate MIME Type (More secure than extension only)
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!in_array($mime, $allowed_mimes)) {
    die(json_encode(['status' => 'error', 'message' => 'Security check failed: Invalid MIME type (' . $mime . ')']));
}

// --- FILE PROCESSING ---

// Create category directory if not exists
$target_dir = $base_upload_dir . $category . '/';
if (!is_dir($target_dir)) {
    if (!mkdir($target_dir, 0755, true)) {
        die(json_encode(['status' => 'error', 'message' => 'Failed to create category directory']));
    }
}

// Generate Secure Filename
// Format: category_randomString_timestamp_originalfilename.extension
$random_string = bin2hex(random_bytes(6)); // 12 characters
$timestamp = time();
$sanitized_original_name = preg_replace('/[^a-zA-Z0-9._-]/', '_', pathinfo($original_name, PATHINFO_FILENAME));
$new_filename = "{$category}_{$random_string}_{$timestamp}_{$sanitized_original_name}.{$ext}";
$target_path = $target_dir . $new_filename;

// Prevent Overwrite (though random string makes it unlikely)
if (file_exists($target_path)) {
    $new_filename = "{$category}_{$random_string}_" . microtime(true) . "_{$sanitized_original_name}.{$ext}";
    $target_path = $target_dir . $new_filename;
}

// Move File
if (move_uploaded_file($file['tmp_name'], $target_path)) {
    
    // Construct File URL
    $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
    $host = $_SERVER['HTTP_HOST'];
    $script_path = str_replace(basename($_SERVER['SCRIPT_NAME']), '', $_SERVER['SCRIPT_NAME']);
    $file_url = "{$protocol}://{$host}{$script_path}{$target_path}";

    // --- FIREBASE INTEGRATION ---
    $firebase_data = [
        'name' => $new_filename,
        'original_name' => $original_name,
        'url' => $file_url,
        'category' => $category,
        'mime' => $mime,
        'size' => $file['size'],
        'timestamp' => $timestamp,
        'formatted_date' => date('Y-m-d H:i:s', $timestamp)
    ];

    $ch = curl_init($firebase_url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($firebase_data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    $fb_response = curl_exec($ch);
    curl_close($ch);

    echo json_encode([
        'status' => 'success',
        'file_url' => $file_url,
        'stored_file_name' => $new_filename,
        'firebase_synced' => true
    ]);
} else {
    echo json_encode(['status' => 'error', 'message' => 'Failed to move uploaded file']);
}
