import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
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
      className="absolute inset-0 flex flex-col items-center justify-center p-8 gap-10"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.h2
        className="text-3xl font-display font-bold text-center leading-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Real-time Haptic<br />Generation
      </motion.h2>

      <div className="w-full relative">
        <div className="relative h-48 bg-[var(--color-brand-gray)] rounded-xl border border-[var(--color-brand-gray-light)] p-6 overflow-hidden">
          <div className="absolute inset-0 bg-grid opacity-10" />
          <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-white/10 -translate-y-1/2" />

          <motion.div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-brand-red)] shadow-[0_0_10px_var(--color-brand-red)]"
            animate={{ left: phase >= 1 ? '92%' : '8%' }}
            transition={{ duration: 2, ease: 'linear' }}
          />

          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 w-3 h-3 rounded-full bg-[var(--color-brand-red)] -translate-y-1/2 -translate-x-1/2 shadow-[0_0_15px_var(--color-brand-red-dim)]"
              style={{ left: `calc(8% + ${(i / 7) * 84}%)` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ delay: 0.5 + i * 0.18, type: 'spring' }}
            />
          ))}

          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 192" preserveAspectRatio="none">
            <motion.path
              d="M 32 96 Q 80 40, 130 96 T 230 96 T 330 96 T 380 96"
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
