const db = require('../config/db');

exports.getActivePrograms = async (req, res) => {
  try {
    const [programs] = await db.execute(
      `SELECT id, title, description, 
              COALESCE(share_price) AS share_price, 
              roi_percentage, duration_days, program_type, image_url 
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
      `SELECT id, title, share_price, roi_percentage, duration_days, program_type, status
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

    // Check active shares limit (max 3)
    const [activeShares] = await connection.execute(
      `SELECT SUM(shares_purchased) AS total_shares
       FROM user_investments
       WHERE user_id = ? AND program_id = ? AND status = 'active'
       FOR UPDATE`,
      [userId, program_id]
    );

    const currentActiveShares = parseInt(activeShares[0].total_shares) || 0;
    const MAX_SHARES_PER_PROGRAM = 3;

    if (currentActiveShares + sharesToBuy > MAX_SHARES_PER_PROGRAM) {
      await connection.rollback();
      return res.status(400).json({
        message: `You already have ${currentActiveShares} active share(s) in this program. Maximum allowed is ${MAX_SHARES_PER_PROGRAM} shares at a time. You can buy only ${MAX_SHARES_PER_PROGRAM - currentActiveShares} more.`
      });
    }

    const totalCost = parseFloat(program.share_price) * sharesToBuy;
    const roiMultiplier = 1 + (parseFloat(program.roi_percentage) / 100);
    const expectedPayout = totalCost * roiMultiplier;

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

    // Deduct from wallet
    await connection.execute(
      `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
      [totalCost, userId]
    );

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(program.duration_days, 10));
    const dailyEarning = expectedPayout / program.duration_days;

    // ✅ FIX: Set last_credited_date = NULL so the cron can credit the purchase day
    await connection.execute(
      `INSERT INTO user_investments (
        user_id, program_id, shares_purchased, total_invested, 
        expected_payout, daily_earning, pending_earnings,
        start_date, end_date, status, last_credited_date
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', NULL)`,
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
    
    const [rows] = await db.execute(
      `SELECT 
        ui.id, 
        p.title, 
        COALESCE(p.program_type, 'locked') AS program_type,
        ui.shares_purchased, 
        ui.total_invested, 
        p.roi_percentage, 
        ui.expected_payout,
        ui.daily_earning,
        COALESCE(ui.pending_earnings, 0) AS pending_earnings,
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

    const investments = rows.map(inv => {
      if (inv.status === 'active') {
        const daysElapsed = Math.max(0, inv.days_elapsed || 0);
        const daysRemaining = Math.max(0, inv.days_remaining || 0);
        let currentEarnings = 0;
        let totalPayout = inv.total_invested;

        if (inv.program_type === 'flexi') {
          currentEarnings = inv.daily_earning * daysElapsed;
          totalPayout = inv.total_invested + currentEarnings;
        } else {
          currentEarnings = parseFloat(inv.pending_earnings) || 0;
          totalPayout = inv.total_invested + currentEarnings;
        }

        return {
          ...inv,
          days_elapsed: daysElapsed,
          days_remaining: daysRemaining,
          current_earnings: currentEarnings,
          total_payout: totalPayout,
          progress_percentage: inv.days_remaining > 0 ? 
            Math.round((daysElapsed / (daysElapsed + daysRemaining)) * 100) : 100
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

// Mature investments (called by cron or manually)
exports.matureInvestments = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [matured] = await connection.execute(
      `SELECT 
        ui.id, ui.user_id, ui.total_invested, ui.expected_payout, 
        ui.daily_earning, ui.pending_earnings, ui.end_date,
        COALESCE(p.program_type, 'locked') AS program_type
       FROM user_investments ui
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.status = 'active' AND ui.end_date <= NOW()`
    );

    if (matured.length === 0) {
      await connection.commit();
      return res.status(200).json({ success: true, message: 'No investments to mature', matured_count: 0 });
    }

    let totalMatured = 0;
    let totalPayout = 0;

    for (const inv of matured) {
      let payoutAmount = 0;
      if (inv.program_type === 'flexi') {
        payoutAmount = parseFloat(inv.total_invested);
      } else {
        const pending = parseFloat(inv.pending_earnings) || 0;
        payoutAmount = parseFloat(inv.total_invested) + pending;
      }

      await connection.execute(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
        [payoutAmount, inv.user_id]
      );

      await connection.execute(
        `UPDATE user_investments SET status = 'matured', matured_at = NOW() WHERE id = ?`,
        [inv.id]
      );

      const ref = `MAT-${inv.id}-${Date.now()}`;
      await connection.execute(
        `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
         VALUES (?, ?, 'SYSTEM', 'MATURITY', ?, 'maturity_payout', 'completed')`,
        [inv.user_id, ref, payoutAmount]
      );

      totalMatured++;
      totalPayout += payoutAmount;
      console.log(`[Maturity] User ${inv.user_id} received UGX ${payoutAmount} from matured investment ${inv.id}`);
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Matured ${totalMatured} investments, total payout UGX ${totalPayout.toLocaleString()}`,
      matured_count: totalMatured,
      total_payout: totalPayout
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Mature Investments Error:', error);
    return res.status(500).json({ message: 'Error maturing investments.' });
  } finally {
    if (connection) connection.release();
  }
};