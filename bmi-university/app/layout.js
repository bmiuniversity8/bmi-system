import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CookieBanner from "@/components/CookieBanner";

export const metadata = {
  title: "Bethel Ministries International University | BMI University — Accredited Higher Education",
  description: "Bethel Ministries International University (BMI University) is an accredited global higher education institution dedicated to empowering Christ-centered leaders through theological scholarship, biblical truth, and academic excellence.",
  keywords: "BMI University, Bethel Ministries International University, biblical studies, theological education, accredited university, Christian leadership",
  openGraph: {
    title: "BMI University | Bethel Ministries International University",
    description: "Developing Christ-centered men and women with the values, knowledge, and skills essential to impact the world.",
    url: "https://bmiuniversities.org",
    siteName: "BMI University",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={{ scrollPaddingTop: '112px' }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Navbar />
        <div style={{ flexGrow: 1, paddingTop: '112px' }}>
          {children}
        </div>
        <CookieBanner />
        <Footer />
      </body>
    </html>
  );
}
