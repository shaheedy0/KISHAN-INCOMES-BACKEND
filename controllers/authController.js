const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  try {
    const full_name = (req.body.full_names || req.body.full_name || '').trim();
    const phone_number = (req.body.phone_number || '').trim();
    const password = req.body.password || '';

    if (!full_name || !phone_number || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name, phone number, and password are required.'
      });
    }

    // 1. Check for duplicate phone number
    const [existing] = await db.execute('SELECT id FROM users WHERE phone_number = ?', [phone_number]);
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This phone number is already registered.'
      });
    }

    // 2. Hash password & generate unique referral code
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userReferralCode = 'KISHAN-' + Math.floor(100000 + Math.random() * 900000);

    // 3. Insert user record (without balance column)
    const [result] = await db.execute(
      `INSERT INTO users (full_name, phone_number, password_hash, referral_code) VALUES (?, ?, ?, ?)`,
      [full_name, phone_number, passwordHash, userReferralCode]
    );

    const userId = result.insertId;

    // 4. Create wallet record
    if (userId) {
      try {
        await db.execute('INSERT INTO wallets (user_id, balance, bonus_balance) VALUES (?, 0.00, 0.00)', [userId]);
      } catch (wErr) {
        console.warn('Wallet creation note:', wErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      referral_code: userReferralCode
    });

  } catch (error) {
    console.error('Registration DB Error:', error);
    return res.status(500).json({
      success: false,
      error_details: error.sqlMessage || error.message || 'Database error during registration'
    });
  }
};

exports.login = async (req, res) => {
  const { phone_number, password } = req.body;
  try {
    const [users] = await db.execute('SELECT * FROM users WHERE phone_number = ?', [phone_number]);
    if (users.length === 0) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    // Fetch user's wallet balance from the wallets table
    const [wallets] = await db.execute('SELECT balance, bonus_balance FROM wallets WHERE user_id = ?', [user.id]);
    const balance = wallets.length > 0 ? wallets[0].balance : 0.00;
    const bonus_balance = wallets.length > 0 ? wallets[0].bonus_balance : 0.00;

    const token = jwt.sign(
      { id: user.id, role: user.role, phone: user.phone_number },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    // Return role and balance back to the frontend
    return res.json({ 
      success: true, 
      token, 
      user: { 
        id: user.id, 
        full_name: user.full_name, 
        phone_number: user.phone_number,
        role: user.role,
        balance: balance,
        bonus_balance: bonus_balance,
        referral_code: user.referral_code
      } 
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Get current user profile with wallet balances
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const [userRows] = await db.execute(
      'SELECT id, full_name, phone_number, role, referral_code FROM users WHERE id = ?',
      [userId]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const [walletRows] = await db.execute(
      'SELECT balance, bonus_balance FROM wallets WHERE user_id = ?',
      [userId]
    );
    const balance = walletRows.length > 0 ? walletRows[0].balance : 0;
    const bonus_balance = walletRows.length > 0 ? walletRows[0].bonus_balance : 0;

    res.json({
      success: true,
      user: { ...userRows[0], balance, bonus_balance }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};