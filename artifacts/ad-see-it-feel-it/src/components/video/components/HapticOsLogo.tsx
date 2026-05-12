import { motion } from 'framer-motion';

export function HapticOsLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 font-display ${className}`}>
      <div className="relative w-8 h-8 flex items-center justify-center">
        <motion.div
          className="absolute inset-0 bg-[var(--color-brand-red)] rounded-md opacity-20"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="w-5 h-5 bg-[var(--color-brand-red)] rounded-sm transform rotate-45"></div>
      </div>
      <span className="text-2xl font-bold tracking-tight">HapticOS</span>
    </div>
  );
}
