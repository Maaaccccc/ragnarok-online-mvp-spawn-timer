import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Clock, Plus, Search, Filter, Volume2, VolumeX, Bell, BellOff,
  Sun, Moon, Download, Upload, Star, MapPin, RefreshCw, Edit3, Trash2,
  AlertTriangle, Shield, CheckCircle2, ChevronDown, BookOpen, History,
  Flame, Copy, Sparkles, X, Play, RotateCcw, Skull, Calendar, ArrowRight
} from "lucide-react";
import confetti from "canvas-confetti";

import { MVP_DATABASE, ELEMENT_COLORS } from "./data/mvps.js";
import { playSpawnSound, playWarningSound } from "./sound.js";
import { renderMvpAvatar } from "./renderers.js";

// LocalStorage Keys
const LS_TIMERS_KEY = "ro_mvp_timers_v3";
const LS_FAVORITES_KEY = "ro_mvp_favorites_v3";
const LS_HISTORY_KEY = "ro_mvp_history_v3";
const LS_SETTINGS_KEY = "ro_mvp_settings_v3";

/**
 * Utility: Parse exact kill time string (e.g. "13:00", "01:30", "1:30 pm") into kill timestamp
 */
function parseKillTimeToTimestamp(inputStr, referenceTimestamp = Date.now()) {
  if (!inputStr) return null;
  const str = inputStr.trim().toLowerCase();

  let hours = null;
  let minutes = null;
  let seconds = 0;

  const isPm = str.includes("pm");
  const isAm = str.includes("am");
  const cleanStr = str.replace(/(am|pm)/g, "").trim();

  if (cleanStr.includes(":")) {
    const parts = cleanStr.split(":").map(p => parseInt(p, 10));
    if (!isNaN(parts[0]) && !isNaN(parts[1])) {
      hours = parts[0];
      minutes = parts[1];
      if (parts[2] !== undefined && !isNaN(parts[2])) {
        seconds = parts[2];
      }
    }
  } else if (/^\d{1,4}$/.test(cleanStr)) {
    const num = parseInt(cleanStr, 10);
    if (num >= 0 && num < 24) {
      hours = num;
      minutes = 0;
    } else if (cleanStr.length === 3) {
      hours = parseInt(cleanStr[0], 10);
      minutes = parseInt(cleanStr.slice(1), 10);
    } else if (cleanStr.length === 4) {
      hours = parseInt(cleanStr.slice(0, 2), 10);
      minutes = parseInt(cleanStr.slice(2), 10);
    }
  }

  if (hours === null || minutes === null || isNaN(hours) || isNaN(minutes)) {
    return null;
  }

  if (isPm && hours < 12) hours += 12;
  if (isAm && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  const d = new Date(referenceTimestamp);
  d.setHours(hours, minutes, seconds, 0);

  let killTime = d.getTime();

  // Handle midnight roll-over: If kill time is in the future relative to referenceTimestamp by > 2 mins,
  // it means the kill happened yesterday
  if (killTime > referenceTimestamp + 2 * 60 * 1000) {
    killTime -= 24 * 60 * 60 * 1000;
  }

  return killTime;
}

/**
 * Utility: Parse time input (e.g. "42:15", "1:15:00", "42m 15s", "42") into milliseconds
 */
function parseTimeToMs(inputStr, defaultType = 'minutes') {
  if (!inputStr) return null;
  const str = inputStr.trim().toLowerCase();

  // Match MM:SS or HH:MM:SS format
  if (str.includes(":")) {
    const parts = str.split(":").map(p => parseInt(p, 10) || 0);
    if (parts.length === 2) {
      // MM:SS
      return (parts[0] * 60 + parts[1]) * 1000;
    } else if (parts.length === 3) {
      // HH:MM:SS
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
  }

  // Match text formats like "3h 30m" or "3h" or "45m" or "45s" or "3 hrs"
  let totalSeconds = 0;
  const hourMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/);
  const minMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)/);
  const secMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)/);

  if (hourMatch || minMatch || secMatch) {
    if (hourMatch) totalSeconds += parseFloat(hourMatch[1]) * 3600;
    if (minMatch) totalSeconds += parseFloat(minMatch[1]) * 60;
    if (secMatch) totalSeconds += parseFloat(secMatch[1]);
    return Math.floor(totalSeconds * 1000);
  }

  // Pure number handling based on default type ('hours' or 'minutes')
  const num = parseFloat(str);
  if (!isNaN(num)) {
    if (defaultType === 'hours') {
      return Math.floor(num * 3600 * 1000);
    }
    return Math.floor(num * 60 * 1000);
  }

  return null;
}

/**
 * Format milliseconds into HH:MM:SS or MM:SS
 */
function formatMsRemaining(ms) {
  if (ms <= 0) return "SPAWN NOW!";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const pad = (n) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Format timestamp into local clock time (e.g. 14:22:15)
 */
function formatClockTime(timestamp) {
  if (!timestamp) return "--:--:--";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Format minutes into friendly human text (e.g. 240 mins -> "4h 00m", 60 mins -> "1h 00m")
 */
function formatRespawnText(minutes) {
  if (!minutes) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

/**
 * Helper to determine countdown color status
 */
function getTimerColorStatus(ms) {
  if (ms <= 0) {
    return {
      status: "spawned",
      textClass: "text-red-500 font-black animate-pulse",
      ringColor: "#ef4444",
      bgBorder: "border-red-600 bg-red-950/80 spawn-flash-card",
      badgeClass: "bg-red-600 text-white animate-bounce"
    };
  }
  const mins = ms / (1000 * 60);
  if (mins < 5) {
    return {
      status: "critical",
      textClass: "text-red-400 font-bold",
      ringColor: "#ef4444",
      bgBorder: "border-red-500/60 bg-red-950/20",
      badgeClass: "bg-red-500/20 text-red-300 border-red-500/50"
    };
  }
  if (mins < 10) {
    return {
      status: "warning",
      textClass: "text-orange-400 font-bold",
      ringColor: "#f97316",
      bgBorder: "border-orange-500/50 bg-orange-950/20",
      badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/50"
    };
  }
  if (mins < 30) {
    return {
      status: "caution",
      textClass: "text-yellow-400 font-bold",
      ringColor: "#eab308",
      bgBorder: "border-yellow-500/40 bg-yellow-950/10",
      badgeClass: "bg-yellow-500/20 text-yellow-300 border-yellow-500/50"
    };
  }
  return {
    status: "normal",
    textClass: "text-emerald-400 font-bold",
    ringColor: "#10b981",
    bgBorder: "border-amber-500/30 bg-slate-900/60",
    badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
  };
}

// Circular SVG Progress Ring Component
function CountdownRing({ msRemaining, totalDurationMs }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;

  let progress = 0;
  if (totalDurationMs > 0 && msRemaining > 0) {
    progress = Math.min(1, msRemaining / totalDurationMs);
  }

  const strokeDashoffset = circumference - (progress * circumference);
  const status = getTimerColorStatus(msRemaining);

  return (
    <div className="relative flex items-center justify-center shrink-0">
      <svg className="w-24 h-24 transform -rotate-90">
        <circle
          cx="48"
          cy="48"
          r={radius}
          stroke="currentColor"
          strokeWidth="6"
          className="text-slate-800"
          fill="transparent"
        />
        <circle
          cx="48"
          cy="48"
          r={radius}
          stroke={status.ringColor}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-linear"
          fill="transparent"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-1">
        <span className={`text-base sm:text-lg tracking-wider font-mono ${status.textClass}`}>
          {formatMsRemaining(msRemaining)}
        </span>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  // App State
  const [timers, setTimers] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_TIMERS_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_HISTORY_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_SETTINGS_KEY);
      return saved ? JSON.parse(saved) : { soundEnabled: true, volume: 0.8, darkMode: true, browserNotif: false };
    } catch (e) {
      return { soundEnabled: true, volume: 0.8, darkMode: true, browserNotif: false };
    }
  });

  // UI States
  const [now, setNow] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedElement, setSelectedElement] = useState("all");
  const [selectedRace, setSelectedRace] = useState("all");
  const [selectedDuration, setSelectedDuration] = useState("all");
  const [activeTab, setActiveTab] = useState("all"); // 'all', 'active', 'favorites', 'expired'
  const [sortBy, setSortBy] = useState("soonest"); // 'soonest', 'name', 'respawn', 'level'

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingMvp, setEditingMvp] = useState(null); // MVP object for timer modal
  const [initialModalTab, setInitialModalTab] = useState('killed'); // 'killed' or 'mirror'
  const [dbModalOpen, setDbModalOpen] = useState(false);
  const [ioModalOpen, setIoModalOpen] = useState(false);

  // Sound Notification Tracking (prevent repeating sound every second)
  const notifiedSpawnsRef = useRef(new Set());

  // Save State Persistence
  useEffect(() => {
    try {
      localStorage.setItem(LS_TIMERS_KEY, JSON.stringify(timers));
    } catch (e) { console.error(e); }
  }, [timers]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) { console.error(e); }
  }, [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
    } catch (e) { console.error(e); }
  }, [history]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { console.error(e); }
  }, [settings]);

  // Dark/Light Mode Class Effect
  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  }, [settings.darkMode]);

  // Realtime Timer Loop (updates every second)
  useEffect(() => {
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);

      // Check for zero-spawn triggers
      Object.entries(timers).forEach(([mvpId, timerData]) => {
        if (!timerData || !timerData.spawnTimestamp) return;
        const msRemaining = timerData.spawnTimestamp - currentNow;

        if (msRemaining <= 0 && !notifiedSpawnsRef.current.has(mvpId)) {
          notifiedSpawnsRef.current.add(mvpId);

          const mvp = MVP_DATABASE.find(m => m.id === mvpId);
          const mvpName = mvp ? mvp.name : mvpId;

          // Sound Alert
          if (settings.soundEnabled) {
            playSpawnSound(settings.volume);
          }

          // Confetti celebration
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });

          // Browser Notification
          if (settings.browserNotif && "Notification" in window && Notification.permission === "granted") {
            new Notification(`🔥 ${mvpName} SPAWNED NOW!`, {
              body: `Map Location: ${mvp?.map || ''}`,
              icon: '/favicon.ico'
            });
          }

          // Add to Expired History log
          setHistory(prev => [
            {
              id: `${mvpId}-${Date.now()}`,
              mvpId,
              mvpName,
              map: mvp?.map || '',
              spawnedAt: currentNow
            },
            ...prev.slice(0, 24) // Keep last 25 entries
          ]);
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timers, settings]);

  // Handler: Toggle Favorite MVP
  const toggleFavorite = (mvpId) => {
    setFavorites(prev =>
      prev.includes(mvpId) ? prev.filter(id => id !== mvpId) : [...prev, mvpId]
    );
  };

  // Handler: Set/Start Timer for MVP
  const handleStartTimer = (mvpId, remainingMs = null, customTotalDuration = null) => {
    const mvp = MVP_DATABASE.find(m => m.id === mvpId);
    if (!mvp) return;

    const durationMs = remainingMs !== null ? Math.max(0, remainingMs) : mvp.respawnMinutes * 60 * 1000;
    const totalMs = customTotalDuration || mvp.respawnMinutes * 60 * 1000;
    const spawnTimestamp = Date.now() + durationMs;

    setTimers(prev => ({
      ...prev,
      [mvpId]: {
        mvpId,
        spawnTimestamp,
        totalDurationMs: totalMs,
        startedAt: Date.now()
      }
    }));

    // Reset notification lock so sound will play again when it expires
    notifiedSpawnsRef.current.delete(mvpId);
  };

  // Handler: Reset Timer to full respawn duration
  const handleResetTimer = (mvpId) => {
    const mvp = MVP_DATABASE.find(m => m.id === mvpId);
    if (!mvp) return;
    handleStartTimer(mvpId, mvp.respawnMinutes * 60 * 1000);
  };

  // Handler: Delete Timer
  const handleDeleteTimer = (mvpId) => {
    setTimers(prev => {
      const next = { ...prev };
      delete next[mvpId];
      return next;
    });
    notifiedSpawnsRef.current.delete(mvpId);
  };

  // Request Notification Permissions
  const handleToggleNotifPermission = async () => {
    if (!("Notification" in window)) {
      alert("Browser notifications are not supported in this browser.");
      return;
    }

    if (Notification.permission === "granted") {
      setSettings(s => ({ ...s, browserNotif: !s.browserNotif }));
    } else {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setSettings(s => ({ ...s, browserNotif: true }));
      } else {
        alert("Notification permission was denied.");
      }
    }
  };

  // Computed: Active Timers
  const activeTimerList = useMemo(() => {
    return Object.values(timers).map(timer => {
      const mvp = MVP_DATABASE.find(m => m.id === timer.mvpId);
      const msRemaining = timer.spawnTimestamp - now;
      return { ...timer, mvp, msRemaining };
    }).filter(t => t.mvp !== undefined);
  }, [timers, now]);

  // Computed: Soonest MVP to spawn
  const soonestMvp = useMemo(() => {
    if (activeTimerList.length === 0) return null;
    const sorted = [...activeTimerList].sort((a, b) => a.msRemaining - b.msRemaining);
    return sorted[0];
  }, [activeTimerList]);

  // Filtered & Sorted MVPs for Dashboard
  const displayedMvps = useMemo(() => {
    return MVP_DATABASE.filter(mvp => {
      const timer = timers[mvp.id];
      const hasActiveTimer = timer && timer.spawnTimestamp;

      // Tab filter
      if (activeTab === "active" && !hasActiveTimer) return false;
      if (activeTab === "favorites" && !favorites.includes(mvp.id)) return false;

      // Search Filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = mvp.name.toLowerCase().includes(q);
        const matchMap = mvp.map.toLowerCase().includes(q);
        const matchLoc = mvp.location.toLowerCase().includes(q);
        if (!matchName && !matchMap && !matchLoc) return false;
      }

      // Element Filter
      if (selectedElement !== "all" && !mvp.element.toLowerCase().includes(selectedElement.toLowerCase())) {
        return false;
      }

      // Race Filter
      if (selectedRace !== "all" && mvp.race.toLowerCase() !== selectedRace.toLowerCase()) {
        return false;
      }

      // Duration Filter
      if (selectedDuration === "<60" && mvp.respawnMinutes >= 60) return false;
      if (selectedDuration === "60-120" && (mvp.respawnMinutes < 60 || mvp.respawnMinutes > 120)) return false;
      if (selectedDuration === ">120" && mvp.respawnMinutes <= 120) return false;

      return true;
    }).sort((a, b) => {
      const timerA = timers[a.id];
      const timerB = timers[b.id];

      const remainingA = timerA ? timerA.spawnTimestamp - now : Number.MAX_SAFE_INTEGER;
      const remainingB = timerB ? timerB.spawnTimestamp - now : Number.MAX_SAFE_INTEGER;

      if (sortBy === "soonest") {
        return remainingA - remainingB;
      }
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "respawn") {
        return a.respawnMinutes - b.respawnMinutes;
      }
      if (sortBy === "level") {
        return b.level - a.level;
      }
      return 0;
    });
  }, [MVP_DATABASE, timers, favorites, activeTab, searchQuery, selectedElement, selectedRace, selectedDuration, sortBy, now]);

  return (
    <div className={`min-h-screen ${settings.darkMode ? 'dark bg-[#0b0f19] text-gray-100' : 'bg-slate-50 text-slate-900'} transition-colors duration-300`}>
      {/* Top Header Banner */}
      <header className="sticky top-0 z-30 border-b border-amber-500/30 bg-[#0b0f19]/90 backdrop-blur-md px-4 py-3 shadow-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          
          {/* Logo & Live Clock */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 via-amber-600 to-amber-800 flex items-center justify-center text-black font-black text-xl shadow-lg border border-amber-300">
                👑
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight gold-gradient-text flex items-center gap-2">
                  Ragnarok Online MVP Timer
                </h1>
                <p className="text-xs text-amber-500/80 font-mono flex items-center gap-1">
                  <span>Convex Mirror & Kill Time Tracker</span> • <Clock className="w-3 h-3 inline" /> {new Date(now).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Quick Stats Summary */}
            <div className="flex md:hidden items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-mono text-amber-300">
              <Flame className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span>{activeTimerList.length} Active</span>
            </div>
          </div>

          {/* Controls & Tools Bar */}
          <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto justify-end pb-1 md:pb-0">
            {/* Active Timers Badge */}
            <div className="hidden md:flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-mono text-amber-300">
              <Flame className="w-4 h-4 text-amber-500 animate-pulse" />
              <span>{activeTimerList.length} Active Timers</span>
            </div>

            {/* Sound Toggle */}
            <button
              onClick={() => {
                const next = !settings.soundEnabled;
                setSettings(s => ({ ...s, soundEnabled: next }));
                if (next) playSpawnSound(0.5);
              }}
              title="Toggle Sound Alerts"
              className={`p-2 rounded-xl border text-sm flex items-center gap-1.5 transition-all ${
                settings.soundEnabled
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {settings.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Browser Notification Toggle */}
            <button
              onClick={handleToggleNotifPermission}
              title="Browser Desktop Notifications"
              className={`p-2 rounded-xl border text-sm flex items-center gap-1.5 transition-all ${
                settings.browserNotif
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {settings.browserNotif ? <Bell className="w-4 h-4 text-amber-400" /> : <BellOff className="w-4 h-4" />}
            </button>

            {/* Dark / Light Mode Toggle */}
            <button
              onClick={() => setSettings(s => ({ ...s, darkMode: !s.darkMode }))}
              title="Toggle Theme"
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-all"
            >
              {settings.darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
            </button>

            {/* Database Browser Modal Button */}
            <button
              onClick={() => setDbModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 text-slate-200 transition-all"
            >
              <BookOpen className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">MVP DB</span>
            </button>

            {/* Backup / Export JSON Button */}
            <button
              onClick={() => setIoModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 text-slate-200 transition-all"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">JSON</span>
            </button>

            {/* Add Timer Modal Trigger */}
            <button
              onClick={() => {
                setEditingMvp(null);
                setInitialModalTab('killed');
                setAddModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl gold-gradient-bg text-black font-bold text-xs sm:text-sm flex items-center gap-1.5 shadow-lg shadow-amber-500/20 hover:scale-105 transition-all"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Add Timer</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Soonest MVP Featured Banner */}
        {soonestMvp && (
          <div className="relative overflow-hidden rounded-2xl ro-card p-5 border-2 border-amber-500/50 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-900/90 shadow-2xl">
            <div className="absolute top-0 right-0 px-4 py-1 rounded-bl-xl bg-amber-500 text-black text-[11px] font-black tracking-wider uppercase flex items-center gap-1 shadow">
              <Sparkles className="w-3.5 h-3.5" /> Soonest MVP Spawn
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              
              {/* MVP Info */}
              <div className="flex items-center gap-4">
                <div dangerouslySetInnerHTML={{ __html: renderMvpAvatar(soonestMvp.mvp) }} />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-black text-amber-300">{soonestMvp.mvp.name}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 font-mono text-amber-300">
                      Lv.{soonestMvp.mvp.level}
                    </span>
                  </div>

                  {/* Clean Map Location Identifier (e.g. prt_sewb1) */}
                  <p className="text-sm text-slate-300 flex items-center gap-2 mt-1">
                    <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="font-semibold text-amber-200">{soonestMvp.mvp.location}</span>
                    <span className="text-amber-400/90 font-mono bg-slate-950/80 px-2 py-0.5 rounded border border-amber-500/30 font-bold">{soonestMvp.mvp.map}</span>
                  </p>

                  <div className="flex items-center gap-3 mt-2 text-xs font-mono text-slate-400">
                    <span>Spawn Time: <strong className="text-slate-200">{formatClockTime(soonestMvp.spawnTimestamp)}</strong></span>
                    <span>Respawn: <strong className="text-slate-200">{formatRespawnText(soonestMvp.mvp.respawnMinutes)}</strong></span>
                  </div>
                </div>
              </div>

              {/* Countdown & Action */}
              <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-4 sm:pt-0 border-amber-500/20">
                <CountdownRing msRemaining={soonestMvp.msRemaining} totalDurationMs={soonestMvp.totalDurationMs} />

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setEditingMvp(soonestMvp.mvp);
                      setInitialModalTab('killed');
                      setAddModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Skull className="w-3.5 h-3.5 text-amber-400" /> Log Killed Time
                  </button>
                  <button
                    onClick={() => handleResetTimer(soonestMvp.mvp.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset Timer
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="p-4 rounded-2xl ro-card space-y-4">
          
          {/* Tabs & Search */}
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 w-full lg:w-auto overflow-x-auto">
              {[
                { id: 'all', label: 'All MVPs', count: MVP_DATABASE.length },
                { id: 'active', label: 'Active Timers', count: activeTimerList.length },
                { id: 'favorites', label: 'Favorites', count: favorites.length }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === tab.id
                      ? 'bg-amber-500 text-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    activeTab === tab.id ? 'bg-black/20 text-black font-mono' : 'bg-slate-800 text-slate-400 font-mono'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full lg:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search MVP name, map (e.g. prt_sewb1)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

          </div>

          {/* Filter Dropdowns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 text-xs">
            
            {/* Element Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-slate-400 font-mono text-[10px] uppercase tracking-wider">Element</label>
              <select
                value={selectedElement}
                onChange={e => setSelectedElement(e.target.value)}
                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50"
              >
                <option value="all">All Elements</option>
                <option value="fire">Fire</option>
                <option value="water">Water</option>
                <option value="wind">Wind</option>
                <option value="earth">Earth</option>
                <option value="shadow">Shadow</option>
                <option value="holy">Holy</option>
                <option value="undead">Undead</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>

            {/* Race Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-slate-400 font-mono text-[10px] uppercase tracking-wider">Race</label>
              <select
                value={selectedRace}
                onChange={e => setSelectedRace(e.target.value)}
                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50"
              >
                <option value="all">All Races</option>
                <option value="demon">Demon</option>
                <option value="undead">Undead</option>
                <option value="brute">Brute</option>
                <option value="insect">Insect</option>
                <option value="demi-human">Demi-Human</option>
                <option value="formless">Formless</option>
                <option value="angel">Angel</option>
                <option value="plant">Plant</option>
              </select>
            </div>

            {/* Respawn Duration Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-slate-400 font-mono text-[10px] uppercase tracking-wider">Respawn Time</label>
              <select
                value={selectedDuration}
                onChange={e => setSelectedDuration(e.target.value)}
                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50"
              >
                <option value="all">All Respawn Times</option>
                <option value="<60">&lt; 60 Mins</option>
                <option value="60-120">60 - 120 Mins</option>
                <option value=">120">&gt; 120 Mins (&gt;2 hrs)</option>
              </select>
            </div>

            {/* Sort Selector */}
            <div className="flex flex-col gap-1">
              <label className="text-slate-400 font-mono text-[10px] uppercase tracking-wider">Sort By</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50"
              >
                <option value="soonest">Soonest Spawn</option>
                <option value="name">MVP Name (A-Z)</option>
                <option value="respawn">Respawn Duration</option>
                <option value="level">Level (High-Low)</option>
              </select>
            </div>

          </div>

        </div>

        {/* MVP Cards Grid */}
        {displayedMvps.length === 0 ? (
          <div className="p-12 text-center rounded-2xl ro-card border border-dashed border-slate-800">
            <AlertTriangle className="w-10 h-10 text-amber-500/60 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-300">No MVPs Found</h3>
            <p className="text-xs text-slate-500 mt-1">Try adjusting your filters or search terms.</p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedElement("all");
                setSelectedRace("all");
                setSelectedDuration("all");
                setActiveTab("all");
              }}
              className="mt-4 px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-all"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayedMvps.map(mvp => {
              const timer = timers[mvp.id];
              const msRemaining = timer ? timer.spawnTimestamp - now : 0;
              const isFavorite = favorites.includes(mvp.id);
              const colorStatus = timer ? getTimerColorStatus(msRemaining) : null;

              return (
                <div
                  key={mvp.id}
                  className={`relative rounded-2xl ro-card p-5 flex flex-col justify-between gap-4 transition-all ${
                    timer ? colorStatus.bgBorder : 'hover:border-amber-500/40'
                  }`}
                >
                  {/* Top Card Header: MVP Avatar, Name, Favorite */}
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      
                      <div className="flex items-center gap-3">
                        <div dangerouslySetInnerHTML={{ __html: renderMvpAvatar(mvp) }} />
                        
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-slate-100">{mvp.name}</h3>
                            <button
                              onClick={() => toggleFavorite(mvp.id)}
                              className="text-slate-600 hover:text-amber-400 transition-colors"
                              title={isFavorite ? "Remove Favorite" : "Add Favorite"}
                            >
                              <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono border border-amber-500/30">
                              Lv.{mvp.level}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ELEMENT_COLORS[mvp.element.split(' ')[0]] || 'bg-slate-800 text-slate-300'}`}>
                              {mvp.element}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {mvp.race}
                            </span>
                          </div>
                        </div>
                      </div>

                    </div>

                    {/* Map Location Badge (Only Map Name/ID e.g. prt_sewb1, NO map images or coordinates) */}
                    <div className="mt-3 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-200">{mvp.location}</span>
                          <span className="text-amber-400 font-mono font-bold bg-slate-950 px-2 py-0.5 rounded border border-amber-500/30 text-[11px]">
                            {mvp.map}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">
                        {formatRespawnText(mvp.respawnMinutes)}
                      </span>
                    </div>
                  </div>

                  {/* Timer Display / Start Prompt */}
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
                    {timer ? (
                      <>
                        <CountdownRing msRemaining={msRemaining} totalDurationMs={timer.totalDurationMs} />
                        
                        <div className="text-right font-mono text-xs space-y-1">
                          <p className="text-slate-400">
                            Spawn: <strong className="text-slate-200">{formatClockTime(timer.spawnTimestamp)}</strong>
                          </p>
                          <p className="text-slate-500">
                            Respawn: <strong className="text-slate-300">{formatRespawnText(mvp.respawnMinutes)}</strong>
                          </p>
                          {msRemaining <= 0 && (
                            <span className="inline-block px-2 py-0.5 rounded bg-red-600 text-white font-black text-[10px] animate-pulse">
                              SPAWN NOW!
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="w-full text-center py-2">
                        <p className="text-xs text-slate-400 font-mono">Timer Not Running</p>
                        <p className="text-[11px] text-amber-500/80 mt-0.5">Respawn: {formatRespawnText(mvp.respawnMinutes)}</p>
                      </div>
                    )}
                  </div>

                  {/* Quick Kill Time & Convex Input Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setEditingMvp(mvp);
                        setInitialModalTab('killed');
                        setAddModalOpen(true);
                      }}
                      className="py-1.5 px-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                      title="Set timer by entering exact time MVP was killed (e.g. killed at 13:00)"
                    >
                      <Skull className="w-3.5 h-3.5 text-amber-400" />
                      <span>When Killed?</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingMvp(mvp);
                        setInitialModalTab('mirror');
                        setAddModalOpen(true);
                      }}
                      className="py-1.5 px-2 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-700/40 text-indigo-300 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                      title="Set timer by entering Convex Mirror remaining time (MM:SS)"
                    >
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Convex Mirror...</span>
                    </button>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-800/80">
                    <button
                      onClick={() => handleResetTimer(mvp.id)}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                      title="Start full respawn countdown"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset</span>
                    </button>

                    <button
                      onClick={() => handleStartTimer(mvp.id, mvp.respawnMinutes * 60 * 1000)}
                      className="py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/50 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                      title="Quick Start Full Timer"
                    >
                      <Play className="w-3.5 h-3.5 fill-emerald-300" />
                      <span>Start</span>
                    </button>

                    <button
                      onClick={() => handleDeleteTimer(mvp.id)}
                      disabled={!timer}
                      className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
                        timer
                          ? 'bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 text-red-400'
                          : 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed'
                      }`}
                      title="Delete running timer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}

        {/* Recently Expired Spawns Log Drawer */}
        {history.length > 0 && (
          <div className="p-5 rounded-2xl ro-card space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <History className="w-4 h-4 text-amber-500" /> Recently Expired Spawns
              </h3>
              <button
                onClick={() => setHistory([])}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear Log
              </button>
            </div>

            <div className="flex items-center gap-3 overflow-x-auto pb-2">
              {history.map(item => (
                <div
                  key={item.id}
                  className="shrink-0 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-xs flex items-center gap-3 shadow"
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  <div>
                    <p className="font-bold text-slate-200">{item.mvpName}</p>
                    <p className="text-[10px] font-mono text-slate-400">{item.map} • {formatClockTime(item.spawnedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* --- MODALS --- */}

      {/* 1. Add / Edit Timer Modal */}
      {addModalOpen && (
        <AddEditTimerModal
          mvp={editingMvp}
          initialTab={initialModalTab}
          onClose={() => {
            setAddModalOpen(false);
            setEditingMvp(null);
          }}
          onSubmit={(mvpId, remainingMs, customDurationMs) => {
            handleStartTimer(mvpId, remainingMs, customDurationMs);
            setAddModalOpen(false);
            setEditingMvp(null);
          }}
        />
      )}

      {/* 2. MVP Database Modal */}
      {dbModalOpen && (
        <MvpDatabaseModal
          onClose={() => setDbModalOpen(false)}
          onSelectMvp={(mvp) => {
            setDbModalOpen(false);
            setEditingMvp(mvp);
            setInitialModalTab('killed');
            setAddModalOpen(true);
          }}
        />
      )}

      {/* 3. Import / Export JSON Modal */}
      {ioModalOpen && (
        <ImportExportModal
          timers={timers}
          favorites={favorites}
          onClose={() => setIoModalOpen(false)}
          onImport={(importedData) => {
            if (importedData.timers) setTimers(importedData.timers);
            if (importedData.favorites) setFavorites(importedData.favorites);
            setIoModalOpen(false);
          }}
        />
      )}

    </div>
  );
}

/**
 * Add / Edit Timer Modal Component
 * Supports:
 * - Tab 1: When was this killed? (Enter exact kill time e.g. 13:00 -> calculates spawn based on kill time + cooldown)
 * - Tab 2: Convex Mirror Time Remaining (e.g. 42:15)
 * - Custom Respawn Duration override (e.g. 2 hrs instead of default 60m)
 */
function AddEditTimerModal({ mvp, initialTab = 'killed', onClose, onSubmit }) {
  const [selectedMvpId, setSelectedMvpId] = useState(mvp ? mvp.id : MVP_DATABASE[0].id);
  const [activeTab, setActiveTab] = useState(initialTab); // 'killed' or 'mirror'
  
  // Current time helper string "HH:MM"
  const getNowTimeString = () => {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  // Tab 1: Exact Kill Time State
  const [exactKillTime, setExactKillTime] = useState("");

  // Tab 2: Convex Mirror Remaining Time State
  const [mirrorInput, setMirrorInput] = useState("");

  // Custom Respawn Duration (defaults to official MVP respawn)
  const currentMvp = useMemo(() => {
    return MVP_DATABASE.find(m => m.id === selectedMvpId) || MVP_DATABASE[0];
  }, [selectedMvpId]);

  const [customRespawnMins, setCustomRespawnMins] = useState(currentMvp.respawnMinutes);
  const [errorMsg, setErrorMsg] = useState("");

  // Update custom respawn when selected MVP changes
  useEffect(() => {
    setCustomRespawnMins(currentMvp.respawnMinutes);
    setErrorMsg("");
  }, [currentMvp]);

  // Live calculation preview for "When was this killed?" mode
  const exactKillCalculation = useMemo(() => {
    if (!exactKillTime) return null;
    const killTimestamp = parseKillTimeToTimestamp(exactKillTime);
    if (!killTimestamp) return null;

    const currentNow = Date.now();
    const timeElapsedMs = currentNow - killTimestamp;
    const totalRespawnMs = customRespawnMins * 60 * 1000;
    const targetSpawnTimestamp = killTimestamp + totalRespawnMs;
    const remainingMs = targetSpawnTimestamp - currentNow;

    return {
      killTimestamp,
      timeElapsedMs,
      targetSpawnTimestamp,
      remainingMs,
      totalRespawnMs,
      alreadySpawned: remainingMs <= 0
    };
  }, [exactKillTime, customRespawnMins]);

  // Live calculation preview for "Convex Mirror" mode
  const mirrorCalculation = useMemo(() => {
    if (!mirrorInput) return null;
    const remainingMs = parseTimeToMs(mirrorInput, 'minutes');
    if (remainingMs === null || remainingMs < 0) return null;

    const totalRespawnMs = customRespawnMins * 60 * 1000;
    return {
      remainingMs,
      totalRespawnMs
    };
  }, [mirrorInput, customRespawnMins]);

  // Helper generator for Quick Preset Kill Times
  const quickTimePresets = useMemo(() => {
    const nowTs = Date.now();
    const getFormattedTimeAgo = (minsAgo) => {
      const d = new Date(nowTs - minsAgo * 60 * 1000);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    };

    return [
      { label: "Now", timeStr: getFormattedTimeAgo(0) },
      { label: "15m ago", timeStr: getFormattedTimeAgo(15) },
      { label: "30m ago", timeStr: getFormattedTimeAgo(30) },
      { label: "1h ago", timeStr: getFormattedTimeAgo(60) },
      { label: "2h ago", timeStr: getFormattedTimeAgo(120) },
      { label: "3h ago", timeStr: getFormattedTimeAgo(180) },
    ];
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const totalRespawnMs = customRespawnMins * 60 * 1000;

    if (activeTab === 'killed') {
      if (!exactKillTime) {
        // Default to full respawn if blank
        onSubmit(currentMvp.id, totalRespawnMs, totalRespawnMs);
        return;
      }

      if (!exactKillCalculation || exactKillCalculation.killTimestamp === null) {
        setErrorMsg("Invalid time format! Enter exact kill time e.g. 13:00 or 1:00 PM.");
        return;
      }

      const remainingMs = Math.max(0, exactKillCalculation.remainingMs);
      onSubmit(currentMvp.id, remainingMs, totalRespawnMs);

    } else {
      // Convex Mirror Mode
      if (!mirrorInput) {
        onSubmit(currentMvp.id, totalRespawnMs, totalRespawnMs);
        return;
      }

      if (!mirrorCalculation || mirrorCalculation.remainingMs === null) {
        setErrorMsg("Invalid Convex Mirror format! Use MM:SS (e.g. 42:15) or minutes (e.g. 42).");
        return;
      }

      onSubmit(currentMvp.id, mirrorCalculation.remainingMs, totalRespawnMs);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl ro-card p-6 border-2 border-amber-500/50 bg-[#0b0f19] shadow-2xl space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-amber-300">
              {mvp ? `Set Timer: ${mvp.name}` : 'Set MVP Respawn Timer'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Select MVP Dropdown */}
          {!mvp && (
            <div className="space-y-1">
              <label className="text-xs font-mono text-slate-300">Select MVP Boss</label>
              <select
                value={selectedMvpId}
                onChange={e => setSelectedMvpId(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:border-amber-500"
              >
                {MVP_DATABASE.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.map} - {formatRespawnText(m.respawnMinutes)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Current MVP Preview & Respawn Config */}
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div dangerouslySetInnerHTML={{ __html: renderMvpAvatar(currentMvp) }} />
              <div>
                <p className="font-bold text-amber-300">{currentMvp.name}</p>
                <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                  <span>{currentMvp.location}</span>
                  <span className="text-amber-400 font-mono font-bold bg-slate-950 px-1.5 py-0.2 rounded border border-amber-500/30">{currentMvp.map}</span>
                </p>
              </div>
            </div>

            {/* Custom Respawn Duration Input */}
            <div className="text-right shrink-0">
              <label className="text-[10px] font-mono text-slate-400 block">Respawn Cooldown</label>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={customRespawnMins}
                  onChange={e => setCustomRespawnMins(parseInt(e.target.value, 10) || 1)}
                  className="w-16 p-1 rounded bg-slate-950 border border-slate-700 font-mono text-xs text-amber-300 text-center font-bold"
                />
                <span className="text-xs font-mono text-slate-400">mins</span>
              </div>
            </div>
          </div>

          {/* Mode Selection Tabs */}
          <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setActiveTab('killed');
                setErrorMsg("");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'killed'
                  ? 'bg-amber-500 text-black shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Skull className="w-3.5 h-3.5" />
              <span>When Was It Killed?</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('mirror');
                setErrorMsg("");
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'mirror'
                  ? 'bg-amber-500 text-black shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Convex Mirror Time</span>
            </button>
          </div>

          {/* TAB 1: When was this killed? Input */}
          {activeTab === 'killed' && (
            <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-amber-300">
                    Exact time {currentMvp.name} was killed:
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    Current Local Time: <strong className="text-amber-400">{formatClockTime(Date.now())}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    step="60"
                    value={exactKillTime}
                    onChange={e => {
                      setExactKillTime(e.target.value);
                      setErrorMsg("");
                    }}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-xl text-amber-300 focus:outline-none focus:border-amber-500 flex-1"
                    autoFocus
                  />

                  <input
                    type="text"
                    placeholder="or type 13:00 / 1:00 PM"
                    value={exactKillTime}
                    onChange={e => {
                      setExactKillTime(e.target.value);
                      setErrorMsg("");
                    }}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-xs text-amber-300 placeholder-slate-600 focus:outline-none focus:border-amber-500 w-44"
                  />
                </div>
              </div>

              {/* Quick Presets for Exact Kill Time */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Quick Preset Times</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {quickTimePresets.map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setExactKillTime(preset.timeStr);
                        setErrorMsg("");
                      }}
                      className="py-1.5 px-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-mono text-amber-300 transition-colors text-center"
                      title={`Set kill time to ${preset.timeStr}`}
                    >
                      <span className="block font-bold">{preset.label}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{preset.timeStr}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculation Preview Box */}
              {exactKillCalculation && (
                <div className={`p-3.5 rounded-xl border text-xs font-mono space-y-2 transition-all ${
                  exactKillCalculation.alreadySpawned
                    ? 'bg-red-950/60 border-red-600 text-red-300'
                    : 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                }`}>
                  <div className="flex items-center justify-between border-b border-emerald-500/20 pb-1">
                    <span className="text-slate-400">Kill Time Recorded:</span>
                    <strong className="text-amber-300">{formatClockTime(exactKillCalculation.killTimestamp)}</strong>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Boss Cooldown Duration:</span>
                    <span className="text-slate-200">{formatRespawnText(customRespawnMins)}</span>
                  </div>

                  <div className="flex items-center justify-between border-t border-emerald-500/20 pt-1 font-bold">
                    <span className="text-emerald-400">Calculated Spawn Time:</span>
                    <strong className="text-amber-300">{formatClockTime(exactKillCalculation.targetSpawnTimestamp)}</strong>
                  </div>

                  <div className="flex items-center justify-between font-bold text-sm pt-0.5">
                    <span>Live Countdown Starts At:</span>
                    <span className={exactKillCalculation.alreadySpawned ? 'text-red-400' : 'text-emerald-300'}>
                      {exactKillCalculation.alreadySpawned ? '00:00:00 (SPAWN NOW!)' : formatMsRemaining(exactKillCalculation.remainingMs)}
                    </span>
                  </div>

                  {exactKillCalculation.alreadySpawned && (
                    <p className="text-[11px] text-red-400 font-bold mt-1 animate-pulse">
                      ⚠️ MVP has already spawned! (Kill time + cooldown has passed)
                    </p>
                  )}
                </div>
              )}

            </div>
          )}

          {/* TAB 2: Convex Mirror Time Remaining Input */}
          {activeTab === 'mirror' && (
            <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-amber-300 block">
                  Time Remaining shown by Convex Mirror (MM:SS or HH:MM:SS)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 42:15 or 1:15:00"
                  value={mirrorInput}
                  onChange={e => {
                    setMirrorInput(e.target.value);
                    setErrorMsg("");
                  }}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 font-mono text-lg text-amber-300 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  autoFocus
                />
              </div>

              {/* Quick Presets for Convex Mirror */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-mono">Quick Presets</label>
                <div className="grid grid-cols-4 gap-2">
                  {["5:00", "15:00", "30:00", "45:00"].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMirrorInput(preset)}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-amber-300 transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mirror Preview */}
              {mirrorCalculation && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-700/60 text-xs font-mono text-emerald-300 flex items-center justify-between">
                  <span>Countdown Start:</span>
                  <strong className="text-amber-300 text-sm">
                    {formatMsRemaining(mirrorCalculation.remainingMs)}
                  </strong>
                </div>
              )}

            </div>
          )}

          {errorMsg && <p className="text-xs text-red-400 font-mono">{errorMsg}</p>}

          {/* Submit & Cancel */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-1/2 py-2.5 rounded-xl gold-gradient-bg text-black font-bold text-xs shadow-lg hover:scale-[1.02] transition-transform"
            >
              Start Timer
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}

/**
 * MVP Database Browser Modal
 */
function MvpDatabaseModal({ onClose, onSelectMvp }) {
  const [dbSearch, setDbSearch] = useState("");

  const filtered = useMemo(() => {
    if (!dbSearch) return MVP_DATABASE;
    const q = dbSearch.toLowerCase();
    return MVP_DATABASE.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.map.toLowerCase().includes(q) ||
      m.location.toLowerCase().includes(q) ||
      m.race.toLowerCase().includes(q) ||
      m.element.toLowerCase().includes(q)
    );
  }, [dbSearch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-4xl h-[85vh] rounded-2xl ro-card p-6 border-2 border-amber-500/50 bg-[#0b0f19] shadow-2xl flex flex-col gap-4">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-amber-300">Ragnarok Online MVP Database ({MVP_DATABASE.length} MVPs)</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative shrink-0">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search database by name, map (e.g. prt_sewb1), element, race..."
            value={dbSearch}
            onChange={e => setDbSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        {/* Table / Cards List */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-3">
          {filtered.map(mvp => (
            <div
              key={mvp.id}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all"
            >
              <div className="flex items-center gap-4">
                <div dangerouslySetInnerHTML={{ __html: renderMvpAvatar(mvp) }} />
                <div>
                  <h3 className="font-bold text-amber-300 text-base">{mvp.name}</h3>
                  <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                    <span>{mvp.location}</span>
                    <span className="text-amber-400 font-mono font-bold bg-slate-950 px-2 py-0.5 rounded border border-amber-500/30">{mvp.map}</span>
                  </p>
                  
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs font-mono text-slate-400">
                    <span>HP: <strong className="text-slate-200">{mvp.hp?.toLocaleString() || 'N/A'}</strong></span>
                    <span>Respawn: <strong className="text-slate-200">{formatRespawnText(mvp.respawnMinutes)}</strong></span>
                    <span>Element: <strong className="text-slate-200">{mvp.element}</strong></span>
                    <span>Race: <strong className="text-slate-200">{mvp.race}</strong></span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onSelectMvp(mvp)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl gold-gradient-bg text-black font-bold text-xs shadow hover:scale-105 transition-transform shrink-0"
              >
                Set Timer
              </button>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

/**
 * Import / Export JSON Modal
 */
function ImportExportModal({ timers, favorites, onClose, onImport }) {
  const [importJson, setImportJson] = useState("");
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState("");

  const exportData = useMemo(() => {
    return JSON.stringify({ timers, favorites, exportedAt: new Date().toISOString() }, null, 2);
  }, [timers, favorites]);

  const handleCopyExport = () => {
    navigator.clipboard.writeText(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImportSubmit = () => {
    try {
      const parsed = JSON.parse(importJson);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error("Invalid JSON structure");
      }
      onImport(parsed);
    } catch (e) {
      setImportError("Invalid JSON format. Please verify your string.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl ro-card p-6 border-2 border-amber-500/50 bg-[#0b0f19] shadow-2xl space-y-4">
        
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-amber-300">Import / Export Timers</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Export Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-mono text-slate-300">Export Backup JSON</label>
            <button
              onClick={handleCopyExport}
              className="text-xs text-amber-400 hover:underline flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
          <textarea
            readOnly
            value={exportData}
            className="w-full h-24 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400 focus:outline-none resize-none"
          />
        </div>

        {/* Import Box */}
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <label className="text-xs font-mono text-slate-300">Import JSON Backup</label>
          <textarea
            placeholder="Paste exported JSON here..."
            value={importJson}
            onChange={e => {
              setImportJson(e.target.value);
              setImportError("");
            }}
            className="w-full h-24 p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500 resize-none"
          />
          {importError && <p className="text-xs text-red-400">{importError}</p>}
        </div>

        <button
          onClick={handleImportSubmit}
          disabled={!importJson}
          className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
            importJson
              ? 'gold-gradient-bg text-black shadow-lg hover:scale-[1.02]'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          Import Timers & Favorites
        </button>

      </div>
    </div>
  );
}

// Mount App
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
