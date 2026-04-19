import { readFile } from 'fs/promises';
import { logger } from '../../../utils/logger.js';
import type { ImageOutput } from './types.js';
import {
  API_IMAGE_MAX_BASE64_SIZE,
  DEFAULT_LIMITS,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
  MaxFileReadTokenExceededError,
} from './limits.js';

export type ImageDimensions = {
  originalWidth: number;
  originalHeight: number;
  displayWidth?: number;
  displayHeight?: number;
};

export type ImageResult = {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  originalSize: number;
  dimensions?: ImageDimensions;
};

/** 支持的图片扩展名 */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** 检测图片格式 */
export function detectImageFormat(buffer: Buffer): string {
  if (buffer.length < 4) return 'png';

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif';
  // WebP: 52 49 46 46 (RIFF header, then WEBP)
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'webp';

  return 'png';
}

/** 估算图片 token 数 */
function estimateImageTokens(base64Length: number): number {
  return Math.ceil(base64Length * 0.125);
}

/**
 * 使用 sharp 调整图片大小和压缩
 * 动态导入 sharp，失败时提供降级方案
 */
async function resizeWithSharp(
  imageBuffer: Buffer,
  format: string,
): Promise<{ buffer: Buffer; format: string; dimensions?: ImageDimensions }> {
  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default || sharpModule;

    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;
    const actualFormat = metadata.format || format;

    // 标准化格式名称
    const normalizedFormat = actualFormat === 'jpg' ? 'jpeg' : actualFormat;

    // 如果尺寸和大小都在限制内，直接返回
    if (
      imageBuffer.length <= IMAGE_TARGET_RAW_SIZE &&
      originalWidth <= IMAGE_MAX_WIDTH &&
      originalHeight <= IMAGE_MAX_HEIGHT
    ) {
      return {
        buffer: imageBuffer,
        format: normalizedFormat,
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: originalWidth,
          displayHeight: originalHeight,
        },
      };
    }

    // 需要调整大小或压缩
    let processed = image;

    // 如果尺寸超限，先 resize
    if (originalWidth > IMAGE_MAX_WIDTH || originalHeight > IMAGE_MAX_HEIGHT) {
      processed = processed.resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // 根据格式压缩
    let resultBuffer: Buffer;
    if (normalizedFormat === 'png') {
      resultBuffer = await processed.png({ compressionLevel: 9, palette: true }).toBuffer();
      // 如果还是太大，转为 JPEG
      if (resultBuffer.length > IMAGE_TARGET_RAW_SIZE) {
        resultBuffer = await processed.jpeg({ quality: 80 }).toBuffer();
      }
    } else {
      // JPEG/WebP/GIF 使用 quality 压缩
      const quality = imageBuffer.length > IMAGE_TARGET_RAW_SIZE * 2 ? 60 : 80;
      resultBuffer = await processed.jpeg({ quality }).toBuffer();
    }

    const newMetadata = await sharp(resultBuffer).metadata();

    return {
      buffer: resultBuffer,
      format: resultBuffer.length > IMAGE_TARGET_RAW_SIZE ? 'jpeg' : normalizedFormat,
      dimensions: {
        originalWidth,
        originalHeight,
        displayWidth: newMetadata.width || originalWidth,
        displayHeight: newMetadata.height || originalHeight,
      },
    };
  } catch (error) {
    // sharp 导入失败，返回原始 buffer
    logger.warn('sharp not available, using original image');
    return { buffer: imageBuffer, format };
  }
}

/**
 * Aggressive 压缩（当标准压缩仍超出 token 预算时）
 */
async function compressAggressively(
  imageBuffer: Buffer,
  maxTokens: number,
  format: string,
): Promise<{ buffer: Buffer; format: string }> {
  try {
    const sharpModule = await import('sharp');
    const sharp = (sharpModule as any).default || sharpModule;

    const maxBase64Size = Math.floor(maxTokens / 0.125);

    // 逐步降低质量直到满足要求
    const qualities = [60, 40, 20];
    for (const quality of qualities) {
      const compressed = await sharp(imageBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();

      const base64 = compressed.toString('base64');
      if (base64.length <= maxBase64Size) {
        return { buffer: compressed, format: 'jpeg' };
      }
    }

    // 最后手段：极低质量
    const fallback = await sharp(imageBuffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 10 })
      .toBuffer();

    return { buffer: fallback, format: 'jpeg' };
  } catch {
    // sharp 不可用，无法压缩
    throw new Error('Image exceeds token budget and sharp is not available for compression');
  }
}

/**
 * 读取图片文件
 */
export async function readImage(
  filePath: string,
  maxTokens: number = DEFAULT_LIMITS.maxTokens,
): Promise<ImageOutput> {
  const imageBuffer = await readFile(filePath);
  const originalSize = imageBuffer.length;

  if (originalSize === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }

  const detectedFormat = detectImageFormat(imageBuffer);

  // 标准 resize
  const resized = await resizeWithSharp(imageBuffer, detectedFormat);

  let resultBuffer = resized.buffer;
  let resultFormat = resized.format;
  let dimensions = resized.dimensions;

  // Token 预算检查
  const base64 = resultBuffer.toString('base64');
  const estimatedTokens = estimateImageTokens(base64.length);

  if (estimatedTokens > maxTokens) {
    // Aggressive 压缩
    const compressed = await compressAggressively(imageBuffer, maxTokens, detectedFormat);
    resultBuffer = compressed.buffer;
    resultFormat = compressed.format;

    // 更新 dimensions（压缩后尺寸可能变化）
    if (dimensions) {
      dimensions.displayWidth = undefined;
      dimensions.displayHeight = undefined;
    }
  }

  const finalBase64 = resultBuffer.toString('base64');
  const finalTokens = estimateImageTokens(finalBase64.length);

  if (finalTokens > maxTokens) {
    throw new MaxFileReadTokenExceededError(finalTokens, maxTokens);
  }

  // 标准化 mediaType
  const mediaType = `image/${resultFormat}` as ImageOutput['file']['mediaType'];

  return {
    type: 'image',
    file: {
      base64: finalBase64,
      mediaType,
      originalSize,
      dimensions,
    },
  };
}
