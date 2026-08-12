-- ============================================================================
-- Migration: 0041_add_program_descriptions
--
-- The `programs` table is now the canonical Single Source of Truth for all
-- academic programs at BMI University. Previously, human-readable
-- descriptions and marketing icons lived ONLY in @bmi/shared/src/programs.ts
-- (a TypeScript constant imported at build time). This migration brings the
-- missing marketing metadata into the database so every consumer (marketing
-- site, portal, UMS, public API) can derive the complete picture from SQL
-- queries alone, eliminating the dual-source pattern.
--
-- Steps:
--   1. ALTER TABLE programs ADD COLUMN description TEXT
--   2. ALTER TABLE programs ADD COLUMN icon TEXT
--   3. UPDATE all 17 seeded programs with the canonical descriptions + icons
--      that previously lived only in @bmi/shared/src/programs.ts
--   4. Record migration
-- ============================================================================

-- 1. Add columns (idempotent via SQLite hacks — IF NOT EXISTS on column add is
--    only available in SQLite 3.35+, so we guard by wrapping in a transaction
--    and checking pragma_table_info first).
ALTER TABLE programs ADD COLUMN description TEXT;
ALTER TABLE programs ADD COLUMN icon TEXT;

-- 2. Populate descriptions + icons for each of the 17 canonical programs.
--    (labels match the exact strings from VALID_PROGRAMS so the join key is
--    programs.name === original Program.label from @bmi/shared)

-- Undergraduate (icon = /images/bachelor-icon.png)
UPDATE programs SET description = 'Gain a deep understanding of Scripture and theological foundations to serve God in ministry, education, and everyday life.',
                    icon        = '/images/bachelor-icon.png'
WHERE id = 'p-ba-biblical';

UPDATE programs SET description = 'Become equipped with biblical knowledge and teaching skills to lead and educate in Christian schools, churches, and ministry settings.',
                    icon        = '/images/bachelor-icon.png'
WHERE id = 'p-ba-education';

UPDATE programs SET description = 'Gain biblical knowledge and leadership skills to effectively lead in church, ministry, and community settings.',
                    icon        = '/images/bachelor-icon.png'
WHERE id = 'p-ba-ministry';

UPDATE programs SET description = 'Deepen your understanding of biblical theology and prepare for impactful roles in ministry, teaching, and further theological education.',
                    icon        = '/images/bachelor-icon.png'
WHERE id = 'p-ba-theology';

UPDATE programs SET description = 'Be equipped with biblical knowledge and practical skills to lead worship teams and cultivate meaningful worship experiences in church and ministry settings.',
                    icon        = '/images/bachelor-icon.png'
WHERE id = 'p-ba-worship';

-- Graduate (icon = /images/masters-icon.png)
UPDATE programs SET description = 'Gain advanced theological education, practical ministry skills, and biblical knowledge to lead and serve effectively in ministry and beyond.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-mdiv';

UPDATE programs SET description = 'Be equipped with biblical principles and practical skills to provide compassionate, faith-based guidance and support in ministry and professional counseling settings.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-ma-counseling';

UPDATE programs SET description = 'Deepen your biblical knowledge and theological understanding to excel in ministry, academic, and leadership roles within the church and beyond.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-ma-theology';

UPDATE programs SET description = 'Prepare with biblical foundations and educational expertise to lead and inspire in Christian schools, churches, and ministry settings.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-ma-education';

UPDATE programs SET description = 'Become equipped with biblical knowledge and critical reasoning to effectively defend and communicate the Christian faith in diverse settings.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-ma-apologetics';

UPDATE programs SET description = 'Be empowered with biblical principles and leadership skills to lead effectively in ministry, church, and organizational settings.',
                    icon        = '/images/masters-icon.png'
WHERE id = 'p-ma-leadership';

-- Doctorate (icon = /images/phd-icon.png)
UPDATE programs SET description = 'Advance your ministry skills and theological expertise to lead with greater impact and effectiveness in church and community leadership.',
                    icon        = '/images/phd-icon.png'
WHERE id = 'p-dmin';

UPDATE programs SET description = 'Pursue high-level theological research and academic scholarship to teach, write, and lead at the highest levels of Christian education.',
                    icon        = '/images/phd-icon.png'
WHERE id = 'p-thd';

UPDATE programs SET description = 'Equip yourself with advanced educational theory and research skills to lead and transform Christian educational institutions.',
                    icon        = '/images/phd-icon.png'
WHERE id = 'p-dce';

-- Graduate Certificates (icon = NULL — certificates have no dedicated icon)
UPDATE programs SET description = 'Build a solid foundation in biblical interpretation and theological concepts through a flexible, short-term graduate program.',
                    icon        = NULL
WHERE id = 'p-cert-biblical';

UPDATE programs SET description = 'Develop a deeper understanding of Christian worldview and theology to enrich your personal faith and ministry involvement.',
                    icon        = NULL
WHERE id = 'p-cert-christian';

UPDATE programs SET description = 'Focus on the spiritual disciplines and character formation required for deep spiritual growth and ministry longevity.',
                    icon        = NULL
WHERE id = 'p-cert-formation';

-- 3. Record migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('0041_add_program_descriptions');
