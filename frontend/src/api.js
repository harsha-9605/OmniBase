import axios from 'axios';

// Reads VITE_API_URL from .env → https://omnibase-backend.onrender.com in production
// Falls back to http://localhost:8000 for local development
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE,
});

// Request interceptor to dynamically attach the token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('omnibase_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Automatically extract tenant ID from URL
    const match = window.location.pathname.match(/\/workspace\/(\d+)/);
    const tenantId = match ? match[1] : null;
    if (tenantId) {
      config.headers['X-Tenant-ID'] = tenantId;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401s (optional but good practice)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login if token is invalid/expired
      localStorage.removeItem('omnibase_token');
      // If we are not already on the landing or auth pages, reload
      const path = window.location.pathname;
      if (path !== '/' && path !== '/signin' && path !== '/signup') {
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
