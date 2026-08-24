const db = require('../config/db');

// Helper: calculate daily earnings
function calculateDailyEarnings(totalInvested, roiPercentage, durationDays) {
  const totalReturn = totalInvested * (1 + (roiPercentage / 100));
  const dailyEarning = totalReturn / durationDays;
  return { totalReturn, dailyEarning };
}

exports.getActivePrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      `SELECT id, title, description, 
              COALESCE(share_price) AS share_price, 
              roi_percentage, duration_days, image_url 
       FROM investment_programs 
       WHERE status = 'active'
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
      `SELECT id, title, share_price, roi_percentage, duration_days, status
       FROM investment_programs 
       WHERE id = ? AND status = 'active'
       FOR UPDATE`,
      [program_id]
    );

    if (programRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Investment program unavailable or not active.' });
    }

    const program = programRows[0];
    const totalCost = parseFloat(program.share_price) * sharesToBuy;
    const roiMultiplier = 1 + (parseFloat(program.roi_percentage) / 100);
    const expectedPayout = totalCost * roiMultiplier;

    // Lock wallet row
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

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(program.duration_days, 10));

    // Deduct from wallets
    await connection.execute(
      `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
      [totalCost, userId]
    );

    // Calculate daily earnings
    const { totalReturn, dailyEarning } = calculateDailyEarnings(
      totalCost,
      parseFloat(program.roi_percentage),
      parseInt(program.duration_days)
    );

    await connection.execute(
      `INSERT INTO user_investments (
        user_id, program_id, shares_purchased, total_invested, 
        expected_payout, daily_earning, start_date, end_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [userId, program.id, sharesToBuy, totalCost, expectedPayout, dailyEarning, startDate, endDate]
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
      maturityDate: endDate.toLocaleDateString(),
      dailyEarning: dailyEarning
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
    
    // Fetch with all required fields
    const [rows] = await db.execute(
      `SELECT 
        ui.id, 
        p.title, 
        ui.shares_purchased, 
        ui.total_invested, 
        p.roi_percentage, 
        ui.expected_payout,
        ui.daily_earning,
        ui.start_date, 
        ui.end_date, 
        ui.status,
        DATEDIFF(ui.end_date, NOW()) AS days_remaining,
        DATEDIFF(NOW(), ui.start_date) AS days_elapsed
       FROM user_investments ui
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.user_id = ?
       ORDER BY ui.created_at DESC`,
      [userId]
    );

    // Calculate current earnings for active investments
    const investments = rows.map(inv => {
      if (inv.status === 'active') {
        const daysElapsed = Math.max(0, inv.days_elapsed || 0);
        const daysRemaining = Math.max(0, inv.days_remaining || 0);
        const currentEarnings = (inv.daily_earning || 0) * daysElapsed;
        const totalPayout = inv.total_invested + currentEarnings;
        
        return {
          ...inv,
          days_elapsed: daysElapsed,
          days_remaining: daysRemaining,
          current_earnings: currentEarnings,
          total_payout: totalPayout,
          progress_percentage: (daysElapsed + daysRemaining) > 0 ? 
            Math.round((daysElapsed / (daysElapsed + daysRemaining)) * 100) : 0
        };
      }
      return inv;
    });

    return res.status(200).json(investments);
  } catch (error) {
    console.error('Fetch My Investments Error:', error);
    return res.status(500).json({ message: 'Error retrieving investments.' });
  }
};

// ✅ Mature investments (called by cron or manually)
exports.matureInvestments = async (req, res) => {
  let connection;
  
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Find investments that have reached maturity date
    const [matured] = await connection.execute(
      `SELECT id, user_id, total_invested, expected_payout, daily_earning, end_date
       FROM user_investments 
       WHERE status = 'active' AND end_date <= NOW()`
    );

    if (matured.length === 0) {
      await connection.commit();
      if (res) return res.status(200).json({ 
        success: true, 
        message: 'No investments to mature',
        matured_count: 0 
      });
      return;
    }

    let totalMatured = 0;
    let totalPayout = 0;

    for (const inv of matured) {
      // Calculate actual earnings based on exact days
      const daysElapsed = Math.ceil((new Date() - new Date(inv.end_date)) / (1000 * 60 * 60 * 24));
      const actualEarnings = (inv.daily_earning || 0) * daysElapsed;
      const payoutAmount = parseFloat(inv.total_invested) + actualEarnings;

      // Credit user's wallet
      await connection.execute(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
        [payoutAmount, inv.user_id]
      );

      // Update investment status
      await connection.execute(
        `UPDATE user_investments SET status = 'matured', matured_at = NOW() WHERE id = ?`,
        [inv.id]
      );

      // Record payout transaction
      const ref = `MAT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await connection.execute(
        `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
         VALUES (?, ?, 'SYSTEM', 'INTERNAL', ?, 'maturity_payout', 'completed')`,
        [inv.user_id, ref, payoutAmount]
      );

      totalMatured++;
      totalPayout += payoutAmount;
      console.log(`[Maturity] User ${inv.user_id} received UGX ${payoutAmount} from matured investment ${inv.id}`);
    }

    await connection.commit();

    if (res) {
      return res.status(200).json({
        success: true,
        message: `Matured ${totalMatured} investments, total payout UGX ${totalPayout.toLocaleString()}`,
        matured_count: totalMatured,
        total_payout: totalPayout
      });
    }
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Mature Investments Error:', error);
    if (res) return res.status(500).json({ message: 'Error maturing investments.' });
  } finally {
    if (connection) connection.release();
  }
};