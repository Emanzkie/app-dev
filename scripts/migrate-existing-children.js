// scripts/migrate-existing-children.js
// Non-destructive migration: creates PermissionSet defaults and GuardianLink
// entries for existing children that still reference `parentId`.
const { connectDB } = require('../db');
const Child = require('../models/Child');
const PermissionSet = require('../models/PermissionSet');
const GuardianLink = require('../models/GuardianLink');

async function run() {
  await connectDB();

  // Ensure some sensible permission sets exist
  const full = await PermissionSet.findOneAndUpdate(
    { name: 'Full' },
    { $setOnInsert: { description: 'Full access permission set', permissions: { viewAssessments: true, submitAssessments: true, viewResults: true, uploadDocuments: true, manageAppointments: true, viewMedicalRecords: 'full', modifyChild: true, inviteGuardians: true, revokeAccess: true } } },
    { upsert: true, new: true }
  );

  const standard = await PermissionSet.findOneAndUpdate(
    { name: 'Standard' },
    { $setOnInsert: { description: 'Standard guardian permissions', permissions: { viewAssessments: true, submitAssessments: true, viewResults: true, uploadDocuments: false, manageAppointments: true, viewMedicalRecords: 'partial', modifyChild: false, inviteGuardians: false, revokeAccess: false } } },
    { upsert: true, new: true }
  );

  const children = await Child.find({}).lean();
  console.log(`Found ${children.length} children; creating GuardianLink entries for existing parentIds...`);

  let created = 0;
  for (const c of children) {
    if (!c.parentId) continue;
    const exists = await GuardianLink.findOne({ childId: c._id, guardianId: c.parentId }).lean();
    if (exists) continue;

    try {
      const link = await GuardianLink.create({
        childId: c._id,
        guardianId: c.parentId,
        isPrimary: true,
        status: 'active',
        permissions: full.permissions || {},
        permissionSet: full._id,
        createdBy: c.parentId,
      });
      created += 1;
      // Optionally push to child.guardianLinks for convenience (non-destructive)
      await Child.updateOne({ _id: c._id }, { $addToSet: { guardianLinks: link._id } });
    } catch (e) {
      console.warn('Failed to create GuardianLink for child', c._id, e && e.message ? e.message : e);
    }
  }

  console.log(`Migration complete. Created ${created} GuardianLink records.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
