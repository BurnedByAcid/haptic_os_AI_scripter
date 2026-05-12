import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Ad1Scene1 } from './video_scenes/Ad1Scene1';
import { Ad1Scene2 } from './video_scenes/Ad1Scene2';
import { Ad1Scene3 } from './video_scenes/Ad1Scene3';
import { Ad2Scene1 } from './video_scenes/Ad2Scene1';
import { Ad2Scene2 } from './video_scenes/Ad2Scene2';
import { Ad2Scene3 } from './video_scenes/Ad2Scene3';
import { Ad3Scene1 } from './video_scenes/Ad3Scene1';
import { Ad3Scene2 } from './video_scenes/Ad3Scene2';
import { Ad3Scene3 } from './video_scenes/Ad3Scene3';

export const SCENE_DURATIONS = {
  ad1_1: 3000,
  ad1_2: 3000,
  ad1_3: 4000,
  ad2_1: 3000,
  ad2_2: 3000,
  ad2_3: 4000,
  ad3_1: 3000,
  ad3_2: 3000,
  ad3_3: 4000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  ad1_1: Ad1Scene1,
  ad1_2: Ad1Scene2,
  ad1_3: Ad1Scene3,
  ad2_1: Ad2Scene1,
  ad2_2: Ad2Scene2,
  ad2_3: Ad2Scene3,
  ad3_1: Ad3Scene1,
  ad3_2: Ad3Scene2,
  ad3_3: Ad3Scene3,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[var(--color-brand-dark)]">
      <div className="absolute inset-0 bg-noise z-0"></div>

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
