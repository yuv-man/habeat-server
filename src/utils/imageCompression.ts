import sharp from "sharp";
import logger from "./logger";

/**
 * Compress and resize an image from base64 string
 * @param base64Image - Base64 encoded image string (with or without data URI prefix)
 * @param maxWidth - Maximum width in pixels (default: 400)
 * @param maxHeight - Maximum height in pixels (default: 400)
 * @param quality - JPEG quality 1-100 (default: 80)
 * @param maxSizeKB - Maximum file size in KB (default: 100KB)
 * @returns Compressed base64 image string
 */
export async function compressImage(
  base64Image: string,
  maxWidth: number = 400,
  maxHeight: number = 400,
  quality: number = 80,
  maxSizeKB: number = 100
): Promise<string> {
  try {
    // Remove data URI prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Data = base64Image.includes(",")
      ? base64Image.split(",")[1]
      : base64Image;

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Get original image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const originalSizeKB = imageBuffer.length / 1024;

    logger.info(
      `[compressImage] Original: ${metadata.width}x${metadata.height}, ${originalSizeKB.toFixed(2)}KB`
    );

    // If image is already small enough, return as-is
    if (originalSizeKB <= maxSizeKB && metadata.width <= maxWidth && metadata.height <= maxHeight) {
      logger.info(`[compressImage] Image already small enough, returning as-is`);
      return base64Image;
    }

    // Compress and resize the image
    let compressedBuffer = await sharp(imageBuffer)
      .resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    // If still too large, reduce quality progressively
    let currentQuality = quality;
    let attempts = 0;
    const maxAttempts = 5;

    while (compressedBuffer.length / 1024 > maxSizeKB && attempts < maxAttempts && currentQuality > 20) {
      currentQuality = Math.max(20, currentQuality - 15);
      attempts++;

      logger.info(
        `[compressImage] Attempt ${attempts}: Size ${(compressedBuffer.length / 1024).toFixed(2)}KB > ${maxSizeKB}KB, reducing quality to ${currentQuality}`
      );

      compressedBuffer = await sharp(imageBuffer)
        .resize(maxWidth, maxHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: currentQuality, mozjpeg: true })
        .toBuffer();
    }

    const finalSizeKB = compressedBuffer.length / 1024;
    const compressionRatio = ((1 - compressedBuffer.length / imageBuffer.length) * 100).toFixed(1);

    logger.info(
      `[compressImage] Compressed: ${finalSizeKB.toFixed(2)}KB (${compressionRatio}% reduction)`
    );

    // Convert back to base64
    const compressedBase64 = compressedBuffer.toString("base64");

    // Return with data URI prefix if original had it
    if (base64Image.startsWith("data:")) {
      const mimeType = base64Image.match(/data:([^;]+)/)?.[1] || "image/jpeg";
      return `data:${mimeType};base64,${compressedBase64}`;
    }

    return compressedBase64;
  } catch (error: any) {
    logger.error(`[compressImage] Error compressing image: ${error.message}`);
    // If compression fails, return original image
    return base64Image;
  }
}

/**
 * Check if a string is a base64 image
 */
export function isBase64Image(str: string): boolean {
  if (!str || typeof str !== "string") {
    return false;
  }

  // Check if it's a data URI
  if (str.startsWith("data:image/")) {
    return true;
  }

  // Check if it's valid base64 (basic check)
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(str) && str.length > 100; // Base64 images are typically long strings
}

