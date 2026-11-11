export const siteConfig = {
  name: "EGXANO",
  description:
    "Independent research and analysis for Egyptian Exchange companies — financial statements, technical indicators, valuation metrics, comparisons and screening in Arabic and English. Not affiliated with EGX.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://meza-ashy.vercel.app",
  ogImage: "/og-image.png",
  links: {
    homepage: "/",
    companies: "/companies",
    sectors: "/sectors",
    scanners: "/dashboard#/scanners",
    premium: "/premium",
  },
}

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: siteConfig.name,
  description: siteConfig.description,
  url: siteConfig.url,
  logo: `${siteConfig.url}/logo.png`,
  sameAs: [],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: ["English", "Arabic"],
  },
}

export const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteConfig.name,
  description: siteConfig.description,
  url: siteConfig.url,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteConfig.url}/?search={search_term_string}`,
    },
    queryInput: "required name=search_term_string",
  },
}
