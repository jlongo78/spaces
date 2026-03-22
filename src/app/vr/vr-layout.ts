export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface LayoutOptions {
  radius?: number;
  eyeHeight?: number;
}

export function computePanePositions(
  paneCount: number,
  options: LayoutOptions = {}
): Vec3[] {
  const { radius = 6, eyeHeight = 1.6 } = options;

  if (paneCount <= 0) return [];

  if (paneCount === 1) {
    return [{ x: 0, y: eyeHeight, z: radius }];
  }

  const totalArcDeg =
    paneCount <= 2 ? 70 :
    paneCount <= 4 ? 140 :
    paneCount <= 6 ? 180 : 220;

  const startAngle = 90 - totalArcDeg / 2;
  const step = totalArcDeg / (paneCount - 1);

  const positions: Vec3[] = [];
  for (let i = 0; i < paneCount; i++) {
    const angleDeg = startAngle + step * i;
    const angleRad = (angleDeg * Math.PI) / 180;
    positions.push({
      x: Math.cos(angleRad) * radius,
      y: eyeHeight,
      z: Math.sin(angleRad) * radius,
    });
  }

  return positions;
}
