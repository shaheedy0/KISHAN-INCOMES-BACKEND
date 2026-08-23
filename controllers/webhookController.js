const db = require('../config/db');

/**
 * Express Webhook / Callback Handler for Mobile Money Aggregators
 * Route: POST /api/deposit/webhook
 */
exports.handleTelecomWebhook = async (req, res) => {
  let connection;

  try {
    const { 
      reference,      // Your internal transaction reference
      external_ref,   // Telecom network reference
      status,         // Payment status: 'SUCCESSFUL', 'COMPLETED', 'FAILED'
      amount,         // Paid amount
      secret_key      // Optional aggregator security signature
    } = req.body;

    const EXPECTED_SECRET = process.env.WEBHOOK_SECRET || 'kishan_webhook_secret_key';
    if (secret_key && secret_key !== EXPECTED_SECRET) {
      console.warn(`[Webhook] Unauthorized webhook attempt for ref: ${reference}`);
      return res.status(401).json({ status: 'error', message: 'Invalid webhook security key' });
    }

    if (!reference || !status) {
      return res.status(400).json({ status: 'error', message: 'Missing reference or status in payload' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, user_id, amount, status FROM transactions WHERE reference = ? FOR UPDATE`,
      [reference]
    );

    if (rows.length === 0) {
      await connection.rollback();
      console.warn(`[Webhook] Transaction not found: ${reference}`);
      return res.status(200).json({ status: 'ignored', message: 'Transaction reference not found' });
    }

    const tx = rows[0];

    if (tx.status !== 'pending') {
      await connection.rollback();
      console.log(`[Webhook] Transaction ${reference} already marked as ${tx.status}. Skipping.`);
      return res.status(200).json({ status: 'success', message: 'Transaction already finalized' });
    }

    const isSuccessful = ['SUCCESSFUL', 'SUCCESS', 'COMPLETED', '00'].includes(status.toUpperCase());

    if (isSuccessful) {
      const depositAmount = parseFloat(tx.amount);

      // A. Update transaction status to completed
      await connection.execute(
        `UPDATE transactions SET status = 'completed', external_ref = ?, updated_at = NOW() WHERE id = ?`,
        [external_ref || null, tx.id]
      );

      // B. Credit user's main wallet balance (✅ Correct table)
      await connection.execute(
        `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
        [depositAmount, tx.user_id]
      );

      // C. Referral Bonus Check
      await processReferralBonus(connection, tx.user_id, depositAmount);

      await connection.commit();
      console.log(`[Webhook] Successfully credited UGX ${depositAmount} to user #${tx.user_id} (Ref: ${reference})`);

      return res.status(200).json({ status: 'success', message: 'Wallet balance updated successfully' });

    } else {
      await connection.execute(
        `UPDATE transactions SET status = 'failed', external_ref = ?, updated_at = NOW() WHERE id = ?`,
        [external_ref || null, tx.id]
      );

      await connection.commit();
      console.log(`[Webhook] Transaction ${reference} failed or was declined by user.`);

      return res.status(200).json({ status: 'success', message: 'Transaction status recorded as failed' });
    }

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('[Webhook Error]:', error.message);
    return res.status(500).json({ status: 'error', message: 'Internal server error processing webhook' });
  } finally {
    if (connection) connection.release();
  }
};

/**
 * Helper: Award referral bonus if user was invited and this is their first deposit
 */
async function processReferralBonus(connection, userId, depositAmount) {
  try {
    const [userRows] = await connection.execute(
      `SELECT referred_by FROM users WHERE id = ? AND referred_by IS NOT NULL`,
      [userId]
    );

    if (userRows.length === 0) return;

    const referrerCode = userRows[0].referred_by;

    const [depositCount] = await connection.execute(
      `SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND transaction_type = 'deposit' AND status = 'completed'`,
      [userId]
    );

    if (depositCount[0].count === 1) {
      const BONUS_AMOUNT = 5000;

      const [referrerRows] = await connection.execute(
        `SELECT id FROM users WHERE referral_code = ?`,
        [referrerCode]
      );

      if (referrerRows.length > 0) {
        const referrerId = referrerRows[0].id;

        // ✅ Update bonus_balance in wallets table
        await connection.execute(
          `UPDATE wallets SET bonus_balance = bonus_balance + ? WHERE user_id = ?`,
          [BONUS_AMOUNT, referrerId]
        );

        console.log(`[Referral] Awarded UGX ${BONUS_AMOUNT} bonus to referrer #${referrerId} for user #${userId}`);
      }
    }
  } catch (err) {
    console.error('[Referral Bonus Error]:', err.message);
  }
}