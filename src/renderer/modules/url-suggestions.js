// Shiira Browser - URL Suggestions Module
// Handles autocomplete and URL suggestions

import { escapeHtml, debounce } from './utils.js';

/**
 * URL Suggestions Mixin
 * Adds autocomplete functionality to ShiiraBrowser
 */
export const UrlSuggestionsMixin = {
  /**
   * Initialize URL suggestions
   */
  initUrlSuggestions() {
    this.suggestions = [];
    this.selectedSuggestionIndex = -1;
    this.suggestionDebounceTimer = null;
    this.lastUserInput = '';
    this.isDeleting = false;
    
    // Track when user is deleting text
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.isDeleting = true;
      }
    });
  },

  /**
   * Handle URL input change
   */
  handleUrlInputChange() {
    const input = this.urlInput.value;
    
    // Clear any existing debounce timer
    if (this.suggestionDebounceTimer) {
      clearTimeout(this.suggestionDebounceTimer);
    }
    
    // Debounce the suggestion fetch
    this.suggestionDebounceTimer = setTimeout(() => {
      this.fetchSuggestions(input);
    }, 150);
    
    // Only show inline completion if not deleting
    if (!this.isDeleting) {
      this.showInlineCompletion(input);
    }
    this.isDeleting = false;
  },

  /**
   * Fetch suggestions from various sources
   * @param {string} query - Search query
   */
  async fetchSuggestions(query) {
    if (!query || query.length < 2) {
      this.hideSuggestions();
      return;
    }
    
    // Get history suggestions
    const historySuggestions = this.getHistorySuggestions(query);
    
    // Get search suggestions from Google
    let searchSuggestions = [];
    try {
      const response = await fetch(
        `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`
      );
      const data = await response.json();
      if (data && data[1]) {
        searchSuggestions = data[1].slice(0, 5).map(s => ({
          type: 'search',
          text: s,
          url: `https://www.google.com/search?q=${encodeURIComponent(s)}`
        }));
      }
    } catch (e) {
      // Ignore search suggestion errors
    }
    
    // Combine and dedupe suggestions
    this.suggestions = [...historySuggestions, ...searchSuggestions].slice(0, 8);
    this.selectedSuggestionIndex = -1;
    this.renderSuggestions();
  },

  /**
   * Get suggestions from history
   * @param {string} query - Search query
   * @returns {Array} History suggestions
   */
  getHistorySuggestions(query) {
    const lowerQuery = query.toLowerCase();
    const seen = new Set();
    const results = [];
    
    // Search history in reverse (newest first)
    for (let i = this.browsingHistory.length - 1; i >= 0 && results.length < 5; i--) {
      const item = this.browsingHistory[i];
      const url = item.url.toLowerCase();
      const title = (item.title || '').toLowerCase();
      
      if ((url.includes(lowerQuery) || title.includes(lowerQuery)) && !seen.has(url)) {
        seen.add(url);
        // Get favicon from item or cache
        let favicon = item.favicon;
        if (!favicon && this.getCachedFavicon) {
          favicon = this.getCachedFavicon(item.url);
        }
        results.push({
          type: 'history',
          text: item.title || item.url,
          url: item.url,
          favicon: favicon
        });
      }
    }
    
    return results;
  },

  /**
   * Show inline completion from history
   * @param {string} originalInput - User's input
   */
  showInlineCompletion(originalInput) {
    if (!originalInput) return;
    
    this.lastUserInput = originalInput;
    
    // Find a matching URL from history
    const suggestion = this.findUrlSuggestion(originalInput);
    
    if (suggestion) {
      // Show the full URL with the typed part selected
      const fullUrl = suggestion.url.replace(/^https?:\/\//, '').replace(/^www\./, '');
      const inputLower = originalInput.toLowerCase();
      const fullLower = fullUrl.toLowerCase();
      
      if (fullLower.startsWith(inputLower)) {
        // Set full value and select the completion part
        this.urlInput.value = fullUrl;
        this.urlInput.setSelectionRange(originalInput.length, fullUrl.length);
      }
    }
  },

  /**
   * Render suggestions dropdown
   */
  renderSuggestions() {
    if (!this.suggestions.length) {
      this.hideSuggestions();
      return;
    }
    
    let html = '';
    
    this.suggestions.forEach((s, i) => {
      const isSelected = i === this.selectedSuggestionIndex;
      
      // Left icon: favicon for history items only
      const leftIconHtml = s.type === 'history' 
        ? `<img class="suggestion-icon" src="${escapeHtml(s.favicon || 'shiira-asset://ui-icons/globe.svg')}" 
               onerror="this.src='shiira-asset://ui-icons/globe.svg'">`
        : '';
      
      // Right icon: type indicator (Google or History)
      const isHistory = s.type === 'history';
      const rightIcon = isHistory 
        ? 'shiira-asset://ui-icons/history.svg'
        : 'shiira-asset://site-logos/Google.svg';
      const iconClass = isHistory ? 'history' : 'google';
      
      html += `
        <div class="url-suggestion ${isSelected ? 'selected' : ''}" data-index="${i}">
          ${leftIconHtml}
          <div class="suggestion-content">
            <span class="suggestion-text">${escapeHtml(s.text)}</span>
            ${isHistory ? `<span class="suggestion-url">${escapeHtml(s.url)}</span>` : ''}
          </div>
          <img class="suggestion-type-icon ${iconClass}" src="${rightIcon}" alt="">
        </div>`;
    });
    
    this.urlSuggestions.innerHTML = html;
    this.urlSuggestions.classList.remove('hidden');
    
    // Add click handlers
    this.urlSuggestions.querySelectorAll('.url-suggestion').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.dataset.index);
        const suggestion = this.suggestions[index];
        if (suggestion) {
          this.urlInput.value = suggestion.url;
          this.hideSuggestions();
          this.navigate(suggestion.url);
        }
      });
    });
  },

  /**
   * Select next suggestion
   */
  selectNextSuggestion() {
    if (this.suggestions.length === 0) return;
    this.selectedSuggestionIndex = Math.min(
      this.selectedSuggestionIndex + 1, 
      this.suggestions.length - 1
    );
    this.updateSuggestionSelection();
  },

  /**
   * Select previous suggestion
   */
  selectPrevSuggestion() {
    if (this.suggestions.length === 0) return;
    this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, -1);
    this.updateSuggestionSelection();
  },

  /**
   * Update visual selection of suggestions
   */
  updateSuggestionSelection() {
    const items = this.urlSuggestions.querySelectorAll('.url-suggestion');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedSuggestionIndex);
    });
    
    // Update URL input with selected suggestion
    if (this.selectedSuggestionIndex >= 0) {
      const selected = this.suggestions[this.selectedSuggestionIndex];
      if (selected) {
        this.urlInput.value = selected.url;
      }
    } else {
      this.urlInput.value = this.lastUserInput;
    }
  },

  /**
   * Hide suggestions dropdown
   */
  hideSuggestions() {
    this.urlSuggestions.classList.add('hidden');
    this.suggestions = [];
    this.selectedSuggestionIndex = -1;
  },

  /**
   * Find a URL suggestion for inline completion
   * @param {string} input - User's input
   * @returns {object|null} Matching history item
   */
  findUrlSuggestion(input) {
    const lowerInput = input.toLowerCase();
    
    // Search history for matching URLs
    for (let i = this.browsingHistory.length - 1; i >= 0; i--) {
      const item = this.browsingHistory[i];
      const url = item.url.replace(/^https?:\/\//, '').replace(/^www\./, '');
      
      if (url.toLowerCase().startsWith(lowerInput)) {
        return { ...item, url };
      }
    }
    
    return null;
  }
};

export default UrlSuggestionsMixin;
