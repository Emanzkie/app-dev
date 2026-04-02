// routes/chat.js — KinderCura v4.0
// Chat between parent and pediatrician
// Accessible once appointment is approved OR child is under pedia care
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware }   = require('../middleware/auth');

// ── Helper: push in-app notification ──────────────────────────
async function notify(pool, userId, title, message) {
    await pool.request()
        .input('userId',  sql.Int,      userId)
        .input('title',   sql.NVarChar, title)
        .input('message', sql.NVarChar, message)
        .input('type',    sql.NVarChar, 'chat')
        .query(`INSERT INTO notifications (userId,title,message,type) VALUES (@userId,@title,@message,@type)`);
}

// ── Helper: verify chat access & resolve parties ───────────────
async function resolveChatAccess(pool, appointmentId, userId, userRole) {
    const r = await pool.request()
        .input('id', sql.Int, appointmentId)
        .query(`SELECT a.id, a.parentId, a.pediatricianId, a.childId, a.status,
                       a.appointmentDate, a.reason,
                       c.firstName AS childFirst, c.lastName AS childLast,
                       c.dateOfBirth AS childDob, c.gender AS childGender,
                       c.profileIcon AS childPhoto,
                       p.firstName AS parFirst, p.lastName AS parLast, p.email AS parEmail,
                       p.profileIcon AS parPhoto,
                       d.firstName AS pedFirst, d.lastName AS pedLast,
                       d.specialization AS pedSpec,
                       d.profileIcon AS pedPhoto
                FROM appointments a
                JOIN children c ON a.childId    = c.id
                JOIN users    p ON a.parentId   = p.id
                LEFT JOIN users d ON a.pediatricianId = d.id
                WHERE a.id = @id`);

    if (!r.recordset.length) return null;
    const appt = r.recordset[0];
    const allowed = ['approved', 'completed'];   // chat available once approved

    if (!allowed.includes(appt.status)) return { denied: 'chat_locked', status: appt.status };

    if (userRole === 'parent'       && appt.parentId      !== userId) return { denied: 'access' };
    if (userRole === 'pediatrician' && appt.pediatricianId !== userId) return { denied: 'access' };

    return appt;
}

// ── GET /api/chat/threads — list all chat threads for logged-in user ──
router.get('/threads', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const uid  = req.user.userId;
        const role = req.user.role;

        // Each appointment with status=approved|completed that involves the user
        // and has at least one message OR is accessible
        let query;
        if (role === 'parent') {
            query = `SELECT DISTINCT a.id AS appointmentId, a.status, a.appointmentDate, a.appointmentTime,
                            a.childId, c.firstName+' '+c.lastName AS childName,
                            a.pediatricianId,
                            d.firstName+' '+d.lastName AS pediatricianName,
                            d.specialization,
                            (SELECT COUNT(*) FROM chat_messages cm WHERE cm.appointmentId=a.id AND cm.isRead=0 AND cm.senderRole='pediatrician') AS unread
                     FROM appointments a
                     JOIN children c ON a.childId = c.id
                     LEFT JOIN users d ON a.pediatricianId = d.id
                     WHERE a.parentId=@uid AND a.status IN ('approved','completed')
                     ORDER BY a.appointmentDate DESC`;
        } else if (role === 'pediatrician') {
            query = `SELECT DISTINCT a.id AS appointmentId, a.status, a.appointmentDate, a.appointmentTime,
                            a.childId, c.firstName+' '+c.lastName AS childName,
                            a.parentId,
                            p.firstName+' '+p.lastName AS parentName,
                            (SELECT COUNT(*) FROM chat_messages cm WHERE cm.appointmentId=a.id AND cm.isRead=0 AND cm.senderRole='parent') AS unread
                     FROM appointments a
                     JOIN children c ON a.childId = c.id
                     JOIN users p ON a.parentId = p.id
                     WHERE a.pediatricianId=@uid AND a.status IN ('approved','completed')
                     ORDER BY a.appointmentDate DESC`;
        } else {
            return res.status(403).json({ error: 'Parents and pediatricians only.' });
        }

        const r = await pool.request()
            .input('uid', sql.Int, uid)
            .query(query);

        res.json({ success: true, threads: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/chat/:appointmentId — get messages for a thread ──
router.get('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const pool    = await poolPromise;
        const apptId  = parseInt(req.params.appointmentId);
        const uid     = req.user.userId;
        const role    = req.user.role;
        const { page = 1, limit = 50 } = req.query;
        const offset  = (parseInt(page) - 1) * parseInt(limit);

        const appt = await resolveChatAccess(pool, apptId, uid, role);
        if (!appt)                     return res.status(404).json({ error: 'Not found.' });
        if (appt.denied === 'access')  return res.status(403).json({ error: 'Access denied.' });
        if (appt.denied === 'chat_locked')
            return res.status(403).json({ error: `Chat is not yet available. Appointment status: ${appt.status}` });

        const msgs = await pool.request()
            .input('apptId', sql.Int, apptId)
            .input('limit',  sql.Int, parseInt(limit))
            .input('offset', sql.Int, offset)
            .query(`SELECT cm.id, cm.senderId, cm.senderRole, cm.message,
                           cm.videoPath, cm.videoName, cm.videoSize, cm.isRead, cm.createdAt,
                           u.firstName+' '+u.lastName AS senderName,
                           u.profileIcon AS senderPhoto
                    FROM chat_messages cm
                    JOIN users u ON cm.senderId = u.id
                    WHERE cm.appointmentId = @apptId
                    ORDER BY cm.createdAt ASC
                    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);

        // Mark incoming messages as read
        const markRole = role === 'parent' ? 'pediatrician' : 'parent';
        await pool.request()
            .input('apptId',     sql.Int,      apptId)
            .input('senderRole', sql.NVarChar, markRole)
            .query(`UPDATE chat_messages SET isRead=1
                    WHERE appointmentId=@apptId AND senderRole=@senderRole AND isRead=0`);

        res.json({ success: true, messages: msgs.recordset, appointmentInfo: appt });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/chat/:appointmentId — send a message ────────────
router.post('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const pool   = await poolPromise;
        const apptId = parseInt(req.params.appointmentId);
        const uid    = req.user.userId;
        const role   = req.user.role;
        const { message, videoPath, videoName, videoSize } = req.body;

        if (!message && !videoPath)
            return res.status(400).json({ error: 'Message text or video required.' });

        const appt = await resolveChatAccess(pool, apptId, uid, role);
        if (!appt)                     return res.status(404).json({ error: 'Not found.' });
        if (appt.denied === 'access')  return res.status(403).json({ error: 'Access denied.' });
        if (appt.denied === 'chat_locked')
            return res.status(403).json({ error: 'Chat is not yet available. Appointment must be approved first.' });

        const ins = await pool.request()
            .input('appointmentId',  sql.Int,      apptId)
            .input('childId',        sql.Int,      appt.childId)
            .input('parentId',       sql.Int,      appt.parentId)
            .input('pediatricianId', sql.Int,      appt.pediatricianId)
            .input('senderId',       sql.Int,      uid)
            .input('senderRole',     sql.NVarChar, role)
            .input('message',        sql.NVarChar, message   || null)
            .input('videoPath',      sql.NVarChar, videoPath || null)
            .input('videoName',      sql.NVarChar, videoName || null)
            .input('videoSize',      sql.Int,      videoSize || null)
            .query(`INSERT INTO chat_messages
                    (appointmentId,childId,parentId,pediatricianId,senderId,senderRole,message,videoPath,videoName,videoSize)
                    OUTPUT INSERTED.*
                    VALUES (@appointmentId,@childId,@parentId,@pediatricianId,@senderId,@senderRole,@message,@videoPath,@videoName,@videoSize)`);

        const msg       = ins.recordset[0];
        const childName = `${appt.childFirst} ${appt.childLast}`;

        // Notify the OTHER party
        if (role === 'parent') {
            const senderName = `${appt.parFirst} ${appt.parLast}`;
            const notifTitle = videoPath ? `📹 New video from ${senderName}` : `💬 New message from ${senderName}`;
            await notify(pool, appt.pediatricianId, notifTitle,
                videoPath
                    ? `${senderName} sent a follow-up video for ${childName}.`
                    : `${senderName}: ${(message || '').substring(0, 100)}`);
        } else {
            const senderName = `Dr. ${appt.pedFirst} ${appt.pedLast}`;
            await notify(pool, appt.parentId, `💬 Message from ${senderName}`,
                `${senderName}: ${(message || '').substring(0, 100)}`);
        }

        res.json({ success: true, message: msg });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/chat/:appointmentId/unread — unread count ─────────
router.get('/:appointmentId/unread', authMiddleware, async (req, res) => {
    try {
        const pool   = await poolPromise;
        const apptId = parseInt(req.params.appointmentId);
        const role   = req.user.role;
        const fromRole = role === 'parent' ? 'pediatrician' : 'parent';

        const r = await pool.request()
            .input('apptId',     sql.Int,      apptId)
            .input('senderRole', sql.NVarChar, fromRole)
            .query(`SELECT COUNT(*) AS unread FROM chat_messages
                    WHERE appointmentId=@apptId AND senderRole=@senderRole AND isRead=0`);
        res.json({ success: true, unread: r.recordset[0].unread });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
