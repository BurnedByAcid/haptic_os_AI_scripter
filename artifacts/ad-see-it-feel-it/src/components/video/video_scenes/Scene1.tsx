import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8 gap-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <h1 className="text-5xl font-display font-bold text-center leading-tight">
        See It.<br /><span className="text-[var(--color-brand-red)]">Feel It.</span>
      </h1>

      <div className="relative w-full aspect-video bg-[#111] border-2 border-[var(--color-brand-gray-light)] rounded-lg overflow-hidden shadow-2xl">
        <div className="absolute inset-0 bg-grid opacity-20" />

        <motion.div
          className="absolute inset-0 opacity-50 bg-gradient-to-br from-blue-900/40 to-purple-900/40"
          animate={{ backgroundPosition: ['0% 0%', '100% 100%'] }}
          transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
        />

        <motion.div
          className="absolute w-32 h-32 bg-white/10 rounded-full blur-xl"
          animate={{ x: [0, 120, 0], y: [0, 60, 0] }}
          transition={{ duration: 3, repeat: Infinity }}
        />

        {phase >= 1 && (
          <motion.div
            className="absolute top-1/3 left-1/3 w-[35%] aspect-square border-2 border-[var(--color-brand-red)] bg-[var(--color-brand-red)]/10"
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 12 }}
          >
            <div className="absolute -top-6 text-[10px] font-mono text-[var(--color-brand-red)] bg-black px-2 border border-[var(--color-brand-red)] whitespace-nowrap">
              VISUAL_TARGET_LOCKED
            </div>
            <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-[var(--color-brand-red)]" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-[var(--color-brand-red)]" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-[var(--color-brand-red)]" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-[var(--color-brand-red)]" />
          </motion.div>
        )}

        {phase >= 2 && (
          <motion.div
            className="absolute top-0 bottom-0 left-0 w-1 bg-white/50 blur-[1px]"
            animate={{ left: ['0%', '100%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>

      <motion.p
        className="font-mono text-[var(--color-brand-cream-dim)] tracking-widest text-xs text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 2 ? 1 : 0 }}
      >
        SCANNING VIDEO STREAM...
      </motion.p>
    </motion.div>
  );
}
