const express = require('express');
const router = express.Router();
const db = require('../config/db');
const adminController = require('../controllers/adminController');
const { verifyToken, verifyAdmin } = require('../middleware/authMiddleware');

// ---------- Routes that require only token (no admin) ----------
router.get('/announcements', verifyToken, adminController.getAnnouncements);

// ---------- All routes below require admin privileges ----------
router.use(verifyToken, verifyAdmin);

// Users
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

// Programs – ✅ UPDATED: includes program_type
router.post('/programs', async (req, res) => {
  const { title, share_price, roi_percentage, duration_days, image_url, description, program_type } = req.body;
  if (!title || share_price === undefined || roi_percentage === undefined || !duration_days) {
    return res.status(400).json({ message: 'Missing required program fields' });
  }

  const type = (program_type === 'flexi') ? 'flexi' : 'locked';

  try {
    const [result] = await db.execute(
      `INSERT INTO investment_programs 
       (title, share_price, roi_percentage, duration_days, image_url, description, program_type, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        title,
        parseFloat(share_price),
        parseFloat(roi_percentage),
        parseInt(duration_days),
        image_url || null,
        description || null,
        type
      ]
    );
    res.status(201).json({ success: true, message: 'Program created successfully', programId: result.insertId });
  } catch (error) {
    console.error('Admin Program Creation Error:', error);
    res.status(500).json({ message: error.message || 'Failed to create program' });
  }
});

router.delete('/programs/:id', async (req, res) => {
  const programId = req.params.id;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [investments] = await connection.execute(
      'SELECT COUNT(*) AS count FROM user_investments WHERE program_id = ? AND status = "active"',
      [programId]
    );

    if (investments[0].count > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Cannot delete program because ${investments[0].count} active investment(s) still exist. Mature them first or reassign.`
      });
    }

    await connection.execute(
      'DELETE FROM investment_programs WHERE id = ?',
      [programId]
    );

    await connection.commit();
    res.json({ success: true, message: 'Program deleted successfully.' });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Admin Program Deletion Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete program: ' + error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Investments
router.get('/investments/active', adminController.getAllActiveInvestments);
router.post('/investments/:id/payout', adminController.forceMaturityPayout);

// Balance adjustment
router.post('/users/adjust-balance', adminController.adjustUserBalance);

// Announcements (admin management)
router.post('/announcements', adminController.postAnnouncement);
router.get('/admin/announcements', adminController.getAnnouncements);
router.delete('/announcements/:id', adminController.deleteAnnouncement);

// Stats
router.get('/stats', adminController.getStats);

// ---------- Admin transaction management ----------
router.get('/transactions/pending', adminController.getPendingTransactions);
router.post('/transactions/deposit/:id/approve', adminController.approveDeposit);
router.post('/transactions/deposit/:id/reject', adminController.rejectDeposit);
router.post('/transactions/withdrawal/:id/approve', adminController.approveWithdrawal);
router.post('/transactions/withdrawal/:id/reject', adminController.rejectWithdrawal);

module.exports = router;