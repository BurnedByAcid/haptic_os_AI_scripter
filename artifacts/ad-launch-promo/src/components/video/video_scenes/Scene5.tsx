import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HapticOsLogo } from '../components/HapticOsLogo';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10 bg-[var(--color-brand-dark)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={phase >= 1 ? { scale: 1.5, opacity: 1, y: 0 } : { scale: 0.8, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="mb-12"
      >
        <HapticOsLogo animate={true} />
      </motion.div>

      <motion.h2 
        className="text-[7cqw] font-display font-medium text-center text-white/80 tracking-wide mb-16"
        initial={{ opacity: 0, filter: 'blur(10px)' }}
        animate={phase >= 2 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
        transition={{ duration: 0.8 }}
      >
        Control the feeling.
      </motion.h2>

      <motion.div
        className="text-[6cqw] font-mono text-[var(--color-brand-red)] border-b-2 border-[var(--color-brand-red)] pb-1"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        hapticos.app
      </motion.div>
    </motion.div>
  );
}
