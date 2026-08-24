// public/admin-auth-check.js

const API_BASE = 'https://kishan-incomes.onrender.com/api';

// Check if user is logged in and is an admin
async function checkAdminAuth() {
  const token = localStorage.getItem('kishan_token');
  const user = JSON.parse(localStorage.getItem('kishan_user') || '{}');

  // If no token, redirect to login
  if (!token) {
    alert('Please log in first.');
    window.location.href = 'index.html';
    return false;
  }

  // Check if user is admin
  if (user.role !== 'admin') {
    alert('Access denied. Admin privileges required.');
    window.location.href = 'index.html';
    return false;
  }

  // Verify token with server
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      localStorage.removeItem('kishan_token');
      localStorage.removeItem('kishan_user');
      window.location.href = 'index.html';
      return false;
    }
    
    const data = await res.json();
    // Verify user is still admin
    if (data.success && data.user && data.user.role !== 'admin') {
      alert('Admin privileges revoked. Redirecting...');
      localStorage.removeItem('kishan_token');
      localStorage.removeItem('kishan_user');
      window.location.href = 'index.html';
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('Admin auth check error:', err);
    window.location.href = 'index.html';
    return false;
  }
}

// Display admin info
function displayAdminInfo() {
  const user = JSON.parse(localStorage.getItem('kishan_user') || '{}');
  const displayElement = document.getElementById('admin-display');
  if (displayElement && user.full_name) {
    displayElement.textContent = `👑 ${user.full_name}`;
  }
}