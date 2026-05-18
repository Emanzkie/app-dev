// models/GuardianLink.js
const mongoose = require('mongoose');

const guardianLinkSchema = new mongoose.Schema(
  {
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'Child', required: true, index: true },
    guardianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isPrimary: { type: Boolean, default: false },
    role: { type: String, enum: ['parent', 'legal_guardian', 'foster_parent', 'court_appointed'], default: 'parent' },
    status: { type: String, enum: ['pending', 'active', 'revoked', 'suspended'], default: 'pending' },
    // Embedded permissions for fast checks; permissionSet may also be referenced.
    permissions: {
      viewAssessments: { type: Boolean, default: true },
      submitAssessments: { type: Boolean, default: true },
      viewResults: { type: Boolean, default: true },
      uploadDocuments: { type: Boolean, default: false },
      manageAppointments: { type: Boolean, default: true },
      viewMedicalRecords: { type: String, enum: ['none', 'partial', 'full'], default: 'partial' },
      modifyChild: { type: Boolean, default: false },
      inviteGuardians: { type: Boolean, default: false },
      revokeAccess: { type: Boolean, default: false },
    },
    permissionSet: { type: mongoose.Schema.Types.ObjectId, ref: 'PermissionSet', default: null },
    invitationId: { type: mongoose.Schema.Types.ObjectId, ref: 'GuardianInvitation', default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

guardianLinkSchema.index({ childId: 1, guardianId: 1 }, { unique: true, partialFilterExpression: { childId: { $exists: true }, guardianId: { $exists: true } } });

module.exports = mongoose.models.GuardianLink || mongoose.model('GuardianLink', guardianLinkSchema);
