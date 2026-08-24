const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const { verifyToken } = require('../middleware/authMiddleware');

// Authenticated withdrawal endpoints
router.post('/request', verifyToken, withdrawalController.requestWithdrawal);
router.get('/history', verifyToken, withdrawalController.getTransactionHistory); // ✅ FIXED: now shows all transactions

module.exports = router;