import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [setTimeout(() => setPhase(1), 200)];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-[#0A0A0C]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="w-full">
        <h2 className="text-2xl font-mono text-white/80 mb-6 flex items-center gap-3">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Pattern Matched
        </h2>

        <div className="space-y-3">
          <div className="h-32 bg-[#1A1A1C] rounded border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 bottom-0 left-16 w-px bg-white/10" />
            <div className="absolute top-3 left-3 text-[10px] font-mono text-white/40">OUTPUT</div>

            <svg className="absolute top-0 left-16 right-0 h-full" viewBox="0 0 600 128" preserveAspectRatio="none">
              <motion.path
                d="M 0 64 L 50 64 L 60 20 L 70 100 L 80 64 L 150 64 L 160 30 L 170 90 L 180 64 L 300 64 L 310 10 L 320 110 L 330 64 L 450 64 L 460 20 L 470 100 L 480 64 L 600 64"
                fill="none"
                stroke="var(--color-brand-red)"
                strokeWidth="2"
                initial={{ pathLength: 0 }}
                animate={phase >= 1 ? { pathLength: 1 } : { pathLength: 0 }}
                transition={{ duration: 2, ease: 'linear' }}
              />
            </svg>

            <motion.div
              className="absolute top-0 bottom-0 w-24 bg-gradient-to-r from-transparent via-[var(--color-brand-red-dim)] to-transparent mix-blend-screen"
              animate={{ left: ['0%', '100%'] }}
              transition={{ duration: 2, ease: 'linear' }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-[#1A1A1C] rounded border border-white/5 relative overflow-hidden flex items-center px-3">
                <motion.div
                  className="h-2 bg-white/20 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: phase >= 1 ? `${i * 22 + 18}%` : '0%' }}
                  transition={{ delay: i * 0.2 + 0.5, duration: 0.8 }}
                />
              </div>
            ))}
          </div>
        </div>

        <motion.p
          className="text-center mt-10 text-base font-display text-white/60 leading-snug"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          Adaptive Movement Limiter scales strokes automatically.
        </motion.p>
      </div>
    </motion.div>
  );
}
