// Stub — file uploads are handled via AWS S3 presigned URLs at /api/upload
// This file is kept to avoid 404 if anything still references /api/uploadthing.
export function GET() {
  return Response.json({ error: "Use /api/upload instead" }, { status: 410 });
}
export function POST() {
  return Response.json({ error: "Use /api/upload instead" }, { status: 410 });
}
