// routes/chat.js
// MongoDB replacement for parent <-> pediatrician appointment chat.
// NOTE: Chat uses the shared mongoose connection created when server.js starts.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const Appointment = require('../models/Appointment');
const ChatMessage = require('../models/ChatMessage');
const Notification = require('../models/Notification');
const Counter = require('../models/Counter');
const Child = require('../models/Child');
const User = require('../models/User');

// Resolve the Notification model even if the module is exported in a slightly
// different shape. This prevents the chat flow from crashing when notifications
// are still loading through the older project structure.
function resolveNotificationModel() {
  if (!Notification) return null;
  if (typeof Notification.create === 'function') return Notification;
  if (Notification.default && typeof Notification.default.create === 'function') return Notification.default;
  if (Notification.Notification && typeof Notification.Notification.create === 'function') return Notification.Notification;
  return null;
}

// Generates a numeric notification id when the model path is not available.
// This mirrors the safer fallback used in the appointment routes.
async function nextNotificationId() {
  try {
    const counters = mongoose.connection.collection('counters');
    const result = await counters.findOneAndUpdate(
      { _id: 'notifications' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    if (result?.value?.seq != null) return result.value.seq;

    const doc = await counters.findOne({ _id: 'notifications' });
    if (doc?.seq != null) return doc.seq;
  } catch (err) {
    console.warn('Chat notification counter fallback error:', err.message);
  }

  return Date.now();
}

// Important:
// Notification errors must never block the actual chat message from being saved.
// If notification creation fails, the message still gets delivered normally.
async function pushNotification(userId, title, message, type = 'chat') {
  const notificationModel = resolveNotificationModel();
  const payload = {
    userId: new mongoose.Types.ObjectId(String(userId)),
    title,
    message,
    type,
    isRead: false,
  };

  try {
    if (notificationModel) {
      await notificationModel.create(payload);
      return;
    }
  } catch (err) {
    console.warn('Chat notification model create failed, using collection fallback:', err.message);
  }

  try {
    const notifications = mongoose.connection.collection('notifications');
    await notifications.insertOne({
      ...payload,
      id: await nextNotificationId(),
      createdAt: new Date(),
    });
  } catch (err) {
    console.warn('Chat notification insert fallback failed:', err.message);
  }
}

async function resolveChatAccess(appointmentId, userId, userRole) {
  const appt = await Appointment.findOne({ id: Number(appointmentId) }).lean();
  if (!appt) return null;

  const [child, parent, pediatrician] = await Promise.all([
    Child.findById(appt.childId).lean(),
    User.findById(appt.parentId).lean(),
    appt.pediatricianId ? User.findById(appt.pediatricianId).lean() : null,
  ]);

  if (!['approved', 'completed'].includes(appt.status)) {
    return { denied: 'chat_locked', status: appt.status };
  }
  if (userRole === 'parent' && String(appt.parentId) !== String(userId)) return { denied: 'access' };
  if (userRole === 'pediatrician' && String(appt.pediatricianId) !== String(userId)) return { denied: 'access' };

  return {
    ...appt,
    child,
    parent,
    pediatrician,
    childFirst: child?.firstName || '',
    childLast: child?.lastName || '',
    childDob: child?.dateOfBirth || null,
    childGender: child?.gender || null,
    childPhoto: child?.profileIcon || null,
    parFirst: parent?.firstName || '',
    parLast: parent?.lastName || '',
    parEmail: parent?.email || '',
    parPhoto: parent?.profileIcon || null,
    pedFirst: pediatrician?.firstName || '',
    pedLast: pediatrician?.lastName || '',
    pedSpec: pediatrician?.specialization || null,
    pedPhoto: pediatrician?.profileIcon || null,
  };
}

// GET /api/chat/threads
router.get('/threads', authMiddleware, async (req, res) => {
  try {
    const role = req.user.role;
    let query = {};

    if (role === 'parent') query = { parentId: req.user.userId, status: { $in: ['approved', 'completed'] } };
    else if (role === 'pediatrician') query = { pediatricianId: req.user.userId, status: { $in: ['approved', 'completed'] } };
    else return res.status(403).json({ error: 'Parents and pediatricians only.' });

    const appointments = await Appointment.find(query).sort({ appointmentDate: -1, createdAt: -1 }).lean();
    const threads = [];

    for (const appt of appointments) {
      const [child, parent, pediatrician] = await Promise.all([
        Child.findById(appt.childId).lean(),
        User.findById(appt.parentId).lean(),
        appt.pediatricianId ? User.findById(appt.pediatricianId).lean() : null,
      ]);

      const unread = await ChatMessage.countDocuments({
        appointmentId: appt.id,
        senderRole: role === 'parent' ? 'pediatrician' : 'parent',
        isRead: false,
      });

      threads.push({
        appointmentId: appt.id,
        status: appt.status,
        appointmentDate: appt.appointmentDate,
        appointmentTime: appt.appointmentTime,
        childId: child ? String(child._id) : null,
        childName: child ? `${child.firstName} ${child.lastName}` : 'Unknown Child',
        parentId: parent ? String(parent._id) : null,
        parentName: parent ? `${parent.firstName} ${parent.lastName}` : 'Parent',
        parentPhoto: parent?.profileIcon || null,
        pediatricianId: pediatrician ? String(pediatrician._id) : null,
        pediatricianName: pediatrician ? `${pediatrician.firstName} ${pediatrician.lastName}` : 'Pediatrician',
        specialization: pediatrician?.specialization || null,
        pedPhoto: pediatrician?.profileIcon || null,
        unread,
      });
    }

    res.json({ success: true, threads });
  } catch (err) {
    console.error('chat threads error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/:appointmentId
router.get('/:appointmentId', authMiddleware, async (req, res) => {
  try {
    const appt = await resolveChatAccess(req.params.appointmentId, req.user.userId, req.user.role);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (appt.denied === 'access') return res.status(403).json({ error: 'Access denied.' });
    if (appt.denied === 'chat_locked') return res.status(403).json({ error: `Chat is not yet available. Appointment status: ${appt.status}` });

    const messages = await ChatMessage.find({ appointmentId: appt.id }).sort({ createdAt: 1 }).lean();

    // Mark incoming messages as read after loading.
    await ChatMessage.updateMany(
      { appointmentId: appt.id, senderRole: req.user.role === 'parent' ? 'pediatrician' : 'parent', isRead: false },
      { $set: { isRead: true } }
    );

    const populatedMessages = [];
    for (const m of messages) {
      const sender = await User.findById(m.senderId).lean();
      populatedMessages.push({
        id: String(m._id),
        senderId: String(m.senderId),
        senderRole: m.senderRole,
        senderName: sender ? `${sender.firstName} ${sender.lastName}` : 'User',
        senderPhoto: sender?.profileIcon || null,
        message: m.message,
        videoPath: m.videoPath,
        videoName: m.videoName,
        videoSize: m.videoSize,
        isRead: m.isRead,
        createdAt: m.createdAt,
      });
    }

    res.json({
      success: true,
      messages: populatedMessages,
      appointmentInfo: {
        appointmentId: appt.id,
        status: appt.status,
        reason: appt.reason,
        appointmentDate: appt.appointmentDate,
        childId: appt.child ? String(appt.child._id) : null,
        childFirst: appt.childFirst,
        childLast: appt.childLast,
        childDob: appt.childDob,
        childGender: appt.childGender,
        childPhoto: appt.childPhoto,
        parFirst: appt.parFirst,
        parLast: appt.parLast,
        parEmail: appt.parEmail,
        parPhoto: appt.parPhoto,
        pedFirst: appt.pedFirst,
        pedLast: appt.pedLast,
        pedSpec: appt.pedSpec,
        pedPhoto: appt.pedPhoto,
      },
    });
  } catch (err) {
    console.error('chat get thread error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:appointmentId
router.post('/:appointmentId', authMiddleware, async (req, res) => {
  try {
    const { message, videoPath, videoName, videoSize } = req.body;
    if (!message && !videoPath) {
      return res.status(400).json({ error: 'Message text or video required.' });
    }

    const appt = await resolveChatAccess(req.params.appointmentId, req.user.userId, req.user.role);
    if (!appt) return res.status(404).json({ error: 'Not found.' });
    if (appt.denied === 'access') return res.status(403).json({ error: 'Access denied.' });
    if (appt.denied === 'chat_locked') return res.status(403).json({ error: 'Chat is not yet available. Appointment must be approved first.' });

    const childId = appt.child?._id;
    if (!childId || !mongoose.Types.ObjectId.isValid(String(childId))) {
      return res.status(400).json({ error: 'Cannot send chat message because the appointment is missing a valid child record.' });
    }

    const created = await ChatMessage.create({
      appointmentId: appt.id,
      childId,
      parentId: appt.parent?._id || null,
      pediatricianId: appt.pediatrician?._id || null,
      senderId: req.user.userId,
      senderRole: req.user.role,
      message: message || null,
      videoPath: videoPath || null,
      videoName: videoName || null,
      videoSize: videoSize || null,
      isRead: false,
      createdAt: new Date(),
    });

    if (req.user.role === 'parent') {
      const senderName = `${appt.parFirst} ${appt.parLast}`.trim();
      await pushNotification(
        appt.pediatrician._id,
        videoPath ? `📹 New video from ${senderName}` : `💬 New message from ${senderName}`,
        videoPath ? `${senderName} sent a follow-up video for ${appt.childFirst} ${appt.childLast}.` : `${senderName}: ${(message || '').substring(0, 100)}`,
        'chat'
      );
    } else {
      const senderName = `Dr. ${appt.pedFirst} ${appt.pedLast}`.trim();
      await pushNotification(
        appt.parent._id,
        `💬 Message from ${senderName}`,
        `${senderName}: ${(message || '').substring(0, 100)}`,
        'chat'
      );
    }

    res.json({
      success: true,
      message: {
        id: String(created._id),
        senderId: String(created.senderId),
        senderRole: created.senderRole,
        message: created.message,
        videoPath: created.videoPath,
        videoName: created.videoName,
        videoSize: created.videoSize,
        isRead: created.isRead,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error('chat send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/:appointmentId/unread
router.get('/:appointmentId/unread', authMiddleware, async (req, res) => {
  try {
    const unread = await ChatMessage.countDocuments({
      appointmentId: Number(req.params.appointmentId),
      senderRole: req.user.role === 'parent' ? 'pediatrician' : 'parent',
      isRead: false,
    });
    res.json({ success: true, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
