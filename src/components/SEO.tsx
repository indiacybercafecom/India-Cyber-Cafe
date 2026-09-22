import { Helmet } from 'react-helmet-async';

const DEFAULT_IMAGE = "https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png";
const DEFAULT_URL = "https://b.indiacybercafe.com";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
  author?: string;
  ogType?: 'website' | 'article' | 'product';
  structuredData?: Record<string, any>;
}

export function SEO({ 
  title = "India Cyber Cafe - Digital Seva Simplified", 
  description = "Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable digital services.",
  keywords = "India Cyber Cafe, Digital Seva, Government Services, Online Application, CSC, Digital India",
  image,
  url,
  type = "website",
  author = "India Cyber Cafe",
  ogType = "website",
  structuredData
}: SEOProps) {
  const siteTitle = title.includes("India Cyber Cafe") ? title : `${title} | India Cyber Cafe`;
  
  // Resolve fallback and ensure HTTPS URLs
  const rawImage = (image && image.startsWith('http') && !image.toLowerCase().endsWith('.mp4')) ? image : DEFAULT_IMAGE;
  const secureImageUrl = rawImage.startsWith('http://') ? rawImage.replace('http://', 'https://') : rawImage;

  const currentUrl = url || (typeof window !== 'undefined' ? window.location.href : DEFAULT_URL);
  const secureUrl = currentUrl.startsWith('http://') ? currentUrl.replace('http://', 'https://') : currentUrl;

  return (
    <Helmet>
      {/* Standard metadata tags */}
      <title>{siteTitle}</title>
      <meta name='description' content={description} />
      <meta name='keywords' content={keywords} />
      <meta name='author' content={author} />
      <meta name='language' content='English' />
      <meta name='robots' content='index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={secureImageUrl} />
      <meta property="og:image:secure_url" content={secureImageUrl} />
      <meta property="og:image:alt" content={siteTitle} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:url" content={secureUrl} />
      <meta property="og:site_name" content="India Cyber Cafe" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={siteTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={secureImageUrl} />
      <meta name="twitter:image:alt" content={siteTitle} />
      <meta name="twitter:creator" content="@indiacybercafe" />
      
      {/* Canonical URL & Favicons */}
      <link rel="canonical" href={secureUrl} />
      <link rel="icon" href={DEFAULT_IMAGE} />
      <link rel="apple-touch-icon" href={DEFAULT_IMAGE} />

      {/* Additional SEO tags */}
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="theme-color" content="#FF9933" />

      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
}
