const express = require('express');
const router = express.Router();
const db = require('../config/db');
const adminController = require('../controllers/adminController');
const { verifyToken, verifyAdmin } = require('../middleware/authMiddleware');

router.use(verifyToken, verifyAdmin);

// ----- Users -----
router.get('/users', async (req, res) => {
  try {
    const [users] = await db.execute(`
      SELECT u.*, w.balance, w.bonus_balance 
      FROM users u 
      LEFT JOIN wallets w ON u.id = w.user_id 
      ORDER BY u.id DESC
    `);
    res.json(users);
  } catch (error) {
    console.error('Admin DB Error:', error);
    res.status(500).json({ message: 'Database error fetching users', error: error.message });
  }
});

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

// ----- Programs -----
router.post('/programs', async (req, res) => {
  const { title, share_price, roi_percentage, duration_days, image_url, description } = req.body;

  if (!title || share_price === undefined || roi_percentage === undefined || !duration_days) {
    return res.status(400).json({ message: 'Missing required program fields' });
  }

  try {
    // ✅ Removed is_active – only status
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, share_price, roi_percentage, duration_days, image_url, description, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
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

router.delete('/programs/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM investment_programs WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Program deleted successfully' });
  } catch (error) {
    console.error('Admin Program Deletion Error:', error);
    res.status(500).json({ message: 'Failed to delete program' });
  }
});

// ----- Investments -----
router.get('/investments/active', adminController.getAllActiveInvestments);
router.post('/investments/:id/payout', adminController.forceMaturityPayout);

// ----- Balance adjustment -----
router.post('/users/adjust-balance', adminController.adjustUserBalance);

// ----- Announcements -----
router.post('/announcements', adminController.postAnnouncement);

// ----- Stats -----
router.get('/stats', adminController.getStats);

module.exports = router;