// Shiira Browser - Utility Functions
// Common helper functions used across modules

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format large numbers with K/M suffixes
 * @param {number} count - Number to format
 * @returns {string} Formatted string
 */
export function formatCount(count) {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string} Domain name
 */
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Check if URL is an internal/Shiira URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isInternalUrl(url) {
  return url.startsWith('shiira://') || 
         url.startsWith('about:') || 
         url.startsWith('chrome://');
}

/**
 * Generate a unique ID
 * @returns {string} Unique identifier
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
