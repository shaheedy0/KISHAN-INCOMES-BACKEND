const cron = require('node-cron');
const db = require('../config/db');

const initPayoutCron = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running daily payout job...');

    let connection;
    try {
      connection = await db.getConnection();

      // ========== 1. CREDIT DAILY EARNINGS ==========
      // Calculate days since last credited using DATEDIFF in SQL
      const [investments] = await connection.execute(
        `SELECT 
          ui.id, 
          ui.user_id, 
          ui.daily_earning, 
          ui.last_credited_date, 
          ui.start_date, 
          ui.end_date,
          p.program_type,
          DATEDIFF(CURDATE(), COALESCE(ui.last_credited_date, ui.start_date)) AS days_to_credit
         FROM user_investments ui
         JOIN investment_programs p ON ui.program_id = p.id
         WHERE ui.status = 'active'
           AND (ui.last_credited_date IS NULL OR ui.last_credited_date < CURDATE())
           AND ui.start_date <= CURDATE()`
      );

      if (investments.length > 0) {
        console.log(`[CRON] Processing ${investments.length} investments for daily earnings...`);
        for (const inv of investments) {
          const daysToCredit = inv.days_to_credit || 0;
          console.log(`[CRON] Investment ${inv.id}: days_to_credit = ${daysToCredit}, daily_earning = ${inv.daily_earning}`);
          
          if (daysToCredit <= 0) continue;

          const amountToCredit = inv.daily_earning * daysToCredit;
          if (amountToCredit <= 0) continue;

          if (inv.program_type === 'flexi') {
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
            await connection.execute(
              `UPDATE user_investments SET pending_earnings = pending_earnings + ? WHERE id = ?`,
              [amountToCredit, inv.id]
            );
            console.log(`[CRON] Added UGX ${amountToCredit} to pending earnings for investment ${inv.id}`);
          }

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
      console.error('[CRON] Error during payout job:', error);
    }
  });

  console.log('[CRON] Daily payout job scheduled to run at midnight.');
};

module.exports = initPayoutCron;