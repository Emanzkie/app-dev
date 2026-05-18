// controllers/guardianController.js
const crypto = require('crypto');
const mongoose = require('mongoose');
const Child = require('../models/Child');
const GuardianInvitation = require('../models/GuardianInvitation');
const GuardianLink = require('../models/GuardianLink');
const PermissionSet = require('../models/PermissionSet');
const User = require('../models/User');
const { createLog } = require('./auditController');
const emailService = require('../services/emailService');

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Verify that the caller is the currently active primary guardian for the child.
// Throws with an HTTP-like status/message object on failure.
async function verifyPrimaryGuardian({ childId, callerId }) {
  const child = await Child.findById(childId).lean();
  if (!child) throw { status: 404, error: 'Child not found.' };

  const callerIsOwner = String(child.parentId) === String(callerId);
  if (callerIsOwner) return child;

  const primaryLink = await GuardianLink.findOne({ childId, guardianId: callerId, isPrimary: true, status: 'active' }).lean();
  if (primaryLink) return child;

  throw { status: 403, error: 'Only the current primary guardian may perform this action.' };
}

async function generateInvitation(req, res) {
  try {
    const { childId, expiresHours = 48, note = null } = req.body;
    const inviteEmail = req.body.inviteEmail || null;
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

    // If an invite email was provided, attempt to send the invitation link/code
    if (inviteEmail) {
      try {
        await emailService.sendInvitationEmail({ to: inviteEmail, code: rawCode, child, inviter: req.user, expiresAt });
        await GuardianInvitation.findByIdAndUpdate(inv._id, { sentTo: inviteEmail, emailSent: true });
      } catch (e) {
        console.warn('Failed to send invitation email:', e.message);
      }
    }
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

async function verifyInvitation(req, res) {
  try {
    const { code } = req.params;
    if (!code) return res.status(400).json({ error: 'Code is required.' });
    const codeHash = hashCode(code);
    const invitation = await GuardianInvitation.findOne({ codeHash }).populate('childId', 'firstName lastName parentId').lean();
    if (!invitation) return res.status(404).json({ error: 'Invitation not found or invalid.' });
    if (invitation.used) return res.json({ success: true, valid: true, used: true, usedBy: invitation.usedBy });
    if (invitation.expiresAt && new Date() > new Date(invitation.expiresAt)) {
      return res.json({ success: false, valid: false, expired: true });
    }

    res.json({ success: true, valid: true, used: false, invitation: { id: invitation._id, child: invitation.childId, createdBy: invitation.createdBy, expiresAt: invitation.expiresAt, note: invitation.note } });
  } catch (err) {
    console.error('verifyInvitation error:', err);
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

/**
 * POST /api/v2/guardians/:childId/transfer-primary
 *
 * Transfers primary-guardian status for a child from the current caller to a
 * nominated target user who already holds an active GuardianLink for that child.
 *
 * Actions taken atomically:
 *  1. Demote the caller's current primary GuardianLink (isPrimary → false, status promoted to onChangeArchived).
 *  2. Promote the target user's GuardianLink to primary (isPrimary → true).
 *  3. Update Child.parentId to the target user.
 *  4. Audit-log the transfer.
 *
 * @param {string} req.body.targetGuardianId  – Mongoose ObjectId string of the nominated guardian
 * @param {string} [req.params.childId]       – child whose primary guard is being transferred
 * @returns {200} { success: true, childId, newPrimaryGuardianId, archivedLinkId }
 * @throws {400}  childId or targetGuardianId missing
 * @throws {404}  child not found / target guardian not linked
 * @throws {409}  target is already the primary guardian
 * @throws {403}  caller is not the current primary guardian
 * @throws {500}  unexpected server error
 */
async function transferPrimary(req, res) {
  try {
    const { childId } = req.params;
    const { targetGuardianId } = req.body;

    if (!childId)   return res.status(400).json({ error: 'childId is required.' });
    if (!targetGuardianId) return res.status(400).json({ error: 'targetGuardianId is required.' });

    const targetId = new mongoose.Types.ObjectId(String(targetGuardianId));
    const child = await verifyPrimaryGuardian({ childId: new mongoose.Types.ObjectId(childId), callerId: req.user.userId });

    // 1. The target must already hold an active GuardianLink.
    const targetLink = await GuardianLink.findOne({ childId: child._id, guardianId: targetId, status: 'active' }).lean();
    if (!targetLink) {
      return res.status(404).json({ error: 'Target user is not an active linked guardian for this child. They must accept an invitation first.' });
    }

    // 2. Guard against a no-op.
    if (targetLink.isPrimary) {
      return res.status(409).json({ error: 'The target user is already the primary guardian.' });
    }

    const callerIsOwner = String(child.parentId) === String(req.user.userId);
    const callerGuardianId = callerIsOwner ? null : new mongoose.Types.ObjectId(String(req.user.userId));

    // 3. Archive / demote the current primary link.
    let archivedLinkId = null;
    try {
      const demoteFilter = callerIsOwner
        ? { childId: child._id, isPrimary: true }
        : { childId: child._id, guardianId: callerGuardianId, isPrimary: true };

      const demoteResult = await GuardianLink.updateOne(demoteFilter, {
        $set: {
          isPrimary: false,
          status: 'archived',
          'transferLog.previousPrimaryGuardianId': callerIsOwner ? child.parentId : callerGuardianId,
          'transferLog.transferredAt': new Date(),
          'transferLog.reason': 'Primary guardianship transferred to another guardian.',
        },
      });

      if (demoteResult.matchedCount === 0) {
        return res.status(409).json({ error: 'No active primary guardian link found to demote.' });
      }

      const archived = await GuardianLink.findOne(demoteFilter);
      archivedLinkId = archived ? String(archived._id) : null;
    } catch (demoteErr) {
      console.error('transferPrimary demote error:', demoteErr.message);
      return res.status(500).json({ error: 'Failed to demote the current primary guardian link.' });
    }

    // 4. Promote the target to primary.
    const promoted = await GuardianLink.findOneAndUpdate(
      { childId: child._id, guardianId: targetId },
      {
        $set: {
          isPrimary: true,
          status: 'active',
          'transferLog.promotedAt': new Date(),
          'transferLog.previousPrimaryGuardianId': callerIsOwner ? child.parentId : callerGuardianId,
        },
      },
      { new: true }
    );

    // 5. Update Child.parentId to the new primary.
    await Child.findByIdAndUpdate(child._id, { parentId: targetId });

    // 6. Audit log.
    await createLog({
      actorId: req.user.userId,
      action: 'guardian:primary:transfer',
      targetType: 'Child',
      targetId: child._id,
      details: {
        childId: String(child._id),
        oldPrimaryGuardianId: callerIsOwner ? String(child.parentId) : null,
        oldPrimaryGuardianLinkId: archivedLinkId,
        newPrimaryGuardianId: String(targetId),
        newPrimaryGuardianLinkId: promoted ? String(promoted._id) : null,
      },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      childId: String(child._id),
      newPrimaryGuardianId: String(targetId),
      archivedLinkId,
    });
  } catch (err) {
    console.error('transferPrimary error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.error || err.message || 'Internal server error.' });
  }
}

module.exports = { generateInvitation, acceptInvitation, verifyInvitation, listGuardians, updatePermissions, revokeGuardian, transferPrimary };
