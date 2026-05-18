// Permission Dialog Module
// Handles permission requests with themed UI

export const PermissionDialogMixin = {
  initPermissionDialog() {
    // Listen for permission requests from main process
    window.shiiraAPI.onPermissionRequest((data) => {
      this.showPermissionDialog(data);
    });
    
    console.log('[PermissionDialog] Initialized');
  },

  async showPermissionDialog({ requestId, permission, hostname, url }) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'permission-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      animation: fadeIn 0.2s ease;
    `;
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'permission-dialog';
    dialog.style.cssText = `
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      min-width: 400px;
      max-width: 500px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: slideIn 0.3s ease;
    `;
    
    // Get permission details
    const permissionInfo = await this.getPermissionInfo(permission);
    
    dialog.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px;">
        <div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${permissionInfo.icon}
        </div>
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: 18px; font-weight: 600; font-family: 'Cinzel', serif;">
            ${permissionInfo.title}
          </h3>
          <p style="margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.5;">
            <strong style="color: var(--accent);">${this.escapeHtml(hostname)}</strong> wants to ${permissionInfo.description}
          </p>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; cursor: pointer; user-select: none;">
          <input type="checkbox" id="permission-remember" style="cursor: pointer; accent-color: var(--accent); margin: 0; width: 16px; height: 16px; flex-shrink: 0;">
          <span style="line-height: 16px;">Remember my decision for this site</span>
        </label>
      </div>
      
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="permission-btn permission-deny" style="
          padding: 10px 20px;
          border: 1px solid var(--border-color);
          background: var(--bg-secondary);
          color: var(--text-primary);
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Block
        </button>
        <button class="permission-btn permission-allow" style="
          padding: 10px 20px;
          border: none;
          background: var(--accent);
          color: #ffffff;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        ">
          Allow
        </button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Add hover effects
    const buttons = dialog.querySelectorAll('.permission-btn');
    buttons.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '0.85';
        btn.style.transform = 'translateY(-1px)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '1';
        btn.style.transform = 'translateY(0)';
      });
    });
    
    // Handle responses
    const respond = (granted) => {
      const remember = dialog.querySelector('#permission-remember').checked;
      window.shiiraAPI.sendPermissionResponse(requestId, granted, remember);
      
      // Animate out
      overlay.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => overlay.remove(), 200);
    };
    
    dialog.querySelector('.permission-allow').addEventListener('click', () => respond(true));
    dialog.querySelector('.permission-deny').addEventListener('click', () => respond(false));
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        respond(false);
      }
    });
    
    // Close on Escape
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        respond(false);
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Add CSS animations
    if (!document.getElementById('permission-animations')) {
      const style = document.createElement('style');
      style.id = 'permission-animations';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }
  },

  async getPermissionInfo(permission) {
    // Embedded SVG icons with theme color support
    // Using accent color to match Shiira theme
    const microphoneSvg = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M7.00004 7C7.00004 4.23858 9.23862 2 12 2C14.7615 2 17 4.23858 17 7V11C17 13.7614 14.7615 16 12 16C9.23862 16 7.00004 13.7614 7.00004 11V7ZM12 4C10.3432 4 9.00004 5.34315 9.00004 7V11C9.00004 12.6569 10.3432 14 12 14C13.6569 14 15 12.6569 15 11V7C15 5.34315 13.6569 4 12 4ZM4.49483 14.137C4.97144 13.858 5.58401 14.0182 5.86303 14.4948C7.08977 16.5903 9.37755 18 12 18C14.6225 18 16.9103 16.5903 18.137 14.4948C18.4161 14.0182 19.0286 13.858 19.5053 14.137C19.9819 14.416 20.1421 15.0286 19.863 15.5052C18.4479 17.9225 15.9331 19.6272 13 19.946V22C13 22.5523 12.5523 23 12 23C11.4478 23 11 22.5523 11 22V19.946C8.067 19.6272 5.55218 17.9225 4.13704 15.5052C3.85802 15.0286 4.01821 14.416 4.49483 14.137Z" fill="var(--accent)"/>
      </svg>
    `;
    
    const cameraSvg = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M6.39252 3.83025C7.04361 2.75654 8.20958 2 9.54508 2H14.4549C15.7904 2 16.9564 2.75654 17.6075 3.83025C17.8059 4.15753 18.0281 4.50118 18.257 4.81533C18.3665 4.96564 18.5804 5.08571 18.8771 5.08571H18.9998C21.209 5.08571 23 6.87668 23 9.08571V17C23 19.2091 21.2091 21 19 21H5C2.79086 21 1 19.2091 1 17V9.08572C1 6.87668 2.79052 5.08571 4.99976 5.08571H5.12238C5.41912 5.08571 5.63348 4.96564 5.74301 4.81533C5.97193 4.50118 6.19407 4.15753 6.39252 3.83025ZM9.54508 4C8.98673 4 8.43356 4.32159 8.10267 4.86727C7.88516 5.22596 7.63139 5.61989 7.35939 5.99317C6.81056 6.74635 5.94404 7.08571 5.12286 7.08571H5.00024C3.89578 7.08571 3 7.98104 3 9.08572V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9.08571C21 7.98104 20.1047 7.08571 19.0002 7.08571H18.8776C18.0564 7.08571 17.1894 6.74635 16.6406 5.99317C16.3686 5.61989 16.1148 5.22596 15.8973 4.86727C15.5664 4.32159 15.0133 4 14.4549 4H9.54508ZM12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9ZM7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12Z" fill="var(--accent)"/>
      </svg>
    `;

    // Handle different permission types
    if (permission === 'media') {
      // Media permission includes both camera and microphone
      return {
        icon: `
          <div style="display: flex; gap: 8px; align-items: center;">
            ${cameraSvg}
            ${microphoneSvg}
          </div>
        `,
        title: 'Camera & Microphone Access',
        description: 'use your camera and microphone'
      };
    } else if (permission === 'camera') {
      return {
        icon: cameraSvg,
        title: 'Camera Access',
        description: 'use your camera'
      };
    } else if (permission === 'microphone') {
      return {
        icon: microphoneSvg,
        title: 'Microphone Access',
        description: 'use your microphone'
      };
    } else if (permission === 'geolocation') {
      // For geolocation, we can use a simple icon placeholder or create one
      return {
        icon: '<div style="font-size: 48px; color: var(--icon);">📍</div>',
        title: 'Location Access',
        description: 'access your location'
      };
    }
    
    // Fallback for unknown permissions
    return {
      icon: '<div style="font-size: 48px; color: var(--icon);">🔒</div>',
      title: 'Permission Request',
      description: `access ${permission}`
    };
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};
