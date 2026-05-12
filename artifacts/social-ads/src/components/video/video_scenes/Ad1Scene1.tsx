import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Ad1Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  // Generate some fake waveform bars
  const bars = Array.from({ length: 40 }).map((_, i) => {
    const baseHeight = 20 + Math.random() * 40;
    return { id: i, baseHeight };
  });

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
    >
      <motion.div 
        className="text-center z-10 mb-16"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <h1 className="text-6xl font-display font-bold mb-4 tracking-tighter">
          Music In.<br />
          <span className="text-[var(--color-brand-red)]">Motion Out.</span>
        </h1>
        <p className="text-xl text-[var(--color-brand-cream-dim)] font-mono">Audio Beat Detector</p>
      </motion.div>

      <div className="w-full max-w-4xl h-48 relative flex items-center justify-center gap-1">
        {bars.map((bar, i) => {
          const isBeat = i % 8 === 0;
          return (
            <div key={bar.id} className="relative flex items-end h-full flex-1 justify-center">
              {isBeat && phase >= 2 && (
                <motion.div 
                  className="absolute bottom-0 w-full bg-[var(--color-brand-red)] rounded-t-sm"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: '100%', opacity: [0.5, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1 }}
                />
              )}
              <motion.div 
                className={`w-full rounded-full ${isBeat && phase >= 2 ? 'bg-[var(--color-brand-red)]' : 'bg-white/20'}`}
                animate={{ 
                  height: phase >= 1 ? [bar.baseHeight, bar.baseHeight * (Math.random() * 2 + 0.5), bar.baseHeight] : 4,
                }}
                transition={{ 
                  duration: 0.5 + Math.random() * 0.5, 
                  repeat: Infinity,
                  repeatType: 'reverse' 
                }}
              />
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
