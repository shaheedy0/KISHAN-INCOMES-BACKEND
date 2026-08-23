const db = require('../config/db');

exports.getActivePrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      `SELECT id, title, description, 
              COALESCE(share_price) AS share_price, 
              roi_percentage, duration_days, image_url 
       FROM investment_programs 
       WHERE status = 'active' OR is_active = 1 OR is_active = TRUE 
       ORDER BY id DESC`
    );
    return res.status(200).json(programs);
  } catch (error) {
    console.error('Fetch Programs Error:', error);
    return res.status(500).json({ message: 'Error retrieving investment programs.' });
  }
};

exports.purchaseShares = async (req, res) => {
  let connection;

  try {
    const userId = req.user.id;
    const { program_id, shares_count } = req.body;

    if (!program_id || !shares_count) {
      return res.status(400).json({ message: 'Program selection and share quantity are required.' });
    }

    const sharesToBuy = parseInt(shares_count, 10);
    if (isNaN(sharesToBuy) || sharesToBuy < 1) {
      return res.status(400).json({ message: 'Minimum purchase is 1 share.' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [programRows] = await connection.execute(
      `SELECT id, title, COALESCE(share_price) AS share_price, 
              roi_percentage, duration_days, status, is_active 
       FROM investment_programs WHERE id = ? FOR UPDATE`,
      [program_id]
    );

    if (programRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Investment program unavailable.' });
    }

    const program = programRows[0];
    const totalCost = parseFloat(program.share_price) * sharesToBuy;
    const roiMultiplier = 1 + (parseFloat(program.roi_percentage) / 100);
    const expectedPayout = totalCost * roiMultiplier;

    // ✅ Lock wallet row instead of users table
    const [walletRows] = await connection.execute(
      `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
      [userId]
    );

    if (walletRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Wallet not found for this user.' });
    }

    const currentBalance = parseFloat(walletRows[0].balance || 0);

    if (currentBalance < totalCost) {
      await connection.rollback();
      return res.status(400).json({ 
        message: `Insufficient wallet balance. Required: UGX ${totalCost.toLocaleString()}, Available: UGX ${currentBalance.toLocaleString()}` 
      });
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(program.duration_days, 10));

    // ✅ Deduct from wallets
    await connection.execute(
      `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
      [totalCost, userId]
    );

    await connection.execute(
      `INSERT INTO user_investments (user_id, program_id, shares_purchased, total_invested, expected_payout, end_date, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [userId, program.id, sharesToBuy, totalCost, expectedPayout, endDate]
    );

    const ref = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await connection.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, 'WALLET', 'INTERNAL', ?, 'investment', 'completed')`,
      [userId, ref, totalCost]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully purchased ${sharesToBuy} share(s) in "${program.title}".`,
      remainingBalance: currentBalance - totalCost,
      maturityDate: endDate.toLocaleDateString()
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Purchase Investment Error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Error processing share purchase.' });
  } finally {
    if (connection) connection.release();
  }
};

exports.getMyInvestments = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute(
      `SELECT ui.id, p.title, ui.shares_purchased, ui.total_invested, 
              p.roi_percentage, ui.expected_payout, ui.end_date, ui.status
       FROM user_investments ui
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.user_id = ?
       ORDER BY ui.created_at DESC`,
      [userId]
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Fetch My Investments Error:', error);
    return res.status(500).json({ message: 'Error retrieving investments.' });
  }
};