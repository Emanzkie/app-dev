// middleware/guardianAccess.js
const Child = require('../models/Child');
const GuardianLink = require('../models/GuardianLink');

async function resolveChildIdFromReq(req) {
  return req.params.childId || req.body.childId || req.query.childId || null;
}

async function hasPermission(userId, childId, permissionKey) {
  if (!userId || !childId) return false;

  const child = await Child.findById(childId).lean();
  if (!child) return false;

  // Parent owner has full control
  if (String(child.parentId) === String(userId)) return true;

  // Look up an active guardian link
  const link = await GuardianLink.findOne({ childId, guardianId: userId, status: 'active' }).lean();
  if (!link) return false;

  // If permissionKey is not provided, treat any active link as permission
  if (!permissionKey) return true;

  const perms = link.permissions || {};
  // viewMedicalRecords is stored as string; handle truthy defaults
  if (permissionKey === 'viewMedicalRecords') {
    return perms.viewMedicalRecords && perms.viewMedicalRecords !== 'none';
  }

  return Boolean(perms[permissionKey]);
}

// Express middleware factory
function checkPermission(permissionKey) {
  return async function (req, res, next) {
    const childId = await resolveChildIdFromReq(req);
    if (!childId) return res.status(400).json({ error: 'childId is required.' });

    if (await hasPermission(req.user.userId, childId, permissionKey)) return next();

    return res.status(403).json({ error: 'Access denied.' });
  };
}

module.exports = { hasPermission, checkPermission };
