// routes/guardians.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const guardianController = require('../controllers/guardianController');

router.post('/generate-invitation', authMiddleware, guardianController.generateInvitation);
router.post('/accept-invitation', authMiddleware, guardianController.acceptInvitation);

router.get('/children/:childId/guardians', authMiddleware, guardianController.listGuardians);
router.put('/children/:childId/guardians/:guardianId/permissions', authMiddleware, guardianController.updatePermissions);
router.delete('/children/:childId/guardians/:guardianId', authMiddleware, guardianController.revokeGuardian);

module.exports = router;
