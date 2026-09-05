// Renderer helpers for MVP Sprites and Map Previews

/**
 * Generate a procedural RO minimap SVG with tile grid, terrain contours, and spawn location marker pin
 */
export function renderMapSvg(mapId, mapName, coordinates = "150, 150", isModal = false) {
  // Parse coordinates
  let [xStr, yStr] = coordinates.split(',').map(s => s.trim());
  let posX = parseInt(xStr, 10) || 150;
  let posY = parseInt(yStr, 10) || 150;

  // Normalize map size (default 300x300 tiles in RO)
  let normX = Math.min(Math.max((posX / 300) * 100, 10), 90);
  let normY = Math.min(Math.max(100 - (posY / 300) * 100, 10), 90);

  // Map theme colors based on map prefix
  let theme = {
    bg: "#1a1625",
    land: "#2a2238",
    accent: "#4c3869",
    grid: "rgba(255,255,255,0.08)",
    water: "#0f2042"
  };

  if (mapId.startsWith("thor") || mapId.startsWith("mag_")) {
    theme = { bg: "#2a0808", land: "#4a1212", accent: "#7f1d1d", grid: "rgba(239,68,68,0.15)", water: "#ef4444" };
  } else if (mapId.startsWith("prt_sew") || mapId.startsWith("anthell")) {
    theme = { bg: "#192210", land: "#2b3b1c", accent: "#425e2a", grid: "rgba(132,204,22,0.15)", water: "#3f6212" };
  } else if (mapId.startsWith("xmas") || mapId.startsWith("ice_")) {
    theme = { bg: "#082f49", land: "#0c4a6e", accent: "#0284c7", grid: "rgba(56,189,248,0.15)", water: "#38bdf8" };
  } else if (mapId.startsWith("gef_") || mapId.startsWith("gl_")) {
    theme = { bg: "#1e1b4b", land: "#312e81", accent: "#4338ca", grid: "rgba(129,140,248,0.15)", water: "#6366f1" };
  } else if (mapId.startsWith("moc_") || mapId.startsWith("in_")) {
    theme = { bg: "#451a03", land: "#78350f", accent: "#b45309", grid: "rgba(245,158,11,0.15)", water: "#f59e0b" };
  } else if (mapId.startsWith("tur_") || mapId.startsWith("pay_")) {
    theme = { bg: "#064e3b", land: "#047857", accent: "#059669", grid: "rgba(16,185,129,0.15)", water: "#10b981" };
  }

  const svgWidth = isModal ? 500 : 200;
  const svgHeight = isModal ? 500 : 200;

  return `
    <svg viewBox="0 0 100 100" width="100%" height="100%" class="rounded-lg shadow-inner overflow-hidden select-none">
      <rect width="100" height="100" fill="${theme.bg}" />
      
      <!-- Terrain shapes -->
      <path d="M 5,20 Q 30,5 50,25 T 95,40 L 90,90 Q 60,95 20,80 Z" fill="${theme.land}" opacity="0.9" />
      <path d="M 25,35 Q 45,20 65,40 T 80,75 L 30,85 Z" fill="${theme.accent}" opacity="0.6" />

      <!-- Map Grid Lines -->
      <defs>
        <pattern id="grid-${mapId}-${isModal ? 'm' : 'c'}" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="${theme.grid}" stroke-width="0.5"/>
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#grid-${mapId}-${isModal ? 'm' : 'c'})" />

      <!-- Map Border Accent -->
      <rect x="1" y="1" width="98" height="98" fill="none" stroke="rgba(245, 158, 11, 0.4)" stroke-width="1" rx="2" />

      <!-- Map Water / Hazard Pool -->
      <circle cx="20" cy="75" r="8" fill="${theme.water}" opacity="0.5" />
      <circle cx="80" cy="25" r="10" fill="${theme.water}" opacity="0.5" />

      <!-- Spawn Pin Marker -->
      <g transform="translate(${normX}, ${normY})">
        <!-- Pulse ring -->
        <circle r="6" fill="#ef4444" opacity="0.4">
          <animate attributeName="r" values="3;9;3" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.8;0.1;0.8" dur="2s" repeatCount="indefinite"/>
        </circle>
        
        <!-- Pin core -->
        <circle r="3" fill="#ef4444" stroke="#ffffff" stroke-width="1" />
        
        <!-- Coordinate Flag -->
        <g transform="translate(4, -8)">
          <rect x="0" y="0" width="22" height="9" rx="2" fill="rgba(0,0,0,0.85)" stroke="#f59e0b" stroke-width="0.5" />
          <text x="11" y="6.5" font-size="5" font-weight="bold" fill="#fbbf24" text-anchor="middle" font-family="monospace">${posX},${posY}</text>
        </g>
      </g>

      <!-- Map Code Label in corner -->
      <rect x="3" y="87" width="38" height="10" rx="2" fill="rgba(0,0,0,0.75)" />
      <text x="5" y="94" font-size="5" font-weight="bold" fill="#f3f4f6" font-family="monospace">${mapId}</text>
    </svg>
  `;
}

/**
 * Generate visual pixel-art styled emblem/sprite for MVP
 */
export function renderMvpAvatar(mvp) {
  const bg = mvp.cardBg || "#1e293b";
  const accent = mvp.accentColor || "#f59e0b";
  const icon = mvp.icon || "👑";

  // Check if the icon string is a file path (starts with / or ends with image extensions)
  const isImagePath = icon.startsWith('/') || icon.startsWith('http') || /\.(gif|png|jpg|jpeg|webp|svg)$/i.test(icon);

  // Render an <img> tag if it's an image path, otherwise render as text/emoji inside <span>
  const iconContent = isImagePath
    ? `<img src="${icon}" alt="${mvp.name}" class="w-12 h-12 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] transform group-hover:scale-110 transition-transform duration-300 select-none pointer-events-none" />`
    : `<span class="text-3xl sm:text-4xl drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] transform group-hover:scale-110 transition-transform duration-300 select-none">${icon}</span>`;

  return `
    <div class="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl flex items-center justify-center shadow-lg border border-amber-500/30 overflow-hidden group shrink-0" style="background: radial-gradient(circle at center, ${accent}33 0%, ${bg} 100%);">
      <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none"></div>
      
      <!-- Crown Badge for MVP -->
      <div class="absolute top-1 left-1 text-[10px] bg-amber-500/80 text-black font-black px-1 rounded shadow z-10">
        MVP
      </div>

      <!-- Level Badge -->
      <div class="absolute bottom-1 right-1 text-[9px] bg-black/80 text-amber-300 font-mono px-1 rounded border border-amber-500/30 z-10">
        Lv.${mvp.level}
      </div>

      <!-- Boss Image or Emoji -->
      ${iconContent}
    </div>
  `;
}
