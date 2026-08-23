const db = require('../config/db'); // MySQL pool connection (mysql2/promise)[cite: 10]
const crypto = require('crypto');[cite: 10]

/**
 * Helper: Format Ugandan phone numbers to standard international format (2567XXXXXXXX)
 */
function formatUGPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '256' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '256' + cleaned;
  }
  
  if (!/^2567\d{8}$/.test(cleaned)) {
    throw new Error('Invalid Ugandan phone number. Must be MTN or Airtel (e.g. 077... or 070...).');
  }
  return cleaned;
}

/**
 * Controller: Initiate Deposit Request (Creates Pending Transaction)
 */
exports.initiateSTKPush = async (req, res) => {
  try {
    const userId = req.user.id; // Extracted from JWT auth middleware[cite: 10]
    const { phone_number, amount, network } = req.body;

    if (!phone_number || !amount || !network) {
      return res.status(400).json({ message: 'Phone number, amount, and network provider are required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 500) {
      return res.status(400).json({ message: 'Minimum deposit amount is UGX 500.' });
    }

    let net = network.trim().toUpperCase();
    if (net.includes('MTN')) net = 'MTN';
    if (net.includes('AIRTEL')) net = 'AIRTEL';

    if (!['MTN', 'AIRTEL'].includes(net)) {
      return res.status(400).json({ message: 'Network must be either MTN or AIRTEL.' });
    }

    const formattedPhone = formatUGPhoneNumber(phone_number);
    const txReference = `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;[cite: 10]

    // Create pending transaction record in MySQL[cite: 10]
    const [result] = await db.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, ?, ?, ?, 'deposit', 'pending')`,
      [userId, txReference, formattedPhone, net, parsedAmount]
    );

    return res.status(200).json({
      success: true,
      message: `Deposit request logged. Please send UGX ${parsedAmount.toLocaleString()} via Mobile Money to our official collection line. Your wallet will be credited automatically upon confirmation.`,
      reference: txReference,
      transactionId: result.insertId
    });

  } catch (error) {
    console.error('Deposit Initiation Error:', error.message);[cite: 10]
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate deposit.' 
    });
  }
};

/**
 * Controller: Check Status of Pending Deposit (Polling Endpoint)[cite: 10]
 */
exports.checkDepositStatus = async (req, res) => {
  try {
    const { reference } = req.params;[cite: 10]
    const userId = req.user.id;[cite: 10]

    const [rows] = await db.execute(
      `SELECT id, reference, amount, status, created_at FROM transactions WHERE reference = ? AND user_id = ?`,
      [reference, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Transaction record not found.' });
    }

    return res.status(200).json({
      success: true,
      transaction: rows[0]
    });
  } catch (error) {
    console.error('Check Status Error:', error);[cite: 10]
    return res.status(500).json({ message: 'Server error checking status.' });
  }
};

/**
 * Controller: Handle Incoming SMS Webhook from Android Forwarder App
 */
exports.handleSMSWebhook = async (req, res) => {
  let connection;
  try {
    const { message, text } = req.body;
    const smsBody = message || text || '';

    console.log('Incoming SMS Webhook Received:', smsBody);

    if (!smsBody) {
      return res.status(400).json({ success: false, message: 'No SMS body received.' });
    }

    // 1. Extract amount from SMS text (matches "UGX 10,000" or "Shs 10,000")
    const amountMatch = smsBody.match(/(?:UGX|Shs)\s*([\d,]+(?:\.\d+)?)/i);
    if (!amountMatch) {
      return res.status(400).json({ success: false, message: 'Could not parse amount from SMS text.' });
    }
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // 2. Extract sender phone number
    const phoneMatch = smsBody.match(/(?:07\d{8}|2567\d{8})/);
    if (!phoneMatch) {
      return res.status(400).json({ success: false, message: 'Could not parse phone number from SMS text.' });
    }
    let phone = phoneMatch[0];
    if (phone.startsWith('0')) {
      phone = '256' + phone.substring(1);
    }

    connection = await db.getConnection();[cite: 10]
    await connection.beginTransaction();

    // 3. Find matching pending deposit transaction
    const [transactions] = await connection.execute(
      `SELECT id, user_id, amount, status FROM transactions 
       WHERE transaction_type = 'deposit' AND status = 'pending' AND (phone_number = ? OR phone_number = ?) AND amount = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [phone, '0' + phone.substring(3), amount]
    );

    if (transactions.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'No pending transaction matches this SMS.' });
    }

    const tx = transactions[0];

    // 4. Mark transaction as completed
    await connection.execute(
      `UPDATE transactions SET status = 'completed' WHERE id = ?`,
      [tx.id]
    );

    // 5. Automatically credit user's wallet balance
    await connection.execute(
      `UPDATE users SET balance = balance + ? WHERE id = ?`,
      [tx.amount, tx.user_id]
    );

    await connection.commit();

    console.log(`[SMS WEBHOOK SUCCESS] User ID ${tx.user_id} credited with UGX ${tx.amount}`);
    return res.status(200).json({ success: true, message: 'Wallet credited successfully.' });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('SMS Webhook Processing Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
};