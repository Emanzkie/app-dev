// controllers/guardianController.js
const crypto = require('crypto');
const Child = require('../models/Child');
const GuardianInvitation = require('../models/GuardianInvitation');
const GuardianLink = require('../models/GuardianLink');
const PermissionSet = require('../models/PermissionSet');
const User = require('../models/User');
const { createLog } = require('./auditController');

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function generateInvitation(req, res) {
  try {
    const { childId, expiresHours = 48, note = null } = req.body;
    if (!childId) return res.status(400).json({ error: 'childId is required.' });

    const child = await Child.findById(childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isOwner = String(child.parentId) === String(req.user.userId);
    const isAdmin = req.user.role === 'admin';

    const primaryLink = await GuardianLink.findOne({ childId, guardianId: req.user.userId, isPrimary: true, status: 'active' }).lean();
    if (!isOwner && !primaryLink && !isAdmin) {
      return res.status(403).json({ error: 'Only the primary guardian or admin may generate invitation codes.' });
    }

    const rawCode = crypto.randomBytes(12).toString('hex');
    const codeHash = hashCode(rawCode);
    const expiresAt = expiresHours ? new Date(Date.now() + Number(expiresHours) * 3600 * 1000) : null;

    const inv = await GuardianInvitation.create({ codeHash, childId, createdBy: req.user.userId, expiresAt, singleUse: true, note });

    await createLog({ actorId: req.user.userId, action: 'invitation:create', targetType: 'Child', targetId: childId, details: { invitationId: inv._id }, ip: req.ip });

    // Return the raw code so the caller can email/share it. In production, this should be sent
    // only via verified email and not logged.
    res.json({ success: true, invitationCode: rawCode, invitationId: inv._id, expiresAt });
  } catch (err) {
    console.error('generateInvitation error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function acceptInvitation(req, res) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    const codeHash = hashCode(code);
    const invitation = await GuardianInvitation.findOne({ codeHash }).lean();
    if (!invitation) return res.status(404).json({ error: 'Invitation not found or invalid.' });
    if (invitation.used) return res.status(400).json({ error: 'This invitation has already been used.' });
    if (invitation.expiresAt && new Date() > new Date(invitation.expiresAt)) {
      return res.status(400).json({ error: 'Invitation has expired.' });
    }

    const childId = invitation.childId;

    // Find or create a default 'Standard' permission set
    let standard = await PermissionSet.findOne({ name: 'Standard' });
    if (!standard) {
      standard = await PermissionSet.create({ name: 'Standard', description: 'Default standard guardian permissions', permissions: {} });
    }

    // Upsert GuardianLink for this user/child
    const existing = await GuardianLink.findOne({ childId, guardianId: req.user.userId });
    if (existing) {
      if (existing.status === 'revoked') {
        existing.status = 'active';
        existing.permissionSet = standard._id;
        existing.permissions = standard.permissions;
        await existing.save();
      }
    } else {
      await GuardianLink.create({
        childId,
        guardianId: req.user.userId,
        isPrimary: false,
        status: 'active',
        permissions: standard.permissions,
        permissionSet: standard._id,
        createdBy: invitation.createdBy,
      });
    }

    // Mark invitation used
    await GuardianInvitation.findByIdAndUpdate(invitation._id, { used: true, usedBy: req.user.userId, usedAt: new Date() });

    await createLog({ actorId: req.user.userId, action: 'invitation:accept', targetType: 'Child', targetId: childId, details: { invitationId: invitation._id }, ip: req.ip });

    res.json({ success: true });
  } catch (err) {
    console.error('acceptInvitation error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listGuardians(req, res) {
  try {
    const { childId } = req.params;
    if (!childId) return res.status(400).json({ error: 'childId is required.' });

    const child = await Child.findById(childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isOwner = String(child.parentId) === String(req.user.userId) || req.user.role === 'admin';
    if (!isOwner) {
      // allow primary guardian
      const primary = await GuardianLink.findOne({ childId, guardianId: req.user.userId, isPrimary: true, status: 'active' }).lean();
      if (!primary) return res.status(403).json({ error: 'Access denied.' });
    }

    const links = await GuardianLink.find({ childId }).populate('guardianId', 'firstName lastName email').lean();
    res.json({ success: true, guardians: links.map((l) => ({ id: l._id, guardianId: l.guardianId?._id || l.guardianId, name: l.guardianId ? `${l.guardianId.firstName || ''} ${l.guardianId.lastName || ''}`.trim() : null, email: l.guardianId?.email || null, role: l.role, status: l.status, permissions: l.permissions })) });
  } catch (err) {
    console.error('listGuardians error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function updatePermissions(req, res) {
  try {
    const { childId, guardianId } = req.params;
    const { permissions } = req.body;
    if (!childId || !guardianId) return res.status(400).json({ error: 'childId and guardianId are required.' });

    const child = await Child.findById(childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isOwner = String(child.parentId) === String(req.user.userId) || req.user.role === 'admin';
    if (!isOwner) {
      const primary = await GuardianLink.findOne({ childId, guardianId: req.user.userId, isPrimary: true, status: 'active' }).lean();
      if (!primary) return res.status(403).json({ error: 'Only primary guardian or admin may change permissions.' });
    }

    const link = await GuardianLink.findOne({ childId, guardianId });
    if (!link) return res.status(404).json({ error: 'Guardian link not found.' });

    // Apply only allowed keys
    const allowedKeys = ['viewAssessments','submitAssessments','viewResults','uploadDocuments','manageAppointments','viewMedicalRecords','modifyChild','inviteGuardians','revokeAccess'];
    for (const k of Object.keys(permissions || {})) {
      if (allowedKeys.includes(k)) {
        link.permissions[k] = permissions[k];
      }
    }

    await link.save();
    await createLog({ actorId: req.user.userId, action: 'guardian:permissions:update', targetType: 'GuardianLink', targetId: link._id, details: { permissions: link.permissions }, ip: req.ip });

    res.json({ success: true });
  } catch (err) {
    console.error('updatePermissions error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function revokeGuardian(req, res) {
  try {
    const { childId, guardianId } = req.params;
    if (!childId || !guardianId) return res.status(400).json({ error: 'childId and guardianId are required.' });

    const child = await Child.findById(childId).lean();
    if (!child) return res.status(404).json({ error: 'Child not found.' });

    const isOwner = String(child.parentId) === String(req.user.userId) || req.user.role === 'admin';
    if (!isOwner) {
      const primary = await GuardianLink.findOne({ childId, guardianId: req.user.userId, isPrimary: true, status: 'active' }).lean();
      if (!primary) return res.status(403).json({ error: 'Only primary guardian or admin may revoke access.' });
    }

    const link = await GuardianLink.findOne({ childId, guardianId });
    if (!link) return res.status(404).json({ error: 'Guardian link not found.' });

    link.status = 'revoked';
    await link.save();

    await createLog({ actorId: req.user.userId, action: 'guardian:revoke', targetType: 'GuardianLink', targetId: link._id, details: { revokedBy: req.user.userId }, ip: req.ip });

    res.json({ success: true });
  } catch (err) {
    console.error('revokeGuardian error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { generateInvitation, acceptInvitation, listGuardians, updatePermissions, revokeGuardian };
