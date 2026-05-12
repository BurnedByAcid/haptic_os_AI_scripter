import { motion } from 'framer-motion';

export function Ad3Scene2() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center p-12"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
    >
      <div className="grid grid-cols-2 gap-12 w-full max-w-5xl">
        {/* Presets Block */}
        <motion.div 
          className="bg-[#111] p-8 rounded-xl border border-white/10 relative overflow-hidden group"
          whileHover={{ scale: 1.02 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-brand-red-dim)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <h3 className="font-display text-2xl mb-6">Built-in Presets</h3>
          <div className="space-y-3">
            {['Linear Burst', 'Sine Wave', 'Stutter Step'].map((t, i) => (
              <motion.div 
                key={t}
                className="bg-[#1A1A1C] px-4 py-3 rounded text-sm font-mono text-white/70 border border-white/5"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                {t}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Export Block */}
        <motion.div 
          className="bg-[#111] p-8 rounded-xl border border-white/10 flex flex-col items-center justify-center"
        >
          <motion.div 
            className="w-24 h-24 rounded-full bg-[var(--color-brand-red)]/20 flex items-center justify-center mb-6"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <svg className="w-10 h-10 text-[var(--color-brand-red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </motion.div>
          <h3 className="font-display text-2xl mb-2">One-Click Export</h3>
          <p className="text-white/50 font-mono text-sm">.funscript • .csv</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
