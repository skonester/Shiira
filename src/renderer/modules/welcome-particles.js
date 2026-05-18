// Welcome Page Particle Effect Module
// Performant ember-like particle animation for the home page

export const WelcomeParticlesMixin = {
  initWelcomeParticles() {
    // Initialize particles for welcome page
    this.particleCanvas = document.getElementById('particle-canvas');
    if (this.particleCanvas) {
      this.particleCtx = this.particleCanvas.getContext('2d', { alpha: true });
      this.particles = [];
      this.particleAnimationId = null;
      
      this.resizeParticleCanvas();
      window.addEventListener('resize', () => this.resizeParticleCanvas());
      
      this.initParticles();
      this.animateParticles();
    }
  },

  resizeParticleCanvas() {
    if (!this.particleCanvas) return;
    const welcomePage = document.getElementById('welcome-page');
    if (!welcomePage) return;
    
    this.particleCanvas.width = welcomePage.offsetWidth;
    this.particleCanvas.height = welcomePage.offsetHeight;
  },

  resizeBlankParticleCanvas() {
    if (!this.blankParticleCanvas) return;
    const blankTabBg = document.getElementById('blank-tab-background');
    if (!blankTabBg) return;
    
    this.blankParticleCanvas.width = blankTabBg.offsetWidth;
    this.blankParticleCanvas.height = blankTabBg.offsetHeight;
  },

  initParticles() {
    const particleCount = 60; // Keep count low for performance
    const width = this.particleCanvas.width;
    const height = this.particleCanvas.height;
    
    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 1, // Very small: 1-3px
        speedX: Math.random() * 0.15 + 0.05, // Slower horizontal movement: 0.05-0.2
        speedY: -0.15 + (Math.random() - 0.5) * 0.01, // Gentle upward drift with very subtle randomness
        opacity: Math.random() * 0.4 + 0.2, // Subtle: 0.2-0.6
        wobble: Math.random() * Math.PI * 2, // Random starting phase for wobble
        wobbleSpeed: Math.random() * 0.02 + 0.01, // Slow wobble
        colorVariation: Math.random() // 0-1 for color interpolation
      });
    }
  },

  animateParticles() {
    if (!this.particleCanvas || !this.particleCtx) return;
    
    const ctx = this.particleCtx;
    const width = this.particleCanvas.width;
    const height = this.particleCanvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Update and draw particles
    this.particles.forEach(particle => {
      // Add very subtle wobble to movement
      const wobbleOffset = Math.sin(particle.wobble) * 0.03;
      
      // Update position
      particle.x += particle.speedX;
      particle.y += particle.speedY + wobbleOffset;
      particle.wobble += particle.wobbleSpeed;
      
      // Reset particle when it moves off screen (right or top)
      if (particle.x > width) {
        particle.x = -5;
        particle.y = Math.random() * height;
      }
      
      // Reset particle when it moves off top (floating up)
      if (particle.y < -5) {
        particle.y = height + 5;
        particle.x = Math.random() * width;
      }
      
      // Wrap bottom (shouldn't happen often with upward drift)
      if (particle.y > height + 5) particle.y = -5;
      
      // Draw particle as a glowing ember with color variation
      // Get colors from CSS variables (theme-aware)
      const rootStyle = getComputedStyle(document.documentElement);
      const r = parseInt(rootStyle.getPropertyValue('--particle-r')) || 255;
      const gMin = parseInt(rootStyle.getPropertyValue('--particle-g-min')) || 150;
      const gMax = parseInt(rootStyle.getPropertyValue('--particle-g-max')) || 200;
      const bMin = parseInt(rootStyle.getPropertyValue('--particle-b-min')) || 30;
      const bMax = parseInt(rootStyle.getPropertyValue('--particle-b-max')) || 100;
      
      const g = Math.round(gMin + ((gMax - gMin) * particle.colorVariation));
      const b = Math.round(bMin + ((bMax - bMin) * particle.colorVariation));
      
      const gradient = ctx.createRadialGradient(
        particle.x, particle.y, 0,
        particle.x, particle.y, particle.size
      );
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${particle.opacity})`);
      gradient.addColorStop(0.5, `rgba(${r}, ${Math.round(g * 0.8)}, ${Math.round(b * 0.67)}, ${particle.opacity * 0.5})`);
      gradient.addColorStop(1, `rgba(${r}, ${Math.round(g * 0.67)}, ${Math.round(b * 0.33)}, 0)`);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Continue animation
    this.particleAnimationId = requestAnimationFrame(() => this.animateParticles());
  },

  stopParticleAnimation() {
    if (this.particleAnimationId) {
      cancelAnimationFrame(this.particleAnimationId);
      this.particleAnimationId = null;
    }
  }
};
