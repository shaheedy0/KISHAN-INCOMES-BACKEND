const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const verifyToken = require('../middleware/authMiddleware'); // JWT verification middleware

// Authenticated withdrawal endpoints
router.post('/request', verifyToken, withdrawalController.requestWithdrawal);
router.get('/history', verifyToken, withdrawalController.getWithdrawalHistory);

module.exports = router;