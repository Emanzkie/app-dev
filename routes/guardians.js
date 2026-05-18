// routes/guardians.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const guardianController = require('../controllers/guardianController');

router.post('/generate-invitation', authMiddleware, guardianController.generateInvitation);
router.post('/accept-invitation', authMiddleware, guardianController.acceptInvitation);
router.get('/verify/:code', guardianController.verifyInvitation);

router.get('/children/:childId/guardians', authMiddleware, guardianController.listGuardians);
router.put('/children/:childId/guardians/:guardianId/permissions', authMiddleware, guardianController.updatePermissions);
router.delete('/children/:childId/guardians/:guardianId', authMiddleware, guardianController.revokeGuardian);

/**
 * @openapi
 * /api/v2/guardians/children/{childId}/transfer-primary:
 *   post:
 *     tags:
 *       - Guardians
 *     summary: Transfer primary-guardian status for a child
 *     description: |
 *       Transfers primary-guardian status for a child from the calling user to a
 *       nominated target user who already holds an active GuardianLink for that child.
 *
 *       **Operation performed atomically:**
 *       1. The caller's current primary GuardianLink is archived (`isPrimary → false`, status → `archived`).
 *       2. The target user's GuardianLink is promoted to primary (`isPrimary → true`).
 *       3. `Child.parentId` is updated to the target user's id.
 *       4. An Audit Log entry (`guardian:primary:transfer`) is written.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: childId
 *         required: true
 *         schema:
 *           type: string
 *           format: mongoid
 *         description: MongoDB ObjectId of the child record
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetGuardianId
 *             properties:
 *               targetGuardianId:
 *                 type: string
 *                 format: mongoid
 *                 description: MongoDB ObjectId of the nominated new primary guardian (must already have an active GuardianLink for this child)
 *     responses:
 *       200:
 *         description: Primary guardianship successfully transferred
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 childId:
 *                   type: string
 *                   format: mongoid
 *                 newPrimaryGuardianId:
 *                   type: string
 *                   format: mongoid
 *                 archivedLinkId:
 *                   type: string
 *                   format: mongoid
 *                   nullable: true
 *       400:
 *         description: Missing or invalid parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Caller is not the current primary guardian
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Child not found, or target user is not an active linked guardian for this child
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Target user is already the primary guardian
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/children/:childId/transfer-primary', authMiddleware, guardianController.transferPrimary);

module.exports = router;
