# Verifying Falcon Sensor Installation

Use this guide to confirm the Falcon sensor is running and registered with your Falcon tenant.

## Check the Sensor Service

### Linux (systemd)

```bash
sudo systemctl status falcon-sensor
```

Expected output should show `active (running)`.

### Linux (process check)

```bash
ps aux | grep -i falcon-sensor
```

You should see the `falcon-sensor` daemon process.

### Windows

```powershell
Get-Service CsFalconService
```

Status should be `Running`.

### macOS

```bash
sudo /Applications/Falcon.app/Contents/Resources/falconctl stats
```

## Check the Agent ID (AID)

The AID uniquely identifies this host in the Falcon Console.

### Linux

```bash
sudo /opt/CrowdStrike/falconctl -g --aid
```

A valid AID is a 32-character hex string. If the output is empty, the sensor has not successfully registered.

### Windows

```powershell
& "C:\Program Files\CrowdStrike\falconctl.exe" /g /aid
```

### macOS

```bash
sudo /Applications/Falcon.app/Contents/Resources/falconctl stats | grep agentID
```

## Verify in the Falcon Console

1. Log in to the Falcon Console at <https://falcon.crowdstrike.com>.
2. Navigate to **Host setup and management > Host management**.
3. Search for the host by hostname, IP address, or AID.
4. Confirm the host appears with a **Last Seen** timestamp within the expected timeframe.
5. Verify the sensor version matches what you deployed.

## Troubleshooting

- If the service is not running, check logs: `journalctl -u falcon-sensor` (Linux) or Event Viewer (Windows).
- If the AID is empty, verify the CID is correct and the host can reach the Falcon cloud (ports 443 outbound).
- If the host does not appear in the console, check that installation tokens are correct (if required by your tenant).
