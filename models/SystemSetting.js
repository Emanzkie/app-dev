// SystemSetting model
// Stores lightweight platform-wide switches that affect runtime behavior.
const mongoose = require('mongoose');

const appointmentSlotSettingsSchema = new mongoose.Schema(
  {
    // When true, new bookings and reschedules must use 30-minute aligned slots.
    enforceThirtyMinuteSlots: { type: Boolean, default: true },
    slotMinutes: { type: Number, default: 30 },
  },
  { _id: false }
);

const systemSettingSchema = new mongoose.Schema(
  {
    singleton: { type: String, unique: true, default: 'default' },
    appointmentSlots: { type: appointmentSlotSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, collection: 'system_settings' }
);

module.exports = mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema);
