// server.js — KinderCura API Server v3.0
const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const app = express();

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static asset folders ───────────────────────────────────────
app.use('/css',           express.static(path.join(__dirname, 'CSS files')));
app.use('/icons',         express.static(path.join(__dirname, 'ICONS')));
app.use('/uploads',       express.static(path.join(__dirname, 'public/uploads')));

// ← FIX: HTML pages reference /assets/css and /assets/images
app.use('/assets/css',    express.static(path.join(__dirname, 'CSS files')));
app.use('/assets/images', express.static(path.join(__dirname, 'ICONS')));

// api.js and questions-database.json served at root /
app.use(express.static(__dirname, { index: false }));

// ── HTML page routes ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'SIGN-UP,LOGIN')));

app.get('/parent/:page', (req, res) => res.sendFile(path.join(__dirname, 'PARENT',  req.params.page)));
app.get('/pedia/:page',  (req, res) => res.sendFile(path.join(__dirname, 'PEDIA',   req.params.page)));
app.get('/admin/:page',  (req, res) => res.sendFile(path.join(__dirname, 'ADMIN',   req.params.page)));

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth',            require('./routes/auth'));
app.use('/api/upload',          require('./routes/upload'));
app.use('/api/admin',           require('./routes/admin'));
app.use('/api/children',        require('./routes/children'));
app.use('/api/assessments',     require('./routes/assessments'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/appointments',    require('./routes/appointments'));
app.use('/api/notifications',   require('./routes/notifications'));

// ── v4.0 NEW ROUTES ────────────────────────────────────────────
app.use('/api/videos',    require('./routes/videos'));           // video attachments
app.use('/api/chat',      require('./routes/chat'));             // chat system
app.use('/api/questions', require('./routes/custom-questions')); // custom + static questions

app.get('/api/health', (req, res) => res.json({ status: 'OK', server: 'KinderCura v4.0', time: new Date() }));

// Fallback → landing page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'SIGN-UP,LOGIN', 'landing.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀  KinderCura running → http://localhost:${PORT}`);
    console.log(`    PARENT/  → http://localhost:${PORT}/parent/dashboard.html`);
    console.log(`    PEDIA/   → http://localhost:${PORT}/pedia/pediatrician-dashboard.html`);
    console.log(`    ADMIN/   → http://localhost:${PORT}/admin/admin-dashboard.html\n`);
});