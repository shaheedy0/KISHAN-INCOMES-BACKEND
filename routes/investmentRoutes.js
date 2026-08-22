const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const { verifyToken } = require('../middleware/authMiddleware');

// Public route so home dashboard can view offerings
router.get('/programs', investmentController.getActivePrograms);

// Authenticated user routes
router.get('/my-investments', verifyToken, investmentController.getMyInvestments);
router.post('/purchase', verifyToken, investmentController.purchaseShares);

module.exports = router;