import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
<<<<<<< Updated upstream
    hmr: false
  }
=======
    // hmr: false
  },
  base: "/DeviceManager/"
>>>>>>> Stashed changes
})

