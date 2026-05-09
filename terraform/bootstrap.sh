#!/bin/sh
# Bootstrap the Terraform state backend for enhanced-review.
#
# Creates two AWS resources used as the remote state backend for both the
# platform module (terraform/platform/) and the application module
# (terraform/apps/enhanced-review/):
#
#   - S3 bucket   enhanced-review-tfstate-<account-id>
#   - DynamoDB    enhanced-review-tflock
#
# The bucket name embeds the AWS account ID so it's globally unique without
# manual coordination. Idempotent: re-runs on an existing bucket/table are
# no-ops (the AWS CLI returns BucketAlreadyOwnedByYou / ResourceInUseException
# which are tolerated via `|| true`).
#
# After this completes, run `terraform init` in each module with the printed
# -backend-config flags. See terraform/README.md.
set -eu

REGION="${AWS_REGION:-us-west-2}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="enhanced-review-tfstate-${ACCOUNT_ID}"
TABLE="enhanced-review-tflock"

echo "[bootstrap] region=$REGION account=$ACCOUNT_ID"
echo "[bootstrap] bucket=$BUCKET"
echo "[bootstrap] table=$TABLE"

# us-east-1 is the only region where create-bucket must NOT include
# LocationConstraint. Branch on that.
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" || true
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" || true
fi

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table --table-name "$TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" >/dev/null 2>&1 || true

echo ""
echo "[bootstrap] done."
echo ""
echo "Use these flags when running terraform init in each module:"
echo ""
echo "  terraform init \\"
echo "    -backend-config=\"bucket=$BUCKET\" \\"
echo "    -backend-config=\"key=<MODULE_KEY>\" \\"
echo "    -backend-config=\"region=$REGION\" \\"
echo "    -backend-config=\"dynamodb_table=$TABLE\" \\"
echo "    -backend-config=\"encrypt=true\""
echo ""
echo "MODULE_KEY values:"
echo "  platform                    -> platform/terraform.tfstate"
echo "  apps/enhanced-review        -> apps/enhanced-review/terraform.tfstate"
