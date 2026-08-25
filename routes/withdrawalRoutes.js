const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const { verifyToken } = require('../middleware/authMiddleware');

// Authenticated withdrawal endpoints
router.post('/request', verifyToken, withdrawalController.requestWithdrawal);
router.get('/history', verifyToken, withdrawalController.getTransactionHistory);
// ✅ NEW: Transfer bonus to main wallet
router.post('/transfer-bonus', verifyToken, withdrawalController.transferBonusToMain);

module.exports = router;