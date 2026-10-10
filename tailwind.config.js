/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:'#f4f3ff',100:'#e9e7ff',200:'#d4d0ff',300:'#b3acff',400:'#9286ff',500:'#7567ff',600:'#5b50f5',700:'#4940d7',800:'#3732a8',900:'#252471'
        },
        accent: { 400:'#60a5fa',500:'#3b82f6',600:'#2563eb' }
      }
    }
  },
  plugins: []
};
