require('dotenv').config();
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../db');
const User = require('../models/User');
const Child = require('../models/Child');
const Appointment = require('../models/Appointment');
const PermissionSet = require('../models/PermissionSet');

async function upsertUser({email, username, role, firstName, lastName, password}){
  let user = await User.findOne({ email }).lean();
  if (user) return user;
  const passwordHash = await bcrypt.hash(password, 10);
  const created = await User.create({ firstName, lastName, username, email, passwordHash, role, status: 'active', emailVerified: true });
  return created.toObject();
}

async function run(){
  await connectDB();

  // Ensure permission set exists with messaging and notifications
  let standard = await PermissionSet.findOne({ name: 'Standard' });
  if (!standard) {
    standard = await PermissionSet.create({
      name: 'Standard',
      description: 'Default standard guardian permissions',
      permissions: {
        viewAssessments: true,
        submitAssessments: true,
        viewResults: true,
        uploadDocuments: false,
        manageAppointments: true,
        viewMedicalRecords: 'partial',
        modifyChild: false,
        inviteGuardians: false,
        revokeAccess: false,
        viewMessages: true,
        sendMessages: true,
        manageMessages: false,
        viewNotifications: true,
        sendNotifications: false,
        manageNotifications: false,
      }
    });
    console.log('Created Standard PermissionSet');
  } else {
    console.log('Standard PermissionSet exists');
  }

  const parent = await upsertUser({ email: 'parent@example.com', username: 'parent1', role: 'parent', firstName: 'Parent', lastName: 'Test', password: 'Parent@123' });
  const ped = await upsertUser({ email: 'ped@example.com', username: 'ped1', role: 'pediatrician', firstName: 'DrPet', lastName: 'Smith', password: 'Ped@12345' });
  const guardian = await upsertUser({ email: 'guardian@example.com', username: 'guardian1', role: 'legal_guardian', firstName: 'Guardian', lastName: 'Joe', password: 'Guardian@123' });

  console.log('Users ready:', { parent: parent.email, pediatrician: ped.email, guardian: guardian.email });

  // Create child if not exists
  let child = await Child.findOne({ parentId: parent._id }).lean();
  if (!child) {
    const created = await Child.create({ firstName: 'Test', lastName: 'Child', parentId: parent._id, dateOfBirth: new Date(2018,0,1) });
    child = created.toObject();
    console.log('Created child:', child._id.toString());
  } else {
    console.log('Child exists:', child._id.toString());
  }

  // Create appointment
  let appt = await Appointment.findOne({ childId: child._id, parentId: parent._id }).lean();
  if (!appt) {
    const created = await Appointment.create({ childId: child._id, parentId: parent._id, pediatricianId: ped._id, appointmentDate: new Date(), appointmentTime: '09:00', status: 'approved' });
    appt = created.toObject();
    console.log('Created appointment id:', appt.id);
  } else {
    console.log('Appointment exists id:', appt.id);
  }

  const out = {
    parent: { email: parent.email, password: 'Parent@123', id: String(parent._id) },
    pediatrician: { email: ped.email, password: 'Ped@12345', id: String(ped._id) },
    guardian: { email: guardian.email, password: 'Guardian@123', id: String(guardian._id) },
    child: { id: String(child._id) },
    appointment: { id: appt.id },
  };

  const outPath = path.join(__dirname, 'smoke-seed-output.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote seed output to', outPath);
  process.exit(0);
}

run().catch((err)=>{
  console.error('Seed failed:', err);
  process.exit(1);
});
