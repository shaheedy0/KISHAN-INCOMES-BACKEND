const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const { verifyToken } = require('../middleware/authMiddleware');
const db = require('../config/db'); 

// GET: View all investment programs directly from database
router.get('/programs', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM investment_programs ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching programs:', err);
    res.status(500).json({ message: 'Failed to fetch programs', error: err.message });
  }
});

// Authenticated user routes
router.get('/my-investments', verifyToken, investmentController.getMyInvestments);
router.post('/purchase', verifyToken, investmentController.purchaseShares);

// POST: Create Investment Program with 'active' status
router.post('/programs', verifyToken, async (req, res) => {
  try {
    const { title, share_price, roi_percentage, duration_days, image_url, description } = req.body;

    if (!title || !share_price || !roi_percentage || !duration_days) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    const query = `
      INSERT INTO investment_programs 
      (title, share_price, roi_percentage, duration_days, image_url, description, status) 
      VALUES (?, ?, ?, ?, ?, ?, 'active')
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

// DELETE: Remove Investment Program
router.delete('/programs/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute('DELETE FROM investment_programs WHERE id = ?', [id]);
    res.json({ message: 'Program deleted successfully' });
  } catch (err) {
    console.error('Error deleting program:', err);
    res.status(500).json({ message: err.message || 'Failed to delete program' });
  }
});

module.exports = router;