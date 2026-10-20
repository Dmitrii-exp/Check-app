/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './app/index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        'canvas': 'rgb(var(--check-canvas-rgb) / <alpha-value>)',
        'surface': 'rgb(var(--check-surface-rgb) / <alpha-value>)',
        'raised': 'rgb(var(--check-raised-rgb) / <alpha-value>)',
        'header': 'rgb(var(--check-header-rgb) / <alpha-value>)',
        'hover': 'rgb(var(--check-hover-rgb) / <alpha-value>)',
        'line': 'rgb(var(--check-border-rgb) / <alpha-value>)',
        'control': 'rgb(var(--check-control-rgb) / <alpha-value>)',
        'strong': 'rgb(var(--check-strong-rgb) / <alpha-value>)',
        'ink': 'rgb(var(--check-text-rgb) / <alpha-value>)',
        'soft': 'rgb(var(--check-soft-rgb) / <alpha-value>)',
        'muted': 'rgb(var(--check-muted-rgb) / <alpha-value>)',
        'subtle': 'rgb(var(--check-subtle-rgb) / <alpha-value>)',
        'brand': 'rgb(var(--check-brand-rgb) / <alpha-value>)',
        'success': 'rgb(var(--check-success-rgb) / <alpha-value>)',
        'warning': 'rgb(var(--check-warning-rgb) / <alpha-value>)',
        'danger': 'rgb(var(--check-danger-rgb) / <alpha-value>)',
        'info': 'rgb(var(--check-info-rgb) / <alpha-value>)',
        'info-soft': 'rgb(var(--check-info-soft-rgb) / <alpha-value>)',
        primary: {
          50:'#f4f3ff',100:'#e9e7ff',200:'#d4d0ff',300:'#b3acff',400:'#9286ff',500:'#7567ff',600:'#5b50f5',700:'#4940d7',800:'#3732a8',900:'#252471'
        },
        accent: { 400:'#60a5fa',500:'#3b82f6',600:'#2563eb' }
      }
    }
  },
  plugins: []
};
