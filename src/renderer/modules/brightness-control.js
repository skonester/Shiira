// Brightness Control Module
// Handles brightness slider for webview dimming

export const BrightnessControlMixin = {
  initBrightnessControl() {
    // Brightness setting (single source of truth for all tabs)
    this.currentBrightness = parseInt(localStorage.getItem('webview-brightness') || '100');
    
    // Get the container element
    const brightnessContainer = document.querySelector('.menu-brightness-control');
    
    // Set up brightness slider
    if (this.brightnessSlider) {
      this.brightnessSlider.value = this.currentBrightness;
      this.updateBrightnessSliderFill();
      
      this.brightnessSlider.addEventListener('input', (e) => {
        this.currentBrightness = parseInt(e.target.value);
        this.updateBrightnessSliderFill();
        this.applyBrightness();
        localStorage.setItem('webview-brightness', this.currentBrightness);
      });
      
      // Prevent menu from closing when interacting with slider
      this.brightnessSlider.addEventListener('click', (e) => e.stopPropagation());
      this.brightnessSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    }
    
    // Allow clicking anywhere in the container to control the slider
    if (brightnessContainer && this.brightnessSlider) {
      brightnessContainer.addEventListener('mousedown', (e) => {
        // Don't interfere if clicking directly on the slider thumb
        if (e.target === this.brightnessSlider) return;
        
        e.stopPropagation();
        
        // Calculate the value based on click position relative to the slider
        const sliderRect = this.brightnessSlider.getBoundingClientRect();
        const min = parseInt(this.brightnessSlider.min) || 20;
        const max = parseInt(this.brightnessSlider.max) || 100;
        
        const updateValueFromPosition = (clientX) => {
          const x = Math.max(sliderRect.left, Math.min(clientX, sliderRect.right));
          const percentage = (x - sliderRect.left) / sliderRect.width;
          const newValue = Math.round(min + percentage * (max - min));
          
          this.brightnessSlider.value = newValue;
          this.currentBrightness = newValue;
          this.updateBrightnessSliderFill();
          this.applyBrightness();
          localStorage.setItem('webview-brightness', this.currentBrightness);
        };
        
        // Set initial value from click position
        updateValueFromPosition(e.clientX);
        
        // Handle dragging
        const onMouseMove = (moveEvent) => {
          updateValueFromPosition(moveEvent.clientX);
        };
        
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      
      // Prevent click from closing menu
      brightnessContainer.addEventListener('click', (e) => e.stopPropagation());
    }
  },

  updateBrightnessSliderFill() {
    if (!this.brightnessSlider) return;
    
    const min = parseInt(this.brightnessSlider.min) || 20;
    const max = parseInt(this.brightnessSlider.max) || 100;
    const value = this.currentBrightness;
    const percentage = ((value - min) / (max - min)) * 100;
    
    this.brightnessSlider.style.background = 
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percentage}%, var(--bg-tertiary) ${percentage}%, var(--bg-tertiary) 100%)`;
  },

  applyBrightness() {
    // Apply brightness filter to all webviews and the welcome page using the class property as single source of truth
    const brightness = this.currentBrightness / 100;
    
    // Apply to all webviews
    this.tabs.forEach(tab => {
      if (tab.webview) {
        tab.webview.style.filter = `brightness(${brightness})`;
      }
    });
    
    // Apply to welcome page
    const welcomePage = document.getElementById('welcome-page');
    if (welcomePage) {
      welcomePage.style.filter = `brightness(${brightness})`;
    }
  }
};
