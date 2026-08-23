const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const { verifyToken } = require('../middleware/authMiddleware'); // FIXED: Added curly braces for destructuring

// Authenticated user deposit request & status check
router.post('/stk-push', verifyToken, depositController.initiateSTKPush);
router.get('/status/:reference', verifyToken, depositController.checkDepositStatus);

// Public endpoint for your Android SMS Forwarder App (No user token required)
router.post('/webhook-sms', depositController.handleSMSWebhook);

module.exports = router;