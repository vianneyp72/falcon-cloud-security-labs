# FCS CLI Image Scanning with GitHub Actions

Scan container images for vulnerabilities in your CI/CD pipeline using the CrowdStrike FCS CLI via GitHub Actions. Only images that pass your Image Assessment Policy get pushed to the registry.

Official GH: https://github.com/CrowdStrike/fcs-action
Official Docs: https://falcon.crowdstrike.com/documentation/page/mac3b7b7

> **Performance note:** The FCS CLI sends only package inventories to CrowdStrike for assessment — your image content never leaves the runner. Typical scan time is 30-90 seconds depending on image size and layer count.

> **Prerequisites:**
> - GitHub account with a repository you control
> - CrowdStrike Falcon Cloud Security subscription
> - API client credentials with scopes: **Falcon Container CLI (R/W)**, **Falcon Container Image (R/W)**, **Cloud Security Tools Download (R)**
> - Docker installed locally (for testing the build)
> - ~45 minutes

## Reference Docs

| Source | Link |
|--------|------|
| CrowdStrike fcs-action | https://github.com/CrowdStrike/fcs-action |
| Image Assessment with FCS CLI | https://falcon.crowdstrike.com/documentation/page/mac3b7b7 |
| CI/CD Pipeline Integration | https://falcon.crowdstrike.com/documentation/page/wc4a46fa |
| Shift Security Left | https://falcon.crowdstrike.com/documentation/page/eb7306b8 |
| GitHub Actions Encrypted Secrets | https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions |
| GitHub Container Registry (ghcr.io) | https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry |

---

## Architecture

```
GitHub Actions Runner ── fcs-action ── Image Assessment
  docker build         scan image       CrowdStrike Cloud
       │                   │                   │
       ▼                   ▼                   ▼
  Local Image ──────► Inventory Only ────► Pass/Fail
       │                                       │
       ▼                                       ▼
  Push to ghcr.io ◄──── Gate (exit code 0) ────┘
```

---

## 1. Create the Demo Flask App

> **~10 min | Beginner**

> **What & Why:** We need a simple app with a Dockerfile to build. We'll intentionally pin an older version of a package so the scan has something to flag.

Create a new directory for the project:

```bash
mkdir fcs-scan-demo && cd fcs-scan-demo
```

### app.py

```python
from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello():
    return "<h1>FCS Scan Demo</h1><p>This image passed CrowdStrike image assessment.</p>"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

### requirements.txt (intentionally vulnerable)

```
flask==2.3.2
werkzeug==2.3.3
jinja2==3.1.2
```

> **What this does:** These pinned versions contain known CVEs (e.g., Werkzeug 2.3.3 has GHSA-2g68-c3qc-8985). This ensures the scanner has findings to report when we test the "fail" case.

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

EXPOSE 5000
CMD ["python", "app.py"]
```

### Verify the build locally

```bash
docker build -t fcs-scan-demo:local .
docker run --rm -p 5000:5000 fcs-scan-demo:local
# Visit http://localhost:5000 — then Ctrl+C to stop
```

---

## 2. Create the GitHub Repository

> **~10 min | Beginner**

> **What & Why:** The GitHub Actions workflow runs on push events in this repo. We also need to configure the CrowdStrike API credentials as repository secrets.

### Initialize and push

```bash
git init
git add app.py requirements.txt Dockerfile
git commit -m "initial commit: demo flask app"
```

Create the repo on GitHub (using `gh` CLI or the web UI):

```bash
gh repo create fcs-scan-demo --private --source=. --push
```

### Configure secrets

Add your CrowdStrike API credentials as repository secrets:

```bash
gh secret set FALCON_CLIENT_SECRET
# Paste your API client secret when prompted

gh variable set FALCON_CLIENT_ID --body "YOUR_CLIENT_ID_HERE"
gh variable set FALCON_REGION --body "us-1"
```

> **What this does:** `FALCON_CLIENT_SECRET` is stored encrypted as a GitHub Secret (never logged). `FALCON_CLIENT_ID` and `FALCON_REGION` are stored as variables (non-sensitive, visible in logs). The region must match your Falcon tenant: `us-1`, `us-2`, or `eu-1`.

---

## 3. Write the GitHub Actions Workflow

> **~15 min | Intermediate**

> **What & Why:** This is the core of the lab — a workflow that builds your image, scans it with CrowdStrike's fcs-action, and only pushes to ghcr.io if the image passes your assessment policy.

Create the workflow file:

```bash
mkdir -p .github/workflows
```

### .github/workflows/build-scan-push.yml

```yaml
name: Build, Scan & Push

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  IMAGE_NAME: ghcr.io/${{ github.repository }}
  IMAGE_TAG: ${{ github.sha }}

jobs:
  build-scan-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      security-events: write  # For SARIF upload

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Build container image
        run: |
          docker build -t ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} .

      - name: CrowdStrike FCS Image Scan
        id: fcs-scan
        uses: crowdstrike/fcs-action@v4
        with:
          falcon_client_id: ${{ vars.FALCON_CLIENT_ID }}
          falcon_region: ${{ vars.FALCON_REGION }}
          scan_type: image
          image: ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
          report_formats: sarif
          output_path: ./fcs-results.sarif
        env:
          FALCON_CLIENT_SECRET: ${{ secrets.FALCON_CLIENT_SECRET }}

      - name: Upload SARIF to GitHub Security
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ./fcs-results.sarif
        continue-on-error: true

      - name: Gate — check scan result
        if: steps.fcs-scan.outputs.exit-code != 0
        run: |
          echo "::error::Image failed CrowdStrike assessment (exit code: ${{ steps.fcs-scan.outputs.exit-code }})"
          exit 1

      - name: Log in to ghcr.io
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Push image to ghcr.io
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          docker push ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
          docker tag ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} ${{ env.IMAGE_NAME }}:latest
          docker push ${{ env.IMAGE_NAME }}:latest
```

> **What this does:**
> 1. Builds the image locally on the runner
> 2. Runs FCS CLI scan — only the package inventory is sent to CrowdStrike
> 3. Uploads SARIF results to GitHub's Security tab (always, even on failure)
> 4. Gates: if exit code != 0, the workflow fails and the push never happens
> 5. On pass: logs into ghcr.io and pushes the image with SHA and `latest` tags

### Commit and push the workflow

```bash
git add .github/workflows/build-scan-push.yml
git commit -m "add fcs-action image scan workflow"
git push
```

---

## 4. Test the Gate — Fail Case

> **~10 min | Intermediate**

> **What & Why:** The first run should FAIL because our `requirements.txt` pins vulnerable packages. This proves the gate is working — vulnerable images never reach ghcr.io.

### Watch the workflow run

```bash
gh run watch
```

Or open the Actions tab in your browser:

```bash
gh browse --settings  # navigate to Actions tab
```

### Expected result

The workflow should fail at the "Gate — check scan result" step with an error like:

```
Error: Image failed CrowdStrike assessment (exit code: 1)
```

### Verify no image was pushed

```bash
gh api user/packages/container/fcs-scan-demo/versions 2>&1 | head -5
# Should return 404 or empty — no versions exist yet
```

### View findings in Falcon console

Navigate to **Cloud Security** > **Image Assessment** > **CI Images** in the Falcon console. You'll see your scanned image with its vulnerabilities listed — severity, CVE IDs, affected packages, and available fixes.

---

## 5. Fix Vulnerabilities & Pass

> **~10 min | Intermediate**

> **What & Why:** Now we update the vulnerable packages so the image passes assessment. This demonstrates the developer feedback loop — fix locally, push, scan passes, image reaches registry.

### Update requirements.txt

Replace the contents with updated versions:

```
flask==3.1.1
werkzeug==3.1.3
jinja2==3.1.6
```

### Commit and push

```bash
git add requirements.txt
git commit -m "fix: upgrade packages to resolve CVEs"
git push
```

### Watch it pass

```bash
gh run watch
```

### Expected result

All steps should pass. The final "Push image to ghcr.io" step runs successfully.

### Verify the image exists in ghcr.io

```bash
gh api user/packages/container/fcs-scan-demo/versions --jq '.[0].metadata.container.tags'
# Should show: ["<sha>", "latest"]
```

### Verify in Falcon console

Back in **Cloud Security** > **Image Assessment** > **CI Images**, the latest scan should show a passing assessment with no critical/high findings.

---

## 6. Optional Enhancements

> **~10 min | Advanced**

> **What & Why:** Production pipelines typically add PR annotations, scan result comments, and badges so developers get feedback without leaving GitHub.

### Add PR comment with scan results

Add this step after the scan (requires `pull-requests: write` permission):

```yaml
      - name: Comment scan results on PR
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const exitCode = '${{ steps.fcs-scan.outputs.exit-code }}';
            const status = exitCode === '0' ? 'PASSED' : 'FAILED';
            const icon = exitCode === '0' ? ':white_check_mark:' : ':x:';
            const body = `## ${icon} CrowdStrike Image Scan: ${status}\n\n` +
              `**Image:** \`${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}\`\n` +
              `**Exit Code:** ${exitCode}\n\n` +
              `View full results in the [Security tab](/${process.env.GITHUB_REPOSITORY}/security/code-scanning).`;
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body,
            });
```

### Add a scan status badge to README

Add to your repo's `README.md`:

```markdown
![Image Scan](https://github.com/YOUR_USER/fcs-scan-demo/actions/workflows/build-scan-push.yml/badge.svg)
```

### Multi-architecture builds

For production images targeting both amd64 and arm64:

```yaml
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build multi-arch image
        run: |
          docker buildx build \
            --platform linux/amd64,linux/arm64 \
            --tag ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }} \
            --load .
```

---

## FCS CLI Exit Codes

| Exit Code | Meaning | Pipeline Action |
|-----------|---------|----------------|
| `0` | Image passes assessment policy | Proceed (push/deploy) |
| `1` | Image fails policy — block | Fail the pipeline |
| `2` | Image fails policy — alert only | Warn but don't block |
| `201` | Authentication error | Fail — check credentials |
| `202` | Connection timeout | Fail — check network/region |
| `203` | Image not found | Fail — check image name/tag |
| `204` | Invalid input | Fail — check workflow config |

---

## Challenges

### Challenge 1: Add severity threshold

**Scenario:** Your team wants to allow medium-severity vulnerabilities through in dev environments but block everything critical/high. Modify the workflow to use different Image Assessment Policies for `main` vs feature branches.

<details>
<summary>Hint</summary>

You can't set severity thresholds in the fcs-action itself — the pass/fail decision comes from your **Image Assessment Policy** configured in the Falcon console. However, you CAN use different API credentials (pointing to different policies) based on the branch.

Alternatively, parse the SARIF output and implement your own logic.

</details>

<details>
<summary>Solution</summary>

Create two API clients in Falcon — one linked to a strict policy, one to a permissive policy:

```yaml
      - name: CrowdStrike FCS Image Scan
        uses: crowdstrike/fcs-action@v4
        with:
          falcon_client_id: ${{ github.ref == 'refs/heads/main' && vars.FALCON_CLIENT_ID_STRICT || vars.FALCON_CLIENT_ID_DEV }}
          falcon_region: ${{ vars.FALCON_REGION }}
          scan_type: image
          image: ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
        env:
          FALCON_CLIENT_SECRET: ${{ github.ref == 'refs/heads/main' && secrets.FALCON_CLIENT_SECRET_STRICT || secrets.FALCON_CLIENT_SECRET_DEV }}
```

</details>

---

### Challenge 2: Scheduled re-scanning

**Scenario:** New CVEs are discovered daily. An image that passed last week might be vulnerable today. Add a scheduled workflow that re-scans your latest published image nightly.

<details>
<summary>Hint</summary>

Use `on: schedule` with a cron expression. Pull the already-published image from ghcr.io (don't rebuild) and scan it.

</details>

<details>
<summary>Solution</summary>

Create `.github/workflows/nightly-rescan.yml`:

```yaml
name: Nightly Image Re-scan

on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM UTC daily

jobs:
  rescan:
    runs-on: ubuntu-latest
    permissions:
      packages: read
      security-events: write

    steps:
      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Pull latest image
        run: docker pull ghcr.io/${{ github.repository }}:latest

      - name: CrowdStrike FCS Scan
        uses: crowdstrike/fcs-action@v4
        with:
          falcon_client_id: ${{ vars.FALCON_CLIENT_ID }}
          falcon_region: ${{ vars.FALCON_REGION }}
          scan_type: image
          image: ghcr.io/${{ github.repository }}:latest
          report_formats: sarif
          output_path: ./rescan-results.sarif
        env:
          FALCON_CLIENT_SECRET: ${{ secrets.FALCON_CLIENT_SECRET }}

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ./rescan-results.sarif
```

</details>

---

### Challenge 3: Combined IaC + Image scanning

**Scenario:** Your repo also contains Terraform files. Add IaC scanning to the same workflow so both infrastructure misconfigurations AND image vulnerabilities are caught before merge.

<details>
<summary>Hint</summary>

The `fcs-action` supports `scan_type: iac` in addition to `scan_type: image`. You can run both in the same job or as parallel jobs.

</details>

<details>
<summary>Solution</summary>

Add a parallel job:

```yaml
  iac-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: CrowdStrike IaC Scan
        uses: crowdstrike/fcs-action@v4
        with:
          falcon_client_id: ${{ vars.FALCON_CLIENT_ID }}
          falcon_region: ${{ vars.FALCON_REGION }}
          scan_type: iac
          path: ./terraform/
          fail_on: high
          report_formats: sarif
          output_path: ./iac-results.sarif
        env:
          FALCON_CLIENT_SECRET: ${{ secrets.FALCON_CLIENT_SECRET }}

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ./iac-results.sarif
          category: iac-scan
```

Note: IaC scanning uses `fail_on` to set the threshold locally, unlike image scanning which relies on the console policy.

</details>

---

## Quick Reference

| Item | Value |
|------|-------|
| GitHub Action | `crowdstrike/fcs-action@v4` |
| Scan type | `image` |
| Required secrets | `FALCON_CLIENT_SECRET` |
| Required variables | `FALCON_CLIENT_ID`, `FALCON_REGION` |
| API scopes | Falcon Container CLI (R/W), Falcon Container Image (R/W), Cloud Security Tools Download (R) |
| Registry | `ghcr.io` (uses `GITHUB_TOKEN` for auth) |
| Pass exit code | `0` |
| Fail exit code | `1` (block) or `2` (alert) |
| Report formats | `json`, `sarif`, `cyclonedx-json` |
| Falcon console path | Cloud Security > Image Assessment > CI Images |
| Data sent to CrowdStrike | Package inventory only (image stays on runner) |

---

*Created: 2026-06-16 | Topics: fcs-cli, image-scanning, github-actions, ci-cd, shift-left, container-security*
