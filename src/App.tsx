import { useState, useEffect, useRef, useCallback } from 'react';
import { playSingleString, initAudio, CHORDS } from './audioEngine';

const CHORD_KEYS = ['E', 'Em', 'A', 'Am', 'C', 'D', 'Dm', 'F', 'G', 'B7', 'A7', 'D7'];

const CHORD_COLORS: Record<string, string> = {
  E:  'from-red-500 to-red-600',
  Em: 'from-red-400 to-red-500',
  A:  'from-orange-500 to-orange-600',
  Am: 'from-orange-400 to-orange-500',
  C:  'from-yellow-500 to-yellow-600',
  D:  'from-green-500 to-green-600',
  Dm: 'from-green-400 to-green-500',
  F:  'from-teal-500 to-teal-600',
  G:  'from-blue-500 to-blue-600',
  B7: 'from-indigo-500 to-indigo-600',
  A7: 'from-purple-500 to-purple-600',
  D7: 'from-pink-500 to-pink-600',
};

const CHORD_BG: Record<string, string> = {
  E:  'bg-red-500/20 border-red-500',
  Em: 'bg-red-400/20 border-red-400',
  A:  'bg-orange-500/20 border-orange-500',
  Am: 'bg-orange-400/20 border-orange-400',
  C:  'bg-yellow-500/20 border-yellow-500',
  D:  'bg-green-500/20 border-green-500',
  Dm: 'bg-green-400/20 border-green-400',
  F:  'bg-teal-500/20 border-teal-500',
  G:  'bg-blue-500/20 border-blue-500',
  B7: 'bg-indigo-500/20 border-indigo-500',
  A7: 'bg-purple-500/20 border-purple-400',
  D7: 'bg-pink-500/20 border-pink-500',
};

const STRING_LABELS = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

// Compute 6 string positions based on spacing (degrees between each string)
function getStringPositions(spacing: number): number[] {
  // Center the 6 strings: positions at -2.5s, -1.5s, -0.5s, +0.5s, +1.5s, +2.5s
  return [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map(m => m * spacing);
}

export default function App() {
  const [activeChord, setActiveChord] = useState<string>('open');
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [motionPermissionGranted, setMotionPermissionGranted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [activeStrings, setActiveStrings] = useState<boolean[]>([false, false, false, false, false, false]);
  const [currentGamma, setCurrentGamma] = useState<number | null>(null);

  // Down-only mode: only downstrokes trigger (natural strum direction)
  const [downOnly, setDownOnly] = useState(false);
  const downOnlyRef = useRef(false);
  useEffect(() => { downOnlyRef.current = downOnly; }, [downOnly]);

  // String spacing: degrees between each string (default 20, range 8-40)
  const [stringSpacing, setStringSpacing] = useState(20);
  const stringSpacingRef = useRef(20);
  useEffect(() => { stringSpacingRef.current = stringSpacing; }, [stringSpacing]);

  // Calibration: when calibrated, the current angle becomes the center
  const [isCalibrated, setIsCalibrated] = useState(false);
  const calibrationOffsetRef = useRef(0);
  const isCalibratedRef = useRef(false);

  const activeChordRef = useRef('open');
  useEffect(() => { activeChordRef.current = activeChord; }, [activeChord]);

  // Store raw strumAngle for calibration
  const rawStrumAngleRef = useRef(0);

  // Flash a string visually
  const flashString = useCallback((index: number) => {
    setActiveStrings(prev => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
    setTimeout(() => {
      setActiveStrings(prev => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
    }, 200);
  }, []);

  // Calibrate: set the current position as center
  const handleCalibrate = () => {
    calibrationOffsetRef.current = rawStrumAngleRef.current;
    isCalibratedRef.current = true;
    setIsCalibrated(true);
  };

  // Reset calibration
  const handleResetCalibration = () => {
    calibrationOffsetRef.current = 0;
    isCalibratedRef.current = false;
    setIsCalibrated(false);
  };

  // Device motion handler
  useEffect(() => {
    if (!motionEnabled) return;

    const triggeredStrings = new Set<number>();
    let rawAngle = 0;
    let swingDirection: 'left' | 'right' | null = null;
    let lastTimestamp = 0;

    const handleMotion = (e: DeviceMotionEvent) => {
      const rate = e.rotationRate;
      if (!rate || rate.gamma === null) return;

      const now = performance.now();
      const dt = lastTimestamp > 0 ? Math.min((now - lastTimestamp) / 1000, 0.05) : 0;
      lastTimestamp = now;
      if (dt === 0) return;

      const gammaRate = rate.gamma!;

      // Dead zone for noise
      if (Math.abs(gammaRate) < 15) {
        // Only decay if NOT calibrated
        if (!isCalibratedRef.current) {
          rawAngle *= 0.92;
        }
        const displayAngle = rawAngle - calibrationOffsetRef.current;
        rawStrumAngleRef.current = rawAngle;
        setCurrentGamma(displayAngle);
        return;
      }

      // Integrate angular velocity
      rawAngle += gammaRate * dt;

      // Clamp raw angle
      rawAngle = Math.max(-120, Math.min(120, rawAngle));
      rawStrumAngleRef.current = rawAngle;

      // The display/logic angle is offset by calibration
      const displayAngle = rawAngle - calibrationOffsetRef.current;
      setCurrentGamma(displayAngle);

      // Determine swing direction
      const newDirection = gammaRate > 0 ? 'right' : 'left';
      if (swingDirection !== null && newDirection !== swingDirection) {
        triggeredStrings.clear();
      }
      swingDirection = newDirection;

      // Get current string positions from spacing
      const positions = getStringPositions(stringSpacingRef.current);

      // Check each string position
      const prevAngle = displayAngle - gammaRate * dt;
      for (let i = 0; i < positions.length; i++) {
        if (triggeredStrings.has(i)) continue;

        const pos = positions[i];
        const crossed =
          (prevAngle < pos && displayAngle >= pos) ||
          (prevAngle > pos && displayAngle <= pos);

        if (crossed) {
          triggeredStrings.add(i);
          // Down-only mode: remap upstroke string order to match downstroke
          // So both directions play E2→A2→D3→G3→B3→E4 (low to high)
          const stringToPlay = (downOnlyRef.current && swingDirection === 'left')
            ? (positions.length - 1 - i)
            : i;
          try {
            playSingleString(activeChordRef.current, stringToPlay);
          } catch {
            initAudio();
            playSingleString(activeChordRef.current, stringToPlay);
          }
          flashString(stringToPlay);
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion, { passive: true });
    return () => {
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [motionEnabled, flashString]);

  const toggleMotion = async () => {
    if (!audioReady) {
      initAudio();
      setAudioReady(true);
    }

    // If already enabled, just toggle off
    if (motionEnabled) {
      setMotionEnabled(false);
      setCurrentGamma(null);
      return;
    }

    // If permission was already granted before, just toggle back on
    if (motionPermissionGranted) {
      setMotionEnabled(true);
      return;
    }

    // First time: request permission
    let granted = false;
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const perm = await (DeviceMotionEvent as any).requestPermission();
        if (perm === 'granted') granted = true;
      } catch {
        // permission denied
      }
    } else {
      granted = true;
    }

    if (granted) {
      setMotionPermissionGranted(true);
      setMotionEnabled(true);
    }
  };

  const enableAudio = () => {
    initAudio();
    setAudioReady(true);
  };

  // Toggle chord: tap to activate, tap again to deactivate, tap another to switch
  const handleChordToggle = (chord: string) => {
    if (!audioReady) enableAudio();
    setActiveChord(prev => prev === chord ? 'open' : chord);
  };

  // Touch strum on the string area
  const lastTouchedString = useRef<number | null>(null);

  const getStringFromY = (y: number, rect: DOMRect): number => {
    const relativeY = (y - rect.top) / rect.height;
    const index = Math.floor(relativeY * 6);
    return Math.max(0, Math.min(5, index));
  };

  const handleStringTouch = (stringIndex: number) => {
    if (!audioReady) enableAudio();
    if (lastTouchedString.current !== stringIndex) {
      lastTouchedString.current = stringIndex;
      playSingleString(activeChordRef.current, stringIndex);
      flashString(stringIndex);
    }
  };

  const handleStrumAreaTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!audioReady) enableAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    const si = getStringFromY(touch.clientY, rect);
    lastTouchedString.current = null;
    handleStringTouch(si);
  };

  const handleStrumAreaTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    const si = getStringFromY(touch.clientY, rect);
    handleStringTouch(si);
  };

  const handleStrumAreaTouchEnd = () => {
    lastTouchedString.current = null;
  };

  const handleStrumAreaMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioReady) enableAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const si = getStringFromY(e.clientY, rect);
    lastTouchedString.current = null;
    handleStringTouch(si);
  };

  const handleStrumAreaMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const si = getStringFromY(e.clientY, rect);
    handleStringTouch(si);
  };

  const handleStrumAreaMouseUp = () => {
    lastTouchedString.current = null;
  };

  const currentChordData = CHORDS[activeChord];
  const isHoldingChord = activeChord !== 'open';
  const stringPositions = getStringPositions(stringSpacing);
  const displayRange = Math.max(stringSpacing * 3.5, 40); // auto-scale display range

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 flex flex-col select-none overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎸</span>
          <h1 className="text-white font-bold text-lg tracking-tight">Campfire Guitar</h1>
        </div>
        <button
          onClick={toggleMotion}
          className={`font-bold text-xs px-3 py-1.5 rounded-full transition-all active:scale-95 ${
            motionEnabled
              ? 'bg-green-500/20 border border-green-500 text-green-400'
              : 'bg-amber-500 hover:bg-amber-400 text-black'
          }`}
        >
          {motionEnabled ? '● Motion ON' : '○ Motion OFF'}
        </button>
      </div>

      {/* Current chord display */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center py-1">
        <div className={`text-5xl font-black tracking-tight transition-all duration-100 ${
          isHoldingChord ? 'text-white scale-110' : 'text-gray-500'
        }`}>
          {currentChordData?.name || 'Open'}
        </div>
        <div className="text-gray-500 text-xs mt-0.5">
          {isHoldingChord ? 'Swing to strum' : 'Tap a chord below'}
        </div>
      </div>

      {/* Controls: Calibration + Down-Only + String Spacing */}
      {motionEnabled && (
        <div className="mx-4 mb-2 space-y-2">
          {/* Calibration + Down-Only row */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCalibrate}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                isCalibrated
                  ? 'bg-green-600/30 border border-green-500 text-green-300'
                  : 'bg-gray-800 border border-gray-600 text-gray-300'
              }`}
            >
              {isCalibrated ? '✓ Calibrated' : '⊕ Calibrate'}
            </button>
            {isCalibrated && (
              <button
                onClick={handleResetCalibration}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-gray-800 border border-gray-600 text-gray-400 active:scale-95 transition-all"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setDownOnly(!downOnly)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                downOnly
                  ? 'bg-blue-600/30 border border-blue-500 text-blue-300'
                  : 'bg-gray-800 border border-gray-600 text-gray-400'
              }`}
            >
              {downOnly ? '↓ Down Sound' : '↕ Both Ways'}
            </button>
          </div>

          {/* String spacing slider */}
          <div className="flex items-center gap-3 px-1">
            <span className="text-[10px] text-gray-500 font-medium w-12 shrink-0">Spacing</span>
            <div className="flex items-center gap-1 text-gray-600 text-[10px]">
              <span>Tight</span>
            </div>
            <input
              type="range"
              min={4}
              max={30}
              step={1}
              value={stringSpacing}
              onChange={(e) => setStringSpacing(Number(e.target.value))}
              className="flex-1 h-1.5 accent-amber-500 cursor-pointer"
            />
            <div className="flex items-center gap-1 text-gray-600 text-[10px]">
              <span>Wide</span>
            </div>
            <span className="text-amber-400 text-[10px] font-mono w-6 text-right">{stringSpacing}°</span>
          </div>
        </div>
      )}

      {/* Tilt indicator */}
      {motionEnabled && currentGamma !== null && (
        <div className="mx-4 mb-2">
          <div className="relative h-10 bg-gray-800/50 rounded-lg overflow-hidden">
            {/* String position markers */}
            {stringPositions.map((pos, i) => {
              const pct = ((pos + displayRange) / (displayRange * 2)) * 100;
              const freq = currentChordData?.frequencies[i] || 0;
              const isMuted = freq === 0;
              return (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 w-0.5 transition-all duration-75 ${
                    activeStrings[i]
                      ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                      : isMuted
                        ? 'bg-red-900/40'
                        : 'bg-gray-600'
                  }`}
                  style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
                >
                  <span className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-mono ${
                    activeStrings[i] ? 'text-amber-300' : isMuted ? 'text-red-800' : 'text-gray-500'
                  }`}>
                    {isMuted ? '✕' : STRING_LABELS[i]}
                  </span>
                </div>
              );
            })}
            {/* Center marker */}
            <div
              className="absolute top-0 bottom-0 w-px bg-gray-700/50"
              style={{ left: '50%' }}
            />
            {/* Current phone position indicator */}
            <div
              className="absolute top-1 bottom-1 w-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.6)] transition-[left] duration-[16ms]"
              style={{ left: `${Math.max(1, Math.min(99, ((currentGamma + displayRange) / (displayRange * 2)) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Touch strum zone */}
      <div
        className="flex-1 mx-4 mb-2 rounded-2xl border border-gray-700/50 bg-gray-800/20 flex flex-col justify-around py-3 cursor-pointer overflow-hidden"
        onTouchStart={handleStrumAreaTouchStart}
        onTouchMove={handleStrumAreaTouchMove}
        onTouchEnd={handleStrumAreaTouchEnd}
        onMouseDown={handleStrumAreaMouseDown}
        onMouseMove={handleStrumAreaMouseMove}
        onMouseUp={handleStrumAreaMouseUp}
        onMouseLeave={handleStrumAreaMouseUp}
      >
        {STRING_LABELS.map((label, i) => {
          const freq = currentChordData?.frequencies[i] || 0;
          const isMuted = freq === 0;
          const thickness = [3, 2.5, 2, 1.5, 1, 0.75][i];
          const isActive = activeStrings[i];
          return (
            <div key={i} className="flex items-center gap-3 px-4">
              <span className={`text-[10px] font-mono w-5 text-right transition-colors ${
                isActive ? 'text-amber-300' : isMuted ? 'text-red-500/60' : 'text-gray-600'
              }`}>
                {isMuted ? '✕' : label}
              </span>
              <div className="flex-1 relative">
                <div
                  className={`w-full rounded-full transition-all duration-75 ${
                    isActive
                      ? 'bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                      : isMuted
                        ? 'bg-gray-800'
                        : 'bg-gray-600'
                  }`}
                  style={{ height: `${thickness}px` }}
                />
              </div>
              <span className={`text-[10px] font-mono w-8 transition-colors ${
                isActive ? 'text-amber-300' : 'text-gray-700'
              }`}>
                {freq > 0 ? `${Math.round(freq)}` : ''}
              </span>
            </div>
          );
        })}
        <p className="text-gray-600 text-[10px] text-center mt-1 pointer-events-none">
          ↕ Drag across strings to strum
        </p>
      </div>

      {/* Chord buttons grid — TOGGLE mode */}
      <div className="flex-shrink-0 px-3 pb-4">
        <div className="grid grid-cols-4 gap-2">
          {CHORD_KEYS.map((chord) => {
            const isActive = activeChord === chord;
            return (
              <button
                key={chord}
                className={`relative py-3.5 rounded-xl font-black text-xl transition-all duration-100
                  ${isActive
                    ? `bg-gradient-to-b ${CHORD_COLORS[chord]} text-white shadow-lg shadow-black/30 scale-[1.05] ring-2 ring-white/30`
                    : `${CHORD_BG[chord]} border text-gray-300 active:scale-95`
                  }`}
                onClick={() => handleChordToggle(chord)}
                onTouchStart={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {chord}
                {isActive && (
                  <span className="absolute top-0.5 right-1 text-[8px] opacity-70">●</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-center text-gray-600 text-[10px] mt-2">
          Made with Love by SimonLM
        </p>
      </div>
    </div>
  );
}
