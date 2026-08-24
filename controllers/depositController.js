const db = require('../config/db');
const crypto = require('crypto');

/**
 * Helper: Format Ugandan phone numbers to standard international format (2567XXXXXXXX)
 */
function formatUGPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  // Remove leading '256' if present, then handle the rest
  if (cleaned.startsWith('256')) {
    cleaned = cleaned.substring(3);
  }
  // If it starts with 0, remove it
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  // Now it should be a 9-digit number starting with 7
  if (!/^7\d{8}$/.test(cleaned)) {
    throw new Error('Invalid Ugandan phone number. Must be MTN or Airtel (e.g. 077... or 070...).');
  }
  return '256' + cleaned;
}

/**
 * Controller: Initiate Deposit Request (Logs as pending and displays Airtel Merchant instructions)
 */
exports.initiateSTKPush = async (req, res) => {
  try {
    const userId = req.user.id;
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
    const txReference = `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 1. Create pending transaction record in MySQL
    const [result] = await db.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, ?, ?, ?, 'deposit', 'pending')`,
      [userId, txReference, formattedPhone, net, parsedAmount]
    );

    // 2. Return success response instructing user to pay via Airtel Merchant code
    return res.status(200).json({
      success: true,
      message: `Deposit request logged as pending. Please pay UGX ${parsedAmount.toLocaleString()} to Airtel Merchant Code: 7183127 (Kishan Incomes Ltd). Your wallet will be credited automatically once the system confirms payment.`,
      reference: txReference,
      transactionId: result.insertId
    });

  } catch (error) {
    console.error('Deposit Initiation Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate deposit.' 
    });
  }
};

/**
 * Controller: Check Status of Pending Deposit (Polling Endpoint)
 */
exports.checkDepositStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

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
    console.error('Check Status Error:', error);
    return res.status(500).json({ message: 'Server error checking status.' });
  }
};

/**
 * Helper: Extract and normalize phone number from SMS text
 * Returns normalized string (e.g., "2567XXXXXXXX") or null if not found.
 */
function extractPhoneNumberFromSMS(text) {
  // Remove all non-digit characters
  const digits = text.replace(/\D/g, '');
  // Look for patterns: 2567XXXXXXXX (12 digits) or 07XXXXXXXX (10 digits) or 7XXXXXXXX (9 digits)
  let match = digits.match(/(?:256)?(0?)(7\d{8})/);
  if (match) {
    let raw = match[0];
    // Ensure it starts with 256
    if (!raw.startsWith('256')) {
      raw = '256' + raw.replace(/^0?/, '');
    }
    // Validate length (12 digits)
    if (raw.length === 12) {
      return raw;
    }
  }
  return null;
}

/**
 * Controller: Handle Incoming SMS Webhook from Android Forwarder App
 */
exports.handleSMSWebhook = async (req, res) => {
  // 1. IMMEDIATELY acknowledge the webhook with a 200 OK.
  res.status(200).json({ success: true, message: 'Webhook received and processing in background' });

  let connection;
  try {
    const { message, text, content, body } = req.body;
    const smsBody = message || text || content || body || '';

    console.log('\n==== INCOMING SMS WEBHOOK ====');
    console.log('Payload Received:', req.body);

    if (!smsBody) {
      console.log('Action: Ignored. Reason: No SMS body found.');
      return; 
    }

    const lowerText = smsBody.toLowerCase();

    // 2. Ignore non-deposit messages gracefully
    if (
      lowerText.includes('download my airtel app') || 
      lowerText.includes('quickloan') ||
      lowerText.includes('insufficient funds')
    ) {
      console.log('Action: Ignored. Reason: Promotional or irrelevant SMS.');
      return;
    }

    // 3. Extract amount from SMS text (matches "UGX 10,000" or "Shs 10,000")
    const amountMatch = smsBody.match(/(?:UGX|Shs)\s*([\d,]+(?:\.\d+)?)/i);
    if (!amountMatch) {
      console.log('Action: Ignored. Reason: Could not parse amount from SMS.');
      return;
    }
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // 4. Extract sender phone number using the improved helper
    const phone = extractPhoneNumberFromSMS(smsBody);
    if (!phone) {
      console.log('Action: Ignored. Reason: Could not parse phone number from SMS.');
      return;
    }

    // Log extracted values
    console.log(`Extracted Phone: ${phone}, Amount: ${amount}`);

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 5. Find matching pending deposit transaction
    // Try both normalized (2567...) and local (0...) variants
    const localPhone = '0' + phone.substring(3);
    const [transactions] = await connection.execute(
      `SELECT id, user_id, amount, status FROM transactions 
       WHERE transaction_type = 'deposit' AND status = 'pending' 
       AND (phone_number = ? OR phone_number = ?) 
       AND amount = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [phone, localPhone, amount]
    );

    if (transactions.length === 0) {
      await connection.rollback();
      console.log(`Action: Ignored. Reason: No pending transaction found for phone ${phone} and amount ${amount}.`);
      return;
    }

    const tx = transactions[0];

    // 6. Mark transaction as completed
    await connection.execute(
      `UPDATE transactions SET status = 'completed' WHERE id = ?`,
      [tx.id]
    );

    // 7. Automatically credit user's WALLET balance
    await connection.execute(
      `UPDATE wallets SET balance = balance + ? WHERE user_id = ?`,
      [tx.amount, tx.user_id]
    );

    await connection.commit();
    console.log(`[SUCCESS] Wallet Updated! User ID ${tx.user_id} credited with UGX ${tx.amount}`);

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('SMS Webhook Processing Error:', error);
  } finally {
    if (connection) connection.release();
  }
};