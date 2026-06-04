import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = process.env.AWS_REGION ?? "eu-central-1";
const BUCKET = process.env.AWS_S3_BUCKET_NAME!;
const ENDPOINT = process.env.AWS_S3_ENDPOINT;

export const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: true } : {}),
});

/** Generate a presigned PUT URL valid for 5 minutes */
export async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

/** Public URL for a stored object */
export function getPublicUrl(key: string): string {
  if (ENDPOINT) {
    return `${ENDPOINT}/${BUCKET}/${key}`;
  }
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

/** Delete an object by key */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Extract S3 key from a stored URL */
export function keyFromUrl(url: string): string {
  if (ENDPOINT) {
    const prefix = `${ENDPOINT}/${BUCKET}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : url;
  }
  const prefix = `https://${BUCKET}.s3.${REGION}.amazonaws.com/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}
