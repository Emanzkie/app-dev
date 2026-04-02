const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications — get all notifications for logged-in user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .query(`SELECT * FROM notifications
                    WHERE userId = @userId
                    ORDER BY createdAt DESC`);
        res.json({ success: true, notifications: result.recordset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notifications/count — unread count
router.get('/count', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .query(`SELECT COUNT(*) AS unread FROM notifications
                    WHERE userId = @userId AND isRead = 0`);
        res.json({ success: true, unread: result.recordset[0].unread });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/:id/read — mark one as read
router.put('/:id/read', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id',     sql.Int, req.params.id)
            .input('userId', sql.Int, req.user.userId)
            .query(`UPDATE notifications SET isRead = 1
                    WHERE id = @id AND userId = @userId`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('userId', sql.Int, req.user.userId)
            .query(`UPDATE notifications SET isRead = 1 WHERE userId = @userId`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
