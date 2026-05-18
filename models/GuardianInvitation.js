// models/GuardianInvitation.js
const mongoose = require('mongoose');

const guardianInvitationSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, index: true }, // store hash of the code
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, default: null },
    singleUse: { type: Boolean, default: true },
    used: { type: Boolean, default: false },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    usedAt: { type: Date, default: null },
    note: { type: String, trim: true, default: null },
    // Optional email meta when invitations are emailed directly
    sentTo: { type: String, trim: true, default: null },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GuardianInvitation || mongoose.model('GuardianInvitation', guardianInvitationSchema);
