import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10"
      initial={{ opacity: 0, scale: 1.2 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: "-20%" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="bg-[var(--color-brand-red)] text-white px-4 py-1.5 rounded text-[3.5cqw] font-bold tracking-wider uppercase mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
      >
        Sign up before May 31st
      </motion.div>

      <motion.h2 
        className="text-[12cqw] font-display font-black text-center leading-tight mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        HALF-OFF<br/>YEARLY
      </motion.h2>

      <div className="flex flex-col items-center font-mono">
        <motion.div 
          className="relative text-[7cqw] text-white/50 mb-2"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        >
          $99.99/year
          <motion.div 
            className="absolute top-1/2 left-[-5%] w-[110%] h-[2px] bg-[var(--color-brand-red)]"
            initial={{ width: 0 }}
            animate={phase >= 3 ? { width: '110%' } : { width: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          />
        </motion.div>
        
        <motion.div 
          className="text-[14cqw] font-bold text-[var(--color-brand-red)] leading-none"
          initial={{ opacity: 0, scale: 0.5, y: 20 }}
          animate={phase >= 4 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
        >
          $49.99<span className="text-[6cqw]">/yr</span>
        </motion.div>
        
        <motion.div 
          className="text-[4cqw] text-white/40 mt-2 tracking-widest uppercase font-sans"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.3 }}
        >
          (12 MONTHS)
        </motion.div>
      </div>
    </motion.div>
  );
}
