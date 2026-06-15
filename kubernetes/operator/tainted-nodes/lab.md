# Falcon Operator: Deploying on Fully Tainted Kubernetes Nodes

When all Kubernetes nodes carry taints (e.g., in hardened or multi-tenant clusters), the Falcon Operator and its managed components will fail to schedule unless tolerations are explicitly configured.

This guide covers the three-step process:

1. Add tolerations to the **Falcon Operator** deployment manifest
2. Add tolerations to the **FalconDeployment** CRD (covers the node sensor)
3. Manually patch the **KAC** and **IAR** deployments (no CRD-level toleration support) — only if provisioning a small untainted node is not an option

> **Preferred alternative for KAC/IAR:** If possible, provision a small node (or node pool) without taints and let KAC and IAR schedule there naturally. The manual patching in Step 3 is a workaround that can be overwritten by operator reconciliation. Only proceed with patching if creating an untainted node is not feasible in your environment.

> **Official Docs:** [Falcon Operator Tolerations](https://docs.crowdstrike.com/r/en-US/qg0ygdwl/md00027e)

---

## Prerequisites

- `kubectl` access to the cluster with admin privileges
- Falcon Operator release version identified (check [releases](https://github.com/crowdstrike/falcon-operator/releases))
- Falcon API credentials (Client ID and Secret)

---

## Step 0: Replicate an All-Nodes-Tainted Scenario (Lab/Testing)

Apply an example taint to all nodes:

```bash
kubectl taint nodes --all node-role=application:NoSchedule
```

Validate taints are in place:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

---

## Step 1: Deploy the Falcon Operator with Tolerations

The operator itself must tolerate the taints to schedule its controller-manager pod.

Instead of applying the operator manifest directly from the release URL, download it first so you can edit in the toleration:

```bash
# Replace [version] with the target release (e.g., 1.5.0)
curl -LO https://github.com/crowdstrike/falcon-operator/releases/download/v[version]/falcon-operator.yaml
```

Edit `falcon-operator.yaml` and add a toleration to the controller-manager Deployment's pod spec. Locate the `spec.template.spec` section for the `falcon-operator-controller-manager` Deployment and add the `tolerations` field:

```yaml
spec:
  template:
    spec:
      securityContext:
        fsGroup: 65534
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      tolerations: # This is pretty far down the file around line 10992
        - operator: "Exists"
      serviceAccountName: falcon-operator-controller-manager
      containers:
        # ... existing containers
```

> **Note:** `- operator: "Exists"` with no `key` tolerates **all** taints. For tighter control, specify the exact key/value/effect to match your taints.

Deploy the operator:

```bash
kubectl apply -f falcon-operator.yaml
```

Verify the operator pod is running:

```bash
kubectl get pods -n falcon-operator
```

---

## Step 2: Deploy the FalconDeployment CRD with Node Sensor Tolerations

Download the FalconDeployment sample manifest:

```bash
# Replace [version] with the operator version and [manifest] with the sample filename
curl -LO https://raw.githubusercontent.com/crowdstrike/falcon-operator/refs/tags/v[version]/config/samples/falcon_v1alpha1_falcondeployment-node-sensor.yaml
```

Edit the manifest to include the toleration under `spec.falconNodeSensor.node.tolerations`:

```yaml
apiVersion: falcon.crowdstrike.com/v1alpha1
kind: FalconDeployment
metadata:
  labels:
    crowdstrike.com/component: sample
    crowdstrike.com/created-by: falcon-operator
    crowdstrike.com/instance: falcondeployment-sample
    crowdstrike.com/managed-by: kustomize
    crowdstrike.com/name: falcon-deployment
    crowdstrike.com/part-of: Falcon
    crowdstrike.com/provider: crowdstrike
  name: falcon-deployment
spec:
  falcon_api:
    client_id: <CLIENT_ID>
    client_secret: <CLIENT_SECRET>
    cloud_region: autodiscover
  falconNodeSensor: # add this whole toleration path
    node:
      tolerations:
        - operator: Exists
```

Apply the manifest:

```bash
kubectl apply -f falcon_v1alpha1_falcondeployment-node-sensor.yaml
```

Verify the sensor DaemonSet pods are running on all nodes:

```bash
kubectl get pods -n falcon-system -o wide
```

---

## Step 3: Patch KAC and IAR Deployments with Tolerations

The FalconAdmission (KAC) and FalconImageAnalyzer (IAR) CRDs **do not expose a `tolerations` field** in their spec. When these components are deployed by the operator onto tainted nodes, their pods will remain in a `Pending` state.

> **Consider first:** If your cluster allows it, the cleaner approach is to provision a small node (or node pool) without taints specifically for KAC and IAR. These are lightweight single-replica Deployments and don't need to run on every node. This avoids the patching workaround below, which can be overwritten if the operator reconciles the Deployments (e.g., during sensor version updates). Only proceed with manual patching if creating an untainted node is not an option.

The workaround is to patch the Deployments directly after the operator creates them.

### Patch KAC (Kubernetes Admission Controller)

```bash
kubectl patch deployment falcon-kac -n falcon-kac \
  --type=json \
  -p='[{"op": "add", "path": "/spec/template/spec/tolerations", "value": [{"operator": "Exists"}]}]'
```

### Patch IAR (Image Assessment at Runtime)

```bash
kubectl patch deployment falcon-image-analyzer -n falcon-iar \
  --type=json \
  -p='[{"op": "add", "path": "/spec/template/spec/tolerations", "value": [{"operator": "Exists"}]}]'
```

### Verify all components are running

```bash
kubectl get pods -n falcon-kac
kubectl get pods -n falcon-iar
```

> **Important:** These patches are applied to the live Deployment objects. If the operator reconciles and recreates these Deployments (e.g., during a sensor version update), you will need to re-apply the patches.

---

## Summary

| Component       | Toleration Method                           | CRD Field Path                           |
| --------------- | ------------------------------------------- | ---------------------------------------- |
| Falcon Operator | Edit `falcon-operator.yaml` before applying | N/A (Deployment manifest)                |
| Node Sensor     | FalconDeployment CRD                        | `spec.falconNodeSensor.node.tolerations` |
| KAC             | Manual `kubectl patch`                      | N/A (not exposed in CRD)                 |
| IAR             | Manual `kubectl patch`                      | N/A (not exposed in CRD)                 |

---

## Cleanup (Lab/Testing)

Remove the example taint from all nodes:

```bash
kubectl taint nodes --all node-role=application:NoSchedule-
```
