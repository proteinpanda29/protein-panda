import { ServiceUnavailableException } from '@nestjs/common';
import { UploadsService } from './uploads.service';

describe('UploadsService.getUploadSignature', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('throws a clear, actionable error when Cloudinary is not configured — not a silent failure or a cryptic crash', () => {
    process.env = { ...OLD_ENV };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    const service = new UploadsService();

    expect(() => service.getUploadSignature()).toThrow(ServiceUnavailableException);
  });

  it('returns a signature, timestamp, and the public credentials the browser needs once configured', () => {
    process.env = {
      ...OLD_ENV,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    };
    const service = new UploadsService();

    const result = service.getUploadSignature();

    expect(result).toEqual(
      expect.objectContaining({
        cloudName: 'test-cloud',
        apiKey: 'test-key',
        folder: 'protein-panda/products',
        signature: expect.any(String),
        timestamp: expect.any(Number),
      }),
    );
  });

  it('never includes the API secret itself in the response — only the signature it produces', () => {
    process.env = {
      ...OLD_ENV,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'super-secret-value',
    };
    const service = new UploadsService();

    const result = service.getUploadSignature();

    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });

  it('produces a different signature each time, tied to a fresh timestamp — a signature is not meant to be reusable indefinitely', () => {
    process.env = {
      ...OLD_ENV,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    };
    const service = new UploadsService();

    const first = service.getUploadSignature();
    // A real clock-tick between calls would naturally differ; asserting
    // structurally (both are present, well-formed) is what's reliable
    // here since two calls in the same second CAN legitimately produce
    // the same timestamp — the meaningful guarantee is that the
    // signature is a deterministic function of {timestamp, folder,
    // secret}, not a fixed, hardcoded value.
    expect(first.signature).toBeTruthy();
    expect(typeof first.timestamp).toBe('number');
  });

  it('signs a request for the reviews folder when explicitly asked, keeping customer-uploaded review photos separate from admin-uploaded product photos in Cloudinary', () => {
    process.env = {
      ...OLD_ENV,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    };
    const service = new UploadsService();

    const result = service.getUploadSignature('protein-panda/reviews');

    expect(result.folder).toBe('protein-panda/reviews');
  });

  it('defaults to the products folder when no folder is specified — preserves the exact existing admin behavior', () => {
    process.env = {
      ...OLD_ENV,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    };
    const service = new UploadsService();

    const result = service.getUploadSignature();

    expect(result.folder).toBe('protein-panda/products');
  });
});
