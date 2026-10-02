import fs from 'fs';
import path from 'path';

// Define approved subject prefixes regex
const VALID_COURSE_CODE_REGEX = /^[A-Z]{3,5}[0-9]{3}$/;

// 1. All Canonical Courses
const CANONICAL_COURSES = [
  // ── Biblical Studies ──
  { code: 'BIBL101', title: 'Introduction to the Bible', credits: 3, level: '100', desc: 'Foundational introduction to the structure, canon, historical context, and major themes of the Holy Scriptures.' },
  { code: 'BIBL102', title: 'Old Testament Survey I', credits: 3, level: '100', desc: 'Survey of the Pentateuch and Historical Books, tracing the redemptive historical narrative of Israel.' },
  { code: 'BIBL103', title: 'New Testament Survey I', credits: 3, level: '100', desc: 'Introduction to the Gospels and Acts, focusing on the life, ministry, death, and resurrection of Jesus Christ and the early church.' },
  { code: 'BIBL104', title: 'New Testament Survey II', credits: 3, level: '100', desc: 'Introduction to the Epistles and Revelation, examining apostolic theology and eschatological themes.' },
  { code: 'BIBL201', title: 'Old Testament Survey II', credits: 3, level: '200', desc: 'Comprehensive study of Old Testament Poetic, Wisdom, and Prophetic Literature within historical and theological contexts.' },
  { code: 'BIBL202', title: 'New Testament Survey II', credits: 3, level: '200', desc: 'In-depth survey of the Apostolic writings from Romans to Revelation with emphasis on Christology and Christian living.' },
  { code: 'BIBL210', title: 'Biblical Hermeneutics', credits: 3, level: '200', desc: 'Principles and methods of sound biblical interpretation, exegesis, grammatical-historical hermeneutics, and avoiding misinterpretation.' },
  { code: 'BIBL301', title: 'Biblical Theology', credits: 3, level: '300', desc: 'Thematic and developmental study of key redemptive themes spanning the Old and New Testaments.' },
  { code: 'BIBL302', title: 'Pentateuch', credits: 3, level: '300', desc: 'Detailed literary, historical, and theological study of Genesis through Deuteronomy.' },
  { code: 'BIBL303', title: 'Historical Books', credits: 3, level: '300', desc: 'Theological and historical analysis of Joshua through Esther.' },
  { code: 'BIBL304', title: 'Wisdom and Poetic Literature', credits: 3, level: '300', desc: 'Exegetical and practical exploration of Job, Psalms, Proverbs, Ecclesiastes, and Song of Songs.' },
  { code: 'BIBL305', title: 'Prophetic Literature', credits: 3, level: '300', desc: 'Historical contexts, prophetic calling, messianic themes, and theological message of the Major and Minor Prophets.' },
  { code: 'BIBL306', title: 'Gospels and Acts', credits: 3, level: '300', desc: 'Comparative study of the Four Gospels and Luke\'s account of early church expansion in Acts.' },
  { code: 'BIBL307', title: 'Pauline Epistles', credits: 3, level: '300', desc: 'Exegetical study of the life, letters, and theology of the Apostle Paul.' },
  { code: 'BIBL308', title: 'General Epistles and Revelation', credits: 3, level: '300', desc: 'Theological examination of Hebrews, James, Peter, John, Jude, and the Apocalypse.' },
  { code: 'BIBL401', title: 'Advanced Biblical Exegesis', credits: 3, level: '400', desc: 'Methodological synthesis of textual criticism, grammatical exegesis, and contextual application of biblical passages.' },
  { code: 'BIBL402', title: 'Biblical Backgrounds and Archaeology', credits: 3, level: '400', desc: 'Ancient Near Eastern and Greco-Roman archaeological and cultural backgrounds illuminating Scripture.' },
  { code: 'BIBL501', title: 'Advanced Biblical Interpretation', credits: 3, level: '500', desc: 'Graduate-level hermeneutical models, critical methodologies, and theological synthesis of biblical texts.' },

  // ── Biblical Languages ──
  { code: 'LANG201', title: 'Biblical Greek I', credits: 3, level: '200', desc: 'Introduction to Koine Greek grammar, vocabulary, noun declensions, and basic verb paradigms.' },
  { code: 'LANG202', title: 'Biblical Greek II', credits: 3, level: '200', desc: 'Continuation of Biblical Greek I, covering irregular verbs, participles, syntax, and translation of selected New Testament passages.' },
  { code: 'LANG301', title: 'Biblical Hebrew I', credits: 3, level: '300', desc: 'Introduction to biblical Hebrew alphabet, vowel pointing, basic grammar, and core vocabulary.' },
  { code: 'LANG302', title: 'Biblical Hebrew II', credits: 3, level: '300', desc: 'Continuation of Biblical Hebrew I, strong and weak verbs, syntax, and translation from the Hebrew Scriptures.' },
  { code: 'LANG501', title: 'Advanced Greek Exegesis', credits: 3, level: '500', desc: 'Graduate-level syntax and guided exegesis of theological treatises and Pauline letters in the Greek New Testament.' },
  { code: 'LANG502', title: 'Advanced Hebrew Exegesis', credits: 3, level: '500', desc: 'Graduate-level exegesis of narrative, poetic, and prophetic Hebrew passages with discourse analysis.' },

  // ── Theology ──
  { code: 'THEO101', title: 'Systematic Theology I', credits: 3, level: '100', desc: 'Introduction to Christian doctrine: attributes of God, Trinity, creation, providence, and the person and work of Christ.' },
  { code: 'THEO102', title: 'Systematic Theology II', credits: 3, level: '100', desc: 'Continuation of Christian doctrine: sin, salvation, Holy Spirit, church, sacraments, and eschatology.' },
  { code: 'THEO103', title: 'Biblical Hermeneutics Foundations', credits: 3, level: '100', desc: 'Introductory methods for interpreting biblical scripture in personal and ministry contexts.' },
  { code: 'THEO201', title: 'Christian Theology I', credits: 3, level: '200', desc: 'Core Christian doctrines including God, Trinity, Revelation, Creation, and Christology.' },
  { code: 'THEO202', title: 'Christian Theology II', credits: 3, level: '200', desc: 'Doctrines of Pneumatology, Ecclesiology, Salvation, Christian Ethics, and Eschatology.' },
  { code: 'THEO301', title: 'Biblical Theology', credits: 3, level: '300', desc: 'Examination of progressive divine revelation across covenants and biblical theological trajectories.' },
  { code: 'THEO302', title: 'Systematic Theology I', credits: 3, level: '300', desc: 'Prolegomena, Theology Proper, Divine Decrees, Anthropology, and Hamartiology.' },
  { code: 'THEO303', title: 'Systematic Theology II', credits: 3, level: '300', desc: 'Christology, Pneumatology, Soteriology, Ecclesiology, and Eschatology in historical and contemporary debate.' },
  { code: 'THEO304', title: 'Theology of the Holy Spirit and the Church', credits: 3, level: '300', desc: 'Pneumatological foundations, spiritual gifts, Pentecostal/Charismatic perspectives, and church renewal.' },
  { code: 'THEO305', title: 'Christology', credits: 3, level: '300', desc: 'The person, natures, incarnational glory, atonement, and resurrected reign of Jesus Christ.' },
  { code: 'THEO306', title: 'Doctrine of Salvation', credits: 3, level: '300', desc: 'Soteriological models, regeneration, justification, sanctification, and eternal redemption.' },
  { code: 'THEO307', title: 'Eschatology', credits: 3, level: '300', desc: 'Biblical prophecies, the Second Coming, resurrection, judgment, millenarian views, and the New Creation.' },
  { code: 'THEO308', title: 'Christian Ethics', credits: 3, level: '300', desc: 'Biblical moral philosophy applied to contemporary social, biomedical, sexual, and leadership dilemmas.' },
  { code: 'THEO309', title: 'Theology and Culture', credits: 3, level: '300', desc: 'Theological discernment of cultural movements, media, postmodernity, and public theology.' },
  { code: 'THEO310', title: 'Philosophy of Religion', credits: 3, level: '300', desc: 'Philosophical inquiry into the existence of God, problem of evil, epistemology of faith, and religious realism.' },
  { code: 'THEO401', title: 'Contemporary Theology', credits: 3, level: '400', desc: 'Major twentieth- and twenty-first-century theological developments, movements, and thinkers.' },
  { code: 'THEO402', title: 'Theology of Mission', credits: 3, level: '400', desc: 'The Missio Dei, biblical foundations of global evangelism, and contextualization of the Gospel.' },
  { code: 'THEO403', title: 'World Religions and Christian Theology', credits: 3, level: '400', desc: 'Theological assessment of Islam, Hinduism, Buddhism, traditional religions, and Christian uniqueness.' },
  { code: 'THEO501', title: 'Advanced Systematic Theology', credits: 3, level: '500', desc: 'Seminar in comprehensive dogmatics, classical controversies, and contemporary theological debates.' },
  { code: 'THEO510', title: 'Historical and Contemporary Theology', credits: 3, level: '500', desc: 'Integration of patristic, reformational, and modern theological trajectories in graduate research.' },

  // ── Church History ──
  { code: 'CHST101', title: 'Church History I', credits: 3, level: '100', desc: 'Survey of Christian history from the Apostolic era through the Reformation (100–1517 AD).' },
  { code: 'CHST102', title: 'Church History II', credits: 3, level: '100', desc: 'Survey of Christian history from the Reformation to the modern era, including global church movements.' },
  { code: 'CHST201', title: 'Church History I', credits: 3, level: '200', desc: 'Early Church, ecumenical councils, medieval Christianity, and the Protestant Reformation.' },
  { code: 'CHST202', title: 'Church History II', credits: 3, level: '200', desc: 'Post-Reformation developments, evangelical awakenings, modern missions, and global Christianity.' },
  { code: 'CHST301', title: 'History of Christian Doctrine', credits: 3, level: '300', desc: 'Historical development of core Christian dogmas from Patristic controversies to modern confessions.' },
  { code: 'CHST501', title: 'Advanced Church History', credits: 3, level: '500', desc: 'Graduate-level analysis of primary historical documents, historiography, and key reform movements.' },
  { code: 'CHST502', title: 'Church History and Global Christianity', credits: 3, level: '500', desc: 'The rise of Christianity in the Global South, African church history, and cross-cultural missional history.' },

  // ── Ministry & Pastoral ──
  { code: 'MIN101', title: 'Introduction to Ministry', credits: 3, level: '100', desc: 'Survey of vocational ministry callings, church leadership structures, and pastoral ethics.' },
  { code: 'MIN102', title: 'Homiletics I: Preaching Foundations', credits: 3, level: '100', desc: 'Foundations of sermon construction, biblical exposition, and pulpit communication.' },
  { code: 'MIN201', title: 'Introduction to Christian Ministry', credits: 3, level: '200', desc: 'Biblical call to ministry, shepherding principles, pastoral care, and ministerial integrity.' },
  { code: 'MIN202', title: 'Church and Ministry Administration', credits: 3, level: '200', desc: 'Practical church governance, financial stewardship, volunteer management, and legal compliance.' },
  { code: 'MIN301', title: 'Ministry Ethics and Professional Practice', credits: 3, level: '300', desc: 'Ethical conduct for ministers, confidentiality, power dynamics, accountability, and boundaries.' },
  { code: 'MIN302', title: 'Missions and Cross-Cultural Ministry', credits: 3, level: '300', desc: 'Theological and anthropological principles for effective intercultural ministry and evangelism.' },
  { code: 'MIN401', title: 'Ministry Practicum', credits: 3, level: '400', desc: 'Supervised practical field ministry placement in local churches or approved Christian organizations.' },
  { code: 'MIN501', title: 'Advanced Ministry Studies', credits: 3, level: '500', desc: 'Graduate seminar examining complex institutional, ethical, and pastoral challenges in contemporary ministry.' },
  { code: 'PAST301', title: 'Pastoral Care and Counseling', credits: 3, level: '300', desc: 'Principles and practice of pastoral counseling, hospital visitation, grief care, and crisis intervention.' },
  { code: 'PAST501', title: 'Pastoral Theology & Practice', credits: 3, level: '500', desc: 'Advanced pastoral theology, pastoral leadership, liturgy, crisis ministry, and minister\'s soul care.' },

  // ── Missions ──
  { code: 'MISS201', title: 'Introduction to Christian Missions', credits: 3, level: '200', desc: 'Biblical mandate for missions, historical overview of modern missionary movements, and intercultural awareness.' },
  { code: 'MISS302', title: 'Cross-Cultural Missions & Engagement', credits: 3, level: '300', desc: 'Contextualization, indigenous church planting principles, and cross-cultural missional strategies.' },
  { code: 'MISS501', title: 'Global Missiology and Intercultural Ministry', credits: 3, level: '500', desc: 'Advanced missiological frameworks, urban mission dynamics, and missionary strategy in a globalized world.' },
  { code: 'MISS502', title: 'Theology of Mission', credits: 3, level: '500', desc: 'Biblical, historical, and contemporary perspectives on Christian mission, evangelism, and Kingdom expansion.' },

  // ── Leadership ──
  { code: 'LEAD201', title: 'Foundations of Christian Leadership', credits: 3, level: '200', desc: 'Biblical theology of servant leadership, personal character, self-leadership, and visionary integrity.' },
  { code: 'LEAD301', title: 'Leadership and Team Development', credits: 3, level: '300', desc: 'Building, mentoring, empowering, and evaluating collaborative ministry teams.' },
  { code: 'LEAD302', title: 'Conflict Management and Reconciliation', credits: 3, level: '300', desc: 'Biblical models of dispute resolution, institutional peacemaking, and restorative leadership.' },
  { code: 'LEAD401', title: 'Strategic Leadership for Churches', credits: 3, level: '400', desc: 'Strategic planning, organizational alignment, vision casting, and execution in ministry organizations.' },
  { code: 'LEAD402', title: 'Church Growth and Development', credits: 3, level: '400', desc: 'Principles of healthy church expansion, community engagement, and multiplication dynamics.' },
  { code: 'LEAD501', title: 'Foundations of Christian Leadership', credits: 3, level: '500', desc: 'Graduate-level leadership theory, biblical leadership paradigms, and executive ministry stewardship.' },
  { code: 'LEAD502', title: 'Leadership Formation and Character', credits: 3, level: '500', desc: 'Spiritual disciplines, emotional intelligence, resilience, and ethical fortitude in senior leadership.' },
  { code: 'LEAD503', title: 'Team Leadership and Development', credits: 3, level: '500', desc: 'High-performance team dynamics, delegation, staff culture cultivation, and coaching.' },
  { code: 'LEAD504', title: 'Conflict Management and Reconciliation', credits: 3, level: '500', desc: 'Mediation strategies, organizational crisis intervention, and restoring broken relationships.' },
  { code: 'LEAD505', title: 'Strategic Leadership for Ministry', credits: 3, level: '500', desc: 'Long-term planning, systems thinking, change management, and risk governance in Christian ministries.' },
  { code: 'LEAD506', title: 'Organizational Leadership', credits: 3, level: '500', desc: 'Organizational behavior, institutional governance, board dynamics, and institutional lifecycle transitions.' },
  { code: 'LEAD510', title: 'Church Polity and Leadership', credits: 3, level: '500', desc: 'Models of church government, congregational bylaws, ecclesiastical order, and executive administration.' },
  { code: 'LEAD601', title: 'Advanced Christian Leadership', credits: 3, level: '600', desc: 'Advanced seminar in visionary leadership, strategic communication, and executive decision-making.' },
  { code: 'LEAD602', title: 'Leadership, Culture and Change', credits: 3, level: '600', desc: 'Leading cultural change in organizations, managing transitions, and overcoming institutional inertia.' },
  { code: 'LEAD603', title: 'Leadership Research Methods', credits: 3, level: '600', desc: 'Quantitative and qualitative research applied to organizational leadership and ecclesial systems.' },
  { code: 'LEAD604', title: 'Leadership Practicum and Capstone', credits: 3, level: '600', desc: 'Culminating applied leadership project addressing a real-world ministry or institutional challenge.' },

  // ── Christian Education ──
  { code: 'CED101', title: 'Christian Education Foundations', credits: 3, level: '100', desc: 'Introduction to the philosophy, history, and practice of Christian education in the church and society.' },
  { code: 'CED201', title: 'Foundations of Christian Education', credits: 3, level: '200', desc: 'Biblical, theological, and historical foundations of Christian teaching ministries.' },
  { code: 'CED202', title: 'Philosophy of Christian Education', credits: 3, level: '200', desc: 'Comparative study of educational philosophies viewed through a biblical worldview.' },
  { code: 'CED301', title: 'Educational Psychology', credits: 3, level: '300', desc: 'Human learning theories, cognitive development, motivation, and spiritual maturation in Christian context.' },
  { code: 'CED302', title: 'Teaching and Learning in Christian Contexts', credits: 3, level: '300', desc: 'Instructional methodologies, lesson planning, active learning, and creative pedagogical techniques.' },
  { code: 'CED303', title: 'Curriculum Design and Development', credits: 3, level: '300', desc: 'Principles of curriculum development, learning outcomes, material selection, and evaluation.' },
  { code: 'CED304', title: 'Teaching the Bible', credits: 3, level: '300', desc: 'Transformational Bible teaching pedagogy for varied developmental age groups.' },
  { code: 'CED305', title: 'Discipleship and Spiritual Formation', credits: 3, level: '300', desc: 'Educational frameworks for intentional Christian discipleship and spiritual growth within congregations.' },
  { code: 'CED306', title: 'Christian Education in the Local Church', credits: 3, level: '300', desc: 'Organizing Sunday school, small groups, Bible studies, and church-wide Christian education programs.' },
  { code: 'CED307', title: 'Christian Education for Children', credits: 3, level: '300', desc: 'Child development, creative storytelling, family ministry partnerships, and children\'s church ministry.' },
  { code: 'CED308', title: 'Christian Education for Youth', credits: 3, level: '300', desc: 'Adolescent psychology, contemporary youth culture, campus ministry, and mentoring teens.' },
  { code: 'CED309', title: 'Adult Christian Education', credits: 3, level: '300', desc: 'Andragogy, adult life stages, small-group leadership, and senior adult ministry.' },
  { code: 'CED401', title: 'Educational Leadership', credits: 3, level: '400', desc: 'Leadership principles for Christian school headmasters, church educational directors, and administrators.' },
  { code: 'CED402', title: 'Assessment and Evaluation', credits: 3, level: '400', desc: 'Formative and summative assessment tools, program evaluation, and student progress measurements.' },
  { code: 'CED403', title: 'Educational Technology and Online Learning', credits: 3, level: '400', desc: 'Integrating digital learning platforms, multimedia tools, and distance learning into Christian instruction.' },
  { code: 'CED404', title: 'Christian Education Practicum', credits: 3, level: '400', desc: 'Supervised student teaching experience in Christian schools, church education departments, or camps.' },
  { code: 'CED501', title: 'Advanced Christian Education', credits: 3, level: '500', desc: 'Graduate exploration of advanced educational philosophy, transformational pedagogy, and leadership.' },
  { code: 'CED601', title: 'Advanced Curriculum and Instruction', credits: 3, level: '600', desc: 'Curriculum theory, systemic instructional design, and institutional accreditation standards.' },
  { code: 'CED701', title: 'Christian Education Research', credits: 3, level: '700', desc: 'Doctoral research methodologies, empirical study design, and dissertation preparation in Christian Education.' },

  // ── Christian Counseling ──
  { code: 'COUN101', title: 'Introduction to Christian Counseling', credits: 3, level: '100', desc: 'Foundational overview of biblical counseling principles, empathetic listening, and soul care.' },
  { code: 'COUN201', title: 'Christian Counseling / Marriage & Family', credits: 3, level: '200', desc: 'Biblical counseling foundations, marriage enrichment, parenting guidance, and counseling ethics for ministry.' },
  { code: 'COUN501', title: 'Christian Counseling Foundations', credits: 3, level: '500', desc: 'Theological integration of psychology and theology, counseling models, and Christian worldview foundations.' },
  { code: 'COUN502', title: 'Marriage and Family Counseling', credits: 3, level: '500', desc: 'Family systems theory, premarital counseling, marital conflict resolution, and divorce recovery.' },
  { code: 'COUN503', title: 'Trauma and Crisis Counseling', credits: 3, level: '500', desc: 'Intervention models for acute trauma, grief, PTSD, disaster mental health, and bereavement care.' },
  { code: 'COUN504', title: 'Counseling Ethics and Professional Practice', credits: 3, level: '500', desc: 'Legal and ethical standards in professional counseling, informed consent, confidentiality, and liability.' },
  { code: 'COUN505', title: 'Helping Relationships', credits: 3, level: '500', desc: 'Core counseling skills, therapeutic alliance, active listening, and empathetic communication.' },
  { code: 'COUN506', title: 'Lifespan Development', credits: 3, level: '500', desc: 'Physical, cognitive, psychological, and spiritual development across the human lifespan.' },
  { code: 'COUN507', title: 'Psychopathology', credits: 3, level: '500', desc: 'Diagnostic criteria, DSM classification, mood disorders, anxiety, and theological perspectives on mental illness.' },
  { code: 'COUN508', title: 'Multicultural Counseling', credits: 3, level: '500', desc: 'Cross-cultural competence, addressing diversity, ethnicity, socioeconomic factors, and counseling in global contexts.' },
  { code: 'COUN509', title: 'Group Dynamics', credits: 3, level: '500', desc: 'Theory and practice of group counseling, group facilitation, stages of group development, and support groups.' },
  { code: 'COUN510', title: 'Counseling Assessment', credits: 3, level: '500', desc: 'Psychological assessment, testing instruments, clinical intake interviews, and appraisal techniques.' },
  { code: 'COUN511', title: 'Crisis and Addictions Counseling', credits: 3, level: '500', desc: 'Substance use disorders, behavioral addictions, recovery models, and spiritual deliverance pathways.' },
  { code: 'COUN512', title: 'Career Counseling', credits: 3, level: '500', desc: 'Career development theories, vocational calling, assessment, and life planning.' },
  { code: 'COUN601', title: 'Advanced Christian Counseling Models and Practice', credits: 3, level: '600', desc: 'Advanced integration of cognitive-behavioral, psychodynamic, and narrative therapies with Christian faith.' },
  { code: 'COUN602', title: 'Clinical Counseling Practicum I', credits: 3, level: '600', desc: 'Supervised clinical counseling practicum with individual client hours and faculty case supervision.' },
  { code: 'COUN603', title: 'Clinical Counseling Practicum II', credits: 3, level: '600', desc: 'Advanced supervised clinical field placement with direct client contact and clinical review.' },
  { code: 'COUN604', title: 'Clinical Counseling Practicum III', credits: 3, level: '600', desc: 'Comprehensive internship capstone in an approved clinical counseling facility.' },
  { code: 'COUN605', title: 'Counseling Research', credits: 3, level: '600', desc: 'Research design, outcome evaluation, and evidence-based practice in Christian mental health counseling.' },

  // ── Christian Apologetics ──
  { code: 'APO101', title: 'Introduction to Christian Apologetics', credits: 3, level: '100', desc: 'Foundational arguments for God\'s existence, resurrection of Christ, reliability of Scripture, and common objections.' },
  { code: 'APO201', title: 'Apologetics & World Religions', credits: 3, level: '200', desc: 'Defending the Christian faith, engaging other religions and cults, and applying apologetics in contemporary culture.' },
  { code: 'APO501', title: 'Foundations of Christian Apologetics', credits: 3, level: '500', desc: 'Classical, evidential, presuppositional, and cumulative-case apologetic methodologies.' },
  { code: 'APO502', title: 'Cultural Apologetics', credits: 3, level: '500', desc: 'Engaging contemporary arts, literature, secular philosophies, and cultural worldviews with the Gospel.' },
  { code: 'APO503', title: 'Philosophy of Religion', credits: 3, level: '500', desc: 'Epistemological, metaphysical, and philosophical arguments concerning theism, evil, and miracles.' },
  { code: 'APO504', title: 'Apologetics and World Religions', credits: 3, level: '500', desc: 'Engaging Islam, Eastern religions, New Age spirituality, and secular humanism.' },
  { code: 'APO505', title: 'Apologetics, Science and Faith', credits: 3, level: '500', desc: 'Cosmology, evolutionary biology, fine-tuning, neuroscience, and the historical harmony of science and Christianity.' },
  { code: 'APO506', title: 'Practical Apologetics and Evangelism', credits: 3, level: '500', desc: 'Conversational apologetics, street evangelism, debating techniques, and discipling skeptics.' },
  { code: 'APO601', title: 'Advanced Christian Apologetics', credits: 3, level: '600', desc: 'Seminar addressing complex objections: problem of suffering, moral relativism, and biblical violence.' },
  { code: 'APO602', title: 'Apologetics and Contemporary Culture', credits: 3, level: '600', desc: 'Post-truth society, identity politics, transhumanism, and defending Christian anthropology.' },
  { code: 'APO603', title: 'Apologetics Research Methods', credits: 3, level: '600', desc: 'Formulating apologetic theses, primary source critical analysis, and scholarly writing.' },
  { code: 'APO604', title: 'Advanced Practical Apologetics', credits: 3, level: '600', desc: 'Public debates, media communication, podcasting, and campus outreach apologetics.' },

  // ── Worship ──
  { code: 'WOR101', title: 'Worship Leadership Foundations', credits: 3, level: '100', desc: 'Principles of corporate worship planning, music leadership, liturgy, and the theology of worship.' },
  { code: 'WOR201', title: 'Theology of Worship', credits: 3, level: '200', desc: 'Trinitarian worship theology, covenantal worship paradigms, and glorifying God in the assembly.' },
  { code: 'WOR202', title: 'Biblical Foundations of Worship', credits: 3, level: '200', desc: 'Tabernacle, Temple, Synagogue, and Early Church worship models in the Old and New Testaments.' },
  { code: 'WOR203', title: 'Worship History and Traditions', credits: 3, level: '200', desc: 'Historical development of liturgies, hymnody, the Reformation, and modern contemporary worship movements.' },
  { code: 'WOR204', title: 'Worship Leadership and Team Building', credits: 3, level: '200', desc: 'Auditioning, pastoring, discipling, and organizing musicians, singers, and technical production teams.' },
  { code: 'WOR301', title: 'Worship Planning and Service Design', credits: 3, level: '300', desc: 'Thematic service flow, liturgical seasons, sacramental integration, and creative service architecture.' },
  { code: 'WOR302', title: 'Music and Congregational Worship', credits: 3, level: '300', desc: 'Arranging, vocal coaching, band directing, song selection, and congregational singing dynamics.' },
  { code: 'WOR303', title: 'Worship Ministry Technology', credits: 3, level: '300', desc: 'Live sound reinforcement, digital audio workstations, lighting, video projection, and streaming technology.' },
  { code: 'WOR304', title: 'Worship Arts and Creativity', credits: 3, level: '300', desc: 'Visual arts, drama, dance, graphic design, and artistic expression in corporate worship.' },
  { code: 'WOR305', title: 'Worship and Culture', credits: 3, level: '300', desc: 'Multicultural worship styles, indigenous musical idioms, and contextualizing corporate worship.' },
  { code: 'WOR306', title: 'Worship Pastoral Care', credits: 3, level: '300', desc: 'Pastoring the worship team, avoiding burnout, ministering through times of personal grief and triumph.' },
  { code: 'WOR401', title: 'Advanced Worship Leadership', credits: 3, level: '400', desc: 'Executive leadership of large worship ministries, multisite coordination, and creative arts direction.' },
  { code: 'WOR402', title: 'Worship Administration and Production', credits: 3, level: '400', desc: 'Budgeting, copyright compliance (CCLI), facility acoustics, and large-scale event production.' },
  { code: 'WOR403', title: 'Worship in Contemporary Church Contexts', credits: 3, level: '400', desc: 'Analyzing modern worship trends, song writing, theological vetting of worship lyrics, and church trends.' },
  { code: 'WOR404', title: 'Worship Practicum I', credits: 3, level: '400', desc: 'Supervised worship leading internship in a partner local church congregation.' },
  { code: 'WOR405', title: 'Worship Practicum II and Capstone', credits: 3, level: '400', desc: 'Senior capstone recital or produced worship event accompanied by comprehensive theological portfolio.' },

  // ── Spiritual Formation ──
  { code: 'SPFM201', title: 'Introduction to Spiritual Formation', credits: 3, level: '200', desc: 'Personal discipleship, identity in Christ, character, prayer, calling, worship, and Holy Spirit life.' },
  { code: 'SPFM301', title: 'Spiritual Formation and Discipleship', credits: 3, level: '300', desc: 'Practicing classical spiritual disciplines: solitude, fasting, meditation, Sabbath, and journaling.' },
  { code: 'SPFM401', title: 'Advanced Spiritual Formation', credits: 3, level: '400', desc: 'Spiritual direction, soul care models, discerning the voice of God, and spiritual leadership.' },
  { code: 'SPFM501', title: 'Spiritual Formation Foundations', credits: 3, level: '500', desc: 'Theology and history of Christian spirituality, spiritual disciplines, and lifelong vocational endurance.' },
  { code: 'SPFM502', title: 'Spiritual Disciplines and Christian Character', credits: 3, level: '500', desc: 'Cultivating virtue, mortification of sin, fruit of the Spirit, and Christ-like maturity.' },
  { code: 'SPFM503', title: 'Spiritual Formation in Ministry', credits: 3, level: '500', desc: 'Soul care for pastors and leaders, avoiding burnout, spiritual accompaniment, and renewal.' },
  { code: 'SPFM601', title: 'Advanced Spiritual Formation', credits: 3, level: '600', desc: 'Supervised spiritual direction, retreat leadership, and mystical theology in historical perspective.' },

  // ── Preaching / Homiletics ──
  { code: 'PREA201', title: 'Homiletics / Biblical Preaching', credits: 3, level: '200', desc: 'Preparing and delivering effective biblical sermons, manuscripting, outlining, and vocal delivery.' },
  { code: 'PREA301', title: 'Introduction to Homiletics', credits: 3, level: '300', desc: 'Theology of preaching, sermon structures, audience analysis, and expository sermon construction.' },
  { code: 'PREA401', title: 'Biblical Preaching', credits: 3, level: '400', desc: 'Preaching from varied biblical genres: narrative, law, poetry, prophecy, epistle, and apocalyptic.' },
  { code: 'PREA501', title: 'Preaching Principles and Practice', credits: 3, level: '500', desc: 'Graduate homiletics, hermeneutical exegesis to homiletical delivery, and video critique.' },
  { code: 'PREA502', title: 'Advanced Biblical Preaching', credits: 3, level: '500', desc: 'Evangelistic, prophetic, and doctrinal preaching in diverse cultural and ecclesiastical environments.' },
  { code: 'PREA601', title: 'Advanced Homiletics', credits: 3, level: '600', desc: 'Homiletical theory, rhetorical analysis, master preaching seminars, and sermon series architecture.' },
  { code: 'PREA701', title: 'Doctoral Preaching Seminar', credits: 3, level: '700', desc: 'Doctoral colloquium on theological, hermeneutical, and rhetorical dynamics of pulpit proclamation.' },
  { code: 'PREA710', title: 'Preaching in the Post-Christendom Era', credits: 3, level: '700', desc: 'Advanced homiletics addressing secularized contexts, pluralistic audiences, and deconstructive thought.' },

  // ── Evangelism & Discipleship ──
  { code: 'EVAN201', title: 'Evangelism & Discipleship', credits: 3, level: '200', desc: 'Personal and lifestyle evangelism, apologetic conversations, follow-up, and disciple-making.' },
  { code: 'EVAN301', title: 'Personal Evangelism', credits: 3, level: '300', desc: 'Relational outreach, sharing the Gospel effectively, answering objections, and leading people to faith.' },
  { code: 'EVAN401', title: 'Evangelism and Church Growth', credits: 3, level: '400', desc: 'Congregational evangelism strategies, outreach campaigns, community service, and multiplication.' },
  { code: 'EVAN501', title: 'Advanced Evangelism', credits: 3, level: '500', desc: 'Graduate study in cultural contextualization, mass evangelism, and discipling converts in hostile regions.' },
  { code: 'DISC201', title: 'Discipleship and Spiritual Formation', credits: 3, level: '200', desc: 'Jesus\' method of disciple-making, relational investment, multiplication, and spiritual reproduction.' },
  { code: 'DISC301', title: 'Discipleship Ministry', credits: 3, level: '300', desc: 'Designing small-group discipleship pathways, mentoring models, and accountability structures.' },
  { code: 'DISC401', title: 'Advanced Discipleship', credits: 3, level: '400', desc: 'Discipling leaders, generational disciple-making movements, and holistic community impact.' },

  // ── Ecclesiology / Local Church ──
  { code: 'ECLE201', title: 'The Local Church & Kingdom Building', credits: 3, level: '200', desc: 'Ecclesiology, church planting, church growth, community impact, and marketplace ministry.' },
  { code: 'ECLE501', title: 'Ecclesiology', credits: 3, level: '500', desc: 'Biblical and historical doctrine of the Church, its marks, sacraments, structure, and mission.' },
  { code: 'ECLE502', title: 'The Local Church and Kingdom Building', credits: 3, level: '500', desc: 'Mobilizing congregations for community transformation, social justice, and marketplace evangelism.' },
  { code: 'ECLE503', title: 'Church Planting and Development', credits: 3, level: '500', desc: 'Assessment, demographic analysis, funding, launch teams, and first-phase multiplication of church plants.' },
  { code: 'ECLE504', title: 'Church Growth and Community Impact', credits: 3, level: '500', desc: 'Demographic research, community assessment, and metrics for healthy holistic church growth.' },
  { code: 'ECLE601', title: 'Advanced Ecclesiology', credits: 3, level: '600', desc: 'Ecumenical dialogues, missional ecclesiology, and the church\'s role in twenty-first-century society.' },

  // ── Digital Ministry ──
  { code: 'DIGI201', title: 'Technology, Media & the Church in the Digital Age', credits: 3, level: '200', desc: 'Media literacy, biblical truth in the digital age, technology stewardship, social media strategy, and church software.' },
  { code: 'DIGI301', title: 'Technology and Ministry', credits: 3, level: '300', desc: 'Practical use of digital presentation, audiovisual tools, database management, and virtual ministry.' },
  { code: 'DIGI401', title: 'Digital Ministry', credits: 3, level: '400', desc: 'Online church communities, hybrid ministry models, digital pastoral care, and digital evangelism.' },
  { code: 'DIGI501', title: 'Technology, Media and the Church in the Digital Age', credits: 3, level: '500', desc: 'Graduate inquiry into theological implications of artificial intelligence, digital community, and transhumanism.' },
  { code: 'DIGI502', title: 'Church Management Systems and Digital Administration', credits: 3, level: '500', desc: 'Implementation of ChMS, cloud security, digital giving, data privacy, and online church governance.' },
  { code: 'DIGI503', title: 'Social Media and Digital Ministry Strategy', credits: 3, level: '500', desc: 'Content creation, digital storytelling, online discipleship funnels, and viral engagement for ministries.' },

  // ── Supernatural Ministry ──
  { code: 'SUPM201', title: 'Supernatural Ministry / Healing & Deliverance', credits: 3, level: '200', desc: 'Biblical study of faith, prayer, healing, spiritual gifts, deliverance, and spiritual warfare with theological balance.' },
  { code: 'SUPM501', title: 'Supernatural Ministry', credits: 3, level: '500', desc: 'Biblical theology of miracles, the miraculous in church history, and academic engagement with signs and wonders.' },
  { code: 'SUPM502', title: 'Healing and Deliverance Ministry', credits: 3, level: '500', desc: 'Theological frameworks and pastoral protocols for prayer ministry, emotional healing, and spiritual deliverance.' },
  { code: 'SUPM503', title: 'Spiritual Warfare and Discernment', credits: 3, level: '500', desc: 'Biblical demonology, cosmic spiritual warfare, and discerning spiritual deception in contemporary culture.' },
  { code: 'SUPM504', title: 'Holy Spirit, Gifts and Ministry', credits: 3, level: '500', desc: 'Exegetical study of charismata in 1 Corinthians 12-14, Romans 12, and their operation in modern assemblies.' },

  // ── Research ──
  { code: 'RES401', title: 'Undergraduate Research and Capstone', credits: 3, level: '400', desc: 'Senior research thesis, bibliographic research, primary sources, and comprehensive academic defense.' },
  { code: 'RES501', title: 'Graduate Research Methods', credits: 3, level: '500', desc: 'Graduate-level theological research, bibliographic methodology, scholarly writing, and thesis proposal design.' },
  { code: 'RES601', title: 'Advanced Research Methods', credits: 3, level: '600', desc: 'Qualitative, quantitative, and mixed-method research methodologies for theological and ministerial inquiries.' },
  { code: 'RES701', title: 'Doctoral Research Seminar', credits: 3, level: '700', desc: 'Doctoral dissertation proposal defense, methodology validation, and literature review synthesis.' },
  { code: 'RES702', title: 'Doctoral Dissertation Seminar', credits: 3, level: '700', desc: 'Field research, data analysis, peer critique, and chapter development for doctoral dissertations.' },
  { code: 'RES801', title: 'Dissertation Research', credits: 3, level: '800', desc: 'Final dissertation research, manuscript writing, and formal oral defense before faculty committee.' },

  // ── Philosophy ──
  { code: 'PHIL101', title: 'Introduction to Philosophy and Critical Thinking', credits: 3, level: '100', desc: 'Logic, argumentation, formal and informal fallacies, epistemology, and foundational Western philosophical thought.' },
  { code: 'PHIL501', title: 'Philosophy of Religion and Worldview', credits: 3, level: '500', desc: 'Advanced philosophical analysis of epistemology, religious language, divine attributes, and worldview critique.' },

  // ── General Education ──
  { code: 'GEN101', title: 'University Orientation and Academic Success', credits: 3, level: '100', desc: 'University life, time management, library resources, academic integrity, and digital portal navigation.' },
  { code: 'GEN102', title: 'Academic Study Skills', credits: 3, level: '100', desc: 'Reading comprehension, critical analysis, academic note-taking, and examination preparation.' },
  { code: 'COMM101', title: 'Communication and Public Speaking', credits: 3, level: '100', desc: 'Principles of verbal communication, audience analysis, persuasive speech delivery, and presentation skills.' },
  { code: 'ICT101', title: 'Digital Literacy and Information Technology', credits: 3, level: '100', desc: 'Computer fundamentals, productivity software, internet research ethics, cybersecurity, and digital communication.' },
  { code: 'MATH101', title: 'Quantitative Reasoning', credits: 3, level: '100', desc: 'Mathematical reasoning, basic statistics, financial literacy, and data interpretation for daily life and ministry.' },
  { code: 'SOC101', title: 'Society, Culture and Community', credits: 3, level: '100', desc: 'Introduction to sociology, social institutions, family structures, urbanization, and community development.' },
  { code: 'ENGL101', title: 'Academic Writing and Communication I', credits: 3, level: '100', desc: 'Grammar, sentence mechanics, expository essay construction, and academic research writing fundamentals.' },
  { code: 'ENGL102', title: 'Academic Writing and Communication II', credits: 3, level: '100', desc: 'Advanced rhetoric, persuasive research papers, APA/Turabian citations, and critical literature review.' },
  { code: 'ETHC101', title: 'Christian Ethics and Character', credits: 3, level: '100', desc: 'Biblical moral foundations, virtuous character development, honesty, integrity, and personal holiness.' },

  // ── Doctoral Ministry ──
  { code: 'DMIN701', title: 'Doctoral Seminar: Advanced Ministry Praxis', credits: 3, level: '700', desc: 'DMin core seminar integrating theological reflection with advanced pastoral praxis and applied research.' },
];

console.log(`Total canonical courses defined: ${CANONICAL_COURSES.length}`);

// Verify all course codes match the approved regex
for (const c of CANONICAL_COURSES) {
  if (!VALID_COURSE_CODE_REGEX.test(c.code)) {
    throw new Error(`Invalid course code: ${c.code}`);
  }
}
