// public/auth-check.js

const API_BASE = 'https://kishan-incomes.onrender.com/api';

// Check if user is logged in and has the required role
async function checkAuth(requiredRole = null) {
  const token = localStorage.getItem('kishan_token');
  const user = JSON.parse(localStorage.getItem('kishan_user') || '{}');

  // If no token, redirect to login
  if (!token) {
    window.location.href = 'index.html';
    return false;
  }

  // If role is required, verify it
  if (requiredRole && user.role !== requiredRole) {
    alert('You do not have permission to access this page.');
    window.location.href = 'index.html';
    return false;
  }

  // Verify token is still valid with server
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      // Token is invalid or expired
      localStorage.removeItem('kishan_token');
      localStorage.removeItem('kishan_user');
      window.location.href = 'index.html';
      return false;
    }
    
    const data = await res.json();
    // Update user data in localStorage with latest balance
    if (data.success && data.user) {
      const currentUser = JSON.parse(localStorage.getItem('kishan_user') || '{}');
      currentUser.balance = data.user.balance;
      currentUser.bonus_balance = data.user.bonus_balance;
      localStorage.setItem('kishan_user', JSON.stringify(currentUser));
    }
    
    return true;
  } catch (err) {
    console.error('Auth check error:', err);
    window.location.href = 'index.html';
    return false;
  }
}

// Display user info in header
function displayUserInfo() {
  const user = JSON.parse(localStorage.getItem('kishan_user') || '{}');
  if (user.full_name) {
    const displayElement = document.getElementById('user-display');
    if (displayElement) {
      displayElement.textContent = user.full_name;
    }
  }
}

// Logout function
function logout() {
  localStorage.removeItem('kishan_token');
  localStorage.removeItem('kishan_user');
  window.location.href = 'index.html';
}

// Auto-run when page loads
document.addEventListener('DOMContentLoaded', function() {
  displayUserInfo();
});