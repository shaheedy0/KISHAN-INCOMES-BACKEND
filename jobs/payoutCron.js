const cron = require('node-cron');
const db = require('../config/db');

/**
 * Cron job runs every day at midnight (00:00)
 * 1. Credits daily earnings to wallet for all active investments
 * 2. Matures investments that have reached end_date
 */
const initPayoutCron = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running daily payout job...');

    let connection;
    try {
      connection = await db.getConnection();

      // ========== 1. CREDIT DAILY EARNINGS ==========
      // Find active investments where last_credited_date is NULL or < CURDATE()
      const [investments] = await connection.execute(
        `SELECT id, user_id, daily_earning, last_credited_date, start_date, end_date
         FROM user_investments
         WHERE status = 'active'
           AND (last_credited_date IS NULL OR last_credited_date < CURDATE())
           AND start_date <= CURDATE()`
      );

      if (investments.length > 0) {
        console.log(`[CRON] Crediting daily earnings for ${investments.length} investments...`);
        for (const inv of investments) {
          // Determine the number of days since last credited (or start date)
          let lastDate = inv.last_credited_date || inv.start_date;
          // Ensure we only credit up to today-1 (today's earnings will be credited tomorrow)
          const today = new Date();
          const daysToCredit = Math.floor((today - new Date(lastDate)) / (1000 * 60 * 60 * 24));
          if (daysToCredit <= 0) continue;

          const amountToCredit = inv.daily_earning * daysToCredit;
          if (amountToCredit <= 0) continue;

          // Credit to wallet
          await connection.execute(
            `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
            [amountToCredit, inv.user_id]
          );

          // Record transaction for daily earnings
          const ref = `DAILY-${inv.id}-${Date.now()}`;
          await connection.execute(
            `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status, external_ref)
             VALUES (?, ?, 'SYSTEM', 'DAILY', ?, 'daily_earning', 'completed', ?)`,
            [inv.user_id, ref, amountToCredit, `Investment #${inv.id} daily earnings`]
          );

          // Update last_credited_date to today (or to the last day credited)
          // We'll set it to today's date so we don't re-credit the same days
          await connection.execute(
            `UPDATE user_investments SET last_credited_date = CURDATE() WHERE id = ?`,
            [inv.id]
          );

          console.log(`[CRON] Credited UGX ${amountToCredit} daily earnings to user ${inv.user_id} (Investment ${inv.id})`);
        }
      } else {
        console.log('[CRON] No daily earnings to credit today.');
      }

      // ========== 2. MATURE INVESTMENTS ==========
      const [matured] = await connection.execute(
        `SELECT id, user_id, total_invested, expected_payout, daily_earning, end_date
         FROM user_investments
         WHERE status = 'active' AND end_date <= CURDATE()`
      );

      if (matured.length > 0) {
        console.log(`[CRON] Maturing ${matured.length} investments...`);
        for (const inv of matured) {
          // Also credit any remaining daily earnings not yet credited (if last_credited_date < end_date)
          // But we already credited up to yesterday, so only credit if missing days
          // However, we might have credited all days up to yesterday; if end_date is today, no extra credit needed.
          // We'll just payout the expected_payout which already includes all earnings.
          // But if we already credited daily earnings daily, the wallet already has the earnings.
          // The expected_payout includes principal + all interest, but we've already credited interest daily.
          // So at maturity, we should credit only the principal? Or the full expected_payout?
          // The safest: credit the remaining balance to reach expected_payout.
          // We'll query current wallet balance and adjust.
          // Simpler: at maturity, credit the principal (total_invested) because earnings were already credited daily.
          // Let's credit the principal amount.
          await connection.execute(
            `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
            [inv.total_invested, inv.user_id]
          );

          // Mark investment as matured
          await connection.execute(
            `UPDATE user_investments SET status = 'matured', matured_at = NOW() WHERE id = ?`,
            [inv.id]
          );

          // Record transaction for principal return
          const ref = `MAT-${inv.id}-${Date.now()}`;
          await connection.execute(
            `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status, external_ref)
             VALUES (?, ?, 'SYSTEM', 'MATURITY', ?, 'maturity_payout', 'completed', ?)`,
            [inv.user_id, ref, inv.total_invested, `Maturity payout for Investment #${inv.id}`]
          );

          console.log(`[CRON] Matured investment ${inv.id}, credited principal UGX ${inv.total_invested} to user ${inv.user_id}`);
        }
      } else {
        console.log('[CRON] No investments to mature today.');
      }

      connection.release();
      console.log('[CRON] Daily payout job completed.');

    } catch (error) {
      if (connection) connection.release();
      console.error('[CRON] Error during payout job:', error);
    }
  });

  console.log('[CRON] Daily payout job scheduled to run at midnight.');
};

module.exports = initPayoutCron;