'use client';

/**
 * ImageUpload — reusable direct-to-Cloudinary image uploader.
 *
 * Drives the pet-photo / business-logo / booking-pet-photo upload experience.
 * The flow is entirely client-side up to the point of a signed hand-off:
 *
 *   1. User selects a file.
 *   2. Client-side validation (Requirements 23.1, 23.3): image type restricted
 *      to PNG/JPG/WebP, max 5MB, min 100x100px. Any failure surfaces a specific
 *      message and leaves the rest of the form untouched (retry-friendly).
 *   3. A local object-URL thumbnail is shown immediately (Requirement 23.4:
 *      preview well within 2s — it is synchronous).
 *   4. The component requests a signed-upload envelope from the server
 *      (the api_secret never reaches the browser) and POSTs the file directly
 *      to Cloudinary via XMLHttpRequest so upload progress can be reported as a
 *      percentage (Requirement 23.5).
 *   5. On success the returned `secure_url` is passed to `onChange` and the
 *      status flips to 'complete' (Requirement 23.2). On failure a specific
 *      error is shown and the user can retry without losing other form data
 *      (Requirement 23.3).
 *
 * The component is controlled via `value` (the current image URL) + `onChange`,
 * so it slots into React Hook Form (`Controller`) or plain state alike.
 *
 * _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_
 */
import * as React from 'react';
import {
  getUploadSignature,
  getBookingPetPhotoUploadSignature,
} from '@/lib/upload/cloudinary';
import type { UploadSignature } from '@/lib/upload/types';

/** The upload contexts this component supports. */
export type ImageUploadContext = 'petPhoto' | 'groomerLogo' | 'bookingPetPhoto';

export interface ImageUploadProps {
  /** Current image URL (controlled). Empty/undefined means "no image yet". */
  value?: string;
  /** Called with the Cloudinary `secure_url` once an upload completes. */
  onChange: (url: string) => void;
  /** Which upload context this instance serves (selects auth + folder). */
  context: ImageUploadContext;
  /** Optional accessible label for the file input. */
  label?: string;
  /** Optional id so an external <label> can target the file input. */
  id?: string;
  /** Disable interaction (e.g. while the parent form is submitting). */
  disabled?: boolean;
}

/** Allowed MIME types (Requirement 23.1). */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Max file size: 5MB (Requirement 23.1). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
/** Minimum dimensions in px, each side (Requirement 23.1). */
const MIN_DIMENSION_PX = 100;

/** The upload status state machine reflected in the UI (Requirement 23.2). */
type UploadStatus = 'idle' | 'validating' | 'uploading' | 'complete' | 'error';

/** A human-readable size for error messages. */
function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Loads an object-URL into an Image to read its natural dimensions. Resolves
 * with width/height, or rejects if the browser cannot decode the file (which
 * we treat as an unsupported/corrupt image).
 */
function readImageDimensions(
  objectUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('decode-failed'));
    img.src = objectUrl;
  });
}

/**
 * Validates the selected file against type, size, and dimension rules. Returns
 * a specific error message string when invalid, or `null` when the file passes.
 * `objectUrl` is a pre-created object URL for the file (reused for the preview).
 */
async function validateFile(file: File, objectUrl: string): Promise<string | null> {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'Unsupported format. Please upload a PNG, JPG, or WebP image.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `That image is ${formatMb(file.size)}. The maximum size is 5MB.`;
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = await readImageDimensions(objectUrl);
  } catch {
    return "We couldn't read that image. Please try a different PNG, JPG, or WebP file.";
  }

  if (dimensions.width < MIN_DIMENSION_PX || dimensions.height < MIN_DIMENSION_PX) {
    return `Image is too small (${dimensions.width}x${dimensions.height}px). Minimum is ${MIN_DIMENSION_PX}x${MIN_DIMENSION_PX}px.`;
  }

  return null;
}

/** Requests the appropriate signed-upload envelope for the given context. */
function requestSignature(context: ImageUploadContext): Promise<UploadSignature> {
  if (context === 'bookingPetPhoto') {
    return getBookingPetPhotoUploadSignature();
  }
  // 'petPhoto' | 'groomerLogo' both map to authenticated portal uploads.
  return getUploadSignature(context);
}

/**
 * POSTs the file directly to Cloudinary using XMLHttpRequest so we can report
 * upload progress. Resolves with the returned `secure_url`.
 */
function uploadToCloudinary(
  file: File,
  sig: UploadSignature,
  onProgress: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', sig.apiKey);
    formData.append('timestamp', String(sig.timestamp));
    formData.append('signature', sig.signature);
    formData.append('folder', sig.folder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response.secure_url) {
            resolve(response.secure_url as string);
          } else {
            reject(new Error('Upload succeeded but no URL was returned.'));
          }
        } catch {
          reject(new Error('Upload succeeded but the response was unreadable.'));
        }
      } else {
        reject(new Error('The upload service rejected the image. Please try again.'));
      }
    };

    xhr.onerror = () =>
      reject(new Error('Network error during upload. Check your connection and retry.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled.'));

    xhr.send(formData);
  });
}

export function ImageUpload({
  value,
  onChange,
  context,
  label = 'Upload image',
  id,
  disabled = false,
}: ImageUploadProps) {
  const inputId = React.useId();
  const fileInputId = id ?? inputId;

  const [status, setStatus] = React.useState<UploadStatus>(
    value ? 'complete' : 'idle'
  );
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  // Local object-URL preview shown immediately on selection (Req 23.4). Falls
  // back to the controlled `value` (an already-uploaded URL) when idle.
  const [localPreview, setLocalPreview] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Revoke the previous object URL whenever it changes / on unmount to avoid
  // leaking blob URLs.
  React.useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const previewSrc = localPreview ?? value ?? null;

  const handleFile = React.useCallback(
    async (file: File) => {
      setError(null);
      setProgress(0);
      setStatus('validating');

      // Create the object URL up front; it doubles as the preview source and
      // the input to dimension validation.
      const objectUrl = URL.createObjectURL(file);

      const validationError = await validateFile(file, objectUrl);
      if (validationError) {
        URL.revokeObjectURL(objectUrl);
        setStatus('error');
        setError(validationError);
        return;
      }

      // Show the preview immediately (Requirement 23.4).
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });

      setStatus('uploading');
      try {
        const sig = await requestSignature(context);
        const secureUrl = await uploadToCloudinary(file, sig, setProgress);
        onChange(secureUrl);
        setStatus('complete');
      } catch (err) {
        setStatus('error');
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong during upload. Please try again.'
        );
      }
    },
    [context, onChange]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers change.
    e.target.value = '';
    if (file) void handleFile(file);
  };

  const triggerRetry = () => {
    setStatus(value ? 'complete' : 'idle');
    setError(null);
    setProgress(0);
    fileInputRef.current?.click();
  };

  const isBusy = status === 'validating' || status === 'uploading';

  return (
    <div className="flex flex-col gap-2">
      {/* Preview / dropzone */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-base-300 bg-base-200">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt="Selected image preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xs text-base-content/50">No image</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor={fileInputId}
            className={`btn btn-outline btn-sm min-h-[44px] ${
              disabled || isBusy ? 'btn-disabled' : ''
            }`}
          >
            {status === 'complete' ? 'Replace image' : label}
          </label>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onInputChange}
            disabled={disabled || isBusy}
          />
          <p className="text-xs text-base-content/60">
            PNG, JPG, or WebP · up to 5MB · min {MIN_DIMENSION_PX}x{MIN_DIMENSION_PX}px
          </p>
        </div>
      </div>

      {/* Progress indicator (Requirement 23.5) */}
      {isBusy && (
        <div className="flex items-center gap-2">
          <progress
            className="progress progress-primary w-full"
            value={status === 'uploading' ? progress : undefined}
            max={100}
            aria-label="Upload progress"
          />
          <span className="w-10 text-right text-xs tabular-nums text-base-content/70">
            {status === 'uploading' ? `${progress}%` : '…'}
          </span>
        </div>
      )}

      {/* Completed state (Requirement 23.2) */}
      {status === 'complete' && !isBusy && (
        <p className="text-xs text-success" role="status">
          Upload complete.
        </p>
      )}

      {/* Error + retry (Requirement 23.3) */}
      {status === 'error' && error && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-xs min-h-[44px]"
            onClick={triggerRetry}
            disabled={disabled}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default ImageUpload;
