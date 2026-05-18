/**
 * Shiira Browser - Installer Image Generator
 * Creates dark-themed BMP images for the NSIS installer
 * 
 * Sidebar: 164x314 pixels
 * Header: 150x57 pixels (optional, for header banner)
 */

const { Jimp, JimpMime } = require('jimp');
const path = require('path');
const fs = require('fs');

// Shiira Night theme colors (as 0xRRGGBBAA)
function rgbaToInt(r, g, b, a = 255) {
    // Ensure values are clamped to valid range
    r = Math.max(0, Math.min(255, Math.floor(r)));
    g = Math.max(0, Math.min(255, Math.floor(g)));
    b = Math.max(0, Math.min(255, Math.floor(b)));
    a = Math.max(0, Math.min(255, Math.floor(a)));
    // Return as unsigned 32-bit integer
    return (r * 16777216) + (g * 65536) + (b * 256) + a;
}

function intToRgba(int) {
    return {
        r: Math.floor(int / 16777216) % 256,
        g: Math.floor(int / 65536) % 256,
        b: Math.floor(int / 256) % 256,
        a: int % 256
    };
}

async function createSidebarImage() {
    // NSIS sidebar dimensions: 164x314
    const width = 164;
    const height = 314;
    
    // Create new image with dark background
    const image = new Jimp({ width, height, color: 0x020308FF });
    
    // Create vertical gradient effect
    for (let y = 0; y < height; y++) {
        const ratio = y / height;
        // Gradient from top to bottom (slightly darker at bottom)
        const r = Math.floor(0x08 * (1 - ratio * 0.65));
        const g = Math.floor(0x0A * (1 - ratio * 0.55));
        const b = Math.floor(0x16 * (1 - ratio * 0.35));
        const color = rgbaToInt(r, g, b, 255);
        
        for (let x = 0; x < width; x++) {
            image.setPixelColor(color, x, y);
        }
    }
    
    // Add accent stripe on the left edge (Shiira cyan)
    const stripeWidth = 4;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < stripeWidth; x++) {
            // Gradient the stripe from bright at top to dim at bottom
            const ratio = y / height;
            const r = Math.floor(0x28 * (1 - ratio * 0.25));
            const g = Math.floor(0xD7 * (1 - ratio * 0.25));
            const b = Math.floor(0xEF * (1 - ratio * 0.25));
            image.setPixelColor(rgbaToInt(r, g, b, 255), x, y);
        }
    }
    
    // Add subtle diagonal pattern
    for (let y = 0; y < height; y++) {
        for (let x = stripeWidth; x < width; x++) {
            // Every 40 pixels, add a subtle lighter line
            if ((x + y) % 40 < 1) {
                const current = intToRgba(image.getPixelColor(x, y));
                const lighter = rgbaToInt(
                    Math.min(255, current.r + 8),
                    Math.min(255, current.g + 8),
                    Math.min(255, current.b + 8),
                    255
                );
                image.setPixelColor(lighter, x, y);
            }
        }
    }
    
    // Add glow effect in top section (where logo would be)
    const glowStartY = 40;
    const glowHeight = 60;
    const glowCenterX = width / 2 + stripeWidth / 2;
    
    for (let y = glowStartY; y < glowStartY + glowHeight; y++) {
        for (let x = stripeWidth + 10; x < width - 10; x++) {
            const distFromCenter = Math.abs(x - glowCenterX) / (width / 2);
            const distFromMiddleY = Math.abs(y - (glowStartY + glowHeight / 2)) / (glowHeight / 2);
            const dist = Math.sqrt(distFromCenter * distFromCenter + distFromMiddleY * distFromMiddleY);
            
            if (dist < 1) {
                const intensity = (1 - dist) * 0.15; // Subtle glow
                const current = intToRgba(image.getPixelColor(x, y));
                const glowed = rgbaToInt(
                    Math.min(255, current.r + Math.floor(0x28 * intensity)),
                    Math.min(255, current.g + Math.floor(0xD7 * intensity * 0.7)),
                    Math.min(255, current.b + Math.floor(0xEF * intensity * 0.8)),
                    255
                );
                image.setPixelColor(glowed, x, y);
            }
        }
    }
    
    // Add glow-like particles scattered through the dark sidebar
    const particles = [
        { x: 30, y: 120 }, { x: 80, y: 150 }, { x: 50, y: 200 },
        { x: 120, y: 180 }, { x: 45, y: 250 }, { x: 100, y: 270 },
        { x: 70, y: 100 }, { x: 130, y: 220 }, { x: 25, y: 280 },
    ];
    
    for (const p of particles) {
        // Small glowing dot
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= 2) {
                    const px = p.x + dx;
                    const py = p.y + dy;
                    if (px >= 0 && px < width && py >= 0 && py < height) {
                        const intensity = (1 - dist / 2) * 0.6;
                        const current = intToRgba(image.getPixelColor(px, py));
                        const blended = rgbaToInt(
                            Math.min(255, current.r + Math.floor(0xFF * intensity * 0.45)),
                            Math.min(255, current.g + Math.floor(0x4D * intensity * 0.35)),
                            Math.min(255, current.b + Math.floor(0x9F * intensity * 0.5)),
                            255
                        );
                        image.setPixelColor(blended, px, py);
                    }
                }
            }
        }
    }
    
    // Add bottom vignette
    const brandingY = height - 50;
    for (let y = brandingY; y < height; y++) {
        const ratio = (y - brandingY) / 50;
        for (let x = stripeWidth; x < width; x++) {
            const current = intToRgba(image.getPixelColor(x, y));
            const darker = rgbaToInt(
                Math.max(0, current.r - Math.floor(10 * ratio)),
                Math.max(0, current.g - Math.floor(10 * ratio)),
                Math.max(0, current.b - Math.floor(10 * ratio)),
                255
            );
            image.setPixelColor(darker, x, y);
        }
    }
    
    const outputPath = path.join(__dirname, 'installer', 'installer-sidebar.bmp');
    await image.write(outputPath);
    console.log(`✓ Created sidebar image: ${outputPath}`);
}

async function createHeaderImage() {
    // NSIS header dimensions: 150x57
    const width = 150;
    const height = 57;
    
    const image = new Jimp({ width, height, color: 0x020308FF });
    
    // Create horizontal gradient
    for (let x = 0; x < width; x++) {
        const ratio = x / width;
        for (let y = 0; y < height; y++) {
            // Gradient from left (darker) to right (slightly lighter with cyan tint)
            const r = Math.floor(0x02 + (0x11 - 0x02) * ratio);
            const g = Math.floor(0x03 + (0x15 - 0x03) * ratio);
            const b = Math.floor(0x08 + (0x2A - 0x08) * ratio);
            image.setPixelColor(rgbaToInt(r, g, b, 255), x, y);
        }
    }
    
    // Add accent line at bottom
    for (let x = 0; x < width; x++) {
        const ratio = x / width;
        const intensity = 0.3 + ratio * 0.7; // Fade in from left to right
        const r = Math.floor(0x28 * intensity);
        const g = Math.floor(0xD7 * intensity);
        const b = Math.floor(0xEF * intensity);
        image.setPixelColor(rgbaToInt(r, g, b, 255), x, height - 1);
        image.setPixelColor(rgbaToInt(r, g, b, 255), x, height - 2);
    }
    
    const outputPath = path.join(__dirname, 'installer', 'installer-header.bmp');
    await image.write(outputPath);
    console.log(`✓ Created header image: ${outputPath}`);
}

async function main() {
    console.log('Generating Shiira Browser installer images...\n');
    
    try {
        await createSidebarImage();
        await createHeaderImage();
        console.log('\n✓ All installer images generated successfully!');
    } catch (error) {
        console.error('Error generating images:', error);
        process.exit(1);
    }
}

main();
