import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    port: 5174,
    strictPort: true, // fail instead of switching to a random port
    // Redirect all 404s back to index.html so React Router can handle
    // deep links like /workspace/3 on page refresh.
    historyApiFallback: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})
