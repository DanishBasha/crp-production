# ==============================================================================
# Communication Readiness Platform - S3 Frontend Deployment Script (PowerShell)
# Usage:
#   .\deploy\s3\deploy-s3.ps1 -BucketName "my-crp-frontend-bucket" -ApiUrl "http://<EC2-PUBLIC-IP>" -Region "ap-south-1"
# ==============================================================================

param (
    [Parameter(Mandatory = $true, HelpMessage = "Name of the target S3 bucket (must be globally unique)")]
    [string]$BucketName,

    [Parameter(Mandatory = $true, HelpMessage = "Public URL of the EC2 backend (e.g. http://13.232.xxx.xxx or https://api.domain.com)")]
    [string]$ApiUrl,

    [Parameter(Mandatory = $false)]
    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " CRP Frontend S3 Deployment" -ForegroundColor Cyan
Write-Host " Bucket:  $BucketName" -ForegroundColor Yellow
Write-Host " Region:  $Region" -ForegroundColor Yellow
Write-Host " Backend: $ApiUrl" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify AWS CLI Authentication
Write-Host "--> Checking AWS CLI credentials..." -ForegroundColor Green
try {
    $caller = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "    Authenticated as: $($caller.Arn)" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: AWS CLI is not configured or lacks credentials." -ForegroundColor Red
    Write-Host "Please run 'aws configure' and provide your AWS Access Key, Secret Key, and Region." -ForegroundColor Yellow
    exit 1
}

# 2. Ensure S3 Bucket Exists
Write-Host "--> Checking if S3 bucket exists: $BucketName..." -ForegroundColor Green
$bucketExists = $false
try {
    aws s3api head-bucket --bucket $BucketName 2>$null
    $bucketExists = $true
    Write-Host "    Bucket '$BucketName' found." -ForegroundColor Gray
} catch {
    Write-Host "    Bucket does not exist. Creating bucket '$BucketName' in $Region..." -ForegroundColor Yellow
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName --region $Region
    } else {
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration LocationConstraint=$Region
    }
    Write-Host "    Bucket created successfully." -ForegroundColor Gray
}

# 3. Configure S3 for Public Static Website Hosting
Write-Host "--> Configuring bucket for public website hosting..." -ForegroundColor Green

# Remove Block Public Access
Write-Host "    Disabling Block Public Access..." -ForegroundColor Gray
aws s3api put-public-access-block --bucket $BucketName --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Configure Static Website Hosting (index.html as Index & Error document for SPA routing)
Write-Host "    Enabling static website hosting (SPA routing)..." -ForegroundColor Gray
aws s3 website "s3://$BucketName" --index-document index.html --error-document index.html

# Apply Public Read Bucket Policy
Write-Host "    Applying public read policy..." -ForegroundColor Gray
$policy = @"
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BucketName/*"
        }
    ]
}
"@
$policyFile = Join-Path $PSScriptRoot "s3-policy-temp.json"
$policy | Out-File -FilePath $policyFile -Encoding ascii
try {
    aws s3api put-bucket-policy --bucket $BucketName --policy file://$policyFile
} finally {
    if (Test-Path $policyFile) { Remove-Item $policyFile -Force }
}

# 4. Build Frontend with Production API URL
Write-Host "--> Building frontend with VITE_API_URL=$ApiUrl..." -ForegroundColor Green
$frontendDir = Join-Path (Get-Item $PSScriptRoot).Parent.Parent.FullName "frontend"

Push-Location $frontendDir
try {
    $env:VITE_API_URL = $ApiUrl
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# 5. Sync build artifacts to S3
Write-Host "--> Uploading build artifacts to S3..." -ForegroundColor Green
$distDir = Join-Path $frontendDir "dist"

# First, sync assets with long cache headers (1 year, immutable)
$distAssets = Join-Path $distDir "assets"
if (Test-Path $distAssets) {
    aws s3 sync $distAssets "s3://$BucketName/assets" --delete --cache-control "max-age=31536000,immutable"
}

# Second, sync root files (index.html, etc.) with no-cache so updates propagate immediately
aws s3 sync $distDir "s3://$BucketName" --delete --exclude "assets/*" --cache-control "no-cache,no-store,must-revalidate"

# 6. Print Live URL
$websiteUrl = "http://$BucketName.s3-website.$Region.amazonaws.com"
if ($Region -eq "us-east-1") {
    $websiteUrl = "http://$BucketName.s3-website-us-east-1.amazonaws.com"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " SUCCESS! CRP Frontend deployed to S3" -ForegroundColor Green
Write-Host " Live Website URL: $websiteUrl" -ForegroundColor Cyan
Write-Host " Backend API URL:  $ApiUrl/api" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "IMPORTANT NOTE:" -ForegroundColor Yellow
Write-Host "1. Ensure EC2 Security Group allows inbound traffic on port 80 (HTTP) from 0.0.0.0/0." -ForegroundColor Gray
Write-Host "2. Ensure backend/.env CORS_ORIGIN allows this website URL (or CORS_ORIGIN=*)." -ForegroundColor Gray
