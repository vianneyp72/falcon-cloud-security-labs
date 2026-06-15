# Falcon Sensor via EC2 User Data

> **Status:** Steps not yet written. Use [CrowdStrike Falcon Scripts GitHub](https://github.com/CrowdStrike/falcon-scripts) in the meantime.

## Overview

Install the CrowdStrike Falcon sensor on Linux EC2 instances at launch time using EC2 user data scripts (or Terraform `user_data`). This approach downloads and installs the sensor during instance initialization, making it suitable for auto-scaling groups and ephemeral infrastructure where baking AMIs is not practical.
