import { motion } from 'framer-motion';

export function Ad3Scene1() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-12"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
    >
      <motion.h1 
        className="text-5xl font-display font-bold mb-12 text-center bg-clip-text text-transparent bg-gradient-to-r from-white to-white/50"
      >
        Your Studio in the Browser
      </motion.h1>

      <div className="relative w-full max-w-4xl h-[400px] bg-[#111] rounded-xl border border-white/10 shadow-2xl p-6 overflow-hidden flex flex-col">
        {/* Fake UI Header */}
        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/10">
          <div className="w-3 h-3 rounded-full bg-red-500/50" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
          <div className="w-3 h-3 rounded-full bg-green-500/50" />
          <div className="ml-4 font-mono text-xs text-white/40">HapticOS / Editor</div>
        </div>

        {/* Fake UI Body */}
        <div className="flex-1 flex gap-6">
          <div className="w-64 bg-[#1A1A1C] rounded border border-white/5 p-4 flex flex-col gap-4">
             <div className="h-8 bg-white/5 rounded w-full" />
             <div className="h-8 bg-white/5 rounded w-3/4" />
             <div className="h-8 bg-white/5 rounded w-5/6" />
          </div>
          <div className="flex-1 bg-[#1A1A1C] rounded border border-white/5 relative overflow-hidden">
             <div className="absolute inset-0 bg-grid opacity-10" />
             <motion.div 
               className="absolute top-1/2 left-0 right-0 h-16 -translate-y-1/2 bg-[var(--color-brand-red-dim)] border-y border-[var(--color-brand-red)]/50"
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
