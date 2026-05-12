import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 2800)
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10"
      initial={{ opacity: 0, x: "100%" }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: "-100%", scale: 0.9 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="text-center w-full max-w-[80cqw]">
        <motion.h2 
          className="text-[6cqw] font-body text-white/60 mb-2 uppercase tracking-widest font-bold"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.4 }}
        >
          Every New User Gets
        </motion.h2>
        
        <div className="overflow-hidden py-4">
          <motion.h1 
            className="text-[18cqw] font-display font-black leading-none text-[var(--color-brand-cream)]"
            initial={{ y: "100%" }}
            animate={phase >= 2 ? { y: 0 } : { y: "100%" }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            FIRST
          </motion.h1>
        </div>

        <div className="flex items-center justify-center gap-4 my-2">
          <motion.span 
            className="text-[28cqw] font-display font-black text-[var(--color-brand-red)] leading-none"
            initial={{ scale: 0, rotate: -20 }}
            animate={phase >= 3 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            4
          </motion.span>
          <motion.div 
            className="flex flex-col items-start justify-center"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <span className="text-[10cqw] font-display font-black leading-none">DAYS</span>
            <span className="text-[10cqw] font-display font-black leading-none text-[var(--color-brand-red)]">FREE</span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
