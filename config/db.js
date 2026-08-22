const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 4000,
 
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: false
  },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection on startup using the correct 'pool' reference
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Successfully connected to TiDB Cloud Database!');
    connection.release();
  } catch (error) {
    console.error('TiDB Cloud Connection Error:', error.message);
  }
})();

module.exports = pool;