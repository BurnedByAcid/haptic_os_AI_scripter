import { useState, useEffect, useRef } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Games() {
  const { key, connected } = useHandy();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => parseInt(localStorage.getItem("handy_fappy_highscore") || "0"));
  const [gameOver, setGameOver] = useState(false);

  // Game state refs to avoid dependency cycle in RAF
  const gameState = useRef({
    birdY: 300,
    birdVelocity: 0,
    pipes: [] as {x: number, y: number, height: number}[],
    score: 0,
    frames: 0,
    gap: 150,
  });

  const flap = () => {
    if (gameOver) {
      resetGame();
      return;
    }
    if (!isPlaying) {
      setIsPlaying(true);
    }
    gameState.current.birdVelocity = -8;
    if (connected && key) {
      setHDSP(key, 100, 87);
      setTimeout(() => setHDSP(key, 0, 87), 150);
    }
  };

  const resetGame = () => {
    gameState.current = {
      birdY: 300,
      birdVelocity: 0,
      pipes: [],
      score: 0,
      frames: 0,
      gap: 150,
    };
    setScore(0);
    setGameOver(false);
    setIsPlaying(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isPlaying && !gameOver) {
        gameState.current.birdVelocity += 0.4; // gravity
        gameState.current.birdY += gameState.current.birdVelocity;
        gameState.current.frames++;

        // Add pipes
        if (gameState.current.frames % 100 === 0) {
          gameState.current.gap = Math.max(80, 150 - Math.floor(gameState.current.score / 10) * 5);
          gameState.current.pipes.push({
            x: canvas.width,
            y: Math.random() * (canvas.height - gameState.current.gap - 100) + 50,
            height: gameState.current.gap
          });
        }

        // Update pipes
        for (let i = gameState.current.pipes.length - 1; i >= 0; i--) {
          const p = gameState.current.pipes[i];
          p.x -= 3;

          // Collision
          if (
            (50 + 20 > p.x && 50 < p.x + 60) &&
            (gameState.current.birdY < p.y || gameState.current.birdY + 20 > p.y + p.height)
          ) {
            setGameOver(true);
          }

          // Score
          if (p.x === 47) {
            gameState.current.score++;
            setScore(gameState.current.score);
          }

          if (p.x < -60) {
            gameState.current.pipes.splice(i, 1);
          }
        }

        if (gameState.current.birdY > canvas.height || gameState.current.birdY < 0) {
          setGameOver(true);
        }
      }

      // Draw pipes
      ctx.fillStyle = "hsl(186, 100%, 50%)"; // primary
      gameState.current.pipes.forEach(p => {
        ctx.fillRect(p.x, 0, 60, p.y);
        ctx.fillRect(p.x, p.y + p.height, 60, canvas.height - p.y - p.height);
      });

      // Draw bird
      ctx.fillStyle = "hsl(0, 0%, 100%)";
      ctx.beginPath();
      ctx.arc(50, gameState.current.birdY, 10, 0, Math.PI * 2);
      ctx.fill();

      if (gameOver) {
        if (gameState.current.score > highScore) {
          setHighScore(gameState.current.score);
          localStorage.setItem("handy_fappy_highscore", gameState.current.score.toString());
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying, gameOver, highScore, connected, key]);

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fappy Bird</h1>
          <p className="text-muted-foreground">Flap to fly. Hit the pipe gap, get a stroke.</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground uppercase tracking-wider font-bold">High Score</div>
          <div className="text-2xl font-mono text-primary">{highScore}</div>
        </div>
      </div>

      <Card className="flex-1 bg-black overflow-hidden relative border-border/50 outline-none select-none" tabIndex={0} onKeyDown={(e) => e.code === "Space" && flap()}>
        <canvas 
          ref={canvasRef} 
          width={800} 
          height={600} 
          className="w-full h-full object-cover cursor-pointer"
          onClick={flap}
        />
        
        {!isPlaying && !gameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
            <div className="text-center">
              <h2 className="text-4xl font-bold mb-4 text-white">Click or Space to Start</h2>
            </div>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 pointer-events-none">
            <h2 className="text-5xl font-bold text-destructive mb-2">GAME OVER</h2>
            <p className="text-2xl text-white mb-8">Score: {score}</p>
            <p className="text-muted-foreground animate-pulse">Click or Space to restart</p>
          </div>
        )}

        <div className="absolute top-4 left-4">
          <div className="text-4xl font-mono font-bold text-white drop-shadow-md">{score}</div>
        </div>
        
        <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur px-3 py-1.5 rounded-full border border-border">
          <div className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs font-medium">{connected ? "Haptics Enabled" : "No Device"}</span>
        </div>
      </Card>
    </div>
  );
}
