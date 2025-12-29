import { Injectable, inject } from '@angular/core';
import { Storage, deleteObject, ref, uploadBytes } from '@angular/fire/storage';

export interface UploadFilesParams {
  uid: string;
  /** Storage path prefix, e.g. trades/users/{uid}/{tradeId}/screenshots */
  pathPrefix: string;
  files: File[];
}

export interface DeleteFilesParams {
  paths: string[];
}

@Injectable({ providedIn: 'root' })
export class FirebaseStorageService {
  private readonly storage = inject(Storage);

  async uploadFiles(params: UploadFilesParams): Promise<string[]> {
    const { pathPrefix, files } = params;

    const uploadedPaths: string[] = [];

    for (const file of files) {
      const sanitizedName = file.name.trim();
      const path = `${pathPrefix}/${sanitizedName}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      uploadedPaths.push(path);
    }

    return uploadedPaths;
  }

  async deleteFiles(params: DeleteFilesParams): Promise<void> {
    const { paths } = params;

    await Promise.all(
      paths.filter((p) => !!p).map(async (p) => {
        const storageRef = ref(this.storage, p);
        await deleteObject(storageRef).catch(() => {
          // Best-effort delete; ignore not-found and transient errors for now.
        });
      }),
    );
  }
}
