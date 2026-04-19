// Migration script for the 30-minute appointment-slot rollout.
// Default behavior flags legacy times; pass --mode=round to round them to the nearest 30 minutes.
require('dotenv').config();

const { connectDB, mongoose } = require('../db');
const Appointment = require('../models/Appointment');

const SLOT_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

function parseTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return { valid: false, canonical: null, totalMinutes: null, seconds: null };

  const iso = new Date(raw);
  if ((raw.includes('T') || raw.includes('Z')) && !Number.isNaN(iso.getTime())) {
    const hours = iso.getUTCHours();
    const minutes = iso.getUTCMinutes();
    const seconds = iso.getUTCSeconds();
    return {
      valid: true,
      canonical: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      totalMinutes: hours * 60 + minutes,
      seconds,
    };
  }

  const simple = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!simple) return { valid: false, canonical: null, totalMinutes: null, seconds: null };

  const hours = parseInt(simple[1], 10);
  const minutes = parseInt(simple[2], 10);
  const seconds = parseInt(simple[3] || '0', 10);
  if (
    [hours, minutes, seconds].some((part) => Number.isNaN(part)) ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59 ||
    seconds < 0 || seconds > 59
  ) {
    return { valid: false, canonical: null, totalMinutes: null, seconds: null };
  }

  return {
    valid: true,
    canonical: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    totalMinutes: hours * 60 + minutes,
    seconds,
  };
}

function minutesToTime(totalMinutes) {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, DAY_MINUTES - SLOT_MINUTES));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundToNearestSlot(totalMinutes) {
  return Math.round(totalMinutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function getMode() {
  const arg = process.argv.find((entry) => entry.startsWith('--mode='));
  const mode = String(arg || '').split('=')[1] || 'flag';
  return mode === 'round' ? 'round' : 'flag';
}

async function run() {
  const mode = getMode();
  await connectDB();

  const appointments = await Appointment.find().select('_id id appointmentDate appointmentTime legacySlotIssue slotMigration').lean();
  const now = new Date();
  let flaggedCount = 0;
  let roundedCount = 0;
  let skippedCount = 0;

  for (const appointment of appointments) {
    const parsed = parseTime(appointment.appointmentTime);
    const hasSlotIssue = !parsed.valid || parsed.seconds !== 0 || (parsed.totalMinutes % SLOT_MINUTES !== 0);
    if (!hasSlotIssue) {
      skippedCount += 1;
      continue;
    }

    const update = {
      legacySlotIssue: true,
      slotMigration: {
        originalAppointmentTime: String(appointment.appointmentTime || ''),
        action: 'flagged',
        note: 'Legacy appointment time kept unchanged because it does not align to a 30-minute slot.',
        migratedAt: now,
        rolledBackAt: null,
      },
    };

    if (mode === 'round' && parsed.valid) {
      update.appointmentTime = minutesToTime(roundToNearestSlot(parsed.totalMinutes));
      update.slotMigration.action = 'rounded';
      update.slotMigration.note = 'Legacy appointment time was rounded to the nearest 30-minute slot.';
      roundedCount += 1;
    } else {
      flaggedCount += 1;
    }

    await Appointment.updateOne({ _id: appointment._id }, { $set: update });
  }

  console.log(`Appointment slot migration finished in "${mode}" mode.`);
  console.log(`Flagged: ${flaggedCount}`);
  console.log(`Rounded: ${roundedCount}`);
  console.log(`Already aligned / skipped: ${skippedCount}`);

  await mongoose.connection.close();
}

if (require.main === module) {
  run().catch(async (err) => {
    console.error('Appointment slot migration failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  });
}

module.exports = { run };
