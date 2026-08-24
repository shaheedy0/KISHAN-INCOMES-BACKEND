const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();

// ===== SECURITY MIDDLEWARE =====
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", "data:", "blob:"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https:",
          "http:",
          "https://cdn.tailwindcss.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https:",
          "http:",
          "https://cdn.tailwindcss.com",
        ],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        connectSrc: ["'self'", "https:", "http:", "https://kishan-incomes.onrender.com"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

// Rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use(globalLimiter);

// CORS
const corsOptions = {
  origin: 'https://kishan-incomes.onrender.com',
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Standard middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to load routes
function loadModule(modulePath) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`❌ CRASH LOAD ERROR in [${modulePath}]:`, err.message);
    return null;
  }
}

// Load routes
const authRoutes = loadModule('./routes/authRoutes');
const depositRoutes = loadModule('./routes/depositRoutes');
const withdrawalRoutes = loadModule('./routes/withdrawalRoutes');
const investmentRoutes = loadModule('./routes/investmentRoutes');
const adminRoutes = loadModule('./routes/adminRoutes');
const programRoutes = loadModule('./routes/programRoutes');

if (authRoutes) app.use('/api/auth', authRoutes);
if (depositRoutes) app.use('/api/deposit', depositRoutes);
if (withdrawalRoutes) app.use('/api/withdrawal', withdrawalRoutes);
if (investmentRoutes) app.use('/api/investments', investmentRoutes);
if (adminRoutes) app.use('/api/admin', adminRoutes);
if (programRoutes) app.use('/api/programs', programRoutes);

// Health endpoints
app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Kishan Income API is live and operational.',
  });
});
app.get('/api/health', (req, res) => {
  res.send('Kishan Incomes API is running...');
});

// Frontend routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/wallet', (req, res) => {
  res.redirect('/wallet.html');
});
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// ===== START CRON JOB =====
const initPayoutCron = require('./jobs/payoutCron'); // ✅ Correct path
initPayoutCron();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`=================================\n`);
});