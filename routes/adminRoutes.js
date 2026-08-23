const express = require('express');
const router = express.Router();
const db = require('../config/db');
const adminController = require('../controllers/adminController');
const { verifyToken, verifyAdmin } = require('../middleware/authMiddleware');

router.use(verifyToken, verifyAdmin);

// Fetch registered members safely with dynamic column name checks
router.get('/users', async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, 
              COALESCE(full_name, full_names, 'Member') AS full_name, 
              COALESCE(phone_number, phone, 'N/A') AS phone_number, 
              COALESCE(role, 'member') AS role, 
              COALESCE(email, 'N/A') AS email, 
              created_at 
       FROM users 
       ORDER BY id DESC`
    );
    res.json(users);
  } catch (error) {
    console.error('Admin DB Error:', error);
    res.status(500).json({ message: 'Database error fetching users', error: error.message });
  }
});

// Update member role
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  const userId = req.params.id;

  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role specified' });
  }

  try {
    await db.execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    res.json({ success: true, message: 'User role updated successfully' });
  } catch (error) {
    console.error('Admin Role Update Error:', error);
    res.status(500).json({ message: 'Failed to update user role' });
  }
});

// Create investment program (populates status and is_active safely)
router.post('/programs', async (req, res) => {
  const { title, share_price, roi_percentage, duration_days, image_url, description } = req.body;

  if (!title || share_price === undefined || roi_percentage === undefined || !duration_days) {
    return res.status(400).json({ message: 'Missing required program fields' });
  }

  try {
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, share_price, roi_percentage, duration_days, image_url, description, status, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1)`,
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
    res.status(500).json({ message: error.message || 'Failed to create program' });
  }
});

// Delete investment program
router.delete('/programs/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM investment_programs WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Admin Program Deletion Error:', error);
    res.status(500).json({ message: 'Failed to delete program' });
  }
});

router.get('/investments/active', adminController.getAllActiveInvestments);
router.post('/investments/:id/payout', adminController.forceMaturityPayout);
router.post('/users/adjust-balance', adminController.adjustUserBalance);
router.post('/announcements', adminController.postAnnouncement);

module.exports = router;