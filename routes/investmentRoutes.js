const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const { verifyToken } = require('../middleware/authMiddleware');

// Import your database connection so the new POST route can save to TiDB
// (Adjust the path to '../config/db' if your database file has a different name)
const db = require('../config/db'); 

// Public route so home dashboard can view offerings
router.get('/programs', investmentController.getActivePrograms);

// Authenticated user routes
router.get('/my-investments', verifyToken, investmentController.getMyInvestments);
router.post('/purchase', verifyToken, investmentController.purchaseShares);

// -------------------------------------------------------------
// NEW: POST Route to Create Investment Programs (Fixes Cannot POST)
// -------------------------------------------------------------
router.post('/programs', verifyToken, async (req, res) => {
  try {
    const { title, share_price, roi_percentage, duration_days, image_url, description } = req.body;

    // Validate required fields
    if (!title || !share_price || !roi_percentage || !duration_days) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    // Insert into database using the correct verified column names
    const query = `
      INSERT INTO investment_programs 
      (title, share_price, roi_percentage, duration_days, image_url, description) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await db.execute(query, [
      title, 
      share_price, 
      roi_percentage, 
      duration_days, 
      image_url || null, 
      description || null
    ]);

    res.status(201).json({ message: 'Investment program created successfully!' });
  } catch (err) {
    console.error('Error creating program:', err);
    res.status(500).json({ message: err.message || 'Failed to create program' });
  }
});

module.exports = router;