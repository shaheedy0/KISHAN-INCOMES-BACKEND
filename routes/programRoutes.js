const express = require('express');
const router = express.Router();
const { createProgram, updateProgram, getAllPrograms, getProgramById } = require('../controllers/programController');
const { verifyToken, verifyAdmin } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Public / Authenticated user routes
router.get('/', getAllPrograms);
router.get('/:id', getProgramById);

// Admin protected routes with single file upload field named 'image'
router.post('/', verifyToken, verifyAdmin, upload.single('image'), createProgram);
router.put('/:id', verifyToken, verifyAdmin, upload.single('image'), updateProgram);

module.exports = router;