<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
  <xsl:output method="html" encoding="UTF-8" omit-xml-declaration="yes"/>
  <xsl:template match="/">
    <html>
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>India Cyber Cafe Sitemap</title>
        <style>
          :root { color-scheme: light; --navy: #07166b; --orange: #ff841b; --ink: #172554; --muted: #64748b; --line: #dbe4f0; --soft: #f6f8fc; }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100vh; background: #f4f7fb; color: var(--ink); font: 15px/1.5 Arial, sans-serif; }
          .wrap { width: min(1080px, calc(100% - 32px)); margin: 32px auto; }
          .panel { margin-top: 20px; padding: 22px; border: 1px solid var(--line); border-radius: 16px; background: white; box-shadow: 0 8px 24px rgba(15, 23, 42, .06); }
          .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
          h2 { margin: 0; color: var(--navy); font-size: 20px; }
          .count { padding: 4px 10px; border-radius: 999px; background: #fff1e6; color: #c75200; font-size: 12px; font-weight: 700; }
          .item { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 4px; border-top: 1px solid var(--line); }
          .item:first-of-type { border-top: 0; }
          a { color: var(--navy); font-weight: 700; text-decoration: none; overflow-wrap: anywhere; }
          a:hover { color: var(--orange); text-decoration: underline; }
          .meta { flex: 0 0 auto; color: var(--muted); font-size: 12px; white-space: nowrap; }
          .url { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; font-weight: 400; }
          footer { padding: 20px 0; color: var(--muted); text-align: center; font-size: 12px; }
          @media (max-width: 640px) { .wrap { width: min(100% - 20px, 1080px); margin: 10px auto; } .panel { padding: 16px; } .item { display: block; } .meta { display: block; margin-top: 5px; } }
        </style>
      </head>
      <body>
        <main class="wrap">
          <xsl:choose>
            <xsl:when test="s:sitemapindex">
              <section class="panel">
                <div class="panel-head"><h2>Available Sitemaps</h2><span class="count"><xsl:value-of select="count(s:sitemapindex/s:sitemap)"/> sections</span></div>
                <xsl:for-each select="s:sitemapindex/s:sitemap">
                  <div class="item"><div><a href="{s:loc}"><xsl:value-of select="substring-before(substring-after(s:loc, '://'), '/')"/> / <xsl:value-of select="substring-after(s:loc, 'com/')"/></a><span class="url"><xsl:value-of select="s:loc"/></span></div><span class="meta"><xsl:value-of select="s:lastmod"/></span></div>
                </xsl:for-each>
              </section>
            </xsl:when>
            <xsl:otherwise>
              <section class="panel">
                <div class="panel-head"><h2>Links in this Sitemap</h2><span class="count"><xsl:value-of select="count(s:urlset/s:url)"/> links</span></div>
                <xsl:for-each select="s:urlset/s:url">
                  <div class="item"><div><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></div><span class="meta"><xsl:value-of select="s:changefreq"/> &#183; <xsl:value-of select="s:priority"/></span></div>
                </xsl:for-each>
              </section>
            </xsl:otherwise>
          </xsl:choose>
          <footer>India Cyber Cafe · XML sitemap</footer>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
