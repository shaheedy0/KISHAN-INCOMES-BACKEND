const db = require('../config/db');

/**
 * Fetch list of active investment programs
 * Route: GET /api/investments/programs
 */
exports.getActivePrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      `SELECT id, title, description, share_price, roi_percentage, duration_days 
       FROM investment_programs 
       WHERE status = 'active' 
       ORDER BY share_price ASC`
    );
    return res.status(200).json(programs);
  } catch (error) {
    console.error('Fetch Programs Error:', error);
    return res.status(500).json({ message: 'Error retrieving investment programs.' });
  }
};

/**
 * Purchase Investment Shares using Wallet Balance
 * Route: POST /api/investments/purchase
 */
exports.purchaseShares = async (req, res) => {
  let connection;

  try {
    const userId = req.user.id; // From JWT middleware
    const { program_id, shares_count } = req.body;

    // 1. Validations
    if (!program_id || !shares_count) {
      return res.status(400).json({ message: 'Program selection and share quantity are required.' });
    }

    const sharesToBuy = parseInt(shares_count, 10);
    if (isNaN(sharesToBuy) || sharesToBuy < 1) {
      return res.status(400).json({ message: 'Minimum purchase is 1 share.' });
    }

    // 2. Start Atomic Transaction
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Fetch investment program details
    const [programRows] = await connection.execute(
      `SELECT id, title, share_price, roi_percentage, duration_days, status 
       FROM investment_programs WHERE id = ? FOR UPDATE`,
      [program_id]
    );

    if (programRows.length === 0 || programRows[0].status !== 'active') {
      await connection.rollback();
      return res.status(404).json({ message: 'Investment program is either unavailable or closed.' });
    }

    const program = programRows[0];
    const totalCost = parseFloat(program.share_price) * sharesToBuy;
    const roiMultiplier = 1 + (parseFloat(program.roi_percentage) / 100);
    const expectedPayout = totalCost * roiMultiplier;

    // Lock user row and check wallet balance
    const [userRows] = await connection.execute(
      `SELECT balance FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'User account not found.' });
    }

    const currentBalance = parseFloat(userRows[0].balance);

    if (currentBalance < totalCost) {
      await connection.rollback();
      return res.status(400).json({ 
        message: `Insufficient liquid wallet balance. Required: UGX ${totalCost.toLocaleString()}, Available: UGX ${currentBalance.toLocaleString()}` 
      });
    }

    // Calculate Maturity Date
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(program.duration_days, 10));

    // A. Deduct funds from liquid wallet balance
    await connection.execute(
      `UPDATE users SET balance = balance - ? WHERE id = ?`,
      [totalCost, userId]
    );

    // B. Create locked investment record
    await connection.execute(
      `INSERT INTO user_investments (user_id, program_id, shares_purchased, total_invested, expected_payout, end_date, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [userId, program.id, sharesToBuy, totalCost, expectedPayout, endDate]
    );

    // C. Record internal audit transaction log
    const ref = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await connection.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, 'WALLET', 'INTERNAL', ?, 'investment', 'completed')`,
      [userId, ref, totalCost]
    );

    // Commit Transaction
    await connection.commit();

    const updatedBalance = currentBalance - totalCost;

    return res.status(200).json({
      success: true,
      message: `Successfully purchased ${sharesToBuy} share(s) in "${program.title}" for UGX ${totalCost.toLocaleString()}.`,
      remainingBalance: updatedBalance,
      maturityDate: endDate.toLocaleDateString()
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Purchase Investment Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Error processing share purchase.' 
    });
  } finally {
    if (connection) connection.release();
  }
};

/**
 * Fetch Member Active Investments
 * Route: GET /api/investments/my-investments
 */
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