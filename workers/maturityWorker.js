const cron = require('node-cron');
const db = require('../config/db');

/**
 * Sweeps the database for matured investments and credits payouts to member wallets.
 */
async function processMaturedInvestments() {
  let connection;

  try {
    connection = await db.getConnection();

    // 1. Fetch active investments where the end_date has passed
    const [maturedInvestments] = await connection.execute(
      `SELECT ui.id, ui.user_id, ui.expected_payout, p.title 
       FROM user_investments ui
       JOIN investment_programs p ON ui.program_id = p.id
       WHERE ui.status = 'active' AND ui.end_date <= NOW()`
    );

    if (maturedInvestments.length === 0) {
      return; // No investments matured in this run
    }

    console.log(`[Cron Worker] Processing ${maturedInvestments.length} matured investment(s)...`);

    // 2. Process each matured investment inside its own transaction
    for (const inv of maturedInvestments) {
      try {
        await connection.beginTransaction();

        const payoutAmount = parseFloat(inv.expected_payout);

        // A. Credit principal + ROI to member's liquid balance
        await connection.execute(
          `UPDATE users SET balance = balance + ? WHERE id = ?`,
          [payoutAmount, inv.user_id]
        );

        // B. Update investment status to matured
        await connection.execute(
          `UPDATE user_investments SET status = 'matured' WHERE id = ? AND status = 'active'`,
          [inv.id]
        );

        // C. Record internal transaction log for audit trailing
        const txRef = `MAT-${inv.id}-${Date.now()}`;
        await connection.execute(
          `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
           VALUES (?, ?, 'SYSTEM', 'INTERNAL', ?, 'deposit', 'completed')`,
          [inv.user_id, txRef, payoutAmount]
        );

        await connection.commit();
        console.log(`[Cron Worker] Successfully paid out UGX ${payoutAmount.toLocaleString()} for investment #${inv.id} ("${inv.title}") to User #${inv.user_id}`);

      } catch (err) {
        if (connection) await connection.rollback();
        console.error(`[Cron Worker Error] Failed to process investment #${inv.id}:`, err.message);
      }
    }

  } catch (error) {
    console.error('[Cron Worker Error] Database execution failed:', error.message);
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Initialize schedule
 */
function startMaturityWorker() {
  console.log('[Cron Worker] Investment Maturity Worker Started.');

  // Schedule to run every hour at minute 0: '0 * * * *'
  // (Change to '* * * * *' to run every minute during development testing)
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron Worker] Running hourly maturity check...');
    await processMaturedInvestments();
  });
}

module.exports = { startMaturityWorker, processMaturedInvestments };