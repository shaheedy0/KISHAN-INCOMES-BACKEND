const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { register, login } = require('../controllers/authController');

// Flexibly validate phone numbers (accepts 07... or 256...)
const phoneRegex = /^(?:256|0)[7][0-9]{8}$/;

const registerRules = [
  body().custom((_, { req }) => {
    const name = req.body.full_name || req.body.full_names;
    if (!name || !name.trim()) {
      throw new Error('Full name is required.');
    }
    return true;
  }),
  body('phone_number')
    .trim()
    .matches(phoneRegex)
    .withMessage('Enter a valid Ugandan number (e.g., 0771234567 or 256771234567).'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long.')
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg
    });
  }
  next();
};

router.post('/register', registerRules, validate, register);
router.post('/login', login);

module.exports = router;