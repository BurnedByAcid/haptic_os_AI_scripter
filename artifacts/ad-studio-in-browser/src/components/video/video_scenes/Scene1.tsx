import { motion } from 'framer-motion';

export function Scene1() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center p-8 gap-8"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
    >
      <motion.h1
        className="text-4xl font-display font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-white to-white/50 leading-tight"
      >
        Your Studio<br />in the Browser
      </motion.h1>

      <div className="relative w-full aspect-[5/3] bg-[#111] rounded-xl border border-white/10 shadow-2xl p-4 overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          <div className="ml-3 font-mono text-[10px] text-white/40">HapticOS / Editor</div>
        </div>

        <div className="flex-1 flex gap-3">
          <div className="w-1/3 bg-[#1A1A1C] rounded border border-white/5 p-3 flex flex-col gap-2">
            <div className="h-5 bg-white/5 rounded w-full" />
            <div className="h-5 bg-white/5 rounded w-3/4" />
            <div className="h-5 bg-white/5 rounded w-5/6" />
          </div>
          <div className="flex-1 bg-[#1A1A1C] rounded border border-white/5 relative overflow-hidden">
            <div className="absolute inset-0 bg-grid opacity-10" />
            <motion.div
              className="absolute top-1/2 left-0 right-0 h-10 -translate-y-1/2 bg-[var(--color-brand-red-dim)] border-y border-[var(--color-brand-red)]/50"
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
            />
            <motion.div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_white]"
              animate={{ left: ['10%', '90%', '10%'] }}
              transition={{ duration: 4, ease: 'linear', repeat: Infinity }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
