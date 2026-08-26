const cron = require('node-cron');
const db = require('../config/db');

const initPayoutCron = () => {
  // For production, change to '0 0 * * *' for midnight
  cron.schedule('*/5 * * * *', async () => {
    console.log('[CRON] Running daily payout job...');

    let connection;
    try {
      connection = await db.getConnection();

      // ========== 1. CREDIT DAILY EARNINGS ==========
      // ✅ Include purchase day: if last_credited_date is NULL, credit from start_date inclusive.
      const [investments] = await connection.execute(
        `SELECT 
          ui.id, 
          ui.user_id, 
          ui.daily_earning, 
          ui.last_credited_date, 
          ui.start_date, 
          ui.end_date,
          p.program_type,
          CASE 
            WHEN ui.last_credited_date IS NULL THEN DATEDIFF(CURDATE(), DATE(ui.start_date)) + 1
            ELSE DATEDIFF(CURDATE(), ui.last_credited_date)
          END AS days_to_credit
         FROM user_investments ui
         JOIN investment_programs p ON ui.program_id = p.id
         WHERE ui.status = 'active'
           AND (ui.last_credited_date IS NULL OR ui.last_credited_date < CURDATE())
           AND ui.start_date <= CURDATE()
           AND ui.end_date > CURDATE()  -- Only active (not yet matured)
         ORDER BY ui.id`
      );

      if (investments.length > 0) {
        console.log(`[CRON] Processing ${investments.length} investments for daily earnings...`);
        for (const inv of investments) {
          // Ensure we don't credit beyond the end date (optional but safe)
          const totalDays = Math.ceil((new Date(inv.end_date) - new Date(inv.start_date)) / (1000*60*60*24));
          let daysToCredit = Math.min(inv.days_to_credit, totalDays - 1); // cap at remaining days
          if (daysToCredit <= 0) continue;

          const amountToCredit = inv.daily_earning * daysToCredit;
          if (amountToCredit <= 0) continue;

          if (inv.program_type === 'flexi') {
            // Credit to wallet immediately
            await connection.execute(
              `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
              [amountToCredit, inv.user_id]
            );
            const ref = `DAILY-${inv.id}-${Date.now()}`;
            await connection.execute(
              `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status, external_ref)
               VALUES (?, ?, 'SYSTEM', 'DAILY', ?, 'daily_earning', 'completed', ?)`,
              [inv.user_id, ref, amountToCredit, `Daily earnings for Investment #${inv.id}`]
            );
            console.log(`[CRON] Credited UGX ${amountToCredit} daily earnings to user ${inv.user_id} (Flexi investment ${inv.id})`);
          } else {
            // Locked: add to pending_earnings
            await connection.execute(
              `UPDATE user_investments SET pending_earnings = pending_earnings + ? WHERE id = ?`,
              [amountToCredit, inv.id]
            );
            console.log(`[CRON] Added UGX ${amountToCredit} to pending earnings for investment ${inv.id}`);
          }

          // Update last_credited_date to today
          await connection.execute(
            `UPDATE user_investments SET last_credited_date = CURDATE() WHERE id = ?`,
            [inv.id]
          );
        }
      } else {
        console.log('[CRON] No daily earnings to process today.');
      }

      // ========== 2. MATURE INVESTMENTS ==========
      const [matured] = await connection.execute(
        `SELECT ui.id, ui.user_id, ui.total_invested, ui.expected_payout, ui.daily_earning, ui.pending_earnings, ui.end_date,
                p.program_type
         FROM user_investments ui
         JOIN investment_programs p ON ui.program_id = p.id
         WHERE ui.status = 'active' AND ui.end_date <= CURDATE()`
      );

      if (matured.length > 0) {
        console.log(`[CRON] Maturing ${matured.length} investments...`);
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

          console.log(`[CRON] Matured investment ${inv.id}, credited UGX ${payoutAmount} to user ${inv.user_id}`);
        }
      } else {
        console.log('[CRON] No investments to mature today.');
      }

      connection.release();
      console.log('[CRON] Daily payout job completed.');

    } catch (error) {
      if (connection) connection.release();
      console.error('[CRON] Error:', error);
    }
  });

  console.log('[CRON] Daily payout job scheduled to run every 5 minutes for testing.');
};

module.exports = initPayoutCron;