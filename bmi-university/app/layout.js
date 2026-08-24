import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CookieBanner from "@/components/CookieBanner";

// ─── Schema.org JSON-LD structured data ─────────────────────────────────────
// This is the PRIMARY signal Google uses to display the university logo
// in Knowledge Panels and search results.
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "CollegeOrUniversity",
  "name": "Bethel Ministries International University",
  "alternateName": ["BMI University", "BMI Universities"],
  "url": "https://bmiuniversities.org",
  "logo": {
    "@type": "ImageObject",
    "url": "https://bmiuniversities.org/images/bmi-logo-search.png",
    "width": 600,
    "height": 600
  },
  "image": "https://bmiuniversities.org/images/bmi-logo-search.png",
  "description": "Bethel Ministries International University (BMI University) is an accredited global higher education institution dedicated to empowering Christ-centered leaders through theological scholarship, biblical truth, and academic excellence.",
  "address": {
    "@type": "PostalAddress",
    "addressCountry": "US"
  },
  "sameAs": [
    "https://bmiuniversities.org",
    "https://www.bmiuniversities.org",
    "https://portal.bmiuniversities.org"
  ],
  "foundingDate": "2020",
  "educationalCredentialAwarded": [
    "Bachelor of Arts",
    "Master of Arts",
    "Master of Divinity",
    "Doctor of Ministry",
    "Doctor of Theology",
    "Graduate Certificate"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "admissions",
    "email": "admissions@bmiuniversities.org",
    "url": "https://bmiuniversities.org/admissions"
  }
};

export const metadata = {
  metadataBase: new URL("https://bmiuniversities.org"),
  title: "Bethel Ministries International University | BMI University — Accredited Higher Education",
  description: "Bethel Ministries International University (BMI University) is an accredited global higher education institution dedicated to empowering Christ-centered leaders through theological scholarship, biblical truth, and academic excellence.",
  keywords: "BMI University, Bethel Ministries International University, biblical studies, theological education, accredited university, Christian leadership",
  // ── Canonical URL
  alternates: {
    canonical: "https://bmiuniversities.org",
  },
  // ── Icons (Google also indexes these for logo and favicon display in search results)
  icons: {
    icon: [
      { url: "/images/bmi-logo-search.png", type: "image/png" },
    ],
    apple: [
      { url: "/images/bmi-logo-search.png", sizes: "180x180", type: "image/png" },
    ],
  },
  // ── Open Graph (social previews + Google rich results)
  openGraph: {
    title: "BMI University | Bethel Ministries International University",
    description: "Developing Christ-centered men and women with the values, knowledge, and skills essential to impact the world.",
    url: "https://bmiuniversities.org",
    siteName: "Bethel Ministries International University",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://bmiuniversities.org/images/bmi-logo-search.png",
        width: 1200,
        height: 1200,
        alt: "BMI University — Bethel Ministries International University",
      },
    ],
  },
  // ── Twitter / X card
  twitter: {
    card: "summary_large_image",
    title: "BMI University | Bethel Ministries International University",
    description: "Developing Christ-centered men and women with the values, knowledge, and skills essential to impact the world.",
    images: ["https://bmiuniversities.org/images/bmi-logo-search.png"],
  },
  // ── Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
    },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={{ scrollPaddingTop: '112px' }}>
      <head>
        {/* Schema.org Organization structured data — tells Google to display the BMI logo */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Navbar />
        <div style={{ flexGrow: 1 }}>
          {children}
        </div>
        <CookieBanner />
        <Footer />
      </body>
    </html>
  );
}
