from botocore.exceptions import ClientError
from storages.backends.s3boto3 import S3Boto3Storage, S3StaticStorage


class MinIOMediaStorage(S3Boto3Storage):
    """Media-file storage backed by MinIO (S3-compatible)."""
    location = "media"
    default_acl = None        # ACLs disabled on bucket-owner-enforced buckets
    file_overwrite = False


class MinIOStaticStorage(S3StaticStorage):
    """Static-file storage backed by MinIO (S3-compatible).

    Overrides ``exists()`` to handle the 403 that MinIO returns when the
    service-account lacks ``s3:ListBucket`` on the bucket.  Without this,
    ``collectstatic`` aborts on the first HeadObject call even though the
    credentials have full PutObject / GetObject access.
    """
    location = "static"
    default_acl = None        # avoid sending x-amz-acl header

    def exists(self, name):
        try:
            return super().exists(name)
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code in ("403", "AccessDenied"):
                # Treat as "does not exist" so collectstatic can upload the file.
                return False
            raise
