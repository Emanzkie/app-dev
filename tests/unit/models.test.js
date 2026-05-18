// Basic unit tests for new models (no DB required)
const assert = require('assert');
const PermissionSet = require('../../models/PermissionSet');
const GuardianLink = require('../../models/GuardianLink');

function run() {
  const ps = new PermissionSet({ name: 'temp' });
  assert(ps.name === 'temp');
  assert(ps.permissions.viewAssessments === true);

  const gl = new GuardianLink({ childId: null, guardianId: null });
  // default permission values
  assert(gl.permissions.viewAssessments === true);
  assert(gl.permissions.manageAppointments === true);

  console.log('✓ Basic model defaults OK');
}

run();
