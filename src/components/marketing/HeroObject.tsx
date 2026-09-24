'use client';
import * as React from 'react';
// Importing @react-three/fiber loads its JSX namespace augmentation, which is
// what makes intrinsic three elements (<mesh>, <ambientLight>, ...) type-check
// under @types/three. Keep this import in every file that uses those elements.
import { Canvas } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';

/**
 * HeroObject — the ONE lazy React Three Fiber decoration for the hero
 * (Section 6.1). A single soft floating rounded card that gently bobs and
 * rotates behind the product mockup.
 *
 * Contract:
 *   - Purely decorative: the <Canvas> is aria-hidden and pointer-events-none.
 *     It never captures interaction and carries no semantic meaning.
 *   - Lightweight: one mesh, drei <Float>, an ambient + one directional light,
 *     capped DPR ([1, 1.5]) and frameloop="always" only while floating (Float
 *     needs a running loop). No shadows, no post-processing, no textures.
 *   - The Hero is responsible for GATING (reduced motion, low core count,
 *     Save-Data) and for the static fallback; this component also self-guards
 *     defensively so it is safe to mount directly.
 *
 * Colors: three materials can't read CSS tokens, so we use neutral, theme-ish
 * tones chosen to sit under the gradient in both light and dark. These are the
 * only literal colors allowed and live behind an aria-hidden decorative canvas.
 */

/** Defensive client-side guard mirroring the Hero's gating (Section 6.1). */
function shouldRender3D(): boolean {
  if (typeof window === 'undefined') return false;
  // Reduced motion.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  // Low core count (weak device).
  const cores = navigator.hardwareConcurrency;
  if (typeof cores === 'number' && cores <= 4) return false;
  // Save-Data header (data-saver mode).
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  return true;
}

function FloatingCard() {
  return (
    <Float speed={1.4} rotationIntensity={0.6} floatIntensity={0.9}>
      <RoundedBox args={[2.4, 1.5, 0.18]} radius={0.14} smoothness={4}>
        {/* Soft indigo-ish material to echo the brand primary. */}
        <meshStandardMaterial color="#8b93d6" roughness={0.35} metalness={0.15} />
      </RoundedBox>
    </Float>
  );
}

export function HeroObject() {
  // Guard defensively even though the Hero already gates before importing.
  if (!shouldRender3D()) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 5], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        style={{ pointerEvents: 'none' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        <FloatingCard />
      </Canvas>
    </div>
  );
}

export default HeroObject;
