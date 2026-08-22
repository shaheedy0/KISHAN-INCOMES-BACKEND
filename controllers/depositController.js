const db = require('../config/db'); // MySQL pool connection (mysql2/promise)
const crypto = require('crypto');

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
 * Controller: Initiate STK Push Deposit
 */
exports.initiateSTKPush = async (req, res) => {
  try {
    const userId = req.user.id; // Extracted from JWT auth middleware
    const { phone_number, amount, network } = req.body;

    // 1. Basic Validations
    if (!phone_number || !amount || !network) {
      return res.status(400).json({ message: 'Phone number, amount, and network provider are required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 500) {
      return res.status(400).json({ message: 'Minimum deposit amount is UGX 500.' });
    }

    if (!['MTN', 'AIRTEL'].includes(network.toUpperCase())) {
      return res.status(400).json({ message: 'Network must be either MTN or AIRTEL.' });
    }

    // Format phone number to 2567XXXXXXXX
    const formattedPhone = formatUGPhoneNumber(phone_number);
    const txReference = `DEP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // 2. Create pending transaction record in MySQL
    const [result] = await db.execute(
      `INSERT INTO transactions (user_id, reference, phone_number, network, amount, transaction_type, status) 
       VALUES (?, ?, ?, ?, ?, 'deposit', 'pending')`,
      [userId, txReference, formattedPhone, network.toUpperCase(), parsedAmount]
    );

    const transactionId = result.insertId;

    // 3. Trigger Telecom Provider / Aggregator API (e.g., Yo! Payments, Beyonic, or Direct MTN/Airtel API)
    // Replace this block with your actual aggregator SDK / axios call
    const stkResponse = await triggerTelecomAPI({
      reference: txReference,
      phone: formattedPhone,
      amount: parsedAmount,
      network: network.toUpperCase()
    });

    // Save telecom external transaction reference if available
    if (stkResponse.externalRef) {
      await db.execute(
        `UPDATE transactions SET external_ref = ? WHERE id = ?`,
        [stkResponse.externalRef, transactionId]
      );
    }

    return res.status(200).json({
      success: true,
      message: `STK push prompt sent to ${formattedPhone}. Please check your phone and enter your Mobile Money PIN.`,
      reference: txReference,
      transactionId: transactionId
    });

  } catch (error) {
    console.error('STK Push Error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to initiate STK push deposit.' 
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
 * Helper function to simulate/execute Telecom Aggregator API Call
 */
async function triggerTelecomAPI({ reference, phone, amount, network }) {
  // Example mock response. In production, integrate with:
  // - Yo! Payments (YoPayments.deposit)
  // - Beyonic / Flutterwave / Relnoy Mobile Money
  // - Direct MTN MoMo API Collection (`POST /collection/v1_0/requesttopay`)
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        status: 'PENDING_USER_PIN',
        externalRef: `TELCO-REF-${Date.now()}`
      });
    }, 800);
  });
}