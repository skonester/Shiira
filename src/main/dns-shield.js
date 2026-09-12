// Adapted from Silver Browser (github.com/nichin-labs/silver) by Hitroo Labs — Apache License 2.0.
// See THIRD_PARTY_NOTICES/silver-browser-APACHE-2.0.txt. Ghost AI agent not included.
//
// Shiira Shield - Encrypted DNS (DNS-over-HTTPS) + tracking-header stripping.

const { app } = require('electron');

// Cloudflare DoH endpoints
const DOH_SERVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://1.1.1.1/dns-query',
  'https://1.0.0.1/dns-query'
];

class DnsShield {
  constructor() {
    this.enabled = false;
    this.currentIp = '';
    this.currentLocation = '';
  }

  enable() {
    this.enabled = true;

    // DNS-over-HTTPS via Cloudflare.
    // 'automatic' = try DoH first, fall back to system DNS for CDN/deep links.
    app.configureHostResolver({
      secureDnsMode: 'automatic',
      secureDnsServers: DOH_SERVERS
    });

    this.refreshStatus().catch(() => {});
    console.log('[Shield] Enabled - DNS-over-HTTPS via Cloudflare 1.1.1.1');
  }

  disable() {
    this.enabled = false;
    app.configureHostResolver({
      secureDnsMode: 'off',
      secureDnsServers: []
    });
    console.log('[Shield] Disabled');
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Strip known tracking headers and trim cross-origin referrers.
   * Called from installBrowserHeaderOverrides' onBeforeSendHeaders callback.
   */
  getPrivacyHeaders(details, headers) {
    if (!this.enabled) return headers;

    delete headers['x-client-data'];
    delete headers['X-Client-Data'];
    delete headers['x-chrome-uma-enabled'];
    delete headers['x-chrome-variations'];

    if (details.referrer && details.url) {
      try {
        const refOrigin = new URL(details.referrer).origin;
        const reqOrigin = new URL(details.url).origin;
        if (refOrigin !== reqOrigin) {
          headers['Referer'] = reqOrigin + '/';
        }
      } catch (e) {
        // Malformed referrer/url - leave headers untouched
      }
    }

    return headers;
  }

  async refreshStatus() {
    try {
      const resp = await fetch('https://1.1.1.1/cdn-cgi/trace');
      const text = await resp.text();
      for (const line of text.split('\n')) {
        if (line.startsWith('ip=')) this.currentIp = line.slice(3);
        if (line.startsWith('loc=')) this.currentLocation = line.slice(4);
      }
    } catch (e) {
      // Network unavailable - keep last known status
    }
  }

  async getStatus() {
    await this.refreshStatus();

    let latency = 0;
    try {
      const start = Date.now();
      await fetch('https://1.1.1.1/cdn-cgi/trace', { method: 'HEAD' });
      latency = Date.now() - start;
    } catch (e) {
      // Network unavailable
    }

    return {
      enabled: this.enabled,
      dohEnabled: this.enabled,
      ip: this.currentIp,
      location: this.currentLocation,
      latency
    };
  }
}

module.exports = DnsShield;
