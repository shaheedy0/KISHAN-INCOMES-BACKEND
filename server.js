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

// Serve static frontend files from the "public" directory
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

// Load Routes Safely
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

// Optional API health check fallback route
app.get('/api/health', (req, res) => {
  res.send('Kishan Incomes API is running...');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`=================================\n`);
});