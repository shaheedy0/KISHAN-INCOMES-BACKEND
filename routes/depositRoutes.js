const express = require('express');[cite: 9]
const router = express.Router();[cite: 9]
const depositController = require('../controllers/depositController');[cite: 9]
const verifyToken = require('../middleware/authMiddleware');[cite: 9]

// Authenticated user deposit request & status check
router.post('/stk-push', verifyToken, depositController.initiateSTKPush);[cite: 9]
router.get('/status/:reference', verifyToken, depositController.checkDepositStatus);[cite: 9]

// Public endpoint for your Android SMS Forwarder App (No user token required)
router.post('/webhook-sms', depositController.handleSMSWebhook);

module.exports = router;[cite: 9]