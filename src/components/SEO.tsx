import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
}

export function SEO({ 
  title = "India Cyber Cafe - Digital Seva Simplified", 
  description = "Apply for Government Services, Jobs & Documents online with India's trusted digital partner. Fast, secure, and reliable digital services.",
  keywords = "India Cyber Cafe, Digital Seva, Government Services, Online Application, CSC, Digital India",
  image = "https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png",
  url = "https://indiacybercafe.com",
  type = "website"
}: SEOProps) {
  const siteTitle = title.includes("India Cyber Cafe") ? title : `${title} | India Cyber Cafe`;

  return (
    <Helmet>
      {/* Standard metadata tags */}
      <title>{siteTitle}</title>
      <meta name='description' content={description} />
      <meta name='keywords' content={keywords} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={siteTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={url} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={siteTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      
      {/* Canonical URL */}
      <link rel="canonical" href={url} />
    </Helmet>
  );
}
