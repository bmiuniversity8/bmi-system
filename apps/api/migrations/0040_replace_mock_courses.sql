-- ============================================================================
-- Migration: 0040_replace_mock_courses
-- Removes the legacy CS/BUS/ENG/MATH/PHY mock courses seeded by 0001_initial.sql
-- and replaces them with the official BMI University theological course catalog.
--
-- Run this on databases that already executed 0001_initial.sql.
-- For fresh databases, 0001_initial.sql already contains the correct seed.
-- ============================================================================

-- Step 1: Remove the 5 legacy mock courses that do not reflect BMI University's
--         actual theological and biblical studies curriculum.
--         (CS101, BUS201, ENG105, MATH210, PHY101)
DELETE FROM courses WHERE code IN ('CS101', 'BUS201', 'ENG105', 'MATH210', 'PHY101');

-- Step 2: Seed Undergraduate Core courses (BA in Biblical Studies / Christian Education /
--         Ministry Leadership / Theological Studies / Worship Leadership)
INSERT OR IGNORE INTO courses (code, title, description, credits, term, capacity) VALUES
('BIBL101', 'Old Testament Survey I', 'A comprehensive introduction to the books, themes, and historical context of the Old Testament, focusing on the Pentateuch and Historical Books.', 3, 'Fall 2026', 150),
('BIBL102', 'Old Testament Survey II', 'Continuation of BIBL101, covering Poetic Books, Prophets, and Wisdom Literature of the Old Testament.', 3, 'Spring 2027', 150),
('BIBL103', 'New Testament Survey I', 'Introduction to the Gospels, Acts, and Pauline epistles with emphasis on historical context and theological themes.', 3, 'Fall 2026', 150),
('BIBL104', 'New Testament Survey II', 'Continuation of BIBL103, covering General Epistles, Hebrews, and Revelation.', 3, 'Spring 2027', 150),
('THEO101', 'Systematic Theology I', 'Introduction to Christian doctrine: the attributes of God, Trinity, creation, providence, and the person and work of Christ.', 3, 'Fall 2026', 120),
('THEO102', 'Systematic Theology II', 'Continuation of THEO101: sin, salvation, the Holy Spirit, the church, sacraments, and eschatology.', 3, 'Spring 2027', 120),
('THEO103', 'Biblical Hermeneutics', 'Principles and methods of biblical interpretation, including grammatical-historical exegesis and contemporary application.', 3, 'Fall 2026', 120),
('MIN101', 'Introduction to Ministry', 'Survey of vocational ministry callings, church leadership structures, and pastoral ethics.', 3, 'Fall 2026', 100),
('MIN102', 'Homiletics I: Preaching Foundations', 'Introduction to the theory and practice of biblical preaching, including sermon preparation and delivery.', 3, 'Spring 2027', 100),
('EDUC101', 'Christian Education Foundations', 'Philosophy, history, and methodology of Christian education in church and school contexts.', 3, 'Fall 2026', 120),
('WRSH101', 'Worship Leadership Foundations', 'Principles of corporate worship planning, music leadership, liturgy, and the theology of worship.', 3, 'Fall 2026', 100),
('COUN101', 'Introduction to Christian Counseling', 'Foundational theories and skills for biblical counseling, including active listening and crisis response.', 3, 'Spring 2027', 100),
('APOL101', 'Christian Apologetics', 'Defense of the Christian faith: arguments for the existence of God, reliability of Scripture, and response to common objections.', 3, 'Fall 2026', 120),
('CHST101', 'Church History I', 'Survey of Christian history from the Apostolic era through the Reformation (100-1517 AD).', 3, 'Fall 2026', 120),
('CHST102', 'Church History II', 'Survey of Christian history from the Reformation to the present day, including global Christianity.', 3, 'Spring 2027', 120);

-- Step 3: Seed Graduate Level courses (MA / MDiv programs)
INSERT OR IGNORE INTO courses (code, title, description, credits, term, capacity) VALUES
('BIBL501', 'Advanced Hebrew Exegesis', 'Intermediate biblical Hebrew with guided exegesis of selected Old Testament passages.', 3, 'Fall 2026', 60),
('BIBL502', 'Advanced Greek Exegesis', 'Intermediate New Testament Greek with guided exegesis of Pauline epistles and Gospels.', 3, 'Fall 2026', 60),
('THEO501', 'Advanced Systematic Theology', 'Graduate-level seminar in Christian doctrine, focusing on contemporary debates and primary sources.', 3, 'Fall 2026', 60),
('THEO502', 'Theology of Mission', 'Biblical, historical, and contemporary perspectives on Christian mission and evangelism.', 3, 'Spring 2027', 60),
('MDIV501', 'Pastoral Theology & Practice', 'MDiv core: pastoral care, visitation, administration, and the role of the senior pastor.', 3, 'Fall 2026', 60),
('MDIV510', 'Church Polity & Leadership', 'Models of church government, congregational leadership, and administrative best practices.', 3, 'Spring 2027', 60),
('COUN501', 'Marriage & Family Counseling', 'Graduate-level counseling methods for marital, premarital, and family issues from a biblical worldview.', 3, 'Fall 2026', 60),
('COUN502', 'Trauma & Crisis Counseling', 'Specialized training for counseling survivors of trauma, grief, and acute crisis situations.', 3, 'Spring 2027', 60),
('EDUC501', 'Curriculum Design for Christian Education', 'Graduate-level curriculum development, assessment strategies, and educational technology integration.', 3, 'Fall 2026', 60),
('APOL501', 'Advanced Apologetics & Cultural Engagement', 'Contemporary apologetics addressing postmodernism, religious pluralism, and public theology.', 3, 'Spring 2027', 60),
('LEAD501', 'Organizational Leadership for Ministry', 'Leadership theory, change management, and strategic planning applied to churches and Christian organizations.', 3, 'Fall 2026', 60);

-- Step 4: Seed Doctorate Level courses (DMin / ThD / DCE)
INSERT OR IGNORE INTO courses (code, title, description, credits, term, capacity) VALUES
('DMIN701', 'Doctoral Seminar: Advanced Ministry Praxis', 'DMin core seminar integrating theology with advanced pastoral practice and applied research.', 3, 'Fall 2026', 30),
('THD701', 'ThD Dissertation Seminar I', 'Guided research and writing for Doctor of Theology candidates, including proposal development.', 3, 'Fall 2026', 25),
('THD702', 'ThD Dissertation Seminar II', 'Continuation of THD701, focusing on analysis of primary sources and peer review.', 3, 'Spring 2027', 25),
('DCE701', 'Doctoral Research in Christian Education', 'DCE core: advanced educational research methods and transformative pedagogy.', 3, 'Fall 2026', 25),
('DMIN710', 'Preaching in the Post-Christendom Era', 'DMin elective: advanced homiletics addressing secularized contexts and pluralistic audiences.', 3, 'Spring 2027', 30);

-- Step 5: Seed Graduate Certificate courses
INSERT OR IGNORE INTO courses (code, title, description, credits, term, capacity) VALUES
('GCBS101', 'Certificate: Biblical Interpretation', 'Graduate Certificate module: inductive Bible study methods and interpretive frameworks.', 3, 'Fall 2026', 80),
('GCCS101', 'Certificate: Christian Worldview', 'Graduate Certificate module: developing a robust Christian worldview across ethics, science, and culture.', 3, 'Fall 2026', 80),
('GCSF101', 'Certificate: Spiritual Disciplines', 'Graduate Certificate module: theology and practice of spiritual formation for long-term ministry health.', 3, 'Fall 2026', 80),
('GCBS102', 'Certificate: Pauline Epistles', 'Graduate Certificate module: exegetical study of the letters of Paul.', 3, 'Spring 2027', 80),
('GCSF102', 'Certificate: Spiritual Direction', 'Graduate Certificate module: one-on-one spiritual guidance, discernment, and soul care.', 3, 'Spring 2027', 80);

-- Step 6: Record migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('0040_replace_mock_courses');
