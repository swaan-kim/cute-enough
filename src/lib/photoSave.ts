import { File } from '@apps-in-toss/web-framework';
import { isPreviewRuntime } from './runtime';
import { limitPetName } from './petName';

export type PhotoSaveDestination = 'device' | 'download';

export function getBrandedPhotoLabel(petName?: string): string {
  const safeName = limitPetName((petName ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
    .trim());
  return safeName || '강아지';
}

export function buildBrandedPhotoFileName(petName?: string, now = new Date()): string {
  const safeName = getBrandedPhotoLabel(petName);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replaceAll('-', '');
  return `${safeName}-${date}.jpg`;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawWatermark(context: CanvasRenderingContext2D, width: number, height: number, label: string) {
  const scale = Math.max(0.72, Math.min(1.7, Math.min(width, height) / 640));
  const margin = Math.round(18 * scale);
  const pillHeight = Math.round(38 * scale);
  const iconSize = Math.round(22 * scale);
  const fontSize = Math.round(18 * scale);
  const horizontalPadding = Math.round(12 * scale);

  context.save();
  context.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  context.textBaseline = 'middle';
  const textWidth = context.measureText(label).width;
  const pillWidth = Math.ceil(horizontalPadding * 2 + iconSize + 7 * scale + textWidth);
  const x = width - margin - pillWidth;
  const y = height - margin - pillHeight;

  context.shadowColor = 'rgba(25, 31, 40, 0.14)';
  context.shadowBlur = 10 * scale;
  context.shadowOffsetY = 2 * scale;
  roundedRectPath(context, x, y, pillWidth, pillHeight, pillHeight / 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.88)';
  context.fill();
  context.shadowColor = 'transparent';

  const iconX = x + horizontalPadding;
  const iconY = y + (pillHeight - iconSize) / 2;
  roundedRectPath(context, iconX, iconY, iconSize, iconSize, 6 * scale);
  context.fillStyle = '#ff6b8a';
  context.fill();
  context.beginPath();
  context.arc(iconX + iconSize / 2, iconY + iconSize / 2, 4.1 * scale, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();
  context.beginPath();
  context.arc(iconX + iconSize * 0.72, iconY + iconSize * 0.28, 1.4 * scale, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#4e342e';
  context.fillText(label, iconX + iconSize + 7 * scale, y + pillHeight / 2 + 0.5 * scale);
  context.restore();
}

async function loadImageFromUrl(photoUrl: string): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  const response = await fetch(photoUrl, { credentials: 'omit' });
  if (!response.ok) throw new Error('사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('저장할 수 있는 사진 형식이 아니에요.');
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('사진을 저장용으로 준비하지 못했어요.'));
    image.src = objectUrl;
  });
  return { image, objectUrl };
}

export async function createBrandedPhotoData(photoUrl: string, petName?: string): Promise<{ base64: string; dataUrl: string }> {
  const { image, objectUrl } = await loadImageFromUrl(photoUrl);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context || canvas.width < 1 || canvas.height < 1) throw new Error('사진을 저장용으로 준비하지 못했어요.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawWatermark(context, canvas.width, canvas.height, getBrandedPhotoLabel(petName));
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function saveBrandedPetPhoto(photoUrl: string, petName?: string): Promise<PhotoSaveDestination> {
  const { base64, dataUrl } = await createBrandedPhotoData(photoUrl, petName);
  const fileName = buildBrandedPhotoFileName(petName);

  if (!isPreviewRuntime) {
    if (!File.saveBase64.isSupported()) {
      throw new Error('사진 저장을 사용하려면 토스앱을 최신 버전으로 업데이트해 주세요.');
    }
    await File.saveBase64({ data: base64, fileName, mimeType: 'image/jpeg' });
    return 'device';
  }

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return 'download';
}
