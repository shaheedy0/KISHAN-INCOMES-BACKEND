const express = require('express');
const router = express.Router();
const db = require('../config/db');
const adminController = require('../controllers/adminController');
const { verifyToken, verifyAdmin } = require('../middleware/authMiddleware');

// Protect all admin routes with JWT and Admin checks
router.use(verifyToken, verifyAdmin);

// 1. Fetch all registered users
router.get('/users', async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, full_name, phone_number, role, email, created_at FROM users ORDER BY id DESC'
    );
    res.json({ success: true, users });
  } catch (error) {
    console.error('Admin DB Error:', error);
    res.status(500).json({ success: false, message: 'Database error fetching users' });
  }
});

// 2. Toggle user roles (Admin <-> Member)
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  const userId = req.params.id;

  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role specified' });
  }

  try {
    await db.execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    res.json({ success: true, message: 'User role updated successfully' });
  } catch (error) {
    console.error('Admin Role Update Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user role' });
  }
});

// 3. Create a new investment program (With robust type handling)
router.post('/programs', async (req, res) => {
  const { title, share_price, roi_percentage, duration_days, image_url, description } = req.body;

  if (!title || share_price === undefined || roi_percentage === undefined || !duration_days) {
    return res.status(400).json({ success: false, message: 'Missing required program fields' });
  }

  try {
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, share_price, roi_percentage, duration_days, image_url, description) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title, 
        parseFloat(share_price), 
        parseFloat(roi_percentage), 
        parseInt(duration_days), 
        image_url || null, 
        description || null
      ]
    );

    res.status(201).json({ success: true, message: 'Program created successfully', programId: result.insertId });
  } catch (error) {
    console.error('Admin Program Creation Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create program' });
  }
});

// 4. Delete an investment program
router.delete('/programs/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM investment_programs WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Admin Program Deletion Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete program' });
  }
});

// Existing Admin Controller Routes
router.get('/investments/active', adminController.getAllActiveInvestments);
router.post('/investments/:id/payout', adminController.forceMaturityPayout);
router.post('/users/adjust-balance', adminController.adjustUserBalance);
router.post('/announcements', adminController.postAnnouncement);

module.exports = router;