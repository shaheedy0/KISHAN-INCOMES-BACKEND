const db = require('../config/db');
const crypto = require('crypto');

function formatUGPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '256' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '256' + cleaned;
  }
  if (!/^2567\d{8}$/.test(cleaned)) {
    throw new Error('Invalid Ugandan phone number. Must be MTN or Airtel (e.g., 077... or 070...).');
  }
  return cleaned;
}

// ===== REQUEST WITHDRAWAL (PENDING, NO AUTO‑COMPLETE) =====
exports.requestWithdrawal = async (req, res) => {
  let connection;

  try {
    const userId = req.user.id;
    const { phone_number, amount, network } = req.body;

    if (!phone_number || !amount || !network) {
      return res.status(400).json({ message: 'Phone number, amount, and network are required.' });
    }

    const withdrawAmount = parseFloat(amount);
    const MIN_WITHDRAWAL = 1000;

    if (isNaN(withdrawAmount) || withdrawAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({ 
        message: `Minimum withdrawal amount is UGX ${MIN_WITHDRAWAL.toLocaleString()}.` 
      });
    }

    if (!['MTN', 'AIRTEL'].includes(network.toUpperCase())) {
      return res.status(400).json({ message: 'Network must be either MTN or AIRTEL.' });
    }

    const formattedPhone = formatUGPhoneNumber(phone_number);
    const txReference = `WD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock wallet
    const [walletRows] = await connection.execute(
      `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
      [userId]
    );

    if (walletRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Wallet not found.' });
    }

    const currentBalance = parseFloat(walletRows[0].balance);

    if (currentBalance < withdrawAmount) {
      await connection.rollback();
      return res.status(400).json({ 
        message: `Insufficient wallet balance. Available: UGX ${currentBalance.toLocaleString()}` 
      });
    }

    // Deduct balance (hold funds)
    await connection.execute(
      `UPDATE wallets SET balance = balance - ? WHERE user_id = ?`,
      [withdrawAmount, userId]
    );

    // Create pending transaction (status = 'pending')
    const [txResult] = await connection.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, ?, ?, ?, 'withdrawal', 'pending')`,
      [userId, txReference, formattedPhone, network.toUpperCase(), withdrawAmount]
    );

    const transactionId = txResult.insertId;

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Withdrawal request of UGX ${withdrawAmount.toLocaleString()} submitted for admin approval. You will receive funds once approved.`,
      reference: txReference,
      transactionId: transactionId,
      newBalance: currentBalance - withdrawAmount
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Withdrawal Processing Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Internal server error processing withdrawal.'
    });
  } finally {
    if (connection) connection.release();
  }
};

// ===== GET USER TRANSACTION HISTORY (ALL TYPES) =====
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute(
      `SELECT id, reference, phone_number, network, amount, transaction_type, status, created_at 
       FROM transactions 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transaction history.' });
  }
};

// ===== GET WITHDRAWAL HISTORY (legacy) =====
exports.getWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute(
      `SELECT id, reference, phone_number, network, amount, status, external_ref, created_at 
       FROM transactions 
       WHERE user_id = ? AND transaction_type = 'withdrawal' 
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Fetch Withdrawal History Error:', error);
    return res.status(500).json({ message: 'Server error retrieving withdrawal history.' });
  }
};

// ===== (Helper) B2C Payout – used by admin approval (kept for compatibility) =====
async function executeB2CPayoutAPI({ reference, phone, amount, network }) {
  // Mock – replace with actual aggregator call
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        status: 'completed',
        externalRef: `B2C-TELCO-${Date.now()}`
      });
    }, 1000);
  });
}
exports.executeB2CPayoutAPI = executeB2CPayoutAPI;