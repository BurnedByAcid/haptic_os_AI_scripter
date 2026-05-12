import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 2500)
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.1 }}
      transition={{ duration: 0.6 }}
    >
      <div className="relative flex flex-col items-center justify-center gap-8">
        <motion.div
          className="relative w-24 h-24 flex items-center justify-center"
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <motion.div
            className="absolute inset-0 bg-[var(--color-brand-red)] rounded-2xl opacity-20"
            animate={{ scale: [1, 1.4, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="w-14 h-14 bg-[var(--color-brand-red)] rounded-md transform rotate-45"></div>
        </motion.div>

        <div className="overflow-hidden">
          <motion.h1 
            className="text-[12cqw] font-black font-display tracking-tight text-center leading-none"
            initial={{ y: "100%" }}
            animate={phase >= 1 ? { y: 0 } : { y: "100%" }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            HapticOS
          </motion.h1>
        </div>

        <motion.div
          className="bg-[var(--color-brand-red)] text-white px-6 py-2 rounded-full font-bold tracking-widest uppercase text-[3.5cqw]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          Launch Promo
        </motion.div>
      </div>
    </motion.div>
  );
}
