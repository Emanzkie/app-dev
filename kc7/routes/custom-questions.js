// routes/custom-questions.js — KinderCura v4.0
// Pediatrician custom questions + age-based static question logic
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware }   = require('../middleware/auth');

// ── Age-based static questions (from child development questionnaire) ──
const STATIC_QUESTIONS = [
    // Age 3
    { id: 1,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Gross Motor',     text: 'Does your child ride a tricycle?' },
    { id: 2,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Fine Motor',      text: 'Does your child draw a circle?' },
    { id: 3,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Fine Motor',      text: 'Does your child draw a person with at least 2 body parts?' },
    { id: 4,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Fine Motor',      text: 'Does your child build a tower using 10 cubes?' },
    { id: 5,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Language',        text: 'Does your child speak using 3–4 word sentences?' },
    { id: 6,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Language',        text: 'Does your child understand simple prepositions (e.g., in, on, under)?' },
    { id: 7,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Personal-Social', text: 'Does your child dress with supervision?' },
    { id: 8,  ageMin: 3, ageMax: 8, ageGroup: '3',     domain: 'Personal-Social', text: 'Does your child wash hands properly?' },
    // Age 3.5–4
    { id: 9,  ageMin: 4, ageMax: 8, ageGroup: '3.5-4', domain: 'Fine Motor',      text: 'Does your child draw a cube?' },
    // Age 4
    { id: 10, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Gross Motor',     text: 'Does your child hop?' },
    { id: 11, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Gross Motor',     text: 'Does your child throw a ball overhead?' },
    { id: 12, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Gross Motor',     text: 'Does your child use scissors to cut pictures?' },
    { id: 13, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Fine Motor',      text: 'Does your child draw a square?' },
    { id: 14, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Language',        text: 'Does your child speak in complete sentences?' },
    { id: 15, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Language',        text: 'Does your child tell a simple story?' },
    { id: 16, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Language',        text: 'Does your child understand size concepts (e.g., big vs small)?' },
    { id: 17, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Personal-Social', text: 'Does your child dress independently and correctly?' },
    { id: 18, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Personal-Social', text: 'Does your child engage in group play?' },
    { id: 19, ageMin: 4, ageMax: 8, ageGroup: '4',     domain: 'Personal-Social', text: 'Does your child use the toilet independently?' },
    // Age 5
    { id: 20, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Gross Motor',     text: 'Does your child skip?' },
    { id: 21, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Language',        text: 'Does your child understand basic concepts of time?' },
    { id: 22, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Language',        text: 'Does your child follow 3-step commands?' },
    { id: 23, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Language',        text: 'Does your child pronounce most speech sounds clearly?' },
    { id: 24, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Personal-Social', text: 'Does your child do simple errands or help with household tasks?' },
    { id: 25, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Personal-Social', text: 'Does your child ask questions about the meaning of words?' },
    { id: 26, ageMin: 5, ageMax: 8, ageGroup: '5',     domain: 'Personal-Social', text: 'Does your child engage in pretend or role-playing activities?' },
    // Age 6
    { id: 27, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Fine Motor',      text: 'Does your child copy letters (even if some are reversed)?' },
    { id: 28, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Fine Motor',      text: 'Does your child draw a person with complete body parts (around 12 parts)?' },
    { id: 29, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Language',        text: 'Does your child express emotions verbally?' },
    { id: 30, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Language',        text: 'Does your child follow 3-step sequential commands?' },
    { id: 31, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Personal-Social', text: 'Does your child dress completely on their own?' },
    { id: 32, ageMin: 6, ageMax: 8, ageGroup: '6',     domain: 'Personal-Social', text: 'Does your child tie shoelaces?' },
    // Age 7–8
    { id: 33, ageMin: 7, ageMax: 8, ageGroup: '7-8',   domain: 'Gross Motor',     text: 'Does your child run and climb with good coordination?' },
    { id: 34, ageMin: 7, ageMax: 8, ageGroup: '7-8',   domain: 'Fine Motor',      text: 'Does your child correctly identify left and right?' },
];

// Calculate age in years from dateOfBirth
function calcAge(dob) {
    const birth = new Date(dob);
    const now   = new Date();
    let years   = now.getFullYear() - birth.getFullYear();
    const mDiff = now.getMonth() - birth.getMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getDate() < birth.getDate())) years--;
    return years;
}

// ── POST /api/questions/static/answer — save static question answer ──
router.post('/static/answer', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const { childId, appointmentId, questionId, questionText, ageGroup, domain, answer } = req.body;
        if (!childId || !questionId || !answer)
            return res.status(400).json({ error: 'childId, questionId, and answer are required.' });

        // Upsert (update if already answered for this appt+question combo)
        const existing = await pool.request()
            .input('childId',       sql.Int, childId)
            .input('appointmentId', sql.Int, appointmentId || null)
            .input('questionId',    sql.Int, questionId)
            .query(`SELECT id FROM static_question_answers
                    WHERE childId=@childId AND questionId=@questionId
                    AND (@appointmentId IS NULL OR appointmentId=@appointmentId)`);

        if (existing.recordset.length) {
            await pool.request()
                .input('id',     sql.Int,      existing.recordset[0].id)
                .input('answer', sql.NVarChar, answer)
                .query(`UPDATE static_question_answers SET answer=@answer WHERE id=@id`);
        } else {
            await pool.request()
                .input('childId',        sql.Int,      childId)
                .input('appointmentId',  sql.Int,      appointmentId  || null)
                .input('pediatricianId', sql.Int,      null)
                .input('questionId',     sql.Int,      questionId)
                .input('questionText',   sql.NVarChar, questionText   || null)
                .input('ageGroup',       sql.NVarChar, ageGroup       || null)
                .input('domain',         sql.NVarChar, domain         || null)
                .input('answer',         sql.NVarChar, answer)
                .query(`INSERT INTO static_question_answers
                        (childId,appointmentId,pediatricianId,questionId,questionText,ageGroup,domain,answer)
                        VALUES (@childId,@appointmentId,@pediatricianId,@questionId,@questionText,@ageGroup,@domain,@answer)`);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/questions/static/answers/:childId — get saved answers ──
router.get('/static/answers/:childId', authMiddleware, async (req, res) => {
    try {
        const pool    = await poolPromise;
        const childId = parseInt(req.params.childId);
        const { appointmentId } = req.query;

        const r = await pool.request()
            .input('childId',       sql.Int, childId)
            .input('appointmentId', sql.Int, appointmentId ? parseInt(appointmentId) : null)
            .query(`SELECT * FROM static_question_answers
                    WHERE childId=@childId
                    AND (@appointmentId IS NULL OR appointmentId=@appointmentId)
                    ORDER BY questionId ASC`);
        res.json({ success: true, answers: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/questions/static/:childId ────────────────────────
// Returns age-appropriate static questions for a child (age 3–8)
router.get('/static/:childId', authMiddleware, async (req, res) => {
    try {
        const pool    = await poolPromise;
        const childId = parseInt(req.params.childId);

        const cRow = await pool.request()
            .input('id', sql.Int, childId)
            .query(`SELECT dateOfBirth FROM children WHERE id=@id`);
        if (!cRow.recordset.length) return res.status(404).json({ error: 'Child not found.' });

        const age = calcAge(cRow.recordset[0].dateOfBirth);
        // Clamp to 3–8 range
        const ageForFilter = Math.min(Math.max(age, 3), 8);

        // Filter: show questions where ageMin <= childAge <= ageMax
        const filtered = STATIC_QUESTIONS.filter(q => ageForFilter >= q.ageMin && ageForFilter <= q.ageMax);

        res.json({ success: true, childAge: age, questions: filtered });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/questions — get pediatrician's custom questions ───
router.get('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error: 'Pediatricians only.' });

        const pool = await poolPromise;
        const r    = await pool.request()
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT * FROM custom_questions WHERE pediatricianId=@pedId ORDER BY createdAt DESC`);

        const questions = r.recordset.map(q => ({
            ...q,
            options: q.options ? JSON.parse(q.options) : []
        }));

        res.json({ success: true, questions });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/questions — create a custom question ─────────────
router.post('/', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error: 'Pediatricians only.' });

        const { questionText, questionType, options, domain, ageMin, ageMax } = req.body;
        if (!questionText || !questionType)
            return res.status(400).json({ error: 'Question text and type are required.' });

        const VALID_TYPES = ['yes_no', 'multiple_choice', 'short_answer'];
        if (!VALID_TYPES.includes(questionType))
            return res.status(400).json({ error: `Type must be: ${VALID_TYPES.join(', ')}` });

        if (questionType === 'multiple_choice' && (!options || !options.length))
            return res.status(400).json({ error: 'Multiple choice questions require at least 2 options.' });

        const pool = await poolPromise;
        const ins  = await pool.request()
            .input('pedId',        sql.Int,      req.user.userId)
            .input('questionText', sql.NVarChar, questionText)
            .input('questionType', sql.NVarChar, questionType)
            .input('options',      sql.NVarChar, options ? JSON.stringify(options) : null)
            .input('domain',       sql.NVarChar, domain  || 'Other')
            .input('ageMin',       sql.Int,       ageMin  != null ? ageMin  : 0)
            .input('ageMax',       sql.Int,       ageMax  != null ? ageMax  : 18)
            .query(`INSERT INTO custom_questions
                    (pediatricianId,questionText,questionType,options,domain,ageMin,ageMax)
                    OUTPUT INSERTED.*
                    VALUES (@pedId,@questionText,@questionType,@options,@domain,@ageMin,@ageMax)`);

        const q = { ...ins.recordset[0], options: options || [] };
        res.status(201).json({ success: true, question: q });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/questions/:id — edit a question ──────────────────
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error: 'Pediatricians only.' });

        const { questionText, questionType, options, domain, ageMin, ageMax, isActive } = req.body;
        const pool = await poolPromise;

        const existing = await pool.request()
            .input('id',    sql.Int, req.params.id)
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT id FROM custom_questions WHERE id=@id AND pediatricianId=@pedId`);
        if (!existing.recordset.length)
            return res.status(404).json({ error: 'Question not found.' });

        await pool.request()
            .input('id',           sql.Int,      req.params.id)
            .input('questionText', sql.NVarChar, questionText || null)
            .input('questionType', sql.NVarChar, questionType || null)
            .input('options',      sql.NVarChar, options ? JSON.stringify(options) : null)
            .input('domain',       sql.NVarChar, domain  || null)
            .input('ageMin',       sql.Int,       ageMin  != null ? ageMin  : null)
            .input('ageMax',       sql.Int,       ageMax  != null ? ageMax  : null)
            .input('isActive',     sql.Bit,       isActive != null ? isActive : null)
            .query(`UPDATE custom_questions SET
                    questionText = COALESCE(@questionText, questionText),
                    questionType = COALESCE(@questionType, questionType),
                    options      = COALESCE(@options,      options),
                    domain       = COALESCE(@domain,       domain),
                    ageMin       = COALESCE(@ageMin,       ageMin),
                    ageMax       = COALESCE(@ageMax,       ageMax),
                    isActive     = COALESCE(@isActive,     isActive),
                    updatedAt    = GETDATE()
                    WHERE id = @id`);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/questions/:id ─────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error: 'Pediatricians only.' });

        const pool = await poolPromise;
        const r    = await pool.request()
            .input('id',    sql.Int, req.params.id)
            .input('pedId', sql.Int, req.user.userId)
            .query(`DELETE FROM custom_questions WHERE id=@id AND pediatricianId=@pedId`);

        if (r.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found.' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/questions/:id/assign — assign to appointment/child ──
router.post('/:id/assign', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error: 'Pediatricians only.' });

        const { appointmentId, childId } = req.body;
        if (!childId) return res.status(400).json({ error: 'childId required.' });

        const pool = await poolPromise;

        // Verify question belongs to this pedia
        const qRow = await pool.request()
            .input('id',    sql.Int, req.params.id)
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT id FROM custom_questions WHERE id=@id AND pediatricianId=@pedId`);
        if (!qRow.recordset.length) return res.status(404).json({ error: 'Question not found.' });

        // Get parent of child
        const cRow = await pool.request()
            .input('id', sql.Int, childId)
            .query(`SELECT parentId FROM children WHERE id=@id`);
        if (!cRow.recordset.length) return res.status(404).json({ error: 'Child not found.' });

        // Check if already assigned
        const existing = await pool.request()
            .input('qId',         sql.Int, req.params.id)
            .input('appointmentId', sql.Int, appointmentId || null)
            .input('childId',     sql.Int, childId)
            .query(`SELECT id FROM custom_question_assignments
                    WHERE questionId=@qId AND childId=@childId
                    AND (@appointmentId IS NULL OR appointmentId=@appointmentId)`);
        if (existing.recordset.length)
            return res.json({ success: true, message: 'Already assigned.' });

        await pool.request()
            .input('questionId',   sql.Int, req.params.id)
            .input('appointmentId',sql.Int, appointmentId || null)
            .input('childId',      sql.Int, childId)
            .input('parentId',     sql.Int, cRow.recordset[0].parentId)
            .query(`INSERT INTO custom_question_assignments (questionId,appointmentId,childId,parentId)
                    VALUES (@questionId,@appointmentId,@childId,@parentId)`);

        // Notify parent
        await pool.request()
            .input('userId',  sql.Int,      cRow.recordset[0].parentId)
            .input('title',   sql.NVarChar, '📋 New Assessment Question')
            .input('message', sql.NVarChar, 'Your child\'s pediatrician has added a new assessment question for you to answer.')
            .input('type',    sql.NVarChar, 'assessment')
            .query(`INSERT INTO notifications (userId,title,message,type) VALUES (@userId,@title,@message,@type)`);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/questions/assigned/:childId ─────────────────────
// For parents: get questions assigned to their child
router.get('/assigned/:childId', authMiddleware, async (req, res) => {
    try {
        const pool    = await poolPromise;
        const childId = parseInt(req.params.childId);
        const uid     = req.user.userId;

        let whereExtra = '';
        if (req.user.role === 'parent') {
            // Must be the child's parent
            const c = await pool.request()
                .input('id', sql.Int, childId)
                .query(`SELECT parentId FROM children WHERE id=@id`);
            if (!c.recordset.length || c.recordset[0].parentId !== uid)
                return res.status(403).json({ error: 'Access denied.' });
        }

        const r = await pool.request()
            .input('childId', sql.Int, childId)
            .query(`SELECT cqa.id AS assignmentId, cqa.appointmentId, cqa.answer, cqa.answeredAt,
                           cq.id AS questionId, cq.questionText, cq.questionType, cq.options,
                           cq.domain, cq.ageMin, cq.ageMax,
                           u.firstName+' '+u.lastName AS pediatricianName
                    FROM custom_question_assignments cqa
                    JOIN custom_questions cq ON cqa.questionId = cq.id
                    JOIN users u ON cq.pediatricianId = u.id
                    WHERE cqa.childId = @childId
                    ORDER BY cqa.createdAt DESC`);

        const rows = r.recordset.map(row => ({
            ...row,
            options: row.options ? JSON.parse(row.options) : []
        }));

        res.json({ success: true, assignments: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/questions/answer/:assignmentId — parent submits answer ──
router.post('/answer/:assignmentId', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'parent')
            return res.status(403).json({ error: 'Parents only.' });

        const { answer } = req.body;
        if (!answer) return res.status(400).json({ error: 'Answer required.' });

        const pool = await poolPromise;
        await pool.request()
            .input('id',         sql.Int,      req.params.assignmentId)
            .input('parentId',   sql.Int,      req.user.userId)
            .input('answer',     sql.NVarChar, String(answer))
            .input('answeredAt', sql.DateTime, new Date())
            .query(`UPDATE custom_question_assignments SET answer=@answer, answeredAt=@answeredAt
                    WHERE id=@id AND parentId=@parentId`);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
