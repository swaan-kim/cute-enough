import type { CoatColor, PetTraitsV1 } from '../types';
import { getSoftPointColor } from './petStyle';

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.86;

const PALETTE: Record<CoatColor, readonly [number, number, number]> = {
  cream: [226, 203, 158],
  caramel: [170, 105, 48],
  chocolate: [82, 48, 34],
  black: [28, 27, 25],
  gray: [132, 130, 126],
  white: [238, 237, 231],
};

export interface LocalPetImageAnalysis {
  dataUri: string;
  traits: PetTraitsV1;
  brightness: number;
  notice?: string;
}

export interface ColorAnalysis {
  baseColor: CoatColor;
  secondaryColor: CoatColor;
  brightness: number;
  confidence: number;
}

function colorDistance(r: number, g: number, b: number, target: readonly [number, number, number]) {
  // Human vision is more sensitive to green, so weight the channels accordingly.
  return ((r - target[0]) ** 2 * 0.3) + ((g - target[1]) ** 2 * 0.59) + ((b - target[2]) ** 2 * 0.11);
}

export function analyzePixelColors(pixels: Uint8ClampedArray): ColorAnalysis {
  const counts = new Map<CoatColor, number>(Object.keys(PALETTE).map((key) => [key as CoatColor, 0]));
  let luminanceTotal = 0;
  let samples = 0;

  // Sampling every fourth pixel is accurate enough for a suggested coat color and keeps large photos responsive.
  for (let index = 0; index < pixels.length; index += 16) {
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const luminance = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
    luminanceTotal += luminance;
    samples += 1;

    let nearest: CoatColor = 'cream';
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [color, target] of Object.entries(PALETTE) as Array<[CoatColor, readonly [number, number, number]]>) {
      const distance = colorDistance(r, g, b, target);
      if (distance < nearestDistance) {
        nearest = color;
        nearestDistance = distance;
      }
    }
    counts.set(nearest, (counts.get(nearest) ?? 0) + 1);
  }

  if (samples === 0) throw new Error('사진의 색상을 읽지 못했어요. 다른 사진을 골라주세요.');
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const baseColor = ranked[0][0];
  // 배경색이 섞이기 쉬운 두 번째 색은 자동 확정하지 않고, 대표색과
  // 부드럽게 어울리는 안전한 제안만 사용해요. 사용자가 다음 단계에서 직접 확인합니다.
  const secondaryColor = getSoftPointColor(baseColor);
  const share = ranked[0][1] / samples;

  return {
    baseColor,
    secondaryColor,
    brightness: Math.round(luminanceTotal / samples),
    confidence: Math.round(Math.min(0.78, Math.max(0.35, share)) * 100) / 100,
  };
}
function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('사진을 열지 못했어요. JPG, PNG 또는 WEBP 사진을 골라주세요.'));
    image.src = dataUri;
  });
}

export async function normalizeAndAnalyzePetImage(sourceDataUri: string): Promise<LocalPetImageAnalysis> {
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(sourceDataUri)) {
    throw new Error('JPG, PNG 또는 WEBP 사진만 올릴 수 있어요.');
  }

  const image = await loadImage(sourceDataUri);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('사진 크기를 확인하지 못했어요.');
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 기기에서는 사진을 처리하지 못했어요.');

  // Flatten transparency before JPEG re-encoding. Canvas output contains no EXIF or original metadata.
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const insetX = Math.floor(width * 0.12);
  const insetY = Math.floor(height * 0.12);
  const sampleWidth = Math.max(1, width - insetX * 2);
  const sampleHeight = Math.max(1, height - insetY * 2);
  const colors = analyzePixelColors(context.getImageData(insetX, insetY, sampleWidth, sampleHeight).data);
  const dataUri = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (!dataUri.startsWith('data:image/jpeg;base64,')) throw new Error('사진을 안전한 형식으로 바꾸지 못했어요.');

  const notice = colors.brightness < 55
    ? '사진이 조금 어두워요. 아래 특징이 맞는지 확인해 주세요.'
    : colors.brightness > 225
      ? '사진이 많이 밝아요. 아래 특징이 맞는지 확인해 주세요.'
      : undefined;

  return {
    dataUri,
    brightness: colors.brightness,
    notice,
    traits: {
      schemaVersion: 1,
      earShape: 'floppy',
      headShape: 'round',
      baseColor: colors.baseColor,
      secondaryColor: colors.secondaryColor,
      markingPattern: 'none',
      muzzle: 'short',
      confidence: colors.confidence,
    },
  };
}
