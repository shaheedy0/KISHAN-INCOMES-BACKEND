const cron = require('node-cron');
const db = require('../config/db');

/**
 * Midnight Cron Job: '0 0 * * *'
 * Runs every day at 00:00 (12:00 AM)
 */
const initPayoutCron = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running midnight investment payout job...');

    try {
      // 1. Fetch all active investments that have reached or passed their maturity date
      const [maturedInvestments] = await db.execute(
        `SELECT id, user_id, expected_payout 
         FROM user_investments 
         WHERE status = 'active' AND end_date <= NOW()`
      );

      if (maturedInvestments.length === 0) {
        console.log('[CRON] No matured investments to process today.');
        return;
      }

      console.log(`[CRON] Found ${maturedInvestments.length} matured investment(s) to payout.`);

      // 2. Process each matured investment in its own isolated transaction
      for (const investment of maturedInvestments) {
        const connection = await db.getConnection();

        try {
          await connection.beginTransaction();

          // Credit the user's wallet balance with the full payout (principal + interest)
          await connection.execute(
            `UPDATE wallets 
             SET balance = balance + ? 
             WHERE user_id = ?`,
            [investment.expected_payout, investment.user_id]
          );

          // Mark investment as 'matured'
          await connection.execute(
            `UPDATE user_investments 
             SET status = 'matured' 
             WHERE id = ?`,
            [investment.id]
          );

          // Record internal audit transaction
          const refId = `PAYOUT-${investment.id}-${Date.now()}`;
          await connection.execute(
            `INSERT INTO transactions 
             (user_id, transaction_type, amount, provider, reference_id, status) 
             VALUES (?, 'investment_payout', ?, 'INTERNAL', ?, 'successful')`,
            [investment.user_id, investment.expected_payout, refId]
          );

          await connection.commit();
          console.log(`[CRON] Payout successful for Investment ID: ${investment.id}, User ID: ${investment.user_id}`);

        } catch (err) {
          await connection.rollback();
          console.error(`[CRON] Payout failed for Investment ID: ${investment.id}`, err);
        } finally {
          connection.release();
        }
      }

    } catch (error) {
      console.error('[CRON] Fatal error fetching matured investments:', error);
    }
  });

  console.log('[CRON] Investment payout background job scheduled.');
};

module.exports = initPayoutCron;