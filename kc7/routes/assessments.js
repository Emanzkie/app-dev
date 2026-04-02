const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

function loadQuestions(ageGroup) {
    const file = ageGroup === 'preschool' ? 'questions-preschool.txt' : 'questions-school.txt';
    const filePath = path.join(__dirname, '..', file);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const questions = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('|');
        if (parts.length === 3) questions.push({ id: parts[0].trim(), domain: parts[1].trim(), text: parts[2].trim() });
    }
    return questions;
}

function getAgeGroup(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const now = new Date();
    const age = now.getFullYear() - dob.getFullYear() - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    if (age >= 3 && age <= 5) return { group: 'preschool', age, label: 'Preschool (Ages 3–5)' };
    if (age >= 6 && age <= 8) return { group: 'school', age, label: 'Early School Age (Ages 6–8)' };
    return null;
}

router.post('/initialize', authMiddleware, async (req, res) => {
    try {
        const { childId } = req.body;
        if (!childId) return res.status(400).json({ error: 'childId is required.' });
        const pool = await poolPromise;
        const childResult = await pool.request().input('childId', sql.Int, childId).query('SELECT * FROM children WHERE id = @childId');
        if (childResult.recordset.length === 0) return res.status(404).json({ error: 'Child not found.' });
        const child = childResult.recordset[0];
        const ageInfo = getAgeGroup(child.dateOfBirth);
        if (!ageInfo) return res.status(400).json({ error: 'Child must be between ages 3-8 for screening.' });
        const questions = loadQuestions(ageInfo.group);
        const result = await pool.request().input('childId', sql.Int, childId).input('createdBy', sql.Int, req.user.userId)
            .query("INSERT INTO assessments (childId,createdBy,status,currentProgress) OUTPUT INSERTED.id VALUES (@childId,@createdBy,'in_progress',0)");
        res.json({ success: true, assessmentId: result.recordset[0].id, ageGroup: ageInfo.group, ageLabel: ageInfo.label, childAge: ageInfo.age, questions, totalQuestions: questions.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/save-draft', authMiddleware, async (req, res) => {
    try {
        const { assessmentId, progress, answers } = req.body;
        const pool = await poolPromise;
        await pool.request().input('assessmentId', sql.Int, assessmentId).input('progress', sql.Int, progress || 0)
            .query('UPDATE assessments SET currentProgress=@progress WHERE id=@assessmentId');
        if (answers && answers.length > 0) {
            for (const a of answers) {
                await pool.request()
                    .input('assessmentId', sql.Int, assessmentId).input('questionId', sql.NVarChar, String(a.questionId))
                    .input('domain', sql.NVarChar, a.domain || '').input('questionText', sql.NVarChar, a.questionText || '').input('answer', sql.NVarChar, a.answer)
                    .query(`IF EXISTS (SELECT 1 FROM assessment_answers WHERE assessmentId=@assessmentId AND questionId=@questionId)
                                UPDATE assessment_answers SET answer=@answer WHERE assessmentId=@assessmentId AND questionId=@questionId
                            ELSE INSERT INTO assessment_answers (assessmentId,questionId,domain,questionText,answer) VALUES (@assessmentId,@questionId,@domain,@questionText,@answer)`);
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/submit', authMiddleware, async (req, res) => {
    try {
        let { assessmentId, childId, answers } = req.body;
        const pool = await poolPromise;

        // Auto-create assessment record if frontend initialization failed (e.g. missing question files)
        if (!assessmentId) {
            const created = await pool.request()
                .input('childId',   sql.Int, childId)
                .input('createdBy', sql.Int, req.user.userId)
                .query("INSERT INTO assessments (childId,createdBy,status,currentProgress) OUTPUT INSERTED.id VALUES (@childId,@createdBy,'in_progress',100)");
            assessmentId = created.recordset[0].id;
        }
        if (answers && answers.length > 0) {
            for (const a of answers) {
                await pool.request()
                    .input('assessmentId', sql.Int, assessmentId).input('questionId', sql.NVarChar, String(a.questionId))
                    .input('domain', sql.NVarChar, a.domain || '').input('questionText', sql.NVarChar, a.questionText || '').input('answer', sql.NVarChar, a.answer)
                    .query(`IF EXISTS (SELECT 1 FROM assessment_answers WHERE assessmentId=@assessmentId AND questionId=@questionId)
                                UPDATE assessment_answers SET answer=@answer WHERE assessmentId=@assessmentId AND questionId=@questionId
                            ELSE INSERT INTO assessment_answers (assessmentId,questionId,domain,questionText,answer) VALUES (@assessmentId,@questionId,@domain,@questionText,@answer)`);
            }
        }
        const scoreResult = await pool.request().input('assessmentId', sql.Int, assessmentId)
            .query("SELECT domain, SUM(CASE WHEN answer='yes' THEN 2 WHEN answer='sometimes' THEN 1 ELSE 0 END) AS earned, COUNT(*)*2 AS total FROM assessment_answers WHERE assessmentId=@assessmentId GROUP BY domain");
        const scores = {};
        for (const row of scoreResult.recordset) scores[row.domain] = row.total > 0 ? Math.round((row.earned/row.total)*100) : 0;

        // Fallback: if DB has no answers (e.g. answers sent as object not array), score from submitted payload
        if (Object.keys(scores).length === 0 && answers) {
            const answersArr = Array.isArray(answers)
                ? answers
                : Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer, domain: 'Unknown' }));
            const domainMap = {};
            for (const a of answersArr) {
                const d = a.domain || 'Unknown';
                if (!domainMap[d]) domainMap[d] = { earned: 0, total: 0 };
                domainMap[d].total  += 2;
                domainMap[d].earned += a.answer === 'yes' ? 2 : a.answer === 'sometimes' ? 1 : 0;
            }
            for (const [d, v] of Object.entries(domainMap))
                scores[d] = v.total > 0 ? Math.round((v.earned/v.total)*100) : 0;
        }

        const comm=scores['Communication']||0, soc=scores['Social Skills']||0, cog=scores['Cognitive']||0, motor=scores['Motor Skills']||0;
        const overall = Math.round((comm+soc+cog+motor)/4);
        const getStatus = s => s>=70?'on-track':s>=40?'at-risk':'delayed';
        const riskFlags = [];
        if(comm<40) riskFlags.push('Communication delay detected');
        if(soc<40) riskFlags.push('Social skills concern detected');
        if(cog<40) riskFlags.push('Cognitive development concern');
        if(motor<40) riskFlags.push('Motor skills delay detected');
        const resInsert = await pool.request()
            .input('assessmentId',sql.Int,assessmentId).input('childId',sql.Int,childId)
            .input('communicationScore',sql.Float,comm).input('socialScore',sql.Float,soc)
            .input('cognitiveScore',sql.Float,cog).input('motorScore',sql.Float,motor).input('overallScore',sql.Float,overall)
            .input('communicationStatus',sql.NVarChar,getStatus(comm)).input('socialStatus',sql.NVarChar,getStatus(soc))
            .input('cognitiveStatus',sql.NVarChar,getStatus(cog)).input('motorStatus',sql.NVarChar,getStatus(motor))
            .input('riskFlags',sql.NVarChar,JSON.stringify(riskFlags))
            .query(`INSERT INTO assessment_results (assessmentId,childId,communicationScore,socialScore,cognitiveScore,motorScore,overallScore,communicationStatus,socialStatus,cognitiveStatus,motorStatus,riskFlags)
                    OUTPUT INSERTED.id VALUES (@assessmentId,@childId,@communicationScore,@socialScore,@cognitiveScore,@motorScore,@overallScore,@communicationStatus,@socialStatus,@cognitiveStatus,@motorStatus,@riskFlags)`);
        await pool.request().input('assessmentId',sql.Int,assessmentId).query("UPDATE assessments SET status='complete',completedAt=GETDATE() WHERE id=@assessmentId");
        res.json({ success: true, resultId: resInsert.recordset[0].id, assessmentId, analysisStatus: 'complete' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /pedia-patients ───────────────────────────────────────────────────────
// Uses pedia_notifications as the source of truth (matches dashboard logic)
// Falls back to appointments.pediatricianId for any additional records
router.get('/pedia-patients', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const pedId = req.user.userId;

        const result = await pool.request()
            .input('pedId', sql.Int, pedId)
            .query(`
                SELECT * FROM (
                    SELECT
                        c.id               AS childId,
                        c.firstName        AS childFirstName,
                        c.lastName         AS childLastName,
                        c.dateOfBirth      AS childDateOfBirth,
                        c.gender           AS childGender,
                        c.profileIcon      AS childProfileIcon,
                        parent.firstName   AS parentFirstName,
                        parent.lastName    AS parentLastName,
                        parent.email       AS parentEmail,
                        apt.id             AS appointmentId,
                        apt.status         AS appointmentStatus,
                        apt.appointmentDate,
                        apt.reason,
                        ar.communicationScore,
                        ar.socialScore,
                        ar.cognitiveScore,
                        ar.motorScore,
                        ar.overallScore,
                        ar.generatedAt     AS lastAssessmentDate,
                        a2.id              AS assessmentId,
                        a2.diagnosis,
                        a2.recommendations
                    FROM pedia_notifications pn
                    JOIN appointments apt ON apt.id = pn.appointmentId
                    JOIN children     c   ON c.id   = apt.childId
                    JOIN users        parent ON parent.id = apt.parentId
                    LEFT JOIN assessments a2 ON a2.id = (
                        SELECT TOP 1 id FROM assessments
                        WHERE childId = c.id
                        ORDER BY startedAt DESC
                    )
                    LEFT JOIN assessment_results ar ON ar.assessmentId = a2.id
                    WHERE pn.pediatricianId = @pedId

                    UNION

                    SELECT
                        c.id               AS childId,
                        c.firstName        AS childFirstName,
                        c.lastName         AS childLastName,
                        c.dateOfBirth      AS childDateOfBirth,
                        c.gender           AS childGender,
                        c.profileIcon      AS childProfileIcon,
                        parent.firstName   AS parentFirstName,
                        parent.lastName    AS parentLastName,
                        parent.email       AS parentEmail,
                        apt.id             AS appointmentId,
                        apt.status         AS appointmentStatus,
                        apt.appointmentDate,
                        apt.reason,
                        ar.communicationScore,
                        ar.socialScore,
                        ar.cognitiveScore,
                        ar.motorScore,
                        ar.overallScore,
                        ar.generatedAt     AS lastAssessmentDate,
                        a2.id              AS assessmentId,
                        a2.diagnosis,
                        a2.recommendations
                    FROM appointments apt
                    JOIN children  c      ON c.id      = apt.childId
                    JOIN users     parent ON parent.id  = apt.parentId
                    LEFT JOIN assessments a2 ON a2.id = (
                        SELECT TOP 1 id FROM assessments
                        WHERE childId = c.id
                        ORDER BY startedAt DESC
                    )
                    LEFT JOIN assessment_results ar ON ar.assessmentId = a2.id
                    WHERE apt.pediatricianId = @pedId
                      AND NOT EXISTS (
                          SELECT 1 FROM pedia_notifications pn2
                          WHERE pn2.appointmentId = apt.id
                            AND pn2.pediatricianId = @pedId
                      )
                ) AS combined
                ORDER BY appointmentId DESC
            `);

        // Deduplicate by childId — keep the record with the HIGHEST appointmentId (newest booking)
        const seen = new Map();
        for (const row of result.recordset) {
            const existing = seen.get(row.childId);
            const rowAptId = row.appointmentId || 0;
            const exAptId  = existing ? (existing.appointmentId || 0) : -1;
            if (!existing || rowAptId > exAptId) {
                seen.set(row.childId, row);
            }
        }

        const patients = Array.from(seen.values()).map(p => ({
            ...p,
            scores: p.communicationScore !== null && p.communicationScore !== undefined ? {
                'Communication': Math.round(p.communicationScore),
                'Social Skills':  Math.round(p.socialScore),
                'Cognitive':      Math.round(p.cognitiveScore),
                'Motor Skills':   Math.round(p.motorScore)
            } : {}
        }));

        res.json({ success: true, patients });
    } catch (err) {
        console.error('pedia-patients error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /diagnose/:childId — pedia submits diagnosis for a child ──────────────
router.post('/diagnose/:childId', authMiddleware, async (req, res) => {
    try {
        const { diagnosis, recommendations } = req.body;
        if (!diagnosis) return res.status(400).json({ error: 'Diagnosis is required.' });

        const pool = await poolPromise;

        // Update the latest assessment for this child
        await pool.request()
            .input('childId',         sql.Int,      req.params.childId)
            .input('diagnosis',        sql.NVarChar, diagnosis)
            .input('recommendations',  sql.NVarChar, recommendations || null)
            .query(`
                UPDATE assessments
                SET diagnosis = @diagnosis, recommendations = @recommendations
                WHERE id = (
                    SELECT TOP 1 id FROM assessments
                    WHERE childId = @childId
                    ORDER BY startedAt DESC
                )
            `);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:assessmentId/results', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('assessmentId',sql.Int,req.params.assessmentId).query('SELECT * FROM assessment_results WHERE assessmentId=@assessmentId');
        if (result.recordset.length===0) return res.status(404).json({ error: 'Results not found.' });
        const r = result.recordset[0];
        r.riskFlags = JSON.parse(r.riskFlags||'[]');
        res.json({ success: true, results: r });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:childId/history', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().input('childId',sql.Int,req.params.childId).query('SELECT * FROM assessments WHERE childId=@childId ORDER BY startedAt DESC');
        res.json({ success: true, assessments: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;
