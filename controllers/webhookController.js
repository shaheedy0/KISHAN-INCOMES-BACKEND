const db = require('../config/db');

/**
 * Express Webhook / Callback Handler for Mobile Money Aggregators
 * Route: POST /api/deposit/webhook
 */
exports.handleTelecomWebhook = async (req, res) => {
  // 1. Get database connection for atomic transaction management
  let connection;

  try {
    // Extract standardized payload parameters (adapt key names to match your aggregator)
    const { 
      reference,      // Your internal transaction reference (e.g., DEP-1724260000-ABC)
      external_ref,   // Telecom network reference (e.g., MTN-10293848)
      status,         // Payment status: 'SUCCESSFUL', 'COMPLETED', 'FAILED', 'CANCELLED'
      amount,         // Paid amount
      secret_key      // Optional aggregator security signature or token
    } = req.body;

    // Optional: Verify Webhook Secret Key / Signature to prevent spoofing
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

    // 2. Fetch transaction record and lock row for update
    const [rows] = await connection.execute(
      `SELECT id, user_id, amount, status FROM transactions WHERE reference = ? FOR UPDATE`,
      [reference]
    );

    if (rows.length === 0) {
      await connection.rollback();
      console.warn(`[Webhook] Transaction not found: ${reference}`);
      // Return 200 OK so the aggregator stops retrying for invalid refs
      return res.status(200).json({ status: 'ignored', message: 'Transaction reference not found' });
    }

    const tx = rows[0];

    // 3. Idempotency Check: If already processed, acknowledge receipt and exit
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

      // B. Credit user's main wallet balance
      await connection.execute(
        `UPDATE users SET balance = balance + ? WHERE id = ?`,
        [depositAmount, tx.user_id]
      );

      // C. Referral Bonus Check: Reward referrer on member's first completed deposit
      await processReferralBonus(connection, tx.user_id, depositAmount);

      await connection.commit();
      console.log(`[Webhook] Successfully credited UGX ${depositAmount} to user #${tx.user_id} (Ref: ${reference})`);

      return res.status(200).json({ status: 'success', message: 'Wallet balance updated successfully' });

    } else {
      // Payment failed or was cancelled by user
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
    // Return 500 so aggregator retries later if database error occurs
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
    // Check if user was referred by someone
    const [userRows] = await connection.execute(
      `SELECT referred_by FROM users WHERE id = ? AND referred_by IS NOT NULL`,
      [userId]
    );

    if (userRows.length === 0) return; // Not a referred user

    const referrerCode = userRows[0].referred_by;

    // Count prior completed deposits for this user
    const [depositCount] = await connection.execute(
      `SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND transaction_type = 'deposit' AND status = 'completed'`,
      [userId]
    );

    // If this is their first completed deposit (count == 1 after the update)
    if (depositCount[0].count === 1) {
      const BONUS_AMOUNT = 5000; // Flat UGX 5,000 reward for referrer

      // Find referrer user ID
      const [referrerRows] = await connection.execute(
        `SELECT id FROM users WHERE referral_code = ?`,
        [referrerCode]
      );

      if (referrerRows.length > 0) {
        const referrerId = referrerRows[0].id;

        // Add bonus to referrer's bonus balance
        await connection.execute(
          `UPDATE users SET bonus_balance = bonus_balance + ? WHERE id = ?`,
          [BONUS_AMOUNT, referrerId]
        );

        console.log(`[Referral] Awarded UGX ${BONUS_AMOUNT} bonus to referrer #${referrerId} for user #${userId}`);
      }
    }
  } catch (err) {
    console.error('[Referral Bonus Error]:', err.message);
  }
}