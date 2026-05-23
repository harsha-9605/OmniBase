import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000',
});

// Request interceptor to dynamically attach the token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('omnibase_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
