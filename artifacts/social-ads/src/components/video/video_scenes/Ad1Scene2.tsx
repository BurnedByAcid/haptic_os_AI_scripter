import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Ad1Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="w-full max-w-5xl relative">
        <motion.h2 
          className="text-4xl font-display font-bold mb-12 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Real-time Haptic Generation
        </motion.h2>

        <div className="relative h-64 bg-[var(--color-brand-gray)] rounded-xl border border-[var(--color-brand-gray-light)] p-8 overflow-hidden">
          {/* Timeline Grid */}
          <div className="absolute inset-0 bg-grid opacity-10" />
          
          {/* Timeline Track */}
          <div className="absolute top-1/2 left-8 right-8 h-0.5 bg-white/10 -translate-y-1/2" />
          
          {/* Playhead */}
          <motion.div 
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-brand-red)] left-8 shadow-[0_0_10px_var(--color-brand-red)]"
            animate={{ left: phase >= 1 ? '90%' : '2rem' }}
            transition={{ duration: 2, ease: 'linear' }}
          />

          {/* Markers */}
          {Array.from({ length: 12 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 w-3 h-3 rounded-full bg-[var(--color-brand-red)] -translate-y-1/2 -translate-x-1/2 shadow-[0_0_15px_var(--color-brand-red-dim)]"
              style={{ left: `calc(2rem + ${(i / 11) * 85}%)` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.5 + (i * 0.15), type: 'spring' }}
            />
          ))}

          {/* Connection Path */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <motion.path
              d="M 32 128 Q 100 64, 150 128 T 250 128 T 350 128 T 450 128 T 550 128 T 650 128 T 750 128"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={phase >= 1 ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 2, ease: 'linear' }}
            />
          </svg>
        </div>
      </div>
    </motion.div>
  );
}
