const db = require('../config/db');

// ---------- Existing functions ----------
exports.getAllActiveInvestments = async (req, res) => {
  try {
    const [investments] = await db.execute(
      `SELECT 
        ui.id AS investment_id,
        u.id AS user_id,
        u.full_name,
        u.phone_number,
        p.title AS program_title,
        ui.shares_purchased,
        ui.total_invested,
        ui.expected_payout,
        p.roi_percentage,
        ui.created_at AS purchase_date,
        ui.end_date AS maturity_date,
        ui.status
       FROM user_investments ui
       JOIN users u ON ui.user_id = u.id
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.status = 'active'
       ORDER BY ui.end_date ASC`
    );
    return res.status(200).json({
      success: true,
      count: investments.length,
      data: investments
    });
  } catch (error) {
    console.error('Admin Active Investments Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving active investments.' });
  }
};

exports.forceMaturityPayout = async (req, res) => {
  let connection;
  const investmentId = req.params.id;
  const adminId = req.user.id;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [invRows] = await connection.execute(
      `SELECT ui.id, ui.user_id, ui.expected_payout, ui.status, p.title 
       FROM user_investments ui
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.id = ? FOR UPDATE`,
      [investmentId]
    );

    if (invRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Investment record not found.' });
    }

    const inv = invRows[0];

    if (inv.status !== 'active') {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        message: `Investment cannot be paid out because its status is already '${inv.status}'.` 
      });
    }

    const payoutAmount = parseFloat(inv.expected_payout);

    await connection.execute(
      `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
      [payoutAmount, inv.user_id]
    );

    await connection.execute(
      `UPDATE user_investments SET status = 'matured' WHERE id = ?`,
      [investmentId]
    );

    const ref = `ADM-PAYOUT-${investmentId}-${Date.now()}`;
    await connection.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status, external_ref) 
       VALUES (?, ?, 'ADMIN', 'MANUAL', ?, 'deposit', 'completed', ?)`,
      [inv.user_id, ref, payoutAmount, `Triggered by Admin #${adminId}`]
    );

    await connection.commit();

    console.log(`[Admin] Manual payout of UGX ${payoutAmount} executed for Investment #${investmentId} by Admin #${adminId}`);

    return res.status(200).json({
      success: true,
      message: `Manual payout of UGX ${payoutAmount.toLocaleString()} credited successfully to User #${inv.user_id}.`,
      payoutAmount: payoutAmount
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Admin Force Payout Error:', error);
    return res.status(500).json({ success: false, message: 'Error executing manual payout.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.adjustUserBalance = async (req, res) => {
  let connection;

  try {
    const adminId = req.user.id;
    const { target_user_id, adjustment_type, amount, reason } = req.body;

    if (!target_user_id || !adjustment_type || !amount || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: 'target_user_id, adjustment_type (credit/debit), amount, and reason are required.' 
      });
    }

    const adjustAmount = parseFloat(amount);
    if (isNaN(adjustAmount) || adjustAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0.' });
    }

    if (!['credit', 'debit'].includes(adjustment_type.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'adjustment_type must be either "credit" or "debit".' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [walletRows] = await connection.execute(
      `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
      [target_user_id]
    );

    if (walletRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Target member wallet not found.' });
    }

    const currentBalance = parseFloat(walletRows[0].balance);
    const isCredit = adjustment_type.toLowerCase() === 'credit';
    
    if (!isCredit && currentBalance < adjustAmount) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false, 
        message: `Cannot debit UGX ${adjustAmount.toLocaleString()}. User balance is only UGX ${currentBalance.toLocaleString()}` 
      });
    }

    const updatedBalance = isCredit ? (currentBalance + adjustAmount) : (currentBalance - adjustAmount);

    await connection.execute(
      `UPDATE wallets SET balance = ? WHERE user_id = ?`,
      [updatedBalance, target_user_id]
    );

    const txType = isCredit ? 'deposit' : 'withdrawal';
    const ref = `ADM-ADJ-${Date.now()}`;
    await connection.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status, external_ref) 
       VALUES (?, ?, 'ADMIN', 'MANUAL', ?, ?, 'completed', ?)`,
      [target_user_id, ref, adjustAmount, txType, `Admin #${adminId} note: ${reason}`]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully ${isCredit ? 'credited' : 'debited'} UGX ${adjustAmount.toLocaleString()} ${isCredit ? 'to' : 'from'} user #${target_user_id}.`,
      previousBalance: currentBalance,
      newBalance: updatedBalance
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Admin Balance Adjustment Error:', error);
    return res.status(500).json({ success: false, message: 'Error processing balance adjustment.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.postAnnouncement = async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ message: 'Title and message are required.' });
  }
  try {
    await db.execute(
      'INSERT INTO announcements (title, message) VALUES (?, ?)',
      [title, message]
    );
    res.status(201).json({ message: 'Announcement posted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to post announcement.' });
  }
};

// ✅ NEW: Delete announcement
exports.deleteAnnouncement = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.execute('DELETE FROM announcements WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }
    res.json({ success: true, message: 'Announcement deleted successfully.' });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete announcement.' });
  }
};

// ✅ NEW: Get all announcements (admin version)
exports.getAnnouncements = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM announcements ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch announcements.' });
  }
};

// ✅ NEW: Get platform stats
exports.getStats = async (req, res) => {
  try {
    const [userCount] = await db.execute('SELECT COUNT(*) AS total FROM users');
    const [programCount] = await db.execute('SELECT COUNT(*) AS total FROM investment_programs WHERE status = "active"');
    const [activeInvestments] = await db.execute('SELECT COUNT(*) AS total FROM user_investments WHERE status = "active"');
    const [walletSum] = await db.execute('SELECT SUM(balance) AS total_balance FROM wallets');
    const [bonusSum] = await db.execute('SELECT SUM(bonus_balance) AS total_bonus FROM wallets');

    const totalBalance = parseFloat(walletSum[0].total_balance) || 0;
    const totalBonus = parseFloat(bonusSum[0].total_bonus) || 0;

    res.json({
      success: true,
      data: {
        totalUsers: userCount[0].total,
        totalPrograms: programCount[0].total,
        totalActiveInvestments: activeInvestments[0].total,
        totalWalletBalance: totalBalance,
        totalBonusBalance: totalBonus,
        platformBalance: totalBalance + totalBonus
      }
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
};