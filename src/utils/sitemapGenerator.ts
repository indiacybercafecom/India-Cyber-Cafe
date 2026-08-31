/**
 * Dynamic Sitemap Generation Utility
 * Generates sitemap XML with dynamic service and product pages
 */

interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  image?: string;
}

export class DynamicSitemapGenerator {
  private baseUrl = 'https://b.indiacybercafe.com';
  
  /**
   * Generate sitemap XML for dynamic pages
   */
  static generateSitemapXML(entries: SitemapEntry[]): string {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const urlsetOpen = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">';
    const urlsetClose = '</urlset>';

    const urlEntries = entries.map(entry => {
      let xml = '<url>';
      xml += `<loc>${this.escapeXml(entry.url)}</loc>`;
      
      if (entry.lastmod) {
        xml += `<lastmod>${entry.lastmod}</lastmod>`;
      }
      
      if (entry.changefreq) {
        xml += `<changefreq>${entry.changefreq}</changefreq>`;
      }
      
      if (entry.priority !== undefined) {
        xml += `<priority>${entry.priority.toFixed(1)}</priority>`;
      }
      
      if (entry.image) {
        xml += '<image:image>';
        xml += `<image:loc>${this.escapeXml(entry.image)}</image:loc>`;
        xml += '</image:image>';
      }
      
      xml += '</url>';
      return xml;
    }).join('');

    return `${xmlHeader}\n${urlsetOpen}\n${urlEntries}\n${urlsetClose}`;
  }

  /**
   * Generate sitemap index for multiple sitemaps
   */
  static generateSitemapIndex(sitemaps: Array<{ url: string; lastmod?: string }>): string {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const sitemapIndexOpen = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    const sitemapIndexClose = '</sitemapindex>';

    const sitemapEntries = sitemaps.map(sitemap => {
      let xml = '<sitemap>';
      xml += `<loc>${this.escapeXml(sitemap.url)}</loc>`;
      
      if (sitemap.lastmod) {
        xml += `<lastmod>${sitemap.lastmod}</lastmod>`;
      }
      
      xml += '</sitemap>';
      return xml;
    }).join('');

    return `${xmlHeader}\n${sitemapIndexOpen}\n${sitemapEntries}\n${sitemapIndexClose}`;
  }

  /**
   * Create sitemap entries for services
   */
  static createServiceEntries(
    services: Array<{ id: string; name: string; updatedAt?: Date; image?: string }>,
    baseUrl: string = 'https://b.indiacybercafe.com'
  ): SitemapEntry[] {
    return services.map(service => ({
      url: `${baseUrl}/service-detail/${service.id}`,
      lastmod: service.updatedAt ? service.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      changefreq: 'weekly' as const,
      priority: 0.8,
      image: service.image,
    }));
  }

  /**
   * Create sitemap entries for products
   */
  static createProductEntries(
    products: Array<{ id: string; name: string; updatedAt?: Date; image?: string }>,
    baseUrl: string = 'https://b.indiacybercafe.com'
  ): SitemapEntry[] {
    return products.map(product => ({
      url: `${baseUrl}/store-product/${product.id}`,
      lastmod: product.updatedAt ? product.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      changefreq: 'weekly' as const,
      priority: 0.8,
      image: product.image,
    }));
  }

  /**
   * Create sitemap entries for static pages
   */
  static getStaticPageEntries(baseUrl: string = 'https://b.indiacybercafe.com'): SitemapEntry[] {
    return [
      {
        url: `${baseUrl}/`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'daily',
        priority: 1.0,
      },
      {
        url: `${baseUrl}/services`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/store`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: 0.9,
      },
      {
        url: `${baseUrl}/apply`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'monthly',
        priority: 0.8,
      },
      {
        url: `${baseUrl}/track`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'monthly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/login`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'yearly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/register`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'yearly',
        priority: 0.7,
      },
      {
        url: `${baseUrl}/legal`,
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'yearly',
        priority: 0.5,
      },
    ];
  }

  /**
   * Escape special XML characters
   */
  private static escapeXml(str: string): string {
    const xmlChar: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
      '&': '&amp;',
    };
    return str.replace(/[<>"'&]/g, (char) => xmlChar[char]);
  }
}

/**
 * Example: Generate complete sitemap with dynamic content
 * 
 * Usage:
 * const services = [...]; // from your database
 * const products = [...]; // from your database
 * 
 * const staticPages = DynamicSitemapGenerator.getStaticPageEntries();
 * const servicePages = DynamicSitemapGenerator.createServiceEntries(services);
 * const productPages = DynamicSitemapGenerator.createProductEntries(products);
 * 
 * const allEntries = [...staticPages, ...servicePages, ...productPages];
 * const sitemapXML = DynamicSitemapGenerator.generateSitemapXML(allEntries);
 * 
 * // Save to public/sitemap.xml or serve dynamically
 */
