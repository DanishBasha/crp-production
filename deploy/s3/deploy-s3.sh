#!/usr/bin/env bash
# ==============================================================================
# Communication Readiness Platform - S3 Frontend Deployment Script (Bash)
# Usage:
#   ./deploy/s3/deploy-s3.sh <bucket-name> <ec2-public-url> [region]
# Example:
#   ./deploy/s3/deploy-s3.sh crp-frontend-production http://13.232.12.34 ap-south-1
# ==============================================================================

set -e

BUCKET_NAME="$1"
API_URL="$2"
REGION="${3:-ap-south-1}"

if [ -z "$BUCKET_NAME" ] || [ -z "$API_URL" ]; then
    echo "Usage: $0 <bucket-name> <ec2-public-url> [region]"
    echo "Example: $0 crp-frontend-production http://13.232.12.34 ap-south-1"
    exit 1
fi

echo "=========================================================="
echo " CRP Frontend S3 Deployment"
echo " Bucket:  $BUCKET_NAME"
echo " Region:  $REGION"
echo " Backend: $API_URL"
echo "=========================================================="

# 1. Check AWS CLI Authentication
echo "--> Checking AWS CLI credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "ERROR: AWS CLI is not configured or lacks credentials."
    echo "Please run 'aws configure' first."
    exit 1
fi

# 2. Check or Create Bucket
echo "--> Checking S3 bucket: $BUCKET_NAME..."
if ! aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
    echo "    Bucket does not exist. Creating bucket '$BUCKET_NAME' in $REGION..."
    if [ "$REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION"
    else
        aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION"
    fi
    echo "    Bucket created successfully."
else
    echo "    Bucket found."
fi

# 3. Configure Website Hosting & Public Access
echo "--> Configuring bucket for public website hosting..."
aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

aws s3 website "s3://$BUCKET_NAME" --index-document index.html --error-document index.html

cat << EOF > /tmp/s3-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
        }
    ]
}
EOF

aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy file:///tmp/s3-policy.json
rm -f /tmp/s3-policy.json

# 4. Build Frontend
echo "--> Building frontend with VITE_API_URL=$API_URL..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/../../frontend" && pwd)"

cd "$FRONTEND_DIR"
VITE_API_URL="$API_URL" npm run build

# 5. Upload to S3
echo "--> Syncing files to S3..."
DIST_DIR="$FRONTEND_DIR/dist"

if [ -d "$DIST_DIR/assets" ]; then
    aws s3 sync "$DIST_DIR/assets" "s3://$BUCKET_NAME/assets" \
        --delete --cache-control "max-age=31536000,immutable"
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET_NAME" \
    --delete --exclude "assets/*" --cache-control "no-cache,no-store,must-revalidate"

# 6. Report Live URL
if [ "$REGION" = "us-east-1" ]; then
    WEBSITE_URL="http://$BUCKET_NAME.s3-website-us-east-1.amazonaws.com"
else
    WEBSITE_URL="http://$BUCKET_NAME.s3-website.$REGION.amazonaws.com"
fi

echo "=========================================================="
echo " SUCCESS! CRP Frontend deployed to S3"
echo " Live Website URL: $WEBSITE_URL"
echo " Backend API URL:  $API_URL/api"
echo "=========================================================="
