<?php
/**
 * India Cyber Cafe - Production Server-Side Open Graph & SPA Handler
 *
 * For Hostinger Apache/LiteSpeed web hosting deployments:
 * Intercepts page requests for services, sub-services, and products to dynamically
 * inject exact Open Graph, Twitter card, canonical, and description meta tags
 * into index.html BEFORE sending the initial HTML response.
 *
 * Works 100% seamlessly alongside the React SPA and Express/Vite environments.
 */

// 1. Determine Clean Request Path
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$parsedPath = parse_url($requestUri, PHP_URL_PATH) ?? '/';
$cleanPath = rtrim($parsedPath, '/');
if (empty($cleanPath)) {
    $cleanPath = '/';
}

// 2. Base URL Determination
$host = $_SERVER['HTTP_HOST'] ?? 'b.indiacybercafe.com';
$proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443) || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') ? 'https' : 'http';
$baseUrl = (strpos($host, 'localhost') !== false) ? "{$proto}://{$host}" : "https://{$host}";

// 3. Defaults
$defaultImage = 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png';
$defaultTitle = 'India Cyber Cafe - Digital Services, CSC & Online Form Portal';
$defaultDesc = 'Apply for Government Services, CSC Online Forms, PAN Card, Aadhaar UCL, Certificates & Digital Products online at India Cyber Cafe. Fast, secure, and reliable digital partner.';

function slugify($text) {
    if (empty($text)) return '';
    $text = preg_replace('/[^\w\s-]/u', '', (string)$text);
    $text = preg_replace('/[\s_-]+/', '-', $text);
    return strtolower(trim($text, '-'));
}

function cleanText($text, $maxLength = 160) {
    if (empty($text)) return '';
    $cleaned = strip_tags((string)$text);
    $cleaned = preg_replace('/[#*_`~>[\]]/', '', $cleaned);
    $cleaned = preg_replace('/\s+/', ' ', $cleaned);
    $cleaned = trim($cleaned);
    if (mb_strlen($cleaned) <= $maxLength) return $cleaned;
    return mb_substr($cleaned, 0, $maxLength - 3) . '...';
}

function ensureHttps($url, $fallback) {
    if (empty($url)) return $fallback;
    $trimmed = trim((string)$url);
    if (strpos($trimmed, 'http://') === 0) {
        return 'https://' . substr($trimmed, 7);
    }
    return $trimmed;
}

function getImageMimeType($url) {
    if (empty($url)) return 'image/png';
    $clean = strtolower(explode('?', (string)$url)[0]);
    if (str_ends_with($clean, '.webp')) return 'image/webp';
    if (str_ends_with($clean, '.jpg') || str_ends_with($clean, '.jpeg')) return 'image/jpeg';
    if (str_ends_with($clean, '.svg')) return 'image/svg+xml';
    if (str_ends_with($clean, '.gif')) return 'image/gif';
    return 'image/png';
}

// 4. Load Data
$servicesData = [];
$productsData = [];

$baseDir = __DIR__;
$serviceFiles = [
    $baseDir . '/data/services.json',
    $baseDir . '/public/data/services.json',
    dirname($baseDir) . '/public/data/services.json',
    dirname($baseDir) . '/dist/data/services.json',
];

foreach ($serviceFiles as $sf) {
    if (file_exists($sf)) {
        $json = @json_decode(file_get_contents($sf), true);
        if (isset($json['services'])) {
            $servicesData = $json['services'];
            break;
        }
    }
}

$productFiles = [
    $baseDir . '/data/products.json',
    $baseDir . '/public/data/products.json',
    dirname($baseDir) . '/public/data/products.json',
    dirname($baseDir) . '/dist/data/products.json',
];

foreach ($productFiles as $pf) {
    if (file_exists($pf)) {
        $json = @json_decode(file_get_contents($pf), true);
        if (isset($json['products'])) {
            $productsData = $json['products'];
            break;
        }
    }
}

// 5. Metadata Resolution
$title = $defaultTitle;
$desc = $defaultDesc;
$image = $defaultImage;
$url = $baseUrl . $cleanPath;
$ogType = 'website';

// Match Sub-Service: /services/:serviceId/:subserviceSlug
if (preg_match('#^/services/([^/]+)/([^/]+)$#', $cleanPath, $matches)) {
    $serviceId = $matches[1];
    $subserviceParam = $matches[2];
    $decodedParam = strtolower(urldecode($subserviceParam));
    $subSlug = slugify($subserviceParam);

    foreach ($servicesData as $srv) {
        $srvId = $srv['id'] ?? '';
        $srvName = $srv['name'] ?? '';
        if ($srvId === $serviceId || slugify($srvName) === $serviceId) {
            $subservices = $srv['subservices'] ?? [];
            foreach ($subservices as $sub) {
                $subName = $sub['name'] ?? '';
                if (slugify($subName) === $subSlug || strtolower($subName) === $decodedParam || slugify($subName) === strtolower($subserviceParam)) {
                    $hasSubImg = !empty($sub['image']) && ($sub['imageType'] ?? '') === 'url' && strpos($sub['image'], 'http') === 0 && !str_ends_with(strtolower($sub['image']), '.mp4');
                    $hasSrvIcon = !empty($srv['icon']) && ($srv['iconType'] ?? '') === 'url' && strpos($srv['icon'], 'http') === 0 && !str_ends_with(strtolower($srv['icon']), '.mp4');

                    $image = $hasSubImg ? ensureHttps($sub['image'], $defaultImage) : ($hasSrvIcon ? ensureHttps($srv['icon'], $defaultImage) : $defaultImage);

                    $charge = $sub['charge'] ?? null;
                    $origCharge = $sub['originalCharge'] ?? null;
                    $priceInfo = '';
                    if ($charge !== null && $charge !== '') {
                        if ($origCharge && (float)$origCharge > (float)$charge) {
                            $priceInfo = " Service Charge: ₹{$charge} (Regular: ₹{$origCharge}).";
                        } else {
                            $priceInfo = " Service Charge: ₹{$charge}.";
                        }
                    }

                    $title = "{$subName} - {$srvName} | India Cyber Cafe";
                    $desc = "Apply online for {$subName} under {$srvName} at India Cyber Cafe.{$priceInfo} Fast processing, secure submission & expert support.";
                    $url = "{$baseUrl}/services/{$srvId}/" . slugify($subName);
                    $ogType = 'article';
                    break 2;
                }
            }

            // Fallback to parent service
            $hasSrvIcon = !empty($srv['icon']) && ($srv['iconType'] ?? '') === 'url' && strpos($srv['icon'], 'http') === 0 && !str_ends_with(strtolower($srv['icon']), '.mp4');
            $image = $hasSrvIcon ? ensureHttps($srv['icon'], $defaultImage) : $defaultImage;
            $title = "{$srvName} - Apply Online | India Cyber Cafe";
            $desc = !empty($srv['description']) ? cleanText($srv['description']) : $defaultDesc;
            $url = "{$baseUrl}/services/{$srvId}";
            $ogType = 'article';
            break;
        }
    }
}
// Match Service Detail: /services/:serviceId
elseif (preg_match('#^/services/([^/]+)$#', $cleanPath, $matches)) {
    $serviceId = $matches[1];
    foreach ($servicesData as $srv) {
        $srvId = $srv['id'] ?? '';
        $srvName = $srv['name'] ?? '';
        if ($srvId === $serviceId || slugify($srvName) === $serviceId) {
            $hasSrvIcon = !empty($srv['icon']) && ($srv['iconType'] ?? '') === 'url' && strpos($srv['icon'], 'http') === 0 && !str_ends_with(strtolower($srv['icon']), '.mp4');
            $image = $hasSrvIcon ? ensureHttps($srv['icon'], $defaultImage) : $defaultImage;

            $subCount = isset($srv['subservices']) ? count($srv['subservices']) : 0;
            $subCountText = $subCount > 0 ? " {$subCount} sub-services available." : '';

            $title = "{$srvName} - Apply Online | India Cyber Cafe";
            $desc = !empty($srv['description']) ? cleanText($srv['description']) : "Apply online for {$srvName} at India Cyber Cafe.{$subCountText} Fast, secure, and reliable digital assistance.";
            $url = "{$baseUrl}/services/{$srvId}";
            $ogType = 'article';
            break;
        }
    }
}
// Match Product: /store/:categoryId/:productId, /store-product/:productId, /store/product/:productId, /product/:productId
elseif (
    preg_match('#^/store/([^/]+)/([^/]+)$#', $cleanPath, $matches) ||
    preg_match('#^/store-product/([^/]+)$#', $cleanPath, $matches) ||
    preg_match('#^/store/product/([^/]+)$#', $cleanPath, $matches) ||
    preg_match('#^/product/([^/]+)$#', $cleanPath, $matches)
) {
    $productId = isset($matches[2]) ? $matches[2] : $matches[1];
    $catId = isset($matches[2]) ? $matches[1] : 'all';

    foreach ($productsData as $prod) {
        $pId = $prod['id'] ?? '';
        $pPermalink = $prod['permalink'] ?? '';
        $pName = $prod['name'] ?? '';

        if ($pId === $productId || $pPermalink === $productId || slugify($pName) === $productId) {
            $images = $prod['images'] ?? [];
            $hasImg = !empty($images) && is_array($images) && strpos($images[0], 'http') === 0 && !str_ends_with(strtolower($images[0]), '.mp4');
            $image = $hasImg ? ensureHttps($images[0], $defaultImage) : $defaultImage;

            $price = !empty($prod['discountedPrice']) ? $prod['discountedPrice'] : (!empty($prod['price']) ? $prod['price'] : null);
            $origPrice = !empty($prod['price']) ? $prod['price'] : null;

            $priceInfo = '';
            if ($price) {
                if (!empty($prod['discountedPrice']) && $origPrice && (float)$origPrice > (float)$price) {
                    $priceInfo = " | Price: ₹{$price} (MRP: ₹{$origPrice})";
                } else {
                    $priceInfo = " | Price: ₹{$price}";
                }
            }

            $rawDesc = !empty($prod['shortDescription']) ? $prod['shortDescription'] : (!empty($prod['seoDescription']) ? $prod['seoDescription'] : (!empty($prod['longDescription']) ? $prod['longDescription'] : $pName));

            $prodTitle = !empty($prod['seoTitle']) ? $prod['seoTitle'] : $pName;
            $title = "{$prodTitle} | India Cyber Cafe Store";
            $desc = cleanText($rawDesc) . $priceInfo;
            $category = !empty($prod['category']) ? $prod['category'] : $catId;
            $url = "{$baseUrl}/store/{$category}/{$pId}";
            $ogType = 'product';
            break;
        }
    }
}
elseif ($cleanPath === '/services') {
    $title = 'Digital Services & CSC Online Portal | India Cyber Cafe';
    $desc = 'Browse and apply for all government and digital services online: PAN card, Aadhaar UCL, Voter ID, Certificates, and more at India Cyber Cafe.';
    $url = "{$baseUrl}/services";
}
elseif ($cleanPath === '/store') {
    $title = 'Online Store - Printing & Digital Products | India Cyber Cafe';
    $desc = 'Shop custom printed t-shirts, PVC smart cards, medical reference books, and digital guides at India Cyber Cafe.';
    $url = "{$baseUrl}/store";
}
elseif ($cleanPath === '/price-list') {
    $title = 'Service Price List & Charges | India Cyber Cafe';
    $desc = 'Transparent pricing and service charges for all government services, online applications, and digital products.';
    $url = "{$baseUrl}/price-list";
}
elseif ($cleanPath === '/forms-documents') {
    $title = 'Government Forms & Document Downloads | India Cyber Cafe';
    $desc = 'Free download official PDF application forms and guidelines for government and legal services.';
    $url = "{$baseUrl}/forms-documents";
}

// 6. Read index.html
$indexPaths = [
    $baseDir . '/index.html',
    $baseDir . '/dist/index.html',
    dirname($baseDir) . '/dist/index.html',
    dirname($baseDir) . '/index.html',
];

$html = '';
foreach ($indexPaths as $ip) {
    if (file_exists($ip)) {
        $html = file_get_contents($ip);
        break;
    }
}

if (empty($html)) {
    http_response_code(404);
    echo "index.html not found";
    exit;
}

// 7. Inject Meta Tags
$safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
$safeDesc = htmlspecialchars($desc, ENT_QUOTES, 'UTF-8');
$safeImage = htmlspecialchars($image, ENT_QUOTES, 'UTF-8');
$safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
$imageMime = getImageMimeType($image);

// Replace title
if (preg_match('/<title>[^<]*<\/title>/i', $html)) {
    $html = preg_replace('/<title>[^<]*<\/title>/i', "<title>{$safeTitle}</title>", $html);
} else {
    $html = str_replace('<head>', "<head>\n    <title>{$safeTitle}</title>", $html);
}

// Replace description
if (preg_match('/<meta\s+name=["\']description["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+name=["\']description["\'][^>]*>/i', "<meta name=\"description\" content=\"{$safeDesc}\" />", $html);
} else {
    $html = str_replace('</head>', "    <meta name=\"description\" content=\"{$safeDesc}\" />\n  </head>", $html);
}

// Replace image
if (preg_match('/<meta\s+name=["\']image["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+name=["\']image["\'][^>]*>/i', "<meta name=\"image\" content=\"{$safeImage}\" />", $html);
}

// Replace og:title
if (preg_match('/<meta\s+property=["\']og:title["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:title["\'][^>]*>/i', "<meta property=\"og:title\" content=\"{$safeTitle}\" />", $html);
} else {
    $html = str_replace('</head>', "    <meta property=\"og:title\" content=\"{$safeTitle}\" />\n  </head>", $html);
}

// Replace og:description
if (preg_match('/<meta\s+property=["\']og:description["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:description["\'][^>]*>/i', "<meta property=\"og:description\" content=\"{$safeDesc}\" />", $html);
} else {
    $html = str_replace('</head>', "    <meta property=\"og:description\" content=\"{$safeDesc}\" />\n  </head>", $html);
}

// Replace og:image
$ogImageReplacement = "<meta property=\"og:image\" content=\"{$safeImage}\" />\n    <meta property=\"og:image:secure_url\" content=\"{$safeImage}\" />\n    <meta property=\"og:image:type\" content=\"{$imageMime}\" />\n    <meta property=\"og:image:width\" content=\"1200\" />\n    <meta property=\"og:image:height\" content=\"630\" />\n    <meta property=\"og:image:alt\" content=\"{$safeTitle}\" />";

if (preg_match('/<meta\s+property=["\']og:image["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:image["\'][^>]*>/i', $ogImageReplacement, $html);
} else {
    $html = str_replace('</head>', "    {$ogImageReplacement}\n  </head>", $html);
}

// Replace og:url
if (preg_match('/<meta\s+property=["\']og:url["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:url["\'][^>]*>/i', "<meta property=\"og:url\" content=\"{$safeUrl}\" />", $html);
} else {
    $html = str_replace('</head>', "    <meta property=\"og:url\" content=\"{$safeUrl}\" />\n  </head>", $html);
}

// Replace og:type
if (preg_match('/<meta\s+property=["\']og:type["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:type["\'][^>]*>/i', "<meta property=\"og:type\" content=\"{$ogType}\" />", $html);
} else {
    $html = str_replace('</head>', "    <meta property=\"og:type\" content=\"{$ogType}\" />\n  </head>", $html);
}

// Replace og:site_name
if (preg_match('/<meta\s+property=["\']og:site_name["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<meta\s+property=["\']og:site_name["\'][^>]*>/i', '<meta property="og:site_name" content="India Cyber Cafe" />', $html);
} else {
    $html = str_replace('</head>', "    <meta property=\"og:site_name\" content=\"India Cyber Cafe\" />\n  </head>", $html);
}

// Replace twitter tags
$html = preg_replace('/<meta\s+(?:property|name)=["\']twitter:card["\'][^>]*>/i', "<meta name=\"twitter:card\" content=\"summary_large_image\" />\n    <meta property=\"twitter:card\" content=\"summary_large_image\" />", $html);
$html = preg_replace('/<meta\s+(?:property|name)=["\']twitter:title["\'][^>]*>/i', "<meta name=\"twitter:title\" content=\"{$safeTitle}\" />\n    <meta property=\"twitter:title\" content=\"{$safeTitle}\" />", $html);
$html = preg_replace('/<meta\s+(?:property|name)=["\']twitter:description["\'][^>]*>/i', "<meta name=\"twitter:description\" content=\"{$safeDesc}\" />\n    <meta property=\"twitter:description\" content=\"{$safeDesc}\" />", $html);
$html = preg_replace('/<meta\s+(?:property|name)=["\']twitter:image["\'][^>]*>/i', "<meta name=\"twitter:image\" content=\"{$safeImage}\" />\n    <meta property=\"twitter:image\" content=\"{$safeImage}\" />", $html);

// Canonical link
if (preg_match('/<link\s+rel=["\']canonical["\'][^>]*>/i', $html)) {
    $html = preg_replace('/<link\s+rel=["\']canonical["\'][^>]*>/i', "<link rel=\"canonical\" href=\"{$safeUrl}\" />", $html);
} else {
    $html = str_replace('</head>', "    <link rel=\"canonical\" href=\"{$safeUrl}\" />\n  </head>", $html);
}

// 8. Send Output
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
echo $html;
exit;
