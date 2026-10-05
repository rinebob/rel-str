/**
 * Storage writer — artifact persistence to the default Firebase Storage
 * bucket (task #768). Deliberately thin: callers own path construction
 * (`buildScreenshotStoragePath`) and content types; this owns only the GCS
 * write shape so the callable seam and verify scripts share one writer.
 * String or Buffer bodies — SVG today, PNG once the rasterizer lands (#769).
 */
import type { Storage } from 'firebase-admin/storage';

// @google-cloud/storage ships dual CJS/ESM types — getStorage().bucket()
// resolves to the CJS declaration, so derive Bucket from firebase-admin's
// own signature rather than importing the package type directly.
export type Bucket = ReturnType<Storage['bucket']>;

export type ArtifactWriter = (
  path: string,
  body: string | Buffer,
  contentType: string,
) => Promise<void>;

export function createArtifactWriter(bucket: Bucket): ArtifactWriter {
  return async (path, body, contentType) => {
    await bucket.file(path).save(body, {
      metadata: { contentType },
      resumable: false,
    });
  };
}
