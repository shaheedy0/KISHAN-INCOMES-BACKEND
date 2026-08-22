const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const verifyToken = require('../middleware/authMiddleware');

router.get('/programs', verifyToken, investmentController.getActivePrograms);
router.get('/my-investments', verifyToken, investmentController.getMyInvestments);
router.post('/purchase', verifyToken, investmentController.purchaseShares);

module.exports = router;