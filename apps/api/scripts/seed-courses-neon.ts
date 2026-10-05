/**
 * BMI University – Seed All Courses into Neon PostgreSQL
 * ────────────────────────────────────────────────────────
 * Run: npx tsx apps/api/scripts/seed-courses-neon.ts
 *
 * Safe to run multiple times (INSERT ... ON CONFLICT DO UPDATE).
 * Requires DATABASE_URL_CORE env var pointing to the Neon core DB.
 */
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_CORE;
if (!url) throw new Error('DATABASE_URL_CORE environment variable is required');
const pool = new Pool({ connectionString: url });

// ── Canonical BMI course catalogue ────────────────────────────────────────────
// 204 courses across all departments and levels.
// Format: [code, title, description, credits, level, department_code]
const COURSES: [string, string, string, number, string, string][] = [
  // ── Diploma in Christian Ministry and Theology ─────────────────────────────
  ['DCMT101','Introduction to Christian Ministry','Foundations of Christian ministry including calling, service, and basic theology.',3,'diploma','DML'],
  ['DCMT102','Biblical Foundations','Survey of Old and New Testament narratives and theology.',3,'diploma','DML'],
  ['DCMT103','Spiritual Formation I','Disciplines and practices for personal spiritual growth.',3,'diploma','DML'],
  ['DCMT104','Homiletics Basics','Introduction to preaching and sermon preparation.',3,'diploma','DML'],
  ['DCMT105','Church Administration','Principles of managing and organizing a local church.',3,'diploma','DML'],
  ['DCMT106','Pastoral Care','Fundamentals of counseling and shepherding congregants.',3,'diploma','DML'],
  ['DCMT107','Evangelism and Outreach','Methods and theology of sharing the Gospel.',3,'diploma','DML'],
  ['DCMT108','Christian Ethics','Biblical principles for ethical decision-making.',3,'diploma','DML'],
  ['DCMT109','Worship and Liturgy','Overview of Christian worship traditions and practices.',3,'diploma','DML'],
  ['DCMT110','Ministry Practicum','Supervised field placement in a local church context.',6,'diploma','DML'],

  // ── BA in Biblical Studies ─────────────────────────────────────────────────
  ['BABS101','Old Testament Survey I','Pentateuch and historical books of the Old Testament.',3,'bachelor','DBS'],
  ['BABS102','Old Testament Survey II','Poetry, wisdom, and prophetic literature.',3,'bachelor','DBS'],
  ['BABS103','New Testament Survey I','Gospels and Acts: life, ministry, and early church.',3,'bachelor','DBS'],
  ['BABS104','New Testament Survey II','Epistles and Revelation: doctrine and eschatology.',3,'bachelor','DBS'],
  ['BABS201','Biblical Hermeneutics','Principles and methods of biblical interpretation.',3,'bachelor','DBS'],
  ['BABS202','Greek I','Introduction to New Testament Greek grammar.',3,'bachelor','DBS'],
  ['BABS203','Hebrew I','Introduction to Biblical Hebrew grammar.',3,'bachelor','DBS'],
  ['BABS204','Systematic Theology I','Doctrine of God, Scripture, and humanity.',3,'bachelor','DBS'],
  ['BABS205','Systematic Theology II','Salvation, church, and last things.',3,'bachelor','DBS'],
  ['BABS301','Biblical Archaeology','Archaeological discoveries and their biblical significance.',3,'bachelor','DBS'],
  ['BABS302','Intertestamental Period','Jewish history and literature between the Testaments.',3,'bachelor','DBS'],
  ['BABS303','Pauline Epistles','In-depth study of Paul\u2019s letters and theology.',3,'bachelor','DBS'],
  ['BABS304','Johannine Literature','Gospel of John, Epistles, and Revelation.',3,'bachelor','DBS'],
  ['BABS305','Biblical Theology','Tracing redemptive themes across Scripture.',3,'bachelor','DBS'],
  ['BABS401','Senior Seminar: Biblical Studies','Capstone integration of biblical scholarship.',3,'bachelor','DBS'],
  ['BABS402','Research Methods in Biblical Studies','Academic research, writing, and source analysis.',3,'bachelor','DBS'],
  ['BABS403','Senior Thesis','Original research project in biblical studies.',6,'bachelor','DBS'],

  // ── BA in Christian Education ──────────────────────────────────────────────
  ['BACE101','Introduction to Christian Education','Philosophy and history of Christian education.',3,'bachelor','DCE'],
  ['BACE102','Child Development and Faith Formation','Developmental psychology applied to faith nurture.',3,'bachelor','DCE'],
  ['BACE103','Teaching Methods','Principles and practices of effective Christian teaching.',3,'bachelor','DCE'],
  ['BACE201','Curriculum Design','Planning and developing Christian education curricula.',3,'bachelor','DCE'],
  ['BACE202','Youth Ministry','Theology and practice of ministry to young people.',3,'bachelor','DCE'],
  ['BACE203','Family Ministry','Supporting and equipping families in the church.',3,'bachelor','DCE'],
  ['BACE204','Adult Education in the Church','Teaching adults in ministry and church settings.',3,'bachelor','DCE'],
  ['BACE301','Educational Leadership','Leadership theory applied to educational ministry.',3,'bachelor','DCE'],
  ['BACE302','Special Education and Inclusion','Ministering to learners with diverse needs.',3,'bachelor','DCE'],
  ['BACE303','Technology in Christian Education','Integrating digital tools into ministry learning.',3,'bachelor','DCE'],
  ['BACE401','Practicum in Christian Education','Supervised field experience in an educational ministry.',6,'bachelor','DCE'],
  ['BACE402','Senior Capstone: Christian Education','Integrative project in Christian education.',3,'bachelor','DCE'],

  // ── BA in Ministry Leadership ──────────────────────────────────────────────
  ['BAML101','Foundations of Ministry Leadership','Biblical basis and theology of Christian leadership.',3,'bachelor','DML'],
  ['BAML102','Leadership Theory','Classical and contemporary leadership frameworks.',3,'bachelor','DML'],
  ['BAML103','Preaching and Communication','Developing skills in pulpit and public ministry.',3,'bachelor','DML'],
  ['BAML201','Church Planting Essentials','Principles for starting and growing new churches.',3,'bachelor','DML'],
  ['BAML202','Pastoral Ministry','Theology and practice of pastoral care and oversight.',3,'bachelor','DML'],
  ['BAML203','Conflict Resolution in Ministry','Biblical approaches to managing church conflict.',3,'bachelor','DML'],
  ['BAML204','Strategic Ministry Planning','Vision casting, goal setting, and organizational planning.',3,'bachelor','DML'],
  ['BAML301','Community Development','Engaging and transforming communities through ministry.',3,'bachelor','DML'],
  ['BAML302','Nonprofit and Church Administration','Legal, financial, and operational ministry management.',3,'bachelor','DML'],
  ['BAML303','Mentoring and Discipleship','Models and methods for spiritual mentoring.',3,'bachelor','DML'],
  ['BAML401','Ministry Leadership Practicum','Field placement in a ministry leadership context.',6,'bachelor','DML'],
  ['BAML402','Senior Capstone: Ministry Leadership','Integrative capstone project for ministry leaders.',3,'bachelor','DML'],

  // ── BA in Theological Studies ──────────────────────────────────────────────
  ['BATS101','Introduction to Theology','Foundations of Christian theological thought.',3,'bachelor','DBS'],
  ['BATS102','History of Christianity I','Early church to the Reformation.',3,'bachelor','DBS'],
  ['BATS103','History of Christianity II','Post-Reformation to the modern era.',3,'bachelor','DBS'],
  ['BATS201','Historical Theology','Development of Christian doctrine through the centuries.',3,'bachelor','DBS'],
  ['BATS202','Philosophy of Religion','Philosophical arguments for and against religious belief.',3,'bachelor','DBS'],
  ['BATS203','Comparative World Religions','Survey of major world religions from a Christian perspective.',3,'bachelor','DBS'],
  ['BATS204','Christian Social Ethics','Application of Christian ethics to social and political life.',3,'bachelor','DBS'],
  ['BATS301','Reformed Theology','Study of Calvinist and Reformed theological tradition.',3,'bachelor','DBS'],
  ['BATS302','Pentecostal and Charismatic Theology','Theology and praxis of Spirit-empowered movements.',3,'bachelor','DBS'],
  ['BATS303','Ecumenism and Interfaith Dialogue','Christian unity and engagement with other faiths.',3,'bachelor','DBS'],
  ['BATS401','Theological Thesis','Independent theological research and writing.',6,'bachelor','DBS'],
  ['BATS402','Senior Seminar: Theology','Capstone discussion of contemporary theological issues.',3,'bachelor','DBS'],

  // ── BA in Worship Leadership ───────────────────────────────────────────────
  ['BAWL101','Theology of Worship','Biblical and theological foundations of Christian worship.',3,'bachelor','DWA'],
  ['BAWL102','Music Theory for Worship','Fundamentals of music theory in a worship context.',3,'bachelor','DWA'],
  ['BAWL103','Worship Leading Practicals','Skills for leading congregational worship.',3,'bachelor','DWA'],
  ['BAWL201','Liturgy and Sacraments','History and theology of Christian liturgical practice.',3,'bachelor','DWA'],
  ['BAWL202','Songwriting for the Church','Crafting songs rooted in Scripture and theology.',3,'bachelor','DWA'],
  ['BAWL203','Worship Team Dynamics','Building and directing an effective worship team.',3,'bachelor','DWA'],
  ['BAWL204','Arts in Worship','Integrating visual arts, dance, and drama into worship.',3,'bachelor','DWA'],
  ['BAWL301','Cross-Cultural Worship','Global worship expressions and contextualization.',3,'bachelor','DWA'],
  ['BAWL302','Technology in Worship','Sound, lighting, and media production for worship.',3,'bachelor','DWA'],
  ['BAWL303','Contemplative Spirituality','Ancient practices of prayer and spiritual formation.',3,'bachelor','DWA'],
  ['BAWL401','Worship Leadership Practicum','Supervised ministry placement in a worship context.',6,'bachelor','DWA'],
  ['BAWL402','Senior Capstone: Worship Leadership','Integrative project in worship ministry.',3,'bachelor','DWA'],

  // ── Master of Divinity (MDiv) ──────────────────────────────────────────────
  ['MDIV501','Old Testament Exegesis','Advanced study of Old Testament texts in the original languages.',3,'master','DBS'],
  ['MDIV502','New Testament Exegesis','Advanced study of New Testament texts in Greek.',3,'master','DBS'],
  ['MDIV503','Advanced Systematic Theology','Comprehensive engagement with the loci of systematic theology.',3,'master','DBS'],
  ['MDIV504','Christian Formation and Discipleship','Theology and practice of forming disciples.',3,'master','DML'],
  ['MDIV505','Preaching: Theory and Practice','Advanced homiletics and preaching practicum.',3,'master','DPH'],
  ['MDIV506','Pastoral Counseling','Integration of psychology and theology in pastoral care.',3,'master','DML'],
  ['MDIV507','Church History: Advanced Topics','Specialized seminar in historical theological development.',3,'master','DBS'],
  ['MDIV508','Ministry Contexts and Culture','Cultural analysis for contextual ministry.',3,'master','DML'],
  ['MDIV509','Leadership and Administration','Advanced church leadership and organizational management.',3,'master','DML'],
  ['MDIV510','World Missions and Evangelism','Theology and strategy of global missions.',3,'master','DME'],
  ['MDIV511','Supervised Ministry I','Field placement with reflection and mentoring.',3,'master','DML'],
  ['MDIV512','Supervised Ministry II','Continued field placement emphasizing leadership competencies.',3,'master','DML'],
  ['MDIV513','Ministry Capstone Project','Substantial final project demonstrating ministerial readiness.',6,'master','DML'],

  // ── MA in Christian Counseling ─────────────────────────────────────────────
  ['MACC501','Foundations of Christian Counseling','Integration of faith and counseling theory.',3,'master','DGC'],
  ['MACC502','Counseling Theory and Techniques','Overview of major counseling theories and interventions.',3,'master','DGC'],
  ['MACC503','Human Development Across the Lifespan','Developmental psychology from a Christian perspective.',3,'master','DGC'],
  ['MACC504','Psychopathology and Diagnosis','Study of mental disorders and diagnostic frameworks.',3,'master','DGC'],
  ['MACC505','Group Counseling','Theory and practice of therapeutic group work.',3,'master','DGC'],
  ['MACC506','Marriage and Family Therapy','Systems approach to relational and family issues.',3,'master','DGC'],
  ['MACC507','Trauma-Informed Care','Christian approaches to trauma, grief, and crisis counseling.',3,'master','DGC'],
  ['MACC508','Research Methods in Counseling','Research design and evidence-based practice.',3,'master','DGC'],
  ['MACC509','Counseling Practicum I','Supervised clinical experience in a ministry context.',3,'master','DGC'],
  ['MACC510','Counseling Practicum II','Advanced supervised clinical experience.',3,'master','DGC'],
  ['MACC511','Professional Ethics in Counseling','Legal, ethical, and spiritual considerations for counselors.',3,'master','DGC'],
  ['MACC512','Counseling Capstone','Case conceptualization and integrative final project.',6,'master','DGC'],

  // ── MA in Theological Studies ──────────────────────────────────────────────
  ['MATS501','Advanced Biblical Hermeneutics','Graduate-level methods of interpretation.',3,'master','DBS'],
  ['MATS502','Contemporary Systematic Theology','Modern theological methodology and constructive theology.',3,'master','DBS'],
  ['MATS503','Patristics and Medieval Theology','Theological thought of the early and medieval church.',3,'master','DBS'],
  ['MATS504','Reformation and Post-Reformation Theology','Luther, Calvin, and their theological legacy.',3,'master','DBS'],
  ['MATS505','Modern Theological Movements','Liberalism, neo-orthodoxy, liberation theology, and more.',3,'master','DBS'],
  ['MATS506','Theological Anthropology','Christian doctrines of humanity, sin, and identity.',3,'master','DBS'],
  ['MATS507','Theology and Culture','Engaging culture through a theological lens.',3,'master','DBS'],
  ['MATS508','Theological Research Seminar','Research methodology, writing, and professional scholarly formation.',3,'master','DBS'],
  ['MATS509','Theology Thesis','Original research contributing to theological knowledge.',6,'master','DBS'],

  // ── MA in Christian Education ──────────────────────────────────────────────
  ['MACE501','Advanced Christian Education Theory','Philosophical and theological foundations of Christian learning.',3,'master','DCE'],
  ['MACE502','Educational Psychology for Ministry','Cognitive and developmental theories applied to ministry learning.',3,'master','DCE'],
  ['MACE503','Curriculum Design and Evaluation','Graduate-level curriculum theory and program assessment.',3,'master','DCE'],
  ['MACE504','Leadership in Christian Educational Institutions','Managing and leading Christian schools and ministry organizations.',3,'master','DCE'],
  ['MACE505','Research in Christian Education','Qualitative and quantitative methods for educational ministry research.',3,'master','DCE'],
  ['MACE506','Online and Distance Learning in Ministry','Technology-enabled education in faith-based contexts.',3,'master','DCE'],
  ['MACE507','Practicum in Christian Educational Leadership','Supervised field experience in a Christian educational setting.',3,'master','DCE'],
  ['MACE508','Capstone Project in Christian Education','Culminating research-based or professional project.',6,'master','DCE'],

  // ── MA in Christian Apologetics ───────────────────────────────────────────
  ['MACA501','Philosophy and Christian Faith','Philosophical analysis of Christian truth claims.',3,'master','DCA'],
  ['MACA502','Evidential Apologetics','Evidence for the resurrection, reliability of Scripture, and the existence of God.',3,'master','DCA'],
  ['MACA503','Presuppositional Apologetics','Van Til, Bahnsen, and the presuppositional method.',3,'master','DCA'],
  ['MACA504','Christian Responses to World Religions','Engaging Islam, Buddhism, Hinduism, and other major worldviews.',3,'master','DCA'],
  ['MACA505','Science and Christian Faith','Engaging scientific challenges to faith: creation, evolution, and cosmology.',3,'master','DCA'],
  ['MACA506','Postmodernism and the Gospel','Engaging pluralism, relativism, and deconstruction.',3,'master','DCA'],
  ['MACA507','Ethics and Natural Law','Natural law theory and Christian moral philosophy.',3,'master','DCA'],
  ['MACA508','Apologetics Practicum','Applied apologetics in ministry and public engagement.',3,'master','DCA'],
  ['MACA509','Apologetics Research Project','Integrative research project in Christian apologetics.',6,'master','DCA'],

  // ── MA in Christian Leadership ─────────────────────────────────────────────
  ['MACL501','Leadership Theory and Practice','Comprehensive study of leadership models and styles.',3,'master','DML'],
  ['MACL502','Organizational Behavior in Ministry','Group dynamics, culture, and change in ministry organizations.',3,'master','DML'],
  ['MACL503','Strategic Planning for Ministry','Mission, vision, and strategic direction for ministry organizations.',3,'master','DML'],
  ['MACL504','Financial Stewardship and Fundraising','Budgeting, financial management, and resource development.',3,'master','DML'],
  ['MACL505','Team Building and Human Resources','Recruiting, developing, and retaining ministry teams.',3,'master','DML'],
  ['MACL506','Ethics and Integrity in Leadership','Character formation and accountability for leaders.',3,'master','DML'],
  ['MACL507','Conflict and Change Management','Navigating organizational transition and conflict.',3,'master','DML'],
  ['MACL508','Leadership Capstone Project','Integrative leadership project addressing a real ministry challenge.',6,'master','DML'],

  // ── Doctor of Ministry (DMin) ──────────────────────────────────────────────
  ['DMIN701','Theology and Practice of Ministry','Advanced integration of theology and ministry praxis.',3,'doctorate','DML'],
  ['DMIN702','Leadership for the 21st Century','Emerging paradigms in ministry leadership.',3,'doctorate','DML'],
  ['DMIN703','Preaching in a Postmodern World','Homiletical strategies for diverse contemporary audiences.',3,'doctorate','DPH'],
  ['DMIN704','Ministry Research Methods','Advanced qualitative and quantitative research in ministry.',3,'doctorate','DML'],
  ['DMIN705','Spiritual Direction','Theology and practice of accompanying others spiritually.',3,'doctorate','DML'],
  ['DMIN706','DMin Dissertation Proposal Seminar','Developing and defending a doctoral research proposal.',3,'doctorate','DML'],
  ['DMIN707','DMin Dissertation I','Execution of original applied research in ministry.',6,'doctorate','DML'],
  ['DMIN708','DMin Dissertation II','Completion, revision, and defense of the doctoral dissertation.',6,'doctorate','DML'],

  // ── Doctor of Christian Education ─────────────────────────────────────────
  ['DCE701','Philosophy of Education','Foundational philosophical frameworks for educational thought.',3,'doctorate','DCE'],
  ['DCE702','Advanced Educational Research I','Quantitative research design and analysis.',3,'doctorate','DCE'],
  ['DCE703','Advanced Educational Research II','Qualitative research methods and ethnographic approaches.',3,'doctorate','DCE'],
  ['DCE704','Transformational Leadership in Education','Leading change in Christian educational institutions.',3,'doctorate','DCE'],
  ['DCE705','Higher Education Administration','Policy, governance, and management in Christian higher education.',3,'doctorate','DCE'],
  ['DCE706','Dissertation Proposal','Developing a doctoral research proposal in Christian education.',3,'doctorate','DCE'],
  ['DCE707','Doctoral Dissertation I','Original research contribution to the field.',6,'doctorate','DCE'],
  ['DCE708','Doctoral Dissertation II','Dissertation completion and oral defense.',6,'doctorate','DCE'],

  // ── Graduate Certificate in Christian Studies ──────────────────────────────
  ['GCCS501','Christian Worldview and Culture','Understanding and applying a biblical worldview to contemporary life.',3,'certificate','DBS'],
  ['GCCS502','Essentials of Christian Theology','Survey of core Christian doctrines.',3,'certificate','DBS'],
  ['GCCS503','Introduction to Biblical Studies','Methods and overview of biblical interpretation.',3,'certificate','DBS'],
  ['GCCS504','Faith and Personal Calling','Discerning and developing a sense of Christian vocation.',3,'certificate','DBS'],
  ['GCCS505','Practicum: Christian Service','Supervised service-learning in a Christian context.',3,'certificate','DBS'],
  ['GCCS506','Christian Studies Capstone','Integrative reflection on Christian worldview and calling.',3,'certificate','DBS'],

  // ── Graduate Certificate in Spiritual Formation ────────────────────────────
  ['GCSF501','Foundations of Spiritual Formation','Theology and history of Christian spiritual formation.',3,'certificate','DML'],
  ['GCSF502','Disciplines of the Spirit','Classic and contemplative spiritual disciplines.',3,'certificate','DML'],
  ['GCSF503','Prayer and Contemplation','Theology and practice of prayer in the Christian tradition.',3,'certificate','DML'],
  ['GCSF504','Spiritual Direction Practicum','Introduction to the practice of accompanying others spiritually.',3,'certificate','DML'],
  ['GCSF505','Community and Spiritual Growth','Formation within the context of the local church and small group.',3,'certificate','DML'],
  ['GCSF506','Spiritual Formation Capstone','Integrative project in personal and communal formation.',3,'certificate','DML'],
];

// Map department codes to their department IDs as seeded by seed-programs-neon.ts
const DEPT_CODE_TO_ID: Record<string, string> = {
  DBS: 'd-biblical',
  DML: 'd-ministry',
  DCC: 'd-counseling',
  DCE: 'd-education',
  DCA: 'd-apologetics',
  DWA: 'd-worship',
  DME: 'd-missions',
  DPH: 'd-preaching',
  DGC: 'd-grad-counsel',
};

async function main() {
  console.log('🌱 Connecting to Neon database...');

  // Verify departments exist first
  const deptCheck = await pool.query(`SELECT code FROM departments`);
  const existingDepts = new Set(deptCheck.rows.map((r: { code: string }) => r.code));
  console.log(`✅ Found ${existingDepts.size} departments in Neon`);

  if (existingDepts.size === 0) {
    console.error('❌ No departments found! Run seed-programs-neon.ts first.');
    process.exit(1);
  }

  console.log(`📚 Upserting ${COURSES.length} courses...`);
  let success = 0;
  let errors = 0;

  for (const [code, title, description, credits, level, deptCode] of COURSES) {
    const departmentId = DEPT_CODE_TO_ID[deptCode] ?? null;
    try {
      await pool.query(
        `INSERT INTO courses (id, code, title, description, credits, term, capacity, level, department_id, is_active)
         VALUES (
           replace(gen_random_uuid()::text, '-', ''),
           $1, $2, $3, $4, 'Ongoing', 150, $5, $6, 1
         )
         ON CONFLICT (code) DO UPDATE SET
           title        = EXCLUDED.title,
           description  = EXCLUDED.description,
           credits      = EXCLUDED.credits,
           level        = EXCLUDED.level,
           department_id = EXCLUDED.department_id,
           is_active    = 1`,
        [code, title, description, credits, level, departmentId]
      );
      success++;
    } catch (e) {
      console.error(`  ❌ Failed to upsert ${code}:`, (e as Error).message);
      errors++;
    }
  }

  console.log(`\n✅ ${success} courses upserted successfully`);
  if (errors > 0) console.log(`⚠️  ${errors} courses had errors`);

  // Final verification
  const result = await pool.query(`
    SELECT d.code as dept, COUNT(c.id)::int as count
    FROM courses c
    LEFT JOIN departments d ON c.department_id = d.id
    GROUP BY d.code
    ORDER BY count DESC
  `);
  console.log('\n📊 Courses by department:');
  console.table(result.rows);

  const total = await pool.query(`SELECT COUNT(*)::int as total FROM courses`);
  console.log(`\n🎉 Total courses in Neon: ${total.rows[0].total}`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
