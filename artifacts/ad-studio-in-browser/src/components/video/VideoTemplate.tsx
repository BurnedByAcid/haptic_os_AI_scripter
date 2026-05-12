import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { CtaCard } from './components/CtaCard';

const SCENE_DURATIONS = {
  hook: 5000,
  build: 5000,
  cta: 6000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: Scene1,
  build: Scene2,
  cta: CtaCard,
};

export default function VideoTemplate() {
  const { currentSceneKey } = useVideoPlayer({ durations: SCENE_DURATIONS });
  const SceneComponent = SCENE_COMPONENTS[currentSceneKey];

  return (
    <div className="w-full h-screen bg-black flex items-center justify-center overflow-hidden">
      <div className="relative h-full aspect-square max-w-full overflow-hidden bg-[var(--color-brand-dark)]">
        <div className="absolute inset-0 bg-noise z-0" />
        <AnimatePresence mode="popLayout">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
