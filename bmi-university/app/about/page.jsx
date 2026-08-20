import Link from "next/link";
import PageHero from "@/components/PageHero";

export default function About() {
  const leadership = [
    {
      name: "Dr. Christopher L. Cookhorne",
      role: "Chancellor & Founder",
      bio: "Visionary leader with decades of ministry experience across the United States and Africa.",
      img: "/images/about-hero/about-hero-1-faculty.jpg",
    },
    {
      name: "Prof. M. Adebayo, Th.D.",
      role: "Vice-Chancellor",
      bio: "Distinguished theologian and educator committed to academic rigor and pastoral formation.",
      img: "/images/about-hero/about-hero-2-campus-walk.jpg",
    },
    {
      name: "Dr. E. Vance, Ph.D.",
      role: "University Registrar",
      bio: "Academic administrator ensuring compliance, quality assurance, and student success.",
      img: "/images/about-hero/about-hero-3-students-library.jpg",
    },
  ];

  const values = [
    {
      icon: "📖",
      title: "Biblical Authority",
      body: "The Word of God is our supreme authority in all matters of faith, practice, and academic inquiry.",
    },
    {
      icon: "✝",
      title: "Christ-Centeredness",
      body: "Jesus Christ is the center of our community, our curriculum, and our mission to reach the nations.",
    },
    {
      icon: "🎯",
      title: "Academic Excellence",
      body: "Rigorous scholarship paired with practical ministry training for effective, impactful leadership.",
    },
    {
      icon: "🌍",
      title: "Transformative Learning",
      body: "Education involves the whole person by developing the knowledge, values, and skills which enable each individual to change freely — most effectively when both instructor and student are properly related to God through Christ.",
    },
  ];

  return (
    <main id="main-content">
      <PageHero
        image="/images/about-hero/about-hero-4-community.jpg"
        eyebrow="Our Heritage & Vision"
        title="About BMI University"
        subtitle="A legacy of Christ-centered education, faith, and global impact since our founding."
      />

      {/* Mission */}
      <section style={{ background: "#fff", padding: "6rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5rem", alignItems: "center" }} className="split-section">
          <div>
            <div className="gold-bar" />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(1.8rem, 3vw, 2.6rem)", color: "#0f172a", marginBottom: "1.5rem", lineHeight: 1.15 }}>
              Statement of Mission & Purpose
            </h2>
            <p style={{ color: "#334155", fontSize: "1.05rem", lineHeight: 1.85, marginBottom: "1.25rem" }}>
              Maintaining the vision of the founder, <strong>Dr. Christopher L. Cookhorne</strong>, BMI University develops
              Christ-centered men and women with the values, knowledge, and skills essential to impact the world.
            </p>
            <p style={{ color: "#64748b", fontSize: "1rem", lineHeight: 1.85, marginBottom: "1.25rem" }}>
              Through its residential and online programs, services, facilities, and collaborations, the Seminary educates
              men and women who will make important contributions to their workplaces and communities, follow their
              chosen vocations as callings to glorify God, and fulfill the Great Commission.
            </p>
            <div style={{ padding: "1.25rem 1.5rem", background: "rgba(212,175,55,0.08)", borderLeft: "4px solid #d4af37", borderRadius: "0 12px 12px 0" }}>
              <p style={{ color: "#0f172a", fontWeight: 600, fontSize: "0.95rem", lineHeight: 1.7, margin: 0 }}>
                &ldquo;And the things that thou hast heard of me among many witnesses, the same commit thou to faithful men, who shall be able to teach others also.&rdquo; — 2 Timothy 2:2
              </p>
            </div>
          </div>
          <div style={{ borderRadius: "20px", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.12)", aspectRatio: "4/3" }}>
            <img
              src="/images/about-hero/about-hero-1-faculty.jpg"
              alt="Faculty and students at BMI University"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* Philosophy of Education */}
      <section style={{ background: "#f8fafc", padding: "6rem 2rem" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
          <div className="gold-bar" style={{ margin: "0 auto 1.25rem" }} />
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(1.8rem, 3vw, 2.6rem)", color: "#0f172a", marginBottom: "1.5rem" }}>
            Philosophy of Education
          </h2>
          <p style={{ color: "#475569", fontSize: "1.05rem", lineHeight: 1.9, marginBottom: "1.5rem", textAlign: "left" }}>
            BMI University believes that all truth is of God; therefore, the pursuit of truth is the pursuit of God.
            We believe that true education develops the whole person — spiritually, intellectually, socially, and physically.
            Our educational approach integrates rigorous biblical scholarship with practical ministry application, preparing
            graduates who are not only knowledgeable in the Scriptures but equipped to lead with integrity, compassion, and wisdom.
          </p>
          <p style={{ color: "#475569", fontSize: "1.05rem", lineHeight: 1.9, textAlign: "left" }}>
            We affirm the historic Christian faith as expressed in the Holy Scriptures, and we are committed to transmitting
            this faith through faithful teaching, mentorship, and Christian community.
          </p>
        </div>
      </section>

      {/* Core Values */}
      <section style={{ background: "#fff", padding: "6rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "4rem" }}>
            <div className="gold-bar" style={{ margin: "0 auto 1.25rem" }} />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(1.8rem, 3vw, 2.6rem)", color: "#0f172a", marginBottom: "1rem" }}>
              Core Values
            </h2>
            <p style={{ color: "#64748b", fontSize: "1.05rem", maxWidth: "600px", margin: "0 auto" }}>
              These foundational convictions guide our curriculum, community life, and institutional decisions.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "2rem" }}>
            {values.map((v, i) => (
              <div
                key={i}
                style={{
                  background: "#f8fafc",
                  borderRadius: "16px",
                  padding: "2rem",
                  border: "1px solid rgba(0,0,0,0.06)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <span style={{ fontSize: "2.2rem", display: "block" }}>{v.icon}</span>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: "1.15rem", color: "#0f172a" }}>
                  {v.title}
                </h3>
                <p style={{ color: "#64748b", fontSize: "0.92rem", lineHeight: 1.7 }}>
                  {v.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Leadership */}
      <section style={{ background: "#f8fafc", padding: "6rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "4rem" }}>
            <div className="gold-bar" style={{ margin: "0 auto 1.25rem" }} />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(1.8rem, 3vw, 2.6rem)", color: "#0f172a", marginBottom: "1rem" }}>
              University Leadership
            </h2>
            <p style={{ color: "#64748b", fontSize: "1.05rem", maxWidth: "600px", margin: "0 auto" }}>
              Meet the visionary scholars and ministry leaders guiding Bethel Ministries International University.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "2.5rem" }}>
            {leadership.map((l, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  borderRadius: "20px",
                  overflow: "hidden",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ height: "240px", overflow: "hidden" }}>
                  <img
                    src={l.img}
                    alt={l.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    loading="lazy"
                  />
                </div>
                <div style={{ padding: "1.75rem" }}>
                  <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: "1.15rem", color: "#0f172a", marginBottom: "0.25rem" }}>
                    {l.name}
                  </h3>
                  <div style={{ color: "#d4af37", fontWeight: 700, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.85rem" }}>
                    {l.role}
                  </div>
                  <p style={{ color: "#64748b", fontSize: "0.9rem", lineHeight: 1.65 }}>
                    {l.bio}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "#0f172a", padding: "6rem 2rem", textAlign: "center" }}>
        <div style={{ maxWidth: "700px", margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(2rem, 3.5vw, 2.8rem)", color: "#fff", marginBottom: "1.25rem" }}>
            Join the BMI Community
          </h2>
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "2.5rem" }}>
            Experience an education that transforms both mind and spirit. Apply today or contact our admissions team to learn more.
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/apply" className="btn btn-gold" style={{ fontSize: "1rem" }}>
              Apply for Admission →
            </Link>
            <Link href="/academics" className="btn btn-outline-white" style={{ fontSize: "1rem" }}>
              Explore Programs
            </Link>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 900px) { .split-section { grid-template-columns: 1fr !important; } }
      `}</style>
    </main>
  );
}
