import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <!-- Background gradient -->
    <radialGradient id="bgGrad" cx="35%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#3D0070"/>
      <stop offset="55%" stop-color="#1A0038"/>
      <stop offset="100%" stop-color="#0D001F"/>
    </radialGradient>

    <!-- Ambient glow behind emblem -->
    <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#9B30E8" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#9B30E8" stop-opacity="0"/>
    </radialGradient>

    <!-- Emblem background -->
    <radialGradient id="emblemBg" cx="45%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#7B22C0"/>
      <stop offset="50%" stop-color="#510D8A"/>
      <stop offset="100%" stop-color="#2A0050"/>
    </radialGradient>

    <!-- Emblem ring -->
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C050E8"/>
      <stop offset="100%" stop-color="#8B20C0"/>
    </linearGradient>

    <!-- Wave gradient -->
    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#E060FF" stop-opacity="0.7"/>
      <stop offset="40%" stop-color="#FF80FF"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="60%" stop-color="#FF80FF"/>
      <stop offset="100%" stop-color="#E060FF" stop-opacity="0.7"/>
    </linearGradient>

    <!-- Title gradient -->
    <linearGradient id="titleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#E080FF"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#C050E8"/>
    </linearGradient>

    <!-- Subtle dot grid pattern -->
    <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1" fill="#8B20C0" opacity="0.25"/>
    </pattern>

    <!-- Wave glow filter -->
    <filter id="waveGlow" x="-40%" y="-120%" width="180%" height="340%">
      <feGaussianBlur stdDeviation="5" result="blur1"/>
      <feGaussianBlur stdDeviation="10" result="blur2"/>
      <feMerge>
        <feMergeNode in="blur2"/>
        <feMergeNode in="blur1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Trace glow filter -->
    <filter id="traceGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Outer glow filter for emblem -->
    <filter id="emblowGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Text glow -->
    <filter id="textGlow" x="-10%" y="-50%" width="120%" height="200%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>

  <!-- Dot grid overlay -->
  <rect width="1200" height="630" fill="url(#dots)"/>

  <!-- Left-side ambient glow -->
  <ellipse cx="300" cy="315" rx="320" ry="260" fill="url(#glowGrad)" opacity="0.5"/>

  <!-- Subtle top-right highlight -->
  <ellipse cx="950" cy="120" rx="200" ry="160" fill="#6010A0" opacity="0.15"/>

  <!-- Decorative horizontal line -->
  <line x1="60" y1="540" x2="1140" y2="540" stroke="#8B20C0" stroke-width="0.8" opacity="0.3"/>
  <line x1="60" y1="90" x2="1140" y2="90" stroke="#8B20C0" stroke-width="0.8" opacity="0.3"/>

  <!-- Corner accent dots -->
  <circle cx="60" cy="90" r="3" fill="#C050E8" opacity="0.5"/>
  <circle cx="1140" cy="90" r="3" fill="#C050E8" opacity="0.5"/>
  <circle cx="60" cy="540" r="3" fill="#C050E8" opacity="0.5"/>
  <circle cx="1140" cy="540" r="3" fill="#C050E8" opacity="0.5"/>

  <!-- ===== EMBLEM (centered-left, scaled ~8x from 48→384) ===== -->
  <!-- Scale factor: 384/48 = 8, center at x=300, y=315 -->
  <!-- Emblem origin offset: cx=300-192=108, cy=315-192=123 -->
  <g transform="translate(108, 123) scale(8)">
    <!-- Circle background -->
    <circle cx="24" cy="24" r="22" fill="url(#emblemBg)" filter="url(#emblowGlow)"/>

    <!-- Outer ring -->
    <circle cx="24" cy="24" r="20" stroke="url(#ringGrad)" stroke-width="0.8" fill="none" opacity="0.6"/>

    <!-- Circuit traces on the left -->
    <g filter="url(#traceGlow)" stroke="#C050E8" stroke-width="0.9" fill="none" opacity="0.9">
      <line x1="15.5" y1="24" x2="10" y2="24"/>
      <circle cx="10" cy="24" r="1.2" fill="#C050E8" stroke="none"/>
      <polyline points="10,24 10,17 6,17"/>
      <circle cx="6" cy="17" r="1.6" fill="none" stroke="#C050E8" stroke-width="0.9"/>
      <circle cx="6" cy="17" r="0.6" fill="#D870FF" stroke="none"/>
      <polyline points="10,20.5 7.5,20.5 7.5,17"/>
      <circle cx="10" cy="20.5" r="0.9" fill="#C050E8" stroke="none"/>
      <polyline points="10,24 10,31 6,31"/>
      <circle cx="6" cy="31" r="1.6" fill="none" stroke="#C050E8" stroke-width="0.9"/>
      <circle cx="6" cy="31" r="0.6" fill="#D870FF" stroke="none"/>
      <polyline points="10,27.5 7.5,27.5 7.5,31"/>
      <circle cx="10" cy="27.5" r="0.9" fill="#C050E8" stroke="none"/>
    </g>

    <!-- ECG waveform -->
    <g filter="url(#waveGlow)">
      <polyline
        points="15.5,24 19,24 21.3,13 23.6,34.5 25.9,22.5 27.5,26 29,24 34,24"
        stroke="url(#waveGrad)"
        stroke-width="1.4"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>

    <!-- Bright spike core -->
    <g opacity="0.55">
      <polyline
        points="20.5,17 21.3,13 23.6,34.5 25,24"
        stroke="#FFFFFF"
        stroke-width="0.7"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </g>

  <!-- ===== TEXT (right side) ===== -->
  <!-- "HapticOS" title -->
  <text
    x="660"
    y="290"
    font-family="'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-weight="700"
    font-size="108"
    letter-spacing="-3"
    fill="url(#titleGrad)"
    filter="url(#textGlow)"
    text-anchor="middle"
  >HapticOS</text>

  <!-- Divider line under title -->
  <line x1="480" y1="318" x2="840" y2="318" stroke="url(#ringGrad)" stroke-width="1.5" opacity="0.6"/>

  <!-- Tagline -->
  <text
    x="660"
    y="370"
    font-family="'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-weight="400"
    font-size="32"
    letter-spacing="6"
    fill="#C050E8"
    opacity="0.9"
    text-anchor="middle"
  >SYNC · CONTROL · FEEL</text>

  <!-- Sub-description -->
  <text
    x="660"
    y="430"
    font-family="'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-weight="400"
    font-size="22"
    fill="#9B7AB8"
    opacity="0.8"
    text-anchor="middle"
  >The unified platform for haptic device control</text>

  <!-- Bottom domain label -->
  <text
    x="1140"
    y="565"
    font-family="'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-weight="500"
    font-size="18"
    fill="#8B20C0"
    opacity="0.6"
    text-anchor="end"
  >hapticos.app</text>
</svg>`;

const svgPath = path.join(publicDir, 'og-image.svg');
const pngPath = path.join(publicDir, 'og-image.png');

writeFileSync(svgPath, svg);
console.log('SVG written to', svgPath);

execSync(`convert -background none -density 144 "${svgPath}" -resize 1200x630 "${pngPath}"`, { stdio: 'inherit' });
console.log('PNG generated at', pngPath);

import { unlinkSync } from 'fs';
unlinkSync(svgPath);
console.log('Cleaned up temp SVG');
