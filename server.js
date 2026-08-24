const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to safely load routes/modules without stopping the server
function loadModule(modulePath) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`❌ CRASH LOAD ERROR in [${modulePath}]:`, err.message);
    return null;
  }
}

// Load API Routes Safely
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

// API status & health check endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Kishan Income API is live and operational.'
  });
});

app.get('/api/health', (req, res) => {
  res.send('Kishan Incomes API is running...');
});

// Fallback to send index.html for root and frontend requests
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Optional: redirect /wallet to wallet.html
app.get('/wallet', (req, res) => {
  res.redirect('/wallet.html');
});

// Optional: redirect /admin to admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`=================================\n`);
});