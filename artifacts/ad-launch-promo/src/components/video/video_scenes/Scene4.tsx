import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1500),
      setTimeout(() => setPhase(4), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10"
      initial={{ opacity: 0, y: "20%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, filter: 'blur(20px)', scale: 1.2 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="text-[6cqw] font-display font-black text-white/50 mb-2 italic"
        initial={{ opacity: 0, x: -20 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
      >
        OR GET
      </motion.div>

      <motion.h2 
        className="text-[12cqw] font-display font-black text-center leading-tight mb-8"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        40% OFF<br/>MONTHLY
      </motion.h2>

      <div className="flex flex-col items-center font-mono">
        <motion.div 
          className="relative text-[7cqw] text-white/50 mb-2"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        >
          $9.99/mo
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
          $5.99<span className="text-[6cqw]">/mo</span>
        </motion.div>
        
        <motion.div 
          className="text-[4cqw] text-white/40 mt-4 tracking-widest uppercase font-sans border border-white/20 px-4 py-1 rounded"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.3 }}
        >
          THIS MONTH ONLY
        </motion.div>
      </div>
    </motion.div>
  );
}
