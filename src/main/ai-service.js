/**
 * AI Service - Manages AI assistant providers (webview-based)
 */

const path = require('path');
const fs = require('fs');

class AIService {
  constructor(app) {
    this.app = app;
    this.configPath = path.join(app.getPath('userData'), 'ai-config.json');
    this.config = this.loadConfig();
    
    // AI Provider configurations (websites)
    this.providers = {
      chatgpt: {
        name: 'ChatGPT',
        icon: 'gpt',
        url: 'https://chatgpt.com'
      },
      claude: {
        name: 'Claude',
        icon: 'claude',
        url: 'https://claude.ai'
      },
      gemini: {
        name: 'Gemini',
        icon: 'gemini',
        url: 'https://gemini.google.com'
      },
      grok: {
        name: 'Grok',
        icon: 'grok',
        url: 'https://grok.com'
      }
    };
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (e) {
      if (!app.isPackaged) {
        console.error('Failed to load AI config:', e);
      }
    }
    return { enabledProviders: {} };
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      console.error('Failed to save AI config:', e);
    }
  }

  getProviders() {
    const result = {};
    for (const [id, provider] of Object.entries(this.providers)) {
      result[id] = {
        name: provider.name,
        icon: provider.icon,
        url: provider.url,
        enabled: !!this.config.enabledProviders[id]
      };
    }
    return result;
  }

  toggleProvider(providerId, enabled) {
    if (!this.providers[providerId]) {
      return { success: false, error: 'Unknown provider' };
    }
    
    this.config.enabledProviders[providerId] = enabled;
    this.saveConfig();
    
    return { success: true };
  }

  getProviderUrl(providerId) {
    const provider = this.providers[providerId];
    return provider ? provider.url : null;
  }
}

module.exports = AIService;
