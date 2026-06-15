# Pushing Falcon Sensor Images to AWS ECR

## Create an ECR Repository

```bash
aws ecr create-repository \
  --repository-name falcon-sensor \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true
```

Note the repository URI in the output (e.g., `123456789012.dkr.ecr.us-east-1.amazonaws.com/falcon-sensor`).

## Authenticate to ECR

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    123456789012.dkr.ecr.us-east-1.amazonaws.com
```

## Pull from CrowdStrike and Push to ECR

Use the `falcon-container-sensor-pull` script to copy directly to ECR:

```bash
falcon-container-sensor-pull \
  --client-id "$FALCON_CLIENT_ID" \
  --client-secret "$FALCON_CLIENT_SECRET" \
  --region "$FALCON_CLOUD" \
  --type falcon-container \
  --copy "$ECR_REPO_URI" \
  --copy-omit-image-name
```

Or manually tag and push:

```bash
docker tag falcon-sensor:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/falcon-sensor:latest

docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/falcon-sensor:latest
```

## Note on `--copy-omit-image-name`

ECR works well with `--copy-omit-image-name` because ECR repositories are flat (no nested paths). When you use this flag, the image is pushed directly to the repository URI you specify without appending the original image name as a path component. This is the recommended approach for ECR.
