// Window Controls Module
// Handles window minimize, maximize, close buttons

export const WindowControlsMixin = {
  setupWindowControls() {
    console.log('[Shiira] Setting up window controls...');
    
    if (this.btnMinimize) {
      this.btnMinimize.addEventListener('click', () => {
        console.log('[Shiira] Minimize clicked');
        window.shiiraAPI.minimize();
      });
    }
    if (this.btnMaximize) {
      this.btnMaximize.addEventListener('click', () => {
        console.log('[Shiira] Maximize clicked');
        window.shiiraAPI.maximize();
      });
    }
    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => {
        console.log('[Shiira] Close clicked');
        window.shiiraAPI.close();
      });
    }
  }
};
