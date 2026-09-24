// Shiira Browser - Themes Module
// The wheel and harmony choices follow Zenium's theme picker, adapted to Shiira's CSS tokens.

const DEFAULT_CUSTOM_THEME = {
  colors: [{ x: 0.28, y: 0.2 }, { x: 0.75, y: 0.66 }],
  algorithm: 'floating',
  opacity: 60,
  texture: 0,
  monochrome: false,
  rotation: 135
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function wheelColor({ x, y }) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const radius = clamp(Math.hypot(dx, dy) * 2, 0, 1);
  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;
  return `hsl(${Math.round(hue)} ${Math.round(radius * 100)}% ${Math.round(75 - radius * 25)}%)`;
}

function colorRgb(color) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.fillStyle = wheelColor(color);
  const hex = context.fillStyle;
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}

function rgbCss(rgb) { return `rgb(${rgb.join(', ')})`; }

function mixRgb(first, second, amount) {
  return first.map((channel, index) => Math.round(channel * (1 - amount) + second[index] * amount));
}

function derivedColors(theme) {
  const colors = theme.colors;
  if (theme.algorithm === 'floating' || colors.length < 2) return colors;
  const offsets = {
    complementary: [180, 180], analogous: [30, -30],
    splitComplementary: [150, -150], triadic: [120, -120]
  }[theme.algorithm] || [0, 0];
  const primary = colors[0];
  const dx = primary.x - 0.5;
  const dy = primary.y - 0.5;
  return [primary, ...colors.slice(1).map((_, index) => {
    const angle = offsets[index] * Math.PI / 180;
    return {
      x: 0.5 + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: 0.5 + dx * Math.sin(angle) + dy * Math.cos(angle)
    };
  })];
}

function displayRgb(theme) {
  const colors = derivedColors(theme).map(colorRgb);
  if (!theme.monochrome) return colors;
  return colors.map((color, index) => index === 0 ? color :
    mixRgb(colors[0], index % 2 ? [255, 255, 255] : [0, 0, 0], 0.22));
}

function validCustomTheme(value) {
  if (!value || !Array.isArray(value.colors) || value.colors.length < 1 || value.colors.length > 3 ||
      !value.colors.every(color => Number.isFinite(color.x) && Number.isFinite(color.y) &&
        color.x >= 0 && color.x <= 1 && color.y >= 0 && color.y <= 1)) return false;
  return ['floating', 'complementary', 'analogous', 'splitComplementary', 'triadic'].includes(value.algorithm) &&
    Number.isFinite(value.opacity) && value.opacity >= 15 && value.opacity <= 100 &&
    Number.isFinite(value.texture) && value.texture >= 0 && value.texture <= 100 &&
    typeof value.monochrome === 'boolean' &&
    Number.isFinite(value.rotation) && value.rotation >= 0 && value.rotation <= 360;
}

/**
 * Themes Mixin
 * Provides theme management and customization
 */
export const ThemesMixin = {
  /**
   * Initialize themes system
   */
  initThemes() {
    // Theme modal elements
    this.themesModal = document.getElementById('themes-modal');
    this.btnCloseThemesModal = document.getElementById('btn-close-themes-modal');
    this.themeWheel = document.getElementById('theme-color-wheel');
    this.themeAlgorithm = document.getElementById('theme-algorithm');
    this.themeOpacity = document.getElementById('theme-opacity');
    this.themeTexture = document.getElementById('theme-texture');
    this.themeMonochrome = document.getElementById('theme-monochrome');
    this.themeRotation = document.getElementById('theme-rotation');
    try {
      const saved = JSON.parse(localStorage.getItem('shiira-custom-theme'));
      this.customTheme = validCustomTheme(saved) ? saved : structuredClone(DEFAULT_CUSTOM_THEME);
    } catch {
      this.customTheme = structuredClone(DEFAULT_CUSTOM_THEME);
    }
    
    // Load saved theme
    this.currentTheme = localStorage.getItem('shiira-theme') || 'shiira-night';
    this.applyTheme(this.currentTheme);
    
    // Bind events
    if (this.btnCloseThemesModal) {
      this.btnCloseThemesModal.addEventListener('click', () => this.hideThemesModal());
    }
    
    // Close on click outside
    if (this.themesModal) {
      this.themesModal.addEventListener('click', (e) => {
        if (e.target === this.themesModal) {
          this.hideThemesModal();
        }
      });
    }
    
    // Theme selection handlers
    document.querySelectorAll('.theme-option').forEach(option => {
      option.addEventListener('click', () => {
        const theme = option.dataset.theme;
        this.selectTheme(theme);
      });
    });
    this.initCustomThemeControls();
    this.updateThemeSelection();
    
    console.log('[Themes] Initialized with theme:', this.currentTheme);
  },

  /**
   * Show themes modal
   */
  showThemesModal() {
    if (this.themesModal) {
      this.themesModal.classList.remove('hidden');
      this.updateThemeSelection();
    }
  },

  /**
   * Hide themes modal
   */
  hideThemesModal() {
    if (this.themesModal) {
      this.themesModal.classList.add('hidden');
    }
  },

  /**
   * Update theme selection UI
   */
  updateThemeSelection() {
    document.querySelectorAll('.theme-option').forEach(option => {
      if (option.dataset.theme === this.currentTheme) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
    this.themeWheel?.classList.toggle('selected', this.currentTheme === 'custom');
  },

  /**
   * Select and apply a theme
   */
  selectTheme(themeName) {
    if (themeName !== 'custom' && !document.querySelector(`.theme-option[data-theme="${themeName}"]`)) return;
    this.currentTheme = themeName;
    this.applyTheme(themeName);
    localStorage.setItem('shiira-theme', themeName);
    this.updateThemeSelection();
  },

  /**
   * Apply theme to the browser
   */
  applyTheme(themeName) {
    const root = document.documentElement;
    root.classList.toggle('custom-theme-active', themeName === 'custom');
    if (themeName === 'custom') {
      this.applyCustomTheme();
      return;
    }
    
    switch (themeName) {
      case 'shiira-night':
        root.style.setProperty('--bg-primary', '#020308');
        root.style.setProperty('--bg-secondary', '#080a16');
        root.style.setProperty('--bg-tertiary', '#11152a');
        root.style.setProperty('--accent', '#28d7ef');
        root.style.setProperty('--accent-hover', '#b85cff');
        root.style.setProperty('--accent-pink', '#ff4d9f');
        root.style.setProperty('--accent-rgb', '40, 215, 239');
        root.style.setProperty('--accent-hover-rgb', '184, 92, 255');
        root.style.setProperty('--accent-pink-rgb', '255, 77, 159');
        root.style.setProperty('--text-primary', '#f2fbff');
        root.style.setProperty('--text-secondary', '#9fb4c1');
        root.style.setProperty('--border', '#19243b');
        root.style.setProperty('--success', '#64f4ba');
        root.style.setProperty('--warning', '#ff4d9f');
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(95%) sepia(11%) saturate(1185%) hue-rotate(171deg) brightness(103%) contrast(105%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(73%) sepia(14%) saturate(578%) hue-rotate(158deg) brightness(93%) contrast(88%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(36%) sepia(17%) saturate(684%) hue-rotate(165deg) brightness(88%) contrast(88%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(76%) sepia(71%) saturate(2137%) hue-rotate(149deg) brightness(99%) contrast(91%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(54%) sepia(72%) saturate(3858%) hue-rotate(236deg) brightness(102%) contrast(101%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(80%) sepia(44%) saturate(628%) hue-rotate(91deg) brightness(99%) contrast(94%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        root.style.setProperty('--glow-color-base', 'rgba(40, 215, 239, 0.42)');
        root.style.setProperty('--glow-color-mid', 'rgba(184, 92, 255, 0.28)');
        root.style.setProperty('--glow-color-far', 'rgba(255, 77, 159, 0.18)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(40, 215, 239, 0.56)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(184, 92, 255, 0.38)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(255, 77, 159, 0.28)');
        root.style.setProperty('--particle-r', '40');
        root.style.setProperty('--particle-g-min', '190');
        root.style.setProperty('--particle-g-max', '230');
        root.style.setProperty('--particle-b-min', '220');
        root.style.setProperty('--particle-b-max', '255');
        root.style.setProperty('--focus-glow', 'rgba(40, 215, 239, 0.22)');
        break;

      case 'shiira-classic-dark':
        // Shiira Classic Dark theme
        root.style.setProperty('--bg-primary', '#161616');
        root.style.setProperty('--bg-secondary', '#1e1e1e');
        root.style.setProperty('--bg-tertiary', '#2a2a2a');
        root.style.setProperty('--accent', '#ff961E');
        root.style.setProperty('--accent-hover', '#ff961E');
        root.style.setProperty('--accent-pink', '#ff4d9f');
        root.style.setProperty('--accent-rgb', '255, 150, 30');
        root.style.setProperty('--accent-hover-rgb', '255, 150, 30');
        root.style.setProperty('--accent-pink-rgb', '255, 77, 159');
        root.style.setProperty('--text-primary', '#eaeaea');
        root.style.setProperty('--text-secondary', '#888888');
        root.style.setProperty('--border', '#333333');
        root.style.setProperty('--success', '#4ade80');
        root.style.setProperty('--warning', '#fbbf24');
        // Icon filters for dark theme (cream/orange colors)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(95%) sepia(10%) saturate(800%) hue-rotate(333deg) brightness(103%) contrast(101%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(55%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(35%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(64%) sepia(53%) saturate(3098%) hue-rotate(335deg) brightness(102%) contrast(101%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(78%) sepia(53%) saturate(1057%) hue-rotate(344deg) brightness(103%) contrast(97%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects
        root.style.setProperty('--glow-color-base', 'rgba(255, 150, 30, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(255, 150, 30, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(255, 150, 30, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(255, 179, 71, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(255, 179, 71, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(255, 179, 71, 0.15)');
        // Particle colors - orange embers
        root.style.setProperty('--particle-r', '255');
        root.style.setProperty('--particle-g-min', '150');
        root.style.setProperty('--particle-g-max', '200');
        root.style.setProperty('--particle-b-min', '30');
        root.style.setProperty('--particle-b-max', '100');
        break;
      
      case 'shiira-pearl':
        // Shiira Pearl: black glass with pearl text and warm Shiira amber.
        root.style.setProperty('--bg-primary', '#000000');
        root.style.setProperty('--bg-secondary', '#050505');
        root.style.setProperty('--bg-tertiary', '#101010');
        root.style.setProperty('--accent', '#ff961E');
        root.style.setProperty('--accent-hover', '#ffb347');
        root.style.setProperty('--accent-rgb', '255, 150, 30');
        root.style.setProperty('--accent-hover-rgb', '255, 179, 71');
        root.style.setProperty('--accent-pink-rgb', '255, 77, 159');
        root.style.setProperty('--text-primary', '#f5f2ea');
        root.style.setProperty('--text-secondary', '#a7a098');
        root.style.setProperty('--border', '#24211d');
        root.style.setProperty('--success', '#22c55e');
        root.style.setProperty('--warning', '#f59e0b');
        // Icon filters for black pearl theme (pearl/amber colors)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(95%) sepia(9%) saturate(475%) hue-rotate(344deg) brightness(102%) contrast(94%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(65%) sepia(7%) saturate(474%) hue-rotate(348deg) brightness(96%) contrast(86%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(35%) sepia(7%) saturate(474%) hue-rotate(348deg) brightness(88%) contrast(86%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(64%) sepia(53%) saturate(3098%) hue-rotate(335deg) brightness(102%) contrast(101%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(78%) sepia(53%) saturate(1057%) hue-rotate(344deg) brightness(103%) contrast(97%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects
        root.style.setProperty('--glow-color-base', 'rgba(255, 150, 30, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(255, 150, 30, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(255, 150, 30, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(255, 179, 71, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(255, 179, 71, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(255, 179, 71, 0.15)');
        // Particle colors - orange embers
        root.style.setProperty('--particle-r', '255');
        root.style.setProperty('--particle-g-min', '150');
        root.style.setProperty('--particle-g-max', '200');
        root.style.setProperty('--particle-b-min', '30');
        root.style.setProperty('--particle-b-max', '100');
        // Focus glow color
        root.style.setProperty('--focus-glow', 'rgba(255, 150, 30, 0.2)');
        break;
      
      case 'abyssal-red':
        // Abyssal Red theme - dark with deep red accent
        root.style.setProperty('--bg-primary', '#0f0f0f');
        root.style.setProperty('--bg-secondary', '#151515');
        root.style.setProperty('--bg-tertiary', '#1f1f1f');
        root.style.setProperty('--accent', '#CC0000');
        root.style.setProperty('--accent-hover', '#CC0000');
        root.style.setProperty('--accent-pink', '#ff3232');
        root.style.setProperty('--accent-rgb', '204, 0, 0');
        root.style.setProperty('--accent-hover-rgb', '204, 0, 0');
        root.style.setProperty('--accent-pink-rgb', '255, 50, 50');
        root.style.setProperty('--text-primary', '#eaeaea');
        root.style.setProperty('--text-secondary', '#888888');
        root.style.setProperty('--border', '#2a2a2a');
        root.style.setProperty('--success', '#4ade80');
        root.style.setProperty('--warning', '#fbbf24');
        // Icon filters for Abyssal Red theme (cream text, deep red accent)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(95%) sepia(10%) saturate(800%) hue-rotate(333deg) brightness(103%) contrast(101%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(55%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(35%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(14%) sepia(97%) saturate(7471%) hue-rotate(0deg) brightness(94%) contrast(117%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(23%) sepia(95%) saturate(6589%) hue-rotate(358deg) brightness(91%) contrast(119%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects - deep red
        root.style.setProperty('--glow-color-base', 'rgba(204, 0, 0, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(204, 0, 0, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(204, 0, 0, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(255, 50, 50, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(255, 50, 50, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(255, 50, 50, 0.15)');
        // Particle colors - red embers
        root.style.setProperty('--particle-r', '204');
        root.style.setProperty('--particle-g-min', '0');
        root.style.setProperty('--particle-g-max', '30');
        root.style.setProperty('--particle-b-min', '0');
        root.style.setProperty('--particle-b-max', '20');
        // Focus glow color
        root.style.setProperty('--focus-glow', 'rgba(204, 0, 0, 0.2)');
        break;
      
      case 'steelheart':
        // Steelheart theme - black/dark grey with blue steel accent
        root.style.setProperty('--bg-primary', '#0a0a0a');
        root.style.setProperty('--bg-secondary', '#141414');
        root.style.setProperty('--bg-tertiary', '#1a1a1a');
        root.style.setProperty('--accent', '#4A7C9D');
        root.style.setProperty('--accent-hover', '#4A7C9D');
        root.style.setProperty('--accent-pink', '#64a0c8');
        root.style.setProperty('--accent-rgb', '74, 124, 157');
        root.style.setProperty('--accent-hover-rgb', '74, 124, 157');
        root.style.setProperty('--accent-pink-rgb', '100, 160, 200');
        root.style.setProperty('--text-primary', '#c0c0c0');
        root.style.setProperty('--text-secondary', '#808080');
        root.style.setProperty('--border', '#2a2a2a');
        root.style.setProperty('--success', '#4ade80');
        root.style.setProperty('--warning', '#fbbf24');
        // Icon filters for Steelheart theme (silver text, blue steel accent)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(75%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(100%) contrast(90%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(100%) contrast(90%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(35%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(95%) contrast(85%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(49%) sepia(18%) saturate(1028%) hue-rotate(161deg) brightness(92%) contrast(91%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(59%) sepia(28%) saturate(858%) hue-rotate(161deg) brightness(95%) contrast(93%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects - blue steel
        root.style.setProperty('--glow-color-base', 'rgba(74, 124, 157, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(74, 124, 157, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(74, 124, 157, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(100, 160, 200, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(100, 160, 200, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(100, 160, 200, 0.15)');
        // Particle colors - blue steel embers
        root.style.setProperty('--particle-r', '74');
        root.style.setProperty('--particle-g-min', '124');
        root.style.setProperty('--particle-g-max', '160');
        root.style.setProperty('--particle-b-min', '157');
        root.style.setProperty('--particle-b-max', '200');
        // Focus glow color
        root.style.setProperty('--focus-glow', 'rgba(74, 124, 157, 0.2)');
        break;
      
      case 'rustveil':
        // Rustveil theme - black/deep rust with muted copper accent
        root.style.setProperty('--bg-primary', '#0a0a0a');
        root.style.setProperty('--bg-secondary', '#1a0f0d');
        root.style.setProperty('--bg-tertiary', '#2a1915');
        root.style.setProperty('--accent', '#A67C52');
        root.style.setProperty('--accent-hover', '#A67C52');
        root.style.setProperty('--accent-pink', '#c89664');
        root.style.setProperty('--accent-rgb', '166, 124, 82');
        root.style.setProperty('--accent-hover-rgb', '166, 124, 82');
        root.style.setProperty('--accent-pink-rgb', '200, 150, 100');
        root.style.setProperty('--text-primary', '#D4BFA8');
        root.style.setProperty('--text-secondary', '#8a7866');
        root.style.setProperty('--border', '#2d1f1a');
        root.style.setProperty('--success', '#4ade80');
        root.style.setProperty('--warning', '#fbbf24');
        // Icon filters for Rustveil theme (warm beige text, muted copper accent)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(82%) sepia(12%) saturate(507%) hue-rotate(343deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(52%) sepia(10%) saturate(507%) hue-rotate(343deg) brightness(92%) contrast(88%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(35%) sepia(10%) saturate(400%) hue-rotate(343deg) brightness(90%) contrast(85%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(56%) sepia(27%) saturate(569%) hue-rotate(350deg) brightness(92%) contrast(88%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(66%) sepia(37%) saturate(669%) hue-rotate(350deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects - muted copper
        root.style.setProperty('--glow-color-base', 'rgba(166, 124, 82, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(166, 124, 82, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(166, 124, 82, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(200, 150, 100, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(200, 150, 100, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(200, 150, 100, 0.15)');
        // Particle colors - rust/copper embers
        root.style.setProperty('--particle-r', '166');
        root.style.setProperty('--particle-g-min', '100');
        root.style.setProperty('--particle-g-max', '140');
        root.style.setProperty('--particle-b-min', '70');
        root.style.setProperty('--particle-b-max', '100');
        // Focus glow color
        root.style.setProperty('--focus-glow', 'rgba(166, 124, 82, 0.2)');
        break;
      
      case 'sakura-shadow':
        // Sakura Shadow theme - slightly lighter dark theme with cotton candy pink accent
        root.style.setProperty('--bg-primary', '#1a1a1a');
        root.style.setProperty('--bg-secondary', '#222222');
        root.style.setProperty('--bg-tertiary', '#2c2c2c');
        root.style.setProperty('--accent', '#FF87F4');
        root.style.setProperty('--accent-hover', '#FF87F4');
        root.style.setProperty('--accent-pink', '#ff54f0');
        root.style.setProperty('--accent-rgb', '255, 135, 244');
        root.style.setProperty('--accent-hover-rgb', '255, 135, 244');
        root.style.setProperty('--accent-pink-rgb', '255, 84, 240');
        root.style.setProperty('--text-primary', '#eaeaea');
        root.style.setProperty('--text-secondary', '#888888');
        root.style.setProperty('--border', '#333333');
        root.style.setProperty('--success', '#4ade80');
        root.style.setProperty('--warning', '#fbbf24');
        // Icon filters for Sakura Shadow theme (darker pink icons)
        root.style.setProperty('--icon-filter-primary', 'brightness(0) saturate(100%) invert(56%) sepia(99%) saturate(6456%) hue-rotate(286deg) brightness(101%) contrast(100%)');
        root.style.setProperty('--icon-filter-secondary', 'brightness(0) saturate(100%) invert(46%) sepia(89%) saturate(5456%) hue-rotate(286deg) brightness(99%) contrast(98%)');
        root.style.setProperty('--icon-filter-disabled', 'brightness(0) saturate(100%) invert(36%) sepia(79%) saturate(4456%) hue-rotate(286deg) brightness(97%) contrast(96%)');
        root.style.setProperty('--icon-filter-accent', 'brightness(0) saturate(100%) invert(56%) sepia(99%) saturate(6456%) hue-rotate(286deg) brightness(101%) contrast(100%)');
        root.style.setProperty('--icon-filter-accent-hover', 'brightness(0) saturate(100%) invert(66%) sepia(99%) saturate(5456%) hue-rotate(286deg) brightness(103%) contrast(102%)');
        root.style.setProperty('--icon-filter-success', 'brightness(0) saturate(100%) invert(60%) sepia(80%) saturate(500%) hue-rotate(85deg) brightness(95%) contrast(90%)');
        root.style.setProperty('--logo-filter-accent', 'none');
        // Glow colors for text effects - cotton candy pink
        root.style.setProperty('--glow-color-base', 'rgba(255, 135, 244, 0.3)');
        root.style.setProperty('--glow-color-mid', 'rgba(255, 135, 244, 0.2)');
        root.style.setProperty('--glow-color-far', 'rgba(255, 135, 244, 0.1)');
        root.style.setProperty('--glow-color-hover-base', 'rgba(255, 160, 248, 0.4)');
        root.style.setProperty('--glow-color-hover-mid', 'rgba(255, 160, 248, 0.25)');
        root.style.setProperty('--glow-color-hover-far', 'rgba(255, 160, 248, 0.15)');
        // Particle colors - pink embers
        root.style.setProperty('--particle-r', '255');
        root.style.setProperty('--particle-g-min', '100');
        root.style.setProperty('--particle-g-max', '160');
        root.style.setProperty('--particle-b-min', '220');
        root.style.setProperty('--particle-b-max', '250');
        // Focus glow color
        root.style.setProperty('--focus-glow', 'rgba(255, 135, 244, 0.2)');
        break;
      
      // Future themes will be added here
      
      default:
        console.warn('[Themes] Unknown theme:', themeName);
    }
  },

  initCustomThemeControls() {
    if (!this.themeWheel) return;
    this.themeAlgorithm.value = this.customTheme.algorithm;
    this.themeOpacity.value = this.customTheme.opacity;
    this.themeTexture.value = this.customTheme.texture;
    this.themeMonochrome.checked = this.customTheme.monochrome;
    this.themeRotation.value = this.customTheme.rotation;
    this.themeAlgorithm.addEventListener('change', () => this.updateCustomTheme({ algorithm: this.themeAlgorithm.value }));
    this.themeOpacity.addEventListener('input', () => this.updateCustomTheme({ opacity: Number(this.themeOpacity.value) }));
    this.themeTexture.addEventListener('input', () => this.updateCustomTheme({ texture: Number(this.themeTexture.value) }));
    this.themeMonochrome.addEventListener('change', () => this.updateCustomTheme({ monochrome: this.themeMonochrome.checked }));
    this.themeRotation.addEventListener('input', () => this.updateCustomTheme({ rotation: Number(this.themeRotation.value) }));
    document.getElementById('theme-add-color')?.addEventListener('click', () => {
      if (this.customTheme.colors.length >= 3) return;
      const count = this.customTheme.colors.length;
      this.updateCustomTheme({ colors: [...this.customTheme.colors, { x: 0.72, y: count === 1 ? 0.34 : 0.72 }] });
    });
    document.getElementById('theme-remove-color')?.addEventListener('click', () => {
      if (this.customTheme.colors.length <= 1) return;
      this.updateCustomTheme({ colors: this.customTheme.colors.slice(0, -1) });
    });
    this.themeWheel.addEventListener('pointerdown', event => {
      if (event.target !== this.themeWheel || this.customTheme.colors.length >= 3) return;
      this.updateCustomTheme({ colors: [...this.customTheme.colors, this.wheelPosition(event)] });
    });
    this.renderCustomTheme();
  },

  wheelPosition(event) {
    const rect = this.themeWheel.getBoundingClientRect();
    let dx = (event.clientX - rect.left) / rect.width - 0.5;
    let dy = (event.clientY - rect.top) / rect.height - 0.5;
    const radius = Math.hypot(dx, dy);
    if (radius > 0.5) { dx *= 0.5 / radius; dy *= 0.5 / radius; }
    return { x: dx + 0.5, y: dy + 0.5 };
  },

  updateCustomTheme(patch) {
    this.customTheme = { ...this.customTheme, ...patch };
    localStorage.setItem('shiira-custom-theme', JSON.stringify(this.customTheme));
    this.renderCustomTheme();
    this.selectTheme('custom');
  },

  renderCustomTheme() {
    if (!this.themeWheel) return;
    const colors = derivedColors(this.customTheme);
    const rgbColors = displayRgb(this.customTheme);
    this.themeWheel.replaceChildren();
    colors.forEach((color, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `theme-wheel-dot${index === 0 ? ' primary' : ''}${index > 0 && this.customTheme.algorithm !== 'floating' ? ' derived' : ''}`;
      dot.style.left = `${color.x * 100}%`;
      dot.style.top = `${color.y * 100}%`;
      dot.style.background = rgbCss(rgbColors[index]);
      dot.title = index === 0 ? 'Drag primary color' : this.customTheme.algorithm === 'floating' ? 'Drag color' : 'Color set by harmony';
      dot.setAttribute('aria-label', dot.title);
      if (index === 0 || this.customTheme.algorithm === 'floating') {
        dot.addEventListener('pointerdown', event => {
          event.preventDefault();
          event.stopPropagation();
          const pointerId = event.pointerId;
          const move = moveEvent => {
            if (moveEvent.pointerId !== pointerId) return;
            const next = [...this.customTheme.colors];
            next[index] = this.wheelPosition(moveEvent);
            this.updateCustomTheme({ colors: next });
          };
          const stop = endEvent => {
            if (endEvent.pointerId !== pointerId) return;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', stop);
          window.addEventListener('pointercancel', stop);
        });
        dot.addEventListener('keydown', event => {
          const delta = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }[event.key];
          if (!delta) return;
          event.preventDefault();
          const next = [...this.customTheme.colors];
          next[index] = { x: clamp(next[index].x + delta[0], 0, 1), y: clamp(next[index].y + delta[1], 0, 1) };
          this.updateCustomTheme({ colors: next });
          this.themeWheel.children[index]?.focus();
        });
      }
      this.themeWheel.appendChild(dot);
    });
    const preview = document.getElementById('custom-theme-preview');
    if (preview) preview.style.background = this.customThemeBackground();
    document.getElementById('theme-opacity-value').textContent = `${this.customTheme.opacity}%`;
    document.getElementById('theme-texture-value').textContent = `${this.customTheme.texture}%`;
    document.getElementById('theme-rotation-value').textContent = `${this.customTheme.rotation}°`;
    document.getElementById('theme-add-color').disabled = colors.length >= 3;
    document.getElementById('theme-remove-color').disabled = colors.length <= 1;
  },

  customThemeBackground() {
    const colors = displayRgb(this.customTheme).map(color => {
      const base = [8, 10, 22];
      return rgbCss(mixRgb(base, mixRgb(color, [0, 0, 0], 0.55), this.customTheme.opacity / 100));
    });
    const gradient = colors.length === 1 ? colors[0] : `linear-gradient(${this.customTheme.rotation}deg, ${colors.join(', ')})`;
    const texture = this.customTheme.texture / 100 * 0.07;
    return texture === 0 ? gradient :
      `repeating-linear-gradient(135deg, rgba(255,255,255,${texture}) 0 1px, transparent 1px 4px), ${gradient}`;
  },

  applyCustomTheme() {
    if (!this.customTheme) return;
    const root = document.documentElement;
    const primary = colorRgb(derivedColors(this.customTheme)[0]);
    const hover = mixRgb(primary, [255, 255, 255], 0.2);
    const background = mixRgb([8, 10, 22], mixRgb(primary, [0, 0, 0], 0.65), this.customTheme.opacity / 100);
    root.style.setProperty('--bg-primary', rgbCss(mixRgb(background, [0, 0, 0], 0.65)));
    root.style.setProperty('--bg-secondary', rgbCss(mixRgb(background, [0, 0, 0], 0.35)));
    root.style.setProperty('--bg-tertiary', rgbCss(mixRgb(background, [255, 255, 255], 0.09)));
    root.style.setProperty('--text-primary', '#f2fbff');
    root.style.setProperty('--text-secondary', '#aebdc8');
    root.style.setProperty('--border', rgbCss(mixRgb(background, [180, 190, 210], 0.18)));
    root.style.setProperty('--accent', rgbCss(primary));
    root.style.setProperty('--accent-hover', rgbCss(hover));
    root.style.setProperty('--accent-pink', rgbCss(hover));
    root.style.setProperty('--accent-rgb', primary.join(', '));
    root.style.setProperty('--accent-hover-rgb', hover.join(', '));
    root.style.setProperty('--accent-pink-rgb', hover.join(', '));
    root.style.setProperty('--focus-glow', `rgba(${primary.join(', ')}, 0.22)`);
    root.style.setProperty('--custom-theme-background', this.customThemeBackground());
    root.style.setProperty('--glow-color-base', `rgba(${primary.join(', ')}, 0.35)`);
    root.style.setProperty('--glow-color-mid', `rgba(${hover.join(', ')}, 0.24)`);
    root.style.setProperty('--glow-color-far', `rgba(${primary.join(', ')}, 0.12)`);
  }
};

export default ThemesMixin;
