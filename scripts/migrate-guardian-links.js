// scripts/migrate-guardian-links.js
// Non-destructive migration: creates GuardianLink records with full permissions
// for every existing Child document that has a non-null parentId, as long as
// that combination does not already exist.
//
// Usage:
//   node scripts/migrate-guardian-links.js --dry-run
//   node scripts/migrate-guardian-links.js
//   MONGODB_URI=... node scripts/migrate-guardian-links.js
require('dotenv').config();

const { connectDB } = require('../db');
const Child = require('../models/Child');
const GuardianLink = require('../models/GuardianLink');

function isDryRun() {
  return process.argv.includes('--dry-run');
}

async function run() {
  const dryRun = isDryRun();
  await connectDB();

  const children = await Child.find({ parentId: { $ne: null } }).lean();
  console.log(`Found ${children.length} children with a parentId.`);

  let wouldCreate = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of children) {
    // Skip if a link already exists for this exact childI parentId pair
    const existing = await GuardianLink.findOne({ childId: c._id, guardianId: c.parentId }).lean();
    if (existing) {
      skipped += 1;
      continue;
    }

    wouldCreate += 1;

    if (!dryRun) {
      try {
        const link = await GuardianLink.create({
          childId: c._id,
          guardianId: c.parentId,
          isPrimary: true,
          role: 'parent',
          status: 'active',
          permissions: {
            viewAssessments: true,
            submitAssessments: true,
            viewResults: true,
            uploadDocuments: true,
            manageAppointments: true,
            viewMedicalRecords: 'full',
            modifyChild: true,
            inviteGuardians: true,
            revokeAccess: true,
            viewMessages: true,
            sendMessages: true,
            manageMessages: false,
            viewNotifications: true,
            sendNotifications: true,
            manageNotifications: false,
          },
          permissionSet: null,
          invitationId: null,
          startDate: new Date(),
          endDate: null,
          createdBy: c.parentId,
        });

        // Add the new link to child.guardianLinks (additive, idempotent with $addToSet)
        await Child.updateOne({ _id: c._id }, { $addToSet: { guardianLinks: link._id } });
        console.log(`  ✓ Created GuardianLink for child ${c._id} → guardian ${c.parentId}`);
      } catch (e) {
        failed += 1;
        const msg = e && e.message ? e.message : String(e);
        console.warn(`  ⚠ Failed to create GuardianLink for child ${c._id}: ${msg}`);
      }
    } else {
      console.log(`  [DRY-RUN] Would create GuardianLink for child ${c._id} → guardian ${c.parentId}`);
    }
  }

  const action = dryRun ? 'previewed' : 'completed';
  console.log(`\nMigration ${action}.`);
  console.log(`  Would create: ${wouldCreate}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  if (!dryRun) console.log(`  Failed: ${failed}`);
  await mongoose.connection.close();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Guardian-link migration failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { run, isDryRun };
