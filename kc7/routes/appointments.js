// routes/appointments.js — KinderCura v3.0 (FULLY FIXED)
// Statuses: pending | approved | completed | cancelled | rejected
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const emailConfigured = () =>
    process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your_email@gmail.com' &&
    process.env.EMAIL_PASS && process.env.EMAIL_PASS !== 'your_gmail_app_password';

function wrap(content) {
    return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#6B8E6F;padding:20px;text-align:center;border-radius:10px 10px 0 0;">
            <h1 style="color:white;margin:0;"><span style="color:#E8A5A5;">Kinder</span>Cura</h1>
        </div>
        <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;">${content}</div>
        <p style="text-align:center;color:#aaa;font-size:0.78rem;margin-top:12px;">KinderCura — Supporting Your Child's Development Journey</p>
    </div>`;
}

async function sendEmail(to, subject, html) {
    if (!emailConfigured()) { console.log(`\n[EMAIL] To:${to} | ${subject}\n`); return; }
    try {
        await transporter.sendMail({ from: `"KinderCura" <${process.env.EMAIL_USER}>`, to, subject, html: wrap(html) });
    } catch (e) { console.error('Email error:', e.message); }
}

function fmtDate(d) {
    if (!d) return '—';
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

    // Handle actual Date objects returned by mssql
    if (d instanceof Date) {
        return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    }

    // Parse ISO date parts directly to avoid UTC timezone shift
    // handles "2026-03-30" or "2026-03-30T00:00:00"
    const str = String(d).split('T')[0];
    const parts = str.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        const month = months[parseInt(parts[1], 10) - 1] || parts[1];
        const day   = parseInt(parts[2], 10);
        const year  = parts[0];
        return `${month} ${day}, ${year}`;
    }

    // Fallback: parse as generic Date string e.g. "Wed Apr 01 2026 08:00:00 GMT"
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) {
        return `${months[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
    }

    return str;
}

function fmtTime(t) {
    if (!t) return '—';
    // mssql TIME columns may come back as Date objects or ISO strings "1970-01-01T..."
    if (t instanceof Date || (typeof t === 'object')) {
        const d = new Date(t);
        const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2,'0');
        return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    const s = String(t);
    if (s.indexOf('T') !== -1 || s.indexOf('Z') !== -1 || s.length > 8) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2,'0');
            return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
        }
    }
    const parts = s.split(':');
    const h = parseInt(parts[0], 10), m = String(parts[1] || '00').padStart(2,'0');
    if (isNaN(h)) return s;
    return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

async function notifyParent(pool, parentId, title, message) {
    await pool.request()
        .input('userId',  sql.Int,      parentId)
        .input('title',   sql.NVarChar, title)
        .input('message', sql.NVarChar, message)
        .input('type',    sql.NVarChar, 'appointment')
        .query(`INSERT INTO notifications (userId,title,message,type) VALUES (@userId,@title,@message,@type)`);
}

// ── GET /pediatricians/list ───────────────────────────────────────────────────
router.get('/pediatricians/list', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const r = await pool.request().query(
            `SELECT id,firstName,lastName,specialization,institution FROM users WHERE role='pediatrician' AND status='active'`
        );
        res.json({ success:true, pediatricians:r.recordset });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── GET /pedia — all appointments for logged-in pediatrician ──────────────────
router.get('/pedia', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'pediatrician')
            return res.status(403).json({ error:'Pediatricians only.' });
        const pool = await poolPromise;
        const r = await pool.request()
            .input('pedId', sql.Int, req.user.userId)
            .query(`
                SELECT a.id, a.childId, a.appointmentDate, a.appointmentTime, a.reason, a.notes, a.status, a.createdAt,
                       c.firstName AS childFirstName, c.lastName AS childLastName, c.dateOfBirth AS childDob,
                       p.firstName AS parentFirstName, p.lastName AS parentLastName, p.email AS parentEmail
                FROM appointments a
                JOIN children c ON a.childId  = c.id
                JOIN users    p ON a.parentId = p.id
                WHERE a.pediatricianId = @pedId
                ORDER BY a.appointmentDate DESC, a.createdAt DESC, a.id DESC
            `);
        const rows = r.recordset.map(row => {
            let age = '';
            if (row.childDob) {
                const dob = new Date(row.childDob), now = new Date();
                let y = now.getFullYear()-dob.getFullYear(), mo = now.getMonth()-dob.getMonth();
                if (mo<0){y--;mo+=12;}
                const ys = y > 0 ? `${y} year${y !== 1 ? 's' : ''}` : '';
                const ms = `${mo} month${mo !== 1 ? 's' : ''}`;
                age = y > 0 ? `${ys} ${ms}`.trim() : ms;
            }
            return { ...row, childAge: age || '—' };
        });
        res.json({ success:true, appointments:rows });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── POST /create ──────────────────────────────────────────────────────────────
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { childId, pediatricianId, appointmentDate, appointmentTime, reason, notes, location } = req.body;
        if (!childId || !appointmentDate || !appointmentTime)
            return res.status(400).json({ error:'Child, date, and time are required.' });

        const pool = await poolPromise;
        const ins = await pool.request()
            .input('childId',         sql.Int,      childId)
            .input('parentId',        sql.Int,      req.user.userId)
            .input('pediatricianId',  sql.Int,      pediatricianId || null)
            .input('appointmentDate', sql.Date,     appointmentDate)
            .input('appointmentTime', sql.NVarChar, appointmentTime)
            .input('reason',          sql.NVarChar, reason || null)
            .input('notes',           sql.NVarChar, notes  || null)
            .input('location',        sql.NVarChar, location || null)
            .query(`INSERT INTO appointments (childId,parentId,pediatricianId,appointmentDate,appointmentTime,reason,notes,location)
                    OUTPUT INSERTED.id VALUES (@childId,@parentId,@pediatricianId,@appointmentDate,@appointmentTime,@reason,@notes,@location)`);

        const appointmentId = ins.recordset[0].id;

        if (pediatricianId) {
            const [parentQ, childQ, pedQ] = await Promise.all([
                pool.request().input('id',sql.Int,req.user.userId).query('SELECT firstName,lastName,email FROM users WHERE id=@id'),
                pool.request().input('id',sql.Int,childId).query('SELECT firstName,lastName FROM children WHERE id=@id'),
                pool.request().input('id',sql.Int,pediatricianId).query('SELECT firstName,lastName,email FROM users WHERE id=@id'),
            ]);
            const parent = parentQ.recordset[0];
            const child  = childQ.recordset[0];
            const pedia  = pedQ.recordset[0];

            if (parent && child && pedia) {
                const dateStr = fmtDate(appointmentDate);
                const timeStr = fmtTime(appointmentTime);

                // In-app for pedia
                await pool.request()
                    .input('userId', sql.Int, pediatricianId)
                    .input('title',  sql.NVarChar, `New Appointment Request`)
                    .input('message',sql.NVarChar, `${parent.firstName} ${parent.lastName} requested an appointment for ${child.firstName} ${child.lastName} on ${dateStr} at ${timeStr}.`)
                    .input('type',   sql.NVarChar, 'appointment')
                    .query(`INSERT INTO notifications (userId,title,message,type) VALUES (@userId,@title,@message,@type)`);

                // pedia_notifications row
                await pool.request()
                    .input('pediatricianId',  sql.Int,      pediatricianId)
                    .input('appointmentId',   sql.Int,      appointmentId)
                    .input('parentName',      sql.NVarChar, `${parent.firstName} ${parent.lastName}`)
                    .input('childName',       sql.NVarChar, `${child.firstName} ${child.lastName}`)
                    .input('appointmentDate', sql.Date,     appointmentDate)
                    .input('appointmentTime', sql.NVarChar, appointmentTime)
                    .input('reason',          sql.NVarChar, reason || 'General checkup')
                    .query(`INSERT INTO pedia_notifications (pediatricianId,appointmentId,parentName,childName,appointmentDate,appointmentTime,reason)
                            VALUES (@pediatricianId,@appointmentId,@parentName,@childName,@appointmentDate,@appointmentTime,@reason)`);

                // Email to pedia
                await sendEmail(pedia.email,
                    `New Appointment Request — ${child.firstName} ${child.lastName}`,
                    `<h2>New Appointment Request</h2>
                     <p>Hello Dr. ${pedia.firstName} ${pedia.lastName},</p>
                     <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
                         <p><strong>Patient:</strong> ${child.firstName} ${child.lastName}</p>
                         <p><strong>Parent:</strong> ${parent.firstName} ${parent.lastName}</p>
                         <p><strong>Date:</strong> ${dateStr}</p>
                         <p><strong>Time:</strong> ${timeStr}</p>
                         <p><strong>Reason:</strong> ${reason || 'General checkup'}</p>
                         ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
                     </div>
                     <p>Log in to KinderCura to <strong>approve or reject</strong> this request.</p>`
                );
            }
        }
        res.status(201).json({ success:true, appointmentId });
    } catch (err) { console.error(err); res.status(500).json({ error:err.message }); }
});

// ── PUT /:id/status — pedia updates appointment status ────────────────────────
router.put('/:appointmentId/status', authMiddleware, async (req, res) => {
    try {
        const VALID = ['approved','rejected','completed','cancelled'];
        const { status, notes } = req.body;
        if (!VALID.includes(status))
            return res.status(400).json({ error:`Status must be: ${VALID.join(', ')}` });

        const pool = await poolPromise;
        const apptQ = await pool.request()
            .input('id', sql.Int, req.params.appointmentId)
            .query(`SELECT a.id, a.childId, a.parentId, a.pediatricianId, a.appointmentDate, a.appointmentTime, a.reason, a.notes, a.status,
                           c.firstName AS childFirst, c.lastName AS childLast,
                           p.firstName AS parentFirst, p.lastName AS parentLast, p.email AS parentEmail,
                           u.firstName AS pedFirst, u.lastName AS pedLast
                    FROM appointments a
                    JOIN children c ON a.childId=c.id
                    JOIN users    p ON a.parentId=p.id
                    LEFT JOIN users u ON a.pediatricianId=u.id
                    WHERE a.id=@id`);

        if (!apptQ.recordset.length) return res.status(404).json({ error:'Appointment not found.' });
        const appt = apptQ.recordset[0];

        await pool.request()
            .input('id',     sql.Int,      req.params.appointmentId)
            .input('status', sql.NVarChar, status)
            .input('notes',  sql.NVarChar, notes || null)
            .query(`UPDATE appointments SET status=@status, notes=COALESCE(@notes,notes) WHERE id=@id`);

        // Sync pedia_notifications (map 'rejected' → 'declined' for that table's CHECK constraint)
        // Only sync pedia_notifications for statuses its CHECK constraint allows
        const pnStatus = status === 'rejected' ? 'declined' : (status === 'approved' ? 'approved' : null);
        if (pnStatus) {
            await pool.request()
                .input('apptId', sql.Int,      appt.id)
                .input('status', sql.NVarChar, pnStatus)
                .query(`UPDATE pedia_notifications SET status=@status WHERE appointmentId=@apptId`);
        }

        const dateStr = fmtDate(appt.appointmentDate);
        const timeStr = fmtTime(appt.appointmentTime);
        const pedName = appt.pedFirst ? `Dr. ${appt.pedFirst} ${appt.pedLast}` : 'Your Pediatrician';

        const labels = { approved:'Approved', rejected:'Rejected', completed:'Completed', cancelled:'Cancelled' };
        const colors = { approved:'#27ae60', rejected:'#e74c3c', completed:'#6B8E6F', cancelled:'#888' };
        const label = labels[status] || status;
        const color = colors[status] || '#888';

        // In-app notification → parent
        await notifyParent(pool, appt.parentId,
            `Appointment ${label}`,
            `Your appointment with ${pedName} for ${appt.childFirst} ${appt.childLast} on ${dateStr} at ${timeStr} has been ${label}.`
        );

        const extras = {
            approved:  `<p>Please be on time. Contact us through KinderCura if you need to reschedule.</p>`,
            rejected:  `<p>You may book another appointment with a different schedule or pediatrician.</p>`,
            completed: `<p>Thank you for visiting. Check the Results page for notes.</p>`,
            cancelled: `<p>Your appointment has been cancelled. You may book a new one anytime.</p>`,
        };

        await sendEmail(appt.parentEmail,
            `Appointment ${label} — KinderCura`,
            `<h2>Appointment Status Update</h2>
             <p>Hello ${appt.parentFirst},</p>
             <p>Your appointment is now <strong style="color:${color};">${label}</strong>.</p>
             <div style="background:white;border-left:4px solid ${color};padding:16px;border-radius:6px;margin:16px 0;">
                 <p><strong>Patient:</strong> ${appt.childFirst} ${appt.childLast}</p>
                 <p><strong>Pediatrician:</strong> ${pedName}</p>
                 <p><strong>Date:</strong> ${dateStr}</p>
                 <p><strong>Time:</strong> ${timeStr}</p>
                 <p><strong>Reason:</strong> ${appt.reason || 'General checkup'}</p>
                 <p><strong>Status:</strong> <span style="color:${color};font-weight:bold;">${label}</span></p>
                 ${notes ? `<p><strong>Note:</strong> ${notes}</p>` : ''}
             </div>
             ${extras[status] || ''}`
        );

        res.json({ success:true });
    } catch (err) { console.error(err); res.status(500).json({ error:err.message }); }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────
router.post('/:appointmentId/cancel', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const apptQ = await pool.request()
            .input('id', sql.Int, req.params.appointmentId)
            .query(`SELECT a.id, a.childId, a.parentId, a.pediatricianId, a.appointmentDate, a.appointmentTime, a.reason, a.notes, a.status,
                           c.firstName AS childFirst, c.lastName AS childLast,
                           p.firstName AS parentFirst, p.email AS parentEmail,
                           u.firstName AS pedFirst, u.lastName AS pedLast
                    FROM appointments a
                    JOIN children c ON a.childId=c.id
                    JOIN users    p ON a.parentId=p.id
                    LEFT JOIN users u ON a.pediatricianId=u.id
                    WHERE a.id=@id`);

        if (!apptQ.recordset.length) return res.status(404).json({ error:'Not found.' });
        const appt = apptQ.recordset[0];

        await pool.request().input('id',sql.Int,req.params.appointmentId)
            .query(`UPDATE appointments SET status='cancelled' WHERE id=@id`);
        await pool.request().input('apptId',sql.Int,appt.id)
            .query(`UPDATE pedia_notifications SET status='declined' WHERE appointmentId=@apptId`);

        const dateStr = fmtDate(appt.appointmentDate);
        const timeStr = fmtTime(appt.appointmentTime);
        await notifyParent(pool, appt.parentId, `Appointment Cancelled`,
            `Your appointment for ${appt.childFirst} ${appt.childLast} on ${dateStr} at ${timeStr} has been cancelled.`);
        await sendEmail(appt.parentEmail, `Appointment Cancelled — KinderCura`,
            `<h2>Appointment Cancelled</h2>
             <p>Hello ${appt.parentFirst},</p>
             <div style="background:white;border-left:4px solid #e74c3c;padding:16px;border-radius:6px;margin:16px 0;">
                 <p><strong>Patient:</strong> ${appt.childFirst} ${appt.childLast}</p>
                 <p><strong>Date:</strong> ${dateStr}</p><p><strong>Time:</strong> ${timeStr}</p>
             </div>
             <p>You may book a new appointment through KinderCura at any time.</p>`
        );
        res.json({ success:true });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── POST /:id/reschedule ──────────────────────────────────────────────────────
router.post('/:appointmentId/reschedule', authMiddleware, async (req, res) => {
    try {
        const { newDate, newTime, reason, note } = req.body;
        if (!newDate || !newTime) return res.status(400).json({ error:'New date and time required.' });

        const pool = await poolPromise;
        const apptQ = await pool.request()
            .input('id', sql.Int, req.params.appointmentId)
            .query(`SELECT a.id, a.childId, a.parentId, a.pediatricianId, a.appointmentDate, a.appointmentTime, a.reason, a.notes, a.status,
                           c.firstName AS childFirst, c.lastName AS childLast,
                           p.firstName AS parentFirst, p.email AS parentEmail,
                           u.firstName AS pedFirst, u.lastName AS pedLast
                    FROM appointments a
                    JOIN children c ON a.childId=c.id
                    JOIN users    p ON a.parentId=p.id
                    LEFT JOIN users u ON a.pediatricianId=u.id
                    WHERE a.id=@id`);

        if (!apptQ.recordset.length) return res.status(404).json({ error:'Not found.' });
        const appt = apptQ.recordset[0];

        await pool.request()
            .input('id',   sql.Int,      req.params.appointmentId)
            .input('date', sql.Date,     newDate)
            .input('time', sql.NVarChar, newTime)
            .query(`UPDATE appointments SET appointmentDate=@date, appointmentTime=@time, status='approved' WHERE id=@id`);

        await pool.request()
            .input('apptId', sql.Int,      appt.id)
            .input('date',   sql.Date,     newDate)
            .input('time',   sql.NVarChar, newTime)
            .query(`UPDATE pedia_notifications SET appointmentDate=@date, appointmentTime=@time, status='approved' WHERE appointmentId=@apptId`);

        const dateStr = fmtDate(newDate);
        const timeStr = fmtTime(newTime);
        const pedName = appt.pedFirst ? `Dr. ${appt.pedFirst} ${appt.pedLast}` : 'Your Pediatrician';

        await notifyParent(pool, appt.parentId, `Appointment Rescheduled`,
            `Your appointment with ${pedName} for ${appt.childFirst} ${appt.childLast} has been rescheduled to ${dateStr} at ${timeStr}.`);

        await sendEmail(appt.parentEmail, `Appointment Rescheduled — KinderCura`,
            `<h2>Appointment Rescheduled </h2>
             <p>Hello ${appt.parentFirst},</p>
             <div style="background:white;border-left:4px solid #6B8E6F;padding:16px;border-radius:6px;margin:16px 0;">
                 <p><strong>Patient:</strong> ${appt.childFirst} ${appt.childLast}</p>
                 <p><strong>Pediatrician:</strong> ${pedName}</p>
                 <p><strong>New Date:</strong> ${dateStr}</p>
                 <p><strong>New Time:</strong> ${timeStr}</p>
                 ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
                 ${note   ? `<p><strong>Note:</strong> ${note}</p>` : ''}
             </div>
             <p>Please be on time for your rescheduled appointment.</p>`
        );
        res.json({ success:true });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── GET /pedia-notifications ──────────────────────────────────────────────────
router.get('/pedia-notifications', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const r = await pool.request()
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT pn.*, a.status AS appointmentStatus
                    FROM   pedia_notifications pn
                    LEFT JOIN appointments a ON pn.appointmentId = a.id
                    WHERE  pn.pediatricianId = @pedId
                    ORDER  BY pn.createdAt DESC`);
        res.json({ success:true, notifications:r.recordset });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── PUT /pedia-notifications/:id — approve or decline appointment ──────────────
// ── PUT /pedia-notifications/:id — approve or decline from dashboard ──────────
// Delegates to /:appointmentId/status which handles DB update + email + in-app notif
router.put('/pedia-notifications/:id', authMiddleware, async (req, res) => {
    try {
        const { status } = req.body; // 'approved' or 'declined'
        if (!['approved', 'declined'].includes(status))
            return res.status(400).json({ error: 'Status must be approved or declined.' });

        const pool = await poolPromise;

        // Get the linked appointmentId
        const notifResult = await pool.request()
            .input('id',    sql.Int, req.params.id)
            .input('pedId', sql.Int, req.user.userId)
            .query(`SELECT appointmentId FROM pedia_notifications WHERE id=@id AND pediatricianId=@pedId`);

        if (!notifResult.recordset.length)
            return res.status(404).json({ error: 'Notification not found.' });

        const appointmentId = notifResult.recordset[0].appointmentId;
        if (!appointmentId)
            return res.status(400).json({ error: 'No appointment linked to this notification.' });

        // Get full appointment + parent + child details for email
        const apptQ = await pool.request()
            .input('id', sql.Int, appointmentId)
            .query(`SELECT a.id, a.childId, a.parentId, a.pediatricianId, a.appointmentDate, a.appointmentTime, a.reason, a.notes, a.status,
                           c.firstName AS childFirst, c.lastName AS childLast,
                           p.firstName AS parentFirst, p.lastName AS parentLast, p.email AS parentEmail,
                           u.firstName AS pedFirst, u.lastName AS pedLast, u.specialization AS pedSpec
                    FROM appointments a
                    JOIN children c ON a.childId=c.id
                    JOIN users    p ON a.parentId=p.id
                    LEFT JOIN users u ON a.pediatricianId=u.id
                    WHERE a.id=@id`);

        if (!apptQ.recordset.length)
            return res.status(404).json({ error: 'Appointment not found.' });

        const appt = apptQ.recordset[0];

        // Map 'declined' → 'rejected' for appointments table (schema uses 'rejected')
        const apptStatus = status === 'declined' ? 'rejected' : status;

        // Update appointment status
        await pool.request()
            .input('id',     sql.Int,      appointmentId)
            .input('status', sql.NVarChar, apptStatus)
            .query(`UPDATE appointments SET status=@status WHERE id=@id`);

        // Update pedia_notification status
        await pool.request()
            .input('id',     sql.Int,      req.params.id)
            .input('status', sql.NVarChar, status)
            .query(`UPDATE pedia_notifications SET status=@status WHERE id=@id`);

        // Build email content
        const dateStr = fmtDate(appt.appointmentDate);
        const timeStr = fmtTime(appt.appointmentTime);
        const pedName = appt.pedFirst ? `Dr. ${appt.pedFirst} ${appt.pedLast}` : 'Your Pediatrician';
        const childName = `${appt.childFirst} ${appt.childLast}`;

        if (status === 'approved') {
            await notifyParent(pool, appt.parentId,
                'Appointment Approved',
                `Your appointment for ${childName} on ${dateStr} at ${timeStr} has been approved by ${pedName}.`
            );
            await sendEmail(appt.parentEmail, `Appointment Approved — KinderCura`,
                `<h2 style="color:#27ae60;">Your Appointment Has Been Approved!</h2>
                 <p>Hello <strong>${appt.parentFirst}</strong>,</p>
                 <p><strong>${pedName}</strong> has approved your appointment for <strong>${childName}</strong>.</p>
                 <div style="background:#f0f7f2;border-left:4px solid #27ae60;padding:16px;border-radius:6px;margin:16px 0;">
                     <p><strong>Date:</strong> ${dateStr}</p>
                     <p><strong>Time:</strong> ${timeStr}</p>
                     <p><strong>Pediatrician:</strong> ${pedName}${appt.pedSpec ? ` (${appt.pedSpec})` : ''}</p>
                     <p><strong>Reason:</strong> ${appt.reason || 'General checkup'}</p>
                 </div>
                 <p>Please arrive on time. Contact us through KinderCura if you need to reschedule.</p>`
            );
        } else {
            await notifyParent(pool, appt.parentId,
                'Appointment Declined',
                `Your appointment request for ${childName} on ${dateStr} was declined. Please book a new time.`
            );
            await sendEmail(appt.parentEmail, `Appointment Declined — KinderCura`,
                `<h2 style="color:#e74c3c;">Appointment Request Declined</h2>
                 <p>Hello <strong>${appt.parentFirst}</strong>,</p>
                 <p>We're sorry, <strong>${pedName}</strong> was unable to approve the appointment for <strong>${childName}</strong>.</p>
                 <div style="background:#fdf2f2;border-left:4px solid #e74c3c;padding:16px;border-radius:6px;margin:16px 0;">
                     <p><strong>Requested Date:</strong> ${dateStr}</p>
                     <p><strong>Requested Time:</strong> ${timeStr}</p>
                     <p><strong>Pediatrician:</strong> ${pedName}</p>
                 </div>
                 <p>You may book a new appointment at a different time through the KinderCura app.</p>`
            );
        }

        res.json({ success: true, status });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── GET /:userId — parent appointments ────────────────────────────────────────
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        const r = await pool.request()
            .input('parentId', sql.Int, req.params.userId)
            .query(`SELECT a.*,
                           c.firstName+' '+c.lastName AS childName,
                           u.firstName+' '+u.lastName AS pediatricianName,
                           u.specialization AS pediatricianSpecialization
                    FROM   appointments a
                    LEFT JOIN children c ON a.childId=c.id
                    LEFT JOIN users    u ON a.pediatricianId=u.id
                    WHERE  a.parentId=@parentId
                    ORDER  BY a.appointmentDate DESC, a.createdAt DESC, a.id DESC`);
        res.json({ success:true, appointments:r.recordset });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── PUT /:appointmentId — general ─────────────────────────────────────────────
router.put('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const { status, notes } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('id',     sql.Int,      req.params.appointmentId)
            .input('status', sql.NVarChar, status || null)
            .input('notes',  sql.NVarChar, notes  || null)
            .query(`UPDATE appointments SET status=COALESCE(@status,status), notes=COALESCE(@notes,notes) WHERE id=@id`);
        res.json({ success:true });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── DELETE /:appointmentId ────────────────────────────────────────────────────
router.delete('/:appointmentId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().input('id',sql.Int,req.params.appointmentId)
            .query('DELETE FROM appointments WHERE id=@id');
        res.json({ success:true });
    } catch (err) { res.status(500).json({ error:err.message }); }
});

module.exports = router;
