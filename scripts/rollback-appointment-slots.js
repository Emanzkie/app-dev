// Rollback script for appointments rounded by the 30-minute slot migration.
// It restores the original appointmentTime saved in slotMigration.originalAppointmentTime.
require('dotenv').config();

const { connectDB, mongoose } = require('../db');
const Appointment = require('../models/Appointment');

async function run() {
  await connectDB();

  const roundedAppointments = await Appointment.find({
    'slotMigration.action': 'rounded',
    'slotMigration.originalAppointmentTime': { $ne: null },
  }).select('_id slotMigration').lean();

  let restoredCount = 0;

  for (const appointment of roundedAppointments) {
    const originalAppointmentTime = appointment.slotMigration?.originalAppointmentTime;
    if (!originalAppointmentTime) continue;

    await Appointment.updateOne(
      { _id: appointment._id },
      {
        $set: {
          appointmentTime: originalAppointmentTime,
          legacySlotIssue: true,
          'slotMigration.note': 'Rounded appointment time was rolled back to the original legacy value.',
          'slotMigration.rolledBackAt': new Date(),
        },
      }
    );
    restoredCount += 1;
  }

  console.log(`Rollback finished. Restored ${restoredCount} rounded appointment time(s).`);
  await mongoose.connection.close();
}

if (require.main === module) {
  run().catch(async (err) => {
    console.error('Appointment slot rollback failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { run };
