# Serverless Functions (Lambda, Azure Functions, GCP Functions)

Serverless function runtimes (AWS Lambda, Azure Functions, Google Cloud Functions) do not support deploying the Falcon sensor into the function execution environment. These platforms have highly constrained runtimes that do not permit running a background agent process.

## How Are They Protected?

Serverless functions are monitored **agentless** via **CrowdStrike Cloud Security** (formerly Horizon). This provides:

- Configuration assessment and misconfigurations detection
- Behavioral indicators of attack (IOAs) based on cloud API telemetry
- Runtime visibility through cloud-native integrations (no sensor required)

No sensor deployment action is needed for serverless functions. Instead, ensure your cloud accounts are onboarded into CrowdStrike Cloud Security.

## Reference

- [CrowdStrike Cloud Security documentation](https://falcon.crowdstrike.com/documentation/page/cloud-security)
