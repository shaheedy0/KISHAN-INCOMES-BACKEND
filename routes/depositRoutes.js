const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const webhookController = require('../controllers/webhookController');
const verifyToken = require('../middleware/authMiddleware'); // Your JWT middleware

router.post('/stk-push', verifyToken, depositController.initiateSTKPush);
router.get('/status/:reference', verifyToken, depositController.checkDepositStatus);

// Telecom Aggregator Webhook callback (Public endpoint secured by IP/Secret Key)
router.post('/webhook', webhookController.handleTelecomWebhook);

module.exports = router;