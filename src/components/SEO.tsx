import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
  author?: string;
  canonical?: string;
}

export function SEO({ 
  title = "India Cyber Cafe - Digital Seva Simplified", 
  description = "Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable digital services.",
  keywords = "India Cyber Cafe, Digital Seva, Government Services, Online Application, CSC, Digital India, Pan Card, Aadhaar, Passport, Online Forms",
  image = "https://b.indiacybercafe.com/og-image.png",
  url = "https://b.indiacybercafe.com",
  type = "website",
  author = "India Cyber Cafe",
  canonical = "https://b.indiacybercafe.com"
}: SEOProps) {
  const siteTitle = title.includes("India Cyber Cafe") ? title : `${title} | India Cyber Cafe`;

  return (
    <Helmet>
      {/* Standard metadata tags */}
      <title>{siteTitle}</title>
      <meta name='description' content={description} />
      <meta name='keywords' content={keywords} />
      <meta name='author' content={author} />
      <meta name='language' content='English' />
      <meta name='revisit-after' content='7 days' />
      <meta name='rating' content='General' />
      
      {/* Robots metadata for crawling & indexing */}
      <meta name='robots' content='index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' />
      <meta name='googlebot' content='index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' />
      
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content="India Cyber Cafe" />
      <meta property="og:locale" content="en_IN" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={siteTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:site" content="@indiacybercafe" />
      <meta name="twitter:creator" content="@indiacybercafe" />
      
      {/* Canonical URL - Critical for duplicate content */}
      <link rel="canonical" href={canonical} />
      
      {/* Additional SEO tags */}
      <meta name="image" content={image} />
      <meta httpEquiv="x-ua-compatible" content="IE=edge" />
      
      {/* Alternative language/region links */}
      <link rel="alternate" hrefLang="en-IN" href="https://b.indiacybercafe.com" />
      <link rel="alternate" hrefLang="hi-IN" href="https://b.indiacybercafe.com/hi" />
    </Helmet>
  );
}
