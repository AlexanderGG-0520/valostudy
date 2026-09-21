import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, ListPartsCommand, HeadObjectCommand, GetObjectCommand,
  PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { studyIdSchema, frameNameSchema, PART_BYTES } from "@valostudy/schema";
import { config } from "@valostudy/config";

export function sourceKey(id: string) {
  return `studies/${studyIdSchema.parse(id)}/source`;
}

export function frameKey(id: string, name: string) {
  return `studies/${studyIdSchema.parse(id)}/frames/${frameNameSchema.parse(name)}`;
}

export function partSize(total: number, part: number) {
  const count = Math.ceil(total / PART_BYTES);
  if (!Number.isInteger(part) || part < 1 || part > count) throw new Error("Invalid part");
  return Math.min(PART_BYTES, total - (part - 1) * PART_BYTES);
}

export class Storage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const c = config();
    this.bucket = c.S3_BUCKET;
    this.client = new S3Client({
      endpoint: c.S3_ENDPOINT,
      region: c.S3_REGION,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY },
    });
  }

  async create(key: string, contentType: string) {
    const r = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    }));
    if (!r.UploadId) throw new Error("Storage did not return upload ID");
    return r.UploadId;
  }

  partUrl(key: string, uploadId: string, part: number, size: number, expiresIn: number) {
    return getSignedUrl(this.client, new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: part,
      ContentLength: size,
    }), { expiresIn, signableHeaders: new Set(["content-length"]) });
  }

  async parts(key: string, uploadId: string) {
    const r = await this.client.send(new ListPartsCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    }));
    if (r.IsTruncated) throw new Error("Unexpected part count");
    return (r.Parts ?? []).map((p) => {
      if (p.PartNumber === undefined || p.ETag === undefined || p.Size === undefined)
        throw new Error("Storage returned incomplete part metadata");
      return { PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size };
    });
  }

  complete(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
    return this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }));
  }

  abort(key: string, uploadId: string) {
    return this.client.send(new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    }));
  }

  async head(key: string) {
    try {
      return await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      if (e instanceof Error && e.name === "NotFound") return null;
      throw e;
    }
  }

  get(key: string) {
    return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  putFrame(key: string, bytes: Uint8Array) {
    return this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/webp",
    }));
  }

  delete(key: string) {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]) {
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const batch = keys.slice(offset, offset + 1000);
      if (!batch.length) continue;
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) },
      }));
    }
  }
}
