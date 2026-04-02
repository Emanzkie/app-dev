// routes/videos.js — KinderCura v4.0
// Handles video uploads for: appointment bookings & chat messages
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { sql, poolPromise } = require('../db');
const { authMiddleware }   = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────
async function notify(pool, userId, title, message, type = 'appointment') {
    await pool.request()
        .input('userId',  sql.Int,      userId)
        .input('title',   sql.NVarChar, title)
        .input('message', sql.NVarChar, message)
        .input('type',    sql.NVarChar, type)
        .query(`INSERT INTO notifications (userId,title,message,type) VALUES (@userId,@title,@message,@type)`);
}

// ── Storage ───────────────────────────────────────────────────
function makeStorage(subdir) {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, '..', 'public', 'uploads', subdir);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const ext  = path.extname(file.originalname).toLowerCase();
            const name = `${subdir}_${req.user.userId}_${Date.now()}${ext}`;
            cb(null, name);
        }
    });
}

const VIDEO_TYPES = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const MAX_VIDEO   = 150 * 1024 * 1024; // 150 MB

const videoFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (VIDEO_TYPES.includes(ext)) cb(null, true);
    else cb(new Error('Only video files are allowed (mp4, webm, mov, avi, mkv).'));
};

const uploadAppt = multer({ storage: makeStorage('videos/appointments'), fileFilter: videoFilter, limits: { fileSize: MAX_VIDEO } });
const uploadChat = multer({ storage: makeStorage('videos/chat'),         fileFilter: videoFilter, limits: { fileSize: MAX_VIDEO } });

// ── POST /api/videos/appointment/:appointmentId ───────────────
// Upload a video linked to an appointment (parent only)
router.post('/appointment/:appointmentId', authMiddleware, (req, res) => {
    if (req.user.role !== 'parent')
        return res.status(403).json({ error: 'Parents only.' });

    uploadAppt.single('video')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

        try {
            const pool  = await poolPromise;
            const apptId = parseInt(req.params.appointmentId);

            // Verify appointment belongs to this parent
            const appt = await pool.request()
                .input('id',       sql.Int, apptId)
                .input('parentId', sql.Int, req.user.userId)
                .query(`SELECT a.id, a.childId, a.pediatricianId,
                               c.firstName AS childFirst, c.lastName AS childLast,
                               p.firstName AS pedFirst, p.lastName AS pedLast, p.email AS pedEmail,
                               par.firstName AS parFirst, par.lastName AS parLast
                        FROM appointments a
                        JOIN children c ON a.childId = c.id
                        LEFT JOIN users p ON a.pediatricianId = p.id
                        JOIN users par ON a.parentId = par.id
                        WHERE a.id = @id AND a.parentId = @parentId`);
            if (!appt.recordset.length)
                return res.status(404).json({ error: 'Appointment not found.' });

            const a       = appt.recordset[0];
            const vidPath = `/uploads/videos/appointments/${req.file.filename}`;

            // Save record
            await pool.request()
                .input('appointmentId', sql.Int,      apptId)
                .input('childId',       sql.Int,      a.childId)
                .input('parentId',      sql.Int,      req.user.userId)
                .input('filePath',      sql.NVarChar, vidPath)
                .input('fileName',      sql.NVarChar, req.file.originalname)
                .input('fileSize',      sql.Int,      req.file.size)
                .input('mimeType',      sql.NVarChar, req.file.mimetype)
                .input('description',   sql.NVarChar, req.body.description || null)
                .query(`INSERT INTO appointment_videos
                        (appointmentId,childId,parentId,filePath,fileName,fileSize,mimeType,description)
                        VALUES (@appointmentId,@childId,@parentId,@filePath,@fileName,@fileSize,@mimeType,@description)`);

            // Flag appointment as having a video
            await pool.request()
                .input('id', sql.Int, apptId)
                .query(`UPDATE appointments SET hasVideo=1 WHERE id=@id`);

            // Also flag in pedia_notifications if exists
            await pool.request()
                .input('apptId', sql.Int, apptId)
                .query(`UPDATE pedia_notifications SET hasVideo=1 WHERE appointmentId=@apptId`);

            // Notify pediatrician
            if (a.pediatricianId) {
                const childName = `${a.childFirst} ${a.childLast}`;
                const parName   = `${a.parFirst} ${a.parLast}`;
                await notify(pool, a.pediatricianId,
                    '📹 Video Attached to Appointment',
                    `${parName} uploaded a video for ${childName}'s appointment.`
                );
            }

            res.json({ success: true, path: vidPath, fileName: req.file.originalname });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

// ── GET /api/videos/appointment/:appointmentId ─────────────────
router.get('/appointment/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const pool   = await poolPromise;
        const apptId = parseInt(req.params.appointmentId);
        const uid    = req.user.userId;
        const role   = req.user.role;

        // Verify access
        const check = await pool.request()
            .input('id', sql.Int, apptId)
            .query(`SELECT parentId, pediatricianId FROM appointments WHERE id=@id`);
        if (!check.recordset.length) return res.status(404).json({ error: 'Not found.' });
        const { parentId, pediatricianId } = check.recordset[0];
        if (role === 'parent' && parentId !== uid)
            return res.status(403).json({ error: 'Access denied.' });
        if (role === 'pediatrician' && pediatricianId !== uid)
            return res.status(403).json({ error: 'Access denied.' });

        const r = await pool.request()
            .input('appointmentId', sql.Int, apptId)
            .query(`SELECT * FROM appointment_videos WHERE appointmentId=@appointmentId ORDER BY uploadedAt DESC`);

        res.json({ success: true, videos: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/videos/chat ──────────────────────────────────────
// Upload a video to be sent in a chat message
// Returns the file path + name; caller then sends chat message with these
router.post('/chat', authMiddleware, (req, res) => {
    uploadChat.single('video')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

        try {
            const vidPath = `/uploads/videos/chat/${req.file.filename}`;
            res.json({
                success:  true,
                path:     vidPath,
                fileName: req.file.originalname,
                fileSize: req.file.size
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

// ── DELETE /api/videos/:videoId ────────────────────────────────
router.delete('/:videoId', authMiddleware, async (req, res) => {
    try {
        const pool    = await poolPromise;
        const videoId = parseInt(req.params.videoId);
        const uid     = req.user.userId;

        const row = await pool.request()
            .input('id', sql.Int, videoId)
            .query(`SELECT * FROM appointment_videos WHERE id=@id`);
        if (!row.recordset.length) return res.status(404).json({ error: 'Not found.' });
        if (row.recordset[0].parentId !== uid && req.user.role !== 'admin')
            return res.status(403).json({ error: 'Access denied.' });

        // Delete file from disk
        const fullPath = path.join(__dirname, '..', 'public', row.recordset[0].filePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

        await pool.request()
            .input('id', sql.Int, videoId)
            .query(`DELETE FROM appointment_videos WHERE id=@id`);

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
