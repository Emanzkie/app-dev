// Upload routes converted to MongoDB
// Purpose:
// - save the image file in /public/uploads/profiles
// - save the image path in MongoDB
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const User = require('../models/User');
const Child = require('../models/Child');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Multer storage config for profile pictures
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'uploads', 'profiles');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${req.uploadType || 'user'}_${Date.now()}${ext}`;
        cb(null, name);
    },
});

// Allow only common image types
const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, jpeg, png, gif, webp)'));
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
});

// Delete the old uploaded image so replaced profile photos do not pile up
function deleteOldUpload(uploadPath) {
    if (!uploadPath || !uploadPath.startsWith('/uploads/')) return;
    const cleanPath = uploadPath.replace(/^\//, '');
    const fullPath = path.join(__dirname, '..', cleanPath.replace(/^uploads\//, 'uploads/'));
    if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
    }
}

// Upload the logged-in user's own profile picture
router.post('/profile', authMiddleware, (req, res) => {
    req.uploadType = `${req.user.role || 'user'}_${req.user.userId}`;
    upload.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        try {
            const picPath = `/uploads/profiles/${req.file.filename}`;
            const user = await User.findById(req.user.userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found.' });
            }

            deleteOldUpload(user.profileIcon);
            user.profileIcon = picPath;
            await user.save();

            res.json({ success: true, path: picPath });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// Upload one child's profile picture
router.post('/child/:childId', authMiddleware, (req, res) => {
    req.uploadType = `child_${req.params.childId}`;
    upload.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        try {
            const picPath = `/uploads/profiles/${req.file.filename}`;
            const child = await Child.findOne({ _id: req.params.childId, parentId: req.user.userId });
            if (!child) {
                return res.status(404).json({ error: 'Child not found.' });
            }

            deleteOldUpload(child.profileIcon);
            child.profileIcon = picPath;
            await child.save();

            res.json({ success: true, path: picPath, childId: String(child._id) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// Upload pediatrician's ID document for verification
router.post('/pediatric-id', authMiddleware, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    try {
        const user = await User.findById(req.user.userId);
        if (!user || user.role !== 'pediatrician') {
            return res.status(403).json({ error: 'Only pediatricians can upload ID documents.' });
        }

        // Delete old ID if exists
        if (user.idDocumentPath) {
            deleteOldUpload(user.idDocumentPath);
        }

        const idPath = `/uploads/profiles/pediatric_id_${req.user.userId}_${Date.now()}${path.extname(req.file.originalname).toLowerCase()}`;
        const fullPath = path.join(__dirname, '..', 'public', 'uploads', 'profiles', path.basename(idPath));

        // Move/rename the file to include userId
        fs.renameSync(req.file.path, fullPath);

        // Normalize path to forward slashes for web compatibility
        const normalizedPath = idPath.replace(/\\/g, '/');

        user.idDocumentPath = normalizedPath;
        user.prcIdDocumentPath = normalizedPath;
        user.idDocumentUploadedAt = new Date();
        await user.save();

        res.json({ success: true, path: normalizedPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Upload pediatrician's PRC ID image for license verification
router.post('/prc-id', authMiddleware, upload.single('prcId'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const user = await User.findById(req.user.userId);
        if (!user || user.role !== 'pediatrician') {
            // Clean up the uploaded file since validation failed
            fs.unlinkSync(req.file.path);
            return res.status(403).json({ success: false, message: 'Only pediatricians can upload PRC documents.' });
        }

        // Ensure prc upload directory exists
        const prcDir = path.join(__dirname, '..', 'uploads', 'prc');
        if (!fs.existsSync(prcDir)) fs.mkdirSync(prcDir, { recursive: true });

        // Rename file with traceable name and move to prc directory
        const ext = path.extname(req.file.originalname).toLowerCase();
        const fileName = `prc_${req.user.userId}_${Date.now()}${ext}`;
        const destPath = path.join(prcDir, fileName);
        fs.renameSync(req.file.path, destPath);

        // Normalize path to forward slashes for web compatibility (critical on Windows)
        const filePath = `uploads/prc/${fileName}`.replace(/\\/g, '/');

        // Remove old PRC document file if replacing
        if (user.prcIdDocumentPath) {
            const oldPath = path.join(__dirname, '..', user.prcIdDocumentPath);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        // Update user record
        user.prcIdDocumentPath = filePath;
        await user.save();

        res.json({
            success: true,
            message: 'PRC ID uploaded successfully',
            path: filePath,
            url: `/${filePath}`,
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Server error during upload' });
    }
});

module.exports = router;
