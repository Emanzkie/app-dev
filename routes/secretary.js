// routes/secretary.js
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:
//   This file handles all "Clinic Assistant/Secretary" account logic in KinderCura.
//
//   NEW FLOW (per panelist recommendation):
//   - The PEDIATRICIAN creates and manages their own secretary directly
//     from their Settings page ("Staff Access" tab).
//   - The admin can still VIEW secretaries in the user list for auditing,
//     but CANNOT create or link them.
//   - A pediatrician can only see and manage secretaries linked to themselves.
//   - Each secretary is always linked to exactly one pediatrician.
//
// Endpoints:
//   GET  /api/secretary/me                — secretary: get own profile + linked pedia
//   GET  /api/secretary/my-staff          — pediatrician: list own secretaries
//   POST /api/secretary/create            — pediatrician: create a new secretary
//   PUT  /api/secretary/:id/permissions   — pediatrician: update secretary permissions
//   PUT  /api/secretary/:id/deactivate    — pediatrician: deactivate a secretary
//   GET  /api/secretary/list              — admin only: see all secretaries (audit)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();

const { authMiddleware, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const sse = require('../sse');

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

// publicSecretaryProfile — the shape sent back to the secretary's own
// dashboard pages. It includes the linked pediatrician's info so the
// "On behalf of Dr. X" banner and role badge render correctly.
function publicSecretaryProfile(secretary, linkedPediatricianDoc = null) {
  return {
    id: String(secretary._id),
    firstName: secretary.firstName,
    middleName: secretary.middleName || null,
    lastName: secretary.lastName,
    username: secretary.username,
    email: secretary.email,
    role: secretary.role,           // always 'secretary'
    status: secretary.status,
    profileIcon: secretary.profileIcon || 'avatar1',
    // Permissions granted by the pediatrician (stored in the User document).
    permissions: secretary.secretaryPermissions || defaultPermissions(),
    linkedPediatricianId: secretary.linkedPediatricianId
      ? String(secretary.linkedPediatricianId)
      : null,
    linkedPediatrician: linkedPediatricianDoc
      ? {
          id:             String(linkedPediatricianDoc._id),
          firstName:      linkedPediatricianDoc.firstName,
          lastName:       linkedPediatricianDoc.lastName,
          clinicName:     linkedPediatricianDoc.clinicName || linkedPediatricianDoc.institution || null,
          clinicAddress:  linkedPediatricianDoc.clinicAddress || null,
          specialization: linkedPediatricianDoc.specialization || null,
        }
      : null,
  };
}

// defaultPermissions — what a newly created secretary can do by default.
// The pediatrician can turn individual permissions on/off from Settings.
function defaultPermissions() {
  return {
    viewAppointments:    true,   // can see the appointment list
    manageBookings:      true,   // can approve / reject booking requests
    rescheduleRequests:  true,   // can propose new dates/times
    approveSchedules:    true,   // can mark approved appointments as confirmed
  };
}

// ─── GET /api/secretary/me ────────────────────────────────────────────────────
// Returns the logged-in secretary's profile including linked pediatrician data.
// Called on both the secretary dashboard and appointments page load.
router.get('/me', authMiddleware, async (req, res) => {
  try {
    // Guard: only secretary accounts may call this endpoint.
    if (req.user.role !== 'secretary') {
      return res.status(403).json({ error: 'Assistant/Secretary accounts only..' });
    }

    const secretary = await User.findById(req.user.userId).lean();
    if (!secretary) {
      return res.status(404).json({ error: 'Secretary account not found.' });
    }

    // Load the linked pediatrician if one is set.
    let linkedPediatrician = null;
    if (secretary.linkedPediatricianId) {
      linkedPediatrician = await User.findById(secretary.linkedPediatricianId)
        .select('firstName lastName clinicName clinicAddress institution specialization')
        .lean();
    }

    res.json({
      success: true,
      secretary: publicSecretaryProfile(secretary, linkedPediatrician),
    });
  } catch (err) {
    console.error('secretary /me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/secretary/my-staff  (pediatrician only) ────────────────────────
// Returns all secretary accounts linked to the currently logged-in pediatrician.
// Used by the Pediatrician's Settings > "Staff Access" tab.
router.get('/my-staff', authMiddleware, async (req, res) => {
  try {
    // Guard: only a pediatrician can see their own staff list.
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    // Find all secretaries whose linkedPediatricianId points to this pedia.
    const secretaries = await User.find({
      role: 'secretary',
      linkedPediatricianId: req.user.userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      staff: secretaries.map((s) => ({
        id:          String(s._id),
        firstName:   s.firstName,
        lastName:    s.lastName,
        email:       s.email,
        username:    s.username,
        status:      s.status,
        permissions: s.secretaryPermissions || defaultPermissions(),
        createdAt:   s.createdAt,
      })),
    });
  } catch (err) {
    console.error('secretary /my-staff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/secretary/create  (pediatrician only) ─────────────────────────
// Important: The pediatrician creates the secretary account directly.
// The newly created secretary is automatically linked to the creating pediatrician.
// No admin involvement is needed for creation.
router.post('/create', authMiddleware, async (req, res) => {
  try {
    // Guard: only a pediatrician may create a secretary account.
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Only a pediatrician can create an assistant/secretary account.' });
    }

    const { firstName, lastName, middleName, username, email, password } = req.body;

    // Validate all required fields are present.
    if (!firstName || !lastName || !username || !email || !password) {
      return res.status(400).json({
        error: 'First name, last name, username, email, and password are all required.',
      });
    }
    if (!isValidEmail(String(email).trim().toLowerCase())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const cleanEmail    = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim();

    // Reject duplicate email or username across all user roles.
    const existing = await User.findOne({
      $or: [{ email: cleanEmail }, { username: cleanUsername }],
    }).select('_id').lean();
    if (existing) {
      return res.status(409).json({ error: 'Email or username is already in use.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    // Important: The secretary is immediately linked to the creating pediatrician.
    // linkedPediatricianId ensures all appointment queries are scoped correctly.
    const secretary = await User.create({
      firstName:             String(firstName).trim(),
      middleName:            middleName ? String(middleName).trim() : null,
      lastName:              String(lastName).trim(),
      username:              cleanUsername,
      email:                 cleanEmail,
      passwordHash,
      role:                  'secretary',
      status:                'active',          // active immediately; pedia has verified them
      emailVerified:         true,
      linkedPediatricianId:  req.user.userId,   // auto-link to the creating pediatrician
      secretaryPermissions:  defaultPermissions(), // default full scheduling permissions
    });

    sse.broadcast('analytics:update', { type: 'user', action: 'create', role: 'secretary' });

    res.status(201).json({
      success: true,
      message: `Assistant/Assistant/Secretary account created for ${secretary.firstName} ${secretary.lastName}. They can now log in with the credentials you provided.`,
      secretaryId: String(secretary._id),
    });
  } catch (err) {
    console.error('secretary /create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/secretary/:id/permissions  (pediatrician only) ─────────────────
// Allows the pediatrician to update which scheduling actions their secretary
// is permitted to perform. Medical decisions are never included here.
router.put('/:id/permissions', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    // Important: only allow editing secretaries that belong to THIS pediatrician.
    const secretary = await User.findOne({
      _id: req.params.id,
      role: 'secretary',
      linkedPediatricianId: req.user.userId,
    });
    if (!secretary) {
      return res.status(404).json({ error: 'Assistant/Secretary not found or not linked to your account.' });
    }

    const {
      viewAppointments,
      manageBookings,
      rescheduleRequests,
      approveSchedules,
    } = req.body;

    // Merge incoming permissions with existing ones; only update fields that were sent.
    const current = secretary.secretaryPermissions || defaultPermissions();
    secretary.secretaryPermissions = {
      viewAppointments:   viewAppointments   !== undefined ? Boolean(viewAppointments)   : current.viewAppointments,
      manageBookings:     manageBookings     !== undefined ? Boolean(manageBookings)     : current.manageBookings,
      rescheduleRequests: rescheduleRequests !== undefined ? Boolean(rescheduleRequests) : current.rescheduleRequests,
      approveSchedules:   approveSchedules   !== undefined ? Boolean(approveSchedules)   : current.approveSchedules,
    };
    await secretary.save();

    res.json({
      success: true,
      message: `Permissions updated for ${secretary.firstName} ${secretary.lastName}.`,
      permissions: secretary.secretaryPermissions,
    });
  } catch (err) {
    console.error('secretary /permissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/secretary/:id/deactivate  (pediatrician only) ──────────────────
// Allows the pediatrician to deactivate (or re-activate) their secretary
// without deleting the account.
router.put('/:id/deactivate', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'pediatrician') {
      return res.status(403).json({ error: 'Pediatricians only.' });
    }

    // Guard: pedia can only deactivate their own staff.
    const secretary = await User.findOne({
      _id: req.params.id,
      role: 'secretary',
      linkedPediatricianId: req.user.userId,
    });
    if (!secretary) {
      return res.status(404).json({ error: 'Assistant/Secretary not found or not linked to your account.' });
    }

    // Toggle: if already suspended, re-activate; otherwise suspend.
    secretary.status = secretary.status === 'suspended' ? 'active' : 'suspended';
    await secretary.save();

    const action = secretary.status === 'active' ? 'reactivated' : 'deactivated';
    res.json({
      success: true,
      message: `${secretary.firstName} ${secretary.lastName} has been ${action}.`,
      status: secretary.status,
    });
  } catch (err) {
    console.error('secretary /deactivate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/secretary/list  (admin only — audit view) ──────────────────────
// The admin can VIEW all secretary accounts for auditing purposes.
// The admin cannot create or modify secretaries; that is the pediatrician's role.
router.get('/list', authMiddleware, adminOnly, async (req, res) => {
  try {
    const secretaries = await User.find({ role: 'secretary' })
      .sort({ createdAt: -1 })
      .lean();

    // Fetch linked pediatrician names in a single query for efficiency.
    const pedIds = secretaries
      .filter((s) => s.linkedPediatricianId)
      .map((s) => s.linkedPediatricianId);

    const pediatricians = pedIds.length
      ? await User.find({ _id: { $in: pedIds } })
          .select('firstName lastName clinicName institution')
          .lean()
      : [];

    const pedMap = new Map(pediatricians.map((p) => [String(p._id), p]));

    res.json({
      success: true,
      secretaries: secretaries.map((s) => {
        const ped = s.linkedPediatricianId ? pedMap.get(String(s.linkedPediatricianId)) : null;
        return {
          id:                    String(s._id),
          firstName:             s.firstName,
          lastName:              s.lastName,
          username:              s.username,
          email:                 s.email,
          status:                s.status,
          createdAt:             s.createdAt,
          linkedPediatricianId:  s.linkedPediatricianId ? String(s.linkedPediatricianId) : null,
          // The pedia name so admin can see who each secretary belongs to.
          linkedPediatricianName: ped ? `Dr. ${ped.firstName} ${ped.lastName}` : 'Not linked',
        };
      }),
    });
  } catch (err) {
    console.error('secretary /list error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
