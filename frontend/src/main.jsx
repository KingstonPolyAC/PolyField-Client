
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx' // Assuming your main component is App.jsx
import './index.css'       // For Tailwind or global styles

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)