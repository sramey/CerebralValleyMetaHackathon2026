// Generates a synthetic cartoon head fixture for testing segmentation & object selection.
// Drawn with pure arithmetic (no real people, no camera, no network).
//
// Features:
// - Light background
// - Top half: dark hair
// - Bottom half: skin-colored face
// - Eyes: two small dark pupils inside the face

export const HEAD_W = 200;
export const HEAD_H = 200;

export const BG_COLOR = [240, 240, 240] as const;
export const HAIR_COLOR = [35, 25, 20] as const;
export const SKIN_COLOR = [225, 175, 135] as const;
export const EYE_COLOR = [20, 20, 20] as const;

export function drawCartoonHead(): { w: number; h: number; data: Uint8Array } {
  const data = new Uint8Array(HEAD_W * HEAD_H * 4);
  const cx = 100;
  const cy = 100;
  const r = 60; // head radius

  for (let y = 0; y < HEAD_H; y++) {
    for (let x = 0; x < HEAD_W; x++) {
      const o = (y * HEAD_W + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;

      if (distSq <= r * r) {
        // Inside head
        if (y < cy - 5) {
          // Hair on top
          data[o] = HAIR_COLOR[0];
          data[o + 1] = HAIR_COLOR[1];
          data[o + 2] = HAIR_COLOR[2];
          data[o + 3] = 255;
        } else {
          // Face on bottom
          // Check for small eyes at (80, 105) and (120, 105)
          const isLeftEye = (x - 80) * (x - 80) + (y - 105) * (y - 105) <= 16;
          const isRightEye = (x - 120) * (x - 120) + (y - 105) * (y - 105) <= 16;
          if (isLeftEye || isRightEye) {
            data[o] = EYE_COLOR[0];
            data[o + 1] = EYE_COLOR[1];
            data[o + 2] = EYE_COLOR[2];
            data[o + 3] = 255;
          } else {
            data[o] = SKIN_COLOR[0];
            data[o + 1] = SKIN_COLOR[1];
            data[o + 2] = SKIN_COLOR[2];
            data[o + 3] = 255;
          }
        }
      } else {
        // Background
        data[o] = BG_COLOR[0];
        data[o + 1] = BG_COLOR[1];
        data[o + 2] = BG_COLOR[2];
        data[o + 3] = 255;
      }
    }
  }

  return { w: HEAD_W, h: HEAD_H, data };
}
