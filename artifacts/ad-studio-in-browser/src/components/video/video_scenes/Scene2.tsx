import { motion } from 'framer-motion';

export function Scene2() {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center p-8"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
    >
      <div className="grid grid-cols-1 gap-4 w-full">
        <motion.div
          className="bg-[#111] p-6 rounded-xl border border-white/10 relative overflow-hidden"
        >
          <h3 className="font-display text-xl mb-4">Built-in Presets</h3>
          <div className="space-y-2">
            {['Linear Burst', 'Sine Wave', 'Stutter Step'].map((t, i) => (
              <motion.div
                key={t}
                className="bg-[#1A1A1C] px-3 py-2 rounded text-sm font-mono text-white/70 border border-white/5"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                {t}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          className="bg-[#111] p-6 rounded-xl border border-white/10 flex flex-col items-center justify-center"
        >
          <motion.div
            className="w-16 h-16 rounded-full bg-[var(--color-brand-red)]/20 flex items-center justify-center mb-3"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <svg className="w-8 h-8 text-[var(--color-brand-red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </motion.div>
          <h3 className="font-display text-xl mb-1">One-Click Export</h3>
          <p className="text-white/50 font-mono text-xs">.funscript • .csv</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
