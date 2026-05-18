// Shiira Browser - AI Assistant Module
// Handles AI provider toolbar and webview panel

import { escapeHtml } from './utils.js';

/**
 * AI Assistant Mixin
 * Adds AI provider functionality to ShiiraBrowser
 */
export const AIAssistantMixin = {
  /**
   * Initialize AI providers
   */
  async initAIProviders() {
    try {
      const providersObj = await window.shiiraAPI.ai.getProviders();
      // Convert object to array with id property
      this.aiProviders = Object.entries(providersObj).map(([id, p]) => ({
        id,
        name: p.name,
        icon: `shiira-asset://ui-icons/${p.icon}.svg`,
        url: p.url,
        enabled: p.enabled
      }));
      this.renderAIToolbarButtons();
    } catch (e) {
      console.error('Failed to load AI providers:', e);
      this.aiProviders = [];
    }
  },

  /**
   * Render AI provider buttons in toolbar
   */
  renderAIToolbarButtons() {
    if (!this.aiButtons || !this.aiProviders) return;
    
    // Get currently shown provider IDs
    const currentIds = new Set(
      Array.from(this.aiButtons.querySelectorAll('.ai-agent-btn:not(.hiding)')).map(b => b.dataset.providerId)
    );
    const enabledProviders = this.aiProviders.filter(p => p.enabled);
    const newIds = new Set(enabledProviders.map(p => p.id));
    
    // Remove buttons for disabled providers with animation
    this.aiButtons.querySelectorAll('.ai-agent-btn').forEach(btn => {
      if (!newIds.has(btn.dataset.providerId) && !btn.classList.contains('hiding')) {
        btn.classList.add('hiding');
        btn.addEventListener('animationend', () => btn.remove(), { once: true });
      }
    });
    
    // Add buttons for newly enabled providers
    enabledProviders.forEach(provider => {
      if (!currentIds.has(provider.id)) {
        const btn = document.createElement('button');
        btn.className = 'ai-agent-btn showing';
        btn.dataset.providerId = provider.id;
        btn.title = provider.name;
        btn.innerHTML = `<img src="${escapeHtml(provider.icon)}" alt="${escapeHtml(provider.name)}">`;
        
        btn.addEventListener('click', () => {
          this.openAIWebview(provider.id, provider.name, provider.url);
        });
        
        // Remove showing class after animation completes
        btn.addEventListener('animationend', () => btn.classList.remove('showing'), { once: true });
        
        this.aiButtons.appendChild(btn);
      }
    });
  },

  /**
   * Show AI settings panel
   */
  showAISettingsPanel() {
    this.aiSettingsPanel.classList.remove('hidden');
    this.renderAISettingsPanel();
  },

  /**
   * Hide AI settings panel
   */
  hideAISettingsPanel() {
    this.aiSettingsPanel.classList.add('hidden');
  },

  /**
   * Render AI settings panel content
   */
  async renderAISettingsPanel() {
    if (!this.aiProviders) {
      await this.initAIProviders();
    }
    
    let html = '<div class="ai-provider-list">';
    
    this.aiProviders.forEach(provider => {
      html += `
        <div class="ai-provider-item">
          <img src="${escapeHtml(provider.icon)}" alt="${escapeHtml(provider.name)}" class="ai-provider-icon">
          <div class="ai-provider-info">
            <div class="ai-provider-name">${escapeHtml(provider.name)}</div>
          </div>
          <span class="ai-provider-toggle${provider.enabled ? ' active' : ''}" data-provider-id="${provider.id}"></span>
        </div>`;
    });
    
    html += '</div>';
    
    this.aiSettingsContent.innerHTML = html;
    
    // Add toggle handlers (click event for span-based toggles)
    this.aiSettingsContent.querySelectorAll('.ai-provider-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleAIProviderToggle(toggle);
      });
    });
  },

  /**
   * Handle AI provider toggle
   * @param {HTMLElement} toggle - The toggle element
   */
  async handleAIProviderToggle(toggle) {
    const providerId = toggle.dataset.providerId;
    const isActive = toggle.classList.contains('active');
    const enabled = !isActive; // Toggle the state
    
    // Update UI immediately
    if (enabled) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
    
    // Save to backend
    await window.shiiraAPI.ai.toggleProvider(providerId, enabled);
    
    // Update local state
    const provider = this.aiProviders.find(p => p.id === providerId);
    if (provider) {
      provider.enabled = enabled;
    }
    
    // Refresh toolbar buttons with animation
    this.renderAIToolbarButtons();
  },

  /**
   * Open AI webview panel
   * @param {string} providerId - Provider ID
   * @param {string} providerName - Provider name
   * @param {string} url - Provider URL
   */
  openAIWebview(providerId, providerName, url) {
    this.currentAIProvider = providerId;
    
    // Update header
    this.aiWebviewName.textContent = providerName;
    
    // Find provider for icon
    const provider = this.aiProviders.find(p => p.id === providerId);
    if (provider && this.aiWebviewIcon) {
      // Security: Use DOM methods instead of innerHTML
      this.aiWebviewIcon.innerHTML = ''; // Clear existing
      const img = document.createElement('img');
      img.src = provider.icon; // Provider data comes from config file
      img.alt = '';
      img.style.width = '20px';
      img.style.height = '20px';
      img.style.borderRadius = '4px';
      img.style.filter = 'brightness(0) saturate(100%) invert(97%) sepia(6%) saturate(671%) hue-rotate(333deg) brightness(103%) contrast(92%)';
      this.aiWebviewIcon.appendChild(img);
    }
    
    // Create or reuse webview
    if (!this.aiWebview) {
      this.aiWebview = document.createElement('webview');
      this.aiWebview.setAttribute('allowpopups', '');
      this.aiWebview.setAttribute('partition', 'persist:ai');
      this.aiWebview.className = 'ai-webview';
      this.aiWebviewContainer.appendChild(this.aiWebview);
    }
    
    this.aiWebview.src = url;
    
    // Show panel with animation
    this.aiWebviewPanel.classList.remove('hidden');
    document.body.classList.add('ai-panel-open');
    
    // Trigger animation after a frame
    requestAnimationFrame(() => {
      this.aiWebviewPanel.classList.add('visible');
    });
  },

  /**
   * Hide AI webview panel
   */
  hideAIWebviewPanel() {
    this.aiWebviewPanel.classList.remove('visible');
    document.body.classList.remove('ai-panel-open');
    
    // Wait for animation to complete before hiding
    setTimeout(() => {
      if (!this.aiWebviewPanel.classList.contains('visible')) {
        this.aiWebviewPanel.classList.add('hidden');
      }
    }, 300);
    
    this.currentAIProvider = null;
  },

  /**
   * Initialize AI panel resize functionality
   */
  initAIPanelResize() {
    const resizeHandle = document.getElementById('ai-panel-resize');
    if (!resizeHandle) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let overlay = null;
    
    const minWidth = 300;
    const maxWidth = window.innerWidth * 0.6; // Max 60% of window
    
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = this.aiWebviewPanel.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      
      // Create overlay to prevent webview from capturing mouse events
      overlay = document.createElement('div');
      overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99999; cursor: ew-resize;';
      document.body.appendChild(overlay);
      
      // Disable transitions during resize
      this.aiWebviewPanel.style.transition = 'none';
      document.getElementById('navbar').style.transition = 'none';
      document.getElementById('browser-content').style.transition = 'none';
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const deltaX = startX - e.clientX;
      let newWidth = startWidth + deltaX;
      
      // Clamp width
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      // Update CSS variable
      document.documentElement.style.setProperty('--ai-panel-width', `${newWidth}px`);
    });
    
    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      
      isResizing = false;
      resizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // Remove overlay
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      
      // Re-enable transitions
      this.aiWebviewPanel.style.transition = '';
      document.getElementById('navbar').style.transition = '';
      document.getElementById('browser-content').style.transition = '';
    });
  }
};

export default AIAssistantMixin;
