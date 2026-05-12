import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 3000, free: 3500, yearly: 4500, monthly: 4000, close: 4000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="w-full h-screen bg-black flex items-center justify-center overflow-hidden">
      <div className="relative h-full aspect-[9/16] bg-[var(--color-brand-dark)] overflow-hidden shadow-2xl max-w-full" style={{ containerType: 'inline-size' }}>
        {/* Persistent background layers */}
        <div className="absolute inset-0 z-0">
          {/* Subtle noise */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
          
          {/* Drifting red glow */}
          <motion.div 
            className="absolute w-[150vw] h-[150vw] rounded-full blur-[100px] opacity-[0.15]"
            style={{ background: 'radial-gradient(circle, var(--color-brand-red), transparent 70%)' }}
            animate={{ 
              x: ['-50%', '-20%', '-60%', '-40%', '-50%'][currentScene] || '-50%',
              y: ['-50%', '-30%', '-70%', '-10%', '-50%'][currentScene] || '-50%',
              scale: [1, 1.2, 0.8, 1.1, 1][currentScene] || 1
            }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="open" />}
          {currentScene === 1 && <Scene2 key="free" />}
          {currentScene === 2 && <Scene3 key="yearly" />}
          {currentScene === 3 && <Scene4 key="monthly" />}
          {currentScene === 4 && <Scene5 key="close" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
