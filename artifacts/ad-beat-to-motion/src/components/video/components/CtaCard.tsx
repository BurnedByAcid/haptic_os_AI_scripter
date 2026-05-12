import { motion } from 'framer-motion';
import { HapticOsLogo } from './HapticOsLogo';

export function CtaCard() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-brand-dark)] z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.8, type: 'spring' }}
        className="flex flex-col items-center"
      >
        <HapticOsLogo className="scale-150 mb-8" />

        <motion.h2
          className="text-4xl font-display font-bold text-white mb-6 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          Control the feeling.
        </motion.h2>

        <motion.div
          className="px-6 py-2 rounded-full border border-[var(--color-brand-gray-light)] bg-[var(--color-brand-gray)]/50"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.9, type: 'spring' }}
        >
          <span className="font-mono text-[var(--color-brand-red)]">hapticos.app</span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
